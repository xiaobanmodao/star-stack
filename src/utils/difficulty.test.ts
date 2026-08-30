import { describe, expect, it } from 'vitest'
import { aggregateDifficultyStats, getDifficultyClassName, getDifficultyLabel, getDifficultyMeta, getDifficultyOptions } from './difficulty'

describe('difficulty display helpers', () => {
  it('maps legacy labels to the five standard levels', () => {
    expect(getDifficultyMeta('入门')).toMatchObject({ key: 'simple', label: '简单' })
    expect(getDifficultyMeta('普及+')).toMatchObject({ key: 'challenging', label: '较难' })
    expect(getDifficultyMeta('NOI')).toMatchObject({ key: 'extreme', label: '极难' })
  })

  it('keeps filter options ordered by the new standard', () => {
    expect(getDifficultyOptions().map((option) => option.value)).toEqual([
      'simple', 'medium', 'challenging', 'difficult', 'extreme',
    ])
    expect(getDifficultyClassName('提高')).toBe('difficulty-difficult')
    expect(getDifficultyLabel('unknown')).toBe('中等')
  })

  it('aggregates historical stats into canonical levels', () => {
    expect(aggregateDifficultyStats({
      入门: { solved: 2, tried: 3 },
      simple: { solved: 1, tried: 1 },
      提高: { solved: 4, tried: 5 },
    })).toEqual([
      ['simple', { solved: 3, tried: 4 }],
      ['difficult', { solved: 4, tried: 5 }],
    ])
  })
})
