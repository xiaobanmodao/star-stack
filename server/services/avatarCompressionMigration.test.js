import { describe, expect, it } from 'vitest'
import { Transformer } from '@napi-rs/image'
import { open } from 'sqlite'
import sqlite3 from 'sqlite3'
import { MAX_AVATAR_BYTES, parseStoredAvatar } from '../utils/avatar.js'
import {
  applyAvatarCompressionPlan,
  prepareAvatarCompressionPlan,
} from './avatarCompressionMigration.js'

const createDb = async () => {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database })
  await db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      avatar TEXT,
      avatar_revision INTEGER NOT NULL DEFAULT 0,
      avatar_frame TEXT NOT NULL DEFAULT 'none',
      avatar_overlay TEXT NOT NULL DEFAULT 'none'
    );
  `)
  return db
}

const createLargeAvatar = async () => {
  const pixels = Buffer.alloc(600 * 600 * 3)
  let state = 0x87654321
  for (let index = 0; index < pixels.length; index += 1) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0
    pixels[index] = state >>> 24
  }
  const rgba = Buffer.alloc(600 * 600 * 4)
  for (let sourceIndex = 0, targetIndex = 0; sourceIndex < pixels.length; sourceIndex += 3, targetIndex += 4) {
    rgba[targetIndex] = pixels[sourceIndex]
    rgba[targetIndex + 1] = pixels[sourceIndex + 1]
    rgba[targetIndex + 2] = pixels[sourceIndex + 2]
    rgba[targetIndex + 3] = 255
  }
  const source = await Transformer.fromRgbaPixels(rgba, 600, 600).jpeg(96)
  return `data:image/jpeg;base64,${source.toString('base64')}`
}

describe('avatar compression migration', () => {
  it('prepares all oversized avatars before applying an atomic CAS update', async () => {
    const db = await createDb()
    const largeAvatar = await createLargeAvatar()
    await db.run(
      `INSERT INTO users (id, avatar, avatar_revision, avatar_frame, avatar_overlay)
       VALUES (?, ?, 7, 'supernova', 'perfect-solve')`,
      'alice',
      largeAvatar,
    )

    const plan = await prepareAvatarCompressionPlan(db)
    expect(plan.scanned).toBe(1)
    expect(plan.replacements).toHaveLength(1)
    expect(parseStoredAvatar(plan.replacements[0].compressedAvatar).buffer.length)
      .toBeLessThan(MAX_AVATAR_BYTES)

    const result = await applyAvatarCompressionPlan(db, plan)
    const stored = await db.get(
      `SELECT avatar, avatar_revision, avatar_frame, avatar_overlay FROM users WHERE id = ?`,
      'alice',
    )

    expect(result).toEqual({ updated: 1, conflicts: 0 })
    expect(parseStoredAvatar(stored.avatar).buffer.length).toBeLessThan(MAX_AVATAR_BYTES)
    expect(stored.avatar_revision).toBe(8)
    expect(stored.avatar_frame).toBe('supernova')
    expect(stored.avatar_overlay).toBe('perfect-solve')
    await db.close()
  })

  it('skips already-small and external avatars and never overwrites a concurrent upload', async () => {
    const db = await createDb()
    const largeAvatar = await createLargeAvatar()
    const smallAvatar = `data:image/png;base64,${Buffer.from('small').toString('base64')}`
    await db.run(`INSERT INTO users (id, avatar) VALUES (?, ?)`, 'large', largeAvatar)
    await db.run(`INSERT INTO users (id, avatar) VALUES (?, ?)`, 'small', smallAvatar)
    await db.run(`INSERT INTO users (id, avatar) VALUES (?, ?)`, 'external', 'https://example.test/a.png')

    const plan = await prepareAvatarCompressionPlan(db)
    expect(plan).toMatchObject({ scanned: 3, alreadyWithinLimit: 1, skipped: 1 })
    expect(plan.replacements).toHaveLength(1)

    await db.run(`UPDATE users SET avatar = ?, avatar_revision = 9 WHERE id = ?`, smallAvatar, 'large')
    const result = await applyAvatarCompressionPlan(db, plan)
    const stored = await db.get(`SELECT avatar, avatar_revision FROM users WHERE id = ?`, 'large')

    expect(result).toEqual({ updated: 0, conflicts: 1 })
    expect(stored).toEqual({ avatar: smallAvatar, avatar_revision: 9 })
    await db.close()
  })
})
