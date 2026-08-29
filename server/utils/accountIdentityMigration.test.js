import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sqlite3 from 'sqlite3'
import { open } from 'sqlite'
import {
  ensureAccountIdentitySchema,
  verifyAccountIdentityData,
} from './accountIdentityMigration.js'

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
  const directory = await mkdtemp(path.join(tmpdir(), 'starstack-account-migration-'))
  const filename = path.join(directory, 'fixture.sqlite')
  const db = await open({ filename, driver: sqlite3.Database })
  await db.exec(await readFile(fixturePath, 'utf8'))
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

describe('account identity migration', () => {
  it('backfills fixed UUID subjects without changing legacy IDs or OJ foreign keys', async () => {
    const db = await openFixture()
    const generated = [...subjects]

    await ensureAccountIdentitySchema(db, { generateSubject: () => generated.shift() })

    expect(await db.all(
      `SELECT id, account_subject, account_status, account_tombstoned_at
       FROM users ORDER BY id`,
    )).toEqual([
      {
        id: 'alice',
        account_subject: subjects[0],
        account_status: 'active',
        account_tombstoned_at: null,
      },
      {
        id: 'banned',
        account_subject: subjects[1],
        account_status: 'suspended',
        account_tombstoned_at: null,
      },
    ])
    expect(await db.get(`SELECT user_id FROM submissions WHERE id = 1`)).toEqual({ user_id: 'alice' })
    await expect(verifyAccountIdentityData(db)).resolves.toMatchObject({ users: 2, active: 1, suspended: 1 })
  })

  it('is idempotent and never regenerates an existing subject after restart', async () => {
    const db = await openFixture()
    const generated = [...subjects]
    await ensureAccountIdentitySchema(db, { generateSubject: () => generated.shift() })
    const before = await db.all(`SELECT id, account_subject FROM users ORDER BY id`)
    await db.close()
    resources[0].db = await open({ filename: path.join(resources[0].directory, 'fixture.sqlite'), driver: sqlite3.Database })

    await ensureAccountIdentitySchema(resources[0].db, {
      generateSubject: () => { throw new Error('subject must not be regenerated') },
    })

    expect(await resources[0].db.all(`SELECT id, account_subject FROM users ORDER BY id`)).toEqual(before)
  })

  it('rolls back the whole first migration when generated subjects conflict', async () => {
    const db = await openFixture()
    await expect(ensureAccountIdentitySchema(db, {
      generateSubject: () => subjects[0],
    })).rejects.toThrow(/duplicate|unique|冲突/i)

    const columns = await db.all(`PRAGMA table_info(users)`)
    expect(columns.some((column) => column.name === 'account_subject')).toBe(false)
    expect(await db.get(`SELECT user_id FROM submissions WHERE id = 1`)).toEqual({ user_id: 'alice' })
  })

  it('fails closed on an empty or otherwise partial pre-existing migration', async () => {
    const db = await openFixture()
    await db.exec(`ALTER TABLE users ADD COLUMN account_subject TEXT`)
    await db.run(`UPDATE users SET account_subject = ? WHERE id = 'alice'`, subjects[0])

    await expect(ensureAccountIdentitySchema(db)).rejects.toThrow(/partial|empty|空值|部分迁移/i)

    expect(await db.get(`SELECT account_subject FROM users WHERE id = 'banned'`)).toEqual({ account_subject: null })
    const index = await db.get(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_users_account_subject_unique'`,
    )
    expect(index).toBeUndefined()
  })

  it('fails closed on invalid or duplicate persisted subjects', async () => {
    for (const values of [
      ['not-a-uuid', subjects[1]],
      [subjects[0], subjects[0]],
    ]) {
      const db = await openFixture()
      await db.exec(`ALTER TABLE users ADD COLUMN account_subject TEXT`)
      await db.run(`UPDATE users SET account_subject = ? WHERE id = 'alice'`, values[0])
      await db.run(`UPDATE users SET account_subject = ? WHERE id = 'banned'`, values[1])
      await expect(ensureAccountIdentitySchema(db)).rejects.toThrow(/invalid|duplicate|UUID|冲突|非法/i)
      await db.close()
      const resource = resources.pop()
      await rm(resource.directory, { recursive: true, force: true })
    }
  })

  it('enforces immutable subjects, required values and tombstone-only deletion', async () => {
    const db = await openFixture()
    const generated = [...subjects]
    await ensureAccountIdentitySchema(db, { generateSubject: () => generated.shift() })

    await expect(db.run(
      `UPDATE users SET account_subject = ? WHERE id = 'alice'`,
      '33333333-3333-4333-8333-333333333333',
    )).rejects.toThrow(/immutable|不可变/i)
    await expect(db.run(`DELETE FROM users WHERE id = 'alice'`)).rejects.toThrow(/tombstone|物理删除/i)
    await expect(db.run(
      `INSERT INTO users (id, name, password_hash, created_at) VALUES ('missing-sub', 'Missing', 'x', ?)`,
      new Date().toISOString(),
    )).rejects.toThrow(/subject|身份/i)
  })
})
