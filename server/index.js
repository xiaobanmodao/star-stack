import express from 'express'
import cors from 'cors'
import { getDb, initDb } from './db.js'
import { getAuthToken, getUserByToken } from './middleware/auth.js'
import { initPush } from './controllers/notificationsController.js'
import { setLeaderboardSaveCallback } from './controllers/submissionsController.js'

import authRouter from './routes/auth.js'
import userRouter from './routes/user.js'
import problemsRouter from './routes/problems.js'
import submissionsRouter from './routes/submissions.js'
import discussionsRouter from './routes/discussions.js'
import messagesRouter from './routes/messages.js'
import chatRouter from './routes/chat.js'
import socialRouter from './routes/social.js'
import adminRouter from './routes/admin.js'
import leaderboardRouter from './routes/leaderboard.js'
import problemPlanRouter from './routes/problemPlan.js'

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : null

const app = express()

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true)
    if (!ALLOWED_ORIGINS) {
      if (process.env.NODE_ENV === 'production') {
        console.error('[cors] 生产环境未配置 ALLOWED_ORIGINS，拒绝跨域请求。')
        return callback(new Error('CORS origins are not configured'))
      }
      return callback(null, true)
    }
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true)
    callback(new Error('CORS not allowed'))
  },
  credentials: true,
}))
app.use(express.json({ limit: '4mb' }))

// Mount modular routers
app.use('/api', authRouter)
app.use('/api', userRouter)
app.use('/api', problemsRouter)
app.use('/api', submissionsRouter)
app.use('/api', discussionsRouter)
app.use('/api', messagesRouter)
app.use('/api', chatRouter)
app.use('/api', socialRouter)
app.use('/api/admin', adminRouter)
app.use('/api/leaderboard', leaderboardRouter)
app.use('/api/problem-plan', problemPlanRouter)

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true }))

// Site-wide stats
app.get('/api/stats', async (req, res) => {
  const db = await getDb()
  const problemCount = await db.get(`SELECT COUNT(*) as count FROM problems`)
  const userCount = await db.get(`SELECT COUNT(*) as count FROM users`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todaySubmissions = await db.get(
    `SELECT COUNT(*) as count FROM submissions WHERE created_at >= ?`,
    today.toISOString()
  )
  return res.json({
    problemCount: problemCount?.count || 0,
    userCount: userCount?.count || 0,
    todaySubmissions: todaySubmissions?.count || 0,
  })
})

// Frontend error reporting
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

// OJ homepage: personalised recommendations
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
      const recentAC = await db.all(
        `SELECT DISTINCT p.id, p.tags, p.difficulty
         FROM submissions s
         JOIN problems p ON s.problem_id = p.id
         WHERE s.user_id = ? AND s.status = 'Accepted' AND p.status = 'published'
         ORDER BY s.created_at DESC LIMIT 10`,
        userId
      )
      if (recentAC.length > 0) {
        const allTags = []
        const difficulties = []
        recentAC.forEach(p => {
          if (p.tags) allTags.push(...p.tags.split(',').map(t => t.trim()).filter(Boolean))
          difficulties.push(p.difficulty)
        })
        const tagFreq = {}
        allTags.forEach(tag => { tagFreq[tag] = (tagFreq[tag] || 0) + 1 })
        const topTags = Object.entries(tagFreq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([tag]) => tag)
        const difficultyOrder = ['入门', '普及-', '普及', '提高-', '提高', '省选', 'noi']
        const avgDifficultyIndex = Math.round(
          difficulties.reduce((sum, d) => sum + difficultyOrder.indexOf(d), 0) / difficulties.length
        )
        const targetDifficulties = [
          difficultyOrder[Math.max(0, avgDifficultyIndex - 1)],
          difficultyOrder[avgDifficultyIndex],
          difficultyOrder[Math.min(difficultyOrder.length - 1, avgDifficultyIndex + 1)]
        ].filter(Boolean)
        const acProblemIds = await db.all(
          `SELECT DISTINCT problem_id FROM submissions WHERE user_id = ? AND status = 'Accepted'`,
          userId
        )
        const acIds = acProblemIds.map(row => row.problem_id)
        const placeholders = topTags.map(() => 'tags LIKE ?').join(' OR ')
        const diffPlaceholders = targetDifficulties.map(() => '?').join(',')
        let query = `
          SELECT id, slug, title, difficulty, tags,
                 (SELECT COUNT(*) FROM submissions WHERE problem_id = problems.id AND status = 'Accepted') as ac_count,
                 (SELECT COUNT(*) FROM submissions WHERE problem_id = problems.id) as total_count
          FROM problems
          WHERE status = 'published' AND (${placeholders}) AND difficulty IN (${diffPlaceholders})`
        const params = [...topTags.map(tag => `%${tag}%`), ...targetDifficulties]
        if (acIds.length > 0) {
          query += ` AND id NOT IN (${acIds.map(() => '?').join(',')})`
          params.push(...acIds)
        }
        query += ` ORDER BY RANDOM() LIMIT 20`
        const candidates = await db.all(query, ...params)
        const scored = candidates.map(p => {
          const pTags = p.tags ? p.tags.split(',').map(t => t.trim()).filter(Boolean) : []
          return { ...p, score: pTags.filter(tag => topTags.includes(tag)).length }
        })
        const top15 = scored.sort((a, b) => b.score - a.score).slice(0, 15)
        recommendations = top15.sort(() => Math.random() - 0.5).slice(0, 4)
      }
    }
    if (recommendations.length === 0) {
      recommendations = await db.all(
        `SELECT p.id, p.slug, p.title, p.difficulty, p.tags,
                (SELECT COUNT(*) FROM submissions WHERE problem_id = p.id AND status = 'Accepted') as ac_count,
                (SELECT COUNT(*) FROM submissions WHERE problem_id = p.id) as total_count
         FROM problems p
         WHERE p.status = 'published' AND p.difficulty = '入门'
         ORDER BY (SELECT COUNT(*) FROM submissions WHERE problem_id = p.id) DESC LIMIT 4`
      )
    }
    return res.json({ recommendations: recommendations.map(p => ({
      id: p.id, slug: p.slug, title: p.title, difficulty: p.difficulty,
      tags: p.tags ? p.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      passRate: p.total_count > 0 ? Math.round((p.ac_count / p.total_count) * 100) : 0
    })) })
  } catch (error) {
    console.error('Failed to get recommendations:', error)
    return res.status(500).json({ message: '获取推荐失败' })
  }
})

