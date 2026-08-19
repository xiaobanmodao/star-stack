#!/usr/bin/env node
const baseUrl = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:5180').replace(/\/$/, '')

const checks = [
  ['GET', '/api/health', 200],
  ['GET', '/api/oj/problems', 200],
  ['GET', '/api/admin/metrics', 401],
  ['POST', '/api/oj/submissions/1/cancel', 401],
]

for (const [method, path, expected] of checks) {
  const response = await fetch(`${baseUrl}${path}`, { method })
  if (response.status !== expected) {
    throw new Error(`${path}: expected ${expected}, got ${response.status}`)
  }
  console.log(`ok ${path} -> ${response.status}`)
}

console.log('API smoke checks passed')
