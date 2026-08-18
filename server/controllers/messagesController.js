import { getDb } from '../db.js'
import { requireUser } from '../middleware/auth.js'
import { sanitizeHtml } from '../utils/htmlFilter.js'
import { BoundedCache } from '../utils/boundedCache.js'

const messageRateLimits = new BoundedCache(5000, 3000)

const getOrCreateConversation = async (db, userId1, userId2) => {
  const [user1, user2] = userId1 < userId2 ? [userId1, userId2] : [userId2, userId1]
  const now = new Date().toISOString()
  await db.run(
    `INSERT OR IGNORE INTO conversations (user1_id, user2_id, last_message_at, created_at) VALUES (?, ?, ?, ?)`,
    user1, user2, now, now
  )
  return db.get(`SELECT * FROM conversations WHERE user1_id = ? AND user2_id = ?`, user1, user2)
}

export const searchUsers = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const q = (req.query.q || '').trim()
    if (!q || q.length < 1) return res.json({ users: [] })
    const users = await db.all(
      `SELECT id, name, avatar FROM users WHERE (id LIKE ? OR name LIKE ?) AND id != ? AND is_banned = 0 LIMIT 10`,
      `%${q}%`, `%${q}%`, user.id
    )
    return res.json({ users })
  } catch (error) {
    console.error('Failed to search users:', error)
    return res.status(500).json({ message: '搜索用户失败' })
  }
}

export const listConversations = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const conversations = await db.all(
      `SELECT
        c.id,
        c.last_message_at,
        CASE WHEN c.user1_id = ? THEN c.user2_id ELSE c.user1_id END as other_user_id,
        u.name as other_user_name,
        u.avatar as other_user_avatar,
        lm.id as last_msg_id,
        lm.sender_id as last_msg_sender_id,
        lm.content as last_msg_content,
        lm.created_at as last_msg_created_at,
        COALESCE(unread.count, 0) as unread_count
       FROM conversations c
       JOIN users u ON u.id = CASE WHEN c.user1_id = ? THEN c.user2_id ELSE c.user1_id END
       LEFT JOIN (
         SELECT m1.conversation_id, m1.id, m1.sender_id, m1.content, m1.created_at
         FROM messages m1
         LEFT JOIN message_deletions md1 ON m1.id = md1.message_id AND md1.user_id = ?
         WHERE md1.id IS NULL
           AND m1.created_at = (
             SELECT MAX(m2.created_at) FROM messages m2
             LEFT JOIN message_deletions md2 ON m2.id = md2.message_id AND md2.user_id = ?
             WHERE m2.conversation_id = m1.conversation_id AND md2.id IS NULL
           )
       ) lm ON lm.conversation_id = c.id
       LEFT JOIN (
         SELECT m.conversation_id, COUNT(*) as count
         FROM messages m
         LEFT JOIN message_deletions md ON m.id = md.message_id AND md.user_id = ?
         WHERE m.sender_id != ? AND m.is_read = 0 AND md.id IS NULL
         GROUP BY m.conversation_id
       ) unread ON unread.conversation_id = c.id
       WHERE c.user1_id = ? OR c.user2_id = ?
       ORDER BY c.last_message_at DESC`,
      user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id
    )

    return res.json({
      conversations: conversations.map(conv => ({
        conversationId: conv.id,
        otherUser: { id: conv.other_user_id, name: conv.other_user_name, avatar: conv.other_user_avatar },
        lastMessage: conv.last_msg_id ? {
          id: conv.last_msg_id, senderId: conv.last_msg_sender_id,
          content: conv.last_msg_content, createdAt: conv.last_msg_created_at,
        } : null,
        unreadCount: conv.unread_count,
        lastMessageAt: conv.last_message_at,
      })),
    })
  } catch (error) {
    console.error('Failed to get conversations:', error)
    return res.status(500).json({ message: '获取会话列表失败' })
  }
}

export const getConversation = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const { userId: otherUserId } = req.params
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(50, Number(req.query.pageSize) || 30)
    const offset = (page - 1) * pageSize

    const otherUser = await db.get(`SELECT id, name, avatar, is_banned FROM users WHERE id = ?`, otherUserId)
    if (!otherUser) return res.status(404).json({ message: '用户不存在' })

    const conversation = await getOrCreateConversation(db, user.id, otherUserId)

    const messages = await db.all(
      `SELECT m.id, m.sender_id, m.content, m.is_read, m.created_at,
              u.name as sender_name, u.avatar as sender_avatar
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       LEFT JOIN message_deletions md ON m.id = md.message_id AND md.user_id = ?
       WHERE m.conversation_id = ? AND md.id IS NULL
       ORDER BY m.created_at DESC LIMIT ? OFFSET ?`,
      user.id, conversation.id, pageSize, offset
    )

    const totalCount = await db.get(
      `SELECT COUNT(*) as count FROM messages m
       LEFT JOIN message_deletions md ON m.id = md.message_id AND md.user_id = ?
       WHERE m.conversation_id = ? AND md.id IS NULL`,
      user.id, conversation.id
    )

    await db.run(
      `UPDATE messages SET is_read = 1 WHERE conversation_id = ? AND sender_id = ? AND is_read = 0`,
      conversation.id, otherUserId
    )

    return res.json({
      messages: messages.reverse().map(m => ({
        id: m.id, senderId: m.sender_id, senderName: m.sender_name,
        senderAvatar: m.sender_avatar, content: m.content,
        isRead: m.is_read === 1, createdAt: m.created_at,
      })),
      otherUser: { id: otherUser.id, name: otherUser.name, avatar: otherUser.avatar, isBanned: otherUser.is_banned === 1 },
      pagination: { page, pageSize, total: totalCount.count, totalPages: Math.ceil(totalCount.count / pageSize) },
    })
  } catch (error) {
    console.error('Failed to get messages:', error)
    return res.status(500).json({ message: '获取消息失败' })
  }
}

