import bcrypt from 'bcryptjs'
import { getDb } from '../db.js'
import { requireAdmin } from '../middleware/auth.js'
import { localDay } from '../utils/dateHelpers.js'
import { broadcastToScope } from './chatController.js'
import { recordAdminAction } from '../utils/adminAudit.js'
import { createNotification } from '../utils/notifications.js'
import { parseRevisionSnapshot, recordProblemStatusChange } from '../utils/problemRevisions.js'
import { collectSystemMetrics } from '../utils/monitoring.js'
import { getJudgeQueueSnapshot } from './submissionsController.js'

const parsePositiveInteger = (value) => {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

const normalizeSearch = (value, maxLength = 100) => String(value || '').trim().slice(0, maxLength)

const getAdminName = (user) => user?.name || user?.id || '管理员'

const normalizeAdminUserInput = (body = {}) => ({
  id: typeof body.id === 'string' ? body.id.trim() : '',
  name: typeof body.name === 'string' ? body.name.trim() : '',
  password: typeof body.password === 'string' ? body.password : '',
})

export const listAdminUsers = async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const { db } = auth
  const users = await db.all(
    `SELECT id, name, email, is_admin, is_banned, created_at FROM users ORDER BY created_at DESC`
  )
  return res.json({
    users: users.map((item) => ({
      id: item.id,
      name: item.name,
      email: item.email,
      isAdmin: Boolean(item.is_admin),
      isBanned: Boolean(item.is_banned),
      createdAt: item.created_at,
    })),
  })
}

export const createAdminUser = async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const { db } = auth
  const { id, name, password } = normalizeAdminUserInput(req.body)
  const isAdmin = req.body?.isAdmin === true
  if (!id || !name || !password) return res.status(400).json({ message: '请填写完整信息' })
  if (password.length < 6) return res.status(400).json({ message: '密码至少 6 位' })
  if (id.length > 64) return res.status(400).json({ message: '用户 ID 不能超过 64 个字符' })
  if (name.length > 80) return res.status(400).json({ message: '用户名称不能超过 80 个字符' })
  if (password.length > 128) return res.status(400).json({ message: '密码不能超过 128 个字符' })
  const existing = await db.get(`SELECT id FROM users WHERE id = ?`, id)
  if (existing) return res.status(409).json({ message: '该 ID 已被注册' })
  const passwordHash = await bcrypt.hash(password, 10)
  await db.run(
    `INSERT INTO users (id, name, password_hash, is_admin, is_banned, created_at) VALUES (?, ?, ?, ?, 0, ?)`,
    id, name, passwordHash, isAdmin ? 1 : 0, new Date().toISOString()
  )
  await recordAdminAction(db, {
    adminId: auth.user.id,
    adminName: getAdminName(auth.user),
    action: 'user.create',
    targetType: 'user',
    targetId: id,
    detail: { name, isAdmin: Boolean(isAdmin) },
  })
  return res.json({ user: { id, name, isAdmin: Boolean(isAdmin), isBanned: false } })
}

export const promoteUser = async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const { db } = auth
  const targetId = req.params.id
  const target = await db.get(`SELECT id, is_admin FROM users WHERE id = ?`, targetId)
  if (!target) return res.status(404).json({ message: '用户不存在' })
  if (target.is_admin) return res.json({ ok: true })
  await db.run(`UPDATE users SET is_admin = 1 WHERE id = ?`, targetId)
  await recordAdminAction(db, {
    adminId: auth.user.id,
    adminName: getAdminName(auth.user),
    action: 'user.promote', targetType: 'user', targetId,
  })
  return res.json({ ok: true })
}

export const demoteUser = async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const { db } = auth
  const targetId = req.params.id
  if (targetId === auth.user.id) return res.status(400).json({ message: '不能降级自己的管理员权限' })
  const target = await db.get(`SELECT id, is_admin FROM users WHERE id = ?`, targetId)
  if (!target) return res.status(404).json({ message: '用户不存在' })
  if (!target.is_admin) return res.json({ ok: true })
  const adminCount = await db.get(`SELECT COUNT(*) as count FROM users WHERE is_admin = 1`)
  if (adminCount?.count <= 1) return res.status(400).json({ message: '不能降级最后一个管理员' })
  await db.run(`UPDATE users SET is_admin = 0 WHERE id = ?`, targetId)
  await recordAdminAction(db, {
    adminId: auth.user.id,
    adminName: getAdminName(auth.user),
    action: 'user.demote', targetType: 'user', targetId,
  })
  return res.json({ ok: true })
}

