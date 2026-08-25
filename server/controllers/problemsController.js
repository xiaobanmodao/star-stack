import { getDb } from '../db.js'
import { requireUser, getAuthToken, getUserByToken } from '../middleware/auth.js'
import { sanitizeProblemText, addXp } from '../utils/userHelpers.js'
import { BoundedCache } from '../utils/boundedCache.js'
import {
  DEFAULT_TESTCASE_TIME_LIMIT_MS,
  parseTestcaseTimeLimit,
} from '../utils/testcaseLimits.js'
import { recordAdminAction } from '../utils/adminAudit.js'
import { createNotification } from '../utils/notifications.js'
import {
  buildProblemSnapshot,
  parseRevisionSnapshot,
  recordProblemRevision,
  recordProblemStatusChange,
} from '../utils/problemRevisions.js'
import {
  getAdminCreateStatus,
  getCreatorUpdateStatus,
  normalizeProblemStatus,
} from '../utils/problemStatus.js'

const recordProblemChange = async ({ db, problemId, status, changedBy, snapshot, fromStatus, toStatus, note }) => {
  try {
    if (snapshot) {
      await recordProblemRevision(db, { problemId, status, changedBy, snapshot, note })
    }
    if (toStatus !== undefined) {
      await recordProblemStatusChange(db, { problemId, fromStatus, toStatus, changedBy, note })
    }
  } catch (error) {
    // 内容事务已经提交，审计记录失败不能让接口误报“保存失败”。
    console.error('[problems] failed to record revision/history:', error)
  }
}

const solutionRateLimits = new BoundedCache(5000, 10000)
const MAX_TEST_FILE_BYTES = 2 * 1024 * 1024
const MAX_TEST_DATA_BYTES = 3 * 1024 * 1024

const normalizeSamples = (samples) => {
  if (!Array.isArray(samples) || samples.length === 0) {
    return { samples: [], error: '请至少添加一个样例' }
  }

  const normalized = []
  for (const [index, sample] of samples.entries()) {
    const input = String(sample?.input ?? '')
    const output = String(sample?.output ?? '')
    if (!input.trim() || !output.trim()) {
      return { samples: [], error: `样例 ${index + 1} 必须同时填写输入和输出` }
    }
    const parsedLimit = parseTestcaseTimeLimit(sample?.timeLimitMs, `样例 ${index + 1}`)
    if (parsedLimit.error) return { samples: [], error: parsedLimit.error }
    normalized.push({ input, output, timeLimitMs: parsedLimit.value })
  }
  return { samples: normalized, error: null }
}

const parseTestFilePairs = (testFiles) => {
  if (testFiles === undefined) return { pairs: [], error: null }
  if (!Array.isArray(testFiles)) return { pairs: [], error: '测试数据格式不正确' }

  const pairs = new Map()
  let totalBytes = 0
  for (const file of testFiles) {
    const name = String(file?.name || '').trim()
    const type = file?.type === 'in' || file?.type === 'out' ? file.type : ''
    const content = String(file?.content ?? '')
    const match = name.match(/^(.+)\.(in|out)$/i)
    if (!match || !type || match[2].toLowerCase() !== type || /[\\/]/.test(match[1])) {
      return { pairs: [], error: `测试文件 ${name || '未命名'} 格式不正确` }
    }
    const contentBytes = Buffer.byteLength(content, 'utf8')
    if (contentBytes > MAX_TEST_FILE_BYTES) {
      return { pairs: [], error: `测试文件 ${name} 超过 2MB 限制` }
    }
    totalBytes += contentBytes
    if (totalBytes > MAX_TEST_DATA_BYTES) {
      return { pairs: [], error: '测试数据总大小不能超过 3MB' }
    }

    const key = match[1].toLowerCase()
    const pair = pairs.get(key) || { baseName: match[1] }
    const hasTimeLimit = file.timeLimitMs !== undefined && file.timeLimitMs !== null && file.timeLimitMs !== ''
    const parsedLimit = parseTestcaseTimeLimit(file.timeLimitMs, `测试点 ${match[1]}`)
    if (parsedLimit.error) return { pairs: [], error: parsedLimit.error }
    if (hasTimeLimit && pair.timeLimitMs !== undefined && pair.timeLimitMs !== parsedLimit.value) {
      return { pairs: [], error: `测试点 ${match[1]} 的输入输出限时不一致` }
    }
    if (hasTimeLimit) pair.timeLimitMs = parsedLimit.value
    if (pair[type]) return { pairs: [], error: `测试文件 ${name} 重复` }
    pair[type] = { name, content }
    pairs.set(key, pair)
  }

  for (const pair of pairs.values()) {
    if (!pair.in || !pair.out) {
      return { pairs: [], error: `测试数据 ${pair.baseName} 缺少成对的 .in 或 .out 文件` }
    }
  }
  return {
    pairs: [...pairs.values()].map((pair) => ({
      ...pair,
      timeLimitMs: pair.timeLimitMs ?? DEFAULT_TESTCASE_TIME_LIMIT_MS,
    })),
    error: null,
  }
}

