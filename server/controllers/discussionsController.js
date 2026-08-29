import { getDb } from '../db.js'
import { requireUser, requireAdmin, getAuthToken, getUserByToken } from '../middleware/auth.js'
import { sanitizeHtml } from '../utils/htmlFilter.js'
import { addXp, getUserLevelInfo } from '../utils/userHelpers.js'
import { getDecorationIdentity, getUnlockedAchievementTypeMap, getUnlockedAchievementTypes } from '../utils/decorations.js'
import { getLevelInfo } from '../stats.js'
import { createNotification, notifyMentions } from '../utils/notifications.js'
import { bumpChatStat } from '../utils/chatStats.js'
import { BoundedCache } from '../utils/boundedCache.js'
import { recordAdminAction } from '../utils/adminAudit.js'

const VALID_MODULES = new Set(['general', 'oj', 'jieya', 'starcode'])
const postRateLimits = new BoundedCache(5000, 10000)
const commentRateLimits = new BoundedCache(5000, 5000)

const parsePositiveInteger = (value) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

const getUserDecorationFields = (row, prefix = 'user', achievementTypes = new Set()) => {
  const decoration = getDecorationIdentity(
    {
      avatar_frame: row[`${prefix}_avatar_frame`],
      avatar_overlay: row[`${prefix}_avatar_overlay`],
      equipped_title: row[`${prefix}_equipped_title`],
    },
    getLevelInfo(row[`${prefix}_xp`] || 0),
    achievementTypes,
  )
  return {
    userAvatarFrame: decoration.avatarFrame,
    userAvatarOverlay: decoration.avatarOverlay,
    userDisplayTitle: decoration.displayTitle,
    userDisplayTitleIcon: decoration.displayTitleIcon,
  }
}

export const listDiscussions = async (req, res) => {
  try {
    const db = await getDb()
    const page = Math.min(10000, Math.max(1, parseInt(req.query.page) || 1))
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize) || 20))
    const sort = req.query.sort === 'hot' ? 'hot' : 'latest'
    const problemId = req.query.problemId ? parseInt(req.query.problemId) : null
    const search = (req.query.search || '').trim()
    const moduleKey = (req.query.module || '').trim()
    const authorId = (req.query.userId || '').trim()
    const feed = req.query.feed === 'following' ? 'following' : null

    const where = ['dp.is_solution = 0']
    const params = []

    if (problemId) { where.push('dp.problem_id = ?'); params.push(problemId) }
    if (search) { where.push('dp.title LIKE ?'); params.push(`%${search}%`) }
    if (moduleKey && VALID_MODULES.has(moduleKey)) { where.push('dp.module_key = ?'); params.push(moduleKey) }
    if (authorId) { where.push('dp.user_id = ?'); params.push(authorId) }
    if (feed === 'following') {
      const token = getAuthToken(req)
      const viewer = token ? await getUserByToken(db, token) : null
      if (!viewer) return res.status(401).json({ message: '未登录' })
      where.push(`(dp.user_id = ? OR dp.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?))`)
      params.push(viewer.id, viewer.id)
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const orderSql = sort === 'hot'
      ? 'ORDER BY dp.is_pinned DESC, (dp.like_count * 3 + dp.comment_count * 2 + dp.view_count * 0.1) DESC, dp.created_at DESC'
      : 'ORDER BY dp.is_pinned DESC, dp.created_at DESC'

    const countRow = await db.get(`SELECT COUNT(*) as count FROM discussion_posts dp ${whereSql}`, ...params)
    const total = countRow?.count || 0
    const offset = (page - 1) * pageSize

    const posts = await db.all(
      `SELECT dp.id, dp.user_id, dp.title, dp.content, dp.problem_id, dp.module_key, dp.view_count, dp.like_count,
              dp.comment_count, dp.is_pinned, dp.created_at, dp.updated_at,
              u.name as user_name, u.avatar as user_avatar,
              u.avatar_frame as user_avatar_frame, u.avatar_overlay as user_avatar_overlay,
              u.equipped_title as user_equipped_title, us.xp as user_xp,
              p.title as problem_title
       FROM discussion_posts dp
       LEFT JOIN users u ON dp.user_id = u.id
       LEFT JOIN user_stats us ON us.user_id = dp.user_id
       LEFT JOIN problems p ON dp.problem_id = p.id
       ${whereSql} ${orderSql} LIMIT ? OFFSET ?`,
      ...params, pageSize, offset
    )

    const token = getAuthToken(req)
    let likedSet = new Set()
    if (token) {
      const user = await getUserByToken(db, token)
      if (user) {
        const likes = await db.all(
          `SELECT target_id FROM discussion_likes WHERE user_id = ? AND target_type = 'post'`, user.id
        )
        likedSet = new Set(likes.map(l => l.target_id))
      }
    }

    const achievementMap = await getUnlockedAchievementTypeMap(db, posts.map((post) => post.user_id))
    return res.json({
      posts: posts.map(p => ({
        id: p.id, userId: p.user_id, userName: p.user_name, userAvatar: p.user_avatar,
        ...getUserDecorationFields(p, 'user', achievementMap.get(p.user_id)),
        title: p.title, content: p.content, problemId: p.problem_id, problemTitle: p.problem_title,
        moduleKey: p.module_key || 'general',
        viewCount: p.view_count, likeCount: p.like_count, commentCount: p.comment_count,
        isPinned: Boolean(p.is_pinned), liked: likedSet.has(p.id),
        createdAt: p.created_at, updatedAt: p.updated_at,
      })),
      total, page, pageSize,
    })
  } catch (error) {
    console.error('Failed to list discussions:', error)
    return res.status(500).json({ message: '获取讨论列表失败' })
  }
}

