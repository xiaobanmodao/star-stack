import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import webpush from 'web-push'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { getDb, initDb } from './db.js'
import { judgeSubmission, runSample, runSamples } from './judge.js'
import {
  ACHIEVEMENTS,
  updateUserStats,
  checkAndUnlockAchievements,
  updateRankings,
  getDifficultyStats,
  getHeatmapData,
  getLevelInfo,
  recalculateUserRating
} from './stats.js'

// 带容量上限和 TTL 的缓存，防止内存泄漏
class BoundedCache {
  constructor(maxSize = 500, ttlMs = 0) {
    this._map = new Map()
    this._maxSize = maxSize
    this._ttlMs = ttlMs // 0 = 不过期
  }
  has(key) {
    if (!this._map.has(key)) return false
    if (this._ttlMs && Date.now() - this._map.get(key).ts > this._ttlMs) {
      this._map.delete(key)
      return false
    }
    return true
  }
  get(key) {
    if (!this.has(key)) return undefined
    const entry = this._map.get(key)
    // LRU: 移到末尾
    this._map.delete(key)
    this._map.set(key, entry)
    return entry.v
  }
  set(key, value) {
    this._map.delete(key)
    if (this._map.size >= this._maxSize) {
      // 淘汰最旧的条目
      const oldest = this._map.keys().next().value
      this._map.delete(oldest)
    }
    this._map.set(key, { v: value, ts: Date.now() })
  }
  delete(key) { this._map.delete(key) }
  get size() { return this._map.size }
  entries() { return this._map.entries() }
}

const app = express()

// 登录防护：按 IP 失败计数，5 次失败后锁定 10 分钟
const loginFailures = new Map() // ip -> { count, lockedUntil }
const MAX_LOGIN_FAILURES = 5
const LOGIN_LOCK_MS = 10 * 60 * 1000
const checkLoginLock = (ip) => {
  const entry = loginFailures.get(ip)
  if (!entry) return false
  if (entry.lockedUntil && entry.lockedUntil > Date.now()) return true
  if (entry.lockedUntil && entry.lockedUntil <= Date.now()) loginFailures.delete(ip)
  return false
}
const recordLoginFailure = (ip) => {
  const entry = loginFailures.get(ip) || { count: 0, lockedUntil: 0 }
  entry.count += 1
  if (entry.count >= MAX_LOGIN_FAILURES) {
    entry.lockedUntil = Date.now() + LOGIN_LOCK_MS
    entry.count = 0
  }
  loginFailures.set(ip, entry)
}
const clearLoginFailures = (ip) => loginFailures.delete(ip)

// CORS: 生产环境限制为指定域名，开发环境允许 localhost
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : null // null = 未配置时回退到宽松模式（兼容开发环境）

app.use(cors({
  origin(origin, callback) {
    // 允许无 origin 的请求（如服务器间调用、curl）
    if (!origin) return callback(null, true)
    if (!ALLOWED_ORIGINS) {
      // 未配置白名单：开发放行；生产放行并告警（避免线上直接不可用，部署时务必配置）
      if (process.env.NODE_ENV === 'production') {
        console.warn('[cors] ALLOWED_ORIGINS 未配置，已放行所有来源。生产环境请设置环境变量！')
      }
      return callback(null, true)
    }
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true)
    callback(new Error('CORS not allowed'))
  },
  credentials: true,
}))
app.use(express.json({ limit: '4mb' }))

const createToken = () => randomBytes(24).toString('hex')
const parseResults = (raw) => {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const getAuthToken = (req) => {
  const header = req.headers.authorization || ''
  if (header.startsWith('Bearer ')) return header.slice(7).trim()
  return null
}

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 会话 30 天过期
const getUserByToken = async (db, token) => {
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
    `SELECT id, name, password_hash, is_admin, is_banned, avatar, bio, onboarded_at, created_at
     FROM users WHERE id = ?`,
    session.user_id
  )
  return user || null
}

const requireAdmin = async (req, res) => {
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

const requireUser = async (req, res) => {
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

const sanitizeProblemText = (value) => sanitizeHtml(String(value ?? '').trim())

// 获取用户等级信息（基于 user_stats.xp）
const getUserLevelInfo = async (db, userId) => {
  const row = await db.get(`SELECT xp FROM user_stats WHERE user_id = ?`, userId)
  return getLevelInfo(row?.xp || 0)
}

// 给用户增加 XP，并返回最新等级信息
const addXp = async (db, userId, amount) => {
  if (!userId || !amount) return null
  await db.run(
    `INSERT INTO user_stats (user_id, xp) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET xp = xp + excluded.xp`,
    userId,
    amount
  )
  return getUserLevelInfo(db, userId)
}

const serializeUser = async (db, user) => {
  const levelInfo = await getUserLevelInfo(db, user.id)
  return {
    id: user.id,
    name: user.name,
    avatar: user.avatar,
    isAdmin: Boolean(user.is_admin),
    isBanned: Boolean(user.is_banned),
    onboarded: Boolean(user.onboarded_at),
    ...levelInfo,
  }
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true })
})

// 前端错误上报（基础错误监控）
app.post('/api/client-errors', async (req, res) => {
  try {
    const db = await getDb()
    const { message, source, line, column, stack, url, userAgent } = req.body || {}
    if (!message) return res.status(400).json({ message: '缺少错误信息' })

    let userId = null
    const token = getAuthToken(req)
    if (token) {
      const user = await getUserByToken(db, token)
      if (user) userId = user.id
    }

    await db.run(
      `INSERT INTO client_errors (user_id, message, source, line, column, stack, url, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      userId,
      String(message).slice(0, 1000),
      source ? String(source).slice(0, 500) : null,
      Number.isFinite(Number(line)) ? Number(line) : null,
      Number.isFinite(Number(column)) ? Number(column) : null,
      stack ? String(stack).slice(0, 3000) : null,
      url ? String(url).slice(0, 1000) : null,
      userAgent ? String(userAgent).slice(0, 300) : null,
      new Date().toISOString()
    )
    return res.json({ success: true })
  } catch (error) {
    console.error('Failed to report client error:', error)
    return res.status(500).json({ message: '错误上报失败' })
  }
})

app.get('/api/stats', async (req, res) => {
  const db = await getDb()

  const problemCount = await db.get(`SELECT COUNT(*) as count FROM problems`)

  const userCount = await db.get(`SELECT COUNT(*) as count FROM users`)

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = today.toISOString()
  const todaySubmissions = await db.get(
    `SELECT COUNT(*) as count FROM submissions WHERE created_at >= ?`,
    todayStr
  )

  return res.json({
    problemCount: problemCount?.count || 0,
    userCount: userCount?.count || 0,
    todaySubmissions: todaySubmissions?.count || 0,
  })
})

app.post('/api/register', async (req, res) => {
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
  const user = {
    id,
    name,
    passwordHash,
    isAdmin: 0,
    isBanned: 0,
    createdAt: new Date().toISOString(),
  }
  const token = createToken()
  await db.run(
    `INSERT INTO users (id, name, password_hash, is_admin, is_banned, created_at)
     VALUES (?, ?, ?, 0, 0, ?)`,
    user.id,
    user.name,
    user.passwordHash,
    user.createdAt
  )
  await db.run(
    `INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)`,
    token,
    user.id,
    new Date().toISOString()
  )
  return res.json({
    token,
    user: { id: user.id, name: user.name, isAdmin: false, isBanned: false, avatar: null },
  })
})

app.post('/api/login', async (req, res) => {
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

  // Recalculate user rating on login
  await recalculateUserRating(db, user.id)

  const token = createToken()
  await db.run(
    `INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)`,
    token,
    user.id,
    new Date().toISOString()
  )
  const serialized = await serializeUser(db, user)
  return res.json({
    token,
    user: serialized,
  })
})

app.get('/api/me', async (req, res) => {
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
  return res.json({
    user: serialized,
  })
})

app.post('/api/logout', async (req, res) => {
  const token = getAuthToken(req)
  if (!token) {
    return res.status(204).end()
  }
  const db = await getDb()
  await db.run(`DELETE FROM sessions WHERE token = ?`, token)
  return res.status(204).end()
})

app.patch('/api/me/name', async (req, res) => {
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
  return res.json({
    user: serialized,
  })
})

app.post('/api/me/password', async (req, res) => {
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
  await db.run(
    `UPDATE users SET password_hash = ? WHERE id = ?`,
    passwordHash,
    user.id
  )
  return res.json({ ok: true })
})

app.post('/api/me/avatar', async (req, res) => {
  const token = getAuthToken(req)
  if (!token) {
    return res.status(401).json({ message: '未登录' })
  }
  const { avatar } = req.body || {}
  if (!avatar) {
    return res.status(400).json({ message: '请提供头像数据' })
  }
  // 验证是否为 base64 图片数据
  // MIME 白名单：仅允许常见位图格式，拒绝 svg（可携带脚本）与任意 data 载体
  if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(avatar)) {
    return res.status(400).json({ message: '仅支持 PNG/JPG/WebP/GIF 图片' })
  }
  // 限制大小（约 2MB）
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
  return res.json({
    user: serialized,
  })
})


// ============================================================
// 每日一题 + AC 连击（留存机制）
// 每日推荐一道题（按日期轮换，优先未 AC）；返回用户连击状态
// ============================================================
app.get('/api/problems/daily', async (req, res) => {
  const db = await getDb()
  const token = getAuthToken(req)
  const user = token ? await getUserByToken(db, token) : null
  const userId = user ? user.id : null

  // 本地日期 YYYY-MM-DD
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  const problems = await db.all(
    `SELECT id, slug, title, difficulty, tags FROM problems WHERE status = 'published' ORDER BY id ASC`
  )
  if (problems.length === 0) {
    return res.json({ problem: null, solvedToday: false, streak: 0, maxStreak: 0 })
  }

  // 按日期取模轮换：同一天所有人看到同一道基准题
  const dayNum = parseInt(today.replace(/-/g, ''), 10)
  const baseIdx = dayNum % problems.length

  let solvedSet = new Set()
  if (userId) {
    const solved = await db.all(`SELECT problem_id FROM solved_problems WHERE user_id = ?`, userId)
    solvedSet = new Set(solved.map((s) => s.problem_id))
  }

  // 优先推荐用户未 AC 的题（从基准索引开始顺延）
  let picked = null
  if (userId) {
    for (let i = 0; i < problems.length; i++) {
      const p = problems[(baseIdx + i) % problems.length]
      if (!solvedSet.has(p.id)) { picked = p; break }
    }
  }
  if (!picked) picked = problems[baseIdx]

  let solvedToday = false
  let streak = 0
  let maxStreak = 0
  if (userId) {
    const act = await db.get(
      `SELECT accepted_count FROM daily_activity WHERE user_id = ? AND activity_date = ?`,
      userId, today
    )
    solvedToday = Boolean(act && act.accepted_count > 0)
    const stats = await db.get(`SELECT current_streak, max_streak FROM user_stats WHERE user_id = ?`, userId)
    streak = stats?.current_streak || 0
    maxStreak = stats?.max_streak || 0
  }

  return res.json({
    problem: picked ? {
      id: picked.id,
      slug: picked.slug,
      title: picked.title,
      difficulty: picked.difficulty,
      tags: picked.tags ? picked.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      solved: userId ? solvedSet.has(picked.id) : false,
    } : null,
    solvedToday,
    streak,
    maxStreak,
  })
})

app.get('/api/oj/problems', async (req, res) => {
  const db = await getDb()
  const { search, tag, difficulty } = req.query || {}
  const where = ['status = ?']
  const params = ['published']
  if (search) {
    const trimmedSearch = search.trim()
    // 检查是否是题号搜索 (P1001, p1001, 1001等格式)
    const problemNumberMatch = trimmedSearch.match(/^[pP]?(\d+)$/)
    if (problemNumberMatch) {
      // 题号搜索：精确匹配题号
      const problemId = problemNumberMatch[1]
      where.push(`(id = ? OR slug LIKE ?)`)
      params.push(Number(problemId), `%${problemId}%`)
    } else {
      // 关键字搜索：搜索标题、题目描述和标签
      where.push(`(title LIKE ? OR statement LIKE ? OR tags LIKE ?)`)
      params.push(`%${trimmedSearch}%`, `%${trimmedSearch}%`, `%${trimmedSearch}%`)
    }
  }
  if (tag) {
    // 支持多标签过滤，用逗号分隔
    const tags = tag.split(',').map(t => t.trim()).filter(Boolean)
    if (tags.length > 0) {
      // 每个标签都要匹配
      const tagConditions = tags.map(() => `tags LIKE ?`).join(' AND ')
      where.push(`(${tagConditions})`)
      tags.forEach(t => params.push(`%${t}%`))
    }
  }
  if (difficulty) {
    where.push(`difficulty = ?`)
    params.push(difficulty)
  }
  const whereSql = `WHERE ${where.join(' AND ')}`
  const rows = await db.all(
    `SELECT id, slug, title, difficulty, tags, created_at,
       (SELECT COUNT(*) FROM submissions WHERE problem_id = problems.id AND status = 'Accepted') as ac_count,
       (SELECT COUNT(*) FROM submissions WHERE problem_id = problems.id) as total_count
     FROM problems ${whereSql} ORDER BY id ASC`,
    ...params
  )
  return res.json({
    problems: rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      difficulty: row.difficulty,
      tags: row.tags ? row.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      createdAt: row.created_at,
      acCount: row.ac_count || 0,
      totalCount: row.total_count || 0,
      passRate: row.total_count > 0 ? Math.round((row.ac_count / row.total_count) * 100) : 0,
    })),
  })
})

app.get('/api/oj/problems/:id', async (req, res) => {
  const db = await getDb()
  const identifier = req.params.id
  const isNumeric = /^\d+$/.test(identifier)
  const row = isNumeric
    ? await db.get(`SELECT p.*, u.name as creator_name FROM problems p LEFT JOIN users u ON p.creator_id = u.id WHERE p.id = ?`, Number(identifier))
    : await db.get(`SELECT p.*, u.name as creator_name FROM problems p LEFT JOIN users u ON p.creator_id = u.id WHERE p.slug = ?`, identifier)
  if (!row) {
    return res.status(404).json({ message: '题目不存在' })
  }
  // 草稿题目仅创建者与管理员可见
  if (row.status !== 'published') {
    const token = req.headers.authorization?.replace('Bearer ', '')
    const session = token ? await db.get(`SELECT user_id FROM sessions WHERE token = ?`, token) : null
    const isCreator = session && session.user_id === row.creator_id
    if (!isCreator && !(session && (await db.get(`SELECT is_admin FROM users WHERE id = ?`, session.user_id))?.is_admin)) {
      return res.status(404).json({ message: '题目不存在' })
    }
  }
  const samples = await db.all(
    `SELECT input, output FROM testcases WHERE problem_id = ? AND is_sample = 1 ORDER BY id ASC`,
    row.id
  )
  const sampleList =
    samples.length > 0 ? samples : JSON.parse(row.samples || '[]')

  // 获取当前用户的最高分数
  let maxScore = null
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (token) {
    const session = await db.get(`SELECT user_id FROM sessions WHERE token = ?`, token)
    if (session) {
      const scoreResult = await db.get(
        `SELECT MAX(score) as max_score FROM submissions WHERE problem_id = ? AND user_id = ?`,
        row.id,
        session.user_id
      )
      maxScore = scoreResult?.max_score ?? null
    }
  }

  return res.json({
    problem: {
      id: row.id,
      slug: row.slug,
      title: row.title,
      difficulty: row.difficulty,
      tags: row.tags ? row.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      statement: row.statement,
      input: row.input_desc,
      output: row.output_desc,
      dataRange: row.data_range || '',
      samples: sampleList,
      createdAt: row.created_at,
      creatorId: row.creator_id,
      creatorName: row.creator_name,
      maxScore,
    },
  })
})

// GET /api/oj/problems/:id/solutions - 题目题解列表（洛谷风格）
app.get('/api/oj/problems/:id/solutions', async (req, res) => {
  try {
    const db = await getDb()
    const problemId = parseInt(req.params.id)
    if (!problemId) return res.status(400).json({ message: '无效的题目ID' })

    const problem = await db.get(`SELECT id FROM problems WHERE id = ?`, problemId)
    if (!problem) return res.status(404).json({ message: '题目不存在' })

    const solutions = await db.all(
      `SELECT dp.id, dp.user_id, dp.title, dp.like_count, dp.comment_count, dp.view_count, dp.created_at,
              u.name as user_name, u.avatar as user_avatar
       FROM discussion_posts dp
       LEFT JOIN users u ON dp.user_id = u.id
       WHERE dp.problem_id = ? AND dp.is_solution = 1
       ORDER BY dp.created_at DESC`,
      problemId
    )

    let canWrite = false
    const token = getAuthToken(req)
    if (token) {
      const user = await getUserByToken(db, token)
      if (user) {
        const solved = await db.get(
          `SELECT 1 FROM solved_problems WHERE user_id = ? AND problem_id = ?`,
          user.id, problemId
        )
        canWrite = !!solved
      }
    }

    return res.json({
      solutions: solutions.map((s) => ({
        id: s.id,
        userId: s.user_id,
        userName: s.user_name,
        userAvatar: s.user_avatar,
        title: s.title,
        likeCount: s.like_count,
        commentCount: s.comment_count,
        viewCount: s.view_count,
        createdAt: s.created_at,
        isSolution: true,
      })),
      canWrite,
    })
  } catch (error) {
    console.error('Failed to list solutions:', error)
    return res.status(500).json({ message: '获取题解列表失败' })
  }
})

// POST /api/oj/problems/:id/solutions - 发布题解（需 AC 过该题）
const solutionRateLimits = new BoundedCache(5000, 10000) // 10 秒冷却

app.post('/api/oj/problems/:id/solutions', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth

  try {
    if (solutionRateLimits.has(user.id)) {
      return res.status(429).json({ message: '发布题解过于频繁，请稍后再试' })
    }

    const problemId = parseInt(req.params.id)
    if (!problemId) return res.status(400).json({ message: '无效的题目ID' })

    const problem = await db.get(`SELECT id FROM problems WHERE id = ?`, problemId)
    if (!problem) return res.status(404).json({ message: '题目不存在' })

    const solved = await db.get(
      `SELECT 1 FROM solved_problems WHERE user_id = ? AND problem_id = ?`,
      user.id, problemId
    )
    if (!solved) {
      return res.status(403).json({ message: '通过该题后才能写题解' })
    }

    const { title, content } = req.body || {}
    if (!title || !title.trim()) return res.status(400).json({ message: '标题不能为空' })
    if (title.trim().length > 200) return res.status(400).json({ message: '标题不能超过200字符' })
    if (!content || !content.trim()) return res.status(400).json({ message: '内容不能为空' })
    if (content.length > 50000) return res.status(400).json({ message: '内容不能超过50000字符' })

    solutionRateLimits.set(user.id, Date.now())
    const now = new Date().toISOString()
    const result = await db.run(
      `INSERT INTO discussion_posts (user_id, title, content, problem_id, module_key, is_solution, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'oj', 1, ?, ?)`,
      user.id,
      title.trim(),
      content,
      problemId,
      now,
      now
    )

    await addXp(db, user.id, 20)
    return res.json({ success: true, postId: result.lastID })
  } catch (error) {
    console.error('Failed to create solution:', error)
    return res.status(500).json({ message: '发布题解失败' })
  }
})

app.post('/api/problems', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth

  const { title, difficulty, tags, statement, inputDesc, outputDesc, dataRange, samples, testFiles, status } = req.body || {}
  const sanitizedStatement = sanitizeProblemText(statement)
  const sanitizedInputDesc = sanitizeProblemText(inputDesc)
  const sanitizedOutputDesc = sanitizeProblemText(outputDesc)
  const sanitizedDataRange = sanitizeProblemText(dataRange)

  if (!title || !title.trim()) {
    return res.status(400).json({ message: '请填写题目标题' })
  }

  if (!sanitizedStatement) {
    return res.status(400).json({ message: '请填写题目描述' })
  }

  if (!samples || !Array.isArray(samples) || samples.length === 0) {
    return res.status(400).json({ message: '请至少添加一个样例' })
  }

  const now = new Date().toISOString()

  try {
    await db.exec('BEGIN IMMEDIATE')
    // 查找最小的闲置题号
    const existingIds = await db.all(`SELECT id FROM problems ORDER BY id ASC`)
    let nextId = 1001 // 从 1001 开始

    for (const row of existingIds) {
      if (row.id === nextId) {
        nextId++
      } else if (row.id > nextId) {
        break
      }
    }

    // 插入题目，指定题号
    await db.run(
      `INSERT INTO problems (id, slug, title, difficulty, tags, statement, input_desc, output_desc, data_range, samples, creator_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      nextId,
      `p${nextId}`,
      title.trim(),
      difficulty || '入门',
      Array.isArray(tags) ? tags.join(',') : (tags || ''),
      sanitizedStatement,
      sanitizedInputDesc,
      sanitizedOutputDesc,
      sanitizedDataRange,
      JSON.stringify(samples),
      user.id,
      // 仅管理员可发布；普通用户创建的题目一律为草稿，待审核发布
      user.is_admin ? (status === 'draft' ? 'draft' : 'published') : 'draft',
      now
    )

    const problemId = nextId
    const slug = `p${nextId}`

    // 插入样例作为测试用例
    for (const sample of samples) {
      if (sample.input && sample.output) {
        await db.run(
          `INSERT INTO testcases (problem_id, input, output, is_sample, created_at)
           VALUES (?, ?, ?, 1, ?)`,
          problemId,
          sample.input,
          sample.output,
          now
        )
      }
    }

    // 插入测试数据文件
    if (testFiles && Array.isArray(testFiles)) {
      // 将 .in 和 .out 文件配对
      const inFiles = testFiles.filter(f => f.type === 'in')
      const outFiles = testFiles.filter(f => f.type === 'out')

      for (const inFile of inFiles) {
        const baseName = inFile.name.replace(/\.in$/, '')
        const outFile = outFiles.find(f => f.name.replace(/\.out$/, '') === baseName)

        if (outFile) {
          await db.run(
            `INSERT INTO testcases (problem_id, input, output, is_sample, created_at)
             VALUES (?, ?, ?, 0, ?)`,
            problemId,
            inFile.content,
            outFile.content,
            now
          )
        }
      }
    }

    await db.exec('COMMIT')

    return res.json({
      message: '题目创建成功',
      problemId,
      slug
    })
  } catch (error) {
    await db.exec('ROLLBACK').catch(() => undefined)
    console.error('创建题目失败:', error)
    return res.status(500).json({ message: '创建题目失败' })
  }
})

app.get('/api/my-problems', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth

  const rows = await db.all(
    `SELECT id, slug, title, difficulty, tags, status, created_at
     FROM problems
     WHERE creator_id = ?
     ORDER BY created_at DESC`,
    user.id
  )

  const problems = rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    difficulty: row.difficulty,
    tags: row.tags ? row.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    status: row.status,
    createdAt: row.created_at,
  }))

  return res.json({ problems })
})

app.get('/api/problems/:id/edit', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth

  const problemId = Number(req.params.id)
  if (!problemId) {
    return res.status(400).json({ message: '无效的题目ID' })
  }

  const problem = await db.get(`SELECT * FROM problems WHERE id = ?`, problemId)
  if (!problem) {
    return res.status(404).json({ message: '题目不存在' })
  }

  // 检查权限：创建者或管理员
  if (problem.creator_id !== user.id && !user.is_admin) {
    return res.status(403).json({ message: '无权限编辑此题目' })
  }

  // 获取所有测试用例
  const testcases = await db.all(
    `SELECT input, output, is_sample FROM testcases WHERE problem_id = ? ORDER BY id ASC`,
    problemId
  )

  const samples = testcases.filter(tc => tc.is_sample === 1).map(tc => ({
    input: tc.input,
    output: tc.output
  }))

  const testData = testcases.filter(tc => tc.is_sample === 0)

  return res.json({
    problem: {
      id: problem.id,
      slug: problem.slug,
      title: problem.title,
      difficulty: problem.difficulty,
      tags: problem.tags ? problem.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      statement: problem.statement,
      inputDesc: problem.input_desc,
      outputDesc: problem.output_desc,
      dataRange: problem.data_range,
      samples,
      testDataCount: testData.length,
      status: problem.status,
      createdAt: problem.created_at,
    }
  })
})

