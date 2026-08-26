import { getDb } from '../db.js'
import os from 'os'
import { requireUser } from '../middleware/auth.js'
import { BoundedCache } from '../utils/boundedCache.js'
import { createExecutionQueue } from '../utils/executionQueue.js'
import { judgeSubmission, runSample, runSamples } from '../judge.js'
import { DEFAULT_TESTCASE_TIME_LIMIT_MS } from '../utils/testcaseLimits.js'
import {
  updateUserStats,
  checkAndUnlockAchievements,
  updateRankings,
} from '../stats.js'
import { sseConnectionLimiter } from '../utils/connectionLimit.js'

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

// 2 核 2G 服务器上给用户代码保留明确的并发上限，避免多个编译/运行进程互相争抢 CPU 和内存。
// 可通过 JUDGE_CONCURRENCY 覆盖，但默认最多使用 2 个评测 worker。
const detectedCpuCount = typeof os.availableParallelism === 'function'
  ? os.availableParallelism()
  : os.cpus().length
const judgeConcurrency = Math.min(2, Math.max(1, Number(process.env.JUDGE_CONCURRENCY) || detectedCpuCount))
const judgeQueue = createExecutionQueue({ maxActive: judgeConcurrency, maxQueued: 50, maxQueuedPerKey: 2 })
const sandboxQueue = createExecutionQueue({ maxActive: Math.min(2, judgeConcurrency), maxQueued: 30, maxQueuedPerKey: 2 })
const persistedJudgeTasks = new Map()

const registerPersistedJudgeTask = (submissionId, task) => {
  if (!task.accepted) return
  const key = Number(submissionId)
  persistedJudgeTasks.set(key, task)
  void task.promise.then(
    () => { if (persistedJudgeTasks.get(key) === task) persistedJudgeTasks.delete(key) },
    () => { if (persistedJudgeTasks.get(key) === task) persistedJudgeTasks.delete(key) },
  )
}

const getLiveQueuePosition = (submissionId, status, fallback) => {
  if (status !== 'Queued') return null
  const task = persistedJudgeTasks.get(Number(submissionId))
  return task?.getPosition?.() || fallback || null
}

const beginSandboxRun = (userId, res) => {
  if (runRateLimits.has(userId)) {
    res.setHeader('Retry-After', '1')
    res.status(429).json({ message: '测试运行过于频繁，请稍后再试' })
    return false
  }
  if (sandboxQueue.isFullFor(userId)) {
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

export const getJudgeQueueSnapshot = () => ({
  activeJudges: judgeQueue.active,
  queuedJudges: judgeQueue.queued,
  maxActiveJudges: judgeQueue.maxActive,
  maxQueuedJudges: judgeQueue.maxQueued,
  activeRuns: sandboxQueue.active,
  queuedRuns: sandboxQueue.queued,
  maxActiveRuns: sandboxQueue.maxActive,
  maxQueuedRuns: sandboxQueue.maxQueued,
})

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
            s.queue_position, s.started_at, s.finished_at, s.attempts, s.updated_at,
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
      queuePosition: row.queue_position, startedAt: row.started_at,
      finishedAt: row.finished_at, attempts: row.attempts || 0, updatedAt: row.updated_at,
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
    `SELECT id, problem_id, language, status, time_ms, memory_kb, message, code, created_at,
            queue_position, started_at, finished_at, attempts, updated_at, results_json, score
     FROM submissions WHERE user_id = ? AND problem_id = ?
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    user.id, numericProblemId
  )
  if (!row) return res.json({ submission: null })
  return res.json({
    submission: {
      id: row.id, problemId: row.problem_id, language: row.language,
      status: row.status, timeMs: row.time_ms, memoryKb: row.memory_kb,
      message: row.message, code: row.code, score: row.score ?? 0,
      results: parseResults(row.results_json), createdAt: row.created_at,
      queuePosition: row.queue_position, startedAt: row.started_at,
      finishedAt: row.finished_at, attempts: row.attempts || 0, updatedAt: row.updated_at,
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
            s.queue_position, s.started_at, s.finished_at, s.attempts, s.updated_at,
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
      createdAt: row.created_at, queuePosition: row.queue_position,
      startedAt: row.started_at, finishedAt: row.finished_at,
      attempts: row.attempts || 0, updatedAt: row.updated_at,
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
            s.queue_position, s.started_at, s.finished_at, s.attempts, s.updated_at,
            p.title as problem_title, u.name as user_name
     FROM submissions s JOIN problems p ON p.id = s.problem_id JOIN users u ON u.id = s.user_id
     WHERE s.id = ? LIMIT 1`,
    submissionId
  )
  if (!row) return res.status(404).json({ message: '提交不存在' })

  const canViewCode = row.user_id === user.id
  const liveQueuePosition = getLiveQueuePosition(row.id, row.status, row.queue_position)
  return res.json({
    submission: {
      id: row.id, problemId: row.problem_id, problemTitle: row.problem_title,
      userId: row.user_id, userName: row.user_name, language: row.language,
      status: row.status, timeMs: row.time_ms, memoryKb: row.memory_kb,
      message: canViewCode ? row.message : null, score: row.score ?? 0,
      code: canViewCode ? row.code : null, canViewCode,
      results: canViewCode ? parseResults(row.results_json) : [],
      createdAt: row.created_at, queuePosition: liveQueuePosition,
      startedAt: row.started_at, finishedAt: row.finished_at,
      attempts: row.attempts || 0, updatedAt: row.updated_at,
    },
  })
}