export const sendMessage = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const { userId: otherUserId } = req.params
    const { content } = req.body

    if (!content || typeof content !== 'string') return res.status(400).json({ message: '消息内容不能为空' })
    if (content.length > 2000) return res.status(400).json({ message: '消息内容不能超过 2000 字符' })
    if (otherUserId === user.id) return res.status(400).json({ message: '不能给自己发消息' })

    const blockCheck = await db.get(
      `SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1`,
      user.id, otherUserId, otherUserId, user.id
    )
    if (blockCheck) {
      const blockedByThem = await db.get(`SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?`, otherUserId, user.id)
      return res.status(403).json({ message: blockedByThem ? '对方已屏蔽你，无法发送消息' : '你已屏蔽对方，无法发送消息' })
    }

    if (messageRateLimits.has(user.id)) return res.status(429).json({ message: '请等待几秒后再发送' })

    const otherUser = await db.get(`SELECT id, is_banned FROM users WHERE id = ?`, otherUserId)
    if (!otherUser) return res.status(404).json({ message: '用户不存在' })
    if (otherUser.is_banned) return res.status(403).json({ message: '无法向被封禁用户发送消息' })

    const conversation = await getOrCreateConversation(db, user.id, otherUserId)
    const sanitizedContent = sanitizeHtml(content)
    const timestamp = new Date().toISOString()

    const result = await db.run(
      `INSERT INTO messages (conversation_id, sender_id, content, is_read, created_at) VALUES (?, ?, ?, 0, ?)`,
      conversation.id, user.id, sanitizedContent, timestamp
    )
    await db.run(`UPDATE conversations SET last_message_at = ? WHERE id = ?`, timestamp, conversation.id)
    messageRateLimits.set(user.id, Date.now())

    return res.json({
      message: {
        id: result.lastID, senderId: user.id, senderName: user.name,
        senderAvatar: user.avatar || null, content: sanitizedContent,
        isRead: false, createdAt: timestamp,
      },
    })
  } catch (error) {
    console.error('Failed to send message:', error)
    return res.status(500).json({ message: '发送消息失败' })
  }
}

export const markRead = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const { userId: otherUserId } = req.params
    const [user1, user2] = user.id < otherUserId ? [user.id, otherUserId] : [otherUserId, user.id]
    const conversation = await db.get(`SELECT id FROM conversations WHERE user1_id = ? AND user2_id = ?`, user1, user2)
    if (!conversation) return res.json({ success: true })
    await db.run(
      `UPDATE messages SET is_read = 1 WHERE conversation_id = ? AND sender_id = ? AND is_read = 0`,
      conversation.id, otherUserId
    )
    return res.json({ success: true })
  } catch (error) {
    console.error('Failed to mark as read:', error)
    return res.status(500).json({ message: '标记已读失败' })
  }
}

export const getUnreadCount = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const result = await db.get(
      `SELECT COUNT(*) as count FROM messages m
       JOIN conversations c ON m.conversation_id = c.id
       LEFT JOIN message_deletions md ON m.id = md.message_id AND md.user_id = ?
       WHERE (c.user1_id = ? OR c.user2_id = ?) AND m.sender_id != ? AND m.is_read = 0 AND md.id IS NULL`,
      user.id, user.id, user.id, user.id
    )
    return res.json({ unreadCount: result.count })
  } catch (error) {
    console.error('Failed to get unread count:', error)
    return res.status(500).json({ message: '获取未读数失败' })
  }
}

export const unreadStream = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  let closed = false
  req.on('close', () => { closed = true; clearInterval(timer) })

  const pushCount = async () => {
    if (closed) return
    try {
      const result = await db.get(
        `SELECT COUNT(*) as count FROM messages m
         JOIN conversations c ON m.conversation_id = c.id
         LEFT JOIN message_deletions md ON m.id = md.message_id AND md.user_id = ?
         WHERE (c.user1_id = ? OR c.user2_id = ?) AND m.sender_id != ? AND m.is_read = 0 AND md.id IS NULL`,
        user.id, user.id, user.id, user.id
      )
      if (!closed) res.write(`data: ${JSON.stringify({ unreadCount: result.count })}\n\n`)
    } catch {}
  }

  await pushCount()
  const timer = setInterval(pushCount, 15000)
}

export const deleteMessage = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const { messageId } = req.params
    const message = await db.get(
      `SELECT m.*, c.user1_id, c.user2_id FROM messages m JOIN conversations c ON m.conversation_id = c.id WHERE m.id = ?`,
      messageId
    )
    if (!message) return res.status(404).json({ message: '消息不存在' })
    if (message.user1_id !== user.id && message.user2_id !== user.id) return res.status(403).json({ message: '无权删除此消息' })

    const age = Date.now() - new Date(message.created_at).getTime()
    if (age <= 2 * 60 * 1000 && message.sender_id === user.id) {
      await db.run(`DELETE FROM messages WHERE id = ?`, messageId)
      return res.json({ success: true, deletedForBoth: true })
    } else {
      await db.run(
        `INSERT OR IGNORE INTO message_deletions (message_id, user_id, deleted_at) VALUES (?, ?, ?)`,
        messageId, user.id, new Date().toISOString()
      )
      return res.json({ success: true, deletedForBoth: false })
    }
  } catch (error) {
    console.error('Failed to delete message:', error)
    return res.status(500).json({ message: '删除消息失败' })
  }
}
