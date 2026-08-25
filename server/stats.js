// 站内等级（星空主题，按累计 XP 升级）
import { createNotification } from './utils/notifications.js'

export const LEVELS = [
  { minXp: 0, title: '星尘', icon: '✦' },
  { minXp: 100, title: '流星', icon: '☄️' },
  { minXp: 300, title: '新星', icon: '🌟' },
  { minXp: 700, title: '行星', icon: '🪐' },
  { minXp: 1500, title: '恒星', icon: '☀️' },
  { minXp: 3000, title: '超新星', icon: '💥' },
  { minXp: 6000, title: '黑洞', icon: '🕳️' },
]

export const getLevelInfo = (xp = 0) => {
  let levelIndex = 0
  for (let i = 0; i < LEVELS.length; i++) {
    if (xp >= LEVELS[i].minXp) levelIndex = i
  }
  const current = LEVELS[levelIndex]
  const next = LEVELS[levelIndex + 1] || null
  return {
    xp,
    level: levelIndex + 1,
    title: current.title,
    icon: current.icon,
    nextTitle: next?.title || null,
    nextXp: next?.minXp ?? null,
    progress: next
      ? Math.min(100, Math.round(((xp - current.minXp) / (next.minXp - current.minXp)) * 100))
      : 100,
  }
}

// Achievement definitions
const ACHIEVEMENTS = {
  FIRST_AC: { id: 'first_ac', name: '初次通过', icon: '🎯', desc: '完成第一道题目' },
  STREAK_7: { id: 'streak_7', name: '连续打卡7天', icon: '🔥', desc: '连续7天提交代码' },
  STREAK_30: { id: 'streak_30', name: '连续打卡30天', icon: '⚡', desc: '连续30天提交代码' },
  STREAK_100: { id: 'streak_100', name: '连续打卡100天', icon: '💎', desc: '连续100天提交代码' },
  SOLVED_10: { id: 'solved_10', name: '初出茅庐', icon: '🌱', desc: '通过10道题目' },
  SOLVED_50: { id: 'solved_50', name: '小有所成', icon: '🌿', desc: '通过50道题目' },
  SOLVED_100: { id: 'solved_100', name: '登堂入室', icon: '🌳', desc: '通过100道题目' },
  ALL_DIFFICULTY: { id: 'all_difficulty', name: '全难度通关', icon: '🏆', desc: '每个难度至少通过一题' },
  PERFECT_SOLVE: { id: 'perfect_solve', name: '完美主义者', icon: '✨', desc: '某题一次AC' },
  NIGHT_OWL: { id: 'night_owl', name: '夜猫子', icon: '🦉', desc: '在凌晨0-6点提交' },
  EARLY_BIRD: { id: 'early_bird', name: '早起鸟', icon: '🐦', desc: '在早晨6-9点提交' }
}

// 按本地时区解析 YYYY-MM-DD（new Date('2026-08-16') 是 UTC 解析，会差一天）
const parseLocalDate = (str) => {
  const [y, m, d] = String(str).split('-').map(Number)
  return new Date(y, m - 1, d)
}

/**
 * Update user statistics after a submission
 */