export const resetPassword = async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const { db } = auth
  const targetId = req.params.id
  const { password } = req.body || {}
  if (!password) return res.status(400).json({ message: '请输入新密码' })
  if (password.length < 6) return res.status(400).json({ message: '密码至少 6 位' })
  const target = await db.get(`SELECT id FROM users WHERE id = ?`, targetId)
  if (!target) return res.status(404).json({ message: '用户不存在' })
  const passwordHash = await bcrypt.hash(password, 10)
  await db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, passwordHash, targetId)
  await db.run(`DELETE FROM sessions WHERE user_id = ?`, targetId)
  await recordAdminAction(db, {
    adminId: auth.user.id,
    adminName: getAdminName(auth.user),
    action: 'user.reset_password', targetType: 'user', targetId,
  })
  return res.json({ ok: true })
}

export const banUser = async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const { db, user: adminUser } = auth
  const targetId = req.params.id
  const { banned } = req.body || {}
  const banValue = banned ? 1 : 0
  const target = await db.get(`SELECT id, is_admin, is_banned FROM users WHERE id = ?`, targetId)
  if (!target) return res.status(404).json({ message: '用户不存在' })
  if (banValue === 1) {
    if (targetId === adminUser.id) return res.status(400).json({ message: '不能封禁自己' })
    if (target.is_admin) {
      const adminCount = await db.get(`SELECT COUNT(*) as count FROM users WHERE is_admin = 1`)
      if (adminCount?.count <= 1) return res.status(400).json({ message: '不能封禁最后一个管理员' })
    }
  }
  await db.run(`UPDATE users SET is_banned = ? WHERE id = ?`, banValue, targetId)
  if (banValue === 1) await db.run(`DELETE FROM sessions WHERE user_id = ?`, targetId)
  await recordAdminAction(db, {
    adminId: auth.user.id,
    adminName: getAdminName(auth.user),
    action: banValue === 1 ? 'user.ban' : 'user.unban',
    targetType: 'user', targetId,
  })
  return res.json({ ok: true })
}

export const deleteAdminUser = async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const { db, user: adminUser } = auth
  const targetId = req.params.id
  if (targetId === adminUser.id) return res.status(400).json({ message: '不能删除自己' })
  const target = await db.get(`SELECT id, is_admin FROM users WHERE id = ?`, targetId)
  if (!target) return res.status(404).json({ message: '用户不存在' })
  if (target.is_admin) {
    const adminCount = await db.get(`SELECT COUNT(*) as count FROM users WHERE is_admin = 1`)
    if (adminCount?.count <= 1) return res.status(400).json({ message: '不能删除最后一个管理员' })
  }
  await db.run(`DELETE FROM users WHERE id = ?`, targetId)
  await db.run(`DELETE FROM sessions WHERE user_id = ?`, targetId)
  await recordAdminAction(db, {
    adminId: auth.user.id,
    adminName: getAdminName(auth.user),
    action: 'user.delete', targetType: 'user', targetId,
  })
  return res.status(204).end()
}

export const listAdminProblems = async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const { db } = auth
  try {
    const query = normalizeSearch(req.query.q)
    const requestedStatus = normalizeSearch(req.query.status, 20)
    const allowedStatuses = new Set(['draft', 'pending_review', 'published', 'hidden'])
    const where = []
    const params = []
    if (allowedStatuses.has(requestedStatus)) {
      where.push('p.status = ?')
      params.push(requestedStatus)
    }
    if (query) {
      const problemId = parsePositiveInteger(query)
      if (problemId) {
        where.push('(p.id = ? OR p.title LIKE ? OR p.slug LIKE ?)')
        params.push(problemId, `%${query}%`, `%${query}%`)
      } else {
        where.push('(p.title LIKE ? OR p.slug LIKE ? OR p.tags LIKE ?)')
        params.push(`%${query}%`, `%${query}%`, `%${query}%`)
      }
    }
    const rows = await db.all(
      `SELECT p.id, p.slug, p.title, p.difficulty, p.tags, p.status, p.creator_id, p.created_at,
              u.name AS creator_name,
              (SELECT COUNT(*) FROM testcases t WHERE t.problem_id = p.id) AS testcase_count
       FROM problems p
       LEFT JOIN users u ON u.id = p.creator_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT 200`,
      ...params
    )
    return res.json({
      problems: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        difficulty: row.difficulty,
        tags: row.tags ? row.tags.split(',').map((tag) => tag.trim()).filter(Boolean) : [],
        status: row.status || 'published',
        creatorId: row.creator_id,
        creatorName: row.creator_name || row.creator_id || '未知用户',
        testcaseCount: row.testcase_count || 0,
        createdAt: row.created_at,
      })),
    })
  } catch (error) {
    console.error('Failed to list admin problems:', error)
    return res.status(500).json({ message: '获取题目列表失败' })
  }
}

