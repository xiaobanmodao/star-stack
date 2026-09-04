import {
  MAX_AVATAR_BYTES,
  compressAvatarDataUrl,
  parseStoredAvatar,
} from '../utils/avatar.js'

export const prepareAvatarCompressionPlan = async (db) => {
  const rows = await db.all(
    `SELECT id, avatar
     FROM users
     WHERE avatar IS NOT NULL AND avatar <> ''
     ORDER BY id ASC`,
  )
  const replacements = []
  let alreadyWithinLimit = 0
  let skipped = 0

  for (const row of rows) {
    const parsed = parseStoredAvatar(row.avatar)
    if (!parsed) {
      skipped += 1
      continue
    }
    if (parsed.buffer.length < MAX_AVATAR_BYTES) {
      alreadyWithinLimit += 1
      continue
    }

    let compressedAvatar
    try {
      compressedAvatar = await compressAvatarDataUrl(row.avatar)
    } catch (error) {
      throw new Error(
        `头像 ${row.id} 压缩失败：${error instanceof Error ? error.message : '未知错误'}`,
      )
    }
    replacements.push({
      userId: row.id,
      originalAvatar: row.avatar,
      compressedAvatar,
      originalBytes: parsed.buffer.length,
      compressedBytes: parseStoredAvatar(compressedAvatar).buffer.length,
    })
  }

  return {
    scanned: rows.length,
    alreadyWithinLimit,
    skipped,
    replacements,
  }
}

export const applyAvatarCompressionPlan = async (db, plan) => {
  let updated = 0
  let conflicts = 0
  await db.exec('BEGIN IMMEDIATE')
  try {
    for (const replacement of plan.replacements) {
      const result = await db.run(
        `UPDATE users
         SET avatar = ?, avatar_revision = avatar_revision + 1
         WHERE id = ? AND avatar = ?`,
        replacement.compressedAvatar,
        replacement.userId,
        replacement.originalAvatar,
      )
      if (result.changes === 1) updated += 1
      else conflicts += 1
    }
    await db.exec('COMMIT')
  } catch (error) {
    await db.exec('ROLLBACK')
    throw error
  }
  return { updated, conflicts }
}
