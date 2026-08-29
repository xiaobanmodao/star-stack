import { afterEach, describe, expect, it } from 'vitest'
import { openIdentityFixture, TEST_SUBJECTS } from './testIdentityFixture.js'
import { TokenPolicyError, validateHydraTokenHook } from './tokenPolicy.js'

const resources = []
const now = new Date('2026-08-30T00:00:00.000Z')
const client = Object.freeze({
  id: 'jieya-server-local',
  allowedScopes: ['openid', 'profile', 'offline_access'],
  allowedGrantTypes: ['authorization_code', 'refresh_token'],
})

const makePayload = (overrides = {}) => ({
  session: {
    extra: {
      auth_generation: 0,
      grant_issued_at: '2026-08-01T00:00:00.000Z',
    },
    id_token: { subject: TEST_SUBJECTS.alice },
  },
  request: {
    client_id: client.id,
    grant_types: ['authorization_code'],
    requested_scopes: ['openid', 'profile', 'offline_access'],
    granted_scopes: ['openid', 'profile', 'offline_access'],
  },
  ...overrides,
})

afterEach(async () => {
  while (resources.length) await resources.pop().close()
})

describe('Hydra token hook policy', () => {
  it('allows a registered grant only for the current active account generation', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    await expect(validateHydraTokenHook(resource.db, makePayload(), {
      client,
      now: () => now,
    })).resolves.toEqual({ subject: TEST_SUBJECTS.alice, generation: 0 })

    const authorizationCodePayload = makePayload()
    authorizationCodePayload.request.granted_scopes = []
    await expect(validateHydraTokenHook(resource.db, authorizationCodePayload, {
      client,
      now: () => now,
    })).resolves.toEqual({ subject: TEST_SUBJECTS.alice, generation: 0 })
  })

  it.each([
    ['client', { request: { client_id: 'unknown', grant_types: ['authorization_code'], requested_scopes: ['openid'], granted_scopes: ['openid'] } }],
    ['grant', { request: { client_id: client.id, grant_types: ['client_credentials'], requested_scopes: ['openid'], granted_scopes: ['openid'] } }],
    ['scope', { request: { client_id: client.id, grant_types: ['authorization_code'], requested_scopes: ['openid', 'admin'], granted_scopes: ['openid', 'admin'] } }],
  ])('rejects an unregistered %s', async (_label, override) => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    await expect(validateHydraTokenHook(resource.db, makePayload(override), {
      client,
      now: () => now,
    })).rejects.toBeInstanceOf(TokenPolicyError)
  })

  it('rejects stale, mismatched, suspended and malformed account state', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)

    const stale = makePayload()
    stale.session.extra.grant_issued_at = '2026-07-30T23:59:59.000Z'
    await expect(validateHydraTokenHook(resource.db, stale, { client, now: () => now })).rejects.toThrow(/expired|期限|30/i)
    expect(await resource.db.get(
      `SELECT event_type, subject, client_id, status FROM identity_outbox`,
    )).toEqual({
      event_type: 'oidc.revoke_consent',
      subject: TEST_SUBJECTS.alice,
      client_id: client.id,
      status: 'pending',
    })

    const wrongGeneration = makePayload()
    wrongGeneration.session.extra.auth_generation = 1
    await expect(validateHydraTokenHook(resource.db, wrongGeneration, { client, now: () => now })).rejects.toThrow(/generation|世代/i)

    await resource.db.run(
      `UPDATE users SET account_status = 'suspended', is_banned = 1 WHERE id = 'alice'`,
    )
    await expect(validateHydraTokenHook(resource.db, makePayload(), { client, now: () => now })).rejects.toThrow(/active|状态/i)
    await expect(validateHydraTokenHook(resource.db, {}, { client, now: () => now })).rejects.toThrow(/malformed|格式|session/i)
  })
})