export const setProblemStatus = async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const { db, user } = auth
  const problemId = parsePositiveInteger(req.params.id)
  const status = normalizeSearch(req.body?.status, 20)
  const note = normalizeSearch(req.body?.note, 500)
  if (!problemId) return res.status(400).json({ message: '无效的题目 ID' })
  if (!['draft', 'pending_review', 'published', 'hidden'].includes(status)) {
    return res.status(400).json({ message: '无效的题目状态' })
  }
  const problem = await db.get(`SELECT id, status, title FROM problems WHERE id = ?`, problemId)
  if (!problem) return res.status(404).json({ message: '题目不存在' })
  if (problem.status === status) return res.json({ ok: true, status })
  await db.run(`UPDATE problems SET status = ? WHERE id = ?`, status, problemId)
  try {
    await recordProblemStatusChange(db, {
      problemId, fromStatus: problem.status, toStatus: status,
      changedBy: user.id, note: note || '管理员更新题目状态',
    })
  } catch (error) {
    console.error('[admin] failed to record problem status history:', error)
  }
  const creator = await db.get(`SELECT creator_id FROM problems WHERE id = ?`, problemId)
  if (creator?.creator_id && creator.creator_id !== user.id) {
    const statusText = status === 'published' ? '已发布' : status === 'hidden' ? '已隐藏' : status === 'draft' ? '已退回草稿' : '审核中'
    await createNotification(db, {
      userId: creator.creator_id,
      actorId: user.id,
      type: 'problem.status_changed',
      targetType: 'problem',
      targetId: problemId,
      message: `题目「${problem.title}」${statusText}${note ? `：${note}` : ''}`,
    })
  }
  await recordAdminAction(db, {
    adminId: user.id,
    adminName: getAdminName(user),
    action: 'problem.status',
    targetType: 'problem',
    targetId: problemId,
    detail: { title: problem.title, from: problem.status, to: status, note },
  })
  return res.json({ ok: true, status })
}

export const deleteAdminProblem = async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const { db, user } = auth
  const problemId = parsePositiveInteger(req.params.id)
  if (!problemId) return res.status(400).json({ message: '无效的题目 ID' })
  const problem = await db.get(`SELECT id, title FROM problems WHERE id = ?`, problemId)
  if (!problem) return res.status(404).json({ message: '题目不存在' })
  try {
    await db.exec('BEGIN IMMEDIATE')
    await db.run(`DELETE FROM bookmarks WHERE target_type = 'problem' AND target_id = ?`, problemId)
    await db.run(`DELETE FROM problems WHERE id = ?`, problemId)
    await db.exec('COMMIT')
    await recordAdminAction(db, {
      adminId: user.id,
      adminName: getAdminName(user),
      action: 'problem.delete', targetType: 'problem', targetId: problemId,
      detail: { title: problem.title },
    })
    return res.json({ message: '题目删除成功' })
  } catch (error) {
    await db.exec('ROLLBACK').catch(() => undefined)
    console.error('Failed to delete admin problem:', error)
    return res.status(500).json({ message: '题目删除失败' })
  }
}

export const getAdminStats = async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const { db } = auth
  try {
    const [users, posts, comments, chatMessages, rooms, reports, pendingProblems, todayActive] = await Promise.all([
      db.get(`SELECT COUNT(*) as c FROM users`),
      db.get(`SELECT COUNT(*) as c FROM discussion_posts`),
      db.get(`SELECT COUNT(*) as c FROM discussion_comments`),
      db.get(`SELECT COUNT(*) as c FROM chat_messages`),
      db.get(`SELECT COUNT(*) as c FROM chat_rooms`),
      db.get(`SELECT COUNT(*) as c FROM reports WHERE status = 'open'`),
      db.get(`SELECT COUNT(*) as c FROM problems WHERE status = 'pending_review'`),
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
        pendingProblems: pendingProblems?.c || 0,
        todayActive: todayActive?.c || 0,
      },
    })
  } catch (error) {
    console.error('Failed to get admin stats:', error)
    return res.status(500).json({ message: '获取统计失败' })
  }
}

export const getAdminMetrics = async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  try {
    const metrics = await collectSystemMetrics({ db: auth.db, judge: getJudgeQueueSnapshot() })
    return res.json({ metrics })
  } catch (error) {
    console.error('Failed to get admin metrics:', error)
    return res.status(500).json({ message: '获取系统监控失败' })
  }
}

