import { getDb } from '../db.js'
import { requireUser } from '../middleware/auth.js'
import { BoundedCache } from '../utils/boundedCache.js'
import { judgeSubmission, runSample, runSamples } from '../judge.js'
import { DEFAULT_TESTCASE_TIME_LIMIT_MS } from '../utils/testcaseLimits.js'
import {
  updateUserStats,
  checkAndUnlockAchievements,
  updateRankings,
} from '../stats.js'

const parseResults = (raw) => {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

const parseSamples = (raw) => {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

const ALLOWED_LANGUAGES = ['C++', 'Python', 'Java']
const MAX_CODE_LENGTH = 100000

const judgeRateLimits = new BoundedCache(2000, 10000)
const runRateLimits = new BoundedCache(5000, 1000)

// 单个 Node 进程内的有界 FIFO 执行队列。
// 队列只负责调度，不会把用户代码并行塞进同一个工作目录。
const createExecutionQueue = ({ maxActive, maxQueued }) => {
  const pending = []
  let active = 0

  const drain = () => {
    while (active < maxActive && pending.length > 0) {
      const task = pending.shift()
      if (!task || task.cancelled) continue

      task.started = true
      active += 1
      Promise.resolve()
        .then(() => task.onStart?.())
        .then(() => task.run())
        .then(task.resolve, task.reject)
        .finally(() => {
          active = Math.max(0, active - 1)
          drain()
        })
    }
  }

  const enqueue = (run, { onStart } = {}) => {
    let task
    const promise = new Promise((resolve, reject) => {
      task = { run, onStart, resolve, reject, started: false, cancelled: false }
      pending.push(task)
      drain()
    })

    return {
      promise,
      getPosition: () => {
        if (!task || task.started || task.cancelled) return null
        const index = pending.indexOf(task)
        return index >= 0 ? index + 1 : null
      },
      cancel: () => {
        if (!task || task.started || task.cancelled) return false
        const index = pending.indexOf(task)
        if (index < 0) return false
        pending.splice(index, 1)
        task.cancelled = true
        task.reject(new Error('评测请求已取消'))
        drain()
        return true
      },
    }
  }

  return {
    enqueue,
    isFull: () => pending.length >= maxQueued,
    get active() { return active },
    get queued() { return pending.length },
    maxActive,
    maxQueued,
  }
}

const judgeQueue = createExecutionQueue({ maxActive: 4, maxQueued: 50 })
const sandboxQueue = createExecutionQueue({ maxActive: 8, maxQueued: 50 })

const beginSandboxRun = (userId, res) => {
  if (runRateLimits.has(userId)) {
    res.setHeader('Retry-After', '1')
    res.status(429).json({ message: '测试运行过于频繁，请稍后再试' })
    return false
  }
  if (sandboxQueue.isFull()) {
    res.setHeader('Retry-After', '5')
    res.status(503).json({
      message: '测试运行排队人数已满，请稍后再试',
      activeRuns: sandboxQueue.active,
      queuedRuns: sandboxQueue.queued,
      maxActiveRuns: sandboxQueue.maxActive,
      maxQueuedRuns: sandboxQueue.maxQueued,
    })
    return false
  }
  runRateLimits.set(userId, Date.now())
  return true
}

// Circular reference resolved by lazy import in the submissions controller
let _queueLeaderboardHistorySave = null
export const setLeaderboardSaveCallback = (fn) => { _queueLeaderboardHistorySave = fn }

export const getJudgeStatus = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  return res.json({
    activeJudges: judgeQueue.active,
    queuedJudges: judgeQueue.queued,
    maxActiveJudges: judgeQueue.maxActive,
    maxQueuedJudges: judgeQueue.maxQueued,
    activeRuns: sandboxQueue.active,
    queuedRuns: sandboxQueue.queued,
    maxActiveRuns: sandboxQueue.maxActive,
    maxQueuedRuns: sandboxQueue.maxQueued,
  })
}

export const listMySubmissions = async (req, res) => {
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
     FROM submissions s JOIN problems p ON p.id = s.problem_id
     WHERE s.user_id = ?${extra} ORDER BY s.id DESC LIMIT 100`,
    ...params
  )
  return res.json({
    submissions: rows.map((row) => ({
      id: row.id, problemId: row.problem_id, problemTitle: row.problem_title,
      language: row.language, status: row.status, timeMs: row.time_ms,
      memoryKb: row.memory_kb, score: row.score ?? 0,
      results: parseResults(row.results_json), createdAt: row.created_at,
    })),
  })
}

export const getLatestSubmission = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  const numericProblemId = Number(req.query.problemId)
  if (!numericProblemId) return res.status(400).json({ message: '缺少题目编号' })

  const row = await db.get(
    `SELECT id, problem_id, language, status, time_ms, memory_kb, message, code, created_at
     FROM submissions WHERE user_id = ? AND problem_id = ?
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    user.id, numericProblemId
  )
  if (!row) return res.json({ submission: null })
  return res.json({
    submission: {
      id: row.id, problemId: row.problem_id, language: row.language,
      status: row.status, timeMs: row.time_ms, memoryKb: row.memory_kb,
      message: row.message, code: row.code, createdAt: row.created_at,
    },
  })
}

