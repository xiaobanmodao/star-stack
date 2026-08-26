import { getDb } from '../db.js'
import { requireUser, requireAdmin } from '../middleware/auth.js'
import { addXp } from '../utils/userHelpers.js'
import { createNotification, notifyMentions } from '../utils/notifications.js'
import { bumpChatStat, touchChatActivity, countActiveDaysPublic, CHAT_ACHIEVEMENT_DEFS_PUBLIC } from '../utils/chatStats.js'
import { localDay, parseLocalDate } from '../utils/dateHelpers.js'
import { BoundedCache } from '../utils/boundedCache.js'
import { randomBytes } from 'node:crypto'
import { sseConnectionLimiter } from '../utils/connectionLimit.js'

const CHAT_VALID_MODULES = new Set(['general', 'oj', 'jieya', 'starcode'])
const chatRateLimits = new BoundedCache(5000, 1000)
const typingRateLimits = new BoundedCache(5000, 1000)
const reportRateLimits = new BoundedCache(5000, 10000)
export const PRESENCE_ONLINE_MS = 60 * 1000

export const chatStreams = new Map()
export const broadcastToScope = (scopeKey, payload) => {
  const listeners = chatStreams.get(scopeKey)
  if (!listeners) return
  const data = `data: ${JSON.stringify(payload)}\n\n`
  for (const res of listeners) {
    try { res.write(data) } catch { /* client disconnected */ }
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

const formatChatMessage = (m) => ({
  id: m.id, senderId: m.sender_id, senderName: m.sender_name, senderAvatar: m.sender_avatar,
  content: m.content, createdAt: m.created_at,
  reactions: m.reactions || [], threadParentId: m.thread_parent_id ?? null,
  threadReplyCount: m.thread_reply_count ?? 0,
})

const loadChatMessageRows = async (db, whereSql, params, limit, beforeId) => {
  const beforeClause = beforeId ? 'AND cm.id < ?' : ''
  const rows = await db.all(
    `SELECT cm.*, u.name as sender_name, u.avatar as sender_avatar,
            (SELECT COUNT(*) FROM chat_messages r WHERE r.thread_parent_id = cm.id) as thread_reply_count
     FROM chat_messages cm LEFT JOIN users u ON cm.sender_id = u.id
     WHERE ${whereSql} AND cm.thread_parent_id IS NULL ${beforeClause}
     ORDER BY cm.id DESC LIMIT ?`,
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
     FROM chat_reactions WHERE message_id IN (${ids.map(() => '?').join(',')})
     GROUP BY message_id, emoji`,
    myUserId, ...ids
  )
  const byMessage = new Map()
  for (const row of rows) {
    if (!byMessage.has(row.message_id)) byMessage.set(row.message_id, [])
    byMessage.get(row.message_id).push({ emoji: row.emoji, count: row.count, mine: row.mine > 0 })
  }
  return messages.map((m) => ({ ...m, reactions: byMessage.get(m.id) || [] }))
}

const getChatUnreadForUser = async (db, user) => {
  const channels = await db.all(
    `SELECT cc.key,
            (SELECT COUNT(*) FROM discussion_posts dp
             WHERE dp.module_key = cc.key AND dp.id > COALESCE(
               (SELECT last_read_message_id FROM chat_read_state
                WHERE user_id = ? AND scope_type = 'channel' AND scope_id = cc.key), 0)
               AND dp.user_id != ?) as unread
     FROM chat_channels cc`, user.id, user.id
  )
  const rooms = await db.all(
    `SELECT cr.id,
            (SELECT COUNT(*) FROM chat_messages cm
             WHERE cm.room_id = cr.id AND cm.id > COALESCE(
               (SELECT last_read_message_id FROM chat_read_state
                WHERE user_id = ? AND scope_type = 'room' AND scope_id = CAST(cr.id AS TEXT)), 0)
               AND cm.sender_id != ?) as unread
     FROM chat_rooms cr
     WHERE cr.type = 'public' OR EXISTS (SELECT 1 FROM chat_room_members m WHERE m.room_id = cr.id AND m.user_id = ?)`,
    user.id, user.id, user.id
  )
  return {
    channels: Object.fromEntries(channels.map((c) => [c.key, c.unread])),
    rooms: Object.fromEntries(rooms.map((r) => [r.id, r.unread])),
    total: channels.reduce((s, c) => s + c.unread, 0) + rooms.reduce((s, r) => s + r.unread, 0),
  }
}

const openChatStream = async (req, res, scopeKey) => {
  const auth = await requireUser(req, res)
  if (!auth) return null
  const { db, user } = auth
  if (scopeKey.startsWith('room:')) {
    const roomId = parseInt(scopeKey.slice(5), 10)
    const room = roomId ? await db.get(`SELECT * FROM chat_rooms WHERE id = ?`, roomId) : null
    if (!room) { if (!res.headersSent) res.status(404).json({ message: '房间不存在' }); return null }
    if (room.type === 'invite') {
      const member = await db.get(`SELECT 1 FROM chat_room_members WHERE room_id = ? AND user_id = ?`, roomId, user.id)
      if (!member) { if (!res.headersSent) res.status(403).json({ message: '需要加入后才能查看' }); return null }
    }
  }
  const releaseSse = sseConnectionLimiter.tryAcquire(user.id)
  if (!releaseSse) {
    res.setHeader('Retry-After', '10')
    if (!res.headersSent) res.status(429).json({ message: '实时连接数已达上限，请稍后重试' })
    return null
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
    closed = true; clearInterval(ping)
    releaseSse()
    const set = chatStreams.get(scopeKey)
    if (set) { set.delete(res); if (set.size === 0) chatStreams.delete(scopeKey) }
  })
  return { db, user }
}

const getRoomDetail = async (db, roomId) => {
  const room = await db.get(
    `SELECT cr.*, u.name as owner_name, (SELECT COUNT(*) FROM chat_room_members m WHERE m.room_id = cr.id) as member_count
     FROM chat_rooms cr LEFT JOIN users u ON cr.owner_id = u.id WHERE cr.id = ?`, roomId
  )
  if (!room) return null
  const members = await db.all(
    `SELECT m.user_id, m.role, m.joined_at, u.name as user_name, u.avatar as user_avatar,
            (SELECT last_seen_at FROM user_presence p WHERE p.user_id = m.user_id) as last_seen_at
     FROM chat_room_members m LEFT JOIN users u ON m.user_id = u.id
     WHERE m.room_id = ? ORDER BY (m.role = 'owner') DESC, m.joined_at ASC`, roomId
  )
  return {
    id: room.id, name: room.name, description: room.description, type: room.type,
    ownerId: room.owner_id, ownerName: room.owner_name, memberCount: room.member_count, createdAt: room.created_at,
    members: members.map((m) => ({
      userId: m.user_id, userName: m.user_name, userAvatar: m.user_avatar, role: m.role,
      online: Boolean(m.last_seen_at) && Date.now() - new Date(m.last_seen_at).getTime() <= PRESENCE_ONLINE_MS,
    })),
  }
}

const assertChatScopeAccess = async (db, user, scopeRow) => {
  if (!scopeRow?.room_id) return true
  const room = await db.get(`SELECT type FROM chat_rooms WHERE id = ?`, scopeRow.room_id)
  if (!room) return false
  if (room.type === 'public') return true
  const member = await db.get(`SELECT 1 FROM chat_room_members WHERE room_id = ? AND user_id = ?`, scopeRow.room_id, user.id)
  return Boolean(member)
}

const getChatMessageScope = async (db, messageId) =>
  db.get(`SELECT id, channel_key, room_id, sender_id, content FROM chat_messages WHERE id = ?`, messageId)

const getCheckinStatus = async (db, userId) => {
  const rows = await db.all(`SELECT checkin_date FROM daily_checkins WHERE user_id = ? ORDER BY checkin_date DESC`, userId)
  const today = localDay()
  const checkedToday = rows.some((row) => row.checkin_date === today)
  let currentStreak = 0, maxStreak = 0
  if (rows.length > 0) {
    const dates = rows.map((row) => parseLocalDate(row.checkin_date))
    const todayDate = parseLocalDate(today)
    let expected = todayDate, allowYesterdayGap = true, tempStreak = 0
    for (const date of dates) {
      const diffDays = Math.floor((expected - date) / (1000 * 60 * 60 * 24))
      if (diffDays === 0) { tempStreak++; allowYesterdayGap = false; expected = new Date(date); expected.setDate(expected.getDate() - 1) }
      else if (diffDays === 1 && allowYesterdayGap) { tempStreak++; expected = new Date(date); expected.setDate(expected.getDate() - 1); allowYesterdayGap = false }
      else break
    }
    currentStreak = tempStreak
    let tempMax = 1
    for (let i = 0; i < dates.length - 1; i++) {
      const diffDays = Math.floor((dates[i] - dates[i + 1]) / (1000 * 60 * 60 * 24))
      if (diffDays === 1) { tempMax++; maxStreak = Math.max(maxStreak, tempMax) } else { tempMax = 1 }
    }
    maxStreak = Math.max(maxStreak, tempMax, currentStreak)
  }
  return { checkedToday, currentStreak, maxStreak, totalDays: rows.length }
}

// ─── Channel handlers ───────────────────────────────────────────────────────

export const listChannels = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const channels = await db.all(
      `SELECT cc.key, cc.name, cc.icon, cc.description, cc.sort_order FROM chat_channels cc ORDER BY cc.sort_order ASC`
    )
    const unread = await getChatUnreadForUser(db, user)
    return res.json({
      channels: channels.map((c) => ({
        key: c.key, name: c.name, icon: c.icon, description: c.description, sortOrder: c.sort_order,
        unread: unread.channels[c.key] || 0,
      })),
    })
  } catch (error) {
    console.error('Failed to list channels:', error)
    return res.status(500).json({ message: '获取频道失败' })
  }
}

// ─── Room handlers ───────────────────────────────────────────────────────────

export const listRooms = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 50))
    const offset = (page - 1) * pageSize
    const visibilitySql = `cr.type = 'public' OR EXISTS (
      SELECT 1 FROM chat_room_members m WHERE m.room_id = cr.id AND m.user_id = ?
    )`
    const totalResult = await db.get(
      `SELECT COUNT(*) AS count FROM chat_rooms cr WHERE ${visibilitySql}`,
      user.id,
    )
    const rooms = await db.all(
      `SELECT cr.*, u.name as owner_name, (SELECT COUNT(*) FROM chat_room_members m WHERE m.room_id = cr.id) as member_count
       FROM chat_rooms cr LEFT JOIN users u ON cr.owner_id = u.id
       WHERE ${visibilitySql}
       ORDER BY cr.created_at DESC
       LIMIT ? OFFSET ?`, user.id, pageSize, offset,
    )
    const unread = await getChatUnreadForUser(db, user)
    const members = await db.all(`SELECT room_id, user_id FROM chat_room_members WHERE user_id = ?`, user.id)
    const joinedIds = new Set(members.map((m) => m.room_id))
    const roomUnreadCount = Object.values(unread.rooms).reduce((sum, count) => sum + Number(count || 0), 0)
    return res.json({
      rooms: rooms.map((r) => ({
        id: r.id, name: r.name, description: r.description, type: r.type,
        ownerId: r.owner_id, ownerName: r.owner_name, memberCount: r.member_count,
        createdAt: r.created_at, joined: joinedIds.has(r.id), unread: unread.rooms[r.id] || 0,
      })),
      unreadCount: roomUnreadCount,
      pagination: {
        page,
        pageSize,
        total: totalResult?.count || 0,
        totalPages: Math.ceil((totalResult?.count || 0) / pageSize),
      },
    })
  } catch (error) {
    console.error('Failed to list rooms:', error)
    return res.status(500).json({ message: '获取聊天室失败' })
  }
}

export const createRoom = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const { name, description, type } = req.body || {}
    const roomName = String(name ?? '').trim()
    if (!roomName) return res.status(400).json({ message: '房间名不能为空' })
    if (roomName.length > 60) return res.status(400).json({ message: '房间名不能超过60字符' })
    if (description && String(description).length > 300) return res.status(400).json({ message: '简介不能超过300字符' })
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
}

export const getRoom = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const roomId = parseInt(req.params.id)
    if (!roomId) return res.status(400).json({ message: '无效的房间ID' })
    const room = await db.get(`SELECT * FROM chat_rooms WHERE id = ?`, roomId)
    if (!room) return res.status(404).json({ message: '房间不存在' })
    if (room.type === 'invite') {
      const member = await db.get(`SELECT role FROM chat_room_members WHERE room_id = ? AND user_id = ?`, roomId, user.id)
      if (!member) return res.status(403).json({ message: '这是邀请制房间，需要房主邀请才能加入' })
    }
    const detail = await getRoomDetail(db, roomId)
    const myMembership = detail.members.find((m) => m.userId === user.id)
    return res.json({ room: { ...detail, myRole: myMembership?.role || null } })
  } catch (error) {
    console.error('Failed to get room:', error)
    return res.status(500).json({ message: '获取房间失败' })
  }
}

export const joinRoom = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const roomId = parseInt(req.params.id)
    if (!roomId) return res.status(400).json({ message: '无效的房间ID' })
    const room = await db.get(`SELECT * FROM chat_rooms WHERE id = ?`, roomId)
    if (!room) return res.status(404).json({ message: '房间不存在' })
    if (room.type === 'invite') {
      const member = await db.get(`SELECT 1 FROM chat_room_members WHERE room_id = ? AND user_id = ?`, roomId, user.id)
      if (!member) return res.status(403).json({ message: '这是邀请制房间，需要房主邀请才能加入' })
      return res.json({ message: '已加入', joined: true })
    }
    await db.run(`INSERT OR IGNORE INTO chat_room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)`, roomId, user.id, new Date().toISOString())
    const detail = await getRoomDetail(db, roomId)
    broadcastToScope(`room:${roomId}`, { type: 'members', members: detail.members })
    return res.json({ message: '已加入房间', joined: true })
  } catch (error) {
    console.error('Failed to join room:', error)
    return res.status(500).json({ message: '加入失败' })
  }
}

export const leaveRoom = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const roomId = parseInt(req.params.id)
    if (!roomId) return res.status(400).json({ message: '无效的房间ID' })
    const membership = await db.get(`SELECT role FROM chat_room_members WHERE room_id = ? AND user_id = ?`, roomId, user.id)
    if (!membership) return res.json({ message: '你不在这个房间里' })
    if (membership.role === 'owner') return res.status(400).json({ message: '房主不能离开，可以解散房间' })
    await db.run(`DELETE FROM chat_room_members WHERE room_id = ? AND user_id = ?`, roomId, user.id)
    const detail = await getRoomDetail(db, roomId)
    broadcastToScope(`room:${roomId}`, { type: 'members', members: detail.members })
    return res.json({ message: '已离开房间' })
  } catch (error) {
    console.error('Failed to leave room:', error)
    return res.status(500).json({ message: '操作失败' })
  }
}

export const deleteRoom = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const roomId = parseInt(req.params.id)
    if (!roomId) return res.status(400).json({ message: '无效的房间ID' })
    const room = await db.get(`SELECT * FROM chat_rooms WHERE id = ?`, roomId)
    if (!room) return res.status(404).json({ message: '房间不存在' })
    if (room.owner_id !== user.id && !user.is_admin) return res.status(403).json({ message: '只有房主可以解散房间' })
    await db.run(`DELETE FROM chat_rooms WHERE id = ?`, roomId)
    await db.run(`DELETE FROM notifications WHERE target_type = 'room' AND target_id = ?`, roomId)
    broadcastToScope(`room:${roomId}`, { type: 'closed' })
    return res.json({ message: '房间已解散' })
  } catch (error) {
    console.error('Failed to delete room:', error)
    return res.status(500).json({ message: '操作失败' })
  }
}

export const inviteMember = async (req, res) => {
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
    const membership = await db.get(`SELECT role FROM chat_room_members WHERE room_id = ? AND user_id = ?`, roomId, user.id)
    if (!membership || membership.role !== 'owner') return res.status(403).json({ message: '只有房主可以邀请成员' })
    const target = await db.get(`SELECT id FROM users WHERE id = ?`, userId)
    if (!target) return res.status(404).json({ message: '用户不存在' })
    const inviteResult = await db.run(
      `INSERT OR IGNORE INTO chat_room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)`,
      roomId, userId, new Date().toISOString()
    )
    if (inviteResult.changes > 0) {
      await createNotification(db, {
        userId, actorId: user.id, type: 'invite', targetType: 'room', targetId: roomId,
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
}

export const removeMember = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const roomId = parseInt(req.params.id)
    const targetId = req.params.userId
    if (!roomId) return res.status(400).json({ message: '无效的房间ID' })
    const room = await db.get(`SELECT * FROM chat_rooms WHERE id = ?`, roomId)
    if (!room) return res.status(404).json({ message: '房间不存在' })
    const membership = await db.get(`SELECT role FROM chat_room_members WHERE room_id = ? AND user_id = ?`, roomId, user.id)
    if (!membership || membership.role !== 'owner') return res.status(403).json({ message: '只有房主可以移除成员' })
    if (targetId === room.owner_id) return res.status(400).json({ message: '不能移除房主' })
    await db.run(`DELETE FROM chat_room_members WHERE room_id = ? AND user_id = ?`, roomId, targetId)
    const detail = await getRoomDetail(db, roomId)
    broadcastToScope(`room:${roomId}`, { type: 'members', members: detail.members })
    return res.json({ message: '已移除成员', members: detail.members })
  } catch (error) {
    console.error('Failed to remove member:', error)
    return res.status(500).json({ message: '操作失败' })
  }
}

// ─── Room message handlers ───────────────────────────────────────────────────

export const listRoomMessages = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const roomId = parseInt(req.params.id)
    if (!roomId) return res.status(400).json({ message: '无效的房间ID' })
    const room = await db.get(`SELECT * FROM chat_rooms WHERE id = ?`, roomId)
    if (!room) return res.status(404).json({ message: '房间不存在' })
    if (room.type === 'invite') {
      const member = await db.get(`SELECT 1 FROM chat_room_members WHERE room_id = ? AND user_id = ?`, roomId, user.id)
      if (!member) return res.status(403).json({ message: '需要加入后才能查看' })
    }
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50))
    const beforeId = req.query.before ? parseInt(req.query.before) : null
    const rows = await loadChatMessageRows(db, 'cm.room_id = ?', [roomId], limit + 1, beforeId)
    const hasMore = rows.length > limit
    const messages = await attachReactions(db, rows.slice(0, limit), user.id)
    return res.json({ messages: messages.map(formatChatMessage), hasMore })
  } catch (error) {
    console.error('Failed to load room messages:', error)
    return res.status(500).json({ message: '获取消息失败' })
  }
}

export const sendRoomMessage = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const roomId = parseInt(req.params.id)
    if (!roomId) return res.status(400).json({ message: '无效的房间ID' })
    const room = await db.get(`SELECT * FROM chat_rooms WHERE id = ?`, roomId)
    if (!room) return res.status(404).json({ message: '房间不存在' })
    if (room.type === 'invite') {
      const member = await db.get(`SELECT 1 FROM chat_room_members WHERE room_id = ? AND user_id = ?`, roomId, user.id)
      if (!member) return res.status(403).json({ message: '需要加入后才能发言' })
    }
    const text = String(req.body?.content ?? '').trim()
    if (!text) return res.status(400).json({ message: '消息不能为空' })
    if (text.length > 8000) return res.status(400).json({ message: '消息不能超过8000字符' })
    if (chatRateLimits.has(user.id)) return res.status(429).json({ message: '发送过快，请稍后再试' })
    chatRateLimits.set(user.id, Date.now())
    const result = await db.run(
      `INSERT INTO chat_messages (channel_key, room_id, sender_id, content, created_at) VALUES (NULL, ?, ?, ?, ?)`,
      roomId, user.id, text, new Date().toISOString()
    )
    await touchPresence(db, user.id)
    const rows = await db.all(
      `SELECT cm.*, u.name as sender_name, u.avatar as sender_avatar FROM chat_messages cm LEFT JOIN users u ON cm.sender_id = u.id WHERE cm.id = ?`,
      result.lastID
    )
    await bumpChatStat(db, user.id, { field: 'message_count', points: 1 })
    await addXp(db, user.id, 2)
    const message = formatChatMessage(rows[0])
    await notifyMentions(db, text, user.id, 'mention', 'room', roomId, (id) => `在聊天室《${room.name}》中提到了你（@${id}）`)
    broadcastToScope(`room:${roomId}`, { type: 'message', message })
    return res.json({ message })
  } catch (error) {
    console.error('Failed to send room message:', error)
    return res.status(500).json({ message: '发送失败' })
  }
}

// 返回 Promise，让 Express 5 可以统一捕获 SSE 建立阶段的异步错误。
export const roomStream = (req, res) => openChatStream(req, res, `room:${req.params.id}`)

// ─── Typing / reactions / threads ────────────────────────────────────────────

export const typingIndicator = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const { scopeType, scopeId } = req.body || {}
    const normalizedScopeId = String(scopeId ?? '').trim()
    if ((scopeType !== 'channel' && scopeType !== 'room') || !normalizedScopeId || normalizedScopeId.length > 64) {
      return res.status(400).json({ message: '无效的范围' })
    }
    let scopeKey
    if (scopeType === 'channel') {
      if (!CHAT_VALID_MODULES.has(normalizedScopeId)) return res.status(400).json({ message: '无效的频道' })
      scopeKey = `channel:${normalizedScopeId}`
    } else {
      const roomId = Number(normalizedScopeId)
      if (!Number.isInteger(roomId) || roomId <= 0) return res.status(400).json({ message: '无效的房间' })
      const room = await db.get(`SELECT id, type FROM chat_rooms WHERE id = ?`, roomId)
      if (!room) return res.status(404).json({ message: '房间不存在' })
      if (room.type === 'invite') {
        const member = await db.get(
          `SELECT 1 FROM chat_room_members WHERE room_id = ? AND user_id = ?`,
          roomId, user.id,
        )
        if (!member) return res.status(403).json({ message: '需要加入后才能操作' })
      }
      scopeKey = `room:${roomId}`
    }
    if (typingRateLimits.has(user.id)) return res.status(429).json({ message: '操作过快，请稍后再试' })
    typingRateLimits.set(user.id, Date.now())
    await touchPresence(db, user.id)
    broadcastToScope(scopeKey, { type: 'typing', userId: user.id, userName: user.name })
    return res.json({ success: true })
  } catch (error) {
    console.error('Failed to broadcast typing:', error)
    return res.status(500).json({ message: '操作失败' })
  }
}

export const toggleReaction = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const messageId = parseInt(req.params.id)
    if (!messageId) return res.status(400).json({ message: '无效的消息ID' })
    const cleanEmoji = String(req.body?.emoji ?? '').trim()
    if (!cleanEmoji || cleanEmoji.length > 16) return res.status(400).json({ message: '无效的表情' })
    const message = await db.get(`SELECT * FROM chat_messages WHERE id = ?`, messageId)
    if (!message) return res.status(404).json({ message: '消息不存在' })
    if (!(await assertChatScopeAccess(db, user, message))) return res.status(403).json({ message: '需要加入后才能操作' })
    const existing = await db.get(`SELECT id FROM chat_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?`, messageId, user.id, cleanEmoji)
    if (existing) {
      await db.run(`DELETE FROM chat_reactions WHERE id = ?`, existing.id)
    } else {
      await db.run(`INSERT INTO chat_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)`, messageId, user.id, cleanEmoji, new Date().toISOString())
      if (message.sender_id !== user.id) await bumpChatStat(db, message.sender_id, { field: 'reaction_received', points: 2 })
    }
    const reactionRows = await db.all(
      `SELECT emoji, COUNT(*) as count, SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) as mine FROM chat_reactions WHERE message_id = ? GROUP BY emoji`,
      user.id, messageId
    )
    const reactions = reactionRows.map((r) => ({ emoji: r.emoji, count: r.count, mine: r.mine > 0 }))
    const scopeKey = message.channel_key ? `channel:${message.channel_key}` : `room:${message.room_id}`
    broadcastToScope(scopeKey, { type: 'reaction', messageId, reactions })
    return res.json({ reactions })
  } catch (error) {
    console.error('Failed to toggle reaction:', error)
    return res.status(500).json({ message: '操作失败' })
  }
}

export const getThreadReplies = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const messageId = parseInt(req.params.id)
    if (!messageId) return res.status(400).json({ message: '无效的消息ID' })
    const parent = await getChatMessageScope(db, messageId)
    if (!parent) return res.status(404).json({ message: '消息不存在' })
    if (!(await assertChatScopeAccess(db, user, parent))) return res.status(403).json({ message: '需要加入后才能查看' })
    const rows = await db.all(
      `SELECT cm.*, u.name as sender_name, u.avatar as sender_avatar,
              (SELECT COUNT(*) FROM chat_messages r WHERE r.thread_parent_id = cm.id) as thread_reply_count
       FROM chat_messages cm LEFT JOIN users u ON cm.sender_id = u.id WHERE cm.thread_parent_id = ? ORDER BY cm.id ASC LIMIT 200`,
      messageId
    )
    const replies = await attachReactions(db, rows, user.id)
    return res.json({ replies: replies.map(formatChatMessage) })
  } catch (error) {
    console.error('Failed to load thread replies:', error)
    return res.status(500).json({ message: '获取回复失败' })
  }
}

export const addThreadReply = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const messageId = parseInt(req.params.id)
    if (!messageId) return res.status(400).json({ message: '无效的消息ID' })
    const parent = await getChatMessageScope(db, messageId)
    if (!parent) return res.status(404).json({ message: '消息不存在' })
    if (!(await assertChatScopeAccess(db, user, parent))) return res.status(403).json({ message: '需要加入后才能发言' })
    const text = String(req.body?.content ?? '').trim()
    if (!text) return res.status(400).json({ message: '回复不能为空' })
    if (text.length > 8000) return res.status(400).json({ message: '回复不能超过8000字符' })
    if (chatRateLimits.has(user.id)) return res.status(429).json({ message: '发送过快，请稍后再试' })
    chatRateLimits.set(user.id, Date.now())
    const result = await db.run(
      `INSERT INTO chat_messages (channel_key, room_id, sender_id, content, created_at, thread_parent_id) VALUES (?, ?, ?, ?, ?, ?)`,
      parent.channel_key, parent.room_id, user.id, text, new Date().toISOString(), messageId
    )
    await bumpChatStat(db, user.id, { field: 'reply_count', points: 2 })
    await addXp(db, user.id, 2)
    await touchPresence(db, user.id)
    await notifyMentions(db, text, user.id, 'mention', parent.channel_key ? 'channel' : 'room', parent.channel_key || parent.room_id, (id) => `在一条消息的回复中提到了你（@${id}）`)
    const rows = await db.all(`SELECT cm.*, u.name as sender_name, u.avatar as sender_avatar, 0 as thread_reply_count FROM chat_messages cm LEFT JOIN users u ON cm.sender_id = u.id WHERE cm.id = ?`, result.lastID)
    const reply = formatChatMessage(rows[0])
    broadcastToScope(parent.channel_key ? `channel:${parent.channel_key}` : `room:${parent.room_id}`, { type: 'thread_reply', message: reply })
    return res.json({ reply })
  } catch (error) {
    console.error('Failed to reply in thread:', error)
    return res.status(500).json({ message: '回复失败' })
  }
}

// ─── Invite links ─────────────────────────────────────────────────────────────

export const createInviteLink = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const roomId = parseInt(req.params.id)
    const room = await db.get(`SELECT * FROM chat_rooms WHERE id = ?`, roomId)
    if (!room) return res.status(404).json({ message: '房间不存在' })
    if (room.owner_id !== user.id && !user.is_admin) return res.status(403).json({ message: '只有房主可以生成邀请链接' })
    const { expiresInHours, maxUses } = req.body || {}
    const maxUsesClean = Math.min(100, Math.max(1, parseInt(maxUses) || 1))
    const expiresHours = Math.min(720, Math.max(1, parseInt(expiresInHours) || 24))
    const expiresAt = new Date(Date.now() + expiresHours * 3600 * 1000).toISOString()
    const token = randomBytes(16).toString('hex')
    await db.run(
      `INSERT INTO room_invite_links (room_id, token, created_by, expires_at, max_uses, use_count, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)`,
      roomId, token, user.id, expiresAt, maxUsesClean, new Date().toISOString()
    )
    return res.json({ message: '邀请链接已生成', token, expiresAt, maxUses: maxUsesClean })
  } catch (error) {
    console.error('Failed to create invite link:', error)
    return res.status(500).json({ message: '生成失败' })
  }
}

export const getInviteLink = async (req, res) => {
  try {
    if (!/^[a-f0-9]{32}$/.test(req.params.token || '')) {
      return res.status(404).json({ message: '邀请链接无效或已被使用' })
    }
    const db = await getDb()
    const link = await db.get(
      `SELECT l.*, cr.name as room_name, cr.type as room_type, u.name as owner_name
       FROM room_invite_links l JOIN chat_rooms cr ON cr.id = l.room_id LEFT JOIN users u ON u.id = cr.owner_id
       WHERE l.token = ?`, req.params.token
    )
    if (!link) return res.status(404).json({ message: '邀请链接无效或已被使用' })
    if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) return res.status(410).json({ message: '邀请链接已过期' })
    if (link.use_count >= link.max_uses) return res.status(410).json({ message: '邀请链接已达使用上限' })
    return res.json({ room: { id: link.room_id, name: link.room_name, type: link.room_type, ownerName: link.owner_name } })
  } catch (error) {
    console.error('Failed to get invite link:', error)
    return res.status(500).json({ message: '获取失败' })
  }
}

export const joinViaInviteLink = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    if (!/^[a-f0-9]{32}$/.test(req.params.token || '')) {
      return res.status(404).json({ message: '邀请链接无效或已被使用' })
    }
    const link = await db.get(`SELECT * FROM room_invite_links WHERE token = ?`, req.params.token)
    if (!link) return res.status(404).json({ message: '邀请链接无效或已被使用' })
    if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) return res.status(410).json({ message: '邀请链接已过期' })
    if (link.use_count >= link.max_uses) return res.status(410).json({ message: '邀请链接已达使用上限' })
    await db.run(`INSERT OR IGNORE INTO chat_room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)`, link.room_id, user.id, new Date().toISOString())
    await db.run(`UPDATE room_invite_links SET use_count = use_count + 1 WHERE id = ?`, link.id)
    const room = await db.get(`SELECT name FROM chat_rooms WHERE id = ?`, link.room_id)
    return res.json({ message: `已加入《${room?.name}》`, roomId: link.room_id })
  } catch (error) {
    console.error('Failed to join via invite link:', error)
    return res.status(500).json({ message: '加入失败' })
  }
}

// ─── Bookmarks ────────────────────────────────────────────────────────────────

export const toggleBookmark = async (req, res) => {
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
    const existing = await db.get(`SELECT id FROM bookmarks WHERE user_id = ? AND target_type = ? AND target_id = ?`, user.id, type, id)
    if (existing) {
      await db.run(`DELETE FROM bookmarks WHERE id = ?`, existing.id)
      return res.json({ bookmarked: false })
    }
    await db.run(`INSERT INTO bookmarks (user_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?)`, user.id, type, id, new Date().toISOString())
    return res.json({ bookmarked: true })
  } catch (error) {
    console.error('Failed to toggle bookmark:', error)
    return res.status(500).json({ message: '操作失败' })
  }
}

export const listBookmarks = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const targetType = req.query.targetType === 'problem' ? 'problem' : 'post'
    const ids = await db.all(`SELECT target_id FROM bookmarks WHERE user_id = ? AND target_type = ? ORDER BY created_at DESC`, user.id, targetType)
    if (targetType === 'post') {
      if (ids.length === 0) return res.json({ posts: [] })
      const posts = await db.all(
        `SELECT dp.id, dp.title, dp.user_id, dp.comment_count, dp.like_count, dp.created_at, u.name as user_name
         FROM discussion_posts dp LEFT JOIN users u ON dp.user_id = u.id
         WHERE dp.id IN (${ids.map(() => '?').join(',')}) ORDER BY dp.created_at DESC`,
        ...ids.map((row) => row.target_id)
      )
      return res.json({ posts: posts.map((p) => ({ id: p.id, title: p.title, userId: p.user_id, userName: p.user_name, commentCount: p.comment_count, likeCount: p.like_count, createdAt: p.created_at })) })
    }
    if (ids.length === 0) return res.json({ problems: [] })
    const problems = await db.all(
      `SELECT p.id, p.title, p.difficulty, p.slug, b.created_at
       FROM bookmarks b JOIN problems p ON p.id = b.target_id
       WHERE b.user_id = ? AND b.target_type = 'problem'
       ORDER BY b.created_at DESC`,
      user.id,
    )
    return res.json({ problems: problems.map((problem) => ({
      id: problem.id, title: problem.title, difficulty: problem.difficulty,
      slug: problem.slug, createdAt: problem.created_at,
    })) })
  } catch (error) {
    console.error('Failed to list bookmarks:', error)
    return res.status(500).json({ message: '获取收藏失败' })
  }
}

export const getBookmarkStatus = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const targetType = req.query.targetType === 'problem' ? 'problem' : 'post'
    const targetId = parseInt(req.query.targetId)
    if (!targetId) return res.status(400).json({ message: '无效的目标' })
    const row = await db.get(`SELECT 1 FROM bookmarks WHERE user_id = ? AND target_type = ? AND target_id = ?`, user.id, targetType, targetId)
    return res.json({ bookmarked: Boolean(row) })
  } catch (error) {
    console.error('Failed to get bookmark status:', error)
    return res.status(500).json({ message: '查询失败' })
  }
}

// ─── Read state / presence / search / unread ─────────────────────────────────

export const markChatRead = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const { scopeType, scopeId } = req.body || {}
    if (scopeType !== 'channel' && scopeType !== 'room') return res.status(400).json({ message: '无效的范围' })
    if (!scopeId) return res.status(400).json({ message: '缺少范围ID' })
    let maxId = 0
    if (scopeType === 'channel') {
      if (!CHAT_VALID_MODULES.has(scopeId)) return res.status(400).json({ message: '无效的频道' })
      const maxRow = await db.get(`SELECT MAX(id) as max_id FROM discussion_posts WHERE module_key = ?`, scopeId)
      maxId = maxRow?.max_id || 0
    } else {
      const maxRow = await db.get(`SELECT MAX(id) as max_id FROM chat_messages WHERE room_id = ?`, parseInt(scopeId))
      maxId = maxRow?.max_id || 0
    }
    await db.run(
      `INSERT INTO chat_read_state (user_id, scope_type, scope_id, last_read_message_id) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, scope_type, scope_id) DO UPDATE SET last_read_message_id = MAX(last_read_message_id, excluded.last_read_message_id)`,
      user.id, scopeType, String(scopeId), maxId
    )
    return res.json({ success: true })
  } catch (error) {
    console.error('Failed to mark read:', error)
    return res.status(500).json({ message: '操作失败' })
  }
}

export const updatePresence = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  await touchPresence(db, user.id)
  await touchChatActivity(db, user.id)
  return res.json({ success: true })
}

export const getPresence = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db } = auth
  try {
    const ids = String(req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200)
    if (ids.length === 0) return res.json({ online: {} })
    const rows = await db.all(`SELECT user_id, last_seen_at FROM user_presence WHERE user_id IN (${ids.map(() => '?').join(',')})`, ...ids)
    const online = {}
    for (const row of rows) online[row.user_id] = Date.now() - new Date(row.last_seen_at).getTime() <= PRESENCE_ONLINE_MS
    return res.json({ online })
  } catch (error) {
    console.error('Failed to get presence:', error)
    return res.status(500).json({ message: '获取在线状态失败' })
  }
}

export const searchChat = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const q = (req.query.q || '').trim()
    if (!q) return res.json({ messages: [] })
    const limit = Math.min(30, Math.max(1, parseInt(req.query.limit) || 20))
    const rows = await db.all(
      `SELECT cm.id, cm.channel_key, cm.room_id, cm.sender_id, cm.content, cm.created_at,
              u.name as sender_name, u.avatar as sender_avatar, cr.name as room_name
       FROM chat_messages cm LEFT JOIN users u ON cm.sender_id = u.id LEFT JOIN chat_rooms cr ON cm.room_id = cr.id
       WHERE cm.content LIKE ?
         AND (cm.channel_key IS NOT NULL OR cm.room_id IN (SELECT id FROM chat_rooms WHERE type = 'public' UNION SELECT room_id FROM chat_room_members WHERE user_id = ?))
         AND cm.thread_parent_id IS NULL ORDER BY cm.id DESC LIMIT ?`,
      `%${q}%`, user.id, limit
    )
    return res.json({ messages: rows.map((m) => ({ id: m.id, channelKey: m.channel_key, roomId: m.room_id, roomName: m.room_name, senderId: m.sender_id, senderName: m.sender_name, senderAvatar: m.sender_avatar, content: m.content, createdAt: m.created_at })) })
  } catch (error) {
    console.error('Failed to search chat messages:', error)
    return res.status(500).json({ message: '搜索失败' })
  }
}

export const getChatUnread = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    return res.json(await getChatUnreadForUser(db, user))
  } catch (error) {
    console.error('Failed to get chat unread:', error)
    return res.status(500).json({ message: '获取未读失败' })
  }
}

// ─── Daily checkin ────────────────────────────────────────────────────────────

export const getMyCheckin = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    return res.json(await getCheckinStatus(db, user.id))
  } catch (error) {
    console.error('Failed to get checkin status:', error)
    return res.status(500).json({ message: '获取签到状态失败' })
  }
}

export const doCheckin = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const today = localDay()
    const existing = await db.get(`SELECT 1 FROM daily_checkins WHERE user_id = ? AND checkin_date = ?`, user.id, today)
    const alreadyChecked = !!existing
    await db.run(`INSERT OR IGNORE INTO daily_checkins (user_id, checkin_date, created_at) VALUES (?, ?, ?)`, user.id, today, new Date().toISOString())
    if (!alreadyChecked) await addXp(db, user.id, 10)
    const status = await getCheckinStatus(db, user.id)
    return res.json({ success: true, alreadyChecked, ...status })
  } catch (error) {
    console.error('Failed to check in:', error)
    return res.status(500).json({ message: '签到失败' })
  }
}

// ─── Chat stats / achievements ────────────────────────────────────────────────

export const getMyChatStats = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const statRow = await db.get(`SELECT * FROM chat_stats WHERE user_id = ?`, user.id)
    const achievements = await db.all(`SELECT type, unlocked_at FROM chat_achievements WHERE user_id = ? ORDER BY unlocked_at ASC`, user.id)
    const activeDays = await countActiveDaysPublic(db, user.id)
    return res.json({
      stats: {
        messageCount: statRow?.message_count || 0, replyCount: statRow?.reply_count || 0,
        postCount: statRow?.post_count || 0, commentCount: statRow?.comment_count || 0,
        reactionReceived: statRow?.reaction_received || 0, activityScore: statRow?.activity_score || 0, activeDays,
      },
      achievements: achievements.map((a) => ({
        type: a.type,
        ...(CHAT_ACHIEVEMENT_DEFS_PUBLIC.find((d) => d.type === a.type) || { name: a.type, icon: '🏅', desc: '' }),
        unlockedAt: a.unlocked_at,
      })),
    })
  } catch (error) {
    console.error('Failed to get chat stats:', error)
    return res.status(500).json({ message: '获取统计失败' })
  }
}

export const getUserChatAchievements = async (req, res) => {
  try {
    const db = await getDb()
    const rows = await db.all(`SELECT type, unlocked_at FROM chat_achievements WHERE user_id = ? ORDER BY unlocked_at ASC`, req.params.userId)
    return res.json({
      achievements: rows.map((a) => ({
        type: a.type,
        ...(CHAT_ACHIEVEMENT_DEFS_PUBLIC.find((d) => d.type === a.type) || { name: a.type, icon: '🏅', desc: '' }),
        unlockedAt: a.unlocked_at,
      })),
    })
  } catch (error) {
    console.error('Failed to get chat achievements:', error)
    return res.status(500).json({ message: '获取成就失败' })
  }
}

export const getActivityLeaderboard = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const days = Math.min(30, Math.max(1, parseInt(req.query.days) || 7))
    const since = localDay(new Date(Date.now() - (days - 1) * 86400000))
    const rows = await db.all(
      `SELECT l.user_id, u.name as user_name, u.avatar as user_avatar, SUM(l.score) as score
       FROM chat_activity_log l LEFT JOIN users u ON u.id = l.user_id
       WHERE l.day >= ? AND l.score > 0 GROUP BY l.user_id ORDER BY score DESC LIMIT 20`, since
    )
    const myRow = await db.get(`SELECT user_id, SUM(score) as score FROM chat_activity_log WHERE day >= ? AND user_id = ? GROUP BY user_id`, since, user.id)
    const myScore = myRow?.score || 0
    let myRank = null
    if (myScore > 0) {
      const rankRow = await db.get(`SELECT COUNT(*) + 1 as rank FROM (SELECT user_id FROM chat_activity_log WHERE day >= ? AND score > 0 GROUP BY user_id HAVING SUM(score) > ?)`, since, myScore)
      myRank = rankRow?.rank || null
    }
    return res.json({
      days,
      leaderboard: rows.map((r, index) => ({ rank: index + 1, userId: r.user_id, userName: r.user_name, userAvatar: r.user_avatar, score: r.score })),
      me: { userId: user.id, score: myScore, rank: myRank },
    })
  } catch (error) {
    console.error('Failed to get activity leaderboard:', error)
    return res.status(500).json({ message: '获取活跃榜失败' })
  }
}

// ─── Reports ──────────────────────────────────────────────────────────────────

export const createReport = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    if (reportRateLimits.has(user.id)) return res.status(429).json({ message: '举报过于频繁，请稍后再试' })
    const { targetType, targetId, reason } = req.body || {}
    const type = ['post', 'comment', 'message', 'user'].includes(targetType) ? targetType : null
    if (!type || !targetId) return res.status(400).json({ message: '无效的举报目标' })
    const id = type === 'user' ? String(targetId) : parseInt(targetId)
    if (type !== 'user' && !id) return res.status(400).json({ message: '无效的举报目标' })
    const cleanReason = String(reason ?? '').trim().slice(0, 200) || '未填写原因'
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
    await db.run(`INSERT INTO reports (reporter_id, target_type, target_id, reason, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)`, user.id, type, id, cleanReason, new Date().toISOString())
    return res.json({ message: '举报已提交，管理员会尽快处理' })
  } catch (error) {
    console.error('Failed to create report:', error)
    return res.status(500).json({ message: '举报失败' })
  }
}
