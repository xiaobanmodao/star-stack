import { createHash } from 'node:crypto'
import { getDb } from '../db.js'
import { getAuthToken, getUserByToken } from '../middleware/auth.js'
import { serializeUser } from '../utils/userHelpers.js'
import {
  compressAvatarDataUrl,
  getPublicAvatarUrl,
  parseStoredAvatar,
} from '../utils/avatar.js'

const MAX_USER_ID_LENGTH = 64

export const getUserAvatar = async (req, res) => {
  const userId = typeof req.params?.id === 'string' ? req.params.id.trim() : ''
  if (!userId || userId.length > MAX_USER_ID_LENGTH) {
    return res.status(404).end()
  }

  const db = await getDb()
  const row = await db.get(`SELECT avatar, avatar_revision FROM users WHERE id = ?`, userId)
  const avatar = parseStoredAvatar(row?.avatar)
  if (!avatar) return res.status(404).end()

  const etag = `"${createHash('sha256').update(avatar.buffer).digest('base64url')}"`
  const requestedRevision = typeof req.query?.v === 'string' ? req.query.v : null
  const immutableRevision = requestedRevision === String(row.avatar_revision)
  res.setHeader(
    'Cache-Control',
    immutableRevision
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=0, must-revalidate',
  )
  res.setHeader('ETag', etag)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (req.headers['if-none-match'] === etag) return res.status(304).end()

  res.setHeader('Content-Type', avatar.contentType)
  res.setHeader('Content-Length', String(avatar.buffer.length))
  return res.send(avatar.buffer)
}

export const updateAvatar = async (req, res) => {
  const token = getAuthToken(req)
  if (!token) return res.status(401).json({ message: '未登录' })

  const { avatar } = req.body || {}
  if (typeof avatar !== 'string' || !avatar) {
    return res.status(400).json({ message: '请提供头像数据' })
  }

  let compressedAvatar
  try {
    compressedAvatar = await compressAvatarDataUrl(avatar)
  } catch (error) {
    return res.status(400).json({
      message: error instanceof Error ? error.message : '头像压缩失败，请更换图片后重试',
    })
  }

  const db = await getDb()
  const user = await getUserByToken(db, token)
  if (!user) return res.status(401).json({ message: '登录已失效' })
  if (user.is_banned) {
    await db.run(`DELETE FROM sessions WHERE token = ?`, token)
    return res.status(403).json({ message: '账号已被封禁' })
  }

  const updated = await db.get(
    `UPDATE users
     SET avatar = ?, avatar_revision = avatar_revision + 1
     WHERE id = ?
     RETURNING avatar_revision`,
    compressedAvatar,
    user.id,
  )
  user.avatar_revision = updated.avatar_revision
  user.avatar = getPublicAvatarUrl(user.id, true, { revision: user.avatar_revision })
  const serialized = await serializeUser(db, user)
  return res.json({ user: serialized })
}
