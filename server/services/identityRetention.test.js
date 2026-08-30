import { afterEach, describe, expect, it } from 'vitest'
import { openIdentityFixture, TEST_SUBJECTS } from '../identity/testIdentityFixture.js'
import { cleanupIdentityRetention } from './identityRetention.js'

const resources = []
const now = new Date('2026-08-30T00:00:00.000Z')

afterEach(async () => {
  while (resources.length) await resources.pop().close()
})

describe('identity session retention', () => {
  it('removes stale unaccepted and old revoked sids without dropping active or retryable revocations', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    const rows = [
      ['stale-pending', 'authorization_pending', '2026-08-29T23:30:00.000Z', '2026-09-29T23:30:00.000Z', null],
      ['old-revoked', 'revoked', '2026-07-01T00:00:00.000Z', '2026-07-31T00:00:00.000Z', '2026-07-01T00:00:00.000Z'],
      ['recent-revoked', 'revoked', '2026-08-29T00:00:00.000Z', '2026-09-28T00:00:00.000Z', '2026-08-29T00:00:00.000Z'],
      ['expired-active', 'active', '2026-07-01T00:00:00.000Z', '2026-08-29T23:59:59.000Z', null],
      ['old-active', 'active', '2026-07-01T00:00:00.000Z', '2026-08-31T00:00:00.000Z', null],
      ['retry-required', 'revocation_pending', '2026-07-01T00:00:00.000Z', '2026-07-31T00:00:00.000Z', null],
    ]
    for (const [sid, status, updatedAt, expiresAt, revokedAt] of rows) {
      await resource.db.run(
        `INSERT INTO oidc_login_sessions
           (account_subject, client_id, sid, auth_generation, status,
            created_at, updated_at, expires_at, revoked_at)
         VALUES (?, 'jieya-server-local', ?, 0, ?, ?, ?, ?, ?)`,
        TEST_SUBJECTS.alice,
        sid,
        status,
        updatedAt,
        updatedAt,
        expiresAt,
        revokedAt,
      )
    }

    const result = await cleanupIdentityRetention(resource.db, { now: () => now })

    expect(result).toEqual({ expiredActive: 1, staleAuthorizationPending: 1, oldRevoked: 1 })
    expect((await resource.db.all(
      `SELECT sid, status FROM oidc_login_sessions ORDER BY sid`,
    ))).toEqual([
      { sid: 'old-active', status: 'active' },
      { sid: 'recent-revoked', status: 'revoked' },
      { sid: 'retry-required', status: 'revocation_pending' },
    ])
  })
})
