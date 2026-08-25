#!/usr/bin/env node
/**
 * StarStack 本地压力测试：只针对 1/2/3 三类生产链路做压力验证。
 * 默认拒绝公网目标，避免误压正式站点；评测模式还需要显式确认。
 *
 * 用法：
 *   node scripts/stress-test.mjs health
 *   STRESS_TOKEN=... node scripts/stress-test.mjs admin
 *   STRESS_TOKEN=... STRESS_PROBLEM_ID=1 node scripts/stress-test.mjs judge
 *   STRESS_ALLOW_JUDGE=YES STRESS_TOKEN=... STRESS_PROBLEM_ID=1 node scripts/stress-test.mjs judge
 */

const mode = process.argv[2] || 'health'
const baseUrl = (process.env.STRESS_TARGET || 'http://127.0.0.1:5180').replace(/\/$/, '')
const requests = Math.min(500, Math.max(1, Number(process.env.STRESS_REQUESTS) || (mode === 'judge' ? 10 : 200)))
const concurrency = Math.min(50, Math.max(1, Number(process.env.STRESS_CONCURRENCY) || 20))
const token = process.env.STRESS_TOKEN || ''

if (!/localhost|127\.0\.0\.1/.test(baseUrl) && process.env.STRESS_CONFIRM !== 'YES') {
  throw new Error('压力测试默认只允许本机目标；如确需其他环境，请设置 STRESS_CONFIRM=YES')
}
if (!['health', 'admin', 'judge'].includes(mode)) throw new Error('模式必须是 health、admin 或 judge')
if ((mode === 'admin' || mode === 'judge') && !token) throw new Error(`${mode} 模式需要 STRESS_TOKEN`)
if (mode === 'judge' && !Number(process.env.STRESS_PROBLEM_ID)) throw new Error('judge 模式需要 STRESS_PROBLEM_ID')
if (mode === 'judge' && process.env.STRESS_ALLOW_JUDGE !== 'YES') {
  throw new Error('judge 模式会创建真实测试运行，请设置 STRESS_ALLOW_JUDGE=YES')
}

const headers = token ? { Authorization: `Bearer ${token}` } : {}
const now = () => Number(process.hrtime.bigint()) / 1e6
const durations = []
let passed = 0
let failed = 0
let nextRequest = 0

const requestOnce = async () => {
  const started = now()
  const endpoint = mode === 'health'
    ? '/api/health'
    : mode === 'admin'
      ? (Math.random() < 0.7 ? '/api/admin/metrics' : '/api/admin/problems/1/review')
      : '/api/oj/run-sample'
  const options = { headers }
  if (mode === 'judge') {
    options.method = 'POST'
    options.headers = { ...headers, 'Content-Type': 'application/json' }
    options.body = JSON.stringify({
      problemId: Number(process.env.STRESS_PROBLEM_ID),
      language: process.env.STRESS_LANGUAGE || 'C++',
      code: process.env.STRESS_CODE || '#include <iostream>\nint main(){std::cout << 3;}',
      sampleIndex: 0,
    })
  }
  try {
    const response = await fetch(`${baseUrl}${endpoint}`, options)
    const text = await response.text()
    durations.push(now() - started)
    if (response.ok) passed += 1
    else failed += 1
    return text
  } catch {
    durations.push(now() - started)
    failed += 1
    return ''
  }
}

const workers = Array.from({ length: concurrency }, async () => {
  while (true) {
    const requestIndex = nextRequest
    nextRequest += 1
    if (requestIndex >= requests) return
    await requestOnce()
  }
})
await Promise.all(workers)

durations.sort((a, b) => a - b)
const percentile = (p) => Math.round(durations[Math.min(durations.length - 1, Math.floor(durations.length * p))] || 0)
console.log(JSON.stringify({
  mode, target: baseUrl, requests, concurrency, passed, failed,
  successRate: `${Math.round((passed / requests) * 100)}%`,
  latencyMs: { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: Math.round(durations.at(-1) || 0) },
}, null, 2))
if (failed > 0) process.exitCode = 1
