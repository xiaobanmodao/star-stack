import webpush from 'web-push'

const sendPushToUser = async (db, userId, { title, body, url }) => {
  try {
    const subs = await db.all(
      `SELECT endpoint, keys_json FROM push_subscriptions WHERE user_id = ?`, userId
    )
    if (subs.length === 0) return
    const payload = JSON.stringify({ title, body, url })
    for (const sub of subs) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: JSON.parse(sub.keys_json) }, payload)
      } catch (error) {
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          await db.run(`DELETE FROM push_subscriptions WHERE endpoint = ?`, sub.endpoint)
        }
      }
    }
  } catch {
    // 推送失败不影响主流程
  }
}

export const createNotification = async (db, { userId, actorId, type, targetType, targetId, message, push, allowSelf = false }) => {
  if (!userId || (userId === actorId && !allowSelf)) return
  try {
    await db.run(
      `INSERT INTO notifications (user_id, actor_id, type, target_type, target_id, message, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      userId, actorId, type, targetType || null, targetId || null, message, new Date().toISOString()
    )
    if (push) {
      const actor = await db.get(`SELECT name FROM users WHERE id = ?`, actorId)
      await sendPushToUser(db, userId, {
        title: push.title,
        body: `${actor?.name || '有人'} ${push.body}`,
        url: push.url,
      })
    }
  } catch (error) {
    console.error('Failed to create notification:', error)
  }
}

const MENTION_RE = /@([a-zA-Z0-9_-]{1,32})/g

export const notifyMentions = async (db, text, actorId, type, targetType, targetId, messageBuilder) => {
  const ids = new Set()
  let match
  const regex = new RegExp(MENTION_RE.source, 'g')
  while ((match = regex.exec(text)) !== null) ids.add(match[1])
  const mentionUrl = targetType === 'room'
    ? `/chat/room/${targetId}`
    : targetType === 'channel'
      ? `/chat/c/${targetId}`
      : `/chat/p/${targetId}`
  for (const id of ids) {
    if (id === actorId) continue
    const target = await db.get(`SELECT id FROM users WHERE id = ? AND is_banned = 0`, id)
    if (!target) continue
    await createNotification(db, {
      userId: id, actorId, type, targetType, targetId,
      message: messageBuilder(id),
      push: { title: '@提及', body: messageBuilder(id), url: mentionUrl },
    })
  }
}