// OJ homepage: problem bank overview
app.get('/api/oj/overview', async (req, res) => {
  try {
    const db = await getDb()
    const totalResult = await db.get(`SELECT COUNT(*) as total FROM problems WHERE status = 'published'`)
    const difficultyStats = await db.all(
      `SELECT difficulty, COUNT(*) as count FROM problems WHERE status = 'published' GROUP BY difficulty`
    )
    const difficulties = {}
    difficultyStats.forEach(row => { difficulties[row.difficulty] = row.count })
    const allProblems = await db.all(
      `SELECT tags FROM problems WHERE status = 'published' AND tags IS NOT NULL AND tags != ''`
    )
    const tagFreq = {}
    allProblems.forEach(p => {
      if (p.tags) p.tags.split(',').map(t => t.trim()).filter(Boolean).forEach(tag => {
        tagFreq[tag] = (tagFreq[tag] || 0) + 1
      })
    })
    const topTags = Object.entries(tagFreq).sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([tag, count]) => ({ tag, count }))
    return res.json({ total: totalResult?.total || 0, difficulties, topTags })
  } catch (error) {
    console.error('Failed to get overview:', error)
    return res.status(500).json({ message: '获取概览失败' })
  }
})

// OJ homepage: hot problems (24h)
app.get('/api/oj/hot-problems', async (req, res) => {
  try {
    const db = await getDb()
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const hotProblems = await db.all(
      `SELECT p.id, p.slug, p.title, p.difficulty, COUNT(s.id) as submission_count
       FROM problems p JOIN submissions s ON p.id = s.problem_id
       WHERE p.status = 'published' AND s.created_at > ?
       GROUP BY p.id ORDER BY submission_count DESC LIMIT 5`,
      oneDayAgo
    )
    return res.json({ hotProblems })
  } catch (error) {
    console.error('Failed to get hot problems:', error)
    return res.status(500).json({ message: '获取热门题目失败' })
  }
})

