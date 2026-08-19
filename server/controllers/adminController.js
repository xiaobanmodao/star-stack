import bcrypt from 'bcryptjs'
import { getDb } from '../db.js'
import { requireAdmin } from '../middleware/auth.js'
import { localDay } from '../utils/dateHelpers.js'
import { broadcastToScope } from './chatController.js'

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
    `SELECT id, name, is_admin, is_banned, created_at FROM users ORDER BY created_at DESC`
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
  return res.json({ ok: true })
}

export const demoteUser = async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const { db } = auth
  const targetId = req.params.id
  const target = await db.get(`SELECT id, is_admin FROM users WHERE id = ?`, targetId)
  if (!target) return res.status(404).json({ message: '用户不存在' })
  if (!target.is_admin) return res.json({ ok: true })
  const adminCount = await db.get(`SELECT COUNT(*) as count FROM users WHERE is_admin = 1`)
  if (adminCount?.count <= 1) return res.status(400).json({ message: '不能降级最后一个管理员' })
  await db.run(`UPDATE users SET is_admin = 0 WHERE id = ?`, targetId)
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
  return res.status(204).end()
}

export const getAdminStats = async (req, res) => {
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
}

export const resolveReport = async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const { db } = auth
  try {
    const reportId = parseInt(req.params.id)
    if (!Number.isInteger(reportId) || reportId <= 0) return res.status(400).json({ message: '无效的举报 ID' })
    const report = await db.get(`SELECT id FROM reports WHERE id = ?`, reportId)
    if (!report) return res.status(404).json({ message: '举报不存在' })
    await db.run(`UPDATE reports SET status = 'resolved' WHERE id = ?`, reportId)
    return res.json({ message: '已处理' })
  } catch (error) {
    console.error('Failed to resolve report:', error)
    return res.status(500).json({ message: '操作失败' })
  }
}

export const adminDeleteMessage = async (req, res) => {
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
}
