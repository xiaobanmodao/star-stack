import { describe, expect, it } from 'vitest'
import { buildProblemSnapshot, parseRevisionSnapshot } from './problemRevisions.js'

describe('problem revisions', () => {
  it('serializes the complete题面 and test data snapshot', () => {
    const snapshot = buildProblemSnapshot({
      problem: {
        title: '星尘求和',
        difficulty: '入门',
        tags: '数学, 基础',
        statement: '输出 A+B',
        input_desc: 'A B',
        output_desc: '答案',
        data_range: '1<=A<=10',
        topic_tags: '数组,数学',
        technique_tags: '前缀和',
        estimated_minutes: 20,
        recommended_for: '基础巩固',
        quality_status: 'verified',
        editorial_status: 'published',
        revision_summary: '补充元数据',
      },
      testcases: [
        { input: '1 2', output: '3', is_sample: 1, time_limit_ms: 500 },
        { input: '10 20', output: '30', is_sample: 0, time_limit_ms: 1000 },
      ],
    })

    expect(snapshot).toMatchObject({
      title: '星尘求和',
      tags: ['数学', '基础'],
      inputDesc: 'A B',
      samples: [{ input: '1 2', output: '3', timeLimitMs: 500 }],
      topicTags: ['数组', '数学'],
      techniqueTags: ['前缀和'],
      estimatedMinutes: 20,
      qualityStatus: 'verified',
      editorialStatus: 'published',
      revisionSummary: '补充元数据',
      testData: [{ input: '10 20', output: '30', timeLimitMs: 1000 }],
    })
  })

  it('rejects malformed snapshots instead of restoring arbitrary data', () => {
    expect(parseRevisionSnapshot('{bad json')).toBeNull()
    expect(parseRevisionSnapshot(JSON.stringify({ title: 'x', samples: [] }))).toMatchObject({
      title: 'x',
      samples: [],
      testData: [],
    })
  })
})