export const getDailyProblem = async (req, res) => {
  const db = await getDb()
  const token = getAuthToken(req)
  const user = token ? await getUserByToken(db, token) : null
  const userId = user ? user.id : null

  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  const problems = await db.all(
    `SELECT id, slug, title, difficulty, tags FROM problems WHERE status = 'published' ORDER BY id ASC`
  )
  if (problems.length === 0) {
    return res.json({ problem: null, solvedToday: false, streak: 0, maxStreak: 0 })
  }

  const dayNum = parseInt(today.replace(/-/g, ''), 10)
  const baseIdx = dayNum % problems.length

  let solvedSet = new Set()
  if (userId) {
    const solved = await db.all(`SELECT problem_id FROM solved_problems WHERE user_id = ?`, userId)
    solvedSet = new Set(solved.map((s) => s.problem_id))
  }

  let picked = null
  if (userId) {
    for (let i = 0; i < problems.length; i++) {
      const p = problems[(baseIdx + i) % problems.length]
      if (!solvedSet.has(p.id)) { picked = p; break }
    }
  }
  if (!picked) picked = problems[baseIdx]

  let solvedToday = false, streak = 0, maxStreak = 0
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
      id: picked.id, slug: picked.slug, title: picked.title, difficulty: picked.difficulty,
      tags: picked.tags ? picked.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      solved: userId ? solvedSet.has(picked.id) : false,
    } : null,
    solvedToday, streak, maxStreak,
  })
}

