import { describe, expect, it } from 'vitest'
import {
  getDifficultyAliases,
  getDifficultyMeta,
  getDifficultyRating,
  normalizeDifficulty,
  normalizeDifficultyForCreate,
  serializeDifficulty,
} from './difficulty.js'

describe('difficulty normalization', () => {
  it('maps the legacy values into the five standard levels', () => {
    expect(normalizeDifficulty('入门')).toBe('simple')
    expect(normalizeDifficulty('普及')).toBe('medium')
    expect(normalizeDifficulty('提高-')).toBe('challenging')
    expect(normalizeDifficulty('提高')).toBe('difficult')
    expect(normalizeDifficulty('NOI')).toBe('extreme')
  })

  it('uses a safe fallback for unknown historical values', () => {
    expect(normalizeDifficulty('unknown')).toBe('medium')
    expect(normalizeDifficultyForCreate()).toBe('simple')
  })

  it('returns stable display metadata and filter aliases', () => {
    expect(getDifficultyMeta('提高+')).toMatchObject({ key: 'difficult', label: '困难' })
    expect(getDifficultyAliases('simple')).toEqual(expect.arrayContaining(['simple', '入门', '普及-']))
    expect(serializeDifficulty('省选')).toEqual({
      difficulty: '极难',
      difficultyKey: 'extreme',
      difficultyLabel: '极难',
      difficultyColorToken: '--ss-difficulty-extreme',
    })
  })

  it('keeps the difficulty rating order stable', () => {
    expect(getDifficultyRating('简单')).toBeLessThan(getDifficultyRating('困难'))
    expect(getDifficultyRating('极难')).toBeGreaterThan(getDifficultyRating('提高'))
  })
})
