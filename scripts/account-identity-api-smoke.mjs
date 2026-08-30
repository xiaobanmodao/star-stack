const baseUrl = String(process.env.IDENTITY_SMOKE_BASE_URL || '').replace(/\/$/, '')
const adminId = process.env.IDENTITY_SMOKE_ADMIN_ID
const adminPassword = process.env.IDENTITY_SMOKE_ADMIN_PASSWORD
const testUserId = process.env.IDENTITY_SMOKE_USER_ID || 'phase1a-user'
const testUserPassword = process.env.IDENTITY_SMOKE_USER_PASSWORD

if (!baseUrl || !adminId || !adminPassword || !testUserPassword) {
  throw new Error(
    'IDENTITY_SMOKE_BASE_URL、IDENTITY_SMOKE_ADMIN_ID、IDENTITY_SMOKE_ADMIN_PASSWORD '
    + '和 IDENTITY_SMOKE_USER_PASSWORD 均为必需参数',
  )
}

const request = async (pathname, { token, cookie, ...options } = {}) => {
  const headers = new Headers(options.headers || {})
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (cookie) headers.set('Cookie', cookie)
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${baseUrl}${pathname}`, { ...options, headers })
  const contentType = response.headers.get('content-type') || ''
  const data = contentType.includes('application/json') ? await response.json() : null
  return { response, data }
}

const expectStatus = (label, actual, expected) => {
  const allowed = Array.isArray(expected) ? expected : [expected]
  if (!allowed.includes(actual)) {
    throw new Error(`${label}: expected ${allowed.join('/')} but received ${actual}`)
  }
}

const assertPrivateSubject = (label, data) => {
  if (data && typeof data === 'object' && Object.hasOwn(data.user || {}, 'accountSubject')) {
    throw new Error(`${label}: public response exposed accountSubject`)
  }
}

const login = async (id, password) => request('/api/login', {
  method: 'POST',
  body: JSON.stringify({ id, password }),
})

const adminLogin = await login(adminId, adminPassword)
expectStatus('admin login', adminLogin.response.status, 200)
assertPrivateSubject('admin login', adminLogin.data)
const adminToken = adminLogin.data?.token
const adminCookie = adminLogin.response.headers.get('set-cookie')?.split(';', 1)[0]
if (!adminToken || !adminCookie) throw new Error('admin login did not return both bearer and cookie sessions')

for (const [label, auth] of [
  ['bearer session', { token: adminToken }],
  ['cookie session', { cookie: adminCookie }],
]) {
  const me = await request('/api/me', auth)
  expectStatus(label, me.response.status, 200)
  assertPrivateSubject(label, me.data)
}

const problems = await request('/api/oj/problems?page=1&pageSize=2')
expectStatus('OJ problem compatibility', problems.response.status, 200)
if (!Array.isArray(problems.data?.problems)) throw new Error('OJ problem response is malformed')

const created = await request('/api/admin/users', {
  method: 'POST',
  token: adminToken,
  body: JSON.stringify({ id: testUserId, name: 'Phase 1A User', password: testUserPassword }),
})
expectStatus('admin create user', created.response.status, 200)
assertPrivateSubject('admin create user', created.data)

const userLogin = await login(testUserId, testUserPassword)
expectStatus('new user login', userLogin.response.status, 200)
const userToken = userLogin.data?.token
if (!userToken) throw new Error('new user login did not return a bearer token')

const suspended = await request(`/api/admin/users/${encodeURIComponent(testUserId)}/ban`, {
  method: 'POST',
  token: adminToken,
  body: JSON.stringify({ banned: true }),
})
expectStatus('admin suspend user', suspended.response.status, 200)
expectStatus('suspended session revoked', (await request('/api/me', { token: userToken })).response.status, 401)
expectStatus('suspended login rejected', (await login(testUserId, testUserPassword)).response.status, 403)

const restored = await request(`/api/admin/users/${encodeURIComponent(testUserId)}/ban`, {
  method: 'POST',
  token: adminToken,
  body: JSON.stringify({ banned: false }),
})
expectStatus('admin restore user', restored.response.status, 200)
expectStatus('restored login', (await login(testUserId, testUserPassword)).response.status, 200)

const deleted = await request(`/api/admin/users/${encodeURIComponent(testUserId)}`, {
  method: 'DELETE',
  token: adminToken,
})
expectStatus('admin tombstone user', deleted.response.status, 204)
expectStatus('tombstoned login rejected', (await login(testUserId, testUserPassword)).response.status, 401)

const users = await request('/api/admin/users', { token: adminToken })
expectStatus('admin user list', users.response.status, 200)
if (users.data?.users?.some((user) => user.id === testUserId)) {
  throw new Error('tombstoned account remained visible in the legacy admin list')
}

console.log('Account identity API smoke checks passed')
