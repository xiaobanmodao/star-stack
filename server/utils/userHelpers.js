import { getLevelInfo } from '../stats.js'
import { getDecorationIdentity, getUnlockedAchievementTypes } from './decorations.js'
import { sanitizeHtml } from './htmlFilter.js'
import { getPracticeRating } from './rating.js'

export const sanitizeProblemText = (value) => sanitizeHtml(String(value ?? '').trim())

export const getUserLevelInfo = async (db, userId) => {
  const row = await db.get(`SELECT xp FROM user_stats WHERE user_id = ?`, userId)
  return getLevelInfo(row?.xp || 0)
}

export const addXp = async (db, userId, amount) => {
  if (!userId || !amount) return null
  await db.run(
    `INSERT INTO user_stats (user_id, xp) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET xp = xp + excluded.xp`,
    userId,
    amount
  )
  return getUserLevelInfo(db, userId)
}

export const serializeUser = async (db, user) => {
  const [levelInfo, achievementTypes] = await Promise.all([
    getUserLevelInfo(db, user.id),
    getUnlockedAchievementTypes(db, user.id),
  ])
  const decoration = getDecorationIdentity(user, levelInfo, achievementTypes)
  return {
    id: user.id,
    name: user.name,
    email: user.email || null,
    avatar: user.avatar,
    isAdmin: Boolean(user.is_admin),
    isBanned: Boolean(user.is_banned),
    rating: getPracticeRating(user.rating),
    onboarded: Boolean(user.onboarded_at),
    ...levelInfo,
    ...decoration,
  }
}