app.put('/api/problems/:id', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth

  const problemId = Number(req.params.id)
  if (!problemId) {
    return res.status(400).json({ message: '无效的题目ID' })
  }

  // 检查题目是否存在
  const problem = await db.get(`SELECT * FROM problems WHERE id = ?`, problemId)
  if (!problem) {
    return res.status(404).json({ message: '题目不存在' })
  }

  // 检查权限：创建者或管理员
  if (problem.creator_id !== user.id && !user.is_admin) {
    return res.status(403).json({ message: '无权限编辑此题目' })
  }

  const { title, difficulty, tags, statement, inputDesc, outputDesc, dataRange, samples, testFiles, status } = req.body || {}
  const sanitizedStatement = sanitizeProblemText(statement)
  const sanitizedInputDesc = sanitizeProblemText(inputDesc)
  const sanitizedOutputDesc = sanitizeProblemText(outputDesc)
  const sanitizedDataRange = sanitizeProblemText(dataRange)

  if (!title || !title.trim()) {
    return res.status(400).json({ message: '请填写题目标题' })
  }

  if (!sanitizedStatement) {
    return res.status(400).json({ message: '请填写题目描述' })
  }

  if (!samples || !Array.isArray(samples) || samples.length === 0) {
    return res.status(400).json({ message: '请至少添加一个样例' })
  }

  const now = new Date().toISOString()

  try {
    await db.exec('BEGIN IMMEDIATE')
    // 更新题目
    await db.run(
      `UPDATE problems SET title = ?, difficulty = ?, tags = ?, statement = ?, input_desc = ?, output_desc = ?, data_range = ?, samples = ?, status = ?
       WHERE id = ?`,
      title.trim(),
      difficulty || '入门',
      Array.isArray(tags) ? tags.join(',') : (tags || ''),
      sanitizedStatement,
      sanitizedInputDesc,
      sanitizedOutputDesc,
      sanitizedDataRange,
      JSON.stringify(samples),
      status || 'published',
      problemId
    )

    // 删除旧的测试用例
    await db.run(`DELETE FROM testcases WHERE problem_id = ?`, problemId)

    // 插入新的样例作为测试用例
    for (const sample of samples) {
      if (sample.input && sample.output) {
        await db.run(
          `INSERT INTO testcases (problem_id, input, output, is_sample, created_at)
           VALUES (?, ?, ?, 1, ?)`,
          problemId,
          sample.input,
          sample.output,
          now
        )
      }
    }

    // 插入测试数据文件
    if (testFiles && Array.isArray(testFiles)) {
      const inFiles = testFiles.filter(f => f.type === 'in')
      const outFiles = testFiles.filter(f => f.type === 'out')

      for (const inFile of inFiles) {
        const baseName = inFile.name.replace(/\.in$/, '')
        const outFile = outFiles.find(f => f.name.replace(/\.out$/, '') === baseName)

        if (outFile) {
          await db.run(
            `INSERT INTO testcases (problem_id, input, output, is_sample, created_at)
             VALUES (?, ?, ?, 0, ?)`,
            problemId,
            inFile.content,
            outFile.content,
            now
          )
        }
      }
    }

    await db.exec('COMMIT')

    return res.json({
      message: '题目更新成功',
      problemId
    })
  } catch (error) {
    await db.exec('ROLLBACK').catch(() => undefined)
    console.error('更新题目失败:', error)
    return res.status(500).json({ message: '更新题目失败' })
  }
})

app.delete('/api/problems/:id', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth

  const problemId = Number(req.params.id)
  if (!problemId) {
    return res.status(400).json({ message: '无效的题目ID' })
  }

  // 检查题目是否存在
  const problem = await db.get(`SELECT * FROM problems WHERE id = ?`, problemId)
  if (!problem) {
    return res.status(404).json({ message: '题目不存在' })
  }

  // 检查权限：创建者或管理员
  if (problem.creator_id !== user.id && !user.is_admin) {
    return res.status(403).json({ message: '无权限删除此题目' })
  }

  try {
    // 删除题目（级联删除会自动删除相关的 testcases 和 submissions）
    await db.run(`DELETE FROM problems WHERE id = ?`, problemId)
    await db.run(`DELETE FROM bookmarks WHERE target_type = 'problem' AND target_id = ?`, problemId)

    return res.json({
      message: '题目删除成功'
    })
  } catch (error) {
    console.error('删除题目失败:', error)
    return res.status(500).json({ message: '删除题目失败' })
  }
})

app.get('/api/oj/submissions', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  const { problemId } = req.query || {}
  const params = [user.id]
  let extra = ''
  if (problemId) {
    extra = ' AND problem_id = ?'
    params.push(Number(problemId))
  }
  const rows = await db.all(
    `SELECT s.id, s.problem_id, s.language, s.status, s.time_ms, s.memory_kb, s.score, s.created_at, s.results_json,
            p.title as problem_title
     FROM submissions s
     JOIN problems p ON p.id = s.problem_id
     WHERE s.user_id = ?${extra}
     ORDER BY s.id DESC
     LIMIT 100`,
    ...params
  )
  return res.json({
    submissions: rows.map((row) => ({
      id: row.id,
      problemId: row.problem_id,
      problemTitle: row.problem_title,
      language: row.language,
      status: row.status,
      timeMs: row.time_ms,
      memoryKb: row.memory_kb,
      score: row.score ?? 0,
      results: parseResults(row.results_json),
      createdAt: row.created_at,
    })),
  })
})

app.get('/api/oj/submissions/latest', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  const { problemId } = req.query || {}
  const numericProblemId = Number(problemId)
  if (!numericProblemId) {
    return res.status(400).json({ message: '缺少题目编号' })
  }
  const row = await db.get(
    `SELECT id, problem_id, language, status, time_ms, memory_kb, message, code, created_at
     FROM submissions
     WHERE user_id = ? AND problem_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    user.id,
    numericProblemId
  )
  if (!row) {
    return res.json({ submission: null })
  }
  return res.json({
    submission: {
      id: row.id,
      problemId: row.problem_id,
      language: row.language,
      status: row.status,
      timeMs: row.time_ms,
      memoryKb: row.memory_kb,
      message: row.message,
      code: row.code,
      createdAt: row.created_at,
    },
  })
})

app.get('/api/oj/submissions/all', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  const { problemId, userId } = req.query || {}
  const numericProblemId = Number(problemId)
  if (!numericProblemId) {
    return res.status(400).json({ message: '缺少题目编号' })
  }
  const params = [numericProblemId]
  let extra = ''
  if (userId) {
    extra = ' AND s.user_id = ?'
    params.push(String(userId))
  }
  const rows = await db.all(
    `SELECT s.id, s.problem_id, s.user_id, s.language, s.status, s.time_ms, s.memory_kb, s.score, s.message, s.code, s.created_at, s.results_json,
            u.name as user_name
     FROM submissions s
     JOIN users u ON u.id = s.user_id
     WHERE s.problem_id = ?${extra}
     ORDER BY s.created_at DESC, s.id DESC
     LIMIT 200`,
    ...params
  )
  return res.json({
    submissions: rows.map((row) => ({
      id: row.id,
      problemId: row.problem_id,
      userId: row.user_id,
      userName: row.user_name,
      language: row.language,
      status: row.status,
      timeMs: row.time_ms,
      memoryKb: row.memory_kb,
      score: row.score ?? 0,
      message: row.user_id === user.id ? row.message : null,
      code: row.user_id === user.id ? row.code : null,
      canViewCode: row.user_id === user.id,
      results: row.user_id === user.id ? parseResults(row.results_json) : [],
      createdAt: row.created_at,
    })),
  })
})

app.get('/api/oj/submissions/:id', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  const submissionId = Number(req.params.id)
  if (!submissionId) {
    return res.status(400).json({ message: '无效的提交编号' })
  }
  const row = await db.get(
    `SELECT s.id, s.problem_id, s.user_id, s.language, s.status, s.time_ms, s.memory_kb, s.score, s.message, s.code, s.created_at, s.results_json,
            p.title as problem_title,
            u.name as user_name
     FROM submissions s
     JOIN problems p ON p.id = s.problem_id
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ?
     LIMIT 1`,
    submissionId
  )
  if (!row) {
    return res.status(404).json({ message: '提交不存在' })
  }

  // 只有提交者本人可以查看代码
  const canViewCode = row.user_id === user.id

  return res.json({
    submission: {
      id: row.id,
      problemId: row.problem_id,
      problemTitle: row.problem_title,
      userId: row.user_id,
      userName: row.user_name,
      language: row.language,
      status: row.status,
      timeMs: row.time_ms,
      memoryKb: row.memory_kb,
      message: canViewCode ? row.message : null,
      score: row.score ?? 0,
      code: canViewCode ? row.code : null,
      canViewCode: canViewCode,
      results: canViewCode ? parseResults(row.results_json) : [],
      createdAt: row.created_at,
    },
  })
})

// 评测限流：每用户 10 秒 1 次 + 全局并发上限
const judgeRateLimits = new BoundedCache(2000, 10000)
let activeJudges = 0
const MAX_ACTIVE_JUDGES = 4

app.post('/api/oj/submissions', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  if (judgeRateLimits.has(user.id)) {
    return res.status(429).json({ message: '提交过于频繁，请稍后再试' })
  }
  judgeRateLimits.set(user.id, Date.now())
  if (activeJudges >= MAX_ACTIVE_JUDGES) {
    return res.status(503).json({ message: '评测队列繁忙，请稍后再试' })
  }
  activeJudges += 1
  const { problemId, language, code } = req.body || {}
  if (!problemId || !language || !code) {
    return res.status(400).json({ message: '请填写完整信息' })
  }

  // Validate language
  const allowedLanguages = ['C++', 'Python', 'Java']
  if (!allowedLanguages.includes(language)) {
    return res.status(400).json({ message: '不支持的编程语言' })
  }

  // Validate code length (max 100KB)
  if (code.length > 100000) {
    return res.status(400).json({ message: '代码长度超过限制（最大 100KB）' })
  }

  const problem = await db.get(`SELECT id, status FROM problems WHERE id = ?`, Number(problemId))
  if (!problem) {
    return res.status(404).json({ message: '题目不存在' })
  }
  if (problem.status !== 'published') {
    return res.status(403).json({ message: '题目尚未发布' })
  }
  const testcases = await db.all(
    `SELECT input, output FROM testcases WHERE problem_id = ? ORDER BY id ASC`,
    Number(problemId)
  )
  if (testcases.length === 0) {
    return res.status(400).json({ message: '该题暂无测试用例' })
  }
  const normalized = String(code)
  let judgeResult
  try {
    judgeResult = await judgeSubmission({
      language,
      code: normalized,
      testcases,
    })
  } finally {
    activeJudges = Math.max(0, activeJudges - 1)
  }
  const status = judgeResult.status
  const message = judgeResult.message
  const timeMs = judgeResult.timeMs ?? null
  const memoryKb = null
  const score = judgeResult.score ?? 0
  const results = Array.isArray(judgeResult.results) ? judgeResult.results : []
  const resultsJson = JSON.stringify(results)
  const createdAt = new Date().toISOString()
  const result = await db.run(
    `INSERT INTO submissions (problem_id, user_id, language, code, status, time_ms, memory_kb, message, results_json, score, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    Number(problemId),
    user.id,
    language,
    normalized,
    status,
    timeMs,
    memoryKb,
    message,
    resultsJson,
    score,
    createdAt
  )

  const submissionId = result.lastID

  // Update user statistics and check achievements
  try {
    await updateUserStats(db, user.id, {
      id: submissionId,
      problemId: Number(problemId),
      status,
      createdAt
    })
    await checkAndUnlockAchievements(db, user.id, {
      id: submissionId,
      problemId: Number(problemId),
      status,
      createdAt
    })
    // Update rankings periodically (could be optimized with a background job)
    await updateRankings(db)
    // AC 后实时更新排行榜快照，让排名变化立即可见
    if (status === 'Accepted') {
      queueLeaderboardHistorySave()
    }
  } catch (error) {
    console.error('Failed to update stats:', error)
  }

  return res.json({
    submission: {
      id: submissionId,
      problemId: Number(problemId),
      language,
      status,
      timeMs,
      memoryKb,
      message,
      results,
      score,
      createdAt,
    },
  })
})

// SSE streaming submission endpoint
app.post('/api/oj/submissions/stream', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  const { problemId, language, code } = req.body || {}
  if (!problemId || !language || !code) {
    return res.status(400).json({ message: '请填写完整信息' })
  }
  const allowedLanguages = ['C++', 'Python', 'Java']
  if (!allowedLanguages.includes(language)) {
    return res.status(400).json({ message: '不支持的编程语言' })
  }
  if (code.length > 100000) {
    return res.status(400).json({ message: '代码长度超过限制（最大 100KB）' })
  }
  const problem = await db.get(`SELECT id, status FROM problems WHERE id = ?`, Number(problemId))
  if (!problem) {
    return res.status(404).json({ message: '题目不存在' })
  }
  if (problem.status !== 'published') {
    return res.status(403).json({ message: '题目尚未发布' })
  }
  const testcases = await db.all(
    `SELECT input, output FROM testcases WHERE problem_id = ? ORDER BY id ASC`,
    Number(problemId)
  )
  if (testcases.length === 0) {
    return res.status(400).json({ message: '该题暂无测试用例' })
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  let closed = false
  req.on('close', () => { closed = true })

  const sendEvent = (event, data) => {
    if (closed) return
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  sendEvent('start', { totalCases: testcases.length })

  const normalized = String(code)
  const judgeResult = await judgeSubmission({
    language,
    code: normalized,
    testcases,
    onTestCase: (tc) => sendEvent('testcase', tc),
  })

  const status = judgeResult.status
  const message = judgeResult.message
  const timeMs = judgeResult.timeMs ?? null
  const memoryKb = null
  const score = judgeResult.score ?? 0
  const results = Array.isArray(judgeResult.results) ? judgeResult.results : []
  const resultsJson = JSON.stringify(results)
  const createdAt = new Date().toISOString()
  const result = await db.run(
    `INSERT INTO submissions (problem_id, user_id, language, code, status, time_ms, memory_kb, message, results_json, score, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    Number(problemId), user.id, language, normalized, status, timeMs, memoryKb, message, resultsJson, score, createdAt
  )
  const submissionId = result.lastID

  try {
    await updateUserStats(db, user.id, { id: submissionId, problemId: Number(problemId), status, createdAt })
    await checkAndUnlockAchievements(db, user.id, { id: submissionId, problemId: Number(problemId), status, createdAt })
    await updateRankings(db)
    if (status === 'Accepted') {
      queueLeaderboardHistorySave()
    }
  } catch (error) {
    console.error('Failed to update stats:', error)
  }

  sendEvent('done', {
    submission: { id: submissionId, problemId: Number(problemId), language, status, timeMs, memoryKb, message, results, score, createdAt }
  })
  res.end()
})

app.post('/api/oj/run-sample', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db } = auth
  const { problemId, language, code, sampleIndex = 0 } = req.body || {}
  if (!problemId || !language || !code) {
    return res.status(400).json({ message: '请填写完整信息' })
  }

  // Validate language
  const allowedLanguages = ['C++', 'Python', 'Java']
  if (!allowedLanguages.includes(language)) {
    return res.status(400).json({ message: '不支持的编程语言' })
  }

  // Validate code length (max 100KB)
  if (code.length > 100000) {
    return res.status(400).json({ message: '代码长度超过限制（最大 100KB）' })
  }

  const problem = await db.get(`SELECT id, samples FROM problems WHERE id = ?`, Number(problemId))
  if (!problem) {
    return res.status(404).json({ message: '题目不存在' })
  }
  const sampleRows = await db.all(
    `SELECT input, output FROM testcases WHERE problem_id = ? AND is_sample = 1 ORDER BY id ASC`,
    Number(problemId)
  )
  const samples = sampleRows.length
    ? sampleRows
    : JSON.parse(problem.samples || '[]')
  if (!samples || samples.length === 0) {
    return res.status(400).json({ message: '暂无样例' })
  }
  const index = Math.min(Math.max(Number(sampleIndex) || 0, 0), samples.length - 1)
  const sample = samples[index]
  const runResult = await runSample({
    language,
    code: String(code),
    input: String(sample.input ?? ''),
  })
  const normalize = (text) => String(text ?? '').replace(/\r\n/g, '\n').trim()
  let status = runResult.status
  let message = runResult.message
  if (runResult.status === 'OK') {
    const actual = normalize(runResult.output)
    const expected = normalize(sample.output)
    if (actual === expected) {
      status = 'Accepted'
      message = '样例通过'
    } else {
      status = 'Wrong Answer'
      message = '样例未通过'
    }
  }
  return res.json({
    output: runResult.output ?? '',
    expected: String(sample.output ?? ''),
    status,
    message,
    timeMs: runResult.timeMs ?? 0,
  })
})

app.post('/api/oj/run-custom', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { language, code, input, expected } = req.body || {}
  if (!language || !code || input === undefined) {
    return res.status(400).json({ message: '请填写完整信息' })
  }

  // Validate language
  const allowedLanguages = ['C++', 'Python', 'Java']
  if (!allowedLanguages.includes(language)) {
    return res.status(400).json({ message: '不支持的编程语言' })
  }

  // Validate code length (max 100KB)
  if (code.length > 100000) {
    return res.status(400).json({ message: '代码长度超过限制（最大 100KB）' })
  }

  // Validate input length (max 10MB)
  if (input.length > 10000000) {
    return res.status(400).json({ message: '输入数据长度超过限制（最大 10MB）' })
  }

  const runResult = await runSample({
    language,
    code: String(code),
    input: String(input ?? ''),
  })
  const normalize = (text) => String(text ?? '').replace(/\r\n/g, '\n').trim()
  let status = runResult.status
  let message = runResult.message
  if (expected !== undefined && runResult.status === 'OK') {
    const actual = normalize(runResult.output)
    const target = normalize(expected)
    if (actual === target) {
      status = 'Accepted'
      message = '样例通过'
    } else {
      status = 'Wrong Answer'
      message = '样例未通过'
    }
  }
  return res.json({
    output: runResult.output ?? '',
    expected: expected ?? '',
    status,
    message,
    timeMs: runResult.timeMs ?? 0,
  })
})

app.post('/api/oj/run-samples', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db } = auth
  const { problemId, language, code } = req.body || {}
  if (!problemId || !language || !code) {
    return res.status(400).json({ message: '请填写完整信息' })
  }

  // Validate language
  const allowedLanguages = ['C++', 'Python', 'Java']
  if (!allowedLanguages.includes(language)) {
    return res.status(400).json({ message: '不支持的编程语言' })
  }

  // Validate code length (max 100KB)
  if (code.length > 100000) {
    return res.status(400).json({ message: '代码长度超过限制（最大 100KB）' })
  }

  const problem = await db.get(`SELECT id, samples FROM problems WHERE id = ?`, Number(problemId))
  if (!problem) {
    return res.status(404).json({ message: '题目不存在' })
  }
  const sampleRows = await db.all(
    `SELECT input, output FROM testcases WHERE problem_id = ? AND is_sample = 1 ORDER BY id ASC`,
    Number(problemId)
  )
  const samples = sampleRows.length
    ? sampleRows
    : JSON.parse(problem.samples || '[]')
  if (!samples || samples.length === 0) {
    return res.status(400).json({ message: '暂无样例' })
  }
  const runResult = await runSamples({
    language,
    code: String(code),
    inputs: samples.map((s) => String(s.input ?? '')),
  })
  if (runResult.status !== 'OK') {
    return res.json({
      status: runResult.status,
      message: runResult.message,
      results: [],
    })
  }
  const normalize = (text) => String(text ?? '').replace(/\r\n/g, '\n').trim()
  const results = runResult.results.map((item, index) => {
    const expected = String(samples[index]?.output ?? '')
    const output = String(item.output ?? '')
    if (item.status !== 'OK') {
      return {
        index,
        output,
        expected,
        status: item.status,
        message: item.message,
        timeMs: item.timeMs ?? 0,
      }
    }
    const match = normalize(output) === normalize(expected)
    return {
      index,
      output,
      expected,
      status: match ? 'Accepted' : 'Wrong Answer',
      message: match ? '样例通过' : '样例未通过',
      timeMs: item.timeMs ?? 0,
    }
  })
  const overall = results.every((r) => r.status === 'Accepted')
    ? { status: 'Accepted', message: '全部样例通过' }
    : { status: 'Wrong Answer', message: '存在样例未通过' }
  return res.json({
    ...overall,
    results,
  })
})

app.get('/api/admin/users', async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const { db } = auth
  const users = await db.all(
    `SELECT id, name, is_admin, is_banned, created_at
     FROM users ORDER BY created_at DESC`
  )
  return res.json({
    users: users.map((item) => ({
      id: item.id,
      name: item.name,
      isAdmin: Boolean(item.is_admin),
      isBanned: Boolean(item.is_banned),
      createdAt: item.created_at,
    })),
  })
})

app.post('/api/admin/users', async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const { db } = auth
  const { id, name, password, isAdmin } = req.body || {}
  if (!id || !name || !password) {
    return res.status(400).json({ message: '请填写完整信息' })
  }
  if (password.length < 6) {
    return res.status(400).json({ message: '密码至少 6 位' })
  }
  const existing = await db.get(`SELECT id FROM users WHERE id = ?`, id)
  if (existing) {
    return res.status(409).json({ message: '该 ID 已被注册' })
  }
  const passwordHash = await bcrypt.hash(password, 10)
  await db.run(
    `INSERT INTO users (id, name, password_hash, is_admin, is_banned, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
    id,
    name,
    passwordHash,
    isAdmin ? 1 : 0,
    new Date().toISOString()
  )
  return res.json({ user: { id, name, isAdmin: Boolean(isAdmin), isBanned: false } })
})

app.post('/api/admin/users/:id/promote', async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const { db } = auth
  const targetId = req.params.id
  const target = await db.get(
    `SELECT id, is_admin FROM users WHERE id = ?`,
    targetId
  )
  if (!target) {
    return res.status(404).json({ message: '用户不存在' })
  }
  if (target.is_admin) {
    return res.json({ ok: true })
  }
  await db.run(`UPDATE users SET is_admin = 1 WHERE id = ?`, targetId)
  return res.json({ ok: true })
})

app.post('/api/admin/users/:id/demote', async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const { db } = auth
  const targetId = req.params.id
  const target = await db.get(
    `SELECT id, is_admin FROM users WHERE id = ?`,
    targetId
  )
  if (!target) {
    return res.status(404).json({ message: '用户不存在' })
  }
  if (!target.is_admin) {
    return res.json({ ok: true })
  }
  const adminCount = await db.get(
    `SELECT COUNT(*) as count FROM users WHERE is_admin = 1`
  )
  if (adminCount?.count <= 1) {
    return res.status(400).json({ message: '不能降级最后一个管理员' })
  }
  await db.run(`UPDATE users SET is_admin = 0 WHERE id = ?`, targetId)
  return res.json({ ok: true })
})

app.post('/api/admin/users/:id/reset-password', async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const { db } = auth
  const targetId = req.params.id
  const { password } = req.body || {}
  if (!password) {
    return res.status(400).json({ message: '请输入新密码' })
  }
  if (password.length < 6) {
    return res.status(400).json({ message: '密码至少 6 位' })
  }
  const target = await db.get(`SELECT id FROM users WHERE id = ?`, targetId)
  if (!target) {
    return res.status(404).json({ message: '用户不存在' })
  }
  const passwordHash = await bcrypt.hash(password, 10)
  await db.run(
    `UPDATE users SET password_hash = ? WHERE id = ?`,
    passwordHash,
    targetId
  )
  await db.run(`DELETE FROM sessions WHERE user_id = ?`, targetId)
  return res.json({ ok: true })
})

app.post('/api/admin/users/:id/ban', async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const { db, user: adminUser } = auth
  const targetId = req.params.id
  const { banned } = req.body || {}
  const banValue = banned ? 1 : 0
  const target = await db.get(
    `SELECT id, is_admin, is_banned FROM users WHERE id = ?`,
    targetId
  )
  if (!target) {
    return res.status(404).json({ message: '用户不存在' })
  }
  if (banValue === 1) {
    if (targetId === adminUser.id) {
      return res.status(400).json({ message: '不能封禁自己' })
    }
    if (target.is_admin) {
      const adminCount = await db.get(
        `SELECT COUNT(*) as count FROM users WHERE is_admin = 1`
      )
      if (adminCount?.count <= 1) {
        return res.status(400).json({ message: '不能封禁最后一个管理员' })
      }
    }
  }
  await db.run(`UPDATE users SET is_banned = ? WHERE id = ?`, banValue, targetId)
  if (banValue === 1) {
    await db.run(`DELETE FROM sessions WHERE user_id = ?`, targetId)
  }
  return res.json({ ok: true })
})

app.delete('/api/admin/users/:id', async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const { db, user: adminUser } = auth
  const targetId = req.params.id
  if (targetId === adminUser.id) {
    return res.status(400).json({ message: '不能删除自己' })
  }
  const target = await db.get(
    `SELECT id, is_admin FROM users WHERE id = ?`,
    targetId
  )
  if (!target) {
    return res.status(404).json({ message: '用户不存在' })
  }
  if (target.is_admin) {
    const adminCount = await db.get(
      `SELECT COUNT(*) as count FROM users WHERE is_admin = 1`
    )
    if (adminCount?.count <= 1) {
      return res.status(400).json({ message: '不能删除最后一个管理员' })
    }
  }
  await db.run(`DELETE FROM users WHERE id = ?`, targetId)
  await db.run(`DELETE FROM sessions WHERE user_id = ?`, targetId)
  return res.status(204).end()
})