export const getDiscussion = async (req, res) => {
  try {
    const db = await getDb()
    const postId = parseInt(req.params.id)
    if (!postId) return res.status(400).json({ message: '无效的帖子ID' })

    const post = await db.get(
      `SELECT dp.*, u.name as user_name, u.avatar as user_avatar,
              u.avatar_frame as user_avatar_frame, u.avatar_overlay as user_avatar_overlay,
              u.equipped_title as user_equipped_title, us.xp as user_xp,
              p.title as problem_title
       FROM discussion_posts dp LEFT JOIN users u ON dp.user_id = u.id LEFT JOIN problems p ON dp.problem_id = p.id
       LEFT JOIN user_stats us ON us.user_id = dp.user_id
       WHERE dp.id = ?`, postId
    )
    if (!post) return res.status(404).json({ message: '帖子不存在' })
    post.module_key = post.module_key || 'general'

    const token = getAuthToken(req)
    let viewUser = null
    if (token) {
      viewUser = await getUserByToken(db, token)
      if (viewUser) {
        const existing = await db.get(
          `SELECT id FROM discussion_views WHERE post_id = ? AND user_id = ?`, postId, viewUser.id
        )
        if (!existing) {
          await db.run(
            `INSERT INTO discussion_views (post_id, user_id, created_at) VALUES (?, ?, ?)`,
            postId, viewUser.id, new Date().toISOString()
          )
          await db.run(
            `UPDATE discussion_posts SET view_count = (SELECT COUNT(*) FROM discussion_views WHERE post_id = ?) WHERE id = ?`,
            postId, postId
          )
        }
      }
    }

    const comments = await db.all(
      `SELECT dc.*, u.name as user_name, u.avatar as user_avatar,
              u.avatar_frame as user_avatar_frame, u.avatar_overlay as user_avatar_overlay,
              u.equipped_title as user_equipped_title, us.xp as user_xp
       FROM discussion_comments dc LEFT JOIN users u ON dc.user_id = u.id
       LEFT JOIN user_stats us ON us.user_id = dc.user_id
       WHERE dc.post_id = ? ORDER BY dc.created_at ASC`, postId
    )

    let postLiked = false
    let commentLikedSet = new Set()
    if (viewUser) {
      const postLike = await db.get(
        `SELECT id FROM discussion_likes WHERE user_id = ? AND target_type = 'post' AND target_id = ?`,
        viewUser.id, postId
      )
      postLiked = !!postLike
      if (comments.length > 0) {
        const commentLikes = await db.all(
          `SELECT target_id FROM discussion_likes WHERE user_id = ? AND target_type = 'comment' AND target_id IN (${comments.map(() => '?').join(',')})`,
          viewUser.id, ...comments.map(c => c.id)
        )
        commentLikedSet = new Set(commentLikes.map(l => l.target_id))
      }
    }

    const achievementMap = await getUnlockedAchievementTypeMap(db, [post.user_id, ...comments.map((comment) => comment.user_id)])
    const commentMap = new Map()
    const topComments = []
    for (const c of comments) {
      commentMap.set(c.id, {
        id: c.id, postId: c.post_id, userId: c.user_id,
        userName: c.user_name, userAvatar: c.user_avatar,
        ...getUserDecorationFields(c, 'user', achievementMap.get(c.user_id)),
        content: c.content, parentId: c.parent_id,
        likeCount: c.like_count, liked: commentLikedSet.has(c.id),
        createdAt: c.created_at, replies: [],
      })
    }
    for (const c of comments) {
      const formatted = commentMap.get(c.id)
      if (c.parent_id && commentMap.has(c.parent_id)) {
        const parent = commentMap.get(c.parent_id)
        formatted.replyToName = parent.userName
        parent.replies.push(formatted)
      } else {
        topComments.push(formatted)
      }
    }

    return res.json({
      post: {
        id: post.id, userId: post.user_id, userName: post.user_name,
        userAvatar: post.user_avatar, title: post.title, content: post.content,
        ...getUserDecorationFields(post, 'user', achievementMap.get(post.user_id)),
        problemId: post.problem_id, problemTitle: post.problem_title,
        moduleKey: post.module_key,
        viewCount: post.view_count, likeCount: post.like_count,
        commentCount: post.comment_count, isPinned: Boolean(post.is_pinned),
        isSolution: Boolean(post.is_solution), liked: postLiked,
        createdAt: post.created_at, updatedAt: post.updated_at,
      },
      comments: topComments,
    })
  } catch (error) {
    console.error('Failed to get discussion:', error)
    return res.status(500).json({ message: '获取帖子详情失败' })
  }
}

