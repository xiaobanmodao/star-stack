import webpush from 'web-push'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { getDb } from '../db.js'
import { requireUser } from '../middleware/auth.js'

let vapidKeys = null
const getVapidKeys = () => {
  if (vapidKeys) return vapidKeys
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapidKeys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY }
    return vapidKeys
  }
  const filePath = new URL('../.vapid.json', import.meta.url).pathname
  if (existsSync(filePath)) {
    vapidKeys = JSON.parse(readFileSync(filePath, 'utf8'))
    return vapidKeys
  }
  const generated = webpush.generateVAPIDKeys()
  writeFileSync(filePath, JSON.stringify(generated, null, 2))
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
    if (!subscription?.endpoint || !subscription?.keys) return res.status(400).json({ message: '无效的订阅信息' })
    await db.run(
      `INSERT OR REPLACE INTO push_subscriptions (user_id, endpoint, keys_json, created_at) VALUES (?, ?, ?, ?)`,
      user.id, subscription.endpoint, JSON.stringify(subscription.keys), new Date().toISOString()
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
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize) || 20))
    const offset = (page - 1) * pageSize
    const rows = await db.all(
      `SELECT n.*, u.name as actor_name, u.avatar as actor_avatar
       FROM notifications n LEFT JOIN users u ON n.actor_id = u.id
       WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT ? OFFSET ?`,
      user.id, pageSize, offset
    )
    const countRow = await db.get(
      `SELECT COUNT(*) as total, SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread FROM notifications WHERE user_id = ?`,
      user.id
    )
    return res.json({
      notifications: rows.map((n) => ({
        id: n.id, type: n.type,
        actor: { id: n.actor_id, name: n.actor_name, avatar: n.actor_avatar },
        message: n.message, targetType: n.target_type, targetId: n.target_id,
        isRead: Boolean(n.is_read), createdAt: n.created_at,
      })),
      unreadCount: countRow?.unread || 0,
      total: countRow?.total || 0,
      page, pageSize,
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
    if (all) {
      await db.run(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`, user.id)
    } else if (id) {
      await db.run(`UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`, parseInt(id), user.id)
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
