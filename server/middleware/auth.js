import { getDb } from '../db.js'

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 会话 30 天过期

export const getAuthToken = (req) => {
  const header = req.headers.authorization || ''
  if (header.startsWith('Bearer ')) return header.slice(7).trim()
  return null
}

export const getUserByToken = async (db, token) => {
  const session = await db.get(
    `SELECT token, user_id, created_at FROM sessions WHERE token = ?`,
    token
  )
  if (!session) return null
  // 会话过期：删除并拒绝
  if (session.created_at && Date.now() - new Date(session.created_at).getTime() > SESSION_MAX_AGE_MS) {
    await db.run(`DELETE FROM sessions WHERE token = ?`, token)
    return null
  }
  const user = await db.get(
    `SELECT id, name, password_hash, email, email_verified_at, is_admin, is_banned, avatar, bio, onboarded_at, created_at
     FROM users WHERE id = ?`,
    session.user_id
  )
  return user || null
}

export const requireAdmin = async (req, res) => {
  const token = getAuthToken(req)
  if (!token) {
    res.status(401).json({ message: '未登录' })
    return null
  }
  const db = await getDb()
  const user = await getUserByToken(db, token)
  if (!user || !user.is_admin) {
    res.status(403).json({ message: '无权限' })
    return null
  }
  if (user.is_banned) {
    await db.run(`DELETE FROM sessions WHERE token = ?`, token)
    res.status(403).json({ message: '账号已被封禁' })
    return null
  }
  return { db, user }
}

export const requireUser = async (req, res) => {
  const token = getAuthToken(req)
  if (!token) {
    res.status(401).json({ message: '未登录' })
    return null
  }
  const db = await getDb()
  const user = await getUserByToken(db, token)
  if (!user) {
    res.status(401).json({ message: '登录已失效' })
    return null
  }
  if (user.is_banned) {
    await db.run(`DELETE FROM sessions WHERE token = ?`, token)
    res.status(403).json({ message: '账号已被封禁' })
    return null
  }
  return { db, user }
}
