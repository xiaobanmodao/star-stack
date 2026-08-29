import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sqlite3 from 'sqlite3'
import { open } from 'sqlite'
import { ensureAccountIdentitySchema } from './accountIdentityMigration.js'
import {
  ensureOidcIdentitySchema,
  verifyOidcIdentitySchema,
} from './oidcIdentityMigration.js'

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/legacy-account-identity.sql',
)
const resources = []
const subjects = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
]

const openFixture = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'starstack-oidc-migration-'))
  const db = await open({ filename: path.join(directory, 'fixture.sqlite'), driver: sqlite3.Database })
  await db.exec(await readFile(fixturePath, 'utf8'))
  const generated = [...subjects]
  await ensureAccountIdentitySchema(db, { generateSubject: () => generated.shift() })
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

describe('OIDC identity schema migration', () => {
  it('adds a zero generation and the durable identity tables without changing legacy IDs', async () => {
    const db = await openFixture()

    await ensureOidcIdentitySchema(db)

    expect(await db.all(`SELECT id, auth_generation FROM users ORDER BY id`)).toEqual([
      { id: 'alice', auth_generation: 0 },
      { id: 'banned', auth_generation: 0 },
    ])
    expect(await db.get(`SELECT user_id FROM submissions WHERE id = 1`)).toEqual({ user_id: 'alice' })
    await expect(verifyOidcIdentitySchema(db)).resolves.toMatchObject({
      users: 2,
      accountCenterSessions: 0,
      loginSessions: 0,
      outboxEvents: 0,
      logoutTransactions: 0,
    })

    const indexes = new Set((await db.all(
      `SELECT name FROM sqlite_master WHERE type = 'index'`,
    )).map((row) => row.name))
    for (const name of [
      'idx_account_center_sessions_subject',
      'idx_oidc_login_sessions_subject_status',
      'idx_oidc_login_sessions_status_updated',
      'idx_oidc_login_sessions_status_expires',
      'idx_identity_outbox_due',
      'idx_oidc_logout_transactions_expires',
    ]) expect(indexes.has(name)).toBe(true)
  })

  it('is idempotent across a database restart and preserves generations and durable rows', async () => {
    const db = await openFixture()
    await ensureOidcIdentitySchema(db)
    await db.run(`UPDATE users SET auth_generation = 4 WHERE id = 'alice'`)
    await db.run(
      `INSERT INTO identity_outbox
         (id, event_type, subject, client_id, sid, status, attempts, next_attempt_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
      'event-1', 'oidc.revoke_subject', subjects[0], 'jieya-server-local', 'sid-1',
      '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z',
    )
    await db.close()
    resources[0].db = await open({
      filename: path.join(resources[0].directory, 'fixture.sqlite'),
      driver: sqlite3.Database,
    })

    await ensureOidcIdentitySchema(resources[0].db)

    expect(await resources[0].db.get(
      `SELECT auth_generation FROM users WHERE id = 'alice'`,
    )).toEqual({ auth_generation: 4 })
    expect(await resources[0].db.get(`SELECT COUNT(*) AS count FROM identity_outbox`)).toEqual({ count: 1 })
  })

  it('adds security columns introduced after an earlier Phase 2 schema without replacing data', async () => {
    const db = await openFixture()
    await ensureOidcIdentitySchema(db)
    await db.run(
      `INSERT INTO oidc_login_sessions
         (account_subject, client_id, sid, auth_generation, status,
          created_at, updated_at, expires_at)
       VALUES (?, 'jieya-server-local', 'legacy-sid', 0, 'active', ?, ?, ?)`,
      subjects[0],
      '2026-08-30T00:00:00.000Z',
      '2026-08-30T00:00:00.000Z',
      '2026-09-29T00:00:00.000Z',
    )
    await db.exec(`ALTER TABLE oidc_interactions DROP COLUMN csrf_hash`)
    await db.exec(`ALTER TABLE oidc_logout_transactions DROP COLUMN browser_csrf_hash`)
    await db.exec(`DROP INDEX idx_oidc_login_sessions_status_expires`)
    await db.exec(`ALTER TABLE oidc_login_sessions DROP COLUMN expires_at`)

    await ensureOidcIdentitySchema(db)

    const interactionColumns = new Set((await db.all(
      `PRAGMA table_info(oidc_interactions)`,
    )).map((column) => column.name))
    const logoutColumns = new Set((await db.all(
      `PRAGMA table_info(oidc_logout_transactions)`,
    )).map((column) => column.name))
    const loginSessionColumns = new Set((await db.all(
      `PRAGMA table_info(oidc_login_sessions)`,
    )).map((column) => column.name))
    expect(interactionColumns.has('csrf_hash')).toBe(true)
    expect(logoutColumns.has('browser_csrf_hash')).toBe(true)
    expect(loginSessionColumns.has('expires_at')).toBe(true)
    expect(await db.get(
      `SELECT expires_at FROM oidc_login_sessions WHERE sid = 'legacy-sid'`,
    )).toEqual({ expires_at: '2026-09-29T00:00:00.000Z' })
  })

  it('rejects null, negative and decreasing generations', async () => {
    const db = await openFixture()
    await ensureOidcIdentitySchema(db)

    await expect(db.run(
      `UPDATE users SET auth_generation = -1 WHERE id = 'alice'`,
    )).rejects.toThrow(/generation|世代|non-negative/i)
    await db.run(`UPDATE users SET auth_generation = 2 WHERE id = 'alice'`)
    await expect(db.run(
      `UPDATE users SET auth_generation = 1 WHERE id = 'alice'`,
    )).rejects.toThrow(/generation|世代|monotonic/i)
  })

  it('fails closed and rolls back when a partial legacy generation is invalid', async () => {
    const db = await openFixture()
    await db.exec(`ALTER TABLE users ADD COLUMN auth_generation INTEGER`)
    await db.run(`UPDATE users SET auth_generation = 0 WHERE id = 'alice'`)

    await expect(ensureOidcIdentitySchema(db)).rejects.toThrow(/auth_generation|partial|null|空值/i)

    const tables = new Set((await db.all(
      `SELECT name FROM sqlite_master WHERE type = 'table'`,
    )).map((row) => row.name))
    expect(tables.has('identity_outbox')).toBe(false)
    expect(await db.get(`SELECT auth_generation FROM users WHERE id = 'banned'`)).toEqual({ auth_generation: null })
  })

  it('fails closed on an incompatible pre-existing identity table', async () => {
    const db = await openFixture()
    await db.exec(`CREATE TABLE identity_outbox (id TEXT PRIMARY KEY)`)

    await expect(ensureOidcIdentitySchema(db)).rejects.toThrow(/identity_outbox|schema|column|字段/i)

    const userColumns = await db.all(`PRAGMA table_info(users)`)
    expect(userColumns.some((column) => column.name === 'auth_generation')).toBe(false)
  })
})
