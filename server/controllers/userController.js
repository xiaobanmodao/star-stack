import { getDb } from '../db.js'
import { getAuthToken, getUserByToken, requireUser } from '../middleware/auth.js'
import { getUserLevelInfo } from '../utils/userHelpers.js'
import { getLevelInfo, getDifficultyStats, getHeatmapData, ACHIEVEMENTS } from '../stats.js'
import { getFollowRelations } from '../utils/socialHelpers.js'
import { localDay } from '../utils/dateHelpers.js'

export const getUserProfile = async (req, res) => {
  try {
    const db = await getDb()
    const userId = req.params.userId
    const user = await db.get(
      `SELECT id, name, avatar, created_at, is_admin FROM users WHERE id = ?`, userId
    )
    if (!user) return res.status(404).json({ message: '用户不存在' })

    let stats = await db.get(`SELECT * FROM user_stats WHERE user_id = ?`, userId)
    if (!stats) {
      await db.run(
        `INSERT INTO user_stats (user_id, total_submissions, accepted_count, tried_problems, solved_problems, acceptance_rate, current_streak, max_streak, last_submission_date, rank)
         VALUES (?, 0, 0, 0, 0, 0, 0, 0, NULL, 0)`,
        userId
      )
      stats = await db.get(`SELECT * FROM user_stats WHERE user_id = ?`, userId)
    }

    const difficultyStats = await getDifficultyStats(db, userId)
    const levelInfo = getLevelInfo(stats.xp || 0)

    return res.json({
      user: {
        id: user.id, name: user.name, avatar: user.avatar,
        createdAt: user.created_at, isAdmin: user.is_admin === 1, ...levelInfo,
      },
      stats: {
        totalSubmissions: stats.total_submissions,
        acceptedCount: stats.accepted_count,
        triedProblems: stats.tried_problems,
        solvedProblems: stats.solved_problems,
        acceptanceRate: stats.acceptance_rate,
        currentStreak: stats.current_streak,
        maxStreak: stats.max_streak,
        xp: stats.xp || 0,
        rank: stats.rank,
      },
      difficultyStats,
    })
  } catch (error) {
    console.error('Failed to get user profile:', error)
    return res.status(500).json({ message: '获取用户资料失败' })
  }
}

export const getUserHeatmap = async (req, res) => {
  try {
    const db = await getDb()
    const userId = req.params.userId
    const user = await db.get(`SELECT id FROM users WHERE id = ?`, userId)
    if (!user) return res.status(404).json({ message: '用户不存在' })
    const heatmap = await getHeatmapData(db, userId)
    return res.json({ heatmap })
  } catch (error) {
    console.error('Failed to get heatmap:', error)
    return res.status(500).json({ message: '获取热力图数据失败' })
  }
}

export const getRatingHistory = async (req, res) => {
  try {
    const db = await getDb()
    const userId = req.params.userId
    const user = await db.get(`SELECT id FROM users WHERE id = ?`, userId)
    if (!user) return res.status(404).json({ message: '用户不存在' })
    const rows = await db.all(
      `SELECT recorded_at as date, value as rating
       FROM leaderboard_history
       WHERE user_id = ? AND period_type = 'total'
       ORDER BY recorded_at DESC LIMIT 30`,
      userId
    )
    return res.json({ history: rows.reverse() })
  } catch (error) {
    console.error('Failed to get rating history:', error)
    return res.status(500).json({ message: '获取Rating历史失败' })
  }
}

export const getWeeklyStats = async (req, res) => {
  try {
    const db = await getDb()
    const userId = req.params.userId
    const user = await db.get(`SELECT id FROM users WHERE id = ?`, userId)
    if (!user) return res.status(404).json({ message: '用户不存在' })

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tenDaysAgo = new Date(today)
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 9)

    const startDate = localDay(tenDaysAgo)
    const endDate = localDay(today)

    const activities = await db.all(
      `SELECT activity_date, submission_count, accepted_count
       FROM daily_activity
       WHERE user_id = ? AND activity_date >= ? AND activity_date <= ?
       ORDER BY activity_date ASC`,
      [userId, startDate, endDate]
    )

    const activityMap = new Map()
    activities.forEach(a => {
      activityMap.set(a.activity_date, { submissions: a.submission_count, accepted: a.accepted_count })
    })

    const weeklyStats = []
    for (let i = 0; i < 10; i++) {
      const date = new Date(tenDaysAgo)
      date.setDate(date.getDate() + i)
      const dateStr = date.toISOString().split('T')[0]
      const activity = activityMap.get(dateStr)
      weeklyStats.push({ date: dateStr, submissions: activity?.submissions || 0, accepted: activity?.accepted || 0 })
    }

    return res.json({ weeklyStats })
  } catch (error) {
    console.error('Failed to get weekly stats:', error)
    return res.status(500).json({ message: '获取周统计数据失败' })
  }
}

