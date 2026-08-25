#!/usr/bin/env node
const baseUrl = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:5180').replace(/\/$/, '')

const checks = [
  ['GET', '/api/health', 200],
  ['GET', '/api/oj/problems', 200],
  ['GET', '/api/admin/metrics', 401],
  ['GET', '/api/admin/client-errors', 401],
  ['GET', '/api/me/export', 404],
  ['GET', '/api/me/sessions', 401],
  ['POST', '/api/me/sessions/revoke-others', 401],
  ['POST', '/api/oj/submissions/1/cancel', 401],
  ['GET', '/api/messages/conversations', 401],
  ['GET', '/api/chat/rooms', 401],
]

for (const [method, path, expected] of checks) {
  const response = await fetch(`${baseUrl}${path}`, { method })
  if (response.status !== expected) {
    throw new Error(`${path}: expected ${expected}, got ${response.status}`)
  }
  console.log(`ok ${path} -> ${response.status}`)
}

const healthResponse = await fetch(`${baseUrl}/api/health`)
const healthBody = await healthResponse.json()
if (healthResponse.status !== 200 || healthBody.ok !== true || healthBody.database?.integrity !== 'ok' || healthBody.disk?.healthy !== true || !('backup' in healthBody)) {
  throw new Error('健康接口未返回完整的数据库/磁盘健康状态')
}
if ('path' in (healthBody.disk || {}) || 'directory' in (healthBody.backup || {})) {
  throw new Error('健康接口不应暴露服务器绝对路径')
}
console.log('ok /api/health payload -> database, disk and backup status present')

const paginatedResponse = await fetch(`${baseUrl}/api/oj/problems?page=1&pageSize=2`)
if (paginatedResponse.status !== 200) {
  throw new Error(`/api/oj/problems pagination: expected 200, got ${paginatedResponse.status}`)
}
const paginatedBody = await paginatedResponse.json()
if (paginatedBody.page !== 1 || paginatedBody.pageSize !== 2 || !Number.isInteger(paginatedBody.totalPages) || !Array.isArray(paginatedBody.problems) || paginatedBody.problems.length > 2) {
  throw new Error('题库分页响应格式不正确')
}
console.log('ok /api/oj/problems pagination -> 200')
console.log('API smoke checks passed')
