#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const baseUrl = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:5180').replace(/\/$/, '')
const staticBaseUrl = (process.env.SMOKE_STATIC_BASE_URL || '').replace(/\/$/, '')
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const decorationAssets = [
  'public/assets/decorations/streak-100-overlay.png',
  'public/assets/decorations/perfect-solve-overlay.png',
]

const checks = [
  ['GET', '/api/health', 200],
  ['GET', '/api/oj/problems', 200],
  ['GET', '/api/leaderboard?type=total&page=1&perPage=5', 200],
  ['GET', '/api/learning-paths', 404],
  ['GET', '/api/learning-paths/beginner', 404],
  ['GET', '/api/admin/metrics', 401],
  ['GET', '/api/admin/client-errors', 401],
  ['GET', '/api/me/export', 404],
  ['GET', '/api/me/sessions', 401],
  ['GET', '/api/me/decorations', 401],
  ['GET', '/api/me/connected-apps', 401],
  ['DELETE', '/api/me/connected-apps/jieya', 401],
  ['GET', '/api/sso/session', 410],
  ['PATCH', '/api/me/decorations', 401],
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

const retiredSsoResponse = await fetch(`${baseUrl}/api/sso/session`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: 'smoke-secret-that-must-not-be-echoed' }),
})
const retiredSsoBody = await retiredSsoResponse.json()
if (retiredSsoResponse.status !== 410
  || retiredSsoBody.error !== 'legacy_sso_retired'
  || 'token' in retiredSsoBody
  || JSON.stringify(retiredSsoBody).includes('smoke-secret')) {
  throw new Error('旧 SSO 端点没有失败关闭或回显了凭据')
}
console.log('ok /api/sso/session -> legacy shared-token SSO retired')

const healthResponse = await fetch(`${baseUrl}/api/health`)
const healthBody = await healthResponse.json()
if (healthResponse.status !== 200 || healthBody.ok !== true || healthBody.database?.integrity !== 'ok' || healthBody.disk?.healthy !== true || !('backup' in healthBody)) {
  throw new Error('健康接口未返回完整的数据库/磁盘健康状态')
}
if ('path' in (healthBody.disk || {}) || 'directory' in (healthBody.backup || {})) {
  throw new Error('健康接口不应暴露服务器绝对路径')
}
console.log('ok /api/health payload -> database, disk and backup status present')

const leaderboardResponse = await fetch(`${baseUrl}/api/leaderboard?type=total&page=1&perPage=5`)
if (leaderboardResponse.status !== 200) {
  throw new Error(`/api/leaderboard: expected 200, got ${leaderboardResponse.status}`)
}
const leaderboardBody = await leaderboardResponse.json()
if (!Array.isArray(leaderboardBody.leaderboard) || leaderboardBody.leaderboard.some((entry) => typeof entry.value !== 'number' || entry.value < 1000)) {
  throw new Error('排行榜练习 Rating 响应格式不正确')
}
console.log('ok /api/leaderboard -> practice Rating presentation')

const paginatedResponse = await fetch(`${baseUrl}/api/oj/problems?page=1&pageSize=2`)
if (paginatedResponse.status !== 200) {
  throw new Error(`/api/oj/problems pagination: expected 200, got ${paginatedResponse.status}`)
}
const paginatedBody = await paginatedResponse.json()
if (paginatedBody.page !== 1 || paginatedBody.pageSize !== 2 || !Number.isInteger(paginatedBody.totalPages) || !Array.isArray(paginatedBody.problems) || paginatedBody.problems.length > 2 || paginatedBody.problems.some((problem) => !Array.isArray(problem.topicTags) || !Array.isArray(problem.techniqueTags) || (problem.estimatedMinutes !== null && !Number.isInteger(problem.estimatedMinutes)))) {
  throw new Error('题库分页响应格式不正确')
}
console.log('ok /api/oj/problems pagination -> 200')

const invalidCursorResponse = await fetch(`${baseUrl}/api/oj/problems?cursor=invalid`)
if (invalidCursorResponse.status !== 400) {
  throw new Error(`/api/oj/problems invalid cursor: expected 400, got ${invalidCursorResponse.status}`)
}
const firstCursor = Buffer.from(JSON.stringify({ id: 1 })).toString('base64url')
const cursorResponse = await fetch(`${baseUrl}/api/oj/problems?cursor=${firstCursor}&pageSize=2`)
if (cursorResponse.status !== 200) {
  throw new Error(`/api/oj/problems cursor: expected 200, got ${cursorResponse.status}`)
}
const cursorBody = await cursorResponse.json()
if (!Array.isArray(cursorBody.problems) || cursorBody.problems.length > 2 || (cursorBody.nextCursor !== null && typeof cursorBody.nextCursor !== 'string')) {
  throw new Error('题库游标分页响应格式不正确')
}
console.log('ok /api/oj/problems cursor pagination -> 200')

