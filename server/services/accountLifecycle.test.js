import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sqlite3 from 'sqlite3'
import { open } from 'sqlite'
import { ensureAccountIdentitySchema } from '../utils/accountIdentityMigration.js'
import { ensureOidcIdentitySchema } from '../utils/oidcIdentityMigration.js'
import { changeAccountPassword, transitionAccountStatus } from './accountLifecycle.js'
import { processIdentityOutboxOnce } from './identityOutbox.js'

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/legacy-account-identity.sql',
)
const resources = []
const subjects = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
]

const openMigratedFixture = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'starstack-account-lifecycle-'))
  const db = await open({ filename: path.join(directory, 'fixture.sqlite'), driver: sqlite3.Database })
  await db.exec(await readFile(fixturePath, 'utf8'))
  const generated = [...subjects]
  await ensureAccountIdentitySchema(db, { generateSubject: () => generated.shift() })
  await ensureOidcIdentitySchema(db)
  resources.push({ db, directory })
  return db
}

afterEach(async () => {
  while (resources.length) {
    const { db, directory } = resources.pop()
    await db.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

describe('account lifecycle', () => {
  it('suspends and restores accounts while revoking every existing session transactionally', async () => {
    const db = await openMigratedFixture()
    await transitionAccountStatus(db, { accountId: 'alice', status: 'suspended' })
    expect(await db.get(`SELECT account_status, is_banned FROM users WHERE id = 'alice'`)).toEqual({
      account_status: 'suspended',
      is_banned: 1,
    })
    expect(await db.get(`SELECT auth_generation FROM users WHERE id = 'alice'`)).toEqual({ auth_generation: 1 })
    expect(await db.get(`SELECT COUNT(*) AS count FROM sessions WHERE user_id = 'alice'`)).toEqual({ count: 0 })
    expect(await db.get(
      `SELECT event_type, subject, status FROM identity_outbox WHERE subject = ?`,
      subjects[0],
    )).toEqual({ event_type: 'account.suspended', subject: subjects[0], status: 'pending' })

    await db.run(
      `INSERT INTO sessions (token, user_id, created_at) VALUES (?, 'alice', ?)`,
      'cccccccccccccccccccccccccccccccccccccccccccccccc',
      new Date().toISOString(),
    )
    await transitionAccountStatus(db, { accountId: 'alice', status: 'active' })
    expect(await db.get(`SELECT account_status, is_banned FROM users WHERE id = 'alice'`)).toEqual({
      account_status: 'active',
      is_banned: 0,
    })
    expect(await db.get(`SELECT auth_generation FROM users WHERE id = 'alice'`)).toEqual({ auth_generation: 2 })
    expect(await db.get(`SELECT COUNT(*) AS count FROM sessions WHERE user_id = 'alice'`)).toEqual({ count: 0 })
    expect(await db.get(`SELECT COUNT(*) AS count FROM identity_outbox WHERE subject = ?`, subjects[0])).toEqual({ count: 2 })
  })

  it('rolls back the status change if session revocation fails', async () => {
    const db = await openMigratedFixture()
    await db.exec(`
      CREATE TRIGGER fixture_sessions_delete_failure
      BEFORE DELETE ON sessions
      BEGIN
        SELECT RAISE(ABORT, 'fixture session revoke failed');
      END;
    `)

    await expect(transitionAccountStatus(db, {
      accountId: 'alice',
      status: 'suspended',
    })).rejects.toThrow(/session revoke failed/i)

    expect(await db.get(`SELECT account_status, is_banned FROM users WHERE id = 'alice'`)).toEqual({
      account_status: 'active',
      is_banned: 0,
    })
    expect(await db.get(`SELECT auth_generation FROM users WHERE id = 'alice'`)).toEqual({ auth_generation: 0 })
    expect(await db.get(`SELECT COUNT(*) AS count FROM sessions WHERE user_id = 'alice'`)).toEqual({ count: 1 })
    expect(await db.get(`SELECT COUNT(*) AS count FROM identity_outbox`)).toEqual({ count: 0 })
  })

  it('tombstones personal fields but preserves the immutable subject, legacy ID and OJ history', async () => {
    const db = await openMigratedFixture()
    const tombstonedAt = '2026-08-30T12:00:00.000Z'
    await transitionAccountStatus(db, {
      accountId: 'alice',
      status: 'deleted',
      now: () => tombstonedAt,
    })

    expect(await db.get(
      `SELECT id, account_subject, account_status, account_tombstoned_at,
              name, email, email_verified_at, avatar, bio, is_admin, is_banned,
              avatar_frame, avatar_overlay, equipped_title
       FROM users WHERE id = 'alice'`,
    )).toEqual({
      id: 'alice',
      account_subject: subjects[0],
      account_status: 'deleted',
      account_tombstoned_at: tombstonedAt,
      name: '已注销用户',
      email: null,
      email_verified_at: null,
      avatar: null,
      bio: '',
      is_admin: 0,
      is_banned: 1,
      avatar_frame: 'none',
      avatar_overlay: 'none',
      equipped_title: null,
    })
    expect(await db.get(`SELECT auth_generation FROM users WHERE id = 'alice'`)).toEqual({ auth_generation: 1 })
    expect(await db.get(`SELECT user_id FROM submissions WHERE id = 1`)).toEqual({ user_id: 'alice' })
    expect(await db.get(`SELECT COUNT(*) AS count FROM sessions WHERE user_id = 'alice'`)).toEqual({ count: 0 })
    await expect(db.run(
      `UPDATE users SET password_hash = 'replacement' WHERE id = 'alice'`,
    )).rejects.toThrow(/tombstone|不可变/i)
  })

  it('never reactivates a tombstoned subject', async () => {
    const db = await openMigratedFixture()
    await transitionAccountStatus(db, { accountId: 'alice', status: 'deleted' })
    await expect(transitionAccountStatus(db, {
      accountId: 'alice',
      status: 'active',
    })).rejects.toThrow(/terminal|deleted|注销|不可恢复/i)
  })

  it('serializes concurrent transitions on the shared SQLite connection', async () => {
    const db = await openMigratedFixture()
    await expect(Promise.all([
      transitionAccountStatus(db, { accountId: 'alice', status: 'suspended' }),
      transitionAccountStatus(db, { accountId: 'alice', status: 'suspended' }),
    ])).resolves.toHaveLength(2)
    expect(await db.get(`SELECT account_status FROM users WHERE id = 'alice'`)).toEqual({
      account_status: 'suspended',
    })
    expect(await db.get(`SELECT auth_generation FROM users WHERE id = 'alice'`)).toEqual({ auth_generation: 1 })
    expect(await db.get(`SELECT COUNT(*) AS count FROM identity_outbox WHERE subject = ?`, subjects[0])).toEqual({ count: 1 })
  })

  it('rolls back status, generation and session revocation if outbox persistence fails', async () => {
    const db = await openMigratedFixture()
    await db.exec(`
      CREATE TRIGGER fixture_outbox_insert_failure
      BEFORE INSERT ON identity_outbox
      BEGIN
        SELECT RAISE(ABORT, 'fixture outbox persistence failed');
      END;
    `)

    await expect(transitionAccountStatus(db, {
      accountId: 'alice',
      status: 'suspended',
    })).rejects.toThrow(/outbox persistence failed/i)

    expect(await db.get(
      `SELECT account_status, is_banned, auth_generation FROM users WHERE id = 'alice'`,
    )).toEqual({ account_status: 'active', is_banned: 0, auth_generation: 0 })
    expect(await db.get(`SELECT COUNT(*) AS count FROM sessions WHERE user_id = 'alice'`)).toEqual({ count: 1 })
  })

  it('queues login-session and consent revocation for every known Hydra client', async () => {
    const db = await openMigratedFixture()
    const timestamp = '2026-08-30T12:00:00.000Z'
    for (const [clientId, sid] of [
      ['jieya-server-local', 'sid-local-1'],
      ['jieya-server-local', 'sid-local-2'],
      ['future-client', 'sid-future-1'],
    ]) {
      await db.run(
        `INSERT INTO oidc_login_sessions
           (account_subject, client_id, sid, auth_generation, status,
            created_at, updated_at, expires_at)
         VALUES (?, ?, ?, 0, 'active', ?, ?, ?)`,
        subjects[0],
        clientId,
        sid,
        timestamp,
        timestamp,
        '2026-09-29T12:00:00.000Z',
      )
    }

    await transitionAccountStatus(db, {
      accountId: 'alice',
      status: 'suspended',
      now: () => timestamp,
    })

    expect(await db.all(
      `SELECT event_type, client_id, sid FROM identity_outbox
       WHERE subject = ? ORDER BY event_type, client_id, sid`,
      subjects[0],
    )).toEqual([
      { event_type: 'account.suspended', client_id: null, sid: null },
      { event_type: 'oidc.revoke_consent', client_id: 'future-client', sid: null },
      { event_type: 'oidc.revoke_consent', client_id: 'jieya-server-local', sid: null },
      { event_type: 'oidc.revoke_session', client_id: 'future-client', sid: 'sid-future-1' },
      { event_type: 'oidc.revoke_session', client_id: 'jieya-server-local', sid: 'sid-local-1' },
      { event_type: 'oidc.revoke_session', client_id: 'jieya-server-local', sid: 'sid-local-2' },
    ])
  })

  it('serializes lifecycle changes with the outbox worker on one SQLite connection', async () => {
    const db = await openMigratedFixture()
    let releaseValidation
    let signalValidation
    const validationEntered = new Promise((resolve) => { signalValidation = resolve })
    const validationRelease = new Promise((resolve) => { releaseValidation = resolve })
    const transition = transitionAccountStatus(db, {
      accountId: 'alice',
      status: 'suspended',
      validate: async () => {
        signalValidation()
        await validationRelease
      },
    })
    await validationEntered
    const outbox = processIdentityOutboxOnce(db, {
      revokeLoginSession: async () => undefined,
      revokeConsentSessions: async () => undefined,
    })
    releaseValidation()

    await expect(Promise.all([transition, outbox])).resolves.toHaveLength(2)
    expect(await db.get(
      `SELECT account_status, auth_generation FROM users WHERE id = 'alice'`,
    )).toEqual({ account_status: 'suspended', auth_generation: 1 })
    expect(await db.get(
      `SELECT status FROM identity_outbox WHERE subject = ?`,
      subjects[0],
    )).toEqual({ status: 'completed' })
  })

  it('changes a password while atomically advancing generation and revoking every session', async () => {
    const db = await openMigratedFixture()

    await changeAccountPassword(db, {
      accountId: 'alice',
      passwordHash: 'new-fixture-password-hash',
      now: () => '2026-08-30T12:00:00.000Z',
    })

    expect(await db.get(
      `SELECT password_hash, auth_generation FROM users WHERE id = 'alice'`,
    )).toEqual({ password_hash: 'new-fixture-password-hash', auth_generation: 1 })
    expect(await db.get(`SELECT COUNT(*) AS count FROM sessions WHERE user_id = 'alice'`)).toEqual({ count: 0 })
    expect(await db.get(
      `SELECT event_type, status FROM identity_outbox WHERE subject = ?`,
      subjects[0],
    )).toEqual({ event_type: 'account.password_changed', status: 'pending' })
  })

  it('rolls back a password change when its durable revocation event cannot be stored', async () => {
    const db = await openMigratedFixture()
    await db.exec(`
      CREATE TRIGGER fixture_password_outbox_failure
      BEFORE INSERT ON identity_outbox
      BEGIN
        SELECT RAISE(ABORT, 'fixture password outbox failed');
      END;
    `)

    await expect(changeAccountPassword(db, {
      accountId: 'alice',
      passwordHash: 'must-not-persist',
    })).rejects.toThrow(/password outbox failed/i)

    expect(await db.get(
      `SELECT password_hash, auth_generation FROM users WHERE id = 'alice'`,
    )).toEqual({ password_hash: 'fixture-hash-a', auth_generation: 0 })
    expect(await db.get(`SELECT COUNT(*) AS count FROM sessions WHERE user_id = 'alice'`)).toEqual({ count: 1 })
  })
})
