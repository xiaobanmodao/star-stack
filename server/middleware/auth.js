import { getDb } from '../db.js'

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 会话 30 天过期
export const SESSION_COOKIE_NAME = 'starstack_session'
const SESSION_MAX_AGE_SECONDS = Math.floor(SESSION_MAX_AGE_MS / 1000)

const getCookies = (req) => {
  const header = req.headers.cookie || ''
  return Object.fromEntries(header.split(';').map((part) => {
    const separator = part.indexOf('=')
    if (separator < 0) return ['', '']
    const key = part.slice(0, separator).trim()
    const rawValue = part.slice(separator + 1).trim()
    try {
      return [key, decodeURIComponent(rawValue)]
    } catch {
      return [key, rawValue]
    }
  }).filter(([key]) => key))
}

export const getSessionCookieToken = (req) => {
  const token = getCookies(req)[SESSION_COOKIE_NAME]
  return typeof token === 'string' && /^[a-f0-9]{48}$/.test(token) ? token : null
}

export const hasSessionCookie = (req) => Boolean(getSessionCookieToken(req))

const cookieFlags = () => [
  'HttpOnly',
  'Path=/',
  `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  'SameSite=Lax',
  ...(process.env.NODE_ENV === 'production' ? ['Secure'] : []),
].join('; ')

export const setSessionCookie = (res, token) => {
  if (!/^[a-f0-9]{48}$/.test(String(token || ''))) return
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; ${cookieFlags()}`)
}

export const clearSessionCookie = (res) => {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
  )
}

export const getAuthToken = (req) => {
  const header = req.headers.authorization || ''
  if (header.startsWith('Bearer ')) {
    const token = header.slice(7).trim()
    if (token && token.length <= 128) return token
  }
  return getSessionCookieToken(req)
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
    `SELECT id, name, password_hash, email, email_verified_at, is_admin, is_banned,
            account_subject, account_status, auth_generation,
            avatar, bio, onboarded_at, rating,
            avatar_frame, avatar_overlay, equipped_title, created_at
     FROM users WHERE id = ?`,
    session.user_id
  )
  return user || null
}

export const requireAdmin = async (req, res) => {
  if (req.adminAuth) return req.adminAuth
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
  if (user.is_banned || user.account_status !== 'active') {
    await db.run(`DELETE FROM sessions WHERE token = ?`, token)
    res.status(403).json({ message: user.account_status === 'deleted' ? '账号已注销' : '账号已被封禁' })
    return null
  }
  const auth = { db, user }
  req.adminAuth = auth
  return auth
}

// 管理路由的统一入口防线。控制器仍然可以调用 requireAdmin 获取缓存的身份信息，
// 这样新增 /api/admin 端点时不会因为忘记在控制器里校验而暴露管理能力。
export const requireAdminMiddleware = async (req, res, next) => {
  try {
    const auth = await requireAdmin(req, res)
    if (auth) next()
  } catch (error) {
    next(error)
  }
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
  if (user.is_banned || user.account_status !== 'active') {
    await db.run(`DELETE FROM sessions WHERE token = ?`, token)
    res.status(403).json({ message: user.account_status === 'deleted' ? '账号已注销' : '账号已被封禁' })
    return null
  }
  return { db, user }
}