// User profile and statistics endpoints
app.get('/api/user/profile/:userId', async (req, res) => {
  try {
    const db = await getDb()
    const userId = req.params.userId

    // Get user info
    const user = await db.get(
      `SELECT id, name, avatar, created_at, is_admin FROM users WHERE id = ?`,
      userId
    )
    if (!user) {
      return res.status(404).json({ message: '用户不存在' })
    }

    // Get user stats
    let stats = await db.get(`SELECT * FROM user_stats WHERE user_id = ?`, userId)
    if (!stats) {
      // Initialize stats if not exists
      await db.run(
        `INSERT INTO user_stats (user_id, total_submissions, accepted_count, tried_problems, solved_problems, acceptance_rate, current_streak, max_streak, last_submission_date, rank)
         VALUES (?, 0, 0, 0, 0, 0, 0, 0, NULL, 0)`,
        userId
      )
      stats = await db.get(`SELECT * FROM user_stats WHERE user_id = ?`, userId)
    }

    // Get difficulty stats
    const difficultyStats = await getDifficultyStats(db, userId)

    const levelInfo = getLevelInfo(stats.xp || 0)

    return res.json({
      user: {
        id: user.id,
        name: user.name,
        avatar: user.avatar,
        createdAt: user.created_at,
        isAdmin: user.is_admin === 1,
        ...levelInfo,
      },
      stats: {
        totalSubmissions: stats.total_submissions,
        acceptedCount: stats.accepted_count,
        triedProblems: stats.tried_problems,
        solvedProblems: stats.solved_problems,
        acceptanceRate: stats.acceptance_rate,
        currentStreak: stats.current_streak,
        maxStreak: stats.max_streak,
        xp: stats.xp || 0,
        rank: stats.rank
      },
      difficultyStats
    })
  } catch (error) {
    console.error('Failed to get user profile:', error)
    return res.status(500).json({ message: '获取用户资料失败' })
  }
})

app.get('/api/user/heatmap/:userId', async (req, res) => {
  try {
    const db = await getDb()
    const userId = req.params.userId

    // Check if user exists
    const user = await db.get(`SELECT id FROM users WHERE id = ?`, userId)
    if (!user) {
      return res.status(404).json({ message: '用户不存在' })
    }

    const heatmap = await getHeatmapData(db, userId)

    return res.json({ heatmap })
  } catch (error) {
    console.error('Failed to get heatmap:', error)
    return res.status(500).json({ message: '获取热力图数据失败' })
  }
})

// Rating history for chart
app.get('/api/user/rating-history/:userId', async (req, res) => {
  try {
    const db = await getDb()
    const userId = req.params.userId
    const user = await db.get(`SELECT id FROM users WHERE id = ?`, userId)
    if (!user) {
      return res.status(404).json({ message: '用户不存在' })
    }
    const rows = await db.all(
      `SELECT recorded_at as date, value as rating
       FROM leaderboard_history
       WHERE user_id = ? AND period_type = 'total'
       ORDER BY recorded_at DESC LIMIT 30`,
      userId
    )
    return res.json({ history: rows.reverse() })
  } catch (error) {
    console.error('Failed to get rating history:', error)
    return res.status(500).json({ message: '获取Rating历史失败' })
  }
})

// 获取最近10天的做题统计
app.get('/api/user/weekly-stats/:userId', async (req, res) => {
  try {
    const db = await getDb()
    const userId = req.params.userId

    // Check if user exists
    const user = await db.get(`SELECT id FROM users WHERE id = ?`, userId)
    if (!user) {
      return res.status(404).json({ message: '用户不存在' })
    }

    // 获取最近10天的日期范围
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tenDaysAgo = new Date(today)
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 9)

    const startDate = localDay(tenDaysAgo)
    const endDate = localDay(today)

    // 查询最近10天的活动数据
    const activities = await db.all(
      `SELECT activity_date, submission_count, accepted_count
       FROM daily_activity
       WHERE user_id = ? AND activity_date >= ? AND activity_date <= ?
       ORDER BY activity_date ASC`,
      [userId, startDate, endDate]
    )

    // 创建活动映射
    const activityMap = new Map()
    activities.forEach(a => {
      activityMap.set(a.activity_date, {
        submissions: a.submission_count,
        accepted: a.accepted_count
      })
    })

    // 填充完整的10天数据
    const weeklyStats = []
    for (let i = 0; i < 10; i++) {
      const date = new Date(tenDaysAgo)
      date.setDate(date.getDate() + i)
      const dateStr = date.toISOString().split('T')[0]
      const activity = activityMap.get(dateStr)

      weeklyStats.push({
        date: dateStr,
        submissions: activity?.submissions || 0,
        accepted: activity?.accepted || 0
      })
    }

    return res.json({ weeklyStats })
  } catch (error) {
    console.error('Failed to get weekly stats:', error)
    return res.status(500).json({ message: '获取周统计数据失败' })
  }
})

app.get('/api/user/achievements/:userId', async (req, res) => {
  try {
    const db = await getDb()
    const userId = req.params.userId

    // Check if user exists
    const user = await db.get(`SELECT id FROM users WHERE id = ?`, userId)
    if (!user) {
      return res.status(404).json({ message: '用户不存在' })
    }

    const achievements = await db.all(
      `SELECT achievement_type, achievement_data, unlocked_at
       FROM user_achievements
       WHERE user_id = ?
       ORDER BY unlocked_at DESC`,
      userId
    )

    const formattedAchievements = achievements.map(a => ({
      type: a.achievement_type,
      name: ACHIEVEMENTS[a.achievement_type.toUpperCase()]?.name || a.achievement_type,
      icon: ACHIEVEMENTS[a.achievement_type.toUpperCase()]?.icon || '🏅',
      desc: ACHIEVEMENTS[a.achievement_type.toUpperCase()]?.desc || '',
      unlockedAt: a.unlocked_at,
      data: a.achievement_data ? JSON.parse(a.achievement_data) : {}
    }))

    return res.json({ achievements: formattedAchievements })
  } catch (error) {
    console.error('Failed to get achievements:', error)
    return res.status(500).json({ message: '获取成就数据失败' })
  }
})

app.get('/api/leaderboard', async (req, res) => {
  try {
    const db = await getDb()
    const page = Math.max(Number(req.query.page) || 1, 1)
    const perPage = Math.min(Math.max(Number(req.query.perPage) || 20, 1), 100)
    const offset = (page - 1) * perPage
    const type = req.query.type || 'total' // total, weekly, monthly

    let leaderboard = []
    let total = 0
    let currentUser = null
    let periodStart = null
    let periodEnd = null
    const token = getAuthToken(req)
    const user = token ? await getUserByToken(db, token) : null

    // 获取当前周期的 period_key（用于查找上一次快照）
    const previousPeriodKey = getPreviousPeriodKey(type)
    const applyHistoryRankChanges = async (entries, periodType) => {
      if (!Array.isArray(entries) || entries.length === 0 || !previousPeriodKey) return
      const userIds = [...new Set(entries.map((entry) => entry.user_id).filter(Boolean))]
      if (userIds.length === 0) return
      const placeholders = userIds.map(() => '?').join(', ')
      const rows = await db.all(
        `SELECT user_id, rank
         FROM leaderboard_history
         WHERE period_type = ? AND period_key = ? AND user_id IN (${placeholders})`,
        periodType,
        previousPeriodKey,
        ...userIds
      )
      const historyMap = new Map(rows.map((row) => [row.user_id, row.rank]))
      for (const entry of entries) {
        const previousRank = historyMap.get(entry.user_id) ?? null
        entry.previousRank = previousRank
        entry.rankChange = previousRank === null ? null : entry.rank - previousRank
      }
    }

    if (type === 'total') {
      // 总榜：按等级分排序，过滤封禁用户，DENSE_RANK 同分并列
      const totalResult = await db.get(
        `SELECT COUNT(*) as count
         FROM user_stats us
         JOIN users u ON us.user_id = u.id
         WHERE us.total_submissions > 0 AND u.is_banned = 0`
      )
      total = totalResult.count

      leaderboard = await db.all(
        `SELECT * FROM (
          SELECT
            DENSE_RANK() OVER (ORDER BY u.rating DESC) as rank,
            us.user_id,
            u.name as user_name,
            u.avatar,
            u.rating as value,
            us.solved_problems
           FROM user_stats us
           JOIN users u ON us.user_id = u.id
           WHERE us.total_submissions > 0 AND u.is_banned = 0
         ) ranked
         ORDER BY rank ASC, user_id ASC
         LIMIT ? OFFSET ?`,
        perPage,
        offset
      )

      // 批量获取历史排名
      await applyHistoryRankChanges(leaderboard, 'total')

      // 当前用户排名
      if (user) {
        const userRank = await db.get(
          `SELECT
            (SELECT COUNT(DISTINCT u2.rating) + 1 FROM users u2
             JOIN user_stats us2 ON u2.id = us2.user_id
             WHERE us2.total_submissions > 0 AND u2.is_banned = 0 AND u2.rating > u.rating) as rank,
            u.rating as value
           FROM users u
           JOIN user_stats us ON u.id = us.user_id
           WHERE u.id = ? AND us.total_submissions > 0`,
          user.id
        )
        if (userRank && userRank.rank) {
          const history = await db.get(
            `SELECT rank FROM leaderboard_history
             WHERE user_id = ? AND period_type = 'total' AND period_key = ?`,
            [user.id, previousPeriodKey]
          )
          currentUser = {
            rank: userRank.rank,
            userId: user.id,
            userName: user.name,
            avatar: user.avatar,
            value: userRank.value,
            previousRank: history?.rank || null,
            rankChange: history ? userRank.rank - history.rank : null
          }
        }
      }
    } else if (type === 'weekly') {
      // 周榜：本周通过题目数
      const { startDate, endDate } = getWeekRange()
      periodStart = startDate
      periodEnd = endDate

      const totalResult = await db.get(
        `SELECT COUNT(*) as count FROM (
          SELECT sp.user_id
          FROM solved_problems sp
          JOIN users u ON sp.user_id = u.id
          WHERE sp.first_solved_at >= ? AND sp.first_solved_at < ? AND u.is_banned = 0
          GROUP BY sp.user_id
          HAVING COUNT(DISTINCT sp.problem_id) > 0
        )`,
        startDate, endDate
      )
      total = totalResult.count

      leaderboard = await db.all(
        `SELECT * FROM (
          SELECT
            DENSE_RANK() OVER (ORDER BY COUNT(DISTINCT sp.problem_id) DESC) as rank,
            sp.user_id,
            u.name as user_name,
            u.avatar,
            COUNT(DISTINCT sp.problem_id) as value
           FROM solved_problems sp
           JOIN users u ON sp.user_id = u.id
           WHERE sp.first_solved_at >= ? AND sp.first_solved_at < ? AND u.is_banned = 0
           GROUP BY sp.user_id
           HAVING COUNT(DISTINCT sp.problem_id) > 0
         ) ranked
         ORDER BY rank ASC, user_id ASC
         LIMIT ? OFFSET ?`,
        startDate, endDate, perPage, offset
      )

      // 获取上周排名
      await applyHistoryRankChanges(leaderboard, 'weekly')

      // 当前用户排名
      if (user) {
        const userStats = await db.get(
          `SELECT COUNT(DISTINCT problem_id) as value
           FROM solved_problems
           WHERE user_id = ? AND first_solved_at >= ? AND first_solved_at < ?`,
          user.id, startDate, endDate
        )
        if (userStats && userStats.value > 0) {
          const userRank = await db.get(
            `SELECT COUNT(*) + 1 as rank
             FROM (
               SELECT user_id, COUNT(DISTINCT problem_id) as cnt
               FROM solved_problems sp
               JOIN users u ON sp.user_id = u.id
               WHERE sp.first_solved_at >= ? AND sp.first_solved_at < ? AND u.is_banned = 0
               GROUP BY sp.user_id
               HAVING cnt > ?
             )`,
            startDate, endDate, userStats.value
          )
          const history = await db.get(
            `SELECT rank FROM leaderboard_history
             WHERE user_id = ? AND period_type = 'weekly' AND period_key = ?`,
            [user.id, previousPeriodKey]
          )
          currentUser = {
            rank: userRank.rank,
            userId: user.id,
            userName: user.name,
            avatar: user.avatar,
            value: userStats.value,
            previousRank: history?.rank || null,
            rankChange: history ? userRank.rank - history.rank : null
          }
        }
      }
    } else if (type === 'monthly') {
      // 月榜：本月通过题目数
      const { startDate, endDate } = getMonthRange()
      periodStart = startDate
      periodEnd = endDate

      const totalResult = await db.get(
        `SELECT COUNT(*) as count FROM (
          SELECT sp.user_id
          FROM solved_problems sp
          JOIN users u ON sp.user_id = u.id
          WHERE sp.first_solved_at >= ? AND sp.first_solved_at < ? AND u.is_banned = 0
          GROUP BY sp.user_id
          HAVING COUNT(DISTINCT sp.problem_id) > 0
        )`,
        startDate, endDate
      )
      total = totalResult.count

      leaderboard = await db.all(
        `SELECT * FROM (
          SELECT
            DENSE_RANK() OVER (ORDER BY COUNT(DISTINCT sp.problem_id) DESC) as rank,
            sp.user_id,
            u.name as user_name,
            u.avatar,
            COUNT(DISTINCT sp.problem_id) as value
           FROM solved_problems sp
           JOIN users u ON sp.user_id = u.id
           WHERE sp.first_solved_at >= ? AND sp.first_solved_at < ? AND u.is_banned = 0
           GROUP BY sp.user_id
           HAVING COUNT(DISTINCT sp.problem_id) > 0
         ) ranked
         ORDER BY rank ASC, user_id ASC
         LIMIT ? OFFSET ?`,
        startDate, endDate, perPage, offset
      )

      // 获取上月排名
      await applyHistoryRankChanges(leaderboard, 'monthly')

      // 当前用户排名
      if (user) {
        const userStats = await db.get(
          `SELECT COUNT(DISTINCT problem_id) as value
           FROM solved_problems
           WHERE user_id = ? AND first_solved_at >= ? AND first_solved_at < ?`,
          user.id, startDate, endDate
        )
        if (userStats && userStats.value > 0) {
          const userRank = await db.get(
            `SELECT COUNT(*) + 1 as rank
             FROM (
               SELECT user_id, COUNT(DISTINCT problem_id) as cnt
               FROM solved_problems sp
               JOIN users u ON sp.user_id = u.id
               WHERE sp.first_solved_at >= ? AND sp.first_solved_at < ? AND u.is_banned = 0
               GROUP BY sp.user_id
               HAVING cnt > ?
             )`,
            startDate, endDate, userStats.value
          )
          const history = await db.get(
            `SELECT rank FROM leaderboard_history
             WHERE user_id = ? AND period_type = 'monthly' AND period_key = ?`,
            [user.id, previousPeriodKey]
          )
          currentUser = {
            rank: userRank.rank,
            userId: user.id,
            userName: user.name,
            avatar: user.avatar,
            value: userStats.value,
            previousRank: history?.rank || null,
            rankChange: history ? userRank.rank - history.rank : null
          }
        }
      }
    }

    const totalPages = Math.ceil(total / perPage)

    return res.json({
      leaderboard: leaderboard.map(row => ({
        rank: row.rank,
        userId: row.user_id,
        userName: row.user_name,
        avatar: row.avatar,
        value: row.value,
        solvedCount: row.solved_problems ?? null,
        previousRank: row.previousRank,
        rankChange: row.rankChange
      })),
      currentUser,
      type,
      page,
      perPage,
      total,
      totalPages,
      periodStart,
      periodEnd
    })
  } catch (error) {
    console.error('Failed to get leaderboard:', error)
    return res.status(500).json({ message: '获取排行榜失败' })
  }
})

// ==================== Private Messaging API ====================

// User search for starting new conversations
app.get('/api/users/search', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth

  try {
    const q = (req.query.q || '').trim()
    if (!q || q.length < 1) {
      return res.json({ users: [] })
    }

    const users = await db.all(
      `SELECT id, name, avatar FROM users
       WHERE (id LIKE ? OR name LIKE ?) AND id != ? AND is_banned = 0
       LIMIT 10`,
      `%${q}%`, `%${q}%`, user.id
    )

    res.json({ users })
  } catch (error) {
    console.error('Failed to search users:', error)
    res.status(500).json({ message: '搜索用户失败' })
  }
})

// Rate limiting for message sending (3 seconds cooldown)
const messageRateLimits = new BoundedCache(5000, 3000) // 3 秒过期

// Get or create conversation between two users
const getOrCreateConversation = async (db, userId1, userId2) => {
  const [user1, user2] = userId1 < userId2 ? [userId1, userId2] : [userId2, userId1]
  const now = new Date().toISOString()
  await db.run(
    `INSERT OR IGNORE INTO conversations (user1_id, user2_id, last_message_at, created_at)
     VALUES (?, ?, ?, ?)`,
    user1, user2, now, now
  )

  return db.get(
    `SELECT * FROM conversations WHERE user1_id = ? AND user2_id = ?`,
    user1, user2
  )
}

// Get conversation list with last message and unread count
app.get('/api/messages/conversations', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth

  try {
    const conversations = await db.all(
      `SELECT
        c.id,
        c.last_message_at,
        CASE WHEN c.user1_id = ? THEN c.user2_id ELSE c.user1_id END as other_user_id,
        u.name as other_user_name,
        u.avatar as other_user_avatar,
        lm.id as last_msg_id,
        lm.sender_id as last_msg_sender_id,
        lm.content as last_msg_content,
        lm.created_at as last_msg_created_at,
        COALESCE(unread.count, 0) as unread_count
       FROM conversations c
       JOIN users u ON u.id = CASE WHEN c.user1_id = ? THEN c.user2_id ELSE c.user1_id END
       LEFT JOIN (
         SELECT m1.conversation_id, m1.id, m1.sender_id, m1.content, m1.created_at
         FROM messages m1
         LEFT JOIN message_deletions md1 ON m1.id = md1.message_id AND md1.user_id = ?
         WHERE md1.id IS NULL
           AND m1.created_at = (
             SELECT MAX(m2.created_at) FROM messages m2
             LEFT JOIN message_deletions md2 ON m2.id = md2.message_id AND md2.user_id = ?
             WHERE m2.conversation_id = m1.conversation_id AND md2.id IS NULL
           )
       ) lm ON lm.conversation_id = c.id
       LEFT JOIN (
         SELECT m.conversation_id, COUNT(*) as count
         FROM messages m
         LEFT JOIN message_deletions md ON m.id = md.message_id AND md.user_id = ?
         WHERE m.sender_id != ? AND m.is_read = 0 AND md.id IS NULL
         GROUP BY m.conversation_id
       ) unread ON unread.conversation_id = c.id
       WHERE c.user1_id = ? OR c.user2_id = ?
       ORDER BY c.last_message_at DESC`,
      user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id
    )

    const result = conversations.map(conv => ({
      conversationId: conv.id,
      otherUser: {
        id: conv.other_user_id,
        name: conv.other_user_name,
        avatar: conv.other_user_avatar
      },
      lastMessage: conv.last_msg_id ? {
        id: conv.last_msg_id,
        senderId: conv.last_msg_sender_id,
        content: conv.last_msg_content,
        createdAt: conv.last_msg_created_at
      } : null,
      unreadCount: conv.unread_count,
      lastMessageAt: conv.last_message_at
    }))

    res.json({ conversations: result })
  } catch (error) {
    console.error('Failed to get conversations:', error)
    res.status(500).json({ message: '获取会话列表失败' })
  }
})

// Get messages with a specific user
app.get('/api/messages/conversations/:userId', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth

  try {
    const { userId: otherUserId } = req.params
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(50, Number(req.query.pageSize) || 30)
    const offset = (page - 1) * pageSize

    // Check if other user exists and is not banned
    const otherUser = await db.get(
      `SELECT id, name, avatar, is_banned FROM users WHERE id = ?`,
      otherUserId
    )

    if (!otherUser) {
      return res.status(404).json({ message: '用户不存在' })
    }

    // Get or create conversation
    const conversation = await getOrCreateConversation(db, user.id, otherUserId)

    // Get messages (excluding deleted ones for current user)
    const messages = await db.all(
      `SELECT m.id, m.sender_id, m.content, m.is_read, m.created_at,
              u.name as sender_name, u.avatar as sender_avatar
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       LEFT JOIN message_deletions md ON m.id = md.message_id AND md.user_id = ?
       WHERE m.conversation_id = ? AND md.id IS NULL
       ORDER BY m.created_at DESC
       LIMIT ? OFFSET ?`,
      user.id, conversation.id, pageSize, offset
    )

    // Get total count
    const totalCount = await db.get(
      `SELECT COUNT(*) as count
       FROM messages m
       LEFT JOIN message_deletions md ON m.id = md.message_id AND md.user_id = ?
       WHERE m.conversation_id = ? AND md.id IS NULL`,
      user.id, conversation.id
    )

    // Mark messages as read
    await db.run(
      `UPDATE messages
       SET is_read = 1
       WHERE conversation_id = ? AND sender_id = ? AND is_read = 0`,
      conversation.id, otherUserId
    )

    res.json({
      messages: messages.reverse().map(m => ({
        id: m.id,
        senderId: m.sender_id,
        senderName: m.sender_name,
        senderAvatar: m.sender_avatar,
        content: m.content,
        isRead: m.is_read === 1,
        createdAt: m.created_at
      })),
      otherUser: {
        id: otherUser.id,
        name: otherUser.name,
        avatar: otherUser.avatar,
        isBanned: otherUser.is_banned === 1
      },
      pagination: {
        page,
        pageSize,
        total: totalCount.count,
        totalPages: Math.ceil(totalCount.count / pageSize)
      }
    })
  } catch (error) {
    console.error('Failed to get messages:', error)
    res.status(500).json({ message: '获取消息失败' })
  }
})

// Send a message
app.post('/api/messages/conversations/:userId', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth

  try {
    const { userId: otherUserId } = req.params
    const { content } = req.body

    // Validate
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ message: '消息内容不能为空' })
    }

    if (content.length > 2000) {
      return res.status(400).json({ message: '消息内容不能超过 2000 字符' })
    }

    if (otherUserId === user.id) {
      return res.status(400).json({ message: '不能给自己发消息' })
    }

    // 黑名单拦截：任一方拉黑对方都不能发私信
    const blockCheck = await db.get(
      `SELECT 1 FROM blocks
       WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)
       LIMIT 1`,
      user.id, otherUserId, otherUserId, user.id
    )
    if (blockCheck) {
      const blockedByThem = await db.get(
        `SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?`,
        otherUserId, user.id
      )
      return res.status(403).json({
        message: blockedByThem ? '对方已屏蔽你，无法发送消息' : '你已屏蔽对方，无法发送消息',
      })
    }

    // Check rate limit (3 seconds cooldown, BoundedCache TTL handles expiry)
    const now = Date.now()
    if (messageRateLimits.has(user.id)) {
      return res.status(429).json({ message: '请等待几秒后再发送' })
    }

    // Check if other user exists and is not banned
    const otherUser = await db.get(
      `SELECT id, is_banned FROM users WHERE id = ?`,
      otherUserId
    )

    if (!otherUser) {
      return res.status(404).json({ message: '用户不存在' })
    }

    if (otherUser.is_banned) {
      return res.status(403).json({ message: '无法向被封禁用户发送消息' })
    }

    // Get or create conversation
    const conversation = await getOrCreateConversation(db, user.id, otherUserId)

    // Sanitize content
    const sanitizedContent = sanitizeHtml(content)

    // Insert message
    const timestamp = new Date().toISOString()
    const result = await db.run(
      `INSERT INTO messages (conversation_id, sender_id, content, is_read, created_at)
       VALUES (?, ?, ?, 0, ?)`,
      conversation.id, user.id, sanitizedContent, timestamp
    )

    // Update conversation last_message_at
    await db.run(
      `UPDATE conversations SET last_message_at = ? WHERE id = ?`,
      timestamp, conversation.id
    )

    // Update rate limit
    messageRateLimits.set(user.id, now)

    res.json({
      message: {
        id: result.lastID,
        senderId: user.id,
        senderName: user.name,
        senderAvatar: user.avatar || null,
        content: sanitizedContent,
        isRead: false,
        createdAt: timestamp
      }
    })
  } catch (error) {
    console.error('Failed to send message:', error)
    res.status(500).json({ message: '发送消息失败' })
  }
})

// Mark messages as read
app.post('/api/messages/conversations/:userId/read', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth

  try {
    const { userId: otherUserId } = req.params

    // Get conversation
    const [user1, user2] = user.id < otherUserId ? [user.id, otherUserId] : [otherUserId, user.id]
    const conversation = await db.get(
      `SELECT id FROM conversations WHERE user1_id = ? AND user2_id = ?`,
      user1, user2
    )

    if (!conversation) {
      return res.json({ success: true })
    }

    // Mark as read
    await db.run(
      `UPDATE messages
       SET is_read = 1
       WHERE conversation_id = ? AND sender_id = ? AND is_read = 0`,
      conversation.id, otherUserId
    )

    res.json({ success: true })
  } catch (error) {
    console.error('Failed to mark as read:', error)
    res.status(500).json({ message: '标记已读失败' })
  }
})

