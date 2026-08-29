import { describe, expect, it } from 'vitest'
import { getRelatedProblemReason, rankRelatedProblems } from './relatedProblems.js'

describe('related problem ranking', () => {
  const source = { id: 1, difficulty: 'medium', tags: '数组,模拟' }

  it('prefers problems with shared tags and nearby difficulty', () => {
    const ranked = rankRelatedProblems({
      source,
      candidates: [
        { id: 3, difficulty: 'extreme', tags: '图论' },
        { id: 2, difficulty: 'medium', tags: '数组,前缀和' },
      ],
    })

    expect(ranked[0].candidate.id).toBe(2)
    expect(ranked[0].sharedTags).toEqual(['数组'])
  })

  it('provides a reason that can be shown beside a recommendation', () => {
    const item = { id: 2, difficulty: 'medium', tags: '数组' }
    expect(getRelatedProblemReason({ sharedTags: ['数组'], source, candidate: item })).toBe('共同标签：数组')
    expect(getRelatedProblemReason({ sharedTags: [], source, candidate: item })).toBe('同为中等难度')
  })
})
