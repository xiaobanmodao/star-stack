import { afterEach, describe, expect, it, vi } from 'vitest'
import { openIdentityFixture, TEST_SUBJECTS } from './testIdentityFixture.js'
import { createAccountCenterSession } from '../services/accountCenterSession.js'
import { cleanupIdentityRetention } from '../services/identityRetention.js'
import {
  MAX_ACTIVE_LOGIN_SESSIONS_PER_ACCOUNT_CLIENT,
  OidcFlowError,
  acceptConsent,
  acceptLogin,
  prepareConsent,
  prepareLogin,
  rejectConsent,
} from './oidcFlow.js'

const resources = []
const now = new Date('2026-08-30T00:00:00.000Z')
const client = Object.freeze({
  id: 'jieya-server-local',
  redirectUri: 'http://jieya.localhost:4180/auth/callback',
  allowedScopes: ['openid', 'profile', 'offline_access'],
})

const requestUrl = (overrides = {}) => {
  const params = new URLSearchParams({
    client_id: client.id,
    redirect_uri: client.redirectUri,
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

const loginRequest = (overrides = {}) => ({
  challenge: 'login-challenge-1',
  client: { client_id: client.id },
  request_url: requestUrl(),
  requested_scope: ['openid', 'profile', 'offline_access'],
  session_id: 'hydra-sid-1',
  skip: false,
  subject: '',
  ...overrides,
})

const consentRequest = (overrides = {}) => ({
  challenge: 'consent-challenge-1',
  client: { client_id: client.id },
  request_url: requestUrl(),
  requested_scope: ['openid', 'profile', 'offline_access'],
  requested_access_token_audience: [],
  login_challenge: 'login-challenge-1',
  login_session_id: 'hydra-sid-1',
  consent_request_id: 'consent-request-1',
  subject: TEST_SUBJECTS.alice,
  skip: false,
  ...overrides,
})

const prepareFixture = async () => {
  const resource = await openIdentityFixture()
  resources.push(resource)
  const accountSession = await createAccountCenterSession(resource.db, {
    userId: 'alice',
    now: () => now,
    randomToken: () => 'account-session-secret',
    randomCsrf: () => 'session-bound-csrf',
  })
  return { resource, accountSession }
}

afterEach(async () => {
  while (resources.length) await resources.pop().close()
})

describe('Hydra login and consent adapter', () => {
  const interactionCapacity = 512

  const seedInteractions = async (db, count, { expiresAt = '2026-08-30T00:10:00.000Z' } = {}) => {
    await db.exec('BEGIN IMMEDIATE')
    try {
      for (let index = 0; index < count; index += 1) {
        await db.run(
          `INSERT INTO oidc_interactions
             (challenge_hash, interaction_type, client_id, status, created_at, expires_at)
           VALUES (?, 'login', ?, 'pending', ?, ?)`,
          `seed-${index}`,
          client.id,
          now.toISOString(),
          expiresAt,
        )
      }
      await db.exec('COMMIT')
    } catch (error) {
      await db.exec('ROLLBACK').catch(() => undefined)
      throw error
    }
  }

  it('fails closed when the live interaction capacity is exhausted', async () => {
    const { resource } = await prepareFixture()
    await seedInteractions(resource.db, interactionCapacity)
    const challenge = 'capacity-overflow-challenge'
    const admin = { getLoginRequest: vi.fn(async () => loginRequest({ challenge })) }

    await expect(prepareLogin(resource.db, admin, {
      challenge,
      accountSessionToken: null,
      client,
      now: () => now,
    })).rejects.toMatchObject({ code: 'INTERACTION_CAPACITY_EXCEEDED', status: 503 })
    expect(await resource.db.get('SELECT COUNT(*) AS count FROM oidc_interactions'))
      .toEqual({ count: interactionCapacity })
  })

  it('removes expired interactions before enforcing the capacity', async () => {
    const { resource } = await prepareFixture()
    await seedInteractions(resource.db, interactionCapacity, {
      expiresAt: '2026-08-29T23:59:59.000Z',
    })
    const challenge = 'after-expired-cleanup'
    const admin = { getLoginRequest: vi.fn(async () => loginRequest({ challenge })) }

    await expect(prepareLogin(resource.db, admin, {
      challenge,
      accountSessionToken: null,
      client,
      now: () => now,
    })).resolves.toMatchObject({ challenge })
    expect(await resource.db.get('SELECT COUNT(*) AS count FROM oidc_interactions'))
      .toEqual({ count: 1 })
  })

  it('keeps count and insert atomic across SQLite connections at the capacity boundary', async () => {
    const { resource } = await prepareFixture()
    await seedInteractions(resource.db, interactionCapacity - 1)
    const secondDb = await resource.openConnection()
    const challenges = ['capacity-race-a', 'capacity-race-b']
    const attempts = await Promise.allSettled(challenges.map((challenge, index) => prepareLogin(
      index === 0 ? resource.db : secondDb,
      { getLoginRequest: vi.fn(async () => loginRequest({ challenge })) },
      {
        challenge,
        accountSessionToken: null,
        client,
        now: () => now,
      },
    )))

    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(await resource.db.get('SELECT COUNT(*) AS count FROM oidc_interactions'))
      .toEqual({ count: interactionCapacity })
  })

  it('requires StarStack authentication and accepts login with only immutable subject data', async () => {
    const { resource, accountSession } = await prepareFixture()
    const admin = {
      getLoginRequest: vi.fn(async () => loginRequest()),
      acceptLoginRequest: vi.fn(async () => ({
        redirect_to: 'http://auth.localhost:5174/oauth2/auth?login_verifier=verifier',
      })),
    }

    const anonymous = await prepareLogin(resource.db, admin, {
      challenge: 'login-challenge-1',
      accountSessionToken: null,
      client,
      now: () => now,
    })
    expect(anonymous.requiresAuthentication).toBe(true)

    const result = await acceptLogin(resource.db, admin, {
      challenge: 'login-challenge-1',
      accountSessionToken: accountSession.token,
      client,
      now: () => now,
    })
    expect(result.redirectTo).toContain('/oauth2/auth?login_verifier=')
    expect(admin.acceptLoginRequest).toHaveBeenCalledWith('login-challenge-1', expect.objectContaining({
      subject: TEST_SUBJECTS.alice,
      remember: true,
      remember_for: 30 * 24 * 60 * 60,
      identity_provider_session_id: expect.stringMatching(/^[a-f0-9]{40}$/),
      context: expect.objectContaining({
        account_session_id: expect.stringMatching(/^[a-f0-9]{40}$/),
        auth_generation: 0,
      }),
    }))
    const loginPayload = admin.acceptLoginRequest.mock.calls[0][1]
    expect(loginPayload.identity_provider_session_id).toBe(loginPayload.context.account_session_id)
    expect(loginPayload.identity_provider_session_id).not.toBe(accountSession.token)
    expect(JSON.stringify(admin.acceptLoginRequest.mock.calls)).not.toContain('alice@example.test')
    expect(await resource.db.get(
      `SELECT status, account_subject FROM oidc_interactions WHERE interaction_type = 'login'`,
    )).toEqual({ status: 'accepted', account_subject: TEST_SUBJECTS.alice })
  })

  it('persists Hydra v26 long challenges while rejecting values beyond the protocol bound', async () => {
    const { resource } = await prepareFixture()
    const longChallenge = 'a'.repeat(600)
    const admin = { getLoginRequest: vi.fn(async () => loginRequest({ challenge: longChallenge })) }

    await expect(prepareLogin(resource.db, admin, {
      challenge: longChallenge,
      accountSessionToken: null,
      client,
      now: () => now,
    })).resolves.toMatchObject({ challenge: longChallenge, requiresAuthentication: true })
    expect(await resource.db.get(`SELECT COUNT(*) AS count FROM oidc_interactions`))
      .toEqual({ count: 1 })
    await expect(prepareLogin(resource.db, admin, {
      challenge: 'b'.repeat(2049),
      accountSessionToken: null,
      client,
      now: () => now,
    })).rejects.toThrow(/challenge|格式/i)
  })

  it('never trusts Hydra skip without matching the current account-center session', async () => {
    const { resource, accountSession } = await prepareFixture()
    const admin = {
      getLoginRequest: vi.fn(async () => loginRequest({
        skip: true,
        subject: TEST_SUBJECTS.banned,
      })),
      acceptLoginRequest: vi.fn(),
    }

    await expect(acceptLogin(resource.db, admin, {
      challenge: 'login-challenge-1',
      accountSessionToken: accountSession.token,
      client,
      now: () => now,
    })).rejects.toThrow(/skip|subject|账号|匹配/i)
    expect(admin.acceptLoginRequest).not.toHaveBeenCalled()
  })

  it('requires explicit offline consent and persists the Hydra sid only after acceptance', async () => {
    const { resource, accountSession } = await prepareFixture()
    const admin = {
      getConsentRequest: vi.fn(async () => consentRequest()),
      acceptConsentRequest: vi.fn(async () => ({
        redirect_to: 'http://auth.localhost:5174/oauth2/auth?consent_verifier=verifier',
      })),
    }

    const prepared = await prepareConsent(resource.db, admin, {
      challenge: 'consent-challenge-1',
      accountSessionToken: accountSession.token,
      client,
      now: () => now,
    })
    expect(prepared).toMatchObject({
      requestedScopes: ['openid', 'profile', 'offline_access'],
      offlineAccessRequested: true,
    })
    await expect(acceptConsent(resource.db, admin, {
      challenge: 'consent-challenge-1',
      accountSessionToken: accountSession.token,
      offlineAccessConfirmed: false,
      client,
      now: () => now,
    })).rejects.toThrow(/offline_access|确认/i)
    expect(admin.acceptConsentRequest).not.toHaveBeenCalled()

    const result = await acceptConsent(resource.db, admin, {
      challenge: 'consent-challenge-1',
      accountSessionToken: accountSession.token,
      offlineAccessConfirmed: true,
      client,
      now: () => now,
    })
    expect(result.redirectTo).toContain('consent_verifier=')
    const payload = admin.acceptConsentRequest.mock.calls[0][1]
    expect(payload.grant_scope).toEqual(['openid', 'profile', 'offline_access'])
    expect(payload.session.access_token).toEqual({
      auth_generation: 0,
      grant_issued_at: now.toISOString(),
    })
    expect(payload.session.id_token).toMatchObject({ name: 'Alice', preferred_username: 'Alice' })
    expect(payload.session.id_token).not.toHaveProperty('auth_generation')
    expect(payload.session.id_token).not.toHaveProperty('email')
    expect(await resource.db.get(
      `SELECT account_subject, client_id, sid, auth_generation, status
       FROM oidc_login_sessions WHERE sid = 'hydra-sid-1'`,
    )).toEqual({
      account_subject: TEST_SUBJECTS.alice,
      client_id: client.id,
      sid: 'hydra-sid-1',
      auth_generation: 0,
      status: 'active',
    })

    await expect(acceptConsent(resource.db, admin, {
      challenge: 'consent-challenge-1',
      accountSessionToken: accountSession.token,
      offlineAccessConfirmed: true,
      client,
      now: () => now,
    })).rejects.toBeInstanceOf(OidcFlowError)
    expect(admin.acceptConsentRequest).toHaveBeenCalledTimes(1)
  })

  it('fails closed at the per-account/client active sid cap without accepting another grant', async () => {
    const { resource, accountSession } = await prepareFixture()
    for (let index = 0; index < MAX_ACTIVE_LOGIN_SESSIONS_PER_ACCOUNT_CLIENT; index += 1) {
      await resource.db.run(
        `INSERT INTO oidc_login_sessions
           (account_subject, client_id, sid, auth_generation, consent_request_id,
            status, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, 0, ?, 'active', ?, ?, ?)`,
        TEST_SUBJECTS.alice,
        client.id,
        `existing-sid-${index}`,
        `existing-consent-${index}`,
        now.toISOString(),
        now.toISOString(),
        '2026-09-29T00:00:00.000Z',
      )
    }
    const challenge = 'consent-capacity-overflow'
    const admin = {
      getConsentRequest: vi.fn(async () => consentRequest({
        challenge,
        login_session_id: 'overflow-sid',
        consent_request_id: 'overflow-consent',
      })),
      acceptConsentRequest: vi.fn(),
      revokeLoginSession: vi.fn(async () => undefined),
      rejectConsentRequest: vi.fn(async () => ({
        redirect_to: 'http://auth.localhost:5174/oauth2/auth?error=temporarily_unavailable',
      })),
    }

    await expect(acceptConsent(resource.db, admin, {
      challenge,
      accountSessionToken: accountSession.token,
      offlineAccessConfirmed: true,
      client,
      now: () => now,
    })).resolves.toMatchObject({
      redirectTo: expect.stringContaining('error=temporarily_unavailable'),
      capacityRejected: true,
    })
    expect(admin.acceptConsentRequest).not.toHaveBeenCalled()
    expect(admin.revokeLoginSession).toHaveBeenCalledWith('overflow-sid')
    expect(admin.rejectConsentRequest).toHaveBeenCalledWith(challenge, {
      error: 'temporarily_unavailable',
      error_description: 'The account has too many active application sessions.',
    })
    expect(await resource.db.get(
      `SELECT COUNT(*) AS count FROM oidc_login_sessions
       WHERE account_subject = ? AND client_id = ? AND status <> 'revoked'`,
      TEST_SUBJECTS.alice,
      client.id,
    )).toEqual({ count: MAX_ACTIVE_LOGIN_SESSIONS_PER_ACCOUNT_CLIENT })
    expect(await resource.db.get(
      `SELECT status FROM oidc_interactions WHERE challenge_hash IS NOT NULL`,
    )).toEqual({ status: 'rejected' })
  })

  it('atomically admits only one consent when concurrent sids race at the cap boundary', async () => {
    const { resource, accountSession } = await prepareFixture()
    for (let index = 0; index < MAX_ACTIVE_LOGIN_SESSIONS_PER_ACCOUNT_CLIENT - 1; index += 1) {
      await resource.db.run(
        `INSERT INTO oidc_login_sessions
           (account_subject, client_id, sid, auth_generation, consent_request_id,
            status, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, 0, ?, 'active', ?, ?, ?)`,
        TEST_SUBJECTS.alice,
        client.id,
        `boundary-sid-${index}`,
        `boundary-consent-${index}`,
        now.toISOString(),
        now.toISOString(),
        '2026-09-29T00:00:00.000Z',
      )
    }
    const secondDb = await resource.openConnection()
    const attempts = ['a', 'b'].map((suffix, index) => {
      const challenge = `consent-capacity-${suffix}`
      const admin = {
        getConsentRequest: vi.fn(async () => consentRequest({
          challenge,
          login_session_id: `racing-sid-${suffix}`,
          consent_request_id: `racing-consent-${suffix}`,
        })),
        acceptConsentRequest: vi.fn(async () => ({
          redirect_to: `http://auth.localhost:5174/oauth2/auth?consent_verifier=${suffix}`,
        })),
        revokeLoginSession: vi.fn(async () => undefined),
        rejectConsentRequest: vi.fn(async () => ({
          redirect_to: `http://auth.localhost:5174/oauth2/auth?error=temporarily_unavailable&attempt=${suffix}`,
        })),
      }
      return {
        admin,
        promise: acceptConsent(index === 0 ? resource.db : secondDb, admin, {
          challenge,
          accountSessionToken: accountSession.token,
          offlineAccessConfirmed: true,
          client,
          now: () => now,
        }),
      }
    })

    const results = await Promise.all(attempts.map(({ promise }) => promise))
    expect(results.filter((result) => result.capacityRejected)).toHaveLength(1)
    expect(attempts.reduce(
      (count, { admin }) => count + admin.acceptConsentRequest.mock.calls.length,
      0,
    )).toBe(1)
    expect(attempts.reduce(
      (count, { admin }) => count + admin.revokeLoginSession.mock.calls.length,
      0,
    )).toBe(1)
    expect(await resource.db.get(
      `SELECT COUNT(*) AS count FROM oidc_login_sessions
       WHERE account_subject = ? AND client_id = ? AND status <> 'revoked'`,
      TEST_SUBJECTS.alice,
      client.id,
    )).toEqual({ count: MAX_ACTIVE_LOGIN_SESSIONS_PER_ACCOUNT_CLIENT })
  })

  it('extends an existing active sid reservation before a slow Hydra consent call', async () => {
    const { resource, accountSession } = await prepareFixture()
    await resource.db.run(
      `INSERT INTO oidc_login_sessions
         (account_subject, client_id, sid, auth_generation, consent_request_id,
          status, created_at, updated_at, expires_at)
       VALUES (?, ?, 'hydra-sid-1', 0, 'older-consent', 'active', ?, ?, ?)`,
      TEST_SUBJECTS.alice,
      client.id,
      now.toISOString(),
      now.toISOString(),
      new Date(now.getTime() + 1000).toISOString(),
    )
    const cleanupDb = await resource.openConnection()
    let signalHydra
    let releaseHydra
    const hydraEntered = new Promise((resolve) => { signalHydra = resolve })
    const hydraRelease = new Promise((resolve) => { releaseHydra = resolve })
    const admin = {
      getConsentRequest: vi.fn(async () => consentRequest()),
      acceptConsentRequest: vi.fn(async () => {
        signalHydra()
        await hydraRelease
        return { redirect_to: 'http://auth.localhost:5174/oauth2/auth?consent_verifier=slow' }
      }),
    }

    const acceptance = acceptConsent(resource.db, admin, {
      challenge: 'consent-challenge-1',
      accountSessionToken: accountSession.token,
      offlineAccessConfirmed: true,
      client,
      now: () => now,
    })
    await hydraEntered
    const cleanup = await cleanupIdentityRetention(cleanupDb, {
      now: () => new Date(now.getTime() + 2000),
    })
    releaseHydra()
    await expect(acceptance).resolves.toMatchObject({
      redirectTo: expect.stringContaining('consent_verifier=slow'),
    })

    expect(cleanup.expiredActive).toBe(0)
    expect(await resource.db.get(
      `SELECT status, expires_at FROM oidc_login_sessions WHERE sid = 'hydra-sid-1'`,
    )).toEqual({ status: 'active', expires_at: '2026-09-29T00:00:00.000Z' })
  })

  it('lets the authenticated resource owner deny consent without creating an OIDC session', async () => {
    const { resource, accountSession } = await prepareFixture()
    const admin = {
      getConsentRequest: vi.fn(async () => consentRequest()),
      rejectConsentRequest: vi.fn(async () => ({
        redirect_to: 'http://auth.localhost:5174/oauth2/auth?error=access_denied',
      })),
    }

    const result = await rejectConsent(resource.db, admin, {
      challenge: 'consent-challenge-1',
      accountSessionToken: accountSession.token,
      client,
      now: () => now,
    })

    expect(result.redirectTo).toContain('error=access_denied')
    expect(admin.rejectConsentRequest).toHaveBeenCalledWith('consent-challenge-1', {
      error: 'access_denied',
      error_description: 'The resource owner denied the request.',
    })
    expect(await resource.db.get(`SELECT COUNT(*) AS count FROM oidc_login_sessions`))
      .toEqual({ count: 0 })
    expect(await resource.db.get(
      `SELECT status FROM oidc_interactions WHERE interaction_type = 'consent'`,
    )).toEqual({ status: 'rejected' })
  })
})