export const listAllSubmissions = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  const { problemId, userId } = req.query || {}
  const numericProblemId = Number(problemId)
  if (!numericProblemId) return res.status(400).json({ message: '缺少题目编号' })

  const params = [numericProblemId]
  let extra = ''
  if (userId) { extra = ' AND s.user_id = ?'; params.push(String(userId)) }

  const rows = await db.all(
    `SELECT s.id, s.problem_id, s.user_id, s.language, s.status, s.time_ms, s.memory_kb, s.score, s.message, s.code, s.created_at, s.results_json,
            u.name as user_name
     FROM submissions s JOIN users u ON u.id = s.user_id
     WHERE s.problem_id = ?${extra} ORDER BY s.created_at DESC, s.id DESC LIMIT 200`,
    ...params
  )
  return res.json({
    submissions: rows.map((row) => ({
      id: row.id, problemId: row.problem_id, userId: row.user_id, userName: row.user_name,
      language: row.language, status: row.status, timeMs: row.time_ms, memoryKb: row.memory_kb,
      score: row.score ?? 0,
      message: row.user_id === user.id ? row.message : null,
      code: row.user_id === user.id ? row.code : null,
      canViewCode: row.user_id === user.id,
      results: row.user_id === user.id ? parseResults(row.results_json) : [],
      createdAt: row.created_at,
    })),
  })
}

export const getSubmission = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  const submissionId = Number(req.params.id)
  if (!submissionId) return res.status(400).json({ message: '无效的提交编号' })

  const row = await db.get(
    `SELECT s.id, s.problem_id, s.user_id, s.language, s.status, s.time_ms, s.memory_kb, s.score, s.message, s.code, s.created_at, s.results_json,
            p.title as problem_title, u.name as user_name
     FROM submissions s JOIN problems p ON p.id = s.problem_id JOIN users u ON u.id = s.user_id
     WHERE s.id = ? LIMIT 1`,
    submissionId
  )
  if (!row) return res.status(404).json({ message: '提交不存在' })

  const canViewCode = row.user_id === user.id
  return res.json({
    submission: {
      id: row.id, problemId: row.problem_id, problemTitle: row.problem_title,
      userId: row.user_id, userName: row.user_name, language: row.language,
      status: row.status, timeMs: row.time_ms, memoryKb: row.memory_kb,
      message: canViewCode ? row.message : null, score: row.score ?? 0,
      code: canViewCode ? row.code : null, canViewCode,
      results: canViewCode ? parseResults(row.results_json) : [],
      createdAt: row.created_at,
    },
  })
}