export const getAdminProblemReview = async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const problemId = parsePositiveInteger(req.params.id)
  if (!problemId) return res.status(400).json({ message: '无效的题目 ID' })
  try {
    const problem = await auth.db.get(
      `SELECT p.id, p.slug, p.title, p.difficulty, p.tags, p.statement, p.input_desc, p.output_desc,
              p.data_range, p.status, p.creator_id, p.created_at, u.name AS creator_name
       FROM problems p LEFT JOIN users u ON u.id = p.creator_id WHERE p.id = ?`,
      problemId,
    )
    if (!problem) return res.status(404).json({ message: '题目不存在' })
    const testcases = await auth.db.all(
      `SELECT id, is_sample, input, output, time_limit_ms FROM testcases WHERE problem_id = ? ORDER BY id ASC LIMIT 20`,
      problemId,
    )
    const revisions = await auth.db.all(
      `SELECT r.id, r.version, r.status, r.changed_by, r.note, r.created_at, u.name AS changed_by_name, r.snapshot_json
       FROM problem_revisions r LEFT JOIN users u ON u.id = r.changed_by
       WHERE r.problem_id = ? ORDER BY r.version DESC LIMIT 12`,
      problemId,
    )
    return res.json({
      review: {
        problem: {
          id: problem.id, slug: problem.slug, title: problem.title, difficulty: problem.difficulty,
          tags: String(problem.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean),
          statement: problem.statement, inputDesc: problem.input_desc, outputDesc: problem.output_desc,
          dataRange: problem.data_range, status: problem.status, creatorId: problem.creator_id,
          creatorName: problem.creator_name || problem.creator_id, createdAt: problem.created_at,
        },
        testcases: testcases.map((testcase) => ({
          id: testcase.id, isSample: Boolean(testcase.is_sample), input: String(testcase.input || '').slice(0, 600),
          output: String(testcase.output || '').slice(0, 600), timeLimitMs: testcase.time_limit_ms,
        })),
        revisions: revisions.map((revision) => {
          const snapshot = parseRevisionSnapshot(revision.snapshot_json)
          return {
            id: revision.id, version: revision.version, status: revision.status, note: revision.note,
            changedByName: revision.changed_by_name || revision.changed_by || '系统', createdAt: revision.created_at,
            statementLength: snapshot?.statement?.length || 0,
            testcaseCount: (snapshot?.samples?.length || 0) + (snapshot?.testData?.length || 0),
          }
        }),
      },
    })
  } catch (error) {
    console.error('Failed to get admin problem review:', error)
    return res.status(500).json({ message: '获取题目审核详情失败' })
  }
}

export const listAdminReports = async (req, res) => {
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
        reason: row.reason || '未填写原因',
        status: row.status,
        resolutionNote: row.resolution_note || '',
        resolvedBy: row.resolved_by,
        resolvedAt: row.resolved_at,
        summary,
        createdAt: row.created_at,
      })
    }
    return res.json({ reports: enriched })
  } catch (error) {
    console.error('Failed to list reports:', error)
    return res.status(500).json({ message: '获取举报失败' })
  }
}

export const resolveReport = async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const reportId = parseInt(req.params.id)
    if (!Number.isInteger(reportId) || reportId <= 0) return res.status(400).json({ message: '无效的举报 ID' })
    const report = await db.get(`SELECT id, status, target_type, target_id FROM reports WHERE id = ?`, reportId)
    if (!report) return res.status(404).json({ message: '举报不存在' })
    const resolutionNote = normalizeSearch(req.body?.note, 1000)
    const now = new Date().toISOString()
    await db.run(
      `UPDATE reports SET status = 'resolved', resolved_by = ?, resolved_at = ?, resolution_note = ? WHERE id = ?`,
      user.id, now, resolutionNote, reportId
    )
    await recordAdminAction(db, {
      adminId: user.id,
      adminName: getAdminName(user),
      action: 'report.resolve',
      targetType: report.target_type,
      targetId: report.target_id,
      detail: { reportId, from: report.status, note: resolutionNote },
    })
    return res.json({ message: '已处理' })
  } catch (error) {
    console.error('Failed to resolve report:', error)
    return res.status(500).json({ message: '操作失败' })
  }
}