export const listProblems = async (req, res) => {
  const db = await getDb()
  const { search, tag, difficulty, solved } = req.query || {}
  const paginationRequested = req.query?.page !== undefined || req.query?.pageSize !== undefined
  const page = Math.max(1, Number.parseInt(String(req.query?.page || '1'), 10) || 1)
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query?.pageSize || '20'), 10) || 20))
  const where = ['status = ?']
  const params = ['published']
  const token = getAuthToken(req)
  const user = token ? await getUserByToken(db, token) : null
  if (search) {
    const trimmedSearch = search.trim()
    const problemNumberMatch = trimmedSearch.match(/^[pP]?(\d+)$/)
    if (problemNumberMatch) {
      where.push(`(id = ? OR slug LIKE ?)`)
      params.push(Number(problemNumberMatch[1]), `%${problemNumberMatch[1]}%`)
    } else {
      where.push(`(title LIKE ? OR statement LIKE ? OR tags LIKE ?)`)
      params.push(`%${trimmedSearch}%`, `%${trimmedSearch}%`, `%${trimmedSearch}%`)
    }
  }
  if (tag) {
    const tags = tag.split(',').map(t => t.trim()).filter(Boolean)
    if (tags.length > 0) {
      where.push(`(${tags.map(() => `tags LIKE ?`).join(' AND ')})`)
      tags.forEach(t => params.push(`%${t}%`))
    }
  }
  if (difficulty) {
    where.push(`difficulty = ?`)
    params.push(difficulty)
  }
  if (solved === 'solved' || solved === 'unsolved') {
    if (!user) return res.status(401).json({ message: '登录后才能筛选已解决题目' })
    const existsSql = `EXISTS (SELECT 1 FROM solved_problems sp_filter WHERE sp_filter.problem_id = problems.id AND sp_filter.user_id = ?)`
    where.push(solved === 'solved' ? existsSql : `NOT ${existsSql}`)
    params.push(user.id)
  }
  const totalRow = await db.get(
    `SELECT COUNT(*) as total FROM problems WHERE ${where.join(' AND ')}`,
    ...params,
  )
  const total = Number(totalRow?.total || 0)
  const selectParams = user ? [user.id, ...params] : [...params]
  const paginationSql = paginationRequested ? ' LIMIT ? OFFSET ?' : ''
  if (paginationRequested) {
    selectParams.push(pageSize, (page - 1) * pageSize)
  }
  const rows = await db.all(
    `SELECT id, slug, title, difficulty, tags, created_at,
       (SELECT COUNT(*) FROM submissions WHERE problem_id = problems.id AND status = 'Accepted') as ac_count,
       (SELECT COUNT(*) FROM submissions WHERE problem_id = problems.id) as total_count,
       ${user ? `EXISTS (SELECT 1 FROM solved_problems sp_user WHERE sp_user.problem_id = problems.id AND sp_user.user_id = ?)` : '0'} as solved
     FROM problems WHERE ${where.join(' AND ')} ORDER BY id ASC${paginationSql}`,
    ...selectParams,
  )
  return res.json({
    total,
    page: paginationRequested ? page : 1,
    pageSize: paginationRequested ? pageSize : total,
    totalPages: paginationRequested ? Math.ceil(total / pageSize) : (total > 0 ? 1 : 0),
    problems: rows.map((row) => ({
      id: row.id, slug: row.slug, title: row.title, difficulty: row.difficulty,
      tags: row.tags ? row.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      createdAt: row.created_at,
      acCount: row.ac_count || 0, totalCount: row.total_count || 0,
      passRate: row.total_count > 0 ? Math.round((row.ac_count / row.total_count) * 100) : 0,
      solved: Boolean(row.solved),
    })),
  })
}

export const getProblem = async (req, res) => {
  const db = await getDb()
  const identifier = req.params.id
  const isNumeric = /^\d+$/.test(identifier)
  const row = isNumeric
    ? await db.get(`SELECT p.*, u.name as creator_name FROM problems p LEFT JOIN users u ON p.creator_id = u.id WHERE p.id = ?`, Number(identifier))
    : await db.get(`SELECT p.*, u.name as creator_name FROM problems p LEFT JOIN users u ON p.creator_id = u.id WHERE p.slug = ?`, identifier)
  if (!row) return res.status(404).json({ message: '题目不存在' })

  const token = getAuthToken(req)
  const user = token ? await getUserByToken(db, token) : null

  if (row.status !== 'published') {
    const isCreator = user && user.id === row.creator_id
    if (!isCreator && !user?.is_admin) {
      return res.status(404).json({ message: '题目不存在' })
    }
  }

  const samples = await db.all(
    `SELECT input, output, time_limit_ms FROM testcases WHERE problem_id = ? AND is_sample = 1 ORDER BY id ASC`, row.id
  )
  let storedSamples = []
  try {
    storedSamples = JSON.parse(row.samples || '[]')
  } catch {
    storedSamples = []
  }
  const sampleList = samples.length > 0
    ? samples.map((sample) => ({ input: sample.input, output: sample.output, timeLimitMs: sample.time_limit_ms || DEFAULT_TESTCASE_TIME_LIMIT_MS }))
    : (Array.isArray(storedSamples) ? storedSamples.map((sample) => ({
      input: String(sample?.input ?? ''),
      output: String(sample?.output ?? ''),
      timeLimitMs: Number(sample?.timeLimitMs) || DEFAULT_TESTCASE_TIME_LIMIT_MS,
    })) : [])

  let maxScore = null
  if (user) {
      const scoreResult = await db.get(
        `SELECT MAX(score) as max_score FROM submissions WHERE problem_id = ? AND user_id = ?`,
        row.id, user.id
      )
      maxScore = scoreResult?.max_score ?? null
  }

  const problemStats = await db.get(
    `SELECT
       (SELECT COUNT(*) FROM submissions WHERE problem_id = ? AND status = 'Accepted') AS ac_count,
       (SELECT COUNT(*) FROM submissions WHERE problem_id = ?) AS total_count`,
    row.id,
    row.id
  )
  const solved = user
    ? Boolean(await db.get(`SELECT 1 FROM solved_problems WHERE user_id = ? AND problem_id = ?`, user.id, row.id))
    : false

  return res.json({
    problem: {
      id: row.id, slug: row.slug, title: row.title, difficulty: row.difficulty,
      tags: row.tags ? row.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      statement: row.statement, input: row.input_desc, output: row.output_desc,
      dataRange: row.data_range || '', samples: sampleList,
      createdAt: row.created_at, creatorId: row.creator_id, creatorName: row.creator_name, maxScore,
      acCount: problemStats?.ac_count || 0,
      totalCount: problemStats?.total_count || 0,
      passRate: problemStats?.total_count > 0
        ? Math.round((problemStats.ac_count / problemStats.total_count) * 100)
        : 0,
      solved,
    },
  })
}

