import { getDb } from '../db.js'
import { requireUser } from '../middleware/auth.js'
import { createNotification } from '../utils/notifications.js'
import { getFollowRelations } from '../utils/socialHelpers.js'

const PRESENCE_ONLINE_MS = 60 * 1000

const formatFollowUser = (row) => ({
  id: row.id, name: row.name, avatar: row.avatar,
  online: Boolean(row.last_seen_at) && Date.now() - new Date(row.last_seen_at).getTime() <= PRESENCE_ONLINE_MS,
})

export const followUser = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const targetId = req.params.id
    if (targetId === user.id) return res.status(400).json({ message: '不能关注自己' })
    const target = await db.get(`SELECT id FROM users WHERE id = ? AND is_banned = 0`, targetId)
    if (!target) return res.status(404).json({ message: '用户不存在' })
    const followResult = await db.run(
      `INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)`,
      user.id, targetId, new Date().toISOString()
    )
    if (followResult.changes > 0) {
      await createNotification(db, {
        userId: targetId, actorId: user.id, type: 'follow', message: '关注了你',
        push: { title: '新关注', body: '关注了你', url: `/user/${user.id}` },
      })
    }
    const relations = await getFollowRelations(db, user.id, targetId)
    return res.json({ message: relations.isFriend ? '你们已经是好友了' : '关注成功', relations })
  } catch (error) {
    console.error('Failed to follow user:', error)
    return res.status(500).json({ message: '关注失败' })
  }
}

export const unfollowUser = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const targetId = req.params.id
    await db.run(`DELETE FROM follows WHERE follower_id = ? AND followee_id = ?`, user.id, targetId)
    const relations = await getFollowRelations(db, user.id, targetId)
    return res.json({ message: '已取消关注', relations })
  } catch (error) {
    console.error('Failed to unfollow user:', error)
    return res.status(500).json({ message: '取消关注失败' })
  }
}

export const blockUser = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const targetId = req.params.id
    if (targetId === user.id) return res.status(400).json({ message: '不能屏蔽自己' })
    const target = await db.get(`SELECT id FROM users WHERE id = ?`, targetId)
    if (!target) return res.status(404).json({ message: '用户不存在' })
    await db.run(`INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)`, user.id, targetId, new Date().toISOString())
    await db.run(`DELETE FROM follows WHERE (follower_id = ? AND followee_id = ?) OR (follower_id = ? AND followee_id = ?)`, user.id, targetId, targetId, user.id)
    return res.json({ message: '已屏蔽对方', blocked: true })
  } catch (error) {
    console.error('Failed to block user:', error)
    return res.status(500).json({ message: '操作失败' })
  }
}

export const unblockUser = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    await db.run(`DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?`, user.id, req.params.id)
    return res.json({ message: '已取消屏蔽', blocked: false })
  } catch (error) {
    console.error('Failed to unblock user:', error)
    return res.status(500).json({ message: '操作失败' })
  }
}

export const listBlocks = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const rows = await db.all(
      `SELECT b.blocked_id as id, u.name, u.avatar, b.created_at FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ? ORDER BY b.created_at DESC`,
      user.id
    )
    return res.json({ users: rows })
  } catch (error) {
    console.error('Failed to list blocks:', error)
    return res.status(500).json({ message: '获取屏蔽列表失败' })
  }
}

export const listFriends = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const rows = await db.all(
      `SELECT f1.followee_id as id, u.name, u.avatar, p.last_seen_at
       FROM follows f1 JOIN follows f2 ON f1.followee_id = f2.follower_id AND f2.followee_id = ?
       JOIN users u ON u.id = f1.followee_id LEFT JOIN user_presence p ON p.user_id = u.id
       WHERE f1.follower_id = ? ORDER BY p.last_seen_at DESC, f1.created_at DESC`,
      user.id, user.id
    )
    return res.json({ friends: rows.map(formatFollowUser) })
  } catch (error) {
    console.error('Failed to list friends:', error)
    return res.status(500).json({ message: '获取好友列表失败' })
  }
}