async function updateUserStats(db, userId) {
  // 统计钩子可能因服务重启或网络重试重复触发，因此这里按提交记录重建聚合值，
  // 不使用“+1”累加，避免统计、打卡和成就数据被重复计算。
  await db.run(
    `INSERT OR IGNORE INTO user_stats (user_id, total_submissions, accepted_count, tried_problems, solved_problems, acceptance_rate, current_streak, max_streak, last_submission_date, rank)
     VALUES (?, 0, 0, 0, 0, 0, 0, 0, NULL, 0)`,
    userId,
  )

  await db.run(
    `INSERT OR IGNORE INTO solved_problems (user_id, problem_id, difficulty, first_solved_at)
     SELECT s.user_id, s.problem_id, COALESCE(p.difficulty, 'Medium'), MIN(s.created_at)
     FROM submissions s
     LEFT JOIN problems p ON p.id = s.problem_id
     WHERE s.user_id = ? AND s.status = 'Accepted'
     GROUP BY s.user_id, s.problem_id`,
    userId,
  )

  const aggregate = await db.get(
    `SELECT COUNT(*) AS total_submissions,
            SUM(CASE WHEN status = 'Accepted' THEN 1 ELSE 0 END) AS accepted_count,
            COUNT(DISTINCT problem_id) AS tried_problems,
            MAX(created_at) AS last_submission_date
     FROM submissions
     WHERE user_id = ? AND status NOT IN ('Queued', 'Judging', 'Cancelled')`,
    userId,
  )
  const triedProblems = aggregate?.tried_problems || 0
  const solved = await db.get(`SELECT COUNT(*) AS count FROM solved_problems WHERE user_id = ?`, userId)
  const acceptedCount = aggregate?.accepted_count || 0
  const totalSubmissions = aggregate?.total_submissions || 0
  const acceptanceRate = totalSubmissions > 0 ? (acceptedCount / totalSubmissions) * 100 : 0
  const lastSubmissionDate = aggregate?.last_submission_date || null

  await db.run(
    `UPDATE user_stats
     SET total_submissions = ?, accepted_count = ?, tried_problems = ?, solved_problems = ?,
         acceptance_rate = ?, last_submission_date = ?
     WHERE user_id = ?`,
    totalSubmissions,
    acceptedCount,
    triedProblems,
    solved?.count || 0,
    acceptanceRate,
    lastSubmissionDate,
    userId,
  )

  // solved_problems 是首 AC 的唯一记录，按它重算 rating 也能修复历史重复累加。
  await recalculateUserRating(db, userId)

  await db.run(`DELETE FROM daily_activity WHERE user_id = ?`, userId)
  await db.run(
    `INSERT OR REPLACE INTO daily_activity (user_id, activity_date, submission_count, accepted_count)
     SELECT user_id, strftime('%Y-%m-%d', created_at, 'localtime'), COUNT(*),
            SUM(CASE WHEN status = 'Accepted' THEN 1 ELSE 0 END)
     FROM submissions
     WHERE user_id = ? AND status NOT IN ('Queued', 'Judging', 'Cancelled')
     GROUP BY user_id, strftime('%Y-%m-%d', created_at, 'localtime')`,
    userId,
  )

  await calculateStreak(db, userId)
}

/**
 * Calculate user's current and max streak
 */
async function calculateStreak(db, userId) {
  // 连击只统计有 AC 的日子（任意 AC 一题即算打卡）
  const activities = await db.all(
    `SELECT activity_date FROM daily_activity
     WHERE user_id = ? AND accepted_count > 0
     ORDER BY activity_date DESC`,
    userId
  )

  if (activities.length === 0) {
    await db.run(
      `UPDATE user_stats SET current_streak = 0, max_streak = 0 WHERE user_id = ?`,
      userId
    )
    return
  }

  let currentStreak = 0
  let maxStreak = 0
  let tempStreak = 0
  let expectedDate = new Date()
  expectedDate.setHours(0, 0, 0, 0)
  // 今天尚未打卡时，允许连击起点是昨天（今天还可补卡）；一旦跨过该缺口，后续必须严格逐日连续
  let allowYesterdayGap = true

  for (const activity of activities) {
    const activityDate = parseLocalDate(activity.activity_date)
    const diffDays = Math.floor((expectedDate - activityDate) / (1000 * 60 * 60 * 24))

    if (diffDays === 0) {
      tempStreak++
      allowYesterdayGap = false // 今天已打卡，后续必须严格逐日连续
      expectedDate = new Date(activityDate)
      expectedDate.setDate(expectedDate.getDate() - 1)
    } else if (diffDays === 1 && allowYesterdayGap) {
      // 第一个活动是昨天（今天未打卡）→ 算入连击，之后必须严格连续
      tempStreak++
      expectedDate = new Date(activityDate)
      expectedDate.setDate(expectedDate.getDate() - 1)
      allowYesterdayGap = false
    } else {
      break
    }
  }
  currentStreak = tempStreak

  // Calculate max streak
  tempStreak = 1
  for (let i = 0; i < activities.length - 1; i++) {
    const date1 = parseLocalDate(activities[i].activity_date)
    const date2 = parseLocalDate(activities[i + 1].activity_date)
    const diffDays = Math.floor((date1 - date2) / (1000 * 60 * 60 * 24))

    if (diffDays === 1) {
      tempStreak++
      maxStreak = Math.max(maxStreak, tempStreak)
    } else {
      tempStreak = 1
    }
  }
  maxStreak = Math.max(maxStreak, tempStreak, currentStreak)

  await db.run(
    `UPDATE user_stats SET current_streak = ?, max_streak = ? WHERE user_id = ?`,
    currentStreak,
    maxStreak,
    userId
  )
}