export const createDiscussion = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    if (postRateLimits.has(user.id)) return res.status(429).json({ message: '发帖过于频繁，请稍后再试' })

    const { title, content, problemId, moduleKey } = req.body || {}
    if (!title || !title.trim()) return res.status(400).json({ message: '标题不能为空' })
    if (title.trim().length > 200) return res.status(400).json({ message: '标题不能超过200字符' })
    if (!content || !content.trim()) return res.status(400).json({ message: '内容不能为空' })
    if (content.length > 50000) return res.status(400).json({ message: '内容不能超过50000字符' })
    const module = moduleKey && VALID_MODULES.has(moduleKey) ? moduleKey : 'general'

    if (problemId) {
      const problem = await db.get(`SELECT id FROM problems WHERE id = ?`, problemId)
      if (!problem) return res.status(400).json({ message: '关联的题目不存在' })
    }

    const now = new Date().toISOString()
    const sanitized = sanitizeHtml(content)
    const result = await db.run(
      `INSERT INTO discussion_posts (user_id, title, content, problem_id, module_key, view_count, like_count, comment_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, ?)`,
      user.id, title.trim(), sanitized, problemId || null, module, now, now
    )

    postRateLimits.set(user.id, Date.now())
    await addXp(db, user.id, 20)
    await bumpChatStat(db, user.id, { field: 'post_count', points: 10 })
    await notifyMentions(
      db, content.replace(/<[^>]*>/g, ' '), user.id, 'mention',
      'post', result.lastID, (id) => `在帖子《${String(title).trim().slice(0, 30)}》中提到了你（@${id}）`
    )
    return res.json({ message: '发帖成功', postId: result.lastID })
  } catch (error) {
    console.error('Failed to create discussion:', error)
    return res.status(500).json({ message: '发帖失败' })
  }
}

