import { describe, expect, it } from 'vitest'
import { MAX_PROBLEM_TAGS, normalizeProblemTags, serializeProblemTags } from './problemTags.js'

describe('problem tag normalization', () => {
  it('trims, deduplicates and caps tags without changing their order', () => {
    expect(normalizeProblemTags([' 动态规划 ', '贪心', '动态规划', '搜索'])).toEqual(['动态规划', '贪心', '搜索'])
    expect(normalizeProblemTags('数学, 数论, 数学')).toEqual(['数学', '数论'])
  })

  it('removes control characters and limits the number of tags', () => {
    const tags = Array.from({ length: MAX_PROBLEM_TAGS + 2 }, (_, index) => `tag-${index}\n`)
    expect(normalizeProblemTags(tags)).toHaveLength(MAX_PROBLEM_TAGS)
    expect(normalizeProblemTags(['\u0000动态规划\u0001'])).toEqual(['动态规划'])
    expect(serializeProblemTags('')).toEqual([])
  })
})
