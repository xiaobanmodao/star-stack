import { afterEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import { openIdentityFixture, TEST_SUBJECTS } from './testIdentityFixture.js'
import { loadIdentityConfig } from './config.js'
import { createIdentityRouter } from './router.js'
import { createAccountCenterSession } from '../services/accountCenterSession.js'
import { MAX_ACTIVE_LOGIN_SESSIONS_PER_ACCOUNT_CLIENT } from './oidcFlow.js'

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

const authorizationRequestUrl = (overrides = {}) => {
  const params = new URLSearchParams({
    client_id: 'jieya-server-local',
    redirect_uri: 'http://jieya.localhost:4180/auth/callback',
    response_type: 'code',
    scope: 'openid profile offline_access',
    state: 'state-with-128-bits-of-randomness',
    nonce: 'nonce-with-128-bits-of-randomness',
    code_challenge: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    code_challenge_method: 'S256',
    ...overrides,
  })
  return `http://auth.localhost:5174/oauth2/auth?${params}`
}

const hydraLoginRequest = (challenge) => ({
  challenge,
  client: { client_id: 'jieya-server-local' },
  request_url: authorizationRequestUrl(),
  requested_scope: ['openid', 'profile', 'offline_access'],
  session_id: `hydra-session-${challenge}`,
  skip: false,
  subject: '',
})

const hydraConsentRequest = (challenge, overrides = {}) => ({
  challenge,
  client: { client_id: 'jieya-server-local' },
  request_url: authorizationRequestUrl(),
  requested_scope: ['openid', 'profile', 'offline_access'],
  requested_access_token_audience: [],
  login_challenge: 'login-challenge-for-consent',
  login_session_id: 'hydra-sid-for-consent',
  consent_request_id: 'consent-request-for-consent',
  subject: TEST_SUBJECTS.alice,
  skip: false,
  ...overrides,
})

const hiddenValue = (html, name) => html.match(
  new RegExp(`name="${name}" value="([^"]+)"`),
)?.[1]

const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
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
        OIDC_ISSUER: nodeEnv === 'production'
          ? 'https://auth.xingzhan.cc'
          : 'http://auth.localhost:5174',
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

  it('rate-limits one account across distributed sources before another bcrypt call', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    const comparePassword = vi.fn(async () => false)
    const challenge = 'distributed-account-password-limit'
    const admin = { getLoginRequest: vi.fn(async () => hydraLoginRequest(challenge)) }
    const { baseUrl, config } = await startRouter(resource, admin, {
      trustProxy: true,
      routerOptions: {
        comparePassword,
        limits: {
          passwordRate: {
            windowMs: 60_000,
            perAccountMax: 2,
            globalMax: 100,
            maxTrackedAccounts: 200,
          },
        },
      },
    })
    const page = await fetch(`${baseUrl}/account/login?login_challenge=${challenge}`)
    const csrfToken = hiddenValue(await page.text(), 'csrf_token')
    expect(csrfToken).toBeTruthy()
    const attempt = (index) => fetch(`${baseUrl}/account/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: config.issuer,
        referer: `${config.issuer}/account/login?login_challenge=${challenge}`,
        'x-forwarded-for': `198.51.100.${index}`,
      },
      body: new URLSearchParams({
        login_challenge: challenge,
        csrf_token: csrfToken,
        id: 'alice',
        password: 'wrong-password',
      }),
      redirect: 'manual',
    })

    expect((await attempt(1)).status).toBe(401)
    expect((await attempt(2)).status).toBe(401)
    expect((await attempt(3)).status).toBe(429)
    expect(comparePassword).toHaveBeenCalledTimes(2)
  })

  it('keeps SQLite-exact coexisting account IDs in separate password buckets', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    await resource.db.run(
      `INSERT INTO users
         (id, name, password_hash, email, email_verified_at, is_admin, is_banned,
          avatar, bio, avatar_frame, avatar_overlay, equipped_title, created_at,
          account_subject, account_status, account_tombstoned_at, auth_generation)
       VALUES
         ('Alice', 'Case-distinct Alice', 'fixture-case-hash', 'case-alice@example.test',
          '2026-01-01T00:00:00.000Z', 0, 0, NULL, '', 'none', 'none', NULL,
          '2026-01-01T00:00:00.000Z', '33333333-3333-4333-8333-333333333333',
          'active', NULL, 0)`,
    )
    const comparePassword = vi.fn(async () => false)
    const challenge = 'case-distinct-account-password-limit'
    const admin = { getLoginRequest: vi.fn(async () => hydraLoginRequest(challenge)) }
    const { baseUrl, config } = await startRouter(resource, admin, {
      routerOptions: {
        comparePassword,
        limits: {
          passwordRate: {
            windowMs: 60_000,
            perAccountMax: 1,
            globalMax: 10,
            maxTrackedAccounts: 20,
          },
        },
      },
    })
    const page = await fetch(`${baseUrl}/account/login?login_challenge=${challenge}`)
    const csrfToken = hiddenValue(await page.text(), 'csrf_token')
    const attempt = (id) => fetch(`${baseUrl}/account/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: config.issuer,
        referer: `${config.issuer}/account/login?login_challenge=${challenge}`,
      },
      body: new URLSearchParams({
        login_challenge: challenge,
        csrf_token: csrfToken,
        id,
        password: 'wrong-password',
      }),
    })

    expect((await attempt('alice')).status).toBe(401)
    expect((await attempt('alice')).status).toBe(429)
    expect((await attempt('Alice')).status).toBe(401)
    expect((await attempt('Alice')).status).toBe(429)
    expect(comparePassword).toHaveBeenCalledTimes(2)
  })

  it('rate-limits password POSTs globally across sources before another bcrypt call', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    const comparePassword = vi.fn(async () => false)
    const challenge = 'distributed-global-password-limit'
    const admin = { getLoginRequest: vi.fn(async () => hydraLoginRequest(challenge)) }
    const { baseUrl, config } = await startRouter(resource, admin, {
      trustProxy: true,
      routerOptions: {
        comparePassword,
        limits: {
          passwordRate: {
            windowMs: 60_000,
            perAccountMax: 100,
            globalMax: 2,
            maxTrackedAccounts: 4,
          },
        },
      },
    })
    const page = await fetch(`${baseUrl}/account/login?login_challenge=${challenge}`)
    const csrfToken = hiddenValue(await page.text(), 'csrf_token')
    expect(csrfToken).toBeTruthy()
    const attempt = (index) => fetch(`${baseUrl}/account/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: config.issuer,
        referer: `${config.issuer}/account/login?login_challenge=${challenge}`,
        'x-forwarded-for': `203.0.113.${index}`,
      },
      body: new URLSearchParams({
        login_challenge: challenge,
        csrf_token: csrfToken,
        id: 'alice',
        password: 'wrong-password',
      }),
      redirect: 'manual',
    })

    expect((await attempt(1)).status).toBe(401)
    expect((await attempt(2)).status).toBe(401)
    expect((await attempt(3)).status).toBe(429)
    expect(comparePassword).toHaveBeenCalledTimes(2)
  })

  it('does not spend password budget on invalid interaction or logout CSRF requests', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    const comparePassword = vi.fn(async () => false)
    const challenge = 'valid-after-invalid-csrf-flood'
    const admin = { getLoginRequest: vi.fn(async () => hydraLoginRequest(challenge)) }
    const { baseUrl, config } = await startRouter(resource, admin, {
      trustProxy: true,
      routerOptions: {
        comparePassword,
        limits: {
          passwordRate: {
            windowMs: 60_000,
            perAccountMax: 100,
            globalMax: 2,
            maxTrackedAccounts: 4,
          },
        },
      },
    })

    for (let index = 1; index <= 24; index += 1) {
      const invalidLogin = await fetch(`${baseUrl}/account/login`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin: config.issuer,
          referer: `${config.issuer}/account/login`,
          'x-forwarded-for': `198.18.0.${index}`,
        },
        body: new URLSearchParams({
          login_challenge: `missing-${index}`,
          csrf_token: `invalid-${index}`,
          id: 'alice',
          password: 'wrong-password',
        }),
      })
      expect(invalidLogin.status).toBe(403)

      const invalidLogout = await fetch(`${baseUrl}/account/logout/login`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin: config.issuer,
          referer: `${config.issuer}/account/logout`,
          'x-forwarded-for': `198.19.0.${index}`,
        },
        body: new URLSearchParams({
          transaction: `missing-${index}`,
          csrf_token: `invalid-${index}`,
          id: 'alice',
          password: 'wrong-password',
        }),
      })
      expect(invalidLogout.status).toBe(403)
    }
    expect(comparePassword).not.toHaveBeenCalled()

    const page = await fetch(`${baseUrl}/account/login?login_challenge=${challenge}`)
    const csrfToken = hiddenValue(await page.text(), 'csrf_token')
    const validAttempt = (index) => fetch(`${baseUrl}/account/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: config.issuer,
        referer: `${config.issuer}/account/login?login_challenge=${challenge}`,
        'x-forwarded-for': `203.0.113.${index}`,
      },
      body: new URLSearchParams({
        login_challenge: challenge,
        csrf_token: csrfToken,
        id: 'alice',
        password: 'wrong-password',
      }),
    })
    expect((await validAttempt(1)).status).toBe(401)
    expect((await validAttempt(2)).status).toBe(401)
    expect((await validAttempt(3)).status).toBe(429)
    expect(comparePassword).toHaveBeenCalledTimes(2)
  })

  it('revokes a newly minted account session without deleting a newer browser cookie when Hydra login acceptance fails', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    const challenge = 'failed-hydra-login-acceptance'
    const admin = {
      getLoginRequest: vi.fn(async () => hydraLoginRequest(challenge)),
      acceptLoginRequest: vi.fn(async () => { throw new Error('Hydra unavailable') }),
    }
    const { baseUrl, config } = await startRouter(resource, admin, {
      routerOptions: { comparePassword: vi.fn(async () => true) },
    })
    const page = await fetch(`${baseUrl}/account/login?login_challenge=${challenge}`)
    const csrfToken = hiddenValue(await page.text(), 'csrf_token')
    const response = await fetch(`${baseUrl}/account/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: config.issuer,
        referer: `${config.issuer}/account/login?login_challenge=${challenge}`,
      },
      body: new URLSearchParams({
        login_challenge: challenge,
        csrf_token: csrfToken,
        id: 'alice',
        password: 'correct-shaped-password',
      }),
      redirect: 'manual',
    })

    expect(response.status).toBe(400)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await resource.db.get(`SELECT COUNT(*) AS count FROM account_center_sessions`))
      .toEqual({ count: 0 })
  })

  it('does not let a late failed login response delete a later successful login cookie', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    const secondDb = await resource.openConnection()
    const failedChallenge = 'late-failed-login'
    const successfulChallenge = 'later-successful-login'
    const failureEntered = deferred()
    const releaseFailure = deferred()
    const failedAdmin = {
      getLoginRequest: vi.fn(async () => hydraLoginRequest(failedChallenge)),
      acceptLoginRequest: vi.fn(async () => {
        failureEntered.resolve()
        await releaseFailure.promise
        throw new Error('Hydra failed after another tab completed')
      }),
    }
    const successfulAdmin = {
      getLoginRequest: vi.fn(async () => hydraLoginRequest(successfulChallenge)),
      acceptLoginRequest: vi.fn(async () => ({
        redirect_to: 'http://jieya.localhost:4180/auth/callback?code=later-login',
      })),
    }
    const failedRouter = await startRouter(resource, failedAdmin, {
      routerOptions: {
        getPublicDb: async () => resource.db,
        comparePassword: vi.fn(async () => true),
      },
    })
    const successfulRouter = await startRouter(resource, successfulAdmin, {
      routerOptions: {
        getPublicDb: async () => secondDb,
        comparePassword: vi.fn(async () => true),
      },
    })
    const failedPage = await fetch(
      `${failedRouter.baseUrl}/account/login?login_challenge=${failedChallenge}`,
    )
    const successfulPage = await fetch(
      `${successfulRouter.baseUrl}/account/login?login_challenge=${successfulChallenge}`,
    )
    const submit = (router, challenge, csrfToken) => fetch(`${router.baseUrl}/account/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: router.config.issuer,
        referer: `${router.config.issuer}/account/login?login_challenge=${challenge}`,
      },
      body: new URLSearchParams({
        login_challenge: challenge,
        csrf_token: csrfToken,
        id: 'alice',
        password: 'correct-shaped-password',
      }),
      redirect: 'manual',
    })

    const failedRequest = submit(
      failedRouter,
      failedChallenge,
      hiddenValue(await failedPage.text(), 'csrf_token'),
    )
    await failureEntered.promise
    const successfulResponse = await submit(
      successfulRouter,
      successfulChallenge,
      hiddenValue(await successfulPage.text(), 'csrf_token'),
    )
    expect(successfulResponse.status).toBe(303)
    expect(successfulResponse.headers.get('set-cookie'))
      .toContain(`${successfulRouter.config.accountCookieName}=`)
    expect(successfulResponse.headers.get('set-cookie')).not.toContain('Max-Age=0')

    releaseFailure.resolve()
    const failedResponse = await failedRequest
    expect(failedResponse.status).toBe(400)
    expect(failedResponse.headers.get('set-cookie')).toBeNull()
    expect(await resource.db.get(`SELECT COUNT(*) AS count FROM account_center_sessions`))
      .toEqual({ count: 1 })
  })

  it.each([
    ['SID capacity rejection', true],
    ['Hydra consent failure', false],
  ])('revokes the provisional session on %s without emitting a stale cookie deletion', async (_label, fillSidCap) => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    const accountSession = await createAccountCenterSession(resource.db, {
      userId: 'alice',
      now: () => now,
      randomToken: () => `provisional-consent-token-${fillSidCap}`,
      randomCsrf: () => `provisional-consent-csrf-${fillSidCap}`,
    })
    if (fillSidCap) {
      for (let index = 0; index < MAX_ACTIVE_LOGIN_SESSIONS_PER_ACCOUNT_CLIENT; index += 1) {
        await resource.db.run(
          `INSERT INTO oidc_login_sessions
             (account_subject, client_id, sid, auth_generation, consent_request_id,
              status, created_at, updated_at, expires_at)
           VALUES (?, 'jieya-server-local', ?, 0, ?, 'active', ?, ?, ?)`,
          TEST_SUBJECTS.alice,
          `router-cap-sid-${index}`,
          `router-cap-consent-${index}`,
          now.toISOString(),
          now.toISOString(),
          '2026-09-29T00:00:00.000Z',
        )
      }
    }
    const challenge = `router-consent-${fillSidCap}`
    const admin = {
      getConsentRequest: vi.fn(async () => hydraConsentRequest(challenge)),
      revokeLoginSession: vi.fn(async () => undefined),
      rejectConsentRequest: vi.fn(async () => ({
        redirect_to: 'http://jieya.localhost:4180/auth/callback?error=temporarily_unavailable',
      })),
      acceptConsentRequest: vi.fn(async () => { throw new Error('Hydra consent unavailable') }),
    }
    const { baseUrl, config } = await startRouter(resource, admin)
    const cookie = `${config.accountCookieName}=${encodeURIComponent(accountSession.token)}`
    const page = await fetch(
      `${baseUrl}/account/consent?consent_challenge=${encodeURIComponent(challenge)}`,
      { headers: { cookie } },
    )
    expect(page.status).toBe(200)
    const csrfToken = hiddenValue(await page.text(), 'csrf_token')
    const response = await fetch(`${baseUrl}/account/consent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: config.issuer,
        referer: `${config.issuer}/account/consent?consent_challenge=${encodeURIComponent(challenge)}`,
        cookie,
      },
      body: new URLSearchParams({
        consent_challenge: challenge,
        csrf_token: csrfToken,
        decision: 'approve',
        offline_access_confirmed: 'yes',
      }),
      redirect: 'manual',
    })

    expect(response.status).toBe(fillSidCap ? 303 : 400)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await resource.db.get(`SELECT COUNT(*) AS count FROM account_center_sessions`))
      .toEqual({ count: 0 })
    if (fillSidCap) {
      expect(admin.acceptConsentRequest).not.toHaveBeenCalled()
      expect(admin.revokeLoginSession).toHaveBeenCalledTimes(1)
    }
  })

  it('does not let a late failed consent response delete a session established by another flow', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    const secondDb = await resource.openConnection()
    const accountSession = await createAccountCenterSession(resource.db, {
      userId: 'alice',
      now: () => now,
      randomToken: () => 'consent-race-account-token',
      randomCsrf: () => 'consent-race-account-csrf',
    })
    const failedChallenge = 'late-failed-consent'
    const successfulChallenge = 'later-successful-consent'
    const failureEntered = deferred()
    const releaseFailure = deferred()
    const failedAdmin = {
      getConsentRequest: vi.fn(async () => hydraConsentRequest(failedChallenge, {
        login_session_id: 'late-failed-consent-sid',
        consent_request_id: 'late-failed-consent-request',
      })),
      acceptConsentRequest: vi.fn(async () => {
        failureEntered.resolve()
        await releaseFailure.promise
        throw new Error('Hydra consent failed after another flow completed')
      }),
    }
    const successfulAdmin = {
      getConsentRequest: vi.fn(async () => hydraConsentRequest(successfulChallenge, {
        login_session_id: 'later-successful-consent-sid',
        consent_request_id: 'later-successful-consent-request',
      })),
      acceptConsentRequest: vi.fn(async () => ({
        redirect_to: 'http://jieya.localhost:4180/auth/callback?code=later-consent',
      })),
    }
    const failedRouter = await startRouter(resource, failedAdmin, {
      routerOptions: { getPublicDb: async () => resource.db },
    })
    const successfulRouter = await startRouter(resource, successfulAdmin, {
      routerOptions: { getPublicDb: async () => secondDb },
    })
    const cookie = `${failedRouter.config.accountCookieName}=${encodeURIComponent(accountSession.token)}`
    await fetch(
      `${failedRouter.baseUrl}/account/consent?consent_challenge=${failedChallenge}`,
      { headers: { cookie } },
    )
    const successfulPage = await fetch(
      `${successfulRouter.baseUrl}/account/consent?consent_challenge=${successfulChallenge}`,
      { headers: { cookie } },
    )
    const currentCsrf = hiddenValue(await successfulPage.text(), 'csrf_token')
    const submit = (router, challenge) => fetch(`${router.baseUrl}/account/consent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: router.config.issuer,
        referer: `${router.config.issuer}/account/consent?consent_challenge=${challenge}`,
        cookie,
      },
      body: new URLSearchParams({
        consent_challenge: challenge,
        csrf_token: currentCsrf,
        decision: 'approve',
        offline_access_confirmed: 'yes',
      }),
      redirect: 'manual',
    })

    const failedRequest = submit(failedRouter, failedChallenge)
    await failureEntered.promise
    const successfulResponse = await submit(successfulRouter, successfulChallenge)
    expect(successfulResponse.status).toBe(303)
    expect(successfulResponse.headers.get('set-cookie')).toBeNull()

    releaseFailure.resolve()
    const failedResponse = await failedRequest
    expect(failedResponse.status).toBe(400)
    expect(failedResponse.headers.get('set-cookie')).toBeNull()
    expect(await resource.db.get(
      `SELECT established_at FROM account_center_sessions WHERE account_subject = ?`,
      TEST_SUBJECTS.alice,
    )).toEqual({ established_at: now.toISOString() })
  })

  it('marks a provisional account session established only after consent succeeds', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    const accountSession = await createAccountCenterSession(resource.db, {
      userId: 'alice',
      now: () => now,
      randomToken: () => 'successful-consent-account-token',
      randomCsrf: () => 'successful-consent-account-csrf',
    })
    const challenge = 'successful-router-consent'
    const admin = {
      getConsentRequest: vi.fn(async () => hydraConsentRequest(challenge, {
        login_session_id: 'successful-consent-sid',
        consent_request_id: 'successful-consent-request',
      })),
      acceptConsentRequest: vi.fn(async () => ({
        redirect_to: 'http://jieya.localhost:4180/auth/callback?code=fixture',
      })),
    }
    const { baseUrl, config } = await startRouter(resource, admin)
    const cookie = `${config.accountCookieName}=${encodeURIComponent(accountSession.token)}`
    const page = await fetch(
      `${baseUrl}/account/consent?consent_challenge=${encodeURIComponent(challenge)}`,
      { headers: { cookie } },
    )
    const csrfToken = hiddenValue(await page.text(), 'csrf_token')
    const response = await fetch(`${baseUrl}/account/consent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: config.issuer,
        referer: `${config.issuer}/account/consent?consent_challenge=${encodeURIComponent(challenge)}`,
        cookie,
      },
      body: new URLSearchParams({
        consent_challenge: challenge,
        csrf_token: csrfToken,
        decision: 'approve',
        offline_access_confirmed: 'yes',
      }),
      redirect: 'manual',
    })

    expect(response.status).toBe(303)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await resource.db.get(
      `SELECT established_at FROM account_center_sessions`,
    )).toEqual({ established_at: now.toISOString() })
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

  it('does not let a late failed logout reauthentication delete a newer account cookie', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    const secondDb = await resource.openConnection()
    await resource.db.run(
      `INSERT INTO oidc_login_sessions
         (account_subject, client_id, sid, auth_generation, status,
          created_at, updated_at, expires_at)
       VALUES (?, 'jieya-server-local', 'logout-cookie-race-sid', 0, 'active', ?, ?, ?)`,
      TEST_SUBJECTS.alice,
      now.toISOString(),
      now.toISOString(),
      '2026-09-29T00:00:00.000Z',
    )
    const delayedCompareEntered = deferred()
    const releaseDelayedCompare = deferred()
    const delayedRouter = await startRouter(resource, {}, {
      routerOptions: {
        getPublicDb: async () => resource.db,
        comparePassword: vi.fn(async () => {
          delayedCompareEntered.resolve()
          await releaseDelayedCompare.promise
          return true
        }),
      },
    })
    const successfulRouter = await startRouter(resource, {}, {
      routerOptions: {
        getPublicDb: async () => secondDb,
        comparePassword: vi.fn(async () => true),
      },
    })
    const created = await fetch(
      `${delayedRouter.baseUrl}/internal/oidc/logout-transactions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-StarStack-Logout-Broker': env.OIDC_LOGOUT_BROKER_SECRET,
        },
        body: JSON.stringify({
          subject: TEST_SUBJECTS.alice,
          sid: 'logout-cookie-race-sid',
          client_id: 'jieya-server-local',
          state: 'logout-cookie-race-state',
        }),
      },
    )
    const transaction = new URL((await created.json()).url).searchParams.get('transaction')
    const page = await fetch(
      `${delayedRouter.baseUrl}/account/logout?transaction=${encodeURIComponent(transaction)}`,
    )
    const csrfToken = hiddenValue(await page.text(), 'csrf_token')
    const submit = (router) => fetch(`${router.baseUrl}/account/logout/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: router.config.issuer,
        referer: `${router.config.issuer}/account/logout?transaction=${encodeURIComponent(transaction)}`,
      },
      body: new URLSearchParams({
        transaction,
        csrf_token: csrfToken,
        id: 'alice',
        password: 'correct-shaped-password',
      }),
      redirect: 'manual',
    })

    const delayedRequest = submit(delayedRouter)
    await delayedCompareEntered.promise
    const successfulResponse = await submit(successfulRouter)
    expect(successfulResponse.status).toBe(303)
    expect(successfulResponse.headers.get('set-cookie'))
      .toContain(`${successfulRouter.config.accountCookieName}=`)
    expect(successfulResponse.headers.get('set-cookie')).not.toContain('Max-Age=0')

    releaseDelayedCompare.resolve()
    const delayedResponse = await delayedRequest
    expect(delayedResponse.status).toBe(400)
    expect(delayedResponse.headers.get('set-cookie')).toBeNull()
    expect(await resource.db.get(
      `SELECT COUNT(*) AS count FROM account_center_sessions WHERE established_at IS NOT NULL`,
    )).toEqual({ count: 1 })
  })
})
