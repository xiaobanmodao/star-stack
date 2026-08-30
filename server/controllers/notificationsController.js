import webpush from 'web-push'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { getDb } from '../db.js'
import { requireUser } from '../middleware/auth.js'
import { BoundedCache } from '../utils/boundedCache.js'
import { isTrustedPushEndpoint } from '../utils/pushEndpoint.js'
import { decodePositiveIntegerCursor, encodeCursor } from '../utils/cursor.js'
import { getDecorationIdentity, getUnlockedAchievementTypeMap } from '../utils/decorations.js'
import { getLevelInfo } from '../stats.js'

const pushSubscriptionRateLimits = new BoundedCache(5000, 60 * 1000)
const MAX_PUSH_ENDPOINT_LENGTH = 2048
const MAX_PUSH_KEY_LENGTH = 256
const MAX_PUSH_SUBSCRIPTIONS_PER_USER = 10
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/

let vapidKeys = null
const getVapidKeys = () => {
  if (vapidKeys) return vapidKeys
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapidKeys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY }
    return vapidKeys
  }
  const filePath = new URL('../.vapid.json', import.meta.url).pathname
  if (existsSync(filePath)) {
    try { chmodSync(filePath, 0o600) } catch {}
    vapidKeys = JSON.parse(readFileSync(filePath, 'utf8'))
    return vapidKeys
  }
  const generated = webpush.generateVAPIDKeys()
  writeFileSync(filePath, JSON.stringify(generated, null, 2), { mode: 0o600 })
  try { chmodSync(filePath, 0o600) } catch {}
  vapidKeys = generated
  return vapidKeys
}

export const initPush = () => {
  const keys = getVapidKeys()
  webpush.setVapidDetails('mailto:admin@starstack.local', keys.publicKey, keys.privateKey)
  console.log('Web Push initialized')
}

export const getVapidPublicKey = (req, res) => {
  res.json({ publicKey: getVapidKeys().publicKey })
}

export const subscribePush = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const { subscription } = req.body || {}
    if (!subscription || typeof subscription !== 'object' || Array.isArray(subscription)) {
      return res.status(400).json({ message: '无效的订阅信息' })
    }
    const endpoint = typeof subscription.endpoint === 'string' ? subscription.endpoint.trim() : ''
    const keys = subscription.keys
    if (!endpoint || endpoint.length > MAX_PUSH_ENDPOINT_LENGTH || !keys || typeof keys !== 'object' || Array.isArray(keys)) {
      return res.status(400).json({ message: '无效的订阅信息' })
    }
    let endpointUrl
    try {
      endpointUrl = new URL(endpoint)
    } catch {
      return res.status(400).json({ message: '无效的推送地址' })
    }
    if (endpointUrl.protocol !== 'https:' || endpointUrl.username || endpointUrl.password || !isTrustedPushEndpoint(endpoint)) {
      return res.status(400).json({ message: '无效的推送地址' })
    }
    const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh.trim() : ''
    const authKey = typeof keys.auth === 'string' ? keys.auth.trim() : ''
    if (
      p256dh.length < 16 || p256dh.length > MAX_PUSH_KEY_LENGTH ||
      authKey.length < 8 || authKey.length > MAX_PUSH_KEY_LENGTH ||
      !BASE64URL_RE.test(p256dh) || !BASE64URL_RE.test(authKey)
    ) {
      return res.status(400).json({ message: '无效的推送密钥' })
    }
    const limitKey = `${user.id}:${endpoint}`
    if (pushSubscriptionRateLimits.has(limitKey)) {
      return res.status(429).json({ message: '订阅操作过于频繁，请稍后再试' })
    }
    pushSubscriptionRateLimits.set(limitKey, true)
    const existing = await db.get(`SELECT id FROM push_subscriptions WHERE user_id = ? AND endpoint = ?`, user.id, endpoint)
    if (!existing) {
      const count = await db.get(`SELECT COUNT(*) AS count FROM push_subscriptions WHERE user_id = ?`, user.id)
      if (Number(count?.count || 0) >= MAX_PUSH_SUBSCRIPTIONS_PER_USER) {
        return res.status(409).json({ message: '推送设备数量已达到上限' })
      }
    }
    await db.run(
      `INSERT OR REPLACE INTO push_subscriptions (user_id, endpoint, keys_json, created_at) VALUES (?, ?, ?, ?)`,
      user.id, endpoint, JSON.stringify({ p256dh, auth: authKey }), new Date().toISOString()
    )
    return res.json({ success: true })
  } catch (error) {
    console.error('Failed to save push subscription:', error)
    return res.status(500).json({ message: '保存订阅失败' })
  }
}