// OJ homepage: recent accepted submissions
app.get('/api/oj/recent-ac', async (req, res) => {
  try {
    const db = await getDb()
    const recentAC = await db.all(
      `SELECT s.created_at, u.name as user_name, u.avatar, p.id as problem_id, p.title as problem_title
       FROM submissions s JOIN users u ON s.user_id = u.id JOIN problems p ON s.problem_id = p.id
       WHERE s.status = 'Accepted' AND p.status = 'published' ORDER BY s.created_at DESC LIMIT 10`
    )
    return res.json({ recentAC })
  } catch (error) {
    console.error('Failed to get recent AC:', error)
    return res.status(500).json({ message: '获取动态失败' })
  }
})
// OJ homepage: continue last attempted problem
app.get('/api/oj/continue-last', async (req, res) => {
  try {
    const db = await getDb()
    const token = req.headers.authorization?.replace('Bearer ', '')
    if (!token) return res.json({ problem: null })
    const session = await db.get(`SELECT user_id FROM sessions WHERE token = ?`, token)
    if (!session) return res.json({ problem: null })
    const lastProblem = await db.get(
      `SELECT DISTINCT p.id, p.slug, p.title, p.difficulty, p.tags
       FROM submissions s JOIN problems p ON s.problem_id = p.id
       WHERE s.user_id = ? AND p.status = 'published'
         AND p.id NOT IN (
           SELECT DISTINCT problem_id FROM submissions WHERE user_id = ? AND status = 'Accepted'
         )
       ORDER BY s.created_at DESC LIMIT 1`,
      session.user_id, session.user_id
    )
    if (lastProblem) {
      return res.json({ problem: {
        id: lastProblem.id, slug: lastProblem.slug, title: lastProblem.title,
        difficulty: lastProblem.difficulty,
        tags: lastProblem.tags ? lastProblem.tags.split(',').map(t => t.trim()).filter(Boolean) : []
      }})
    }
    return res.json({ problem: null })
  } catch (error) {
    console.error('Failed to get continue last:', error)
    return res.status(500).json({ message: '获取失败' })
  }
})

// OJ homepage: random problem by difficulty
app.get('/api/oj/random-problem', async (req, res) => {
  try {
    const db = await getDb()
    const { difficulty } = req.query
    let query = `SELECT id, slug, title, difficulty, tags FROM problems WHERE status = 'published'`
    const params = []
    if (difficulty) { query += ` AND difficulty = ?`; params.push(difficulty) }
    query += ` ORDER BY RANDOM() LIMIT 1`
    const problem = await db.get(query, ...params)
    if (!problem) return res.status(404).json({ message: '没有找到题目' })
    return res.json({ problem: {
      id: problem.id, slug: problem.slug, title: problem.title, difficulty: problem.difficulty,
      tags: problem.tags ? problem.tags.split(',').map(t => t.trim()).filter(Boolean) : []
    }})
  } catch (error) {
    console.error('Failed to get random problem:', error)
    return res.status(500).json({ message: '获取失败' })
  }
})

// ===== Leaderboard history scheduler =====
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

function getWeekRange() {
  const now = new Date()
  const dayOfWeek = now.getDay()
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const monday = new Date(now)
  monday.setDate(now.getDate() - diff)
  monday.setHours(0, 0, 0, 0)
  const nextMonday = new Date(monday)
  nextMonday.setDate(monday.getDate() + 7)
  return { startDate: monday.toISOString(), endDate: nextMonday.toISOString() }
}

function getMonthRange() {
  const now = new Date()
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
  firstDay.setHours(0, 0, 0, 0)
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  nextMonth.setHours(0, 0, 0, 0)
  return { startDate: firstDay.toISOString(), endDate: nextMonth.toISOString() }
}

