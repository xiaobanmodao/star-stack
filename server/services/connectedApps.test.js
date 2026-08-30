import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sqlite3 from 'sqlite3'
import { open } from 'sqlite'
import { ensureAccountIdentitySchema } from '../utils/accountIdentityMigration.js'
import { ensureOidcIdentitySchema } from '../utils/oidcIdentityMigration.js'
import {
  ConnectedApplicationError,
  listConnectedApplications,
  revokeConnectedApplication,
} from './connectedApps.js'

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/legacy-account-identity.sql',
)
const resources = []
const subject = '11111111-1111-4111-8111-111111111111'
const bannedSubject = '22222222-2222-4222-8222-222222222222'
const client = { id: 'jieya-server-local' }
const now = '2026-08-31T12:00:00.000Z'

const openFixture = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'starstack-connected-apps-'))
  const db = await open({ filename: path.join(directory, 'fixture.sqlite'), driver: sqlite3.Database })
  await db.exec(await readFile(fixturePath, 'utf8'))
  const generatedSubjects = [subject, bannedSubject]
  await ensureAccountIdentitySchema(db, { generateSubject: () => generatedSubjects.shift() })
  await ensureOidcIdentitySchema(db)
  resources.push({ db, directory })
  return db
}

const addLoginSession = (db, {
  clientId = client.id,
  sid = 'jieya-sid-1',
  status = 'active',
} = {}) => db.run(
  `INSERT INTO oidc_login_sessions
     (account_subject, client_id, sid, auth_generation, status,
      created_at, updated_at, expires_at)
   VALUES (?, ?, ?, 0, ?, ?, ?, ?)`,
  subject,
  clientId,
  sid,
  status,
  now,
  now,
  '2026-09-30T12:00:00.000Z',
)

afterEach(async () => {
  while (resources.length) {
    const { db, directory } = resources.pop()
    await db.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

describe('connected applications', () => {
  it('returns fixed Jieya metadata without exposing subject, client id or admin state', async () => {
    const db = await openFixture()

    const applications = await listConnectedApplications(db, {
      accountId: 'alice',
      client,
      now: () => new Date(now),
    })

    expect(applications).toEqual([
      expect.objectContaining({
        id: 'jieya',
        name: '界芽计划',
        homepage: 'https://jieya.xingzhan.cc',
        status: 'not_connected',
      }),
    ])
    expect(JSON.stringify(applications)).not.toMatch(/account_subject|clientId|isAdmin|is_admin/)
  })

  it('derives connected state only from a live accepted login session', async () => {
    const db = await openFixture()
    await addLoginSession(db)
    await addLoginSession(db, { sid: 'expired-sid' })
    await db.run(
      `UPDATE oidc_login_sessions SET expires_at = '2026-08-30T00:00:00.000Z'
       WHERE sid = 'expired-sid'`,
    )

    const [application] = await listConnectedApplications(db, {
      accountId: 'alice',
      client,
      now: () => new Date(now),
    })

    expect(application).toMatchObject({
      status: 'connected',
      connectedAt: now,
      sessionCount: 1,
      canRevoke: true,
    })
  })

  it('revokes Jieya fail-closed while preserving the StarStack main session', async () => {
    const db = await openFixture()
    await addLoginSession(db)
    await addLoginSession(db, { sid: 'jieya-sid-2' })
    await db.run(
      `INSERT INTO account_center_sessions
         (token_hash, user_id, account_subject, auth_generation, csrf_hash,
          created_at, expires_at, last_seen_at, established_at)
       VALUES ('account-session-hash', 'alice', ?, 0, 'csrf-hash', ?, ?, ?, ?)`,
      subject,
      now,
      '2026-09-30T12:00:00.000Z',
      now,
      now,
    )

    const result = await revokeConnectedApplication(db, {
      accountId: 'alice',
      applicationId: 'jieya',
      client,
      now: () => now,
    })

    expect(result).toMatchObject({ changed: true, status: 'revocation_pending' })
    expect(await db.get(`SELECT auth_generation FROM users WHERE id = 'alice'`))
      .toEqual({ auth_generation: 1 })
    expect(await db.get(`SELECT COUNT(*) AS count FROM sessions WHERE user_id = 'alice'`))
      .toEqual({ count: 1 })
    expect(await db.get(`SELECT COUNT(*) AS count FROM account_center_sessions`))
      .toEqual({ count: 0 })
    expect(await db.all(
      `SELECT sid, status FROM oidc_login_sessions ORDER BY sid`,
    )).toEqual([
      { sid: 'jieya-sid-1', status: 'revocation_pending' },
      { sid: 'jieya-sid-2', status: 'revocation_pending' },
    ])
    expect(await db.all(
      `SELECT event_type, client_id, sid, status FROM identity_outbox ORDER BY event_type, sid`,
    )).toEqual([
      { event_type: 'oidc.revoke_consent', client_id: client.id, sid: null, status: 'pending' },
      { event_type: 'oidc.revoke_session', client_id: client.id, sid: 'jieya-sid-1', status: 'pending' },
      { event_type: 'oidc.revoke_session', client_id: client.id, sid: 'jieya-sid-2', status: 'pending' },
    ])

    const repeated = await revokeConnectedApplication(db, {
      accountId: 'alice',
      applicationId: 'jieya',
      client,
      now: () => now,
    })
    expect(repeated).toMatchObject({ changed: false, status: 'revocation_pending' })
    expect(await db.get(`SELECT auth_generation FROM users WHERE id = 'alice'`))
      .toEqual({ auth_generation: 1 })
    expect(await db.get(`SELECT COUNT(*) AS count FROM identity_outbox`)).toEqual({ count: 3 })
  })

  it('fails without changing state if an unsupported live client is present', async () => {
    const db = await openFixture()
    await addLoginSession(db)
    await addLoginSession(db, { clientId: 'unknown-client', sid: 'unknown-sid' })

    await expect(revokeConnectedApplication(db, {
      accountId: 'alice',
      applicationId: 'jieya',
      client,
      now: () => now,
    })).rejects.toBeInstanceOf(ConnectedApplicationError)

    expect(await db.get(`SELECT auth_generation FROM users WHERE id = 'alice'`))
      .toEqual({ auth_generation: 0 })
    expect(await db.get(`SELECT COUNT(*) AS count FROM identity_outbox`)).toEqual({ count: 0 })
    expect(await db.get(
      `SELECT COUNT(*) AS count FROM oidc_login_sessions WHERE status = 'active'`,
    )).toEqual({ count: 2 })
  })

  it('rolls back generation and session state when durable outbox insertion fails', async () => {
    const db = await openFixture()
    await addLoginSession(db)
    await db.exec(`
      CREATE TRIGGER fixture_connected_app_outbox_failure
      BEFORE INSERT ON identity_outbox
      BEGIN
        SELECT RAISE(ABORT, 'fixture connected app outbox failed');
      END;
    `)

    await expect(revokeConnectedApplication(db, {
      accountId: 'alice',
      applicationId: 'jieya',
      client,
      now: () => now,
    })).rejects.toThrow(/outbox failed/i)

    expect(await db.get(`SELECT auth_generation FROM users WHERE id = 'alice'`))
      .toEqual({ auth_generation: 0 })
    expect(await db.get(`SELECT status FROM oidc_login_sessions WHERE sid = 'jieya-sid-1'`))
      .toEqual({ status: 'active' })
    expect(await db.get(`SELECT COUNT(*) AS count FROM identity_outbox`)).toEqual({ count: 0 })
  })
})
