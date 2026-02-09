import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { getDb, initDb } from './db.js'
import { judgeSubmission, runSample, runSamples } from './judge.js'
import {
  ACHIEVEMENTS,
  updateUserStats,
  checkAndUnlockAchievements,
  updateRankings,
  getDifficultyStats,
  getHeatmapData,
  recalculateUserRating
} from './stats.js'

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

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
  if (!header.startsWith('Bearer ')) return null
  return header.slice(7).trim()
}

const getUserByToken = async (db, token) => {
  const session = await db.get(
    `SELECT token, user_id FROM sessions WHERE token = ?`,
    token
  )
  if (!session) return null
  const user = await db.get(
    `SELECT id, name, password_hash, is_admin, is_banned, avatar, created_at
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

app.get('/api/health', (req, res) => {
  res.json({ ok: true })
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
  const { id, password } = req.body || {}
  if (!id || !password) {
    return res.status(400).json({ message: '请输入 ID 与密码' })
  }
  if (password.length < 6) {
    return res.status(400).json({ message: '密码至少 6 位' })
  }
  const db = await getDb()
  const user = await db.get(
    `SELECT id, name, password_hash, is_admin, is_banned, avatar FROM users WHERE id = ?`,
    id
  )
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ message: 'ID 或密码错误' })
  }
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
  return res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      isAdmin: Boolean(user.is_admin),
      isBanned: Boolean(user.is_banned),
      avatar: user.avatar,
    },
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
  return res.json({
    user: {
      id: user.id,
      name: user.name,
      avatar: user.avatar,
      isAdmin: Boolean(user.is_admin),
      isBanned: Boolean(user.is_banned),
    },
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
  return res.json({
    user: {
      id: user.id,
      name: name.trim(),
      isAdmin: Boolean(user.is_admin),
      isBanned: Boolean(user.is_banned),
    },
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
  if (!avatar.startsWith('data:image/')) {
    return res.status(400).json({ message: '无效的图片格式' })
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
  return res.json({
    user: {
      id: user.id,
      name: user.name,
      avatar: avatar,
      isAdmin: Boolean(user.is_admin),
      isBanned: Boolean(user.is_banned),
    },
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
    where.push(`tags LIKE ?`)
    params.push(`%${tag}%`)
  }
  if (difficulty) {
    where.push(`difficulty = ?`)
    params.push(difficulty)
  }
  const whereSql = `WHERE ${where.join(' AND ')}`
  const rows = await db.all(
    `SELECT id, slug, title, difficulty, tags, created_at
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

app.post('/api/problems', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth

  const { title, difficulty, tags, statement, inputDesc, outputDesc, dataRange, samples, testFiles, status } = req.body || {}

  if (!title || !title.trim()) {
    return res.status(400).json({ message: '请填写题目标题' })
  }

  if (!statement || !statement.trim()) {
    return res.status(400).json({ message: '请填写题目描述' })
  }

  if (!samples || !Array.isArray(samples) || samples.length === 0) {
    return res.status(400).json({ message: '请至少添加一个样例' })
  }

  const now = new Date().toISOString()

  try {
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
      statement.trim(),
      inputDesc || '',
      outputDesc || '',
      dataRange || '',
      JSON.stringify(samples),
      user.id,
      status || 'published',
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

    return res.json({
      message: '题目创建成功',
      problemId,
      slug
    })
  } catch (error) {
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

  if (!title || !title.trim()) {
    return res.status(400).json({ message: '请填写题目标题' })
  }

  if (!statement || !statement.trim()) {
    return res.status(400).json({ message: '请填写题目描述' })
  }

  if (!samples || !Array.isArray(samples) || samples.length === 0) {
    return res.status(400).json({ message: '请至少添加一个样例' })
  }

  const now = new Date().toISOString()

  try {
    // 更新题目
    await db.run(
      `UPDATE problems SET title = ?, difficulty = ?, tags = ?, statement = ?, input_desc = ?, output_desc = ?, data_range = ?, samples = ?, status = ?
       WHERE id = ?`,
      title.trim(),
      difficulty || '入门',
      Array.isArray(tags) ? tags.join(',') : (tags || ''),
      statement.trim(),
      inputDesc || '',
      outputDesc || '',
      dataRange || '',
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

    return res.json({
      message: '题目更新成功',
      problemId
    })
  } catch (error) {
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
      message: row.message,
      code: row.user_id === user.id ? row.code : null,
      canViewCode: row.user_id === user.id,
      results: parseResults(row.results_json),
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
      message: row.message,
      score: row.score ?? 0,
      code: canViewCode ? row.code : null,
      canViewCode: canViewCode,
      results: parseResults(row.results_json),
      createdAt: row.created_at,
    },
  })
})

app.post('/api/oj/submissions', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
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

  const problem = await db.get(`SELECT id FROM problems WHERE id = ?`, Number(problemId))
  if (!problem) {
    return res.status(404).json({ message: '题目不存在' })
  }
  const testcases = await db.all(
    `SELECT input, output FROM testcases WHERE problem_id = ? ORDER BY id ASC`,
    Number(problemId)
  )
  if (testcases.length === 0) {
    return res.status(400).json({ message: '该题暂无测试用例' })
  }
  const normalized = String(code)
  const judgeResult = await judgeSubmission({
    language,
    code: normalized,
    testcases,
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

    return res.json({
      user: {
        id: user.id,
        name: user.name,
        avatar: user.avatar,
        createdAt: user.created_at,
        isAdmin: user.is_admin === 1
      },
      stats: {
        totalSubmissions: stats.total_submissions,
        acceptedCount: stats.accepted_count,
        triedProblems: stats.tried_problems,
        solvedProblems: stats.solved_problems,
        acceptanceRate: stats.acceptance_rate,
        currentStreak: stats.current_streak,
        maxStreak: stats.max_streak,
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
    const limit = Math.min(Number(req.query.limit) || 100, 500)
    const offset = Number(req.query.offset) || 0

    // Get leaderboard data sorted by rating
    const leaderboard = await db.all(
      `SELECT
        ROW_NUMBER() OVER (ORDER BY u.rating DESC, us.solved_problems DESC) as rank,
        us.user_id,
        u.name as user_name,
        u.avatar,
        u.rating,
        us.solved_problems
       FROM user_stats us
       JOIN users u ON us.user_id = u.id
       WHERE us.total_submissions > 0
       ORDER BY u.rating DESC, us.solved_problems DESC
       LIMIT ? OFFSET ?`,
      limit,
      offset
    )

    // Get current user rank if authenticated
    let currentUser = null
    const token = getAuthToken(req)
    if (token) {
      const user = await getUserByToken(db, token)
      if (user) {
        const userStats = await db.get(
          `SELECT
            (SELECT COUNT(*) + 1 FROM users u2
             JOIN user_stats us2 ON u2.id = us2.user_id
             WHERE us2.total_submissions > 0
             AND (u2.rating > u.rating OR (u2.rating = u.rating AND us2.solved_problems > us.solved_problems))) as rank,
            us.user_id,
            u.name as user_name,
            u.avatar,
            u.rating,
            us.solved_problems
           FROM user_stats us
           JOIN users u ON us.user_id = u.id
           WHERE us.user_id = ?`,
          user.id
        )
        if (userStats) {
          currentUser = {
            rank: userStats.rank,
            userId: userStats.user_id,
            userName: userStats.user_name,
            avatar: userStats.avatar,
            rating: userStats.rating,
            solvedProblems: userStats.solved_problems
          }
        }
      }
    }

    return res.json({
      leaderboard: leaderboard.map(row => ({
        rank: row.rank,
        userId: row.user_id,
        userName: row.user_name,
        avatar: row.avatar,
        rating: row.rating,
        solvedProblems: row.solved_problems
      })),
      currentUser
    })
  } catch (error) {
    console.error('Failed to get leaderboard:', error)
    return res.status(500).json({ message: '获取排行榜失败' })
  }
})

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

// === HTML Sanitizer for Discussion content ===
const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'em', 'code', 'pre', 'a', 'ul', 'ol', 'li', 'b', 'i', 'div', 'span', 'h1', 'h2', 'h3', 'blockquote'])
const ALLOWED_ATTRS = { a: new Set(['href', 'target', 'rel']) }

function sanitizeHtml(html) {
  if (!html) return ''
  // Remove script tags and their content
  let clean = html.replace(/<script[\s\S]*?<\/script>/gi, '')
  // Remove event handlers
  clean = clean.replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, '')
  // Remove javascript: URLs
  clean = clean.replace(/href\s*=\s*["']?\s*javascript:/gi, 'href="')
  // Remove style tags
  clean = clean.replace(/<style[\s\S]*?<\/style>/gi, '')
  // Remove iframe/object/embed
  clean = clean.replace(/<(iframe|object|embed|form|input|textarea|select|button)[\s\S]*?(<\/\1>|\/?>)/gi, '')
  return clean
}

// Rate limiting map for discussion posts
const postRateLimits = new Map()

// GET /api/discussions - List posts with pagination, sorting, filtering
app.get('/api/discussions', async (req, res) => {
  try {
    const db = await getDb()
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize) || 20))
    const sort = req.query.sort === 'hot' ? 'hot' : 'latest'
    const problemId = req.query.problemId ? parseInt(req.query.problemId) : null
    const search = (req.query.search || '').trim()

    const where = []
    const params = []

    if (problemId) {
      where.push('dp.problem_id = ?')
      params.push(problemId)
    }
    if (search) {
      where.push('dp.title LIKE ?')
      params.push(`%${search}%`)
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const orderSql = sort === 'hot'
      ? 'ORDER BY (dp.like_count * 3 + dp.comment_count * 2 + dp.view_count * 0.1) DESC, dp.created_at DESC'
      : 'ORDER BY dp.created_at DESC'

    const countRow = await db.get(
      `SELECT COUNT(*) as count FROM discussion_posts dp ${whereSql}`,
      ...params
    )
    const total = countRow?.count || 0

    const offset = (page - 1) * pageSize
    const posts = await db.all(
      `SELECT dp.id, dp.user_id, dp.title, dp.problem_id, dp.view_count, dp.like_count,
              dp.comment_count, dp.created_at, dp.updated_at,
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
        title: p.title, problemId: p.problem_id, problemTitle: p.problem_title,
        viewCount: p.view_count, likeCount: p.like_count, commentCount: p.comment_count,
        liked: likedSet.has(p.id), createdAt: p.created_at, updatedAt: p.updated_at,
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
        viewCount: post.view_count, likeCount: post.like_count,
        commentCount: post.comment_count, liked: postLiked,
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
    // Rate limiting: 10 seconds between posts
    const lastPost = postRateLimits.get(user.id)
    if (lastPost && Date.now() - lastPost < 10000) {
      return res.status(429).json({ message: '发帖过于频繁，请稍后再试' })
    }

    const { title, content, problemId } = req.body || {}
    if (!title || !title.trim()) return res.status(400).json({ message: '标题不能为空' })
    if (title.trim().length > 200) return res.status(400).json({ message: '标题不能超过200字符' })
    if (!content || !content.trim()) return res.status(400).json({ message: '内容不能为空' })
    if (content.length > 50000) return res.status(400).json({ message: '内容不能超过50000字符' })

    // Validate problemId if provided
    if (problemId) {
      const problem = await db.get(`SELECT id FROM problems WHERE id = ?`, problemId)
      if (!problem) return res.status(400).json({ message: '关联的题目不存在' })
    }

    const now = new Date().toISOString()
    const sanitized = sanitizeHtml(content)
    const result = await db.run(
      `INSERT INTO discussion_posts (user_id, title, content, problem_id, view_count, like_count, comment_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?)`,
      user.id, title.trim(), sanitized, problemId || null, now, now
    )

    postRateLimits.set(user.id, Date.now())
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

    const { title, content, problemId } = req.body || {}
    if (!title || !title.trim()) return res.status(400).json({ message: '标题不能为空' })
    if (title.trim().length > 200) return res.status(400).json({ message: '标题不能超过200字符' })
    if (!content || !content.trim()) return res.status(400).json({ message: '内容不能为空' })
    if (content.length > 50000) return res.status(400).json({ message: '内容不能超过50000字符' })

    if (problemId) {
      const problem = await db.get(`SELECT id FROM problems WHERE id = ?`, problemId)
      if (!problem) return res.status(400).json({ message: '关联的题目不存在' })
    }

    const now = new Date().toISOString()
    const sanitized = sanitizeHtml(content)
    await db.run(
      `UPDATE discussion_posts SET title = ?, content = ?, problem_id = ?, updated_at = ? WHERE id = ?`,
      title.trim(), sanitized, problemId || null, now, postId
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
    await db.run(`DELETE FROM discussion_posts WHERE id = ?`, postId)

    return res.json({ message: '删除成功' })
  } catch (error) {
    console.error('Failed to delete discussion:', error)
    return res.status(500).json({ message: '删除失败' })
  }
})

// POST /api/discussions/:id/comments - Add comment or reply
app.post('/api/discussions/:id/comments', async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth

  try {
    const postId = parseInt(req.params.id)
    if (!postId) return res.status(400).json({ message: '无效的帖子ID' })

    const post = await db.get(`SELECT id FROM discussion_posts WHERE id = ?`, postId)
    if (!post) return res.status(404).json({ message: '帖子不存在' })

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

const PORT = Number(process.env.PORT) || 5174
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`StarStack API running at http://localhost:${PORT}`)
    })
  })
  .catch((error) => {
    console.error('Failed to init database:', error)
    process.exit(1)
  })