export const listSolutions = async (req, res) => {
  try {
    const db = await getDb()
    const problemId = parseInt(req.params.id)
    if (!problemId) return res.status(400).json({ message: '无效的题目ID' })

    const problem = await db.get(`SELECT id FROM problems WHERE id = ?`, problemId)
    if (!problem) return res.status(404).json({ message: '题目不存在' })

    const solutions = await db.all(
      `SELECT dp.id, dp.user_id, dp.title, dp.like_count, dp.comment_count, dp.view_count, dp.created_at,
              u.name as user_name, u.avatar as user_avatar
       FROM discussion_posts dp LEFT JOIN users u ON dp.user_id = u.id
       WHERE dp.problem_id = ? AND dp.is_solution = 1 ORDER BY dp.created_at DESC`,
      problemId
    )

    let canWrite = false
    const token = getAuthToken(req)
    if (token) {
      const user = await getUserByToken(db, token)
      if (user) {
        const solved = await db.get(
          `SELECT 1 FROM solved_problems WHERE user_id = ? AND problem_id = ?`, user.id, problemId
        )
        canWrite = !!solved
      }
    }

    return res.json({
      solutions: solutions.map((s) => ({
        id: s.id, userId: s.user_id, userName: s.user_name, userAvatar: s.user_avatar,
        title: s.title, likeCount: s.like_count, commentCount: s.comment_count,
        viewCount: s.view_count, createdAt: s.created_at, isSolution: true,
      })),
      canWrite,
    })
  } catch (error) {
    console.error('Failed to list solutions:', error)
    return res.status(500).json({ message: '获取题解列表失败' })
  }
}

export const createSolution = async (req, res) => {
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
      `SELECT 1 FROM solved_problems WHERE user_id = ? AND problem_id = ?`, user.id, problemId
    )
    if (!solved) return res.status(403).json({ message: '通过该题后才能写题解' })

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
      user.id, title.trim(), sanitizeProblemText(content), problemId, now, now
    )
    await addXp(db, user.id, 20)
    return res.json({ success: true, postId: result.lastID })
  } catch (error) {
    console.error('Failed to create solution:', error)
    return res.status(500).json({ message: '发布题解失败' })
  }
}