const relatedSource = paginatedBody.problems[0]
if (relatedSource?.id) {
  const relatedProblemsResponse = await fetch(`${baseUrl}/api/oj/problems/${relatedSource.id}/related`)
  if (relatedProblemsResponse.status !== 200) {
    throw new Error(`/api/oj/problems/${relatedSource.id}/related: expected 200, got ${relatedProblemsResponse.status}`)
  }
  const relatedProblemsBody = await relatedProblemsResponse.json()
  if (relatedProblemsBody.problemId !== relatedSource.id || !Array.isArray(relatedProblemsBody.problems) || relatedProblemsBody.problems.some((problem) => !problem.id || !problem.title || !problem.matchReason || problem.id === relatedSource.id)) {
    throw new Error('相近题目接口响应格式不正确')
  }
  console.log(`ok /api/oj/problems/${relatedSource.id}/related -> ranked problem metadata`)

  const detailResponse = await fetch(`${baseUrl}/api/oj/problems/${relatedSource.id}`)
  if (detailResponse.status !== 200) {
    throw new Error(`/api/oj/problems/${relatedSource.id}: expected 200, got ${detailResponse.status}`)
  }
  const detailBody = await detailResponse.json()
  if ('learningPaths' in (detailBody.problem || {})) {
    throw new Error('题目详情不应返回学习路径字段')
  }
  console.log(`ok /api/oj/problems/${relatedSource.id} -> problem detail`)
} else {
  console.log('related problem smoke skipped: no published problems')
}

for (const asset of decorationAssets) {
  if (!fs.existsSync(path.join(projectRoot, asset))) throw new Error(`缺少装饰资源：${asset}`)
}
console.log('ok decoration assets -> local files present')

if (staticBaseUrl) {
  for (const asset of decorationAssets) {
    const response = await fetch(`${staticBaseUrl}/${asset.replace(/^public\//, '')}`)
    if (response.status !== 200) throw new Error(`${asset}: expected static 200, got ${response.status}`)
  }
  console.log('ok decoration assets -> static host reachable')
} else {
  console.log('static decoration smoke skipped: set SMOKE_STATIC_BASE_URL to verify a hosted build')
}

if (process.env.SMOKE_TOKEN) {
  const authHeaders = { Authorization: `Bearer ${process.env.SMOKE_TOKEN}` }
  const decorationsResponse = await fetch(`${baseUrl}/api/me/decorations`, { headers: authHeaders })
  if (decorationsResponse.status !== 200) {
    throw new Error(`/api/me/decorations authenticated: expected 200, got ${decorationsResponse.status}`)
  }
  const decorations = await decorationsResponse.json()
  if (!decorations.equipped || !Array.isArray(decorations.frames) || !Array.isArray(decorations.overlays) || !Array.isArray(decorations.titles)) {
    throw new Error('装饰接口缺少 equipped/frames/overlays/titles')
  }
  const equipped = decorations.equipped
  const saveResponse = await fetch(`${baseUrl}/api/me/decorations`, {
    method: 'PATCH',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      avatarFrame: equipped.avatarFrame,
      avatarOverlay: equipped.avatarOverlay,
      equippedTitle: equipped.equippedTitle,
    }),
  })
  if (saveResponse.status !== 200) {
    throw new Error(`/api/me/decorations authenticated PATCH: expected 200, got ${saveResponse.status}`)
  }
  const saved = await saveResponse.json()
  if (!saved.success || !saved.user || !saved.decorations?.equipped) {
    throw new Error('装饰保存响应缺少 success/user/decorations.equipped')
  }
  console.log('ok /api/me/decorations authenticated -> load/save response shape')

  const connectedAppsResponse = await fetch(`${baseUrl}/api/me/connected-apps`, { headers: authHeaders })
  if (connectedAppsResponse.status !== 200) {
    throw new Error(`/api/me/connected-apps authenticated: expected 200, got ${connectedAppsResponse.status}`)
  }
  const connectedApps = await connectedAppsResponse.json()
  const jieya = connectedApps.applications?.find((application) => application.id === 'jieya')
  if (!jieya
    || jieya.homepage !== 'https://jieya.xingzhan.cc'
    || !['not_connected', 'connected', 'revocation_pending'].includes(jieya.status)
    || 'clientId' in jieya
    || 'accountSubject' in jieya
    || 'isAdmin' in jieya) {
    throw new Error('连接应用接口缺少固定 Jieya 元数据或暴露了内部身份字段')
  }
  console.log('ok /api/me/connected-apps authenticated -> safe Jieya connection metadata')
} else {
  console.log('authenticated decoration/connected-app smoke skipped: set SMOKE_TOKEN to enable')
}

console.log('API smoke checks passed')