const _createQueuedSubmission = async (db, { problemId, userId, language, code, queuePosition = null }) => {
  const createdAt = new Date().toISOString()
  const result = await db.run(
    `INSERT INTO submissions
       (problem_id, user_id, language, code, status, time_ms, memory_kb, message, results_json, score,
        queue_position, started_at, finished_at, attempts, updated_at, created_at)
     VALUES (?, ?, ?, ?, 'Queued', NULL, NULL, ?, '[]', 0, ?, NULL, NULL, 0, ?, ?)`,
    problemId, userId, language, code, '等待进入评测队列', queuePosition, createdAt, createdAt,
  )
  return { submissionId: result.lastID, createdAt }
}

const _setSubmissionQueuePosition = async (db, submissionId, queuePosition) => {
  await db.run(
    `UPDATE submissions SET queue_position = ?, updated_at = ? WHERE id = ? AND status = 'Queued'`,
    queuePosition || null, new Date().toISOString(), submissionId,
  )
}

const _markSubmissionRunning = async (db, submissionId) => {
  const now = new Date().toISOString()
  await db.run(
    `UPDATE submissions
     SET status = 'Judging', queue_position = NULL, started_at = ?, attempts = attempts + 1,
         message = ?, updated_at = ?
     WHERE id = ?`,
    now, '正在评测测试点', now, submissionId,
  )
}

const _markSubmissionTerminal = async (db, submissionId, status, message) => {
  const now = new Date().toISOString()
  await db.run(
    `UPDATE submissions
     SET status = ?, queue_position = NULL, finished_at = ?, message = ?, updated_at = ?
     WHERE id = ?`,
    status, now, message, now, submissionId,
  )
}

const _saveSubmission = async (db, { submissionId, problemId, userId, language, code, judgeResult }) => {
  const status = judgeResult.status
  const message = judgeResult.message
  const timeMs = judgeResult.timeMs ?? null
  const score = judgeResult.score ?? 0
  const results = Array.isArray(judgeResult.results) ? judgeResult.results : []
  const resultsJson = JSON.stringify(results)
  const finishedAt = new Date().toISOString()

  if (submissionId) {
    await db.run(
      `UPDATE submissions
       SET status = ?, time_ms = ?, memory_kb = NULL, message = ?, results_json = ?, score = ?,
           queue_position = NULL, finished_at = ?, updated_at = ?
       WHERE id = ?`,
      status, timeMs, message, resultsJson, score, finishedAt, finishedAt, submissionId,
    )
    const row = await db.get(`SELECT created_at FROM submissions WHERE id = ?`, submissionId)
    return { submissionId, status, message, timeMs, score, results, createdAt: row?.created_at || finishedAt }
  }

  // 兼容未来的非队列调用方，正常提交路径都会先创建 Queued 记录。
  const created = await _createQueuedSubmission(db, { problemId, userId, language, code })
  return _saveSubmission(db, { submissionId: created.submissionId, problemId, userId, language, code, judgeResult })
}