/**
 * Check and unlock achievements for a user
 */
async function checkAndUnlockAchievements(db, userId, submission) {
  const stats = await db.get(`SELECT * FROM user_stats WHERE user_id = ?`, userId)
  const existingAchievements = await db.all(
    `SELECT achievement_type FROM user_achievements WHERE user_id = ?`,
    userId
  )
  const unlockedTypes = new Set(existingAchievements.map(a => a.achievement_type))
  const now = new Date().toISOString()
  const newAchievements = []

  // First AC
  if (submission.status === 'Accepted' && stats.solved_problems === 1 && !unlockedTypes.has('first_ac')) {
    newAchievements.push({ type: 'first_ac', data: { problemId: submission.problemId } })
  }

  // Solved milestones
  if (stats.solved_problems >= 10 && !unlockedTypes.has('solved_10')) {
    newAchievements.push({ type: 'solved_10', data: { count: stats.solved_problems } })
  }
  if (stats.solved_problems >= 50 && !unlockedTypes.has('solved_50')) {
    newAchievements.push({ type: 'solved_50', data: { count: stats.solved_problems } })
  }
  if (stats.solved_problems >= 100 && !unlockedTypes.has('solved_100')) {
    newAchievements.push({ type: 'solved_100', data: { count: stats.solved_problems } })
  }

  // Streak achievements
  if (stats.current_streak >= 7 && !unlockedTypes.has('streak_7')) {
    newAchievements.push({ type: 'streak_7', data: { streak: stats.current_streak } })
  }
  if (stats.current_streak >= 30 && !unlockedTypes.has('streak_30')) {
    newAchievements.push({ type: 'streak_30', data: { streak: stats.current_streak } })
  }
  if (stats.current_streak >= 100 && !unlockedTypes.has('streak_100')) {
    newAchievements.push({ type: 'streak_100', data: { streak: stats.current_streak } })
  }

  // All difficulty achievement - 完成题库中所有存在的难度等级各一题
  if (!unlockedTypes.has('all_difficulty')) {
    const difficulties = await db.all(
      `SELECT DISTINCT difficulty FROM solved_problems WHERE user_id = ?`,
      userId
    )
    const allDifficulties = await db.all(
      `SELECT DISTINCT difficulty FROM problems`
    )

    // 如果用户解决的难度种类数等于题库中的难度种类数，解锁成就
    if (difficulties.length > 0 && difficulties.length >= allDifficulties.length) {
      newAchievements.push({ type: 'all_difficulty', data: {} })
    }
  }

  // Perfect solve (first submission AC)
  if (submission.status === 'Accepted' && !unlockedTypes.has('perfect_solve')) {
    const prevSubmissions = await db.get(
      `SELECT COUNT(*) as count FROM submissions
       WHERE user_id = ? AND problem_id = ? AND id < ?`,
      userId,
      submission.problemId,
      submission.id
    )
    if (prevSubmissions.count === 0) {
      newAchievements.push({ type: 'perfect_solve', data: { problemId: submission.problemId } })
    }
  }

  // Time-based achievements
  const hour = new Date(submission.createdAt || now).getHours()
  if (hour >= 0 && hour < 6 && !unlockedTypes.has('night_owl')) {
    newAchievements.push({ type: 'night_owl', data: { hour } })
  }
  if (hour >= 6 && hour < 9 && !unlockedTypes.has('early_bird')) {
    newAchievements.push({ type: 'early_bird', data: { hour } })
  }

  // Insert new achievements
  for (const achievement of newAchievements) {
    const insertResult = await db.run(
      `INSERT OR IGNORE INTO user_achievements (user_id, achievement_type, achievement_data, unlocked_at)
       VALUES (?, ?, ?, ?)`,
      userId,
      achievement.type,
      JSON.stringify(achievement.data),
      now
    )
    if (insertResult?.changes > 0) {
      const definition = ACHIEVEMENTS[achievement.type.toUpperCase()]
      await createNotification(db, {
        userId,
        actorId: userId,
        type: 'achievement.unlocked',
        targetType: 'achievement',
        message: `解锁成就「${definition?.name || achievement.type}」`,
        allowSelf: true,
      })
    }
  }

  return newAchievements
}

