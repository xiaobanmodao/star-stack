import { afterEach, describe, expect, it, vi } from 'vitest'
import { openIdentityFixture, TEST_SUBJECTS } from './testIdentityFixture.js'
import { createAccountCenterSession } from '../services/accountCenterSession.js'
import {
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
