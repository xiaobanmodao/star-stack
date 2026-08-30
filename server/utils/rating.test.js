import { describe, expect, it } from 'vitest'
import { getPracticeRating, PRACTICE_RATING_BASE } from './rating.js'

describe('practice rating presentation', () => {
  it('starts at a readable baseline without rewriting stored weights', () => {
    expect(getPracticeRating(0)).toBe(PRACTICE_RATING_BASE)
    expect(getPracticeRating(0.05)).toBe(1050)
  })

  it('handles invalid legacy values safely', () => {
    expect(getPracticeRating(null)).toBe(1000)
    expect(getPracticeRating('not-a-number')).toBe(1000)
    expect(getPracticeRating(-1)).toBe(1000)
  })
})
