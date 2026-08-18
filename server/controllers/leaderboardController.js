import { getDb } from '../db.js'
import { getAuthToken, getUserByToken } from '../middleware/auth.js'

function getWeekRange() {
  const now = new Date()
  const dayOfWeek = now.getDay()
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const monday = new Date(now)
  monday.setDate(now.getDate() - diff)
  monday.setHours(0, 0, 0, 0)
  const nextMonday = new Date(monday)
  nextMonday.setDate(monday.getDate() + 7)
  return { startDate: monday.toISOString(), endDate: nextMonday.toISOString() }
}

function getMonthRange() {
  const now = new Date()
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
  firstDay.setHours(0, 0, 0, 0)
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  nextMonth.setHours(0, 0, 0, 0)
  return { startDate: firstDay.toISOString(), endDate: nextMonth.toISOString() }
}

function getPreviousPeriodKey(type) {
  const now = new Date()
  if (type === 'total') {
    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)
    return yesterday.toISOString().split('T')[0]
  } else if (type === 'weekly') {
    const dayOfWeek = now.getDay()
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1
    const thisMonday = new Date(now)
    thisMonday.setDate(now.getDate() - diff)
    const lastMonday = new Date(thisMonday)
    lastMonday.setDate(thisMonday.getDate() - 7)
    return lastMonday.toISOString().split('T')[0]
  } else if (type === 'monthly') {
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    return lastMonth.toISOString().split('T')[0]
  }
  return null
}

