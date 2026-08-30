import { afterEach, describe, expect, it, vi } from 'vitest'
import { openIdentityFixture, TEST_SUBJECTS } from './testIdentityFixture.js'
import { UserInfoError, resolveUserInfo } from './userInfo.js'

const resources = []
const client = Object.freeze({
  id: 'jieya-server-local',
  allowedScopes: ['openid', 'profile', 'offline_access'],
})
const activeIntrospection = (overrides = {}) => ({
  active: true,
  client_id: client.id,
  sub: TEST_SUBJECTS.alice,
  scope: 'openid profile offline_access',
  token_use: 'access_token',
  ext: {
    auth_generation: 0,
    grant_issued_at: '2026-08-30T00:00:00.000Z',
  },
  ...overrides,
})
afterEach(async () => {
  while (resources.length) await resources.pop().close()
})

describe('custom UserInfo', () => {
  it('returns only the accepted public profile claims after private introspection', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    await resource.db.run(`UPDATE users SET is_admin = 1 WHERE id = 'alice'`)
    const admin = { introspectToken: vi.fn(async () => activeIntrospection()) }

    const result = await resolveUserInfo(resource.db, admin, 'opaque-access-token', { client })

    expect(result).toEqual({
      sub: TEST_SUBJECTS.alice,
      preferred_username: 'Alice',
      name: 'Alice',
      picture: 'data:image/png;base64,fixture',
    })
    expect(result).not.toHaveProperty('email')
    expect(result).not.toHaveProperty('is_admin')
    expect(result).not.toHaveProperty('auth_generation')
  })

  it.each([
    ['inactive', { active: false }],
    ['wrong client', { client_id: 'other-client' }],
    ['wrong scope', { scope: 'openid admin' }],
    ['wrong token use', { token_use: 'refresh_token' }],
    ['wrong generation', { ext: { auth_generation: 2, grant_issued_at: '2026-08-30T00:00:00.000Z' } }],
  ])('fails closed for %s introspection', async (_label, override) => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    const admin = { introspectToken: vi.fn(async () => activeIntrospection(override)) }
    await expect(resolveUserInfo(resource.db, admin, 'opaque-access-token', { client }))
      .rejects.toBeInstanceOf(UserInfoError)
  })

  it('fails closed when StarStack account is no longer active', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    await resource.db.run(
      `UPDATE users SET account_status = 'suspended', is_banned = 1 WHERE id = 'alice'`,
    )
    const admin = { introspectToken: vi.fn(async () => activeIntrospection()) }
    await expect(resolveUserInfo(resource.db, admin, 'opaque-access-token', { client }))
      .rejects.toThrow(/active|状态/i)
  })
})
