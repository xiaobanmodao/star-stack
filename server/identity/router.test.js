import { afterEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import { openIdentityFixture, TEST_SUBJECTS } from './testIdentityFixture.js'
import { loadIdentityConfig } from './config.js'
import { createIdentityRouter } from './router.js'

const resources = []
const servers = []
const now = new Date('2026-08-30T00:00:00.000Z')
const env = {
  NODE_ENV: 'development',
  OIDC_ENABLED: 'true',
  OIDC_ISSUER: 'http://auth.localhost:5174',
  OIDC_HYDRA_PUBLIC_URL: 'http://127.0.0.1:4444',
  OIDC_HYDRA_ADMIN_URL: 'http://127.0.0.1:4445',
  OIDC_TOKEN_HOOK_SECRET: 'hook-secret-with-at-least-thirty-two-bytes',
  OIDC_LOGOUT_BROKER_SECRET: 'broker-secret-with-at-least-thirty-two-bytes',
}

const startRouter = async (resource, admin, {
  envOverrides = {},
  routerOptions = {},
  trustProxy = false,
} = {}) => {
  const config = loadIdentityConfig({ ...env, ...envOverrides })
  const app = express()
  app.disable('x-powered-by')
  if (trustProxy) app.set('trust proxy', 1)
  app.use(createIdentityRouter({
    getDb: async () => resource.db,
    admin,
    config,
    now: () => now,
    ...routerOptions,
  }))
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
  })
  servers.push(server)
  return {
    config,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  }
}

afterEach(async () => {
  while (servers.length) await new Promise((resolve) => servers.pop().close(resolve))
  while (resources.length) await resources.pop().close()
  vi.restoreAllMocks()
})

