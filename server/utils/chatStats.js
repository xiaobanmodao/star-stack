import { localDay } from './dateHelpers.js'

const CHAT_ACHIEVEMENT_DEFS = [
  { type: 'chat_first', name: '初次发声', icon: '💬', desc: '发出第一条聊天消息', check: (s) => s.message_count >= 1 },
  { type: 'chat_100', name: '话痨新星', icon: '🗣️', desc: '累计发送 100 条消息', check: (s) => s.message_count >= 100 },
  { type: 'chat_1000', name: '深空电台', icon: '📡', desc: '累计发送 1000 条消息', check: (s) => s.message_count >= 1000 },
  { type: 'chat_reply_50', name: '接话大师', icon: '↩️', desc: '累计回复 50 条话题线程', check: (s) => s.reply_count >= 50 },
  { type: 'chat_active_10', name: '常驻旅客', icon: '🌙', desc: '累计活跃 10 天', check: (s) => s.active_days >= 10 },
  { type: 'chat_active_30', name: '星际公民', icon: '🪐', desc: '累计活跃 30 天', check: (s) => s.active_days >= 30 },
  { type: 'chat_liked_10', name: '人气磁铁', icon: '🧲', desc: '累计收到 10 个表情回应', check: (s) => s.reaction_received >= 10 },
  { type: 'chat_liked_100', name: '全站红人', icon: '🌟', desc: '累计收到 100 个表情回应', check: (s) => s.reaction_received >= 100 },
  { type: 'chat_post_5', name: '广场作家', icon: '✍️', desc: '累计发布 5 篇帖子', check: (s) => s.post_count >= 5 },
]

const countActiveDays = async (db, userId) => {
  const row = await db.get(
    `SELECT COUNT(*) as c FROM (SELECT DISTINCT day FROM chat_activity_log WHERE user_id = ?)`, userId
  )
  return row?.c || 0
}

export const CHAT_ACHIEVEMENT_DEFS_PUBLIC = CHAT_ACHIEVEMENT_DEFS

export const touchChatActivity = async (db, userId) => {
  try {
    const day = localDay()
    await db.run(
      `INSERT OR IGNORE INTO chat_activity_log (user_id, day, score) VALUES (?, ?, 0)`,
      userId, day
    )
    await db.run(
      `INSERT INTO chat_stats (user_id, message_count, reply_count, post_count, comment_count, reaction_received, activity_score, last_active_at)
       VALUES (?, 0, 0, 0, 0, 0, 0, ?)
       ON CONFLICT(user_id) DO UPDATE SET last_active_at = excluded.last_active_at`,
      userId, new Date().toISOString()
    )
    const activeDays = await countActiveDays(db, userId)
    for (const def of CHAT_ACHIEVEMENT_DEFS) {
      if (def.type.startsWith('chat_active') && def.check({ active_days: activeDays })) {
        await db.run(
          `INSERT OR IGNORE INTO chat_achievements (user_id, type, unlocked_at) VALUES (?, ?, ?)`,
          userId, def.type, new Date().toISOString()
        )
      }
    }
  } catch { /* 忽略 */ }
}

export const countActiveDaysPublic = countActiveDays

export const bumpChatStat = async (db, userId, { field, points }) => {
  if (!userId) return
  try {
    await db.run(
      `INSERT INTO chat_stats (user_id, message_count, reply_count, post_count, comment_count, reaction_received, activity_score, last_active_at)
       VALUES (?, 0, 0, 0, 0, 0, 0, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         ${field} = ${field} + 1,
         activity_score = activity_score + ?,
         last_active_at = excluded.last_active_at`,
      userId, new Date().toISOString(), points
    )
    const day = localDay()
    await db.run(
      `INSERT INTO chat_activity_log (user_id, day, score) VALUES (?, ?, ?)
       ON CONFLICT(user_id, day) DO UPDATE SET score = score + excluded.score`,
      userId, day, points
    )
    const statRow = await db.get(`SELECT * FROM chat_stats WHERE user_id = ?`, userId)
    if (!statRow) return
    const activeDays = await countActiveDays(db, userId)
    const stats = { ...statRow, active_days: activeDays }
    for (const def of CHAT_ACHIEVEMENT_DEFS) {
      if (def.check(stats)) {
        await db.run(
          `INSERT OR IGNORE INTO chat_achievements (user_id, type, unlocked_at) VALUES (?, ?, ?)`,
          userId, def.type, new Date().toISOString()
        )
      }
    }
  } catch (error) {
    console.error('Failed to bump chat stat:', error)
  }
}