export const updateDiscussion = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const postId = parseInt(req.params.id)
    if (!postId) return res.status(400).json({ message: '无效的帖子ID' })

    const post = await db.get(`SELECT * FROM discussion_posts WHERE id = ?`, postId)
    if (!post) return res.status(404).json({ message: '帖子不存在' })
    if (post.user_id !== user.id && !user.is_admin) return res.status(403).json({ message: '无权编辑此帖子' })

    const { title, content, problemId, moduleKey } = req.body || {}
    if (!title || !title.trim()) return res.status(400).json({ message: '标题不能为空' })
    if (title.trim().length > 200) return res.status(400).json({ message: '标题不能超过200字符' })
    if (!content || !content.trim()) return res.status(400).json({ message: '内容不能为空' })
    if (content.length > 50000) return res.status(400).json({ message: '内容不能超过50000字符' })
    const module = moduleKey && VALID_MODULES.has(moduleKey) ? moduleKey : 'general'

    if (problemId) {
      const problem = await db.get(`SELECT id FROM problems WHERE id = ?`, problemId)
      if (!problem) return res.status(400).json({ message: '关联的题目不存在' })
    }

    await db.run(
      `UPDATE discussion_posts SET title = ?, content = ?, problem_id = ?, module_key = ?, updated_at = ? WHERE id = ?`,
      title.trim(), sanitizeHtml(content), problemId || null, module, new Date().toISOString(), postId
    )
    if (user.is_admin && post.user_id !== user.id) {
      await recordAdminAction(db, {
        adminId: user.id,
        adminName: user.name,
        action: 'discussion.update', targetType: 'post', targetId: postId,
      })
    }
    return res.json({ message: '编辑成功' })
  } catch (error) {
    console.error('Failed to edit discussion:', error)
    return res.status(500).json({ message: '编辑失败' })
  }
}

export const deleteDiscussion = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const postId = parseInt(req.params.id)
    if (!postId) return res.status(400).json({ message: '无效的帖子ID' })

    const post = await db.get(`SELECT * FROM discussion_posts WHERE id = ?`, postId)
    if (!post) return res.status(404).json({ message: '帖子不存在' })
    if (post.user_id !== user.id && !user.is_admin) return res.status(403).json({ message: '无权删除此帖子' })

    await db.run(`DELETE FROM discussion_likes WHERE target_type = 'comment' AND target_id IN (SELECT id FROM discussion_comments WHERE post_id = ?)`, postId)
    await db.run(`DELETE FROM discussion_likes WHERE target_type = 'post' AND target_id = ?`, postId)
    await db.run(`DELETE FROM discussion_comments WHERE post_id = ?`, postId)
    await db.run(`DELETE FROM notifications WHERE target_type = 'post' AND target_id = ?`, postId)
    await db.run(`DELETE FROM bookmarks WHERE target_type = 'post' AND target_id = ?`, postId)
    await db.run(`DELETE FROM discussion_posts WHERE id = ?`, postId)
    if (user.is_admin && post.user_id !== user.id) {
      await recordAdminAction(db, {
        adminId: user.id,
        adminName: user.name,
        action: 'discussion.delete', targetType: 'post', targetId: postId,
        detail: { title: post.title },
      })
    }
    return res.json({ message: '删除成功' })
  } catch (error) {
    console.error('Failed to delete discussion:', error)
    return res.status(500).json({ message: '删除失败' })
  }
}

export const pinDiscussion = async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const { db } = auth
  try {
    const postId = parseInt(req.params.id)
    if (!postId) return res.status(400).json({ message: '无效的帖子ID' })
    const post = await db.get(`SELECT id FROM discussion_posts WHERE id = ?`, postId)
    if (!post) return res.status(404).json({ message: '帖子不存在' })
    await db.run(`UPDATE discussion_posts SET is_pinned = 1, pinned_at = ? WHERE id = ?`, new Date().toISOString(), postId)
    await recordAdminAction(db, {
      adminId: auth.user.id,
      adminName: auth.user.name,
      action: 'discussion.pin', targetType: 'post', targetId: postId,
    })
    return res.json({ success: true, isPinned: true })
  } catch (error) {
    console.error('Failed to pin discussion:', error)
    return res.status(500).json({ message: '置顶失败' })
  }
}