// Get total unread count
app.get('/api/messages/unread-count', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth

  try {
    const result = await db.get(
      `SELECT COUNT(*) as count
       FROM messages m
       JOIN conversations c ON m.conversation_id = c.id
       LEFT JOIN message_deletions md ON m.id = md.message_id AND md.user_id = ?
       WHERE (c.user1_id = ? OR c.user2_id = ?)
         AND m.sender_id != ?
         AND m.is_read = 0
         AND md.id IS NULL`,
      user.id, user.id, user.id, user.id
    )

    res.json({ unreadCount: result.count })
  } catch (error) {
    console.error('Failed to get unread count:', error)
    res.status(500).json({ message: '获取未读数失败' })
  }
})

// SSE unread message count stream
app.get('/api/messages/unread-stream', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  let closed = false
  req.on('close', () => { closed = true; clearInterval(timer) })

  const pushCount = async () => {
    if (closed) return
    try {
      const result = await db.get(
        `SELECT COUNT(*) as count
         FROM messages m
         JOIN conversations c ON m.conversation_id = c.id
         LEFT JOIN message_deletions md ON m.id = md.message_id AND md.user_id = ?
         WHERE (c.user1_id = ? OR c.user2_id = ?)
           AND m.sender_id != ?
           AND m.is_read = 0
           AND md.id IS NULL`,
        user.id, user.id, user.id, user.id
      )
      if (!closed) {
        res.write(`data: ${JSON.stringify({ unreadCount: result.count })}\n\n`)
      }
    } catch {}
  }

  await pushCount()
  const timer = setInterval(pushCount, 15000)
})

// Delete a message
app.delete('/api/messages/:messageId', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth

  try {
    const { messageId } = req.params

    // Get message
    const message = await db.get(
      `SELECT m.*, c.user1_id, c.user2_id
       FROM messages m
       JOIN conversations c ON m.conversation_id = c.id
       WHERE m.id = ?`,
      messageId
    )

    if (!message) {
      return res.status(404).json({ message: '消息不存在' })
    }

    // Check if user is part of the conversation
    if (message.user1_id !== user.id && message.user2_id !== user.id) {
      return res.status(403).json({ message: '无权删除此消息' })
    }

    // Check if message was sent within 2 minutes
    const messageTime = new Date(message.created_at).getTime()
    const now = Date.now()
    const twoMinutes = 2 * 60 * 1000

    if (now - messageTime <= twoMinutes && message.sender_id === user.id) {
      // Within 2 minutes and sender: delete for both users (hard delete)
      await db.run(`DELETE FROM messages WHERE id = ?`, messageId)
      return res.json({ success: true, deletedForBoth: true })
    } else {
      // After 2 minutes or not sender: soft delete (only hide for current user)
      await db.run(
        `INSERT OR IGNORE INTO message_deletions (message_id, user_id, deleted_at)
         VALUES (?, ?, ?)`,
        messageId, user.id, new Date().toISOString()
      )
      return res.json({ success: true, deletedForBoth: false })
    }
  } catch (error) {
    console.error('Failed to delete message:', error)
    res.status(500).json({ message: '删除消息失败' })
  }
})

// Helper functions for date ranges
function getWeekRange() {
  const now = new Date()
  const dayOfWeek = now.getDay() // 0 = Sunday, 1 = Monday, ...
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1 // Monday = 0

  const monday = new Date(now)
  monday.setDate(now.getDate() - diff)
  monday.setHours(0, 0, 0, 0)

  const nextMonday = new Date(monday)
  nextMonday.setDate(monday.getDate() + 7)

  return {
    startDate: monday.toISOString(),
    endDate: nextMonday.toISOString()
  }
}

function getMonthRange() {
  const now = new Date()
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
  firstDay.setHours(0, 0, 0, 0)

  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  nextMonth.setHours(0, 0, 0, 0)

  return {
    startDate: firstDay.toISOString(),
    endDate: nextMonth.toISOString()
  }
}

function getPreviousPeriodKey(type) {
  const now = new Date()
  if (type === 'total') {
    // 总榜：与昨天的快照对比
    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)
    return yesterday.toISOString().split('T')[0]
  } else if (type === 'weekly') {
    // 周榜：与上周的最终快照对比（上周日保存的 key 是上周一日期）
    const dayOfWeek = now.getDay()
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1
    const thisMonday = new Date(now)
    thisMonday.setDate(now.getDate() - diff)
    const lastMonday = new Date(thisMonday)
    lastMonday.setDate(thisMonday.getDate() - 7)
    return lastMonday.toISOString().split('T')[0]
  } else if (type === 'monthly') {
    // 月榜：与上月的最终快照对比（上月末保存的 key 是上月1号日期）
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    return lastMonth.toISOString().split('T')[0]
  }
  return null
}

// Problem Plan endpoints
app.get('/api/problem-plan', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth

  try {
    const plans = await db.all(
      `SELECT pp.id, pp.problem_id, pp.added_at, pp.completed, pp.completed_at,
              p.title, p.difficulty, p.slug
       FROM problem_plan pp
       JOIN problems p ON pp.problem_id = p.id
       WHERE pp.user_id = ?
       ORDER BY pp.completed ASC, pp.added_at DESC`,
      user.id
    )

    return res.json({ plans })
  } catch (error) {
    console.error('Failed to get problem plan:', error)
    return res.status(500).json({ message: '获取做题计划失败' })
  }
})

app.post('/api/problem-plan', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  const { problemId } = req.body

  if (!problemId) {
    return res.status(400).json({ message: '缺少题目ID' })
  }

  try {
    // Check if problem exists
    const problem = await db.get(`SELECT id FROM problems WHERE id = ?`, problemId)
    if (!problem) {
      return res.status(404).json({ message: '题目不存在' })
    }

    // Check if already in plan
    const existing = await db.get(
      `SELECT id FROM problem_plan WHERE user_id = ? AND problem_id = ?`,
      user.id,
      problemId
    )

    if (existing) {
      return res.status(400).json({ message: '该题目已在计划中' })
    }

    const now = new Date().toISOString()
    const result = await db.run(
      `INSERT INTO problem_plan (user_id, problem_id, added_at, completed)
       VALUES (?, ?, ?, 0)`,
      user.id,
      problemId,
      now
    )

    return res.json({ id: result.lastID, message: '已添加到做题计划' })
  } catch (error) {
    console.error('Failed to add to problem plan:', error)
    return res.status(500).json({ message: '添加到做题计划失败' })
  }
})

app.delete('/api/problem-plan/:id', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  const planId = req.params.id

  try {
    const plan = await db.get(
      `SELECT id FROM problem_plan WHERE id = ? AND user_id = ?`,
      planId,
      user.id
    )

    if (!plan) {
      return res.status(404).json({ message: '计划项不存在' })
    }

    await db.run(`DELETE FROM problem_plan WHERE id = ?`, planId)

    return res.json({ message: '已从做题计划移除' })
  } catch (error) {
    console.error('Failed to remove from problem plan:', error)
    return res.status(500).json({ message: '移除失败' })
  }
})

app.put('/api/problem-plan/:id/complete', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  const planId = req.params.id
  const { completed } = req.body

  try {
    const plan = await db.get(
      `SELECT id FROM problem_plan WHERE id = ? AND user_id = ?`,
      planId,
      user.id
    )

    if (!plan) {
      return res.status(404).json({ message: '计划项不存在' })
    }

    const now = completed ? new Date().toISOString() : null
    await db.run(
      `UPDATE problem_plan SET completed = ?, completed_at = ? WHERE id = ?`,
      completed ? 1 : 0,
      now,
      planId
    )

    return res.json({ message: completed ? '已标记为完成' : '已取消完成标记' })
  } catch (error) {
    console.error('Failed to update problem plan:', error)
    return res.status(500).json({ message: '更新失败' })
  }
})

// =============================================
// === Discussion Hall API Routes ===
// =============================================

// === HTML Sanitizer for Discussion content (whitelist-based) ===
const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'em', 'code', 'pre', 'a', 'ul', 'ol', 'li', 'b', 'i',
  'div', 'span', 'h1', 'h2', 'h3', 'blockquote', 'hr', 'table', 'thead', 'tbody',
  'tr', 'th', 'td',
])
const ALLOWED_ATTR_MAP = {
  a: new Set(['href', 'target', 'rel']),
  span: new Set(['class']),
  code: new Set(['class']),
  pre: new Set(['class']),
}
const SAFE_URL_RE = /^(?:https?:\/\/|mailto:|\/(?!\/))/i
// class 白名单：只允许文字大小类与代码语言类
const SAFE_CLASS_RE = /^(?:text-(?:sm|lg|xl)|language-[a-z0-9+-]+)$/i

function sanitizeHtml(html) {
  if (!html) return ''
  // 白名单方式：只保留允许的标签和属性，其余全部转义
  return html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)?\/?>/g, (match, tag, attrStr) => {
    const lower = tag.toLowerCase()
    if (!ALLOWED_TAGS.has(lower)) {
      // 不在白名单中的标签，转义尖括号
      return match.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }
    // 闭合标签直接返回
    if (match.startsWith('</')) return `</${lower}>`
    // 自闭合标签
    if (lower === 'br') return '<br>'
    // 过滤属性：只保留白名单属性
    const allowedAttrs = ALLOWED_ATTR_MAP[lower]
    if (!allowedAttrs || !attrStr || !attrStr.trim()) return `<${lower}>`
    const safeAttrs = []
    const attrRe = /([a-zA-Z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g
    let m
    while ((m = attrRe.exec(attrStr)) !== null) {
      const attrName = m[1].toLowerCase()
      const attrVal = m[2] ?? m[3] ?? m[4] ?? ''
      if (!allowedAttrs.has(attrName)) continue
      // href 必须是安全协议
      if (attrName === 'href' && !SAFE_URL_RE.test(attrVal.trim())) continue
      if (attrName === 'target' && attrVal !== '_blank' && attrVal !== '_self') continue
      if (attrName === 'rel') continue
      if (attrName === 'class' && !SAFE_CLASS_RE.test(attrVal.trim())) continue
      // 转义属性值中的引号
      const escaped = attrVal.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      safeAttrs.push(`${attrName}="${escaped}"`)
    }
    // a 标签强制 rel="noopener noreferrer"
    if (lower === 'a') {
      safeAttrs.push('rel="noopener noreferrer"')
    }
    return safeAttrs.length > 0 ? `<${lower} ${safeAttrs.join(' ')}>` : `<${lower}>`
  })
}

// Rate limiting map for discussion posts
const postRateLimits = new BoundedCache(5000, 10000) // 10 秒过期

// GET /api/discussions - List posts with pagination, sorting, filtering
app.get('/api/discussions', async (req, res) => {
  try {
    const db = await getDb()
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize) || 20))
    const sort = req.query.sort === 'hot' ? 'hot' : 'latest'
    const problemId = req.query.problemId ? parseInt(req.query.problemId) : null
    const search = (req.query.search || '').trim()
    const moduleKey = (req.query.module || '').trim()
    const authorId = (req.query.userId || '').trim()
    const feed = req.query.feed === 'following' ? 'following' : null
    const VALID_MODULES = new Set(['general', 'oj', 'jieya', 'starcode'])

    const where = []
    const params = []

    // 普通讨论列表默认排除题解（题解走专用接口）
    where.push('dp.is_solution = 0')

    if (problemId) {
      where.push('dp.problem_id = ?')
      params.push(problemId)
    }
    if (search) {
      where.push('dp.title LIKE ?')
      params.push(`%${search}%`)
    }
    if (moduleKey && VALID_MODULES.has(moduleKey)) {
      where.push('dp.module_key = ?')
      params.push(moduleKey)
    }
    if (authorId) {
      where.push('dp.user_id = ?')
      params.push(authorId)
    }
    if (feed === 'following') {
      // 关注动态：我关注的人 + 我自己的帖子
      const token = getAuthToken(req)
      const viewer = token ? await getUserByToken(db, token) : null
      if (!viewer) return res.status(401).json({ message: '未登录' })
      where.push(`(dp.user_id = ? OR dp.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?))`)
      params.push(viewer.id, viewer.id)
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const orderSql = sort === 'hot'
      ? 'ORDER BY dp.is_pinned DESC, (dp.like_count * 3 + dp.comment_count * 2 + dp.view_count * 0.1) DESC, dp.created_at DESC'
      : 'ORDER BY dp.is_pinned DESC, dp.created_at DESC'

    const countRow = await db.get(
      `SELECT COUNT(*) as count FROM discussion_posts dp ${whereSql}`,
      ...params
    )
    const total = countRow?.count || 0

    const offset = (page - 1) * pageSize
    const posts = await db.all(
      `SELECT dp.id, dp.user_id, dp.title, dp.content, dp.problem_id, dp.module_key, dp.view_count, dp.like_count,
              dp.comment_count, dp.is_pinned, dp.created_at, dp.updated_at,
              u.name as user_name, u.avatar as user_avatar,
              p.title as problem_title
       FROM discussion_posts dp
       LEFT JOIN users u ON dp.user_id = u.id
       LEFT JOIN problems p ON dp.problem_id = p.id
       ${whereSql} ${orderSql}
       LIMIT ? OFFSET ?`,
      ...params, pageSize, offset
    )

    // Check liked status if user is logged in
    const token = getAuthToken(req)
    let likedSet = new Set()
    if (token) {
      const user = await getUserByToken(db, token)
      if (user) {
        const likes = await db.all(
          `SELECT target_id FROM discussion_likes WHERE user_id = ? AND target_type = 'post'`,
          user.id
        )
        likedSet = new Set(likes.map(l => l.target_id))
      }
    }

    return res.json({
      posts: posts.map(p => ({
        id: p.id, userId: p.user_id, userName: p.user_name, userAvatar: p.user_avatar,
        title: p.title, content: p.content, problemId: p.problem_id, problemTitle: p.problem_title,
        moduleKey: p.module_key || 'general',
        viewCount: p.view_count, likeCount: p.like_count, commentCount: p.comment_count,
        isPinned: Boolean(p.is_pinned), liked: likedSet.has(p.id),
        createdAt: p.created_at, updatedAt: p.updated_at,
      })),
      total,
      page,
      pageSize,
    })
  } catch (error) {
    console.error('Failed to list discussions:', error)
    return res.status(500).json({ message: '获取讨论列表失败' })
  }
})

// GET /api/discussions/:id - Post detail with comment tree
app.get('/api/discussions/:id', async (req, res) => {
  try {
    const db = await getDb()
    const postId = parseInt(req.params.id)
    if (!postId) return res.status(400).json({ message: '无效的帖子ID' })

    const post = await db.get(
      `SELECT dp.*, u.name as user_name, u.avatar as user_avatar,
              p.title as problem_title
       FROM discussion_posts dp
       LEFT JOIN users u ON dp.user_id = u.id
       LEFT JOIN problems p ON dp.problem_id = p.id
       WHERE dp.id = ?`,
      postId
    )
    if (!post) return res.status(404).json({ message: '帖子不存在' })
    post.module_key = post.module_key || 'general'

    // Track unique views by user
    const token = getAuthToken(req)
    let viewUser = null
    if (token) {
      viewUser = await getUserByToken(db, token)
      if (viewUser) {
        const existing = await db.get(
          `SELECT id FROM discussion_views WHERE post_id = ? AND user_id = ?`,
          postId, viewUser.id
        )
        if (!existing) {
          await db.run(
            `INSERT INTO discussion_views (post_id, user_id, created_at) VALUES (?, ?, ?)`,
            postId, viewUser.id, new Date().toISOString()
          )
          await db.run(
            `UPDATE discussion_posts SET view_count = (SELECT COUNT(*) FROM discussion_views WHERE post_id = ?) WHERE id = ?`,
            postId, postId
          )
        }
      }
    }

    // Get all comments for this post
    const comments = await db.all(
      `SELECT dc.*, u.name as user_name, u.avatar as user_avatar
       FROM discussion_comments dc
       LEFT JOIN users u ON dc.user_id = u.id
       WHERE dc.post_id = ?
       ORDER BY dc.created_at ASC`,
      postId
    )

    // Check liked status (reuse viewUser from above)
    let postLiked = false
    let commentLikedSet = new Set()
    if (viewUser) {
      const postLike = await db.get(
        `SELECT id FROM discussion_likes WHERE user_id = ? AND target_type = 'post' AND target_id = ?`,
        viewUser.id, postId
      )
      postLiked = !!postLike
      if (comments.length > 0) {
        const commentLikes = await db.all(
          `SELECT target_id FROM discussion_likes WHERE user_id = ? AND target_type = 'comment' AND target_id IN (${comments.map(() => '?').join(',')})`,
          viewUser.id, ...comments.map(c => c.id)
        )
        commentLikedSet = new Set(commentLikes.map(l => l.target_id))
      }
    }

    // Build comment tree
    const commentMap = new Map()
    const topComments = []
    for (const c of comments) {
      const formatted = {
        id: c.id, postId: c.post_id, userId: c.user_id,
        userName: c.user_name, userAvatar: c.user_avatar,
        content: c.content, parentId: c.parent_id,
        likeCount: c.like_count, liked: commentLikedSet.has(c.id),
        createdAt: c.created_at, replies: [],
      }
      commentMap.set(c.id, formatted)
    }
    for (const c of comments) {
      const formatted = commentMap.get(c.id)
      if (c.parent_id && commentMap.has(c.parent_id)) {
        const parent = commentMap.get(c.parent_id)
        formatted.replyToName = parent.userName
        parent.replies.push(formatted)
      } else {
        topComments.push(formatted)
      }
    }

    return res.json({
      post: {
        id: post.id, userId: post.user_id, userName: post.user_name,
        userAvatar: post.user_avatar, title: post.title, content: post.content,
        problemId: post.problem_id, problemTitle: post.problem_title,
        moduleKey: post.module_key,
        viewCount: post.view_count, likeCount: post.like_count,
        commentCount: post.comment_count, isPinned: Boolean(post.is_pinned),
        isSolution: Boolean(post.is_solution),
        liked: postLiked,
        createdAt: post.created_at, updatedAt: post.updated_at,
      },
      comments: topComments,
    })
  } catch (error) {
    console.error('Failed to get discussion:', error)
    return res.status(500).json({ message: '获取帖子详情失败' })
  }
})

// POST /api/discussions - Create a new post
app.post('/api/discussions', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth

  try {
    // Rate limiting: 10 seconds between posts (BoundedCache TTL handles expiry)
    if (postRateLimits.has(user.id)) {
      return res.status(429).json({ message: '发帖过于频繁，请稍后再试' })
    }

    const { title, content, problemId, moduleKey } = req.body || {}
    if (!title || !title.trim()) return res.status(400).json({ message: '标题不能为空' })
    if (title.trim().length > 200) return res.status(400).json({ message: '标题不能超过200字符' })
    if (!content || !content.trim()) return res.status(400).json({ message: '内容不能为空' })
    if (content.length > 50000) return res.status(400).json({ message: '内容不能超过50000字符' })
    const VALID_MODULES = new Set(['general', 'oj', 'jieya', 'starcode'])
    const module = moduleKey && VALID_MODULES.has(moduleKey) ? moduleKey : 'general'

    // Validate problemId if provided
    if (problemId) {
      const problem = await db.get(`SELECT id FROM problems WHERE id = ?`, problemId)
      if (!problem) return res.status(400).json({ message: '关联的题目不存在' })
    }

    const now = new Date().toISOString()
    const sanitized = sanitizeHtml(content)
    const result = await db.run(
      `INSERT INTO discussion_posts (user_id, title, content, problem_id, module_key, view_count, like_count, comment_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, ?)`,
      user.id, title.trim(), sanitized, problemId || null, module, now, now
    )

    postRateLimits.set(user.id, Date.now())
    await addXp(db, user.id, 20)
    await bumpChatStat(db, user.id, { field: 'post_count', points: 10 })
    await notifyMentions(
      db, content.replace(/<[^>]*>/g, ' '), user.id, 'mention',
      'post', result.lastID, (id) => `在帖子《${String(title).trim().slice(0, 30)}》中提到了你（@${id}）`
    )
    return res.json({ message: '发帖成功', postId: result.lastID })
  } catch (error) {
    console.error('Failed to create discussion:', error)
    return res.status(500).json({ message: '发帖失败' })
  }
})

// PUT /api/discussions/:id - Edit a post (author or admin)
app.put('/api/discussions/:id', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth

  try {
    const postId = parseInt(req.params.id)
    if (!postId) return res.status(400).json({ message: '无效的帖子ID' })

    const post = await db.get(`SELECT * FROM discussion_posts WHERE id = ?`, postId)
    if (!post) return res.status(404).json({ message: '帖子不存在' })
    if (post.user_id !== user.id && !user.is_admin) {
      return res.status(403).json({ message: '无权编辑此帖子' })
    }

    const { title, content, problemId, moduleKey } = req.body || {}
    if (!title || !title.trim()) return res.status(400).json({ message: '标题不能为空' })
    if (title.trim().length > 200) return res.status(400).json({ message: '标题不能超过200字符' })
    if (!content || !content.trim()) return res.status(400).json({ message: '内容不能为空' })
    if (content.length > 50000) return res.status(400).json({ message: '内容不能超过50000字符' })
    const VALID_MODULES = new Set(['general', 'oj', 'jieya', 'starcode'])
    const module = moduleKey && VALID_MODULES.has(moduleKey) ? moduleKey : 'general'

    if (problemId) {
      const problem = await db.get(`SELECT id FROM problems WHERE id = ?`, problemId)
      if (!problem) return res.status(400).json({ message: '关联的题目不存在' })
    }

    const now = new Date().toISOString()
    const sanitized = sanitizeHtml(content)
    await db.run(
      `UPDATE discussion_posts SET title = ?, content = ?, problem_id = ?, module_key = ?, updated_at = ? WHERE id = ?`,
      title.trim(), sanitized, problemId || null, module, now, postId
    )

    return res.json({ message: '编辑成功' })
  } catch (error) {
    console.error('Failed to edit discussion:', error)
    return res.status(500).json({ message: '编辑失败' })
  }
})

// DELETE /api/discussions/:id - Delete a post (author or admin)
app.delete('/api/discussions/:id', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth

  try {
    const postId = parseInt(req.params.id)
    if (!postId) return res.status(400).json({ message: '无效的帖子ID' })

    const post = await db.get(`SELECT * FROM discussion_posts WHERE id = ?`, postId)
    if (!post) return res.status(404).json({ message: '帖子不存在' })
    if (post.user_id !== user.id && !user.is_admin) {
      return res.status(403).json({ message: '无权删除此帖子' })
    }

    await db.run(`DELETE FROM discussion_likes WHERE target_type = 'comment' AND target_id IN (SELECT id FROM discussion_comments WHERE post_id = ?)`, postId)
    await db.run(`DELETE FROM discussion_likes WHERE target_type = 'post' AND target_id = ?`, postId)
    await db.run(`DELETE FROM discussion_comments WHERE post_id = ?`, postId)
    // 级联清理：通知与收藏中指向该帖子的记录
    await db.run(`DELETE FROM notifications WHERE target_type = 'post' AND target_id = ?`, postId)
    await db.run(`DELETE FROM bookmarks WHERE target_type = 'post' AND target_id = ?`, postId)
    await db.run(`DELETE FROM discussion_posts WHERE id = ?`, postId)

    return res.json({ message: '删除成功' })
  } catch (error) {
    console.error('Failed to delete discussion:', error)
    return res.status(500).json({ message: '删除失败' })
  }
})

// POST /api/discussions/:id/pin - 管理员置顶帖子
app.post('/api/discussions/:id/pin', async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const { db } = auth
  try {
    const postId = parseInt(req.params.id)
    if (!postId) return res.status(400).json({ message: '无效的帖子ID' })
    const post = await db.get(`SELECT id FROM discussion_posts WHERE id = ?`, postId)
    if (!post) return res.status(404).json({ message: '帖子不存在' })
    await db.run(
      `UPDATE discussion_posts SET is_pinned = 1, pinned_at = ? WHERE id = ?`,
      new Date().toISOString(),
      postId
    )
    return res.json({ success: true, isPinned: true })
  } catch (error) {
    console.error('Failed to pin discussion:', error)
    return res.status(500).json({ message: '置顶失败' })
  }
})

// DELETE /api/discussions/:id/pin - 管理员取消置顶帖子
app.delete('/api/discussions/:id/pin', async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const { db } = auth
  try {
    const postId = parseInt(req.params.id)
    if (!postId) return res.status(400).json({ message: '无效的帖子ID' })
    const post = await db.get(`SELECT id FROM discussion_posts WHERE id = ?`, postId)
    if (!post) return res.status(404).json({ message: '帖子不存在' })
    await db.run(
      `UPDATE discussion_posts SET is_pinned = 0, pinned_at = NULL WHERE id = ?`,
      postId
    )
    return res.json({ success: true, isPinned: false })
  } catch (error) {
    console.error('Failed to unpin discussion:', error)
    return res.status(500).json({ message: '取消置顶失败' })
  }
})

// POST /api/discussions/:id/comments - Add comment or reply
// 评论 5 秒冷却
const commentRateLimits = new BoundedCache(5000, 5000)

