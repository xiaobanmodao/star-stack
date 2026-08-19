export const DEFAULT_TESTCASE_TIME_LIMIT_MS = 1500
export const MIN_TESTCASE_TIME_LIMIT_MS = 100
export const MAX_TESTCASE_TIME_LIMIT_MS = 3000

export const normalizeTestcaseTimeLimit = (value) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_TESTCASE_TIME_LIMIT_MS
  return Math.min(
    MAX_TESTCASE_TIME_LIMIT_MS,
    Math.max(MIN_TESTCASE_TIME_LIMIT_MS, Math.round(numeric)),
  )
}

export const parseTestcaseTimeLimit = (value, label = '测试点') => {
  if (value === undefined || value === null || value === '') {
    return { value: DEFAULT_TESTCASE_TIME_LIMIT_MS, error: null }
  }

  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric < MIN_TESTCASE_TIME_LIMIT_MS || numeric > MAX_TESTCASE_TIME_LIMIT_MS) {
    return {
      value: DEFAULT_TESTCASE_TIME_LIMIT_MS,
      error: `${label}限时需为 ${MIN_TESTCASE_TIME_LIMIT_MS}～${MAX_TESTCASE_TIME_LIMIT_MS}ms 的整数`,
    }
  }
  return { value: numeric, error: null }
}