export const unpinDiscussion = async (req, res) => {
  const auth = await requireAdmin(req, res)
  if (!auth) return
  const { db } = auth
  try {
    const postId = parseInt(req.params.id)
    if (!postId) return res.status(400).json({ message: '无效的帖子ID' })
    const post = await db.get(`SELECT id FROM discussion_posts WHERE id = ?`, postId)
    if (!post) return res.status(404).json({ message: '帖子不存在' })
    await db.run(`UPDATE discussion_posts SET is_pinned = 0, pinned_at = NULL WHERE id = ?`, postId)
    await recordAdminAction(db, {
      adminId: auth.user.id,
      adminName: auth.user.name,
      action: 'discussion.unpin', targetType: 'post', targetId: postId,
    })
    return res.json({ success: true, isPinned: false })
  } catch (error) {
    console.error('Failed to unpin discussion:', error)
    return res.status(500).json({ message: '取消置顶失败' })
  }
}

export const addComment = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    if (commentRateLimits.has(user.id)) return res.status(429).json({ message: '评论过于频繁，请稍后再试' })
    commentRateLimits.set(user.id, Date.now())

    const postId = parseInt(req.params.id)
    if (!postId) return res.status(400).json({ message: '无效的帖子ID' })

    const post = await db.get(`SELECT id FROM discussion_posts WHERE id = ?`, postId)
    if (!post) return res.status(404).json({ message: '帖子不存在' })

    const postAuthor = await db.get(`SELECT user_id FROM discussion_posts WHERE id = ?`, postId)
    if (postAuthor && postAuthor.user_id !== user.id) {
      const blocked = await db.get(
        `SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?`, postAuthor.user_id, user.id
      )
      if (blocked) return res.status(403).json({ message: '对方已屏蔽你，无法评论' })
    }

    const { content, parentId } = req.body || {}
    if (!content || !content.trim()) return res.status(400).json({ message: '评论内容不能为空' })
    if (content.length > 10000) return res.status(400).json({ message: '评论不能超过10000字符' })

    if (parentId) {
      const parent = await db.get(
        `SELECT id FROM discussion_comments WHERE id = ? AND post_id = ?`, parentId, postId
      )
      if (!parent) return res.status(400).json({ message: '回复的评论不存在' })
    }

    const now = new Date().toISOString()
    const sanitized = sanitizeHtml(content)
    const result = await db.run(
      `INSERT INTO discussion_comments (post_id, user_id, content, parent_id, like_count, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`,
      postId, user.id, sanitized, parentId || null, now
    )
    await db.run(`UPDATE discussion_posts SET comment_count = comment_count + 1 WHERE id = ?`, postId)
    await bumpChatStat(db, user.id, { field: 'comment_count', points: 5 })
    await addXp(db, user.id, 5)

    const postRow = await db.get(`SELECT user_id, title FROM discussion_posts WHERE id = ?`, postId)
    if (postRow && postRow.user_id !== user.id) {
      await createNotification(db, {
        userId: postRow.user_id, actorId: user.id, type: 'comment',
        targetType: 'post', targetId: postId,
        message: `评论了你的帖子《${String(postRow.title).slice(0, 30)}》`,
        push: { title: '新评论', body: `评论了你的帖子《${String(postRow.title).slice(0, 20)}》`, url: `/chat/p/${postId}` },
      })
    }
    if (parentId) {
      const parent = await db.get(`SELECT user_id FROM discussion_comments WHERE id = ?`, parentId)
      if (parent && parent.user_id !== user.id && parent.user_id !== postRow?.user_id) {
        await createNotification(db, {
          userId: parent.user_id, actorId: user.id, type: 'reply',
          targetType: 'post', targetId: postId,
          message: '回复了你的评论',
          push: { title: '新回复', body: '回复了你的评论', url: `/chat/p/${postId}` },
        })
      }
    }
    await notifyMentions(
      db, content.replace(/<[^>]*>/g, ' '), user.id, 'mention',
      'post', postId, (id) => `在评论中提到了你（@${id}）`
    )

    const decoration = getDecorationIdentity(
      user,
      await getUserLevelInfo(db, user.id),
      await getUnlockedAchievementTypes(db, user.id),
    )
    return res.json({
      message: '评论成功',
      comment: {
        id: result.lastID, postId, userId: user.id,
        userName: user.name, userAvatar: user.avatar,
        userAvatarFrame: decoration.avatarFrame,
        userAvatarOverlay: decoration.avatarOverlay,
        userDisplayTitle: decoration.displayTitle,
        userDisplayTitleIcon: decoration.displayTitleIcon,
        content: sanitized, parentId: parentId || null,
        likeCount: 0, liked: false, createdAt: now, replies: [],
      },
    })
  } catch (error) {
    console.error('Failed to add comment:', error)
    return res.status(500).json({ message: '评论失败' })
  }
}

