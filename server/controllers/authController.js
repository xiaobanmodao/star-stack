import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { getDb } from '../db.js'
import { getAuthToken, getUserByToken, requireUser } from '../middleware/auth.js'
import { serializeUser } from '../utils/userHelpers.js'
import { recalculateUserRating } from '../stats.js'
import { checkLoginLock, recordLoginFailure, clearLoginFailures } from '../utils/loginGuard.js'

const createToken = () => randomBytes(24).toString('hex')

export const register = async (req, res) => {
  const { id, name, password } = req.body || {}
  if (!id || !name || !password) {
    return res.status(400).json({ message: '请填写完整信息' })
  }
  if (password.length < 6) {
    return res.status(400).json({ message: '密码至少 6 位' })
  }
  const db = await getDb()
  const existing = await db.get(`SELECT id FROM users WHERE id = ?`, id)
  if (existing) {
    return res.status(409).json({ message: '该 ID 已被注册' })
  }
  const passwordHash = await bcrypt.hash(password, 10)
  const createdAt = new Date().toISOString()
  await db.run(
    `INSERT INTO users (id, name, password_hash, is_admin, is_banned, created_at)
     VALUES (?, ?, ?, 0, 0, ?)`,
    id, name, passwordHash, createdAt
  )
  const token = createToken()
  await db.run(
    `INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)`,
    token, id, new Date().toISOString()
  )
  return res.json({
    token,
    user: { id, name, isAdmin: false, isBanned: false, avatar: null },
  })
}

export const login = async (req, res) => {
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown'
  if (checkLoginLock(clientIp)) {
    return res.status(429).json({ message: '尝试次数过多，请 10 分钟后再试' })
  }
  const { id, password } = req.body || {}
  if (!id || !password) {
    return res.status(400).json({ message: '请输入 ID 与密码' })
  }
  if (password.length < 6) {
    return res.status(400).json({ message: '密码至少 6 位' })
  }
  const db = await getDb()
  const user = await db.get(
    `SELECT id, name, password_hash, is_admin, is_banned, avatar, onboarded_at FROM users WHERE id = ?`,
    id
  )
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    recordLoginFailure(clientIp)
    return res.status(401).json({ message: 'ID 或密码错误' })
  }
  clearLoginFailures(clientIp)
  if (user.is_banned) {
    return res.status(403).json({ message: '账号已被封禁' })
  }
  await recalculateUserRating(db, user.id)
  const token = createToken()
  await db.run(
    `INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)`,
    token, user.id, new Date().toISOString()
  )
  const serialized = await serializeUser(db, user)
  return res.json({ token, user: serialized })
}

export const getMe = async (req, res) => {
  const token = getAuthToken(req)
  if (!token) {
    return res.status(401).json({ message: '未登录' })
  }
  const db = await getDb()
  const user = await getUserByToken(db, token)
  if (!user) {
    return res.status(401).json({ message: '登录已失效' })
  }
  if (user.is_banned) {
    await db.run(`DELETE FROM sessions WHERE token = ?`, token)
    return res.status(403).json({ message: '账号已被封禁' })
  }
  const serialized = await serializeUser(db, user)
  return res.json({ user: serialized })
}

export const logout = async (req, res) => {
  const token = getAuthToken(req)
  if (!token) {
    return res.status(204).end()
  }
  const db = await getDb()
  await db.run(`DELETE FROM sessions WHERE token = ?`, token)
  return res.status(204).end()
}

export const updateName = async (req, res) => {
  const token = getAuthToken(req)
  if (!token) {
    return res.status(401).json({ message: '未登录' })
  }
  const { name } = req.body || {}
  if (!name || !name.trim()) {
    return res.status(400).json({ message: '名称不能为空' })
  }
  const db = await getDb()
  const user = await getUserByToken(db, token)
  if (!user) {
    return res.status(401).json({ message: '登录已失效' })
  }
  if (user.is_banned) {
    await db.run(`DELETE FROM sessions WHERE token = ?`, token)
    return res.status(403).json({ message: '账号已被封禁' })
  }
  await db.run(`UPDATE users SET name = ? WHERE id = ?`, name.trim(), user.id)
  user.name = name.trim()
  const serialized = await serializeUser(db, user)
  return res.json({ user: serialized })
}

export const updatePassword = async (req, res) => {
  const token = getAuthToken(req)
  if (!token) {
    return res.status(401).json({ message: '未登录' })
  }
  const { oldPassword, newPassword } = req.body || {}
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ message: '请填写完整信息' })
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ message: '密码至少 6 位' })
  }
  const db = await getDb()
  const user = await getUserByToken(db, token)
  if (!user) {
    return res.status(401).json({ message: '登录已失效' })
  }
  if (user.is_banned) {
    await db.run(`DELETE FROM sessions WHERE token = ?`, token)
    return res.status(403).json({ message: '账号已被封禁' })
  }
  if (!(await bcrypt.compare(oldPassword, user.password_hash))) {
    return res.status(400).json({ message: '旧密码错误' })
  }
  const passwordHash = await bcrypt.hash(newPassword, 10)
  await db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, passwordHash, user.id)
  return res.json({ ok: true })
}

export const updateAvatar = async (req, res) => {
  const token = getAuthToken(req)
  if (!token) {
    return res.status(401).json({ message: '未登录' })
  }
  const { avatar } = req.body || {}
  if (!avatar) {
    return res.status(400).json({ message: '请提供头像数据' })
  }
  // MIME 白名单：仅允许常见位图格式，拒绝 svg（可携带脚本）
  if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(avatar)) {
    return res.status(400).json({ message: '仅支持 PNG/JPG/WebP/GIF 图片' })
  }
  if (avatar.length > 3000000) {
    return res.status(400).json({ message: '图片过大，请选择小于 2MB 的图片' })
  }
  const db = await getDb()
  const user = await getUserByToken(db, token)
  if (!user) {
    return res.status(401).json({ message: '登录已失效' })
  }
  if (user.is_banned) {
    await db.run(`DELETE FROM sessions WHERE token = ?`, token)
    return res.status(403).json({ message: '账号已被封禁' })
  }
  await db.run(`UPDATE users SET avatar = ? WHERE id = ?`, avatar, user.id)
  user.avatar = avatar
  const serialized = await serializeUser(db, user)
  return res.json({ user: serialized })
}