export const getUserAchievements = async (req, res) => {
  try {
    const db = await getDb()
    const userId = req.params.userId
    const user = await db.get(`SELECT id FROM users WHERE id = ?`, userId)
    if (!user) return res.status(404).json({ message: '用户不存在' })

    const achievements = await db.all(
      `SELECT achievement_type, achievement_data, unlocked_at
       FROM user_achievements WHERE user_id = ? ORDER BY unlocked_at DESC`,
      userId
    )
    const formattedAchievements = achievements.map(a => ({
      type: a.achievement_type,
      name: ACHIEVEMENTS[a.achievement_type.toUpperCase()]?.name || a.achievement_type,
      icon: ACHIEVEMENTS[a.achievement_type.toUpperCase()]?.icon || '🏅',
      desc: ACHIEVEMENTS[a.achievement_type.toUpperCase()]?.desc || '',
      unlockedAt: a.unlocked_at,
      data: a.achievement_data ? JSON.parse(a.achievement_data) : {},
    }))
    return res.json({ achievements: formattedAchievements })
  } catch (error) {
    console.error('Failed to get achievements:', error)
    return res.status(500).json({ message: '获取成就数据失败' })
  }
}

export const getSocialProfile = async (req, res) => {
  try {
    const db = await getDb()
    const targetId = req.params.id
    const target = await db.get(
      `SELECT id, name, avatar, is_admin, bio, created_at FROM users WHERE id = ?`, targetId
    )
    if (!target) return res.status(404).json({ message: '用户不存在' })

    const token = getAuthToken(req)
    let viewer = null
    if (token) viewer = await getUserByToken(db, token)
    if (viewer && viewer.id !== targetId) {
      const blocked = await db.get(
        `SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?`, targetId, viewer.id
      )
      if (blocked) return res.status(403).json({ message: '对方已屏蔽你，无法查看该档案' })
    }
    const relations = viewer
      ? await getFollowRelations(db, viewer.id, targetId)
      : { following: false, followedBy: false, isFriend: false, followerCount: 0, followingCount: 0 }
    const blockedByViewer = viewer ? Boolean(await db.get(
      `SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?`, viewer.id, targetId
    )) : false

    const statsRow = await db.get(`SELECT xp FROM user_stats WHERE user_id = ?`, targetId)
    const levelInfo = getLevelInfo(statsRow?.xp || 0)

    return res.json({
      user: {
        id: target.id, name: target.name, avatar: target.avatar,
        isAdmin: Boolean(target.is_admin), bio: target.bio || '', createdAt: target.created_at,
        ...levelInfo,
      },
      relations,
      blocked: blockedByViewer,
    })
  } catch (error) {
    console.error('Failed to get user profile:', error)
    return res.status(500).json({ message: '获取用户档案失败' })
  }
}

export const updateBio = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    const { bio } = req.body || {}
    const cleanBio = String(bio ?? '').trim().slice(0, 200)
    await db.run(`UPDATE users SET bio = ? WHERE id = ?`, cleanBio, user.id)
    return res.json({ message: '简介已更新', bio: cleanBio })
  } catch (error) {
    console.error('Failed to update bio:', error)
    return res.status(500).json({ message: '更新失败' })
  }
}

export const markOnboarded = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  const { db, user } = auth
  try {
    await db.run(
      `UPDATE users SET onboarded_at = ? WHERE id = ?`, new Date().toISOString(), user.id
    )
    return res.json({ success: true, onboarded: true })
  } catch (error) {
    console.error('Failed to mark onboarding done:', error)
    return res.status(500).json({ message: '操作失败' })
  }
}
