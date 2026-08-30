import { afterEach, describe, expect, it } from 'vitest'
import { openIdentityFixture, TEST_SUBJECTS } from '../identity/testIdentityFixture.js'
import {
  ACCOUNT_CENTER_SESSION_LIMITS,
  createAccountCenterSession,
  establishAccountCenterSession,
  getAccountCenterSession,
  revokeAccountCenterSession,
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

  it('purges expired rows and evicts the oldest sessions before inserting within the per-account cap', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    const created = []
    for (let index = 0; index < ACCOUNT_CENTER_SESSION_LIMITS.perSubjectMax + 3; index += 1) {
      created.push(await createAccountCenterSession(resource.db, {
        userId: 'alice',
        now: () => new Date(now.getTime() + index * 1000),
        randomToken: () => `bounded-account-token-${index}`,
        randomCsrf: () => `bounded-account-csrf-${index}`,
      }))
    }
    await resource.db.run(
      `INSERT INTO account_center_sessions
         (token_hash, user_id, account_subject, auth_generation, csrf_hash,
          created_at, expires_at, last_seen_at, established_at)
       VALUES ('expired-row', 'alice', ?, 0, 'expired-csrf', ?, ?, ?, ?)`,
      TEST_SUBJECTS.alice,
      '2026-07-01T00:00:00.000Z',
      '2026-07-02T00:00:00.000Z',
      '2026-07-01T00:00:00.000Z',
      '2026-07-01T00:00:00.000Z',
    )

    await createAccountCenterSession(resource.db, {
      userId: 'alice',
      now: () => new Date(now.getTime() + 60_000),
      randomToken: () => 'bounded-account-token-final',
      randomCsrf: () => 'bounded-account-csrf-final',
    })

    expect(await resource.db.get(
      `SELECT COUNT(*) AS count FROM account_center_sessions WHERE account_subject = ?`,
      TEST_SUBJECTS.alice,
    )).toEqual({ count: ACCOUNT_CENTER_SESSION_LIMITS.perSubjectMax })
    expect(await resource.db.get(
      `SELECT COUNT(*) AS count FROM account_center_sessions WHERE token_hash = 'expired-row'`,
    )).toEqual({ count: 0 })
    await expect(getAccountCenterSession(resource.db, created[0].token, { now: () => now }))
      .resolves.toBeNull()
    await expect(getAccountCenterSession(
      resource.db,
      'bounded-account-token-final',
      { now: () => new Date(now.getTime() + 60_000) },
    )).resolves.toMatchObject({ subject: TEST_SUBJECTS.alice })
  })

  it('keeps the global cap while reserving one transactional slot for a normal login', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    const limits = { perSubjectMax: 4, globalMax: 4 }
    for (let index = 0; index < 2; index += 1) {
      await createAccountCenterSession(resource.db, {
        userId: 'alice',
        limits,
        now: () => new Date(now.getTime() + index * 1000),
        randomToken: () => `global-alice-token-${index}`,
        randomCsrf: () => `global-alice-csrf-${index}`,
      })
    }
    for (let index = 0; index < 2; index += 1) {
      await resource.db.run(
        `INSERT INTO account_center_sessions
           (token_hash, user_id, account_subject, auth_generation, csrf_hash,
            created_at, expires_at, last_seen_at, established_at)
         VALUES (?, 'banned', ?, 0, ?, ?, ?, ?, ?)`,
        `global-banned-token-${index}`,
        TEST_SUBJECTS.banned,
        `global-banned-csrf-${index}`,
        new Date(now.getTime() + (index + 2) * 1000).toISOString(),
        '2026-09-29T00:00:00.000Z',
        new Date(now.getTime() + (index + 2) * 1000).toISOString(),
        new Date(now.getTime() + (index + 2) * 1000).toISOString(),
      )
    }

    const newest = await createAccountCenterSession(resource.db, {
      userId: 'alice',
      limits,
      now: () => new Date(now.getTime() + 10_000),
      randomToken: () => 'global-newest-token',
      randomCsrf: () => 'global-newest-csrf',
    })

    expect(await resource.db.get(`SELECT COUNT(*) AS count FROM account_center_sessions`))
      .toEqual({ count: limits.globalMax })
    await expect(getAccountCenterSession(
      resource.db,
      newest.token,
      { now: () => new Date(now.getTime() + 10_000) },
    )).resolves.toMatchObject({ subject: TEST_SUBJECTS.alice })
  })

  it('enforces the per-account cap atomically across independent SQLite connections', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    const secondDb = await resource.openConnection()
    const limits = { perSubjectMax: 2, globalMax: 4 }
    await createAccountCenterSession(resource.db, {
      userId: 'alice',
      limits,
      now: () => now,
      randomToken: () => 'concurrent-seed-token',
      randomCsrf: () => 'concurrent-seed-csrf',
    })

    await Promise.all([
      createAccountCenterSession(resource.db, {
        userId: 'alice',
        limits,
        now: () => new Date(now.getTime() + 1000),
        randomToken: () => 'concurrent-token-a',
        randomCsrf: () => 'concurrent-csrf-a',
      }),
      createAccountCenterSession(secondDb, {
        userId: 'alice',
        limits,
        now: () => new Date(now.getTime() + 2000),
        randomToken: () => 'concurrent-token-b',
        randomCsrf: () => 'concurrent-csrf-b',
      }),
    ])

    expect(await resource.db.get(
      `SELECT COUNT(*) AS count FROM account_center_sessions WHERE account_subject = ?`,
      TEST_SUBJECTS.alice,
    )).toEqual({ count: limits.perSubjectMax })
  })

  it('marks only successful flows established and can revoke only a provisional session', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    const provisional = await createAccountCenterSession(resource.db, {
      userId: 'alice',
      now: () => now,
      randomToken: () => 'provisional-account-token',
      randomCsrf: () => 'provisional-account-csrf',
    })
    expect(await resource.db.get(
      `SELECT established_at FROM account_center_sessions`,
    )).toEqual({ established_at: null })

    await expect(establishAccountCenterSession(
      resource.db,
      provisional.token,
      { now: () => now },
    )).resolves.toBe(true)
    await expect(revokeAccountCenterSession(
      resource.db,
      provisional.token,
      { provisionalOnly: true },
    )).resolves.toBe(false)
    await expect(revokeAccountCenterSession(resource.db, provisional.token)).resolves.toBe(true)
    expect(await resource.db.get(`SELECT COUNT(*) AS count FROM account_center_sessions`))
      .toEqual({ count: 0 })
  })
})