const _loadSubmissionTestcases = async (db, problemId) => db.all(
  `SELECT input, output, time_limit_ms as timeLimitMs FROM testcases WHERE problem_id = ? ORDER BY id ASC`,
  problemId,
)

const _findActiveDuplicate = async (db, { userId, problemId, language, code }) => db.get(
  `SELECT id, status, queue_position
   FROM submissions
   WHERE user_id = ? AND problem_id = ? AND language = ? AND code = ?
     AND status IN ('Queued', 'Judging') AND created_at >= ?
   ORDER BY id DESC LIMIT 1`,
  userId,
  problemId,
  language,
  code,
  new Date(Date.now() - 10 * 60 * 1000).toISOString(),
)

const _enqueuePersistedSubmission = (db, { submissionId, problemId, userId, language, code, testcases, onStart, onTestCase }) => {
  const task = judgeQueue.enqueue(
    async () => {
      try {
        const judgeResult = await judgeSubmission({
          language, code, testcases,
          onTestCase,
        })
        const saved = await _saveSubmission(db, {
          submissionId, problemId, userId, language, code, judgeResult,
        })
        await _postSubmitHooks(db, userId, saved.submissionId, problemId, saved.status, saved.createdAt)
        return saved
      } catch (error) {
        await _markSubmissionTerminal(db, submissionId, 'Failed', '评测服务异常，请稍后重试').catch(() => undefined)
        throw error
      }
    },
    {
      key: userId,
      onStart: async () => {
        try {
          await _markSubmissionRunning(db, submissionId)
          await onStart?.()
        } catch (error) {
          await _markSubmissionTerminal(db, submissionId, 'Failed', '评测启动失败，请稍后重试').catch(() => undefined)
          throw error
        }
      },
    },
  )
  return task
}

