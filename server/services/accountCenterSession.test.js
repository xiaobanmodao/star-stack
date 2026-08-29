import { afterEach, describe, expect, it } from 'vitest'
import { openIdentityFixture, TEST_SUBJECTS } from '../identity/testIdentityFixture.js'
import {
  createAccountCenterSession,
  getAccountCenterSession,
  verifyAccountCenterCsrf,
} from './accountCenterSession.js'

const resources = []
const now = new Date('2026-08-30T00:00:00.000Z')

afterEach(async () => {
  while (resources.length) await resources.pop().close()
})
describe('account-center session', () => {
  it('stores only hashes and binds the session to subject plus generation', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)

    const created = await createAccountCenterSession(resource.db, {
      userId: 'alice',
      now: () => now,
      randomToken: () => 'account-session-secret',
      randomCsrf: () => 'session-bound-csrf',
    })

    expect(created).toMatchObject({
      token: 'account-session-secret',
      csrfToken: 'session-bound-csrf',
      subject: TEST_SUBJECTS.alice,
      generation: 0,
    })
    const persisted = await resource.db.get(`SELECT * FROM account_center_sessions`)
    expect(JSON.stringify(persisted)).not.toContain('account-session-secret')
    expect(JSON.stringify(persisted)).not.toContain('session-bound-csrf')

    const session = await getAccountCenterSession(resource.db, created.token, { now: () => now })
    expect(session).toMatchObject({
      userId: 'alice',
      subject: TEST_SUBJECTS.alice,
      generation: 0,
      accountStatus: 'active',
    })
    expect(verifyAccountCenterCsrf(session, created.csrfToken)).toBe(true)
    expect(verifyAccountCenterCsrf(session, 'wrong-csrf')).toBe(false)
  })

  it('fails closed after generation changes, expiry, suspension or token corruption', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    const created = await createAccountCenterSession(resource.db, {
      userId: 'alice',
      now: () => now,
    })

    await resource.db.run(`UPDATE users SET auth_generation = 1 WHERE id = 'alice'`)
    await expect(getAccountCenterSession(resource.db, created.token, { now: () => now })).resolves.toBeNull()

    const expired = await createAccountCenterSession(resource.db, {
      userId: 'alice',
      now: () => new Date('2026-07-01T00:00:00.000Z'),
    })
    await expect(getAccountCenterSession(resource.db, expired.token, { now: () => now })).resolves.toBeNull()
    await expect(getAccountCenterSession(resource.db, 'not-a-valid-token', { now: () => now })).resolves.toBeNull()

    const suspended = await createAccountCenterSession(resource.db, {
      userId: 'alice',
      now: () => now,
    })
    await resource.db.run(
      `UPDATE users SET account_status = 'suspended', is_banned = 1 WHERE id = 'alice'`,
    )
    await expect(getAccountCenterSession(resource.db, suspended.token, { now: () => now })).resolves.toBeNull()
  })
})
