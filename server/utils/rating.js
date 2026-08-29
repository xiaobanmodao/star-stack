// 当前阶段是练习 Rating：由已通过题目的难度权重换算为可读分数。
// 数据库继续保存旧的难度权重，避免迁移时改写历史用户数据；正式比赛接入后再使用独立的竞赛结算。
export const PRACTICE_RATING_BASE = 1000

export const getPracticeRating = (storedValue) => {
  const value = Number(storedValue)
  if (!Number.isFinite(value) || value < 0) return PRACTICE_RATING_BASE
  return Math.round(PRACTICE_RATING_BASE + value * 1000)
}
