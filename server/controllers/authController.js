import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { getDb } from '../db.js'
import { getAuthToken, getUserByToken, requireUser } from '../middleware/auth.js'
import { serializeUser } from '../utils/userHelpers.js'
import { recalculateUserRating } from '../stats.js'
import { checkLoginLock, getLoginFailureCount, recordLoginFailure, clearLoginFailures } from '../utils/loginGuard.js'
import { verifyTurnstile } from '../utils/turnstile.js'
import { sendRegistrationCode } from '../utils/email.js'
import {
  EMAIL_CODE_MAX_ATTEMPTS,
  EMAIL_CODE_RESEND_MS,
  EMAIL_CODE_TTL_MS,
  createEmailCode,
  hashEmailCode,
  isExpired,
  isValidEmail,
  normalizeEmail,
} from '../utils/emailVerification.js'

const createToken = () => randomBytes(24).toString('hex')
const emailCodeIpLimits = new Map()
const EMAIL_CODE_IP_WINDOW_MS = 60 * 60 * 1000
const EMAIL_CODE_IP_MAX_REQUESTS = 10

const getClientIp = (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim()
  || req.socket?.remoteAddress
  || 'unknown'

const getEmailCodeIpRetryAfter = (ip) => {
  const now = Date.now()
  const current = emailCodeIpLimits.get(ip)
  if (!current || now - current.startedAt >= EMAIL_CODE_IP_WINDOW_MS) {
    emailCodeIpLimits.set(ip, { startedAt: now, count: 1 })
    return 0
  }
  if (current.count >= EMAIL_CODE_IP_MAX_REQUESTS) {
    return Math.ceil((EMAIL_CODE_IP_WINDOW_MS - (now - current.startedAt)) / 1000)
  }
  current.count += 1
  return 0
}

export const sendRegisterEmailCode = async (req, res) => {
  const email = normalizeEmail(req.body?.email)
  if (!isValidEmail(email)) {
    return res.status(400).json({ message: '请输入有效的邮箱地址' })
  }
  const ipRetryAfter = getEmailCodeIpRetryAfter(getClientIp(req))
  if (ipRetryAfter > 0) {
    return res.status(429).json({
      message: '发送过于频繁，请稍后再试',
      retryAfter: ipRetryAfter,
    })
  }

  const db = await getDb()
  const existingUser = await db.get(`SELECT id FROM users WHERE email = ?`, email)
  if (existingUser) {
    return res.status(409).json({ message: '该邮箱已被注册' })
  }

  const existingCode = await db.get(
    `SELECT last_sent_at FROM email_verifications WHERE email = ?`,
    email
  )
  const lastSentAt = Date.parse(existingCode?.last_sent_at || '')
  const retryAfterMs = Number.isFinite(lastSentAt)
    ? EMAIL_CODE_RESEND_MS - (Date.now() - lastSentAt)
    : 0
  if (retryAfterMs > 0) {
    return res.status(429).json({
      message: `请 ${Math.ceil(retryAfterMs / 1000)} 秒后再试`,
      retryAfter: Math.ceil(retryAfterMs / 1000),
    })
  }

  const code = createEmailCode()
  try {
    await sendRegistrationCode({ email, code })
  } catch (error) {
    console.error('[email] 注册验证码发送失败:', error?.message || error)
    return res.status(503).json({ message: '邮件服务暂不可用，请稍后重试' })
  }

  const now = new Date()
  const createdAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + EMAIL_CODE_TTL_MS).toISOString()
  await db.run(
    `INSERT INTO email_verifications (email, code_hash, expires_at, attempts, last_sent_at, created_at)
     VALUES (?, ?, ?, 0, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       code_hash = excluded.code_hash,
       expires_at = excluded.expires_at,
       attempts = 0,
       last_sent_at = excluded.last_sent_at,
       created_at = excluded.created_at`,
    email,
    hashEmailCode(code),
    expiresAt,
    createdAt,
    createdAt
  )
  return res.json({ success: true, message: '验证码已发送，请检查邮箱' })
}

export const register = async (req, res) => {
  const { id, name, password, emailCode } = req.body || {}
  const email = normalizeEmail(req.body?.email)
  if (!id || !name || !password || !email || !emailCode) {
    return res.status(400).json({ message: '请填写完整信息' })
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ message: '请输入有效的邮箱地址' })
  }
  if (!/^\d{6}$/.test(String(emailCode))) {
    return res.status(400).json({ message: '请输入 6 位邮箱验证码' })
  }
  if (password.length < 6) {
    return res.status(400).json({ message: '密码至少 6 位' })
  }
  const db = await getDb()
  const existing = await db.get(`SELECT id FROM users WHERE id = ?`, id)
  if (existing) {
    return res.status(409).json({ message: '该 ID 已被注册' })
  }
  const existingEmail = await db.get(`SELECT id FROM users WHERE email = ?`, email)
  if (existingEmail) {
    return res.status(409).json({ message: '该邮箱已被注册' })
  }

  const verification = await db.get(
    `SELECT email, code_hash, expires_at, attempts FROM email_verifications WHERE email = ?`,
    email
  )
  if (!verification) {
    return res.status(400).json({ message: '请先获取邮箱验证码' })
  }
  if (isExpired(verification.expires_at)) {
    await db.run(`DELETE FROM email_verifications WHERE email = ?`, email)
    return res.status(400).json({ message: '邮箱验证码已过期，请重新获取' })
  }
  if (verification.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
    await db.run(`DELETE FROM email_verifications WHERE email = ?`, email)
    return res.status(400).json({ message: '验证码错误次数过多，请重新获取' })
  }
  if (hashEmailCode(String(emailCode)) !== verification.code_hash) {
    const attempts = verification.attempts + 1
    if (attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
      await db.run(`DELETE FROM email_verifications WHERE email = ?`, email)
    } else {
      await db.run(`UPDATE email_verifications SET attempts = ? WHERE email = ?`, attempts, email)
    }
    return res.status(400).json({ message: '邮箱验证码错误' })
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const createdAt = new Date().toISOString()
  await db.run(
    `INSERT INTO users (id, name, password_hash, email, email_verified_at, is_admin, is_banned, created_at)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?)`,
    id, name, passwordHash, email, createdAt, createdAt
  )
  await db.run(`DELETE FROM email_verifications WHERE email = ?`, email)
  const token = createToken()
  await db.run(
    `INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)`,
    token, id, new Date().toISOString()
  )
  return res.json({
    token,
    user: { id, name, email, isAdmin: false, isBanned: false, avatar: null },
  })
}

export const login = async (req, res) => {
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown'
  if (checkLoginLock(clientIp)) {
    return res.status(429).json({ message: '尝试次数过多，请 10 分钟后再试' })
  }
  const { id, password, turnstileToken } = req.body || {}
  if (!id || !password) {
    return res.status(400).json({ message: '请输入 ID 与密码' })
  }
  if (password.length < 6) {
    return res.status(400).json({ message: '密码至少 6 位' })
  }
  if (getLoginFailureCount(clientIp) >= 2) {
    const captcha = await verifyTurnstile({ token: turnstileToken, req, action: 'login' })
    if (!captcha.ok) {
      return res.status(403).json({ message: '请完成安全验证后再登录', captchaRequired: true })
    }
  }
  const db = await getDb()
  const user = await db.get(
    `SELECT id, name, password_hash, email, is_admin, is_banned, avatar, onboarded_at FROM users WHERE id = ?`,
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