export const adminDeleteMessage = async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const messageId = parseInt(req.params.id)
    const message = await db.get(`SELECT * FROM chat_messages WHERE id = ?`, messageId)
    if (!message) return res.status(404).json({ message: '消息不存在' })
    const scopeKey = message.channel_key ? `channel:${message.channel_key}` : `room:${message.room_id}`
    await db.run(`DELETE FROM chat_messages WHERE id = ?`, messageId)
    broadcastToScope(scopeKey, { type: 'message_deleted', messageId })
    await recordAdminAction(db, {
      adminId: user.id,
      adminName: getAdminName(user),
      action: 'message.delete', targetType: 'message', targetId: messageId,
    })
    return res.json({ message: '消息已删除' })
  } catch (error) {
    console.error('Failed to delete message:', error)
    return res.status(500).json({ message: '操作失败' })
  }
}

export const deleteAdminDiscussion = async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const { db, user } = auth
  const postId = parsePositiveInteger(req.params.id)
  if (!postId) return res.status(400).json({ message: '无效的帖子 ID' })
  const post = await db.get(`SELECT id, title FROM discussion_posts WHERE id = ?`, postId)
  if (!post) return res.status(404).json({ message: '帖子不存在' })
  try {
    await db.run(`DELETE FROM discussion_likes WHERE target_type = 'comment' AND target_id IN (SELECT id FROM discussion_comments WHERE post_id = ?)`, postId)
    await db.run(`DELETE FROM discussion_likes WHERE target_type = 'post' AND target_id = ?`, postId)
    await db.run(`DELETE FROM discussion_comments WHERE post_id = ?`, postId)
    await db.run(`DELETE FROM notifications WHERE target_type = 'post' AND target_id = ?`, postId)
    await db.run(`DELETE FROM bookmarks WHERE target_type = 'post' AND target_id = ?`, postId)
    await db.run(`DELETE FROM discussion_posts WHERE id = ?`, postId)
    await recordAdminAction(db, {
      adminId: user.id,
      adminName: getAdminName(user),
      action: 'discussion.delete', targetType: 'post', targetId: postId,
      detail: { title: post.title },
    })
    return res.json({ message: '帖子已删除' })
  } catch (error) {
    console.error('Failed to delete admin discussion:', error)
    return res.status(500).json({ message: '帖子删除失败' })
  }
}

export const deleteAdminComment = async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const { db, user } = auth
  const commentId = parsePositiveInteger(req.params.id)
  if (!commentId) return res.status(400).json({ message: '无效的评论 ID' })
  const comment = await db.get(`SELECT id, post_id FROM discussion_comments WHERE id = ?`, commentId)
  if (!comment) return res.status(404).json({ message: '评论不存在' })
  try {
    const replyCount = await db.get(`SELECT COUNT(*) AS count FROM discussion_comments WHERE parent_id = ?`, commentId)
    const totalRemoved = 1 + (replyCount?.count || 0)
    await db.run(`DELETE FROM discussion_likes WHERE target_type = 'comment' AND target_id IN (SELECT id FROM discussion_comments WHERE parent_id = ?)`, commentId)
    await db.run(`DELETE FROM discussion_likes WHERE target_type = 'comment' AND target_id = ?`, commentId)
    await db.run(`DELETE FROM discussion_comments WHERE parent_id = ?`, commentId)
    await db.run(`DELETE FROM discussion_comments WHERE id = ?`, commentId)
    await db.run(`UPDATE discussion_posts SET comment_count = MAX(0, comment_count - ?) WHERE id = ?`, totalRemoved, comment.post_id)
    await recordAdminAction(db, {
      adminId: user.id,
      adminName: getAdminName(user),
      action: 'discussion.delete', targetType: 'comment', targetId: commentId,
      detail: { postId: comment.post_id, removedCount: totalRemoved },
    })
    return res.json({ message: '评论已删除' })
  } catch (error) {
    console.error('Failed to delete admin comment:', error)
    return res.status(500).json({ message: '评论删除失败' })
  }
}

export const listAdminAuditLogs = async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const { db } = auth
  try {
    const limit = Math.min(200, Math.max(1, parsePositiveInteger(req.query.limit) || 100))
    const rows = await db.all(
      `SELECT id, admin_id, admin_name, action, target_type, target_id, detail, created_at
       FROM admin_audit_logs ORDER BY created_at DESC, id DESC LIMIT ?`,
      limit
    )
    return res.json({
      logs: rows.map((row) => ({
        id: row.id,
        adminId: row.admin_id,
        adminName: row.admin_name,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        detail: row.detail,
        createdAt: row.created_at,
      })),
    })
  } catch (error) {
    console.error('Failed to list admin audit logs:', error)
    return res.status(500).json({ message: '获取操作日志失败' })
  }
}