/**
 * Update global rankings — 使用单条 SQL 批量更新，避免 O(n) 次写入
 * 带节流：最多每 30 秒执行一次
 */
let _lastRankingUpdate = 0
const RANKING_THROTTLE_MS = 30000

async function updateRankings(db) {
  const now = Date.now()
  if (now - _lastRankingUpdate < RANKING_THROTTLE_MS) return

  // 单条 SQL 批量更新排名
  await db.run(
    `UPDATE user_stats SET rank = (
       SELECT COUNT(DISTINCT u2.rating) + 1
       FROM user_stats us2
       JOIN users u2 ON us2.user_id = u2.id
       WHERE u2.is_banned = 0 AND us2.total_submissions > 0
         AND u2.rating > (SELECT rating FROM users WHERE id = user_stats.user_id)
     )
     WHERE user_id IN (
       SELECT us.user_id FROM user_stats us
       JOIN users u ON us.user_id = u.id
       WHERE u.is_banned = 0 AND us.total_submissions > 0
     )`
  )

  // 被封禁用户排名清零
  await db.run(
    `UPDATE user_stats SET rank = 0
     WHERE user_id IN (SELECT id FROM users WHERE is_banned = 1)`
  )
  _lastRankingUpdate = now
}

/**
 * Get difficulty statistics for a user
 */
async function getDifficultyStats(db, userId) {
  // 获取数据库中实际存在的所有难度
  const allDifficulties = await db.all(
    `SELECT DISTINCT difficulty FROM problems ORDER BY difficulty`
  )

  const stats = {}

  for (const row of allDifficulties) {
    const difficulty = row.difficulty

    const solved = await db.get(
      `SELECT COUNT(*) as count FROM solved_problems
       WHERE user_id = ? AND difficulty = ?`,
      userId,
      difficulty
    )

    const tried = await db.get(
      `SELECT COUNT(DISTINCT s.problem_id) as count
       FROM submissions s
       JOIN problems p ON s.problem_id = p.id
       WHERE s.user_id = ? AND p.difficulty = ?`,
      userId,
      difficulty
    )

    stats[difficulty] = {
      solved: solved.count,
      tried: tried.count
    }
  }

  return stats
}

/**
 * Get heatmap data for the past 365 days
 */
async function getHeatmapData(db, userId) {
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 365)

  const activities = await db.all(
    `SELECT activity_date, submission_count, accepted_count
     FROM daily_activity
     WHERE user_id = ? AND activity_date >= ? AND activity_date <= ?
     ORDER BY activity_date ASC`,
    userId,
    startDate.toISOString().split('T')[0],
    endDate.toISOString().split('T')[0]
  )

  const activityMap = new Map()
  activities.forEach(a => {
    activityMap.set(a.activity_date, {
      count: a.submission_count,
      accepted: a.accepted_count
    })
  })

  // Fill in all dates
  const heatmap = []
  const currentDate = new Date(startDate)
  while (currentDate <= endDate) {
    const dateStr = currentDate.toISOString().split('T')[0]
    const activity = activityMap.get(dateStr)
    heatmap.push({
      date: dateStr,
      count: activity?.count || 0,
      accepted: activity?.accepted || 0
    })
    currentDate.setDate(currentDate.getDate() + 1)
  }

  return heatmap
}

/**
 * Recalculate rating for a single user based on their solved problems
 */
async function recalculateUserRating(db, userId) {
  const ratingMap = {
    '入门': 0.05,
    '普及-': 0.1,
    '普及': 0.2,
    '提高-': 0.3,
    '提高': 0.4,
    '省选': 0.5,
    'noi': 0.6
  }

  // Get all solved problems with their difficulties
  const solvedProblems = await db.all(
    `SELECT difficulty FROM solved_problems WHERE user_id = ?`,
    userId
  )

  // Calculate total rating
  let totalRating = 0
  for (const problem of solvedProblems) {
    const difficulty = problem.difficulty
    totalRating += ratingMap[difficulty] || 0.1
  }

  // Update user rating
  await db.run(
    `UPDATE users SET rating = ? WHERE id = ?`,
    totalRating,
    userId
  )

  return totalRating
}

export {
  ACHIEVEMENTS,
  updateUserStats,
  calculateStreak,
  checkAndUnlockAchievements,
  updateRankings,
  getDifficultyStats,
  getHeatmapData,
  recalculateUserRating
}