app.post('/api/discussions/:id/comments', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth

  try {
    if (commentRateLimits.has(user.id)) {
      return res.status(429).json({ message: '评论过于频繁，请稍后再试' })
    }
    commentRateLimits.set(user.id, Date.now())
    const postId = parseInt(req.params.id)
    if (!postId) return res.status(400).json({ message: '无效的帖子ID' })

    const post = await db.get(`SELECT id FROM discussion_posts WHERE id = ?`, postId)
    if (!post) return res.status(404).json({ message: '帖子不存在' })

    // 黑名单拦截：帖子作者拉黑了我则不能评论
    const postAuthor = await db.get(`SELECT user_id FROM discussion_posts WHERE id = ?`, postId)
    if (postAuthor && postAuthor.user_id !== user.id) {
      const blocked = await db.get(
        `SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?`,
        postAuthor.user_id, user.id
      )
      if (blocked) return res.status(403).json({ message: '对方已屏蔽你，无法评论' })
    }

    const { content, parentId } = req.body || {}
    if (!content || !content.trim()) return res.status(400).json({ message: '评论内容不能为空' })
    if (content.length > 10000) return res.status(400).json({ message: '评论不能超过10000字符' })

    if (parentId) {
      const parent = await db.get(
        `SELECT id FROM discussion_comments WHERE id = ? AND post_id = ?`,
        parentId, postId
      )
      if (!parent) return res.status(400).json({ message: '回复的评论不存在' })
    }

    const now = new Date().toISOString()
    const sanitized = sanitizeHtml(content)
    const result = await db.run(
      `INSERT INTO discussion_comments (post_id, user_id, content, parent_id, like_count, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`,
      postId, user.id, sanitized, parentId || null, now
    )

    await db.run(
      `UPDATE discussion_posts SET comment_count = comment_count + 1 WHERE id = ?`,
      postId
    )
    await bumpChatStat(db, user.id, { field: 'comment_count', points: 5 })
    await addXp(db, user.id, 5)

    // 通知：评论了帖子作者 / 回复了评论作者 / @提及
    const postRow = await db.get(
      `SELECT user_id, title FROM discussion_posts WHERE id = ?`, postId
    )
    if (postRow && postRow.user_id !== user.id) {
      await createNotification(db, {
        userId: postRow.user_id, actorId: user.id, type: 'comment',
        targetType: 'post', targetId: postId,
        message: `评论了你的帖子《${String(postRow.title).slice(0, 30)}》`,
        push: { title: '新评论', body: `评论了你的帖子《${String(postRow.title).slice(0, 20)}》`, url: `/chat/p/${postId}` },
      })
    }
    if (parentId) {
      const parent = await db.get(
        `SELECT user_id FROM discussion_comments WHERE id = ?`, parentId
      )
      if (parent && parent.user_id !== user.id && parent.user_id !== postRow?.user_id) {
        await createNotification(db, {
          userId: parent.user_id, actorId: user.id, type: 'reply',
          targetType: 'post', targetId: postId,
          message: '回复了你的评论',
          push: { title: '新回复', body: '回复了你的评论', url: `/chat/p/${postId}` },
        })
      }
    }
    await notifyMentions(
      db, content.replace(/<[^>]*>/g, ' '), user.id, 'mention',
      'post', postId, (id) => `在评论中提到了你（@${id}）`
    )

    return res.json({
      message: '评论成功',
      comment: {
        id: result.lastID, postId, userId: user.id,
        userName: user.name, userAvatar: user.avatar,
        content: sanitized, parentId: parentId || null,
        likeCount: 0, liked: false, createdAt: now, replies: [],
      },
    })
  } catch (error) {
    console.error('Failed to add comment:', error)
    return res.status(500).json({ message: '评论失败' })
  }
})

// DELETE /api/discussions/comments/:id - Delete a comment
app.delete('/api/discussions/comments/:id', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth

  try {
    const commentId = parseInt(req.params.id)
    if (!commentId) return res.status(400).json({ message: '无效的评论ID' })

    const comment = await db.get(`SELECT * FROM discussion_comments WHERE id = ?`, commentId)
    if (!comment) return res.status(404).json({ message: '评论不存在' })
    if (comment.user_id !== user.id && !user.is_admin) {
      return res.status(403).json({ message: '无权删除此评论' })
    }

    // Count replies to subtract from comment_count
    const replyCount = await db.get(
      `SELECT COUNT(*) as count FROM discussion_comments WHERE parent_id = ?`,
      commentId
    )
    const totalRemoved = 1 + (replyCount?.count || 0)

    await db.run(`DELETE FROM discussion_likes WHERE target_type = 'comment' AND target_id IN (SELECT id FROM discussion_comments WHERE parent_id = ?)`, commentId)
    await db.run(`DELETE FROM discussion_likes WHERE target_type = 'comment' AND target_id = ?`, commentId)
    await db.run(`DELETE FROM discussion_comments WHERE parent_id = ?`, commentId)
    await db.run(`DELETE FROM discussion_comments WHERE id = ?`, commentId)

    await db.run(
      `UPDATE discussion_posts SET comment_count = MAX(0, comment_count - ?) WHERE id = ?`,
      totalRemoved, comment.post_id
    )

    return res.json({ message: '删除成功' })
  } catch (error) {
    console.error('Failed to delete comment:', error)
    return res.status(500).json({ message: '删除失败' })
  }
})

// POST /api/discussions/like - Toggle like on post or comment
app.post('/api/discussions/like', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth

  try {
    const { targetType, targetId } = req.body || {}
    if (!targetType || !targetId) {
      return res.status(400).json({ message: '参数不完整' })
    }
    if (targetType !== 'post' && targetType !== 'comment') {
      return res.status(400).json({ message: '无效的目标类型' })
    }

    const id = parseInt(targetId)
    if (!id) return res.status(400).json({ message: '无效的目标ID' })

    // Check target exists
    if (targetType === 'post') {
      const post = await db.get(`SELECT id FROM discussion_posts WHERE id = ?`, id)
      if (!post) return res.status(404).json({ message: '帖子不存在' })
    } else {
      const comment = await db.get(`SELECT id FROM discussion_comments WHERE id = ?`, id)
      if (!comment) return res.status(404).json({ message: '评论不存在' })
    }

    const existing = await db.get(
      `SELECT id FROM discussion_likes WHERE user_id = ? AND target_type = ? AND target_id = ?`,
      user.id, targetType, id
    )

    let liked
    if (existing) {
      // Unlike
      await db.run(`DELETE FROM discussion_likes WHERE id = ?`, existing.id)
      const table = targetType === 'post' ? 'discussion_posts' : 'discussion_comments'
      await db.run(`UPDATE ${table} SET like_count = MAX(0, like_count - 1) WHERE id = ?`, id)
      liked = false
    } else {
      // Like
      const now = new Date().toISOString()
      await db.run(
        `INSERT INTO discussion_likes (user_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?)`,
        user.id, targetType, id, now
      )
      const table = targetType === 'post' ? 'discussion_posts' : 'discussion_comments'
      await db.run(`UPDATE ${table} SET like_count = like_count + 1 WHERE id = ?`, id)
      liked = true
    }

    const table = targetType === 'post' ? 'discussion_posts' : 'discussion_comments'
    const updated = await db.get(`SELECT like_count FROM ${table} WHERE id = ?`, id)

    return res.json({ liked, likeCount: updated?.like_count || 0 })
  } catch (error) {
    console.error('Failed to toggle like:', error)
    return res.status(500).json({ message: '操作失败' })
  }
})

// OJ 主页数据 API
// 1. 获取每日推荐题目（基于用户最近做题的标签和难度）
app.get('/api/oj/recommendations', async (req, res) => {
  try {
    const db = await getDb()
    const token = req.headers.authorization?.replace('Bearer ', '')
    let userId = null

    if (token) {
      const session = await db.get(`SELECT user_id FROM sessions WHERE token = ?`, token)
      userId = session?.user_id
    }

    let recommendations = []

    if (userId) {
      // 获取用户最近 AC 的题目（最近 10 题）
      const recentAC = await db.all(
        `SELECT DISTINCT p.id, p.tags, p.difficulty
         FROM submissions s
         JOIN problems p ON s.problem_id = p.id
         WHERE s.user_id = ? AND s.status = 'Accepted' AND p.status = 'published'
         ORDER BY s.created_at DESC
         LIMIT 10`,
        userId
      )

      if (recentAC.length > 0) {
        // 提取所有标签
        const allTags = []
        const difficulties = []
        recentAC.forEach(p => {
          if (p.tags) {
            const tags = p.tags.split(',').map(t => t.trim()).filter(Boolean)
            allTags.push(...tags)
          }
          difficulties.push(p.difficulty)
        })

        // 统计标签频率
        const tagFreq = {}
        allTags.forEach(tag => {
          tagFreq[tag] = (tagFreq[tag] || 0) + 1
        })

        // 获取最常见的标签（前5个）
        const topTags = Object.entries(tagFreq)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([tag]) => tag)

        // 计算平均难度
        const difficultyOrder = ['入门', '普及-', '普及', '提高-', '提高', '省选', 'noi']
        const avgDifficultyIndex = Math.round(
          difficulties.reduce((sum, d) => sum + difficultyOrder.indexOf(d), 0) / difficulties.length
        )
        const targetDifficulties = [
          difficultyOrder[Math.max(0, avgDifficultyIndex - 1)],
          difficultyOrder[avgDifficultyIndex],
          difficultyOrder[Math.min(difficultyOrder.length - 1, avgDifficultyIndex + 1)]
        ].filter(Boolean)

        // 获取用户已 AC 的题目 ID
        const acProblemIds = await db.all(
          `SELECT DISTINCT problem_id FROM submissions WHERE user_id = ? AND status = 'Accepted'`,
          userId
        )
        const acIds = acProblemIds.map(row => row.problem_id)

        // 查找候选题目（包含这些标签之一，难度相近，未AC）
        const placeholders = topTags.map(() => 'tags LIKE ?').join(' OR ')
        const diffPlaceholders = targetDifficulties.map(() => '?').join(',')
        const excludePlaceholders = acIds.map(() => '?').join(',')

        let query = `
          SELECT id, slug, title, difficulty, tags,
                 (SELECT COUNT(*) FROM submissions WHERE problem_id = problems.id AND status = 'Accepted') as ac_count,
                 (SELECT COUNT(*) FROM submissions WHERE problem_id = problems.id) as total_count
          FROM problems
          WHERE status = 'published'
            AND (${placeholders})
            AND difficulty IN (${diffPlaceholders})
        `

        const params = [
          ...topTags.map(tag => `%${tag}%`),
          ...targetDifficulties
        ]

        if (acIds.length > 0) {
          query += ` AND id NOT IN (${excludePlaceholders})`
          params.push(...acIds)
        }

        query += ` ORDER BY RANDOM() LIMIT 20`

        const candidates = await db.all(query, ...params)

        // 计算相似度分数并排序
        const scored = candidates.map(p => {
          const pTags = p.tags ? p.tags.split(',').map(t => t.trim()).filter(Boolean) : []
          const matchCount = pTags.filter(tag => topTags.includes(tag)).length
          return {
            ...p,
            score: matchCount
          }
        })

        // 取前 15 个，随机选 4 个
        const top15 = scored.sort((a, b) => b.score - a.score).slice(0, 15)
        const shuffled = top15.sort(() => Math.random() - 0.5)
        recommendations = shuffled.slice(0, 4)
      }
    }

    // 如果没有推荐结果（新用户或没有AC记录），推荐热门入门题
    if (recommendations.length === 0) {
      recommendations = await db.all(
        `SELECT p.id, p.slug, p.title, p.difficulty, p.tags,
                (SELECT COUNT(*) FROM submissions WHERE problem_id = p.id AND status = 'Accepted') as ac_count,
                (SELECT COUNT(*) FROM submissions WHERE problem_id = p.id) as total_count
         FROM problems p
         WHERE p.status = 'published' AND p.difficulty = '入门'
         ORDER BY (SELECT COUNT(*) FROM submissions WHERE problem_id = p.id) DESC
         LIMIT 4`
      )
    }

    // 格式化返回数据
    const formatted = recommendations.map(p => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      difficulty: p.difficulty,
      tags: p.tags ? p.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      passRate: p.total_count > 0 ? Math.round((p.ac_count / p.total_count) * 100) : 0
    }))

    return res.json({ recommendations: formatted })
  } catch (error) {
    console.error('Failed to get recommendations:', error)
    return res.status(500).json({ message: '获取推荐失败' })
  }
})

// 2. 获取题库概览数据
app.get('/api/oj/overview', async (req, res) => {
  try {
    const db = await getDb()

    // 题库总数
    const totalResult = await db.get(
      `SELECT COUNT(*) as total FROM problems WHERE status = 'published'`
    )
    const total = totalResult?.total || 0

    // 各难度题目数量
    const difficultyStats = await db.all(
      `SELECT difficulty, COUNT(*) as count
       FROM problems
       WHERE status = 'published'
       GROUP BY difficulty`
    )

    const difficulties = {}
    difficultyStats.forEach(row => {
      difficulties[row.difficulty] = row.count
    })

    // 标签热度 Top 10
    const allProblems = await db.all(
      `SELECT tags FROM problems WHERE status = 'published' AND tags IS NOT NULL AND tags != ''`
    )

    const tagFreq = {}
    allProblems.forEach(p => {
      if (p.tags) {
        const tags = p.tags.split(',').map(t => t.trim()).filter(Boolean)
        tags.forEach(tag => {
          tagFreq[tag] = (tagFreq[tag] || 0) + 1
        })
      }
    })

    const topTags = Object.entries(tagFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count }))

    return res.json({
      total,
      difficulties,
      topTags
    })
  } catch (error) {
    console.error('Failed to get overview:', error)
    return res.status(500).json({ message: '获取概览失败' })
  }
})

// 3. 获取热门题目 Top 5（24小时内提交最多）
app.get('/api/oj/hot-problems', async (req, res) => {
  try {
    const db = await getDb()
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const hotProblems = await db.all(
      `SELECT p.id, p.slug, p.title, p.difficulty,
              COUNT(s.id) as submission_count
       FROM problems p
       JOIN submissions s ON p.id = s.problem_id
       WHERE p.status = 'published' AND s.created_at > ?
       GROUP BY p.id
       ORDER BY submission_count DESC
       LIMIT 5`,
      oneDayAgo
    )

    return res.json({ hotProblems })
  } catch (error) {
    console.error('Failed to get hot problems:', error)
    return res.status(500).json({ message: '获取热门题目失败' })
  }
})

// 4. 获取实时动态（最近10条AC记录）
app.get('/api/oj/recent-ac', async (req, res) => {
  try {
    const db = await getDb()

    const recentAC = await db.all(
      `SELECT s.created_at, u.name as user_name, u.avatar, p.id as problem_id, p.title as problem_title
       FROM submissions s
       JOIN users u ON s.user_id = u.id
       JOIN problems p ON s.problem_id = p.id
       WHERE s.status = 'Accepted' AND p.status = 'published'
       ORDER BY s.created_at DESC
       LIMIT 10`
    )

    return res.json({ recentAC })
  } catch (error) {
    console.error('Failed to get recent AC:', error)
    return res.status(500).json({ message: '获取动态失败' })
  }
})

// 5. 获取用户最近未AC的题目（继续上次）
app.get('/api/oj/continue-last', async (req, res) => {
  try {
    const db = await getDb()
    const token = req.headers.authorization?.replace('Bearer ', '')

    if (!token) {
      return res.json({ problem: null })
    }

    const session = await db.get(`SELECT user_id FROM sessions WHERE token = ?`, token)
    if (!session) {
      return res.json({ problem: null })
    }

    // 获取用户最近提交但未AC的题目
    const lastProblem = await db.get(
      `SELECT DISTINCT p.id, p.slug, p.title, p.difficulty, p.tags
       FROM submissions s
       JOIN problems p ON s.problem_id = p.id
       WHERE s.user_id = ?
         AND p.status = 'published'
         AND p.id NOT IN (
           SELECT DISTINCT problem_id
           FROM submissions
           WHERE user_id = ? AND status = 'Accepted'
         )
       ORDER BY s.created_at DESC
       LIMIT 1`,
      session.user_id,
      session.user_id
    )

    if (lastProblem) {
      return res.json({
        problem: {
          id: lastProblem.id,
          slug: lastProblem.slug,
          title: lastProblem.title,
          difficulty: lastProblem.difficulty,
          tags: lastProblem.tags ? lastProblem.tags.split(',').map(t => t.trim()).filter(Boolean) : []
        }
      })
    }

    return res.json({ problem: null })
  } catch (error) {
    console.error('Failed to get continue last:', error)
    return res.status(500).json({ message: '获取失败' })
  }
})

// 6. 随机获取一题（按难度）
app.get('/api/oj/random-problem', async (req, res) => {
  try {
    const db = await getDb()
    const { difficulty } = req.query

    let query = `SELECT id, slug, title, difficulty, tags FROM problems WHERE status = 'published'`
    const params = []

    if (difficulty) {
      query += ` AND difficulty = ?`
      params.push(difficulty)
    }

    query += ` ORDER BY RANDOM() LIMIT 1`

    const problem = await db.get(query, ...params)

    if (!problem) {
      return res.status(404).json({ message: '没有找到题目' })
    }

    return res.json({
      problem: {
        id: problem.id,
        slug: problem.slug,
        title: problem.title,
        difficulty: problem.difficulty,
        tags: problem.tags ? problem.tags.split(',').map(t => t.trim()).filter(Boolean) : []
      }
    })
  } catch (error) {
    console.error('Failed to get random problem:', error)
    return res.status(500).json({ message: '获取失败' })
  }
})

const LEADERBOARD_HISTORY_MIN_INTERVAL_MS = 5 * 60 * 1000
let leaderboardHistoryRunning = false
let leaderboardHistoryQueued = false
let leaderboardHistoryLastRunAt = 0
let leaderboardHistoryTimer = null

const queueLeaderboardHistorySave = (delayMs = 0) => {
  if (leaderboardHistoryTimer) return
  leaderboardHistoryTimer = setTimeout(() => {
    leaderboardHistoryTimer = null
    void saveLeaderboardHistory()
  }, Math.max(0, delayMs))
}

// Save leaderboard history for tracking rank changes
async function saveLeaderboardHistory(force = false) {
  if (leaderboardHistoryRunning) {
    leaderboardHistoryQueued = true
    return
  }

  const nowTs = Date.now()
  const waitMs = LEADERBOARD_HISTORY_MIN_INTERVAL_MS - (nowTs - leaderboardHistoryLastRunAt)
  if (!force && leaderboardHistoryLastRunAt > 0 && waitMs > 0) {
    leaderboardHistoryQueued = true
    queueLeaderboardHistorySave(waitMs)
    return
  }

  leaderboardHistoryRunning = true
  try {
    const db = await getDb()
    const now = new Date()
    const today = now.toISOString().split('T')[0]
    const recordedAt = now.toISOString()

    await db.exec('BEGIN IMMEDIATE')

    // Save total leaderboard (daily)
    const totalLeaderboard = await db.all(
      `SELECT
        DENSE_RANK() OVER (ORDER BY u.rating DESC) as rank,
        us.user_id,
        u.rating as value
       FROM user_stats us
       JOIN users u ON us.user_id = u.id
       WHERE us.total_submissions > 0 AND u.is_banned = 0
       ORDER BY rank ASC
       LIMIT 100`
    )

    for (const entry of totalLeaderboard) {
      await db.run(
        `INSERT OR REPLACE INTO leaderboard_history (user_id, period_type, period_key, rank, value, recorded_at)
         VALUES (?, 'total', ?, ?, ?, ?)`,
        [entry.user_id, today, entry.rank, entry.value, recordedAt]
      )
    }

    // Save weekly leaderboard — 每天都保存当前周的快照，key 为本周一日期
    const { startDate: weekStart, endDate: weekEnd } = getWeekRange()
    const weekKey = weekStart.split('T')[0]

    const weeklyLeaderboard = await db.all(
      `SELECT
        DENSE_RANK() OVER (ORDER BY COUNT(DISTINCT sp.problem_id) DESC) as rank,
        sp.user_id,
        COUNT(DISTINCT sp.problem_id) as value
       FROM solved_problems sp
       JOIN users u ON sp.user_id = u.id
       WHERE sp.first_solved_at >= ? AND sp.first_solved_at < ? AND u.is_banned = 0
       GROUP BY sp.user_id
       HAVING COUNT(DISTINCT sp.problem_id) > 0
       ORDER BY rank ASC
       LIMIT 100`,
      weekStart, weekEnd
    )

    for (const entry of weeklyLeaderboard) {
      await db.run(
        `INSERT OR REPLACE INTO leaderboard_history (user_id, period_type, period_key, rank, value, recorded_at)
         VALUES (?, 'weekly', ?, ?, ?, ?)`,
        [entry.user_id, weekKey, entry.rank, entry.value, recordedAt]
      )
    }

    // Save monthly leaderboard — 每天都保存当前月的快照，key 为本月1号日期
    const { startDate: monthStart, endDate: monthEnd } = getMonthRange()
    const monthKey = monthStart.split('T')[0]

    const monthlyLeaderboard = await db.all(
      `SELECT
        DENSE_RANK() OVER (ORDER BY COUNT(DISTINCT sp.problem_id) DESC) as rank,
        sp.user_id,
        COUNT(DISTINCT sp.problem_id) as value
       FROM solved_problems sp
       JOIN users u ON sp.user_id = u.id
       WHERE sp.first_solved_at >= ? AND sp.first_solved_at < ? AND u.is_banned = 0
       GROUP BY sp.user_id
       HAVING COUNT(DISTINCT sp.problem_id) > 0
       ORDER BY rank ASC
       LIMIT 100`,
      monthStart, monthEnd
    )

    for (const entry of monthlyLeaderboard) {
      await db.run(
        `INSERT OR REPLACE INTO leaderboard_history (user_id, period_type, period_key, rank, value, recorded_at)
         VALUES (?, 'monthly', ?, ?, ?, ?)`,
        [entry.user_id, monthKey, entry.rank, entry.value, recordedAt]
      )
    }

    await db.exec('COMMIT')
    leaderboardHistoryLastRunAt = Date.now()
    console.log('Leaderboard history saved successfully')
  } catch (error) {
    const db = await getDb().catch(() => null)
    if (db) {
      await db.exec('ROLLBACK').catch(() => undefined)
    }
    console.error('Failed to save leaderboard history:', error)
  } finally {
    leaderboardHistoryRunning = false
    if (leaderboardHistoryQueued) {
      leaderboardHistoryQueued = false
      queueLeaderboardHistorySave(leaderboardHistoryLastRunAt === 0 ? 0 : LEADERBOARD_HISTORY_MIN_INTERVAL_MS)
    }
  }
}

// Schedule leaderboard history save (daily at midnight)
function scheduleLeaderboardHistory() {
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(0, 0, 0, 0)

  const timeUntilMidnight = tomorrow - now

  setTimeout(() => {
    void saveLeaderboardHistory(true)
    // Run daily
    setInterval(() => {
      void saveLeaderboardHistory(true)
    }, 24 * 60 * 60 * 1000)
  }, timeUntilMidnight)

  console.log('Leaderboard history scheduler initialized')
}

// ============================================================
// 聊天中心 API（模块频道 / 实时聊天室 / 回应 / 已读 / 在线状态）
// ============================================================

const CHAT_VALID_MODULES = new Set(['general', 'oj', 'jieya', 'starcode'])
const chatRateLimits = new BoundedCache(5000, 1000) // 1 秒发送冷却

// 实时广播：scopeKey = `channel:${key}` | `room:${id}`
const chatStreams = new Map() // scopeKey -> Set<res>
const broadcastToScope = (scopeKey, payload) => {
  const listeners = chatStreams.get(scopeKey)
  if (!listeners) return
  const data = `data: ${JSON.stringify(payload)}\n\n`
  for (const res of listeners) {
    try { res.write(data) } catch { /* 客户端已断开 */ }
  }
}