const _saveSubmission = async (db, { problemId, userId, language, code, judgeResult }) => {
  const status = judgeResult.status
  const message = judgeResult.message
  const timeMs = judgeResult.timeMs ?? null
  const score = judgeResult.score ?? 0
  const results = Array.isArray(judgeResult.results) ? judgeResult.results : []
  const resultsJson = JSON.stringify(results)
  const createdAt = new Date().toISOString()

  const result = await db.run(
    `INSERT INTO submissions (problem_id, user_id, language, code, status, time_ms, memory_kb, message, results_json, score, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    problemId, userId, language, code, status, timeMs, message, resultsJson, score, createdAt
  )
  return { submissionId: result.lastID, status, message, timeMs, score, results, createdAt }
}

const _postSubmitHooks = async (db, userId, submissionId, problemId, status, createdAt) => {
  try {
    await updateUserStats(db, userId, { id: submissionId, problemId, status, createdAt })
    await checkAndUnlockAchievements(db, userId, { id: submissionId, problemId, status, createdAt })
    await updateRankings(db)
    if (status === 'Accepted' && _queueLeaderboardHistorySave) {
      _queueLeaderboardHistorySave()
    }
  } catch (error) {
    console.error('Failed to update stats:', error)
  }
}

export const submitSolution = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth

  const { problemId, language, code } = req.body || {}
  if (!problemId || !language || !code) return res.status(400).json({ message: '请填写完整信息' })
  if (!ALLOWED_LANGUAGES.includes(language)) return res.status(400).json({ message: '不支持的编程语言' })
  if (code.length > MAX_CODE_LENGTH) return res.status(400).json({ message: '代码长度超过限制（最大 100KB）' })

  const problem = await db.get(`SELECT id, status FROM problems WHERE id = ?`, Number(problemId))
  if (!problem) return res.status(404).json({ message: '题目不存在' })
  if (problem.status !== 'published') return res.status(403).json({ message: '题目尚未发布' })

  const testcases = await db.all(
    `SELECT input, output, time_limit_ms as timeLimitMs FROM testcases WHERE problem_id = ? ORDER BY id ASC`, Number(problemId)
  )
  if (testcases.length === 0) return res.status(400).json({ message: '该题暂无测试用例' })

  if (judgeRateLimits.has(user.id)) {
    res.setHeader('Retry-After', '10')
    return res.status(429).json({ message: '提交过于频繁，请稍后再试' })
  }
  if (judgeQueue.isFull()) {
    res.setHeader('Retry-After', '5')
    return res.status(503).json({
      message: '评测排队人数已满，请稍后再试',
      activeJudges: judgeQueue.active,
      queuedJudges: judgeQueue.queued,
      maxActiveJudges: judgeQueue.maxActive,
      maxQueuedJudges: judgeQueue.maxQueued,
    })
  }
  judgeRateLimits.set(user.id, Date.now())

  const judgeTask = judgeQueue.enqueue(() => judgeSubmission({ language, code: String(code), testcases }))
  const judgeResult = await judgeTask.promise

  const saved = await _saveSubmission(db, { problemId: Number(problemId), userId: user.id, language, code: String(code), judgeResult })
  await _postSubmitHooks(db, user.id, saved.submissionId, Number(problemId), saved.status, saved.createdAt)

  return res.json({
    submission: {
      id: saved.submissionId, problemId: Number(problemId), language,
      status: saved.status, timeMs: saved.timeMs, memoryKb: null,
      message: saved.message, results: saved.results, score: saved.score, createdAt: saved.createdAt,
    },
  })
}

export const streamSubmission = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth

  const { problemId, language, code } = req.body || {}
  if (!problemId || !language || !code) return res.status(400).json({ message: '请填写完整信息' })
  if (!ALLOWED_LANGUAGES.includes(language)) return res.status(400).json({ message: '不支持的编程语言' })
  if (code.length > MAX_CODE_LENGTH) return res.status(400).json({ message: '代码长度超过限制（最大 100KB）' })

  const problem = await db.get(`SELECT id, status FROM problems WHERE id = ?`, Number(problemId))
  if (!problem) return res.status(404).json({ message: '题目不存在' })
  if (problem.status !== 'published') return res.status(403).json({ message: '题目尚未发布' })

  const testcases = await db.all(
    `SELECT input, output, time_limit_ms as timeLimitMs FROM testcases WHERE problem_id = ? ORDER BY id ASC`, Number(problemId)
  )
  if (testcases.length === 0) return res.status(400).json({ message: '该题暂无测试用例' })

  if (judgeRateLimits.has(user.id)) {
    res.setHeader('Retry-After', '10')
    return res.status(429).json({ message: '提交过于频繁，请稍后再试' })
  }
  if (judgeQueue.isFull()) {
    res.setHeader('Retry-After', '5')
    return res.status(503).json({
      message: '评测排队人数已满，请稍后再试',
      activeJudges: judgeQueue.active,
      queuedJudges: judgeQueue.queued,
      maxActiveJudges: judgeQueue.maxActive,
      maxQueuedJudges: judgeQueue.maxQueued,
    })
  }
  judgeRateLimits.set(user.id, Date.now())

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
  let judgeTask
  let heartbeatTimer
  try {
    judgeTask = judgeQueue.enqueue(
      () => judgeSubmission({
        language, code: String(code), testcases,
        onTestCase: (tc) => sendEvent('testcase', tc),
      }),
      { onStart: () => sendEvent('start', { totalCases: testcases.length }) },
    )

    const queuePosition = judgeTask.getPosition()
    if (queuePosition !== null) {
      sendEvent('queued', {
        position: queuePosition,
        totalCases: testcases.length,
        activeJudges: judgeQueue.active,
        queuedJudges: judgeQueue.queued,
      })
    }

    heartbeatTimer = setInterval(() => {
      sendEvent('heartbeat', {
        activeJudges: judgeQueue.active,
        queuedJudges: judgeQueue.queued,
        queuePosition: judgeTask?.getPosition() || 0,
      })
    }, 15000)

    req.on('close', () => { judgeTask?.cancel() })
    const judgeResult = await judgeTask.promise

    const saved = await _saveSubmission(db, { problemId: Number(problemId), userId: user.id, language, code: String(code), judgeResult })
    await _postSubmitHooks(db, user.id, saved.submissionId, Number(problemId), saved.status, saved.createdAt)

    sendEvent('done', {
      submission: {
        id: saved.submissionId, problemId: Number(problemId), language,
        status: saved.status, timeMs: saved.timeMs, memoryKb: null,
        message: saved.message, results: saved.results, score: saved.score, createdAt: saved.createdAt,
      },
    })
  } catch (error) {
    console.error('Streaming submission failed:', error)
    sendEvent('error', { message: '评测失败，请稍后重试' })
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    if (!res.writableEnded && !res.destroyed) res.end()
  }
}

export const runSampleHandler = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  const { problemId, language, code, sampleIndex = 0 } = req.body || {}
  if (!problemId || !language || !code) return res.status(400).json({ message: '请填写完整信息' })
  if (!ALLOWED_LANGUAGES.includes(language)) return res.status(400).json({ message: '不支持的编程语言' })
  if (code.length > MAX_CODE_LENGTH) return res.status(400).json({ message: '代码长度超过限制（最大 100KB）' })

  const problem = await db.get(`SELECT id, samples FROM problems WHERE id = ?`, Number(problemId))
  if (!problem) return res.status(404).json({ message: '题目不存在' })

  const sampleRows = await db.all(
    `SELECT input, output, time_limit_ms as timeLimitMs FROM testcases WHERE problem_id = ? AND is_sample = 1 ORDER BY id ASC`, Number(problemId)
  )
  const samples = sampleRows.length ? sampleRows : parseSamples(problem.samples)
  if (!samples || samples.length === 0) return res.status(400).json({ message: '暂无样例' })

  const index = Math.min(Math.max(Number(sampleIndex) || 0, 0), samples.length - 1)
  const sample = samples[index]
  if (!beginSandboxRun(user.id, res)) return
  const runTask = sandboxQueue.enqueue(() => runSample({
    language,
    code: String(code),
    input: String(sample.input ?? ''),
    timeLimitMs: sample.timeLimitMs || DEFAULT_TESTCASE_TIME_LIMIT_MS,
  }))
  try {
    const runResult = await runTask.promise
    const normalize = (text) => String(text ?? '').replace(/\r\n/g, '\n').trim()

    let status = runResult.status
    let message = runResult.message
    if (runResult.status === 'OK') {
      const match = normalize(runResult.output) === normalize(sample.output)
      status = match ? 'Accepted' : 'Wrong Answer'
      message = match ? '样例通过' : '样例未通过'
    }
    return res.json({ output: runResult.output ?? '', expected: String(sample.output ?? ''), status, message, timeMs: runResult.timeMs ?? 0 })
  } catch (error) {
    return res.status(500).json({ message: error?.message || '测试运行失败' })
  }
}

export const runCustomHandler = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { user } = auth
  const { language, code, input, expected } = req.body || {}
  if (!language || !code || input === undefined) return res.status(400).json({ message: '请填写完整信息' })
  if (!ALLOWED_LANGUAGES.includes(language)) return res.status(400).json({ message: '不支持的编程语言' })
  if (code.length > MAX_CODE_LENGTH) return res.status(400).json({ message: '代码长度超过限制（最大 100KB）' })
  if (String(input).length > 10000000) return res.status(400).json({ message: '输入数据长度超过限制（最大 10MB）' })

  if (!beginSandboxRun(user.id, res)) return
  const runTask = sandboxQueue.enqueue(() => runSample({
    language,
    code: String(code),
    input: String(input ?? ''),
    timeLimitMs: DEFAULT_TESTCASE_TIME_LIMIT_MS,
  }))
  try {
    const runResult = await runTask.promise
    const normalize = (text) => String(text ?? '').replace(/\r\n/g, '\n').trim()
    let status = runResult.status
    let message = runResult.message
    if (expected !== undefined && runResult.status === 'OK') {
      const match = normalize(runResult.output) === normalize(expected)
      status = match ? 'Accepted' : 'Wrong Answer'
      message = match ? '样例通过' : '样例未通过'
    }
    return res.json({ output: runResult.output ?? '', expected: expected ?? '', status, message, timeMs: runResult.timeMs ?? 0 })
  } catch (error) {
    return res.status(500).json({ message: error?.message || '测试运行失败' })
  }
}

export const runSamplesHandler = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  const { problemId, language, code } = req.body || {}
  if (!problemId || !language || !code) return res.status(400).json({ message: '请填写完整信息' })
  if (!ALLOWED_LANGUAGES.includes(language)) return res.status(400).json({ message: '不支持的编程语言' })
  if (code.length > MAX_CODE_LENGTH) return res.status(400).json({ message: '代码长度超过限制（最大 100KB）' })

  const problem = await db.get(`SELECT id, samples FROM problems WHERE id = ?`, Number(problemId))
  if (!problem) return res.status(404).json({ message: '题目不存在' })

  const sampleRows = await db.all(
    `SELECT input, output, time_limit_ms as timeLimitMs FROM testcases WHERE problem_id = ? AND is_sample = 1 ORDER BY id ASC`, Number(problemId)
  )
  const samples = sampleRows.length ? sampleRows : parseSamples(problem.samples)
  if (!samples || samples.length === 0) return res.status(400).json({ message: '暂无样例' })

  if (!beginSandboxRun(user.id, res)) return
  const runTask = sandboxQueue.enqueue(() => runSamples({
    language,
    code: String(code),
    inputs: samples.map((s) => ({
      input: String(s.input ?? ''),
      timeLimitMs: s.timeLimitMs || DEFAULT_TESTCASE_TIME_LIMIT_MS,
    })),
  }))
  try {
    const runResult = await runTask.promise
    if (runResult.status !== 'OK') {
      return res.json({ status: runResult.status, message: runResult.message, results: [] })
    }

    const normalize = (text) => String(text ?? '').replace(/\r\n/g, '\n').trim()
    const results = runResult.results.map((item, index) => {
      const expected = String(samples[index]?.output ?? '')
      const output = String(item.output ?? '')
      if (item.status !== 'OK') {
        return { index, output, expected, status: item.status, message: item.message, timeMs: item.timeMs ?? 0 }
      }
      const match = normalize(output) === normalize(expected)
      return { index, output, expected, status: match ? 'Accepted' : 'Wrong Answer', message: match ? '样例通过' : '样例未通过', timeMs: item.timeMs ?? 0 }
    })
    const overall = results.every((r) => r.status === 'Accepted')
      ? { status: 'Accepted', message: '全部样例通过' }
      : { status: 'Wrong Answer', message: '存在样例未通过' }
    return res.json({ ...overall, results })
  } catch (error) {
    return res.status(500).json({ message: error?.message || '测试运行失败' })
  }
}