const waitForRecoveryQueueCapacity = async (userId) => {
  while (judgeQueue.isFullFor(userId)) {
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

export const recoverPendingSubmissions = async () => {
  const db = await getDb()
  const latest = await db.get(
    `SELECT COALESCE(MAX(id), 0) AS max_id FROM submissions WHERE status IN ('Queued', 'Judging')`,
  )
  const maxSubmissionId = Number(latest?.max_id || 0)
  let lastId = 0
  let recovered = 0
  while (lastId < maxSubmissionId) {
    const rows = await db.all(
      `SELECT s.id, s.problem_id, s.user_id, s.language, s.code, s.status, p.status AS problem_status
       FROM submissions s
       JOIN problems p ON p.id = s.problem_id
       WHERE s.id > ? AND s.id <= ? AND s.status IN ('Queued', 'Judging')
       ORDER BY s.id ASC LIMIT 100`,
      lastId, maxSubmissionId,
    )
    if (rows.length === 0) break
    for (const row of rows) {
      lastId = row.id
      if (row.problem_status !== 'published') {
        await _markSubmissionTerminal(db, row.id, 'Failed', '题目已下架，未继续评测')
        continue
      }
      const testcases = await _loadSubmissionTestcases(db, row.problem_id)
      if (testcases.length === 0) {
        await _markSubmissionTerminal(db, row.id, 'Failed', '该题暂无测试用例')
        continue
      }
      await waitForRecoveryQueueCapacity(row.user_id)
      const task = _enqueuePersistedSubmission(db, {
        submissionId: row.id,
        problemId: row.problem_id,
        userId: row.user_id,
        language: row.language,
        code: row.code,
        testcases,
      })
      registerPersistedJudgeTask(row.id, task)
      if (!task.accepted) {
        void task.promise.catch(() => undefined)
        await _markSubmissionTerminal(db, row.id, 'Failed', '服务重启后评测队列容量不足，请重新提交')
        continue
      }
      await _setSubmissionQueuePosition(db, row.id, task.getPosition())
      void task.promise.catch((error) => console.error('[judge] recovered submission failed:', row.id, error?.message || error))
      recovered += 1
    }
  }
  if (recovered > 0) console.log(`[judge] recovered ${recovered} pending submission(s)`)
  return recovered
}

export const cancelSubmission = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const submissionId = Number(req.params.id)
  if (!submissionId) return res.status(400).json({ message: '无效的提交编号' })
  const row = await auth.db.get(`SELECT id, user_id, status FROM submissions WHERE id = ?`, submissionId)
  if (!row) return res.status(404).json({ message: '提交不存在' })
  if (row.user_id !== auth.user.id && !auth.user.is_admin) return res.status(403).json({ message: '无权限操作此提交' })
  if (row.status !== 'Queued') {
    return res.status(409).json({ message: row.status === 'Judging' ? '评测已经开始，暂不支持取消' : '该提交已经结束' })
  }
  const task = persistedJudgeTasks.get(submissionId)
  if (!task || !task.cancel()) return res.status(409).json({ message: '提交正在切换状态，请刷新后重试' })
  await _markSubmissionTerminal(auth.db, submissionId, 'Cancelled', '评测请求已取消')
  return res.json({ ok: true, status: 'Cancelled' })
}

const _postSubmitHooks = async (db, userId, submissionId, problemId, status, createdAt) => {
  const runHook = async (name, hook) => {
    let lastError
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await hook()
        return
      } catch (error) {
        lastError = error
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 250))
      }
    }
    console.error(`[stats] failed to update ${name} after retries:`, lastError)
  }
  const hooks = [
    ['user stats', () => updateUserStats(db, userId)],
    ['achievements', () => checkAndUnlockAchievements(db, userId, { id: submissionId, problemId, status, createdAt })],
    ['rankings', () => updateRankings(db)],
  ]
  for (const [name, hook] of hooks) {
    await runHook(name, hook)
  }
  if (status === 'Accepted' && _queueLeaderboardHistorySave) {
    try {
      _queueLeaderboardHistorySave()
    } catch (error) {
      console.error('[stats] failed to queue leaderboard history:', error)
    }
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

  const duplicate = await _findActiveDuplicate(db, {
    userId: user.id,
    problemId: Number(problemId),
    language,
    code: String(code),
  })
  if (duplicate) {
    return res.status(409).json({
      message: '相同代码已经在评测中，正在使用已有提交记录',
      submissionId: duplicate.id,
      status: duplicate.status,
      queuePosition: duplicate.queue_position,
    })
  }

  if (judgeRateLimits.has(user.id)) {
    res.setHeader('Retry-After', '10')
    return res.status(429).json({ message: '提交过于频繁，请稍后再试' })
  }
  if (judgeQueue.isFullFor(user.id)) {
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

  const queued = await _createQueuedSubmission(db, {
    problemId: Number(problemId), userId: user.id, language, code: String(code),
    queuePosition: judgeQueue.queued + 1,
  })
  const judgeTask = _enqueuePersistedSubmission(db, {
    submissionId: queued.submissionId,
    problemId: Number(problemId),
    userId: user.id,
    language,
    code: String(code),
    testcases,
  })
  registerPersistedJudgeTask(queued.submissionId, judgeTask)
  if (!judgeTask.accepted) {
    void judgeTask.promise.catch(() => undefined)
    await _markSubmissionTerminal(db, queued.submissionId, 'Failed', '评测队列已满，请稍后重试')
    res.setHeader('Retry-After', '5')
    return res.status(503).json({ message: '评测队列已满，请稍后重试' })
  }
  await _setSubmissionQueuePosition(db, queued.submissionId, judgeTask.getPosition())
  const saved = await judgeTask.promise

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

  const duplicate = await _findActiveDuplicate(db, {
    userId: user.id,
    problemId: Number(problemId),
    language,
    code: String(code),
  })
  if (duplicate) {
    return res.status(409).json({
      message: '相同代码已经在评测中，正在使用已有提交记录',
      submissionId: duplicate.id,
      status: duplicate.status,
      queuePosition: duplicate.queue_position,
    })
  }

  if (judgeRateLimits.has(user.id)) {
    res.setHeader('Retry-After', '10')
    return res.status(429).json({ message: '提交过于频繁，请稍后再试' })
  }
  if (judgeQueue.isFullFor(user.id)) {
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

  const releaseSse = sseConnectionLimiter.tryAcquire(user.id)
  if (!releaseSse) {
    res.setHeader('Retry-After', '10')
    return res.status(429).json({ message: '实时连接数已达上限，请稍后重试' })
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  let closed = false
  let judgeTask
  let heartbeatTimer
  let queuedSubmission
  req.on('close', () => {
    closed = true
    releaseSse()
    // SSE 断开不代表用户取消评测：网络切换、页面刷新和反向代理都可能触发 close。
    // 评测任务已持久化，客户端可通过提交详情轮询恢复；只有显式调用 cancel 接口才取消排队任务。
  })
  const sendEvent = (event, data) => {
    if (closed) return
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }
  try {
    queuedSubmission = await _createQueuedSubmission(db, {
      problemId: Number(problemId), userId: user.id, language, code: String(code),
      queuePosition: judgeQueue.queued + 1,
    })
    judgeTask = _enqueuePersistedSubmission(db, {
      submissionId: queuedSubmission.submissionId,
      problemId: Number(problemId),
      userId: user.id,
      language,
      code: String(code),
      testcases,
      onStart: () => sendEvent('start', { submissionId: queuedSubmission.submissionId, totalCases: testcases.length }),
      onTestCase: (tc) => sendEvent('testcase', tc),
    })
    registerPersistedJudgeTask(queuedSubmission.submissionId, judgeTask)
    if (!judgeTask.accepted) {
      void judgeTask.promise.catch(() => undefined)
      await _markSubmissionTerminal(db, queuedSubmission.submissionId, 'Failed', '评测队列已满，请稍后重试')
      sendEvent('error', { submissionId: queuedSubmission.submissionId, message: '评测队列已满，请稍后重试' })
      return
    }
    await _setSubmissionQueuePosition(db, queuedSubmission.submissionId, judgeTask.getPosition())

    const queuePosition = judgeTask.getPosition()
    sendEvent('queued', {
      submissionId: queuedSubmission.submissionId,
      position: queuePosition || 0,
      totalCases: testcases.length,
      activeJudges: judgeQueue.active,
      queuedJudges: judgeQueue.queued,
    })

    heartbeatTimer = setInterval(() => {
      sendEvent('heartbeat', {
        activeJudges: judgeQueue.active,
        queuedJudges: judgeQueue.queued,
        queuePosition: judgeTask?.getPosition() || 0,
      })
    }, 15000)

    const saved = await judgeTask.promise

    sendEvent('done', {
      submission: {
        id: saved.submissionId, problemId: Number(problemId), language,
        status: saved.status, timeMs: saved.timeMs, memoryKb: null,
        message: saved.message, results: saved.results, score: saved.score, createdAt: saved.createdAt,
      },
    })
  } catch (error) {
    if (queuedSubmission?.submissionId && error?.code === 'QUEUE_CANCELLED') {
      await _markSubmissionTerminal(db, queuedSubmission.submissionId, 'Cancelled', '评测请求已取消')
    }
    console.error('Streaming submission failed:', error)
    if (!closed) sendEvent('error', { submissionId: queuedSubmission?.submissionId, message: '评测失败，请稍后重试' })
  } finally {
    releaseSse()
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
  }), { key: user.id })
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
    console.error('Sample run failed:', error)
    return res.status(500).json({ message: '测试运行失败，请稍后重试' })
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
  }), { key: user.id })
  try {
    const runResult = await runTask.promise
    const normalize = (text) => String(text ?? '').replace(/\r\n/g, '\n').trim()
    const expectedOutput = expected === undefined ? '' : String(expected)
    const hasExpectedOutput = expectedOutput.trim().length > 0
    let status = runResult.status
    let message = runResult.message
    if (hasExpectedOutput && runResult.status === 'OK') {
      const match = normalize(runResult.output) === normalize(expectedOutput)
      status = match ? 'Accepted' : 'Wrong Answer'
      message = match ? '样例通过' : '样例未通过'
    }
    return res.json({ output: runResult.output ?? '', expected: hasExpectedOutput ? expectedOutput : '', status, message, timeMs: runResult.timeMs ?? 0 })
  } catch (error) {
    console.error('Custom run failed:', error)
    return res.status(500).json({ message: '测试运行失败，请稍后重试' })
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
  }), { key: user.id })
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
    console.error('Samples run failed:', error)
    return res.status(500).json({ message: '测试运行失败，请稍后重试' })
  }
}