const touchPresence = async (db, userId) => {
  try {
    await db.run(
      `INSERT INTO user_presence (user_id, last_seen_at) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
      userId, new Date().toISOString()
    )
  } catch { /* 忽略 */ }
}

const PRESENCE_ONLINE_MS = 60 * 1000 // 60 秒内活跃视为在线

const formatChatMessage = (m, myUserId) => ({
  id: m.id,
  senderId: m.sender_id,
  senderName: m.sender_name,
  senderAvatar: m.sender_avatar,
  content: m.content,
  createdAt: m.created_at,
  reactions: m.reactions || [],
  threadParentId: m.thread_parent_id ?? null,
  threadReplyCount: m.thread_reply_count ?? 0,
})

const loadChatMessageRows = async (db, whereSql, params, limit, beforeId) => {
  const beforeClause = beforeId ? 'AND cm.id < ?' : ''
  const rows = await db.all(
    `SELECT cm.*, u.name as sender_name, u.avatar as sender_avatar,
            (SELECT COUNT(*) FROM chat_messages r WHERE r.thread_parent_id = cm.id) as thread_reply_count
     FROM chat_messages cm
     LEFT JOIN users u ON cm.sender_id = u.id
     WHERE ${whereSql} AND cm.thread_parent_id IS NULL ${beforeClause}
     ORDER BY cm.id DESC
     LIMIT ?`,
    ...params, ...(beforeId ? [beforeId] : []), limit
  )
  return rows.reverse()
}

const attachReactions = async (db, messages, myUserId) => {
  if (messages.length === 0) return messages
  const ids = messages.map((m) => m.id)
  const rows = await db.all(
    `SELECT message_id, emoji, COUNT(*) as count,
            SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) as mine
     FROM chat_reactions
     WHERE message_id IN (${ids.map(() => '?').join(',')})
     GROUP BY message_id, emoji`,
    myUserId, ...ids
  )
  const byMessage = new Map()
  for (const row of rows) {
    if (!byMessage.has(row.message_id)) byMessage.set(row.message_id, [])
    byMessage.get(row.message_id).push({
      emoji: row.emoji,
      count: row.count,
      mine: row.mine > 0,
    })
  }
  return messages.map((m) => ({ ...m, reactions: byMessage.get(m.id) || [] }))
}

const getChatUnreadForUser = async (db, user) => {
  // 模块频道的未读 = 该模块下比已读位置更新的帖子数（发帖制板块）
  const channels = await db.all(
    `SELECT cc.key,
            (SELECT COUNT(*) FROM discussion_posts dp
             WHERE dp.module_key = cc.key AND dp.id > COALESCE(
               (SELECT last_read_message_id FROM chat_read_state
                WHERE user_id = ? AND scope_type = 'channel' AND scope_id = cc.key), 0)
               AND dp.user_id != ?) as unread
     FROM chat_channels cc`,
    user.id, user.id
  )
  const rooms = await db.all(
    `SELECT cr.id,
            (SELECT COUNT(*) FROM chat_messages cm
             WHERE cm.room_id = cr.id AND cm.id > COALESCE(
               (SELECT last_read_message_id FROM chat_read_state
                WHERE user_id = ? AND scope_type = 'room' AND scope_id = CAST(cr.id AS TEXT)), 0)
               AND cm.sender_id != ?) as unread
     FROM chat_rooms cr
     WHERE cr.type = 'public'
        OR EXISTS (SELECT 1 FROM chat_room_members m WHERE m.room_id = cr.id AND m.user_id = ?)`,
    user.id, user.id, user.id
  )
  return {
    channels: Object.fromEntries(channels.map((c) => [c.key, c.unread])),
    rooms: Object.fromEntries(rooms.map((r) => [r.id, r.unread])),
    total: channels.reduce((s, c) => s + c.unread, 0) + rooms.reduce((s, r) => s + r.unread, 0),
  }
}

// 聊天流公共封装：校验登录 + 设置 SSE 头 + 注册广播监听
const openChatStream = async (req, res, scopeKey, onClose) => {
  const auth = await requireUser(req, res)
  if (!auth) return null
  const { db, user } = auth
  // 房间流校验：房间存在且（公开 或 成员），避免非成员订阅私密房间
  if (scopeKey.startsWith('room:')) {
    const roomId = parseInt(scopeKey.slice(5), 10)
    const room = roomId ? await db.get(`SELECT * FROM chat_rooms WHERE id = ?`, roomId) : null
    if (!room) {
      if (!res.headersSent) res.status(404).json({ message: '房间不存在' })
      return null
    }
    if (room.type === 'invite') {
      const member = await db.get(
        `SELECT 1 FROM chat_room_members WHERE room_id = ? AND user_id = ?`, roomId, user.id
      )
      if (!member) {
        if (!res.headersSent) res.status(403).json({ message: '需要加入后才能查看' })
        return null
      }
    }
  }
  await touchPresence(db, user.id)

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`)

  let closed = false
  if (!chatStreams.has(scopeKey)) chatStreams.set(scopeKey, new Set())
  chatStreams.get(scopeKey).add(res)

  const ping = setInterval(() => {
    if (closed) return
    try { res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`) } catch { /* ignore */ }
  }, 15000)

  req.on('close', () => {
    closed = true
    clearInterval(ping)
    const set = chatStreams.get(scopeKey)
    if (set) {
      set.delete(res)
      if (set.size === 0) chatStreams.delete(scopeKey)
    }
    onClose?.()
  })
  return { db, user }
}

// ---------- 频道 ----------

app.get('/api/chat/channels', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const channels = await db.all(
      `SELECT cc.key, cc.name, cc.icon, cc.description, cc.sort_order
       FROM chat_channels cc ORDER BY cc.sort_order ASC`
    )
    const unread = await getChatUnreadForUser(db, user)
    return res.json({
      channels: channels.map((c) => ({
        key: c.key, name: c.name, icon: c.icon,
        description: c.description, sortOrder: c.sort_order,
        unread: unread.channels[c.key] || 0,
      })),
    })
  } catch (error) {
    console.error('Failed to list channels:', error)
    return res.status(500).json({ message: '获取频道失败' })
  }
})

// ---------- 聊天室 ----------

app.get('/api/chat/rooms', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const rooms = await db.all(
      `SELECT cr.*, u.name as owner_name,
              (SELECT COUNT(*) FROM chat_room_members m WHERE m.room_id = cr.id) as member_count
       FROM chat_rooms cr
       LEFT JOIN users u ON cr.owner_id = u.id
       WHERE cr.type = 'public'
          OR EXISTS (SELECT 1 FROM chat_room_members m WHERE m.room_id = cr.id AND m.user_id = ?)
       ORDER BY cr.created_at DESC`,
      user.id
    )
    const unread = await getChatUnreadForUser(db, user)
    const members = await db.all(
      `SELECT room_id, user_id FROM chat_room_members WHERE user_id = ?`, user.id
    )
    const joinedIds = new Set(members.map((m) => m.room_id))
    return res.json({
      rooms: rooms.map((r) => ({
        id: r.id, name: r.name, description: r.description,
        type: r.type, ownerId: r.owner_id, ownerName: r.owner_name,
        memberCount: r.member_count, createdAt: r.created_at,
        joined: joinedIds.has(r.id),
        unread: unread.rooms[r.id] || 0,
      })),
    })
  } catch (error) {
    console.error('Failed to list rooms:', error)
    return res.status(500).json({ message: '获取聊天室失败' })
  }
})

app.post('/api/chat/rooms', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const { name, description, type } = req.body || {}
    const roomName = String(name ?? '').trim()
    if (!roomName) return res.status(400).json({ message: '房间名不能为空' })
    if (roomName.length > 60) return res.status(400).json({ message: '房间名不能超过60字符' })
    if (description && String(description).length > 300) {
      return res.status(400).json({ message: '简介不能超过300字符' })
    }
    const roomType = type === 'invite' ? 'invite' : 'public'
    const now = new Date().toISOString()
    const result = await db.run(
      `INSERT INTO chat_rooms (name, description, type, owner_id, created_at) VALUES (?, ?, ?, ?, ?)`,
      roomName, String(description ?? '').trim(), roomType, user.id, now
    )
    await db.run(
      `INSERT INTO chat_room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)`,
      result.lastID, user.id, now
    )
    return res.json({ message: '创建成功', roomId: result.lastID })
  } catch (error) {
    console.error('Failed to create room:', error)
    return res.status(500).json({ message: '创建失败' })
  }
})

const getRoomDetail = async (db, roomId) => {
  const room = await db.get(
    `SELECT cr.*, u.name as owner_name,
            (SELECT COUNT(*) FROM chat_room_members m WHERE m.room_id = cr.id) as member_count
     FROM chat_rooms cr LEFT JOIN users u ON cr.owner_id = u.id
     WHERE cr.id = ?`, roomId
  )
  if (!room) return null
  const members = await db.all(
    `SELECT m.user_id, m.role, m.joined_at, u.name as user_name, u.avatar as user_avatar,
            (SELECT last_seen_at FROM user_presence p WHERE p.user_id = m.user_id) as last_seen_at
     FROM chat_room_members m
     LEFT JOIN users u ON m.user_id = u.id
     WHERE m.room_id = ?
     ORDER BY (m.role = 'owner') DESC, m.joined_at ASC`,
    roomId
  )
  return {
    id: room.id, name: room.name, description: room.description,
    type: room.type, ownerId: room.owner_id, ownerName: room.owner_name,
    memberCount: room.member_count, createdAt: room.created_at,
    members: members.map((m) => ({
      userId: m.user_id, userName: m.user_name, userAvatar: m.user_avatar,
      role: m.role,
      online: Boolean(m.last_seen_at) && Date.now() - new Date(m.last_seen_at).getTime() <= PRESENCE_ONLINE_MS,
    })),
  }
}

app.get('/api/chat/rooms/:id', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const roomId = parseInt(req.params.id)
    if (!roomId) return res.status(400).json({ message: '无效的房间ID' })
    const room = await db.get(`SELECT * FROM chat_rooms WHERE id = ?`, roomId)
    if (!room) return res.status(404).json({ message: '房间不存在' })
    if (room.type === 'invite') {
      const member = await db.get(
        `SELECT role FROM chat_room_members WHERE room_id = ? AND user_id = ?`, roomId, user.id
      )
      if (!member) return res.status(403).json({ message: '这是邀请制房间，需要房主邀请才能加入' })
    }
    const detail = await getRoomDetail(db, roomId)
    const myMembership = detail.members.find((m) => m.userId === user.id)
    return res.json({ room: { ...detail, myRole: myMembership?.role || null } })
  } catch (error) {
    console.error('Failed to get room:', error)
    return res.status(500).json({ message: '获取房间失败' })
  }
})

app.post('/api/chat/rooms/:id/join', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const roomId = parseInt(req.params.id)
    if (!roomId) return res.status(400).json({ message: '无效的房间ID' })
    const room = await db.get(`SELECT * FROM chat_rooms WHERE id = ?`, roomId)
    if (!room) return res.status(404).json({ message: '房间不存在' })
    if (room.type === 'invite') {
      const member = await db.get(
        `SELECT 1 FROM chat_room_members WHERE room_id = ? AND user_id = ?`, roomId, user.id
      )
      if (!member) return res.status(403).json({ message: '这是邀请制房间，需要房主邀请才能加入' })
      return res.json({ message: '已加入', joined: true })
    }
    await db.run(
      `INSERT OR IGNORE INTO chat_room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)`,
      roomId, user.id, new Date().toISOString()
    )
    const detail = await getRoomDetail(db, roomId)
    broadcastToScope(`room:${roomId}`, { type: 'members', members: detail.members })
    return res.json({ message: '已加入房间', joined: true })
  } catch (error) {
    console.error('Failed to join room:', error)
    return res.status(500).json({ message: '加入失败' })
  }
})

app.post('/api/chat/rooms/:id/leave', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const roomId = parseInt(req.params.id)
    if (!roomId) return res.status(400).json({ message: '无效的房间ID' })
    const membership = await db.get(
      `SELECT role FROM chat_room_members WHERE room_id = ? AND user_id = ?`, roomId, user.id
    )
    if (!membership) return res.json({ message: '你不在这个房间里' })
    if (membership.role === 'owner') {
      return res.status(400).json({ message: '房主不能离开，可以解散房间' })
    }
    await db.run(`DELETE FROM chat_room_members WHERE room_id = ? AND user_id = ?`, roomId, user.id)
    const detail = await getRoomDetail(db, roomId)
    broadcastToScope(`room:${roomId}`, { type: 'members', members: detail.members })
    return res.json({ message: '已离开房间' })
  } catch (error) {
    console.error('Failed to leave room:', error)
    return res.status(500).json({ message: '操作失败' })
  }
})

app.delete('/api/chat/rooms/:id', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const roomId = parseInt(req.params.id)
    if (!roomId) return res.status(400).json({ message: '无效的房间ID' })
    const room = await db.get(`SELECT * FROM chat_rooms WHERE id = ?`, roomId)
    if (!room) return res.status(404).json({ message: '房间不存在' })
    if (room.owner_id !== user.id && !user.is_admin) {
      return res.status(403).json({ message: '只有房主可以解散房间' })
    }
    await db.run(`DELETE FROM chat_rooms WHERE id = ?`, roomId)
    await db.run(`DELETE FROM notifications WHERE target_type = 'room' AND target_id = ?`, roomId)
    broadcastToScope(`room:${roomId}`, { type: 'closed' })
    return res.json({ message: '房间已解散' })
  } catch (error) {
    console.error('Failed to delete room:', error)
    return res.status(500).json({ message: '操作失败' })
  }
})

// 房主邀请/移除成员
app.post('/api/chat/rooms/:id/members', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const roomId = parseInt(req.params.id)
    if (!roomId) return res.status(400).json({ message: '无效的房间ID' })
    const { userId } = req.body || {}
    if (!userId) return res.status(400).json({ message: '缺少用户ID' })
    const room = await db.get(`SELECT * FROM chat_rooms WHERE id = ?`, roomId)
    if (!room) return res.status(404).json({ message: '房间不存在' })
    const membership = await db.get(
      `SELECT role FROM chat_room_members WHERE room_id = ? AND user_id = ?`, roomId, user.id
    )
    if (!membership || membership.role !== 'owner') {
      return res.status(403).json({ message: '只有房主可以邀请成员' })
    }
    const target = await db.get(`SELECT id FROM users WHERE id = ?`, userId)
    if (!target) return res.status(404).json({ message: '用户不存在' })
    const inviteResult = await db.run(
      `INSERT OR IGNORE INTO chat_room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)`,
      roomId, userId, new Date().toISOString()
    )
    if (inviteResult.changes > 0) {
      await createNotification(db, {
        userId, actorId: user.id, type: 'invite',
        targetType: 'room', targetId: roomId,
        message: `邀请你加入聊天室《${room.name}》`,
        push: { title: '房间邀请', body: `邀请你加入聊天室《${room.name}》`, url: `/chat/room/${roomId}` },
      })
    }
    const detail = await getRoomDetail(db, roomId)
    broadcastToScope(`room:${roomId}`, { type: 'members', members: detail.members })
    return res.json({ message: '已邀请加入', members: detail.members })
  } catch (error) {
    console.error('Failed to invite member:', error)
    return res.status(500).json({ message: '邀请失败' })
  }
})

app.delete('/api/chat/rooms/:id/members/:userId', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const roomId = parseInt(req.params.id)
    const targetId = req.params.userId
    if (!roomId) return res.status(400).json({ message: '无效的房间ID' })
    const room = await db.get(`SELECT * FROM chat_rooms WHERE id = ?`, roomId)
    if (!room) return res.status(404).json({ message: '房间不存在' })
    const membership = await db.get(
      `SELECT role FROM chat_room_members WHERE room_id = ? AND user_id = ?`, roomId, user.id
    )
    if (!membership || membership.role !== 'owner') {
      return res.status(403).json({ message: '只有房主可以移除成员' })
    }
    if (targetId === room.owner_id) return res.status(400).json({ message: '不能移除房主' })
    await db.run(`DELETE FROM chat_room_members WHERE room_id = ? AND user_id = ?`, roomId, targetId)
    const detail = await getRoomDetail(db, roomId)
    broadcastToScope(`room:${roomId}`, { type: 'members', members: detail.members })
    return res.json({ message: '已移除成员', members: detail.members })
  } catch (error) {
    console.error('Failed to remove member:', error)
    return res.status(500).json({ message: '操作失败' })
  }
})

// 房间消息
app.get('/api/chat/rooms/:id/messages', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const roomId = parseInt(req.params.id)
    if (!roomId) return res.status(400).json({ message: '无效的房间ID' })
    const room = await db.get(`SELECT * FROM chat_rooms WHERE id = ?`, roomId)
    if (!room) return res.status(404).json({ message: '房间不存在' })
    if (room.type === 'invite') {
      const member = await db.get(
        `SELECT 1 FROM chat_room_members WHERE room_id = ? AND user_id = ?`, roomId, user.id
      )
      if (!member) return res.status(403).json({ message: '需要加入后才能查看' })
    }
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50))
    const beforeId = req.query.before ? parseInt(req.query.before) : null
    const rows = await loadChatMessageRows(db, 'cm.room_id = ?', [roomId], limit + 1, beforeId)
    const hasMore = rows.length > limit
    const messages = await attachReactions(db, rows.slice(0, limit), user.id)
    return res.json({ messages: messages.map((m) => formatChatMessage(m, user.id)), hasMore })
  } catch (error) {
    console.error('Failed to load room messages:', error)
    return res.status(500).json({ message: '获取消息失败' })
  }
})

app.post('/api/chat/rooms/:id/messages', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const roomId = parseInt(req.params.id)
    if (!roomId) return res.status(400).json({ message: '无效的房间ID' })
    const room = await db.get(`SELECT * FROM chat_rooms WHERE id = ?`, roomId)
    if (!room) return res.status(404).json({ message: '房间不存在' })
    if (room.type === 'invite') {
      const member = await db.get(
        `SELECT 1 FROM chat_room_members WHERE room_id = ? AND user_id = ?`, roomId, user.id
      )
      if (!member) return res.status(403).json({ message: '需要加入后才能发言' })
    }
    const { content } = req.body || {}
    const text = String(content ?? '').trim()
    if (!text) return res.status(400).json({ message: '消息不能为空' })
    if (text.length > 8000) return res.status(400).json({ message: '消息不能超过8000字符' })
    if (chatRateLimits.has(user.id)) return res.status(429).json({ message: '发送过快，请稍后再试' })
    chatRateLimits.set(user.id, Date.now())

    const result = await db.run(
      `INSERT INTO chat_messages (channel_key, room_id, sender_id, content, created_at)
       VALUES (NULL, ?, ?, ?, ?)`,
      roomId, user.id, text, new Date().toISOString()
    )
    await touchPresence(db, user.id)
    const rows = await db.all(
      `SELECT cm.*, u.name as sender_name, u.avatar as sender_avatar
       FROM chat_messages cm LEFT JOIN users u ON cm.sender_id = u.id
       WHERE cm.id = ?`, result.lastID
    )
    await bumpChatStat(db, user.id, { field: 'message_count', points: 1 })
    await addXp(db, user.id, 2)
    const message = formatChatMessage(rows[0], user.id)
    await notifyMentions(
      db, text, user.id, 'mention', 'room', roomId,
      (id) => `在聊天室《${room.name}》中提到了你（@${id}）`
    )
    broadcastToScope(`room:${roomId}`, { type: 'message', message })
    return res.json({ message })
  } catch (error) {
    console.error('Failed to send room message:', error)
    return res.status(500).json({ message: '发送失败' })
  }
})

app.get('/api/chat/rooms/:id/stream', (req, res) => {
  void openChatStream(req, res, `room:${req.params.id}`)
})

// 输入中指示器：广播 typing 事件给同频道的其他连接
app.post('/api/chat/typing', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const { scopeType, scopeId } = req.body || {}
    if ((scopeType !== 'channel' && scopeType !== 'room') || !scopeId) {
      return res.status(400).json({ message: '无效的范围' })
    }
    const scopeKey = scopeType === 'channel' ? `channel:${scopeId}` : `room:${scopeId}`
    await touchPresence(db, user.id)
    broadcastToScope(scopeKey, { type: 'typing', userId: user.id, userName: user.name })
    return res.json({ success: true })
  } catch (error) {
    console.error('Failed to broadcast typing:', error)
    return res.status(500).json({ message: '操作失败' })
  }
})

// 表情回应（切换）

app.post('/api/chat/messages/:id/reactions', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const messageId = parseInt(req.params.id)
    if (!messageId) return res.status(400).json({ message: '无效的消息ID' })
    const { emoji } = req.body || {}
    const cleanEmoji = String(emoji ?? '').trim()
    if (!cleanEmoji || cleanEmoji.length > 16) return res.status(400).json({ message: '无效的表情' })
    const message = await db.get(`SELECT * FROM chat_messages WHERE id = ?`, messageId)
    if (!message) return res.status(404).json({ message: '消息不存在' })
    if (!(await assertChatScopeAccess(db, user, message))) {
      return res.status(403).json({ message: '需要加入后才能操作' })
    }

    const existing = await db.get(
      `SELECT id FROM chat_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?`,
      messageId, user.id, cleanEmoji
    )
    if (existing) {
      await db.run(`DELETE FROM chat_reactions WHERE id = ?`, existing.id)
    } else {
      await db.run(
        `INSERT INTO chat_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)`,
        messageId, user.id, cleanEmoji, new Date().toISOString()
      )
      if (message.sender_id !== user.id) {
        await bumpChatStat(db, message.sender_id, { field: 'reaction_received', points: 2 })
      }
    }
    const reactionRows = await db.all(
      `SELECT emoji, COUNT(*) as count,
              SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) as mine
       FROM chat_reactions WHERE message_id = ? GROUP BY emoji`,
      user.id, messageId
    )
    const reactions = reactionRows.map((r) => ({
      emoji: r.emoji, count: r.count, mine: r.mine > 0,
    }))
    const scopeKey = message.channel_key
      ? `channel:${message.channel_key}`
      : `room:${message.room_id}`
    broadcastToScope(scopeKey, { type: 'reaction', messageId, reactions })
    return res.json({ reactions })
  } catch (error) {
    console.error('Failed to toggle reaction:', error)
    return res.status(500).json({ message: '操作失败' })
  }
})

// ---------- 话题线程（消息下开回复串） ----------

// 读取父消息所在 scope，供回复校验与广播使用
const getChatMessageScope = async (db, messageId) => {
  return db.get(
    `SELECT id, channel_key, room_id, sender_id, content FROM chat_messages WHERE id = ?`,
    messageId
  )
}

// 校验用户能否访问消息所在 scope（邀请制房间需为成员）
const assertChatScopeAccess = async (db, user, scopeRow) => {
  if (!scopeRow?.room_id) return true // 频道消息无需校验
  const room = await db.get(`SELECT type FROM chat_rooms WHERE id = ?`, scopeRow.room_id)
  if (!room) return false
  if (room.type === 'public') return true
  const member = await db.get(
    `SELECT 1 FROM chat_room_members WHERE room_id = ? AND user_id = ?`,
    scopeRow.room_id, user.id
  )
  return Boolean(member)
}

app.get('/api/chat/messages/:id/replies', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const messageId = parseInt(req.params.id)
    if (!messageId) return res.status(400).json({ message: '无效的消息ID' })
    const parent = await getChatMessageScope(db, messageId)
    if (!parent) return res.status(404).json({ message: '消息不存在' })
    if (!(await assertChatScopeAccess(db, user, parent))) {
      return res.status(403).json({ message: '需要加入后才能查看' })
    }

    const rows = await db.all(
      `SELECT cm.*, u.name as sender_name, u.avatar as sender_avatar,
              (SELECT COUNT(*) FROM chat_messages r WHERE r.thread_parent_id = cm.id) as thread_reply_count
       FROM chat_messages cm
       LEFT JOIN users u ON cm.sender_id = u.id
       WHERE cm.thread_parent_id = ?
       ORDER BY cm.id ASC
       LIMIT 200`,
      messageId
    )
    const replies = await attachReactions(db, rows, user.id)
    return res.json({ replies: replies.map((m) => formatChatMessage(m, user.id)) })
  } catch (error) {
    console.error('Failed to load thread replies:', error)
    return res.status(500).json({ message: '获取回复失败' })
  }
})

app.post('/api/chat/messages/:id/replies', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const messageId = parseInt(req.params.id)
    if (!messageId) return res.status(400).json({ message: '无效的消息ID' })
    const parent = await getChatMessageScope(db, messageId)
    if (!parent) return res.status(404).json({ message: '消息不存在' })
    if (!(await assertChatScopeAccess(db, user, parent))) {
      return res.status(403).json({ message: '需要加入后才能发言' })
    }

    const { content } = req.body || {}
    const text = String(content ?? '').trim()
    if (!text) return res.status(400).json({ message: '回复不能为空' })
    if (text.length > 8000) return res.status(400).json({ message: '回复不能超过8000字符' })
    if (chatRateLimits.has(user.id)) return res.status(429).json({ message: '发送过快，请稍后再试' })
    chatRateLimits.set(user.id, Date.now())

    const result = await db.run(
      `INSERT INTO chat_messages (channel_key, room_id, sender_id, content, created_at, thread_parent_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      parent.channel_key, parent.room_id, user.id, text, new Date().toISOString(), messageId
    )
    await bumpChatStat(db, user.id, { field: 'reply_count', points: 2 })
    await addXp(db, user.id, 2)
    await touchPresence(db, user.id)
    await notifyMentions(
      db, text, user.id, 'mention',
      parent.channel_key ? 'channel' : 'room', parent.channel_key || parent.room_id,
      (id) => `在一条消息的回复中提到了你（@${id}）`
    )

    const rows = await db.all(
      `SELECT cm.*, u.name as sender_name, u.avatar as sender_avatar, 0 as thread_reply_count
       FROM chat_messages cm LEFT JOIN users u ON cm.sender_id = u.id
       WHERE cm.id = ?`, result.lastID
    )
    const reply = formatChatMessage(rows[0], user.id)
    const scopeKey = parent.channel_key ? `channel:${parent.channel_key}` : `room:${parent.room_id}`
    broadcastToScope(scopeKey, { type: 'thread_reply', message: reply })
    return res.json({ reply })
  } catch (error) {
    console.error('Failed to reply in thread:', error)
    return res.status(500).json({ message: '回复失败' })
  }
})

// ---------- 聊天室邀请链接 ----------

