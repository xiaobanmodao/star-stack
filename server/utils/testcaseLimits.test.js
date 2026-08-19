import { describe, expect, it } from 'vitest'
import { MAX_TESTCASE_TIME_LIMIT_MS, parseTestcaseTimeLimit } from './testcaseLimits.js'

describe('testcase time limits', () => {
  it('keeps every configured test point at or below three seconds', () => {
    expect(parseTestcaseTimeLimit(MAX_TESTCASE_TIME_LIMIT_MS)).toEqual({ value: 3000, error: null })
    expect(parseTestcaseTimeLimit(MAX_TESTCASE_TIME_LIMIT_MS + 1).error).toContain('100～3000ms')
  })
})
