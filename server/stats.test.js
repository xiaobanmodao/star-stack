import { describe, expect, it, vi } from 'vitest'
import { calculateStreak, getLevelInfo } from './stats.js'

const localDate = (offsetDays) => {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const createDb = (rows) => {
  const run = vi.fn().mockResolvedValue(undefined)
  return {
    all: vi.fn().mockResolvedValue(rows),
    run,
  }
}

describe('calculateStreak', () => {
  it('resets streak when there is no accepted activity', async () => {
    const db = createDb([])
    await calculateStreak(db, 'astro01')

    expect(db.all).toHaveBeenCalled()
    expect(db.run).toHaveBeenCalledWith(
      `UPDATE user_stats SET current_streak = 0, max_streak = 0 WHERE user_id = ?`,
      'astro01'
    )
  })

  it('counts consecutive today and yesterday as current streak', async () => {
    const db = createDb([
      { activity_date: localDate(0) },
      { activity_date: localDate(-1) },
      { activity_date: localDate(-2) },
    ])
    await calculateStreak(db, 'astro01')

    expect(db.run).toHaveBeenCalledWith(
      `UPDATE user_stats SET current_streak = ?, max_streak = ? WHERE user_id = ?`,
      3,
      3,
      'astro01'
    )
  })

  it('keeps streak alive when today is not checked but yesterday is', async () => {
    const db = createDb([
      { activity_date: localDate(-1) },
      { activity_date: localDate(-2) },
    ])
    await calculateStreak(db, 'astro01')

    expect(db.run).toHaveBeenCalledWith(
      `UPDATE user_stats SET current_streak = ?, max_streak = ? WHERE user_id = ?`,
      2,
      2,
      'astro01'
    )
  })

  it('breaks current streak after a missing day', async () => {
    const db = createDb([
      { activity_date: localDate(0) },
      { activity_date: localDate(-2) },
    ])
    await calculateStreak(db, 'astro01')

    expect(db.run).toHaveBeenCalledWith(
      `UPDATE user_stats SET current_streak = ?, max_streak = ? WHERE user_id = ?`,
      1,
      1,
      'astro01'
    )
  })

  it('keeps the longest historical streak separately', async () => {
    const db = createDb([
      { activity_date: localDate(-1) },
      { activity_date: localDate(-2) },
      { activity_date: localDate(-4) },
      { activity_date: localDate(-5) },
      { activity_date: localDate(-6) },
    ])
    await calculateStreak(db, 'astro01')

    // 当前连续 = 昨天+前天 = 2；最长连续 = 3（-4,-5,-6）
    expect(db.run).toHaveBeenCalledWith(
      `UPDATE user_stats SET current_streak = ?, max_streak = ? WHERE user_id = ?`,
      2,
      3,
      'astro01'
    )
  })
})

describe('getLevelInfo', () => {
  it('starts at 星尘 level 1 with 0 xp', () => {
    const info = getLevelInfo(0)
    expect(info.level).toBe(1)
    expect(info.title).toBe('星尘')
    expect(info.nextTitle).toBe('流星')
    expect(info.nextXp).toBe(100)
    expect(info.progress).toBe(0)
  })

  it('upgrades to 流星 at 100 xp', () => {
    const info = getLevelInfo(100)
    expect(info.level).toBe(2)
    expect(info.title).toBe('流星')
    expect(info.nextTitle).toBe('新星')
    expect(info.nextXp).toBe(300)
  })

  it('caps at 黑洞 after 6000 xp', () => {
    const info = getLevelInfo(10000)
    expect(info.level).toBe(7)
    expect(info.title).toBe('黑洞')
    expect(info.nextTitle).toBeNull()
    expect(info.nextXp).toBeNull()
    expect(info.progress).toBe(100)
  })

  it('computes progress toward next level', () => {
    const info = getLevelInfo(200)
    expect(info.progress).toBe(50)
  })
})