app.post('/api/chat/rooms/:id/invite-link', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const roomId = parseInt(req.params.id)
    const room = await db.get(`SELECT * FROM chat_rooms WHERE id = ?`, roomId)
    if (!room) return res.status(404).json({ message: '房间不存在' })
    if (room.owner_id !== user.id && !user.is_admin) {
      return res.status(403).json({ message: '只有房主可以生成邀请链接' })
    }
    const { expiresInHours, maxUses } = req.body || {}
    const maxUsesClean = Math.min(100, Math.max(1, parseInt(maxUses) || 1))
    const expiresHours = Math.min(720, Math.max(1, parseInt(expiresInHours) || 24))
    const expiresAt = new Date(Date.now() + expiresHours * 3600 * 1000).toISOString()
    const token = randomBytes(16).toString('hex')
    await db.run(
      `INSERT INTO room_invite_links (room_id, token, created_by, expires_at, max_uses, use_count, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
      roomId, token, user.id, expiresAt, maxUsesClean, new Date().toISOString()
    )
    return res.json({ message: '邀请链接已生成', token, expiresAt, maxUses: maxUsesClean })
  } catch (error) {
    console.error('Failed to create invite link:', error)
    return res.status(500).json({ message: '生成失败' })
  }
})

// 邀请链接信息（未登录可查，用于展示房间名）
app.get('/api/chat/rooms/invite/:token', async (req, res) => {
  try {
    const db = await getDb()
    const link = await db.get(
      `SELECT l.*, cr.name as room_name, cr.type as room_type,
              u.name as owner_name
       FROM room_invite_links l
       JOIN chat_rooms cr ON cr.id = l.room_id
       LEFT JOIN users u ON u.id = cr.owner_id
       WHERE l.token = ?`, req.params.token
    )
    if (!link) return res.status(404).json({ message: '邀请链接无效或已被使用' })
    if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
      return res.status(410).json({ message: '邀请链接已过期' })
    }
    if (link.use_count >= link.max_uses) {
      return res.status(410).json({ message: '邀请链接已达使用上限' })
    }
    return res.json({
      room: {
        id: link.room_id, name: link.room_name, type: link.room_type,
        ownerName: link.owner_name,
      },
    })
  } catch (error) {
    console.error('Failed to get invite link:', error)
    return res.status(500).json({ message: '获取失败' })
  }
})

// 通过邀请链接加入房间
app.post('/api/chat/rooms/invite/:token/join', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const link = await db.get(
      `SELECT * FROM room_invite_links WHERE token = ?`, req.params.token
    )
    if (!link) return res.status(404).json({ message: '邀请链接无效或已被使用' })
    if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
      return res.status(410).json({ message: '邀请链接已过期' })
    }
    if (link.use_count >= link.max_uses) {
      return res.status(410).json({ message: '邀请链接已达使用上限' })
    }
    await db.run(
      `INSERT OR IGNORE INTO chat_room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)`,
      link.room_id, user.id, new Date().toISOString()
    )
    await db.run(
      `UPDATE room_invite_links SET use_count = use_count + 1 WHERE id = ?`, link.id
    )
    const room = await db.get(`SELECT name FROM chat_rooms WHERE id = ?`, link.room_id)
    return res.json({ message: `已加入《${room?.name}》`, roomId: link.room_id })
  } catch (error) {
    console.error('Failed to join via invite link:', error)
    return res.status(500).json({ message: '加入失败' })
  }
})

// ---------- 收藏 ----------

app.post('/api/bookmarks', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const { targetType, targetId } = req.body || {}
    const type = targetType === 'problem' ? 'problem' : 'post'
    const id = parseInt(targetId)
    if (!id) return res.status(400).json({ message: '无效的目标' })
    if (type === 'post') {
      const post = await db.get(`SELECT id FROM discussion_posts WHERE id = ?`, id)
      if (!post) return res.status(404).json({ message: '帖子不存在' })
    } else {
      const problem = await db.get(`SELECT id FROM problems WHERE id = ?`, id)
      if (!problem) return res.status(404).json({ message: '题目不存在' })
    }
    const existing = await db.get(
      `SELECT id FROM bookmarks WHERE user_id = ? AND target_type = ? AND target_id = ?`,
      user.id, type, id
    )
    if (existing) {
      await db.run(`DELETE FROM bookmarks WHERE id = ?`, existing.id)
      return res.json({ bookmarked: false })
    }
    await db.run(
      `INSERT INTO bookmarks (user_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?)`,
      user.id, type, id, new Date().toISOString()
    )
    return res.json({ bookmarked: true })
  } catch (error) {
    console.error('Failed to toggle bookmark:', error)
    return res.status(500).json({ message: '操作失败' })
  }
})

app.get('/api/bookmarks', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const targetType = req.query.targetType === 'problem' ? 'problem' : 'post'
    const ids = await db.all(
      `SELECT target_id FROM bookmarks WHERE user_id = ? AND target_type = ? ORDER BY created_at DESC`,
      user.id, targetType
    )
    if (targetType === 'post') {
      if (ids.length === 0) return res.json({ posts: [] })
      const posts = await db.all(
        `SELECT dp.id, dp.title, dp.user_id, dp.comment_count, dp.like_count, dp.created_at,
                u.name as user_name
         FROM discussion_posts dp LEFT JOIN users u ON dp.user_id = u.id
         WHERE dp.id IN (${ids.map(() => '?').join(',')})
         ORDER BY dp.created_at DESC`,
        ...ids.map((row) => row.target_id)
      )
      return res.json({
        posts: posts.map((p) => ({
          id: p.id, title: p.title, userId: p.user_id, userName: p.user_name,
          commentCount: p.comment_count, likeCount: p.like_count, createdAt: p.created_at,
        })),
      })
    }
    return res.json({ problems: ids.map((row) => row.target_id) })
  } catch (error) {
    console.error('Failed to list bookmarks:', error)
    return res.status(500).json({ message: '获取收藏失败' })
  }
})

// 检查单个目标是否已收藏
app.get('/api/bookmarks/status', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const targetType = req.query.targetType === 'problem' ? 'problem' : 'post'
    const targetId = parseInt(req.query.targetId)
    if (!targetId) return res.status(400).json({ message: '无效的目标' })
    const row = await db.get(
      `SELECT 1 FROM bookmarks WHERE user_id = ? AND target_type = ? AND target_id = ?`,
      user.id, targetType, targetId
    )
    return res.json({ bookmarked: Boolean(row) })
  } catch (error) {
    console.error('Failed to get bookmark status:', error)
    return res.status(500).json({ message: '查询失败' })
  }
})

// ---------- 已读状态 ----------

app.post('/api/chat/read', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const { scopeType, scopeId } = req.body || {}
    if (scopeType !== 'channel' && scopeType !== 'room') {
      return res.status(400).json({ message: '无效的范围' })
    }
    if (!scopeId) return res.status(400).json({ message: '缺少范围ID' })
    let maxId = 0
    if (scopeType === 'channel') {
      // 频道已读 = 记录该模块下最新的帖子 id
      if (!CHAT_VALID_MODULES.has(scopeId)) return res.status(400).json({ message: '无效的频道' })
      const maxRow = await db.get(
        `SELECT MAX(id) as max_id FROM discussion_posts WHERE module_key = ?`, scopeId
      )
      maxId = maxRow?.max_id || 0
    } else {
      const maxRow = await db.get(
        `SELECT MAX(id) as max_id FROM chat_messages WHERE room_id = ?`, parseInt(scopeId)
      )
      maxId = maxRow?.max_id || 0
    }
    await db.run(
      `INSERT INTO chat_read_state (user_id, scope_type, scope_id, last_read_message_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, scope_type, scope_id)
       DO UPDATE SET last_read_message_id = MAX(last_read_message_id, excluded.last_read_message_id)`,
      user.id, scopeType, String(scopeId), maxId
    )
    return res.json({ success: true })
  } catch (error) {
    console.error('Failed to mark read:', error)
    return res.status(500).json({ message: '操作失败' })
  }
})

// ---------- 在线状态 ----------

app.post('/api/chat/presence', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  await touchPresence(db, user.id)
  await touchChatActivity(db, user.id)
  return res.json({ success: true })
})

app.get('/api/chat/presence', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db } = auth
  try {
    const ids = String(req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200)
    if (ids.length === 0) return res.json({ online: {} })
    const rows = await db.all(
      `SELECT user_id, last_seen_at FROM user_presence
       WHERE user_id IN (${ids.map(() => '?').join(',')})`,
      ...ids
    )
    const online = {}
    for (const row of rows) {
      online[row.user_id] = Date.now() - new Date(row.last_seen_at).getTime() <= PRESENCE_ONLINE_MS
    }
    return res.json({ online })
  } catch (error) {
    console.error('Failed to get presence:', error)
    return res.status(500).json({ message: '获取在线状态失败' })
  }
})

// ---------- 聊天消息搜索（模块频道 + 可见聊天室） ----------

app.get('/api/chat/search', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const q = (req.query.q || '').trim()
    if (!q) return res.json({ messages: [] })
    const limit = Math.min(30, Math.max(1, parseInt(req.query.limit) || 20))
    const rows = await db.all(
      `SELECT cm.id, cm.channel_key, cm.room_id, cm.sender_id, cm.content, cm.created_at,
              u.name as sender_name, u.avatar as sender_avatar,
              cr.name as room_name
       FROM chat_messages cm
       LEFT JOIN users u ON cm.sender_id = u.id
       LEFT JOIN chat_rooms cr ON cm.room_id = cr.id
       WHERE cm.content LIKE ?
         AND (cm.channel_key IS NOT NULL
              OR cm.room_id IN (
                SELECT id FROM chat_rooms WHERE type = 'public'
                UNION
                SELECT room_id FROM chat_room_members WHERE user_id = ?
              ))
         AND cm.thread_parent_id IS NULL
       ORDER BY cm.id DESC
       LIMIT ?`,
      `%${q}%`, user.id, limit
    )
    return res.json({
      messages: rows.map((m) => ({
        id: m.id,
        channelKey: m.channel_key,
        roomId: m.room_id,
        roomName: m.room_name,
        senderId: m.sender_id,
        senderName: m.sender_name,
        senderAvatar: m.sender_avatar,
        content: m.content,
        createdAt: m.created_at,
      })),
    })
  } catch (error) {
    console.error('Failed to search chat messages:', error)
    return res.status(500).json({ message: '搜索失败' })
  }
})

// 未读汇总

app.get('/api/chat/unread', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    return res.json(await getChatUnreadForUser(db, user))
  } catch (error) {
    console.error('Failed to get chat unread:', error)
    return res.status(500).json({ message: '获取未读失败' })
  }
})

// ============================================================
// 好友系统 API（互相关注即成为好友）
// ============================================================

const getFollowRelations = async (db, viewerId, targetId) => {
  const [following, followedBy, followerCount, followingCount, friendCount] = await Promise.all([
    db.get(`SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?`, viewerId, targetId),
    db.get(`SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?`, targetId, viewerId),
    db.get(`SELECT COUNT(*) as c FROM follows WHERE followee_id = ?`, targetId),
    db.get(`SELECT COUNT(*) as c FROM follows WHERE follower_id = ?`, targetId),
    db.get(
      `SELECT COUNT(*) as c FROM follows f1
       JOIN follows f2 ON f1.followee_id = f2.follower_id AND f2.followee_id = ?
       WHERE f1.follower_id = ?`,
      targetId, targetId
    ),
  ])
  const isFollowing = Boolean(following)
  const isFollowedBy = Boolean(followedBy)
  return {
    following: isFollowing,
    followedBy: isFollowedBy,
    isFriend: isFollowing && isFollowedBy,
    followerCount: followerCount?.c || 0,
    followingCount: followingCount?.c || 0,
    friendCount: friendCount?.c || 0,
  }
}

// 用户档案（登录可选：未登录时 relations 全部为空）
app.get('/api/users/:id/profile', async (req, res) => {
  try {
    const db = await getDb()
    const targetId = req.params.id
    const target = await db.get(
      `SELECT id, name, avatar, is_admin, bio, created_at FROM users WHERE id = ?`, targetId
    )
    if (!target) return res.status(404).json({ message: '用户不存在' })

    const token = getAuthToken(req)
    let viewer = null
    if (token) viewer = await getUserByToken(db, token)
    if (viewer && viewer.id !== targetId) {
      // 被对方屏蔽时无法查看档案
      const blocked = await db.get(
        `SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?`,
        targetId, viewer.id
      )
      if (blocked) return res.status(403).json({ message: '对方已屏蔽你，无法查看该档案' })
    }
    const relations = viewer
      ? await getFollowRelations(db, viewer.id, targetId)
      : { following: false, followedBy: false, isFriend: false, followerCount: 0, followingCount: 0 }
    const blockedByViewer = viewer ? Boolean(await db.get(
      `SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?`, viewer.id, targetId
    )) : false

    const statsRow = await db.get(`SELECT xp FROM user_stats WHERE user_id = ?`, targetId)
    const levelInfo = getLevelInfo(statsRow?.xp || 0)

    return res.json({
      user: {
        id: target.id, name: target.name, avatar: target.avatar,
        isAdmin: Boolean(target.is_admin), bio: target.bio || '', createdAt: target.created_at,
        ...levelInfo,
      },
      relations,
      blocked: blockedByViewer,
    })
  } catch (error) {
    console.error('Failed to get user profile:', error)
    return res.status(500).json({ message: '获取用户档案失败' })
  }
})

// 修改自己的简介
app.put('/api/me/bio', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const { bio } = req.body || {}
    const cleanBio = String(bio ?? '').trim().slice(0, 200)
    await db.run(`UPDATE users SET bio = ? WHERE id = ?`, cleanBio, user.id)
    return res.json({ message: '简介已更新', bio: cleanBio })
  } catch (error) {
    console.error('Failed to update bio:', error)
    return res.status(500).json({ message: '更新失败' })
  }
})

// 完成新手引导
app.post('/api/me/onboarded', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    await db.run(
      `UPDATE users SET onboarded_at = ? WHERE id = ?`,
      new Date().toISOString(),
      user.id
    )
    return res.json({ success: true, onboarded: true })
  } catch (error) {
    console.error('Failed to mark onboarding done:', error)
    return res.status(500).json({ message: '操作失败' })
  }
})

// ---------- 数据导出 ----------

app.get('/api/me/export', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const [posts, comments, conversations, privateMessages, chatMessages, bookmarks] = await Promise.all([
      db.all(
        `SELECT id, title, content, module_key, problem_id, created_at, updated_at
         FROM discussion_posts WHERE user_id = ? ORDER BY created_at DESC`,
        user.id
      ),
      db.all(
        `SELECT id, post_id, content, parent_id, created_at
         FROM discussion_comments WHERE user_id = ? ORDER BY created_at DESC`,
        user.id
      ),
      db.all(
        `SELECT id, user1_id, user2_id, created_at
         FROM conversations WHERE user1_id = ? OR user2_id = ? ORDER BY created_at DESC`,
        user.id, user.id
      ),
      db.all(
        `SELECT m.id, m.conversation_id, m.sender_id, m.content, m.is_read, m.created_at
         FROM messages m
         JOIN conversations c ON m.conversation_id = c.id
         WHERE c.user1_id = ? OR c.user2_id = ?
         ORDER BY m.created_at ASC`,
        user.id, user.id
      ),
      db.all(
        `SELECT id, channel_key, room_id, content, created_at
         FROM chat_messages WHERE sender_id = ? ORDER BY created_at ASC`,
        user.id
      ),
      db.all(
        `SELECT target_type, target_id, created_at
         FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC`,
        user.id
      ),
    ])

    return res.json({
      exportedAt: new Date().toISOString(),
      user: {
        id: user.id,
        name: user.name,
        avatar: user.avatar,
        bio: user.bio || '',
        createdAt: user.created_at,
      },
      posts: posts.map((p) => ({
        id: p.id,
        title: p.title,
        content: p.content,
        moduleKey: p.module_key,
        problemId: p.problem_id,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      })),
      comments: comments.map((c) => ({
        id: c.id,
        postId: c.post_id,
        content: c.content,
        parentId: c.parent_id,
        createdAt: c.created_at,
      })),
      conversations: conversations.map((c) => ({
        id: c.id,
        user1Id: c.user1_id,
        user2Id: c.user2_id,
        createdAt: c.created_at,
      })),
      privateMessages: privateMessages.map((m) => ({
        id: m.id,
        conversationId: m.conversation_id,
        senderId: m.sender_id,
        content: m.content,
        isRead: Boolean(m.is_read),
        createdAt: m.created_at,
      })),
      chatMessages: chatMessages.map((m) => ({
        id: m.id,
        channelKey: m.channel_key,
        roomId: m.room_id,
        content: m.content,
        createdAt: m.created_at,
      })),
      bookmarks: bookmarks.map((b) => ({
        targetType: b.target_type,
        targetId: b.target_id,
        createdAt: b.created_at,
      })),
    })
  } catch (error) {
    console.error('Failed to export user data:', error)
    return res.status(500).json({ message: '导出失败' })
  }
})

// ---------- 黑名单 ----------

app.post('/api/users/:id/block', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const targetId = req.params.id
    if (targetId === user.id) return res.status(400).json({ message: '不能屏蔽自己' })
    const target = await db.get(`SELECT id FROM users WHERE id = ?`, targetId)
    if (!target) return res.status(404).json({ message: '用户不存在' })
    await db.run(
      `INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)`,
      user.id, targetId, new Date().toISOString()
    )
    // 屏蔽时自动解除相互关注
    await db.run(`DELETE FROM follows WHERE (follower_id = ? AND followee_id = ?) OR (follower_id = ? AND followee_id = ?)`,
      user.id, targetId, targetId, user.id)
    return res.json({ message: '已屏蔽对方', blocked: true })
  } catch (error) {
    console.error('Failed to block user:', error)
    return res.status(500).json({ message: '操作失败' })
  }
})

app.delete('/api/users/:id/block', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const targetId = req.params.id
    await db.run(`DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?`, user.id, targetId)
    return res.json({ message: '已取消屏蔽', blocked: false })
  } catch (error) {
    console.error('Failed to unblock user:', error)
    return res.status(500).json({ message: '操作失败' })
  }
})

app.get('/api/me/blocks', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const rows = await db.all(
      `SELECT b.blocked_id as id, u.name, u.avatar, b.created_at
       FROM blocks b JOIN users u ON u.id = b.blocked_id
       WHERE b.blocker_id = ?
       ORDER BY b.created_at DESC`,
      user.id
    )
    return res.json({ users: rows })
  } catch (error) {
    console.error('Failed to list blocks:', error)
    return res.status(500).json({ message: '获取屏蔽列表失败' })
  }
})

app.post('/api/users/:id/follow', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const targetId = req.params.id
    if (targetId === user.id) return res.status(400).json({ message: '不能关注自己' })
    const target = await db.get(`SELECT id FROM users WHERE id = ? AND is_banned = 0`, targetId)
    if (!target) return res.status(404).json({ message: '用户不存在' })
    const followResult = await db.run(
      `INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)`,
      user.id, targetId, new Date().toISOString()
    )
    if (followResult.changes > 0) {
      await createNotification(db, {
        userId: targetId, actorId: user.id, type: 'follow',
        message: '关注了你',
        push: { title: '新关注', body: '关注了你', url: `/user/${user.id}` },
      })
    }
    const relations = await getFollowRelations(db, user.id, targetId)
    return res.json({ message: relations.isFriend ? '你们已经是好友了' : '关注成功', relations })
  } catch (error) {
    console.error('Failed to follow user:', error)
    return res.status(500).json({ message: '关注失败' })
  }
})

app.delete('/api/users/:id/follow', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const targetId = req.params.id
    await db.run(`DELETE FROM follows WHERE follower_id = ? AND followee_id = ?`, user.id, targetId)
    const relations = await getFollowRelations(db, user.id, targetId)
    return res.json({ message: '已取消关注', relations })
  } catch (error) {
    console.error('Failed to unfollow user:', error)
    return res.status(500).json({ message: '取消关注失败' })
  }
})

const formatFollowUser = (row) => ({
  id: row.id,
  name: row.name,
  avatar: row.avatar,
  online: Boolean(row.last_seen_at) && Date.now() - new Date(row.last_seen_at).getTime() <= PRESENCE_ONLINE_MS,
})

// 我的好友（互相关注）
app.get('/api/me/friends', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const rows = await db.all(
      `SELECT f1.followee_id as id, u.name, u.avatar, p.last_seen_at
       FROM follows f1
       JOIN follows f2 ON f1.followee_id = f2.follower_id AND f2.followee_id = ?
       JOIN users u ON u.id = f1.followee_id
       LEFT JOIN user_presence p ON p.user_id = u.id
       WHERE f1.follower_id = ?
       ORDER BY p.last_seen_at DESC, f1.created_at DESC`,
      user.id, user.id
    )
    return res.json({ friends: rows.map(formatFollowUser) })
  } catch (error) {
    console.error('Failed to list friends:', error)
    return res.status(500).json({ message: '获取好友列表失败' })
  }
})

// 我关注的人
app.get('/api/me/following', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const rows = await db.all(
      `SELECT f.followee_id as id, u.name, u.avatar, p.last_seen_at, f.created_at,
              EXISTS(SELECT 1 FROM follows f2
                     WHERE f2.follower_id = f.followee_id AND f2.followee_id = ?) as is_friend
       FROM follows f
       JOIN users u ON u.id = f.followee_id
       LEFT JOIN user_presence p ON p.user_id = u.id
       WHERE f.follower_id = ?
       ORDER BY f.created_at DESC`,
      user.id, user.id
    )
    return res.json({ users: rows.map((row) => ({ ...formatFollowUser(row), isFriend: Boolean(row.is_friend), followedAt: row.created_at })) })
  } catch (error) {
    console.error('Failed to list following:', error)
    return res.status(500).json({ message: '获取关注列表失败' })
  }
})

// 我的粉丝
app.get('/api/me/followers', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const rows = await db.all(
      `SELECT f.follower_id as id, u.name, u.avatar, p.last_seen_at, f.created_at,
              EXISTS(SELECT 1 FROM follows f2
                     WHERE f2.follower_id = ? AND f2.followee_id = f.follower_id) as is_friend
       FROM follows f
       JOIN users u ON u.id = f.follower_id
       LEFT JOIN user_presence p ON p.user_id = u.id
       WHERE f.followee_id = ?
       ORDER BY f.created_at DESC`,
      user.id, user.id
    )
    return res.json({ users: rows.map((row) => ({ ...formatFollowUser(row), isFriend: Boolean(row.is_friend), followedAt: row.created_at })) })
  } catch (error) {
    console.error('Failed to list followers:', error)
    return res.status(500).json({ message: '获取粉丝列表失败' })
  }
})

// ============================================================
// Web Push 推送通知（浏览器通知）
// VAPID 密钥：优先读环境变量；否则自动生成并保存到 server/.vapid.json
// ============================================================

let vapidKeys = null
const getVapidKeys = () => {
  if (vapidKeys) return vapidKeys
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapidKeys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY }
    return vapidKeys
  }
  const filePath = new URL('./.vapid.json', import.meta.url).pathname
  if (existsSync(filePath)) {
    vapidKeys = JSON.parse(readFileSync(filePath, 'utf8'))
    return vapidKeys
  }
  const generated = webpush.generateVAPIDKeys()
  writeFileSync(filePath, JSON.stringify(generated, null, 2))
  vapidKeys = generated
  return vapidKeys
}

const initPush = () => {
  const keys = getVapidKeys()
  webpush.setVapidDetails('mailto:admin@starstack.local', keys.publicKey, keys.privateKey)
  console.log('Web Push initialized')
}

// 给指定用户的所有订阅发推送；订阅失效（404/410）自动移除
const sendPushToUser = async (db, userId, { title, body, url }) => {
  try {
    const subs = await db.all(
      `SELECT endpoint, keys_json FROM push_subscriptions WHERE user_id = ?`, userId
    )
    if (subs.length === 0) return
    const payload = JSON.stringify({ title, body, url })
    for (const sub of subs) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: JSON.parse(sub.keys_json) }, payload)
      } catch (error) {
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          await db.run(`DELETE FROM push_subscriptions WHERE endpoint = ?`, sub.endpoint)
        }
      }
    }
  } catch {
    // 推送失败不影响主流程
  }
}

app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: getVapidKeys().publicKey })
})

app.post('/api/push/subscribe', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const { subscription } = req.body || {}
    if (!subscription?.endpoint || !subscription?.keys) {
      return res.status(400).json({ message: '无效的订阅信息' })
    }
    await db.run(
      `INSERT OR REPLACE INTO push_subscriptions (user_id, endpoint, keys_json, created_at)
       VALUES (?, ?, ?, ?)`,
      user.id, subscription.endpoint, JSON.stringify(subscription.keys), new Date().toISOString()
    )
    return res.json({ success: true })
  } catch (error) {
    console.error('Failed to save push subscription:', error)
    return res.status(500).json({ message: '保存订阅失败' })
  }
})

app.delete('/api/push/subscribe', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const endpoint = String(req.query.endpoint || '')
    if (endpoint) {
      await db.run(`DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?`, user.id, endpoint)
    } else {
      await db.run(`DELETE FROM push_subscriptions WHERE user_id = ?`, user.id)
    }
    return res.json({ success: true })
  } catch (error) {
    console.error('Failed to remove push subscription:', error)
    return res.status(500).json({ message: '移除订阅失败' })
  }
})

// ============================================================
// 通知中心（关注 / 评论 / 回复 / @提及 / 房间邀请）
// ============================================================

const createNotification = async (db, { userId, actorId, type, targetType, targetId, message, push }) => {
  if (!userId || userId === actorId) return
  try {
    await db.run(
      `INSERT INTO notifications (user_id, actor_id, type, target_type, target_id, message, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      userId, actorId, type, targetType || null, targetId || null, message, new Date().toISOString()
    )
    // 同步发送浏览器推送
    if (push) {
      const actor = await db.get(`SELECT name FROM users WHERE id = ?`, actorId)
      await sendPushToUser(db, userId, {
        title: push.title,
        body: `${actor?.name || '有人'} ${push.body}`,
        url: push.url,
      })
    }
  } catch (error) {
    console.error('Failed to create notification:', error)
  }
}

