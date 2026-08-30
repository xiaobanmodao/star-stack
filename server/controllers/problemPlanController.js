import { getDb } from '../db.js'
import { requireUser } from '../middleware/auth.js'
import { serializeDifficulty } from '../utils/difficulty.js'

export const getProblemPlan = async (req, res) => {
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
    return res.json({ plans: plans.map((plan) => ({ ...plan, ...serializeDifficulty(plan.difficulty) })) })
  } catch (error) {
    console.error('Failed to get problem plan:', error)
    return res.status(500).json({ message: '获取做题计划失败' })
  }
}

export const addToPlan = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  const { problemId } = req.body || {}

  if (!problemId) return res.status(400).json({ message: '缺少题目ID' })

  try {
    const problem = await db.get(`SELECT id FROM problems WHERE id = ?`, problemId)
    if (!problem) return res.status(404).json({ message: '题目不存在' })

    const existing = await db.get(
      `SELECT id FROM problem_plan WHERE user_id = ? AND problem_id = ?`,
      user.id, problemId
    )
    if (existing) return res.status(400).json({ message: '该题目已在计划中' })

    const now = new Date().toISOString()
    const result = await db.run(
      `INSERT INTO problem_plan (user_id, problem_id, added_at, completed) VALUES (?, ?, ?, 0)`,
      user.id, problemId, now
    )
    return res.json({ id: result.lastID, message: '已添加到做题计划' })
  } catch (error) {
    console.error('Failed to add to problem plan:', error)
    return res.status(500).json({ message: '添加到做题计划失败' })
  }
}

export const removeFromPlan = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  const planId = req.params.id

  try {
    const plan = await db.get(
      `SELECT id FROM problem_plan WHERE id = ? AND user_id = ?`,
      planId, user.id
    )
    if (!plan) return res.status(404).json({ message: '计划项不存在' })

    await db.run(`DELETE FROM problem_plan WHERE id = ?`, planId)
    return res.json({ message: '已从做题计划移除' })
  } catch (error) {
    console.error('Failed to remove from problem plan:', error)
    return res.status(500).json({ message: '移除失败' })
  }
}

export const completePlanItem = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  const planId = req.params.id
  const { completed } = req.body || {}

  try {
    const plan = await db.get(
      `SELECT id FROM problem_plan WHERE id = ? AND user_id = ?`,
      planId, user.id
    )
    if (!plan) return res.status(404).json({ message: '计划项不存在' })

    if (completed !== true && completed !== false) return res.status(400).json({ message: '完成状态不正确' })
    const now = completed ? new Date().toISOString() : null
    await db.run(
      `UPDATE problem_plan SET completed = ?, completed_at = ? WHERE id = ?`,
      completed ? 1 : 0, now, planId
    )
    return res.json({ message: completed ? '已标记为完成' : '已取消完成标记' })
  } catch (error) {
    console.error('Failed to update problem plan:', error)
    return res.status(500).json({ message: '更新失败' })
  }
}