async function saveLeaderboardHistory(force = false) {
  if (leaderboardHistoryRunning) { leaderboardHistoryQueued = true; return }
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
    const totalLeaderboard = await db.all(
      `SELECT DENSE_RANK() OVER (ORDER BY u.rating DESC) as rank, us.user_id, u.rating as value
       FROM user_stats us JOIN users u ON us.user_id = u.id
       WHERE us.total_submissions > 0 AND u.is_banned = 0 ORDER BY rank ASC LIMIT 100`
    )
    for (const entry of totalLeaderboard) {
      await db.run(
        `INSERT OR REPLACE INTO leaderboard_history (user_id, period_type, period_key, rank, value, recorded_at)
         VALUES (?, 'total', ?, ?, ?, ?)`,
        [entry.user_id, today, entry.rank, entry.value, recordedAt]
      )
    }
    const { startDate: weekStart, endDate: weekEnd } = getWeekRange()
    const weekKey = weekStart.split('T')[0]
    const weeklyLeaderboard = await db.all(
      `SELECT DENSE_RANK() OVER (ORDER BY COUNT(DISTINCT sp.problem_id) DESC) as rank,
              sp.user_id, COUNT(DISTINCT sp.problem_id) as value
       FROM solved_problems sp JOIN users u ON sp.user_id = u.id
       WHERE sp.first_solved_at >= ? AND sp.first_solved_at < ? AND u.is_banned = 0
       GROUP BY sp.user_id HAVING COUNT(DISTINCT sp.problem_id) > 0 ORDER BY rank ASC LIMIT 100`,
      weekStart, weekEnd
    )
    for (const entry of weeklyLeaderboard) {
      await db.run(
        `INSERT OR REPLACE INTO leaderboard_history (user_id, period_type, period_key, rank, value, recorded_at)
         VALUES (?, 'weekly', ?, ?, ?, ?)`,
        [entry.user_id, weekKey, entry.rank, entry.value, recordedAt]
      )
    }
    const { startDate: monthStart, endDate: monthEnd } = getMonthRange()
    const monthKey = monthStart.split('T')[0]
    const monthlyLeaderboard = await db.all(
      `SELECT DENSE_RANK() OVER (ORDER BY COUNT(DISTINCT sp.problem_id) DESC) as rank,
              sp.user_id, COUNT(DISTINCT sp.problem_id) as value
       FROM solved_problems sp JOIN users u ON sp.user_id = u.id
       WHERE sp.first_solved_at >= ? AND sp.first_solved_at < ? AND u.is_banned = 0
       GROUP BY sp.user_id HAVING COUNT(DISTINCT sp.problem_id) > 0 ORDER BY rank ASC LIMIT 100`,
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
    if (db) await db.exec('ROLLBACK').catch(() => undefined)
    console.error('Failed to save leaderboard history:', error)
  } finally {
    leaderboardHistoryRunning = false
    if (leaderboardHistoryQueued) {
      leaderboardHistoryQueued = false
      queueLeaderboardHistorySave(leaderboardHistoryLastRunAt === 0 ? 0 : LEADERBOARD_HISTORY_MIN_INTERVAL_MS)
    }
  }
}

function scheduleLeaderboardHistory() {
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(0, 0, 0, 0)
  setTimeout(() => {
    void saveLeaderboardHistory(true)
    setInterval(() => { void saveLeaderboardHistory(true) }, 24 * 60 * 60 * 1000)
  }, tomorrow - now)
  console.log('Leaderboard history scheduler initialized')
}
// SSO session check (used by sub-projects sharing auth)
app.get('/api/sso/session', async (req, res) => {
  try {
    const db = await getDb()
    const token = getAuthToken(req)
    if (!token) return res.json({ user: null })
    const user = await getUserByToken(db, token)
    if (!user) return res.json({ user: null })
    return res.json({
      user: {
        id: user.id, name: user.name, avatar: user.avatar,
        isAdmin: Boolean(user.is_admin), isBanned: Boolean(user.is_banned),
      },
      token,
    })
  } catch (error) {
    console.error('Failed to get sso session:', error)
    return res.status(500).json({ message: '获取会话失败' })
  }
})

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
        id: user.id, name: user.name, avatar: user.avatar,
        isAdmin: Boolean(user.is_admin), isBanned: Boolean(user.is_banned),
      },
      token,
    })
  } catch (error) {
    console.error('Failed to get sso session:', error)
    return res.status(500).json({ message: '获取会话失败' })
  }
})

// Message retention: delete messages older than 90 days at midnight daily
const MESSAGE_RETENTION_DAYS = 90

const cleanupExpiredMessages = async () => {
  try {
    const db = await getDb()
    const cutoff = new Date(Date.now() - MESSAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const chatResult = await db.run(`DELETE FROM chat_messages WHERE created_at < ?`, cutoff)
    const dmResult = await db.run(`DELETE FROM messages WHERE created_at < ?`, cutoff)
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
    setInterval(() => { void cleanupExpiredMessages() }, 24 * 60 * 60 * 1000)
  }, delay)
  console.log(`Message retention scheduler initialized (${MESSAGE_RETENTION_DAYS} days)`)
}

const PORT = Number(process.env.PORT) || 5174
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`StarStack API running at http://localhost:${PORT}`)
      initPush()
      setLeaderboardSaveCallback(queueLeaderboardHistorySave)
      scheduleLeaderboardHistory()
      void saveLeaderboardHistory(true)
      scheduleMessageCleanup()
    })
  })
  .catch((error) => {
    console.error('Failed to init database:', error)
    process.exit(1)
  })
