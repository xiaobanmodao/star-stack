import { getDb } from '../db.js'
import { requireUser, getAuthToken, getUserByToken } from '../middleware/auth.js'
import { sanitizeProblemText, addXp } from '../utils/userHelpers.js'
import { BoundedCache } from '../utils/boundedCache.js'

const solutionRateLimits = new BoundedCache(5000, 10000)

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
  const { search, tag, difficulty } = req.query || {}
  const where = ['status = ?']
  const params = ['published']
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
  const rows = await db.all(
    `SELECT id, slug, title, difficulty, tags, created_at,
       (SELECT COUNT(*) FROM submissions WHERE problem_id = problems.id AND status = 'Accepted') as ac_count,
       (SELECT COUNT(*) FROM submissions WHERE problem_id = problems.id) as total_count
     FROM problems WHERE ${where.join(' AND ')} ORDER BY id ASC`,
    ...params
  )
  return res.json({
    problems: rows.map((row) => ({
      id: row.id, slug: row.slug, title: row.title, difficulty: row.difficulty,
      tags: row.tags ? row.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      createdAt: row.created_at,
      acCount: row.ac_count || 0, totalCount: row.total_count || 0,
      passRate: row.total_count > 0 ? Math.round((row.ac_count / row.total_count) * 100) : 0,
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

  if (row.status !== 'published') {
    const token = req.headers.authorization?.replace('Bearer ', '')
    const session = token ? await db.get(`SELECT user_id FROM sessions WHERE token = ?`, token) : null
    const isCreator = session && session.user_id === row.creator_id
    if (!isCreator && !(session && (await db.get(`SELECT is_admin FROM users WHERE id = ?`, session.user_id))?.is_admin)) {
      return res.status(404).json({ message: '题目不存在' })
    }
  }

  const samples = await db.all(
    `SELECT input, output FROM testcases WHERE problem_id = ? AND is_sample = 1 ORDER BY id ASC`, row.id
  )
  const sampleList = samples.length > 0 ? samples : JSON.parse(row.samples || '[]')

  let maxScore = null
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (token) {
    const session = await db.get(`SELECT user_id FROM sessions WHERE token = ?`, token)
    if (session) {
      const scoreResult = await db.get(
        `SELECT MAX(score) as max_score FROM submissions WHERE problem_id = ? AND user_id = ?`,
        row.id, session.user_id
      )
      maxScore = scoreResult?.max_score ?? null
    }
  }

  return res.json({
    problem: {
      id: row.id, slug: row.slug, title: row.title, difficulty: row.difficulty,
      tags: row.tags ? row.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      statement: row.statement, input: row.input_desc, output: row.output_desc,
      dataRange: row.data_range || '', samples: sampleList,
      createdAt: row.created_at, creatorId: row.creator_id, creatorName: row.creator_name, maxScore,
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
      user.id, title.trim(), content, problemId, now, now
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

  if (!title || !title.trim()) return res.status(400).json({ message: '请填写题目标题' })
  if (!sanitizedStatement) return res.status(400).json({ message: '请填写题目描述' })
  if (!samples || !Array.isArray(samples) || samples.length === 0) return res.status(400).json({ message: '请至少添加一个样例' })

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
      JSON.stringify(samples), user.id,
      user.is_admin ? (status === 'draft' ? 'draft' : 'published') : 'draft',
      now
    )

    for (const sample of samples) {
      if (sample.input && sample.output) {
        await db.run(
          `INSERT INTO testcases (problem_id, input, output, is_sample, created_at) VALUES (?, ?, ?, 1, ?)`,
          nextId, sample.input, sample.output, now
        )
      }
    }

    if (testFiles && Array.isArray(testFiles)) {
      const inFiles = testFiles.filter(f => f.type === 'in')
      const outFiles = testFiles.filter(f => f.type === 'out')
      for (const inFile of inFiles) {
        const baseName = inFile.name.replace(/\.in$/, '')
        const outFile = outFiles.find(f => f.name.replace(/\.out$/, '') === baseName)
        if (outFile) {
          await db.run(
            `INSERT INTO testcases (problem_id, input, output, is_sample, created_at) VALUES (?, ?, ?, 0, ?)`,
            nextId, inFile.content, outFile.content, now
          )
        }
      }
    }

    await db.exec('COMMIT')
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
    `SELECT input, output, is_sample FROM testcases WHERE problem_id = ? ORDER BY id ASC`, problemId
  )
  const samples = testcases.filter(tc => tc.is_sample === 1).map(tc => ({ input: tc.input, output: tc.output }))
  const testData = testcases.filter(tc => tc.is_sample === 0)
  const testFiles = testData.flatMap((testcase, index) => [
    { name: `${index + 1}.in`, type: 'in', content: testcase.input },
    { name: `${index + 1}.out`, type: 'out', content: testcase.output },
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

  if (!title || !title.trim()) return res.status(400).json({ message: '请填写题目标题' })
  if (!sanitizedStatement) return res.status(400).json({ message: '请填写题目描述' })
  if (!samples || !Array.isArray(samples) || samples.length === 0) return res.status(400).json({ message: '请至少添加一个样例' })

  const now = new Date().toISOString()
  try {
    await db.exec('BEGIN IMMEDIATE')
    await db.run(
      `UPDATE problems SET title = ?, difficulty = ?, tags = ?, statement = ?, input_desc = ?, output_desc = ?, data_range = ?, samples = ?, status = ?
       WHERE id = ?`,
      title.trim(), difficulty || '入门',
      Array.isArray(tags) ? tags.join(',') : (tags || ''),
      sanitizedStatement, sanitizedInputDesc, sanitizedOutputDesc, sanitizedDataRange,
      JSON.stringify(samples), status || 'published', problemId
    )

    await db.run(`DELETE FROM testcases WHERE problem_id = ?`, problemId)

    for (const sample of samples) {
      if (sample.input && sample.output) {
        await db.run(
          `INSERT INTO testcases (problem_id, input, output, is_sample, created_at) VALUES (?, ?, ?, 1, ?)`,
          problemId, sample.input, sample.output, now
        )
      }
    }

    if (testFiles && Array.isArray(testFiles)) {
      const inFiles = testFiles.filter(f => f.type === 'in')
      const outFiles = testFiles.filter(f => f.type === 'out')
      for (const inFile of inFiles) {
        const baseName = inFile.name.replace(/\.in$/, '')
        const outFile = outFiles.find(f => f.name.replace(/\.out$/, '') === baseName)
        if (outFile) {
          await db.run(
            `INSERT INTO testcases (problem_id, input, output, is_sample, created_at) VALUES (?, ?, ?, 0, ?)`,
            problemId, inFile.content, outFile.content, now
          )
        }
      }
    }

    await db.exec('COMMIT')
    return res.json({ message: '题目更新成功', problemId })
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
    return res.json({ message: '题目删除成功' })
  } catch (error) {
    console.error('删除题目失败:', error)
    return res.status(500).json({ message: '删除题目失败' })
  }
}
