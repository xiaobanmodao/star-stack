import { describe, expect, it } from 'vitest'
import {
  normalizeEstimatedMinutes,
  normalizeProblemMetadata,
  serializeProblemMetadata,
  serializePublicProblemMetadata,
} from './problemMetadata.js'

describe('problem metadata', () => {
  it('normalizes author metadata while keeping admin-only status fields protected', () => {
    const metadata = normalizeProblemMetadata({
      topicTags: ['数组', '数组'],
      techniqueTags: '前缀和, 模拟',
      estimatedMinutes: '30',
      recommendedFor: '基础巩固',
      qualityStatus: 'verified',
      editorialStatus: 'published',
    })

    expect(metadata).toMatchObject({
      topicTags: ['数组'],
      techniqueTags: ['前缀和', '模拟'],
      estimatedMinutes: 30,
      recommendedFor: '基础巩固',
      qualityStatus: 'unchecked',
      editorialStatus: 'none',
    })
  })

  it('accepts valid admin statuses and safely falls back invalid legacy values', () => {
    const metadata = normalizeProblemMetadata({ qualityStatus: 'verified', editorialStatus: 'published' }, {
      isAdmin: true,
    })
    expect(metadata.qualityStatus).toBe('verified')
    expect(metadata.editorialStatus).toBe('published')

    const serialized = serializeProblemMetadata({ quality_status: 'unknown', editorial_status: 'broken', estimated_minutes: 999 })
    expect(serialized).toMatchObject({ qualityStatus: 'unchecked', editorialStatus: 'none', estimatedMinutes: null })
    expect(serializePublicProblemMetadata({ topic_tags: '数组', quality_status: 'verified' })).toEqual({
      topicTags: ['数组'], techniqueTags: [], estimatedMinutes: null, recommendedFor: '',
    })
  })

  it('bounds estimated time to one through ten hours', () => {
    expect(normalizeEstimatedMinutes(1)).toBe(1)
    expect(normalizeEstimatedMinutes(600)).toBe(600)
    expect(normalizeEstimatedMinutes(0)).toBeNull()
    expect(normalizeEstimatedMinutes(601)).toBeNull()
    expect(normalizeEstimatedMinutes('not-a-number')).toBeNull()
  })
})