// 解析文本中的 @用户名/ID 并逐个通知（排除自己）
const MENTION_RE = /@([a-zA-Z0-9_-]{1,32})/g
const notifyMentions = async (db, text, actorId, type, targetType, targetId, messageBuilder) => {
  const ids = new Set()
  let match
  const regex = new RegExp(MENTION_RE.source, 'g')
  while ((match = regex.exec(text)) !== null) ids.add(match[1])
  // @提及推送的目标页
  const mentionUrl = targetType === 'room'
    ? `/chat/room/${targetId}`
    : targetType === 'channel'
      ? `/chat/c/${targetId}`
      : `/chat/p/${targetId}`
  for (const id of ids) {
    if (id === actorId) continue
    const target = await db.get(`SELECT id FROM users WHERE id = ? AND is_banned = 0`, id)
    if (!target) continue
    await createNotification(db, {
      userId: id, actorId, type, targetType, targetId,
      message: messageBuilder(id),
      push: { title: '@提及', body: messageBuilder(id), url: mentionUrl },
    })
  }
}

app.get('/api/notifications', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize) || 20))
    const offset = (page - 1) * pageSize
    const rows = await db.all(
      `SELECT n.*, u.name as actor_name, u.avatar as actor_avatar
       FROM notifications n
       LEFT JOIN users u ON n.actor_id = u.id
       WHERE n.user_id = ?
       ORDER BY n.created_at DESC
       LIMIT ? OFFSET ?`,
      user.id, pageSize, offset
    )
    const countRow = await db.get(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread
       FROM notifications WHERE user_id = ?`,
      user.id
    )
    return res.json({
      notifications: rows.map((n) => ({
        id: n.id,
        type: n.type,
        actor: { id: n.actor_id, name: n.actor_name, avatar: n.actor_avatar },
        message: n.message,
        targetType: n.target_type,
        targetId: n.target_id,
        isRead: Boolean(n.is_read),
        createdAt: n.created_at,
      })),
      unreadCount: countRow?.unread || 0,
      total: countRow?.total || 0,
      page,
      pageSize,
    })
  } catch (error) {
    console.error('Failed to list notifications:', error)
    return res.status(500).json({ message: '获取通知失败' })
  }
})

app.get('/api/notifications/unread-count', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const row = await db.get(
      `SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0`,
      user.id
    )
    return res.json({ unreadCount: row?.count || 0 })
  } catch (error) {
    console.error('Failed to count notifications:', error)
    return res.status(500).json({ message: '获取未读通知失败' })
  }
})

app.post('/api/notifications/read', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const { id, all } = req.body || {}
    if (all) {
      await db.run(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`, user.id)
    } else if (id) {
      await db.run(
        `UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`,
        parseInt(id), user.id
      )
    } else {
      return res.status(400).json({ message: '缺少参数' })
    }
    const row = await db.get(
      `SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0`,
      user.id
    )
    return res.json({ success: true, unreadCount: row?.count || 0 })
  } catch (error) {
    console.error('Failed to mark notifications read:', error)
    return res.status(500).json({ message: '操作失败' })
  }
})

// ============================================================
// 游戏化：聊天统计 / 活跃度 / 聊天成就
// ============================================================

const CHAT_ACHIEVEMENT_DEFS = [
  { type: 'chat_first', name: '初次发声', icon: '💬', desc: '发出第一条聊天消息', check: (s) => s.message_count >= 1 },
  { type: 'chat_100', name: '话痨新星', icon: '🗣️', desc: '累计发送 100 条消息', check: (s) => s.message_count >= 100 },
  { type: 'chat_1000', name: '深空电台', icon: '📡', desc: '累计发送 1000 条消息', check: (s) => s.message_count >= 1000 },
  { type: 'chat_reply_50', name: '接话大师', icon: '↩️', desc: '累计回复 50 条话题线程', check: (s) => s.reply_count >= 50 },
  { type: 'chat_active_10', name: '常驻旅客', icon: '🌙', desc: '累计活跃 10 天', check: (s) => s.active_days >= 10 },
  { type: 'chat_active_30', name: '星际公民', icon: '🪐', desc: '累计活跃 30 天', check: (s) => s.active_days >= 30 },
  { type: 'chat_liked_10', name: '人气磁铁', icon: '🧲', desc: '累计收到 10 个表情回应', check: (s) => s.reaction_received >= 10 },
  { type: 'chat_liked_100', name: '全站红人', icon: '🌟', desc: '累计收到 100 个表情回应', check: (s) => s.reaction_received >= 100 },
  { type: 'chat_post_5', name: '广场作家', icon: '✍️', desc: '累计发布 5 篇帖子', check: (s) => s.post_count >= 5 },
]

// 本地日期 YYYY-MM-DD
const localDay = (date = new Date()) => {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// 按本地时区解析 YYYY-MM-DD，避免 UTC 解析差一天
const parseLocalDate = (str) => {
  const [y, m, d] = String(str).split('-').map(Number)
  return new Date(y, m - 1, d)
}

// 每日签到状态：独立于 AC 连击
const getCheckinStatus = async (db, userId) => {
  const rows = await db.all(
    `SELECT checkin_date FROM daily_checkins WHERE user_id = ? ORDER BY checkin_date DESC`,
    userId
  )
  const today = localDay()
  const checkedToday = rows.some((row) => row.checkin_date === today)

  let currentStreak = 0
  let maxStreak = 0
  if (rows.length > 0) {
    const dates = rows.map((row) => parseLocalDate(row.checkin_date))
    const todayDate = parseLocalDate(today)

    // 当前连续：今天已签到从今天起算；今天未签到但昨天已签到时，连续仍保留（今天还没断）
    let expected = todayDate
    let allowYesterdayGap = true
    let tempStreak = 0
    for (const date of dates) {
      const diffDays = Math.floor((expected - date) / (1000 * 60 * 60 * 24))
      if (diffDays === 0) {
        tempStreak++
        allowYesterdayGap = false
        expected = new Date(date)
        expected.setDate(expected.getDate() - 1)
      } else if (diffDays === 1 && allowYesterdayGap) {
        tempStreak++
        expected = new Date(date)
        expected.setDate(expected.getDate() - 1)
        allowYesterdayGap = false
      } else {
        break
      }
    }
    currentStreak = tempStreak

    // 最长连续
    let tempMax = 1
    for (let i = 0; i < dates.length - 1; i++) {
      const diffDays = Math.floor((dates[i] - dates[i + 1]) / (1000 * 60 * 60 * 24))
      if (diffDays === 1) {
        tempMax++
        maxStreak = Math.max(maxStreak, tempMax)
      } else {
        tempMax = 1
      }
    }
    maxStreak = Math.max(maxStreak, tempMax, currentStreak)
  }

  return {
    checkedToday,
    currentStreak,
    maxStreak,
    totalDays: rows.length,
  }
}

// 我的每日签到状态
app.get('/api/me/checkin', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const status = await getCheckinStatus(db, user.id)
    return res.json(status)
  } catch (error) {
    console.error('Failed to get checkin status:', error)
    return res.status(500).json({ message: '获取签到状态失败' })
  }
})

// 执行每日签到
app.post('/api/me/checkin', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const today = localDay()
    const existing = await db.get(
      `SELECT 1 FROM daily_checkins WHERE user_id = ? AND checkin_date = ?`,
      user.id,
      today
    )
    const alreadyChecked = !!existing
    await db.run(
      `INSERT OR IGNORE INTO daily_checkins (user_id, checkin_date, created_at) VALUES (?, ?, ?)`,
      user.id,
      today,
      new Date().toISOString()
    )
    if (!alreadyChecked) {
      await addXp(db, user.id, 10)
    }
    const status = await getCheckinStatus(db, user.id)
    return res.json({ success: true, alreadyChecked, ...status })
  } catch (error) {
    console.error('Failed to check in:', error)
    return res.status(500).json({ message: '签到失败' })
  }
})

// 累计活跃天数（从活跃日志去重计数）
const countActiveDays = async (db, userId) => {
  const row = await db.get(
    `SELECT COUNT(*) as c FROM (SELECT DISTINCT day FROM chat_activity_log WHERE user_id = ?)`,
    userId
  )
  return row?.c || 0
}

// 记录聊天行为：更新统计 + 当日活跃分 + 成就判定
const bumpChatStat = async (db, userId, { field, points }) => {
  if (!userId) return
  try {
    await db.run(
      `INSERT INTO chat_stats (user_id, message_count, reply_count, post_count, comment_count, reaction_received, activity_score, last_active_at)
       VALUES (?, 0, 0, 0, 0, 0, 0, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         ${field} = ${field} + 1,
         activity_score = activity_score + ?,
         last_active_at = excluded.last_active_at`,
      userId, new Date().toISOString(), points
    )
    const day = localDay()
    await db.run(
      `INSERT INTO chat_activity_log (user_id, day, score) VALUES (?, ?, ?)
       ON CONFLICT(user_id, day) DO UPDATE SET score = score + excluded.score`,
      userId, day, points
    )
    // 成就判定
    const statRow = await db.get(`SELECT * FROM chat_stats WHERE user_id = ?`, userId)
    if (!statRow) return
    const activeDays = await countActiveDays(db, userId)
    const stats = { ...statRow, active_days: activeDays }
    for (const def of CHAT_ACHIEVEMENT_DEFS) {
      if (def.check(stats)) {
        await db.run(
          `INSERT OR IGNORE INTO chat_achievements (user_id, type, unlocked_at) VALUES (?, ?, ?)`,
          userId, def.type, new Date().toISOString()
        )
      }
    }
  } catch {
    // 统计失败不影响主流程
  }
}

// 心跳时记录活跃（不积分，只计活跃天数）
const touchChatActivity = async (db, userId) => {
  try {
    const day = localDay()
    await db.run(
      `INSERT OR IGNORE INTO chat_activity_log (user_id, day, score) VALUES (?, ?, 0)`,
      userId, day
    )
    await db.run(
      `INSERT INTO chat_stats (user_id, message_count, reply_count, post_count, comment_count, reaction_received, activity_score, last_active_at)
       VALUES (?, 0, 0, 0, 0, 0, 0, ?)
       ON CONFLICT(user_id) DO UPDATE SET last_active_at = excluded.last_active_at`,
      userId, new Date().toISOString()
    )
    // 活跃天数成就
    const activeDays = await countActiveDays(db, userId)
    for (const def of CHAT_ACHIEVEMENT_DEFS) {
      if (def.type.startsWith('chat_active') && def.check({ active_days: activeDays })) {
        await db.run(
          `INSERT OR IGNORE INTO chat_achievements (user_id, type, unlocked_at) VALUES (?, ?, ?)`,
          userId, def.type, new Date().toISOString()
        )
      }
    }
  } catch {
    // 忽略
  }
}

// 我的聊天统计 + 已解锁成就
app.get('/api/chat/stats/me', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const statRow = await db.get(`SELECT * FROM chat_stats WHERE user_id = ?`, user.id)
    const achievements = await db.all(
      `SELECT type, unlocked_at FROM chat_achievements WHERE user_id = ? ORDER BY unlocked_at ASC`,
      user.id
    )
    const activeDays = await countActiveDays(db, user.id)
    return res.json({
      stats: {
        messageCount: statRow?.message_count || 0,
        replyCount: statRow?.reply_count || 0,
        postCount: statRow?.post_count || 0,
        commentCount: statRow?.comment_count || 0,
        reactionReceived: statRow?.reaction_received || 0,
        activityScore: statRow?.activity_score || 0,
        activeDays,
      },
      achievements: achievements.map((a) => ({
        type: a.type,
        ...(CHAT_ACHIEVEMENT_DEFS.find((d) => d.type === a.type) || { name: a.type, icon: '🏅', desc: '' }),
        unlockedAt: a.unlocked_at,
      })),
    })
  } catch (error) {
    console.error('Failed to get chat stats:', error)
    return res.status(500).json({ message: '获取统计失败' })
  }
})

// 他人聊天成就（档案页展示）
app.get('/api/chat/achievements/:userId', async (req, res) => {
  try {
    const db = await getDb()
    const rows = await db.all(
      `SELECT type, unlocked_at FROM chat_achievements WHERE user_id = ? ORDER BY unlocked_at ASC`,
      req.params.userId
    )
    return res.json({
      achievements: rows.map((a) => ({
        type: a.type,
        ...(CHAT_ACHIEVEMENT_DEFS.find((d) => d.type === a.type) || { name: a.type, icon: '🏅', desc: '' }),
        unlockedAt: a.unlocked_at,
      })),
    })
  } catch (error) {
    console.error('Failed to get chat achievements:', error)
    return res.status(500).json({ message: '获取成就失败' })
  }
})

// 社区活跃榜（近 N 天，按活跃分排名）
app.get('/api/chat/activity/leaderboard', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const days = Math.min(30, Math.max(1, parseInt(req.query.days) || 7))
    const since = localDay(new Date(Date.now() - (days - 1) * 86400000))
    const rows = await db.all(
      `SELECT l.user_id, u.name as user_name, u.avatar as user_avatar, SUM(l.score) as score
       FROM chat_activity_log l
       LEFT JOIN users u ON u.id = l.user_id
       WHERE l.day >= ? AND l.score > 0
       GROUP BY l.user_id
       ORDER BY score DESC
       LIMIT 20`,
      since
    )
    const myRow = await db.get(
      `SELECT user_id, SUM(score) as score FROM chat_activity_log
       WHERE day >= ? AND user_id = ?
       GROUP BY user_id`, since, user.id
    )
    const myScore = myRow?.score || 0
    let myRank = null
    if (myScore > 0) {
      const rankRow = await db.get(
        `SELECT COUNT(*) + 1 as rank FROM (
           SELECT user_id FROM chat_activity_log
           WHERE day >= ? AND score > 0
           GROUP BY user_id HAVING SUM(score) > ?
         )`, since, myScore
      )
      myRank = rankRow?.rank || null
    }
    return res.json({
      days,
      leaderboard: rows.map((r, index) => ({
        rank: index + 1,
        userId: r.user_id, userName: r.user_name, userAvatar: r.user_avatar,
        score: r.score,
      })),
      me: { userId: user.id, score: myScore, rank: myRank },
    })
  } catch (error) {
    console.error('Failed to get activity leaderboard:', error)
    return res.status(500).json({ message: '获取活跃榜失败' })
  }
})

// ============================================================
// 举报系统（帖子 / 评论 / 聊天消息 / 用户）
// ============================================================

const reportRateLimits = new BoundedCache(5000, 10000) // 10 秒冷却

app.post('/api/reports', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    if (reportRateLimits.has(user.id)) {
      return res.status(429).json({ message: '举报过于频繁，请稍后再试' })
    }
    const { targetType, targetId, reason } = req.body || {}
    const type = ['post', 'comment', 'message', 'user'].includes(targetType) ? targetType : null
    if (!type || !targetId) return res.status(400).json({ message: '无效的举报目标' })
    // 用户类型存字符串 ID，其余存数字 ID
    const id = type === 'user' ? String(targetId) : parseInt(targetId)
    if (type !== 'user' && !id) return res.status(400).json({ message: '无效的举报目标' })
    const cleanReason = String(reason ?? '').trim().slice(0, 200) || '未填写原因'

    // 目标存在性校验
    if (type === 'post') {
      const row = await db.get(`SELECT id FROM discussion_posts WHERE id = ?`, id)
      if (!row) return res.status(404).json({ message: '帖子不存在' })
    } else if (type === 'comment') {
      const row = await db.get(`SELECT id FROM discussion_comments WHERE id = ?`, id)
      if (!row) return res.status(404).json({ message: '评论不存在' })
    } else if (type === 'message') {
      const row = await db.get(`SELECT id FROM chat_messages WHERE id = ?`, id)
      if (!row) return res.status(404).json({ message: '消息不存在' })
    } else {
      const row = await db.get(`SELECT id FROM users WHERE id = ?`, id)
      if (!row) return res.status(404).json({ message: '用户不存在' })
    }

    reportRateLimits.set(user.id, Date.now())
    await db.run(
      `INSERT INTO reports (reporter_id, target_type, target_id, reason, status, created_at)
       VALUES (?, ?, ?, ?, 'open', ?)`,
      user.id, type, id, cleanReason, new Date().toISOString()
    )
    return res.json({ message: '举报已提交，管理员会尽快处理' })
  } catch (error) {
    console.error('Failed to create report:', error)
    return res.status(500).json({ message: '举报失败' })
  }
})

// ---------- 管理端 ----------

// 站点数据看板
app.get('/api/admin/stats', async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const { db } = auth
  try {
    const [users, posts, comments, chatMessages, rooms, reports, todayActive] = await Promise.all([
      db.get(`SELECT COUNT(*) as c FROM users`),
      db.get(`SELECT COUNT(*) as c FROM discussion_posts`),
      db.get(`SELECT COUNT(*) as c FROM discussion_comments`),
      db.get(`SELECT COUNT(*) as c FROM chat_messages`),
      db.get(`SELECT COUNT(*) as c FROM chat_rooms`),
      db.get(`SELECT COUNT(*) as c FROM reports WHERE status = 'open'`),
      db.get(`SELECT COUNT(*) as c FROM chat_activity_log WHERE day = ?`, localDay()),
    ])
    return res.json({
      stats: {
        users: users?.c || 0,
        posts: posts?.c || 0,
        comments: comments?.c || 0,
        chatMessages: chatMessages?.c || 0,
        rooms: rooms?.c || 0,
        openReports: reports?.c || 0,
        todayActive: todayActive?.c || 0,
      },
    })
  } catch (error) {
    console.error('Failed to get admin stats:', error)
    return res.status(500).json({ message: '获取统计失败' })
  }
})

// 举报列表（含目标摘要）
app.get('/api/admin/reports', async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const { db } = auth
  try {
    const status = req.query.status === 'resolved' ? 'resolved' : 'open'
    const rows = await db.all(
      `SELECT r.*, u.name as reporter_name,
              t.name as target_user_name
       FROM reports r
       LEFT JOIN users u ON r.reporter_id = u.id
       LEFT JOIN users t ON r.target_type = 'user' AND t.id = CAST(r.target_id AS TEXT)
       WHERE r.status = ?
       ORDER BY r.created_at DESC
       LIMIT 50`,
      status
    )
    const enriched = []
    for (const row of rows) {
      let summary = ''
      if (row.target_type === 'post') {
        const p = await db.get(`SELECT title FROM discussion_posts WHERE id = ?`, row.target_id)
        summary = p ? `帖子：《${p.title}》` : '（已删除）'
      } else if (row.target_type === 'comment') {
        const c = await db.get(`SELECT content FROM discussion_comments WHERE id = ?`, row.target_id)
        summary = c ? `评论：${String(c.content).replace(/<[^>]+>/g, ' ').slice(0, 60)}` : '（已删除）'
      } else if (row.target_type === 'message') {
        const m = await db.get(`SELECT content FROM chat_messages WHERE id = ?`, row.target_id)
        summary = m ? `消息：${String(m.content).slice(0, 60)}` : '（已删除）'
      } else {
        summary = row.target_user_name ? `用户：${row.target_user_name}` : '（用户已删除）'
      }
      enriched.push({
        id: row.id,
        reporterId: row.reporter_id,
        reporterName: row.reporter_name,
        targetType: row.target_type,
        targetId: row.target_id,
        reason: row.reason,
        status: row.status,
        summary,
        createdAt: row.created_at,
      })
    }
    return res.json({ reports: enriched })
  } catch (error) {
    console.error('Failed to list reports:', error)
    return res.status(500).json({ message: '获取举报失败' })
  }
})

// 处理举报（标记解决）
app.post('/api/admin/reports/:id/resolve', async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const { db } = auth
  try {
    const reportId = parseInt(req.params.id)
    await db.run(`UPDATE reports SET status = 'resolved' WHERE id = ?`, reportId)
    return res.json({ message: '已处理' })
  } catch (error) {
    console.error('Failed to resolve report:', error)
    return res.status(500).json({ message: '操作失败' })
  }
})

// 管理员删除聊天消息（广播给在线客户端）
app.delete('/api/admin/messages/:id', async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const { db } = auth
  try {
    const messageId = parseInt(req.params.id)
    const message = await db.get(`SELECT * FROM chat_messages WHERE id = ?`, messageId)
    if (!message) return res.status(404).json({ message: '消息不存在' })
    const scopeKey = message.channel_key ? `channel:${message.channel_key}` : `room:${message.room_id}`
    await db.run(`DELETE FROM chat_messages WHERE id = ?`, messageId)
    broadcastToScope(scopeKey, { type: 'message_deleted', messageId })
    return res.json({ message: '消息已删除' })
  } catch (error) {
    console.error('Failed to delete message:', error)
    return res.status(500).json({ message: '操作失败' })
  }
})

// ============================================================
// ============================================================
// SSO 共享登录（同域名子项目接入）
// 场景一（同域名子路径 / 子域名）：子项目通过 ?token= 或 Authorization 头校验
// 场景二（iframe 嵌入）：public/sso.html 读取本地 token 后 postMessage 给父窗口
// ============================================================

app.get('/api/sso/session', async (req, res) => {
  try {
    const db = await getDb()
    let token = getAuthToken(req)
    // 支持 ?token= 查询参数（子项目跳转带参场景）
    if (!token && req.query.token) token = String(req.query.token).slice(0, 128)
    if (!token) return res.json({ user: null })
    const user = await getUserByToken(db, token)
    if (!user) return res.json({ user: null })
    return res.json({
      user: {
        id: user.id,
        name: user.name,
        avatar: user.avatar,
        isAdmin: Boolean(user.is_admin),
        isBanned: Boolean(user.is_banned),
      },
      token,
    })
  } catch (error) {
    console.error('Failed to get sso session:', error)
    return res.status(500).json({ message: '获取会话失败' })
  }
})

// POST 版：token 走请求体，避免进 URL/访问日志/浏览器历史（推荐子项目使用）
app.post('/api/sso/session', async (req, res) => {
  try {
    const db = await getDb()
    let token = getAuthToken(req)
    if (!token && req.body?.token) token = String(req.body.token).slice(0, 128)
    if (!token) return res.json({ user: null })
    const user = await getUserByToken(db, token)
    if (!user) return res.json({ user: null })
    return res.json({
      user: {
        id: user.id,
        name: user.name,
        avatar: user.avatar,
        isAdmin: Boolean(user.is_admin),
        isBanned: Boolean(user.is_banned),
      },
      token,
    })
  } catch (error) {
    console.error('Failed to get sso session:', error)
    return res.status(500).json({ message: '获取会话失败' })
  }
})

// 消息保留策略：超过保留期限（默认 90 天）的聊天室消息与私信自动清理
// ============================================================
const MESSAGE_RETENTION_DAYS = 90

const cleanupExpiredMessages = async () => {
  try {
    const db = await getDb()
    const cutoff = new Date(Date.now() - MESSAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const chatResult = await db.run(`DELETE FROM chat_messages WHERE created_at < ?`, cutoff)
    const dmResult = await db.run(`DELETE FROM messages WHERE created_at < ?`, cutoff)
    // 清理已无消息的会话
    await db.run(
      `DELETE FROM conversations WHERE id NOT IN (SELECT DISTINCT conversation_id FROM messages)`
    )
    if (chatResult.changes > 0 || dmResult.changes > 0) {
      console.log(`[retention] cleaned chat=${chatResult.changes} dm=${dmResult.changes}`)
    }
  } catch (error) {
    console.error('[retention] cleanup failed:', error)
  }
}

const scheduleMessageCleanup = () => {
  const now = new Date()
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const delay = tomorrow.getTime() - now.getTime() + 60_000
  setTimeout(() => {
    void cleanupExpiredMessages()
    setInterval(() => {
      void cleanupExpiredMessages()
    }, 24 * 60 * 60 * 1000)
  }, delay)
  console.log(`Message retention scheduler initialized (${MESSAGE_RETENTION_DAYS} days)`)
}

const PORT = Number(process.env.PORT) || 5174
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`StarStack API running at http://localhost:${PORT}`)
      // Initialize web push
      initPush()
      // Initialize leaderboard history scheduler
      scheduleLeaderboardHistory()
      // Save initial history
      void saveLeaderboardHistory(true)
      // Message retention cleanup
      scheduleMessageCleanup()
    })
  })
  .catch((error) => {
    console.error('Failed to init database:', error)
    process.exit(1)
  })