export const listFollowing = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const rows = await db.all(
      `SELECT f.followee_id as id, u.name, u.avatar, p.last_seen_at, f.created_at,
              EXISTS(SELECT 1 FROM follows f2 WHERE f2.follower_id = f.followee_id AND f2.followee_id = ?) as is_friend
       FROM follows f JOIN users u ON u.id = f.followee_id LEFT JOIN user_presence p ON p.user_id = u.id
       WHERE f.follower_id = ? ORDER BY f.created_at DESC`,
      user.id, user.id
    )
    return res.json({ users: rows.map((row) => ({ ...formatFollowUser(row), isFriend: Boolean(row.is_friend), followedAt: row.created_at })) })
  } catch (error) {
    console.error('Failed to list following:', error)
    return res.status(500).json({ message: '获取关注列表失败' })
  }
}

export const listFollowers = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const rows = await db.all(
      `SELECT f.follower_id as id, u.name, u.avatar, p.last_seen_at, f.created_at,
              EXISTS(SELECT 1 FROM follows f2 WHERE f2.follower_id = ? AND f2.followee_id = f.follower_id) as is_friend
       FROM follows f JOIN users u ON u.id = f.follower_id LEFT JOIN user_presence p ON p.user_id = u.id
       WHERE f.followee_id = ? ORDER BY f.created_at DESC`,
      user.id, user.id
    )
    return res.json({ users: rows.map((row) => ({ ...formatFollowUser(row), isFriend: Boolean(row.is_friend), followedAt: row.created_at })) })
  } catch (error) {
    console.error('Failed to list followers:', error)
    return res.status(500).json({ message: '获取粉丝列表失败' })
  }
}

export const exportUserData = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const [posts, comments, conversations, privateMessages, chatMessages, bookmarks] = await Promise.all([
      db.all(`SELECT id, title, content, module_key, problem_id, created_at, updated_at FROM discussion_posts WHERE user_id = ? ORDER BY created_at DESC`, user.id),
      db.all(`SELECT id, post_id, content, parent_id, created_at FROM discussion_comments WHERE user_id = ? ORDER BY created_at DESC`, user.id),
      db.all(`SELECT id, user1_id, user2_id, created_at FROM conversations WHERE user1_id = ? OR user2_id = ? ORDER BY created_at DESC`, user.id, user.id),
      db.all(`SELECT m.id, m.conversation_id, m.sender_id, m.content, m.is_read, m.created_at FROM messages m JOIN conversations c ON m.conversation_id = c.id WHERE c.user1_id = ? OR c.user2_id = ? ORDER BY m.created_at ASC`, user.id, user.id),
      db.all(`SELECT id, channel_key, room_id, content, created_at FROM chat_messages WHERE sender_id = ? ORDER BY created_at ASC`, user.id),
      db.all(`SELECT target_type, target_id, created_at FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC`, user.id),
    ])
    return res.json({
      exportedAt: new Date().toISOString(),
      user: { id: user.id, name: user.name, avatar: user.avatar, bio: user.bio || '', createdAt: user.created_at },
      posts: posts.map((p) => ({ id: p.id, title: p.title, content: p.content, moduleKey: p.module_key, problemId: p.problem_id, createdAt: p.created_at, updatedAt: p.updated_at })),
      comments: comments.map((c) => ({ id: c.id, postId: c.post_id, content: c.content, parentId: c.parent_id, createdAt: c.created_at })),
      conversations: conversations.map((c) => ({ id: c.id, user1Id: c.user1_id, user2Id: c.user2_id, createdAt: c.created_at })),
      privateMessages: privateMessages.map((m) => ({ id: m.id, conversationId: m.conversation_id, senderId: m.sender_id, content: m.content, isRead: Boolean(m.is_read), createdAt: m.created_at })),
      chatMessages: chatMessages.map((m) => ({ id: m.id, channelKey: m.channel_key, roomId: m.room_id, content: m.content, createdAt: m.created_at })),
      bookmarks: bookmarks.map((b) => ({ targetType: b.target_type, targetId: b.target_id, createdAt: b.created_at })),
    })
  } catch (error) {
    console.error('Failed to export user data:', error)
    return res.status(500).json({ message: '导出失败' })
  }
}