export const deleteComment = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const commentId = parseInt(req.params.id)
    if (!commentId) return res.status(400).json({ message: '无效的评论ID' })

    const comment = await db.get(`SELECT * FROM discussion_comments WHERE id = ?`, commentId)
    if (!comment) return res.status(404).json({ message: '评论不存在' })
    if (comment.user_id !== user.id && !user.is_admin) return res.status(403).json({ message: '无权删除此评论' })

    const replyCount = await db.get(`SELECT COUNT(*) as count FROM discussion_comments WHERE parent_id = ?`, commentId)
    const totalRemoved = 1 + (replyCount?.count || 0)

    await db.run(`DELETE FROM discussion_likes WHERE target_type = 'comment' AND target_id IN (SELECT id FROM discussion_comments WHERE parent_id = ?)`, commentId)
    await db.run(`DELETE FROM discussion_likes WHERE target_type = 'comment' AND target_id = ?`, commentId)
    await db.run(`DELETE FROM discussion_comments WHERE parent_id = ?`, commentId)
    await db.run(`DELETE FROM discussion_comments WHERE id = ?`, commentId)
    await db.run(`UPDATE discussion_posts SET comment_count = MAX(0, comment_count - ?) WHERE id = ?`, totalRemoved, comment.post_id)
    if (user.is_admin && comment.user_id !== user.id) {
      await recordAdminAction(db, {
        adminId: user.id,
        adminName: user.name,
        action: 'discussion.delete', targetType: 'comment', targetId: commentId,
        detail: { postId: comment.post_id, removedCount: totalRemoved },
      })
    }
    return res.json({ message: '删除成功' })
  } catch (error) {
    console.error('Failed to delete comment:', error)
    return res.status(500).json({ message: '删除失败' })
  }
}

export const toggleLike = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  let transactionStarted = false
  try {
    const { targetType, targetId } = req.body || {}
    if (!targetType || !targetId) return res.status(400).json({ message: '参数不完整' })
    if (targetType !== 'post' && targetType !== 'comment') return res.status(400).json({ message: '无效的目标类型' })

    const id = parsePositiveInteger(targetId)
    if (!id) return res.status(400).json({ message: '无效的目标ID' })

    if (targetType === 'post') {
      const post = await db.get(`SELECT id FROM discussion_posts WHERE id = ?`, id)
      if (!post) return res.status(404).json({ message: '帖子不存在' })
    } else {
      const comment = await db.get(`SELECT id FROM discussion_comments WHERE id = ?`, id)
      if (!comment) return res.status(404).json({ message: '评论不存在' })
    }

    await db.exec('BEGIN IMMEDIATE')
    transactionStarted = true
    const existing = await db.get(
      `SELECT id FROM discussion_likes WHERE user_id = ? AND target_type = ? AND target_id = ?`,
      user.id, targetType, id
    )
    const table = targetType === 'post' ? 'discussion_posts' : 'discussion_comments'
    let liked
    if (existing) {
      await db.run(`DELETE FROM discussion_likes WHERE id = ?`, existing.id)
      await db.run(`UPDATE ${table} SET like_count = MAX(0, like_count - 1) WHERE id = ?`, id)
      liked = false
    } else {
      await db.run(
        `INSERT INTO discussion_likes (user_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?)`,
        user.id, targetType, id, new Date().toISOString()
      )
      await db.run(`UPDATE ${table} SET like_count = like_count + 1 WHERE id = ?`, id)
      liked = true
    }

    const updated = await db.get(`SELECT like_count FROM ${table} WHERE id = ?`, id)
    await db.exec('COMMIT')
    transactionStarted = false
    return res.json({ liked, likeCount: updated?.like_count || 0 })
  } catch (error) {
    if (transactionStarted) await db.exec('ROLLBACK').catch(() => undefined)
    console.error('Failed to toggle like:', error)
    return res.status(500).json({ message: '操作失败' })
  }
}