describe('identity HTTP boundary', () => {
  it.each([
    ['development', 'http://jieya.localhost:4180', 'https://jieya.xingzhan.cc'],
    ['production', 'https://jieya.xingzhan.cc', 'http://jieya.localhost:4180'],
  ])('allows only the frozen Jieya %s origin in identity form-action', async (
    nodeEnv,
    expectedOrigin,
    forbiddenOrigin,
  ) => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    const { baseUrl } = await startRouter(resource, {}, {
      envOverrides: {
        NODE_ENV: nodeEnv,
        OIDC_CLIENT_ORIGIN: 'https://attacker.example',
      },
    })

    const response = await fetch(`${baseUrl}/account/logout?transaction=missing`)
    expect(response.status).toBe(400)
    const csp = response.headers.get('content-security-policy')
    expect(csp).toContain(`form-action 'self' ${expectedOrigin}`)
    expect(csp).not.toContain(forbiddenOrigin)
    expect(csp).not.toContain('attacker.example')
    expect(csp).not.toMatch(/form-action[^;]*\*/)
  })

  it('authenticates the token hook privately and returns no sensitive response body', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    const { baseUrl } = await startRouter(resource, {})
    const payload = {
      session: {
        extra: { auth_generation: 0, grant_issued_at: '2026-08-30T00:00:00.000Z' },
        id_token: { subject: TEST_SUBJECTS.alice },
      },
      request: {
        client_id: 'jieya-server-local',
        grant_types: ['authorization_code'],
        requested_scopes: ['openid', 'profile'],
        granted_scopes: ['openid', 'profile'],
      },
    }

    const unauthorized = await fetch(`${baseUrl}/internal/oidc/token-hook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-starstack-hydra-hook': 'wrong' },
      body: JSON.stringify(payload),
    })
    expect(unauthorized.status).toBe(401)

    const accepted = await fetch(`${baseUrl}/internal/oidc/token-hook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-starstack-hydra-hook': env.OIDC_TOKEN_HOOK_SECRET,
      },
      body: JSON.stringify(payload),
    })
    expect(accepted.status).toBe(204)
    expect(await accepted.text()).toBe('')
    expect(accepted.headers.get('cache-control')).toContain('no-store')
  })

  it('exposes fail-closed UserInfo without internal account fields', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    const admin = {
      introspectToken: vi.fn(async () => ({
        active: true,
        client_id: 'jieya-server-local',
        sub: TEST_SUBJECTS.alice,
        scope: 'openid profile',
        token_use: 'access_token',
        ext: { auth_generation: 0 },
      })),
    }
    const { baseUrl } = await startRouter(resource, admin)

    const response = await fetch(`${baseUrl}/oauth2/userinfo`, {
      headers: { authorization: 'Bearer opaque-access-token' },
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ sub: TEST_SUBJECTS.alice, name: 'Alice' })
    expect(body).not.toHaveProperty('email')
    expect(body).not.toHaveProperty('auth_generation')
  })

  it('rate-limits public account GETs per source and globally', async () => {
    const perSourceResource = await openIdentityFixture()
    resources.push(perSourceResource)
    const perSource = await startRouter(perSourceResource, {}, {
      routerOptions: {
        limits: {
          accountRate: { windowMs: 60_000, perSourceMax: 2, globalMax: 100 },
        },
      },
    })
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect((await fetch(`${perSource.baseUrl}/account/error`)).status).toBe(400)
    }
    const sourceLimited = await fetch(`${perSource.baseUrl}/account/error`)
    expect(sourceLimited.status).toBe(429)
    expect(sourceLimited.headers.get('retry-after')).toBeTruthy()

    const globalResource = await openIdentityFixture()
    resources.push(globalResource)
    const global = await startRouter(globalResource, {}, {
      trustProxy: true,
      routerOptions: {
        limits: {
          accountRate: { windowMs: 60_000, perSourceMax: 100, globalMax: 2 },
        },
      },
    })
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      expect((await fetch(`${global.baseUrl}/account/error`, {
        headers: { 'x-forwarded-for': `198.51.100.${attempt}` },
      })).status).toBe(400)
    }
    expect((await fetch(`${global.baseUrl}/account/error`, {
      headers: { 'x-forwarded-for': '198.51.100.3' },
    })).status).toBe(429)
  })

  it('rate-limits UserInfo per source and globally before Hydra introspection', async () => {
    const perSourceResource = await openIdentityFixture()
    resources.push(perSourceResource)
    const perSourceAdmin = { introspectToken: vi.fn(async () => ({ active: false })) }
    const perSource = await startRouter(perSourceResource, perSourceAdmin, {
      routerOptions: {
        limits: {
          userInfoRate: { windowMs: 60_000, perSourceMax: 2, globalMax: 100 },
        },
      },
    })
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect((await fetch(`${perSource.baseUrl}/oauth2/userinfo`, {
        headers: { authorization: `Bearer invalid-${attempt}` },
      })).status).toBe(401)
    }
    expect((await fetch(`${perSource.baseUrl}/oauth2/userinfo`, {
      headers: { authorization: 'Bearer invalid-overflow' },
    })).status).toBe(429)
    expect(perSourceAdmin.introspectToken).toHaveBeenCalledTimes(2)

    const globalResource = await openIdentityFixture()
    resources.push(globalResource)
    const globalAdmin = { introspectToken: vi.fn(async () => ({ active: false })) }
    const global = await startRouter(globalResource, globalAdmin, {
      trustProxy: true,
      routerOptions: {
        limits: {
          userInfoRate: { windowMs: 60_000, perSourceMax: 100, globalMax: 2 },
        },
      },
    })
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      expect((await fetch(`${global.baseUrl}/oauth2/userinfo`, {
        headers: {
          authorization: `Bearer global-${attempt}`,
          'x-forwarded-for': `203.0.113.${attempt}`,
        },
      })).status).toBe(401)
    }
    expect((await fetch(`${global.baseUrl}/oauth2/userinfo`, {
      headers: {
        authorization: 'Bearer global-overflow',
        'x-forwarded-for': '203.0.113.3',
      },
    })).status).toBe(429)
    expect(globalAdmin.introspectToken).toHaveBeenCalledTimes(2)
  })

  it('does not let slow public UserInfo introspection starve a private token hook', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    const publicDb = await resource.openConnection()
    const userInfoDb = await resource.openConnection()
    const criticalDb = await resource.openConnection()
    let signalIntrospection
    let releaseIntrospection
    const introspectionEntered = new Promise((resolve) => { signalIntrospection = resolve })
    const introspectionRelease = new Promise((resolve) => { releaseIntrospection = resolve })
    const admin = {
      introspectToken: vi.fn(async () => {
        signalIntrospection()
        await introspectionRelease
        return { active: false }
      }),
    }
    const { baseUrl } = await startRouter(resource, admin, {
      routerOptions: {
        getPublicDb: async () => publicDb,
        getUserInfoDb: async () => userInfoDb,
        getCriticalDb: async () => criticalDb,
      },
    })
    const userInfoRequest = fetch(`${baseUrl}/oauth2/userinfo`, {
      headers: { authorization: 'Bearer deliberately-slow-token' },
    })
    await introspectionEntered
    const tokenHookRequest = fetch(`${baseUrl}/internal/oidc/token-hook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-starstack-hydra-hook': env.OIDC_TOKEN_HOOK_SECRET,
      },
      body: JSON.stringify({
        session: {
          extra: { auth_generation: 0, grant_issued_at: now.toISOString() },
          id_token: { subject: TEST_SUBJECTS.alice },
        },
        request: {
          client_id: 'jieya-server-local',
          grant_types: ['authorization_code'],
          requested_scopes: ['openid', 'profile'],
          granted_scopes: ['openid', 'profile'],
        },
      }),
    })
    const earlyTokenHook = await Promise.race([
      tokenHookRequest.then((response) => response),
      new Promise((resolve) => setTimeout(() => resolve(null), 150)),
    ])
    releaseIntrospection()
    const [userInfoResponse, tokenHookResponse] = await Promise.all([
      userInfoRequest,
      tokenHookRequest,
    ])

    expect(earlyTokenHook?.status).toBe(204)
    expect(tokenHookResponse.status).toBe(204)
    expect(userInfoResponse.status).toBe(401)
  })

  it('does not let a slow public login challenge starve a private token hook', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    const publicDb = await resource.openConnection()
    const criticalDb = await resource.openConnection()
    let signalLogin
    let releaseLogin
    const loginEntered = new Promise((resolve) => { signalLogin = resolve })
    const loginRelease = new Promise((resolve) => { releaseLogin = resolve })
    const requestUrl = new URL('http://auth.localhost:5174/oauth2/auth')
    for (const [name, value] of Object.entries({
      client_id: 'jieya-server-local',
      redirect_uri: 'http://jieya.localhost:4180/auth/callback',
      response_type: 'code',
      scope: 'openid profile',
      state: 'state-with-128-bits-of-randomness',
      nonce: 'nonce-with-128-bits-of-randomness',
      code_challenge: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      code_challenge_method: 'S256',
    })) requestUrl.searchParams.set(name, value)
    const admin = {
      getLoginRequest: vi.fn(async (challenge) => {
        signalLogin()
        await loginRelease
        return {
          challenge,
          client: { client_id: 'jieya-server-local' },
          request_url: requestUrl.toString(),
          requested_scope: ['openid', 'profile'],
          session_id: 'slow-login-session',
          skip: false,
          subject: '',
        }
      }),
    }
    const { baseUrl } = await startRouter(resource, admin, {
      routerOptions: {
        getPublicDb: async () => publicDb,
        getCriticalDb: async () => criticalDb,
      },
    })
    const loginRequest = fetch(`${baseUrl}/account/login?login_challenge=slow-login`)
    await loginEntered
    const tokenHookRequest = fetch(`${baseUrl}/internal/oidc/token-hook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-starstack-hydra-hook': env.OIDC_TOKEN_HOOK_SECRET,
      },
      body: JSON.stringify({
        session: {
          extra: { auth_generation: 0, grant_issued_at: now.toISOString() },
          id_token: { subject: TEST_SUBJECTS.alice },
        },
        request: {
          client_id: 'jieya-server-local',
          grant_types: ['authorization_code'],
          requested_scopes: ['openid', 'profile'],
          granted_scopes: ['openid', 'profile'],
        },
      }),
    })
    const earlyTokenHook = await Promise.race([
      tokenHookRequest.then((response) => response),
      new Promise((resolve) => setTimeout(() => resolve(null), 150)),
    ])
    releaseLogin()
    const [loginResponse, tokenHookResponse] = await Promise.all([
      loginRequest,
      tokenHookRequest,
    ])

    expect(earlyTokenHook?.status).toBe(204)
    expect(tokenHookResponse.status).toBe(204)
    expect(loginResponse.status).toBe(200)
  })

  it('fails fast when the public identity operation queue reaches its hard cap', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    let signalLogin
    let releaseLogin
    const loginEntered = new Promise((resolve) => { signalLogin = resolve })
    const loginRelease = new Promise((resolve) => { releaseLogin = resolve })
    const requestUrl = (challenge) => {
      const params = new URLSearchParams({
        client_id: 'jieya-server-local',
        redirect_uri: 'http://jieya.localhost:4180/auth/callback',
        response_type: 'code',
        scope: 'openid profile',
        state: 'state-with-128-bits-of-randomness',
        nonce: 'nonce-with-128-bits-of-randomness',
        code_challenge: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        code_challenge_method: 'S256',
      })
      return `http://auth.localhost:5174/oauth2/auth?${params}`
    }
    const admin = {
      getLoginRequest: vi.fn(async (challenge) => {
        signalLogin()
        await loginRelease
        return {
          challenge,
          client: { client_id: 'jieya-server-local' },
          request_url: requestUrl(challenge),
          requested_scope: ['openid', 'profile'],
          session_id: `session-${challenge}`,
          skip: false,
          subject: '',
        }
      }),
    }
    const { baseUrl } = await startRouter(resource, admin, {
      routerOptions: {
        limits: {
          publicQueueMaxPending: 1,
          accountRate: { windowMs: 60_000, perSourceMax: 100, globalMax: 100 },
        },
      },
    })
    const first = fetch(`${baseUrl}/account/login?login_challenge=queue-first`)
    await loginEntered
    const second = fetch(`${baseUrl}/account/login?login_challenge=queue-second`)
    const earlySecond = await Promise.race([
      second.then((response) => response),
      new Promise((resolve) => setTimeout(() => resolve(null), 150)),
    ])
    releaseLogin()
    const [firstResponse, secondResponse] = await Promise.all([first, second])

    expect(earlySecond?.status).toBe(503)
    expect(secondResponse.status).toBe(503)
    expect(firstResponse.status).toBe(200)
    expect(admin.getLoginRequest).toHaveBeenCalledTimes(1)
  })

  it('creates broker transactions only with the private credential and keeps GET side-effect free', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    await resource.db.run(
      `INSERT INTO oidc_login_sessions
         (account_subject, client_id, sid, auth_generation, status,
          created_at, updated_at, expires_at)
       VALUES (?, 'jieya-server-local', 'sid-1', 0, 'active', ?, ?, ?)`,
      TEST_SUBJECTS.alice,
      now.toISOString(),
      now.toISOString(),
      '2026-09-29T00:00:00.000Z',
    )
    const { baseUrl, config } = await startRouter(resource, {})
    const body = {
      subject: TEST_SUBJECTS.alice,
      sid: 'sid-1',
      client_id: 'jieya-server-local',
      state: 'jieya-state-with-enough-entropy',
    }

    const denied = await fetch(`${baseUrl}/internal/oidc/logout-transactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect(denied.status).toBe(401)

    const created = await fetch(`${baseUrl}/internal/oidc/logout-transactions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-StarStack-Logout-Broker': env.OIDC_LOGOUT_BROKER_SECRET,
      },
      body: JSON.stringify(body),
    })
    expect(created.status).toBe(201)
    const result = await created.json()
    expect(Object.keys(result).sort()).toEqual(['expires_at', 'url'])
    expect(result.expires_at).toBe('2026-08-30T00:05:00.000Z')
    const transaction = new URL(result.url).searchParams.get('transaction')
    expect(transaction).toBeTruthy()
    expect(result.url).not.toContain(body.state)

    const before = await resource.db.get(
      `SELECT auth_generation FROM users WHERE id = 'alice'`,
    )
    const page = await fetch(`${baseUrl}/account/logout?transaction=${encodeURIComponent(transaction)}`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('重新验证账号')
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(page.headers.get('referrer-policy')).toBe('same-origin')

    const pageHtml = await (await fetch(
      `${baseUrl}/account/logout?transaction=${encodeURIComponent(transaction)}`,
    )).text()
    const csrfToken = pageHtml.match(/name="csrf_token" value="([^"]+)"/)?.[1]
    expect(csrfToken).toBeTruthy()
    const form = new URLSearchParams({
      transaction,
      csrf_token: csrfToken,
      id: 'alice',
      password: 'intentionally-wrong-password',
    })
    const missingReferer = await fetch(`${baseUrl}/account/logout/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: config.issuer,
      },
      body: form,
    })
    expect(missingReferer.status).toBe(403)
    const browserEquivalentPost = await fetch(`${baseUrl}/account/logout/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: config.issuer,
        referer: `${config.issuer}/account/logout?transaction=${encodeURIComponent(transaction)}`,
      },
      body: form,
    })
    expect(browserEquivalentPost.status).toBe(401)
    expect(await resource.db.get(
      `SELECT auth_generation FROM users WHERE id = 'alice'`,
    )).toEqual(before)
    expect(await resource.db.get(`SELECT COUNT(*) AS count FROM sessions WHERE user_id = 'alice'`))
      .toEqual({ count: 1 })
  })
})