export const getLeaderboard = async (req, res) => {
  try {
    const db = await getDb()
    const page = Math.max(Number(req.query.page) || 1, 1)
    const perPage = Math.min(Math.max(Number(req.query.perPage) || 20, 1), 100)
    const offset = (page - 1) * perPage
    const type = req.query.type || 'total'

    let leaderboard = []
    let total = 0
    let currentUser = null
    let periodStart = null
    let periodEnd = null
    const token = getAuthToken(req)
    const user = token ? await getUserByToken(db, token) : null

    const previousPeriodKey = getPreviousPeriodKey(type)
    const applyHistoryRankChanges = async (entries, periodType) => {
      if (!Array.isArray(entries) || entries.length === 0 || !previousPeriodKey) return
      const userIds = [...new Set(entries.map((e) => e.user_id).filter(Boolean))]
      if (userIds.length === 0) return
      const placeholders = userIds.map(() => '?').join(', ')
      const rows = await db.all(
        `SELECT user_id, rank FROM leaderboard_history
         WHERE period_type = ? AND period_key = ? AND user_id IN (${placeholders})`,
        periodType, previousPeriodKey, ...userIds
      )
      const historyMap = new Map(rows.map((row) => [row.user_id, row.rank]))
      for (const entry of entries) {
        const previousRank = historyMap.get(entry.user_id) ?? null
        entry.previousRank = previousRank
        entry.rankChange = previousRank === null ? null : entry.rank - previousRank
      }
    }

    if (type === 'total') {
      const totalResult = await db.get(
        `SELECT COUNT(*) as count
         FROM user_stats us
         JOIN users u ON us.user_id = u.id
         WHERE us.total_submissions > 0 AND u.is_banned = 0`
      )
      total = totalResult.count

      leaderboard = await db.all(
        `SELECT * FROM (
          SELECT
            DENSE_RANK() OVER (ORDER BY u.rating DESC) as rank,
            us.user_id,
            u.name as user_name,
            u.avatar,
            u.rating as value,
            us.solved_problems
           FROM user_stats us
           JOIN users u ON us.user_id = u.id
           WHERE us.total_submissions > 0 AND u.is_banned = 0
         ) ranked
         ORDER BY rank ASC, user_id ASC
         LIMIT ? OFFSET ?`,
        perPage, offset
      )
      await applyHistoryRankChanges(leaderboard, 'total')

      if (user) {
        const userRank = await db.get(
          `SELECT
            (SELECT COUNT(DISTINCT u2.rating) + 1 FROM users u2
             JOIN user_stats us2 ON u2.id = us2.user_id
             WHERE us2.total_submissions > 0 AND u2.is_banned = 0 AND u2.rating > u.rating) as rank,
            u.rating as value
           FROM users u
           JOIN user_stats us ON u.id = us.user_id
           WHERE u.id = ? AND us.total_submissions > 0`,
          user.id
        )
        if (userRank && userRank.rank) {
          const history = await db.get(
            `SELECT rank FROM leaderboard_history
             WHERE user_id = ? AND period_type = 'total' AND period_key = ?`,
            [user.id, previousPeriodKey]
          )
          currentUser = {
            rank: userRank.rank,
            userId: user.id,
            userName: user.name,
            avatar: user.avatar,
            value: userRank.value,
            previousRank: history?.rank || null,
            rankChange: history ? userRank.rank - history.rank : null
          }
        }
      }
    } else if (type === 'weekly') {
      const { startDate, endDate } = getWeekRange()
      periodStart = startDate
      periodEnd = endDate

      const totalResult = await db.get(
        `SELECT COUNT(*) as count FROM (
          SELECT sp.user_id
          FROM solved_problems sp
          JOIN users u ON sp.user_id = u.id
          WHERE sp.first_solved_at >= ? AND sp.first_solved_at < ? AND u.is_banned = 0
          GROUP BY sp.user_id
          HAVING COUNT(DISTINCT sp.problem_id) > 0
        )`,
        startDate, endDate
      )
      total = totalResult.count

      leaderboard = await db.all(
        `SELECT * FROM (
          SELECT
            DENSE_RANK() OVER (ORDER BY COUNT(DISTINCT sp.problem_id) DESC) as rank,
            sp.user_id,
            u.name as user_name,
            u.avatar,
            COUNT(DISTINCT sp.problem_id) as value
           FROM solved_problems sp
           JOIN users u ON sp.user_id = u.id
           WHERE sp.first_solved_at >= ? AND sp.first_solved_at < ? AND u.is_banned = 0
           GROUP BY sp.user_id
           HAVING COUNT(DISTINCT sp.problem_id) > 0
         ) ranked
         ORDER BY rank ASC, user_id ASC
         LIMIT ? OFFSET ?`,
        startDate, endDate, perPage, offset
      )
      await applyHistoryRankChanges(leaderboard, 'weekly')

      if (user) {
        const userStats = await db.get(
          `SELECT COUNT(DISTINCT problem_id) as value
           FROM solved_problems
           WHERE user_id = ? AND first_solved_at >= ? AND first_solved_at < ?`,
          user.id, startDate, endDate
        )
        if (userStats && userStats.value > 0) {
          const userRank = await db.get(
            `SELECT COUNT(*) + 1 as rank
             FROM (
               SELECT user_id, COUNT(DISTINCT problem_id) as cnt
               FROM solved_problems sp
               JOIN users u ON sp.user_id = u.id
               WHERE sp.first_solved_at >= ? AND sp.first_solved_at < ? AND u.is_banned = 0
               GROUP BY sp.user_id
               HAVING cnt > ?
             )`,
            startDate, endDate, userStats.value
          )
          const history = await db.get(
            `SELECT rank FROM leaderboard_history
             WHERE user_id = ? AND period_type = 'weekly' AND period_key = ?`,
            [user.id, previousPeriodKey]
          )
          currentUser = {
            rank: userRank.rank,
            userId: user.id,
            userName: user.name,
            avatar: user.avatar,
            value: userStats.value,
            previousRank: history?.rank || null,
            rankChange: history ? userRank.rank - history.rank : null
          }
        }
      }
    } else if (type === 'monthly') {
      const { startDate, endDate } = getMonthRange()
      periodStart = startDate
      periodEnd = endDate

      const totalResult = await db.get(
        `SELECT COUNT(*) as count FROM (
          SELECT sp.user_id
          FROM solved_problems sp
          JOIN users u ON sp.user_id = u.id
          WHERE sp.first_solved_at >= ? AND sp.first_solved_at < ? AND u.is_banned = 0
          GROUP BY sp.user_id
          HAVING COUNT(DISTINCT sp.problem_id) > 0
        )`,
        startDate, endDate
      )
      total = totalResult.count

      leaderboard = await db.all(
        `SELECT * FROM (
          SELECT
            DENSE_RANK() OVER (ORDER BY COUNT(DISTINCT sp.problem_id) DESC) as rank,
            sp.user_id,
            u.name as user_name,
            u.avatar,
            COUNT(DISTINCT sp.problem_id) as value
           FROM solved_problems sp
           JOIN users u ON sp.user_id = u.id
           WHERE sp.first_solved_at >= ? AND sp.first_solved_at < ? AND u.is_banned = 0
           GROUP BY sp.user_id
           HAVING COUNT(DISTINCT sp.problem_id) > 0
         ) ranked
         ORDER BY rank ASC, user_id ASC
         LIMIT ? OFFSET ?`,
        startDate, endDate, perPage, offset
      )
      await applyHistoryRankChanges(leaderboard, 'monthly')

      if (user) {
        const userStats = await db.get(
          `SELECT COUNT(DISTINCT problem_id) as value
           FROM solved_problems
           WHERE user_id = ? AND first_solved_at >= ? AND first_solved_at < ?`,
          user.id, startDate, endDate
        )
        if (userStats && userStats.value > 0) {
          const userRank = await db.get(
            `SELECT COUNT(*) + 1 as rank
             FROM (
               SELECT user_id, COUNT(DISTINCT problem_id) as cnt
               FROM solved_problems sp
               JOIN users u ON sp.user_id = u.id
               WHERE sp.first_solved_at >= ? AND sp.first_solved_at < ? AND u.is_banned = 0
               GROUP BY sp.user_id
               HAVING cnt > ?
             )`,
            startDate, endDate, userStats.value
          )
          const history = await db.get(
            `SELECT rank FROM leaderboard_history
             WHERE user_id = ? AND period_type = 'monthly' AND period_key = ?`,
            [user.id, previousPeriodKey]
          )
          currentUser = {
            rank: userRank.rank,
            userId: user.id,
            userName: user.name,
            avatar: user.avatar,
            value: userStats.value,
            previousRank: history?.rank || null,
            rankChange: history ? userRank.rank - history.rank : null
          }
        }
      }
    }

    const totalPages = Math.ceil(total / perPage)
    return res.json({
      leaderboard: leaderboard.map(row => ({
        rank: row.rank,
        userId: row.user_id,
        userName: row.user_name,
        avatar: row.avatar,
        value: row.value,
        solvedCount: row.solved_problems ?? null,
        previousRank: row.previousRank,
        rankChange: row.rankChange
      })),
      currentUser,
      type,
      page,
      perPage,
      total,
      totalPages,
      periodStart,
      periodEnd
    })
  } catch (error) {
    console.error('Failed to get leaderboard:', error)
    return res.status(500).json({ message: '获取排行榜失败' })
  }
}