export const unsubscribePush = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const endpoint = String(req.query.endpoint || '')
    if (endpoint) {
      await db.run(`DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?`, user.id, endpoint)
    } else {
      await db.run(`DELETE FROM push_subscriptions WHERE user_id = ?`, user.id)
    }
    return res.json({ success: true })
  } catch (error) {
    console.error('Failed to remove push subscription:', error)
    return res.status(500).json({ message: '移除订阅失败' })
  }
}

export const listNotifications = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const page = Math.min(10000, Math.max(1, parseInt(req.query.page) || 1))
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize) || 20))
    const cursorRequested = req.query?.cursor !== undefined
    const cursor = cursorRequested ? decodePositiveIntegerCursor(req.query.cursor) : null
    if (cursorRequested && !cursor) return res.status(400).json({ message: '无效的分页游标' })
    const limit = cursorRequested ? pageSize + 1 : pageSize
    const rows = await db.all(
      `SELECT n.*, u.name as actor_name, u.avatar as actor_avatar,
              u.avatar_frame as actor_avatar_frame, u.avatar_overlay as actor_avatar_overlay,
              u.equipped_title as actor_equipped_title, us.xp as actor_xp
       FROM notifications n LEFT JOIN users u ON n.actor_id = u.id
       LEFT JOIN user_stats us ON us.user_id = n.actor_id
       WHERE n.user_id = ?${cursorRequested ? ' AND n.id < ?' : ''}
       ORDER BY n.created_at DESC, n.id DESC LIMIT ?${cursorRequested ? '' : ' OFFSET ?'}`,
      ...(cursorRequested
        ? [user.id, cursor, limit]
        : [user.id, limit, (page - 1) * pageSize]),
    )
    const visibleRows = cursorRequested && rows.length > pageSize ? rows.slice(0, pageSize) : rows
    const nextCursor = cursorRequested && rows.length > pageSize
      ? encodeCursor({ id: visibleRows[visibleRows.length - 1]?.id })
      : null
    const countRow = await db.get(
      `SELECT COUNT(*) as total, SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread FROM notifications WHERE user_id = ?`,
      user.id
    )
    const achievementMap = await getUnlockedAchievementTypeMap(db, visibleRows.map((row) => row.actor_id))
    return res.json({
      notifications: visibleRows.map((n) => ({
        id: n.id, type: n.type,
        actor: {
          id: n.actor_id || 'system', name: n.actor_name || '系统通知', avatar: n.actor_avatar,
          ...getDecorationIdentity(
            {
              avatar_frame: n.actor_avatar_frame,
              avatar_overlay: n.actor_avatar_overlay,
              equipped_title: n.actor_equipped_title,
            },
            getLevelInfo(n.actor_xp || 0),
            achievementMap.get(n.actor_id),
          ),
        },
        message: n.message, targetType: n.target_type, targetId: n.target_id,
        isRead: Boolean(n.is_read), createdAt: n.created_at,
      })),
      unreadCount: countRow?.unread || 0,
      total: countRow?.total || 0,
      page, pageSize,
      nextCursor,
    })
  } catch (error) {
    console.error('Failed to list notifications:', error)
    return res.status(500).json({ message: '获取通知失败' })
  }
}

export const getNotificationsUnreadCount = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const row = await db.get(`SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0`, user.id)
    return res.json({ unreadCount: row?.count || 0 })
  } catch (error) {
    console.error('Failed to count notifications:', error)
    return res.status(500).json({ message: '获取未读通知失败' })
  }
}

export const markNotificationsRead = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const { id, all } = req.body || {}
    if (all === true) {
      await db.run(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`, user.id)
    } else if (id) {
      const notificationId = Number(id)
      if (!Number.isSafeInteger(notificationId) || notificationId <= 0) return res.status(400).json({ message: '无效的通知 ID' })
      await db.run(`UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`, notificationId, user.id)
    } else {
      return res.status(400).json({ message: '缺少参数' })
    }
    const row = await db.get(`SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0`, user.id)
    return res.json({ success: true, unreadCount: row?.count || 0 })
  } catch (error) {
    console.error('Failed to mark notifications read:', error)
    return res.status(500).json({ message: '操作失败' })
  }
}
