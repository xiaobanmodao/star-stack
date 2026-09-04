import { mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { open } from 'sqlite'
import sqlite3 from 'sqlite3'
import { runAvatarCompression } from './compress-avatars.js'
import { MAX_AVATAR_BYTES, parseStoredAvatar } from './utils/avatar.js'

const temporaryDirectories = []

const createFixture = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'starstack-avatar-migration-'))
  temporaryDirectories.push(directory)
  const databasePath = path.join(directory, 'starstack.sqlite')
  const db = await open({ filename: databasePath, driver: sqlite3.Database })
  await db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      avatar TEXT,
      avatar_revision INTEGER NOT NULL DEFAULT 0
    );
  `)
  const pixels = Buffer.alloc(800 * 800 * 3)
  let state = 0x31415926
  for (let index = 0; index < pixels.length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    pixels[index] = state >>> 24
  }
  const source = await sharp(pixels, {
    raw: { width: 800, height: 800, channels: 3 },
  }).jpeg({ quality: 96 }).toBuffer()
  const originalAvatar = `data:image/jpeg;base64,${source.toString('base64')}`
  await db.run(
    `INSERT INTO users (id, avatar) VALUES (?, ?)`,
    'fixture-user',
    originalAvatar,
  )
  await db.close()
  return { directory, databasePath, originalAvatar }
}

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    await rm(temporaryDirectories.pop(), { recursive: true, force: true })
  }
})

describe('avatar compression command', () => {
  it('is dry-run by default and creates a verified backup before applying', async () => {
    const fixture = await createFixture()
    const before = await readFile(fixture.databasePath)
    const dryRun = await runAvatarCompression({ databasePath: fixture.databasePath })

    expect(dryRun).toMatchObject({ mode: 'dry-run', candidates: 1, updated: 0 })
    expect(await readFile(fixture.databasePath)).toEqual(before)

    const backupPath = path.join(fixture.directory, 'backups', 'before-avatar-compression.sqlite')
    const applied = await runAvatarCompression({
      databasePath: fixture.databasePath,
      apply: true,
      backupPath,
    })
    const db = await open({ filename: fixture.databasePath, driver: sqlite3.Database })
    const stored = await db.get(`SELECT avatar, avatar_revision FROM users WHERE id = ?`, 'fixture-user')
    await db.close()

    expect(applied).toMatchObject({ mode: 'apply', candidates: 1, updated: 1, backupCreated: true })
    expect(parseStoredAvatar(stored.avatar).buffer.length).toBeLessThan(MAX_AVATAR_BYTES)
    expect(stored.avatar_revision).toBe(1)
    expect((await stat(backupPath)).mode & 0o777).toBe(0o600)
    const backupDb = await open({ filename: backupPath, driver: sqlite3.Database })
    const backupRow = await backupDb.get(`SELECT avatar, avatar_revision FROM users WHERE id = ?`, 'fixture-user')
    const backupIntegrity = await backupDb.get('PRAGMA integrity_check')
    await backupDb.close()
    expect(backupRow).toEqual({ avatar: fixture.originalAvatar, avatar_revision: 0 })
    expect(backupIntegrity.integrity_check).toBe('ok')
  })

  it('rejects a symlink database and refuses apply without a backup', async () => {
    const fixture = await createFixture()
    const linkedPath = path.join(fixture.directory, 'linked.sqlite')
    await symlink(fixture.databasePath, linkedPath)

    await expect(runAvatarCompression({ databasePath: linkedPath }))
      .rejects.toThrow('非链接的普通文件')
    await expect(runAvatarCompression({ databasePath: fixture.databasePath, apply: true }))
      .rejects.toThrow('--backup')
  })
})