export const createProblem = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth

  const { title, difficulty, tags, statement, inputDesc, outputDesc, dataRange, samples, testFiles, status } = req.body || {}
  const sanitizedStatement = sanitizeProblemText(statement)
  const sanitizedInputDesc = sanitizeProblemText(inputDesc)
  const sanitizedOutputDesc = sanitizeProblemText(outputDesc)
  const sanitizedDataRange = sanitizeProblemText(dataRange)
  const { samples: normalizedSamples, error: sampleError } = normalizeSamples(samples)
  const { pairs: testFilePairs, error: testFileError } = parseTestFilePairs(testFiles)

  if (!title || !title.trim()) return res.status(400).json({ message: '请填写题目标题' })
  if (!sanitizedStatement) return res.status(400).json({ message: '请填写题目描述' })
  if (sampleError) return res.status(400).json({ message: sampleError })
  if (testFileError) return res.status(400).json({ message: testFileError })

  // 普通出题者创建的题目始终从草稿开始，管理员创建时可以直接发布或保存草稿。
  const nextStatus = user.is_admin ? getAdminCreateStatus(status) : 'draft'

  const now = new Date().toISOString()
  try {
    await db.exec('BEGIN IMMEDIATE')
    const existingIds = await db.all(`SELECT id FROM problems ORDER BY id ASC`)
    let nextId = 1001
    for (const row of existingIds) {
      if (row.id === nextId) nextId++
      else if (row.id > nextId) break
    }

    await db.run(
      `INSERT INTO problems (id, slug, title, difficulty, tags, statement, input_desc, output_desc, data_range, samples, creator_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      nextId, `p${nextId}`, title.trim(), difficulty || '入门',
      Array.isArray(tags) ? tags.join(',') : (tags || ''),
      sanitizedStatement, sanitizedInputDesc, sanitizedOutputDesc, sanitizedDataRange,
      JSON.stringify(normalizedSamples), user.id,
      nextStatus,
      now
    )

    for (const sample of normalizedSamples) {
      await db.run(
        `INSERT INTO testcases (problem_id, input, output, is_sample, time_limit_ms, created_at) VALUES (?, ?, ?, 1, ?, ?)`,
        nextId, sample.input, sample.output, sample.timeLimitMs, now
      )
    }

    for (const pair of testFilePairs) {
      await db.run(
        `INSERT INTO testcases (problem_id, input, output, is_sample, time_limit_ms, created_at) VALUES (?, ?, ?, 0, ?, ?)`,
        nextId, pair.in.content, pair.out.content, pair.timeLimitMs, now
      )
    }

    await db.exec('COMMIT')
    const snapshot = buildProblemSnapshot({
      problem: { title, difficulty, tags, statement: sanitizedStatement, inputDesc: sanitizedInputDesc, outputDesc: sanitizedOutputDesc, dataRange: sanitizedDataRange },
      samples: normalizedSamples,
      testcases: testFilePairs.map((pair) => ({ input: pair.in.content, output: pair.out.content, is_sample: 0, time_limit_ms: pair.timeLimitMs })),
    })
    await recordProblemChange({
      db, problemId: nextId, status: nextStatus, changedBy: user.id, snapshot,
      fromStatus: null, toStatus: nextStatus, note: '创建题目',
    })
    if (user.is_admin) {
      await recordAdminAction(db, {
        adminId: user.id,
        adminName: user.name,
        action: 'problem.create',
        targetType: 'problem',
        targetId: nextId,
        detail: { title: title.trim(), status: nextStatus },
      })
    }
    return res.json({ message: '题目创建成功', problemId: nextId, slug: `p${nextId}` })
  } catch (error) {
    await db.exec('ROLLBACK').catch(() => undefined)
    console.error('创建题目失败:', error)
    return res.status(500).json({ message: '创建题目失败' })
  }
}

export const getMyProblems = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth

  const rows = await db.all(
    `SELECT id, slug, title, difficulty, tags, status, created_at
     FROM problems WHERE creator_id = ? ORDER BY created_at DESC`,
    user.id
  )
  return res.json({
    problems: rows.map((row) => ({
      id: row.id, slug: row.slug, title: row.title, difficulty: row.difficulty,
      tags: row.tags ? row.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      status: row.status, createdAt: row.created_at,
    })),
  })
}

export const getProblemForEdit = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth

  const problemId = Number(req.params.id)
  if (!problemId) return res.status(400).json({ message: '无效的题目ID' })

  const problem = await db.get(`SELECT * FROM problems WHERE id = ?`, problemId)
  if (!problem) return res.status(404).json({ message: '题目不存在' })
  if (problem.creator_id !== user.id && !user.is_admin) return res.status(403).json({ message: '无权限编辑此题目' })

  const testcases = await db.all(
    `SELECT input, output, is_sample, time_limit_ms FROM testcases WHERE problem_id = ? ORDER BY id ASC`, problemId
  )
  const samples = testcases.filter(tc => tc.is_sample === 1).map(tc => ({
    input: tc.input,
    output: tc.output,
    timeLimitMs: tc.time_limit_ms || DEFAULT_TESTCASE_TIME_LIMIT_MS,
  }))
  const testData = testcases.filter(tc => tc.is_sample === 0)
  const testFiles = testData.flatMap((testcase, index) => [
    { name: `${index + 1}.in`, type: 'in', content: testcase.input, timeLimitMs: testcase.time_limit_ms || DEFAULT_TESTCASE_TIME_LIMIT_MS },
    { name: `${index + 1}.out`, type: 'out', content: testcase.output, timeLimitMs: testcase.time_limit_ms || DEFAULT_TESTCASE_TIME_LIMIT_MS },
  ])

  return res.json({
    problem: {
      id: problem.id, slug: problem.slug, title: problem.title, difficulty: problem.difficulty,
      tags: problem.tags ? problem.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      statement: problem.statement, inputDesc: problem.input_desc, outputDesc: problem.output_desc,
      dataRange: problem.data_range, samples, testFiles, testDataCount: testData.length,
      status: problem.status, createdAt: problem.created_at,
    },
  })
}

export const updateProblem = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth

  const problemId = Number(req.params.id)
  if (!problemId) return res.status(400).json({ message: '无效的题目ID' })

  const problem = await db.get(`SELECT * FROM problems WHERE id = ?`, problemId)
  if (!problem) return res.status(404).json({ message: '题目不存在' })
  if (problem.creator_id !== user.id && !user.is_admin) return res.status(403).json({ message: '无权限编辑此题目' })

  const { title, difficulty, tags, statement, inputDesc, outputDesc, dataRange, samples, testFiles, status } = req.body || {}
  const sanitizedStatement = sanitizeProblemText(statement)
  const sanitizedInputDesc = sanitizeProblemText(inputDesc)
  const sanitizedOutputDesc = sanitizeProblemText(outputDesc)
  const sanitizedDataRange = sanitizeProblemText(dataRange)
  const { samples: normalizedSamples, error: sampleError } = normalizeSamples(samples)
  const { pairs: testFilePairs, error: testFileError } = parseTestFilePairs(testFiles)

  if (!title || !title.trim()) return res.status(400).json({ message: '请填写题目标题' })
  if (!sanitizedStatement) return res.status(400).json({ message: '请填写题目描述' })
  if (sampleError) return res.status(400).json({ message: sampleError })
  if (testFileError) return res.status(400).json({ message: testFileError })

  // 管理员可以调整审核状态；普通作者编辑非草稿题目时退回草稿，必须重新提交审核。
  const nextStatus = user.is_admin
    ? normalizeProblemStatus(status, problem.status || 'draft')
    : getCreatorUpdateStatus(problem.status)

  const now = new Date().toISOString()
  try {
    await db.exec('BEGIN IMMEDIATE')
    await db.run(
      `UPDATE problems SET title = ?, difficulty = ?, tags = ?, statement = ?, input_desc = ?, output_desc = ?, data_range = ?, samples = ?, status = ?
       WHERE id = ?`,
      title.trim(), difficulty || '入门',
      Array.isArray(tags) ? tags.join(',') : (tags || ''),
      sanitizedStatement, sanitizedInputDesc, sanitizedOutputDesc, sanitizedDataRange,
      JSON.stringify(normalizedSamples), nextStatus, problemId
    )

    await db.run(`DELETE FROM testcases WHERE problem_id = ?`, problemId)

    for (const sample of normalizedSamples) {
      await db.run(
        `INSERT INTO testcases (problem_id, input, output, is_sample, time_limit_ms, created_at) VALUES (?, ?, ?, 1, ?, ?)`,
        problemId, sample.input, sample.output, sample.timeLimitMs, now
      )
    }

    for (const pair of testFilePairs) {
      await db.run(
        `INSERT INTO testcases (problem_id, input, output, is_sample, time_limit_ms, created_at) VALUES (?, ?, ?, 0, ?, ?)`,
        problemId, pair.in.content, pair.out.content, pair.timeLimitMs, now
      )
    }

    await db.exec('COMMIT')
    const snapshot = buildProblemSnapshot({
      problem: { title, difficulty, tags, statement: sanitizedStatement, inputDesc: sanitizedInputDesc, outputDesc: sanitizedOutputDesc, dataRange: sanitizedDataRange },
      samples: normalizedSamples,
      testcases: testFilePairs.map((pair) => ({ input: pair.in.content, output: pair.out.content, is_sample: 0, time_limit_ms: pair.timeLimitMs })),
    })
    await recordProblemChange({
      db, problemId, status: nextStatus, changedBy: user.id, snapshot,
      fromStatus: problem.status, toStatus: nextStatus,
      note: problem.status === 'pending_review' || problem.status === 'published' ? '编辑后重新进入草稿' : '更新题目',
    })
    if (user.is_admin) {
      await recordAdminAction(db, {
        adminId: user.id,
        adminName: user.name,
        action: 'problem.update',
        targetType: 'problem',
        targetId: problemId,
        detail: { title: title.trim(), status: nextStatus },
      })
    }
    return res.json({ message: '题目更新成功', problemId, status: nextStatus })
  } catch (error) {
    await db.exec('ROLLBACK').catch(() => undefined)
    console.error('更新题目失败:', error)
    return res.status(500).json({ message: '更新题目失败' })
  }
}

export const deleteProblem = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth

  const problemId = Number(req.params.id)
  if (!problemId) return res.status(400).json({ message: '无效的题目ID' })

  const problem = await db.get(`SELECT * FROM problems WHERE id = ?`, problemId)
  if (!problem) return res.status(404).json({ message: '题目不存在' })
  if (problem.creator_id !== user.id && !user.is_admin) return res.status(403).json({ message: '无权限删除此题目' })

  try {
    await db.run(`DELETE FROM problems WHERE id = ?`, problemId)
    await db.run(`DELETE FROM bookmarks WHERE target_type = 'problem' AND target_id = ?`, problemId)
    if (user.is_admin) {
      await recordAdminAction(db, {
        adminId: user.id,
        adminName: user.name,
        action: 'problem.delete',
        targetType: 'problem',
        targetId: problemId,
        detail: { title: problem.title },
      })
    }
    return res.json({ message: '题目删除成功' })
  } catch (error) {
    console.error('删除题目失败:', error)
    return res.status(500).json({ message: '删除题目失败' })
  }
}

export const submitProblemForReview = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  const problemId = Number(req.params.id)
  if (!problemId) return res.status(400).json({ message: '无效的题目ID' })

  const problem = await db.get(
    `SELECT id, creator_id, title, status FROM problems WHERE id = ?`,
    problemId,
  )
  if (!problem) return res.status(404).json({ message: '题目不存在' })
  if (problem.creator_id !== user.id && !user.is_admin) {
    return res.status(403).json({ message: '无权限提交此题目审核' })
  }
  if (user.is_admin) {
    return res.status(400).json({ message: '管理员可以直接在管理面板发布题目' })
  }
  if (problem.status === 'pending_review') {
    return res.status(400).json({ message: '题目已经在审核中' })
  }
  if (problem.status !== 'draft') {
    return res.status(400).json({ message: '只有草稿题目可以提交审核' })
  }

  await db.run(`UPDATE problems SET status = 'pending_review' WHERE id = ?`, problemId)
  await recordProblemChange({
    db, problemId, fromStatus: problem.status, toStatus: 'pending_review',
    changedBy: user.id, note: '作者提交审核',
  })
  const admins = await db.all(`SELECT id FROM users WHERE is_admin = 1 AND is_banned = 0`)
  for (const admin of admins) {
    await createNotification(db, {
      userId: admin.id,
      actorId: user.id,
      type: 'problem.review_requested',
      targetType: 'problem',
      targetId: problemId,
      message: `题目「${problem.title}」已提交审核`,
    })
  }
  return res.json({ message: '题目已提交审核', problemId, status: 'pending_review' })
}

export const listProblemRevisions = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  const problemId = Number(req.params.id)
  const problem = await db.get(`SELECT id, creator_id FROM problems WHERE id = ?`, problemId)
  if (!problem) return res.status(404).json({ message: '题目不存在' })
  if (problem.creator_id !== user.id && !user.is_admin) return res.status(403).json({ message: '无权限查看版本历史' })
  const rows = await db.all(
    `SELECT r.id, r.version, r.status, r.changed_by, r.note, r.created_at, u.name AS changed_by_name
     FROM problem_revisions r LEFT JOIN users u ON u.id = r.changed_by
     WHERE r.problem_id = ? ORDER BY r.version DESC LIMIT 50`,
    problemId,
  )
  return res.json({ revisions: rows.map((row) => ({
    id: row.id, version: row.version, status: row.status, changedBy: row.changed_by,
    changedByName: row.changed_by_name, note: row.note, createdAt: row.created_at,
  })) })
}

export const restoreProblemRevision = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  const problemId = Number(req.params.id)
  const revisionId = Number(req.params.revisionId)
  if (!problemId || !revisionId) return res.status(400).json({ message: '无效的版本编号' })
  const problem = await db.get(`SELECT * FROM problems WHERE id = ?`, problemId)
  if (!problem) return res.status(404).json({ message: '题目不存在' })
  if (problem.creator_id !== user.id && !user.is_admin) return res.status(403).json({ message: '无权限恢复此版本' })
  const revision = await db.get(`SELECT * FROM problem_revisions WHERE id = ? AND problem_id = ?`, revisionId, problemId)
  const snapshot = parseRevisionSnapshot(revision?.snapshot_json)
  if (!revision || !snapshot) return res.status(404).json({ message: '版本不存在或已损坏' })
  if (!snapshot.title || !snapshot.statement || !snapshot.samples?.length) {
    return res.status(400).json({ message: '该版本内容不完整，无法恢复' })
  }

  const nextStatus = user.is_admin ? normalizeProblemStatus(revision.status, problem.status || 'draft') : 'draft'
  const now = new Date().toISOString()
  try {
    await db.exec('BEGIN IMMEDIATE')
    await db.run(
      `UPDATE problems SET title = ?, difficulty = ?, tags = ?, statement = ?, input_desc = ?, output_desc = ?, data_range = ?, samples = ?, status = ? WHERE id = ?`,
      snapshot.title, snapshot.difficulty || '入门', snapshot.tags.join(','), snapshot.statement,
      snapshot.inputDesc || '', snapshot.outputDesc || '', snapshot.dataRange || '', JSON.stringify(snapshot.samples), nextStatus, problemId,
    )
    await db.run(`DELETE FROM testcases WHERE problem_id = ?`, problemId)
    for (const sample of snapshot.samples) {
      await db.run(
        `INSERT INTO testcases (problem_id, input, output, is_sample, time_limit_ms, created_at) VALUES (?, ?, ?, 1, ?, ?)`,
        problemId, sample.input, sample.output, sample.timeLimitMs || DEFAULT_TESTCASE_TIME_LIMIT_MS, now,
      )
    }
    for (const test of snapshot.testData || []) {
      await db.run(
        `INSERT INTO testcases (problem_id, input, output, is_sample, time_limit_ms, created_at) VALUES (?, ?, ?, 0, ?, ?)`,
        problemId, test.input, test.output, test.timeLimitMs || DEFAULT_TESTCASE_TIME_LIMIT_MS, now,
      )
    }
    await db.exec('COMMIT')
    await recordProblemChange({
      db, problemId, status: nextStatus, changedBy: user.id, snapshot,
      fromStatus: problem.status, toStatus: nextStatus, note: `从版本 ${revision.version} 恢复`,
    })
    return res.json({ message: '版本已恢复', problemId, status: nextStatus })
  } catch (error) {
    await db.exec('ROLLBACK').catch(() => undefined)
    console.error('恢复题目版本失败:', error)
    return res.status(500).json({ message: '恢复题目版本失败' })
  }
}
