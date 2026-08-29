import { afterEach, describe, expect, it } from 'vitest'
import { openIdentityFixture, TEST_SUBJECTS } from '../identity/testIdentityFixture.js'
import { createAccountCenterSession } from './accountCenterSession.js'
import {
  LogoutBrokerError,
  bindLogoutTransaction,
  confirmLogoutTransaction,
  createLogoutTransaction,
} from './logoutBroker.js'
import { MAX_UNRESOLVED_IDENTITY_OUTBOX_EVENTS_PER_GENERATION } from './identityOutboxStore.js'

const resources = []
const now = new Date('2026-08-30T00:00:00.000Z')
const client = Object.freeze({
  id: 'jieya-server-local',
  logoutCallbackUri: 'http://jieya.localhost:4180/auth/logout/callback',
})

const prepare = async () => {
  const resource = await openIdentityFixture()
  resources.push(resource)
  const accountSession = await createAccountCenterSession(resource.db, {
    userId: 'alice',
    now: () => now,
    randomToken: () => 'account-session-secret',
    randomCsrf: () => 'session-bound-csrf',
  })
  await resource.db.run(
    `INSERT INTO oidc_login_sessions
       (account_subject, client_id, sid, auth_generation, consent_request_id,
        status, created_at, updated_at, expires_at)
     VALUES (?, ?, ?, 0, ?, 'active', ?, ?, ?)`,
    TEST_SUBJECTS.alice,
    client.id,
    'hydra-sid-1',
    'consent-request-1',
    now.toISOString(),
    now.toISOString(),
    '2026-09-29T00:00:00.000Z',
  )
  await resource.db.run(
    `INSERT INTO oidc_login_sessions
       (account_subject, client_id, sid, auth_generation, consent_request_id,
        status, created_at, updated_at, expires_at)
     VALUES (?, ?, ?, 0, ?, 'active', ?, ?, ?)`,
    TEST_SUBJECTS.alice,
    client.id,
    'hydra-sid-2',
    'consent-request-2',
    now.toISOString(),
    now.toISOString(),
    '2026-09-29T00:00:00.000Z',
  )
  return { resource, accountSession }
}

afterEach(async () => {
  while (resources.length) await resources.pop().close()
})

describe('StarStack logout broker', () => {
  it('creates an opaque transaction only for a registered subject/client/sid binding', async () => {
    const { resource } = await prepare()
    const created = await createLogoutTransaction(resource.db, {
      subject: TEST_SUBJECTS.alice,
      clientId: client.id,
      sid: 'hydra-sid-1',
      state: 'jieya-logout-state',
    }, {
      client,
      issuer: 'http://auth.localhost:5174',
      now: () => now,
      randomToken: () => 'logout-transaction-secret',
    })

    expect(created.url).toBe('http://auth.localhost:5174/account/logout?transaction=logout-transaction-secret')
    expect(created.url).not.toContain('jieya-logout-state')
    expect(JSON.stringify(await resource.db.get(`SELECT * FROM oidc_logout_transactions`)))
      .not.toContain('logout-transaction-secret')

    await expect(createLogoutTransaction(resource.db, {
      subject: TEST_SUBJECTS.alice,
      clientId: client.id,
      sid: 'not-bound',
      state: 'another-state',
    }, { client, issuer: 'http://auth.localhost:5174', now: () => now }))
      .rejects.toBeInstanceOf(LogoutBrokerError)
  })

  it('binds GET without side effects, then consumes POST exactly once', async () => {
    const { resource, accountSession } = await prepare()
    const created = await createLogoutTransaction(resource.db, {
      subject: TEST_SUBJECTS.alice,
      clientId: client.id,
      sid: 'hydra-sid-1',
      state: 'jieya-logout-state',
    }, {
      client,
      issuer: 'http://auth.localhost:5174',
      now: () => now,
      randomToken: () => 'logout-transaction-secret',
    })

    const bound = await bindLogoutTransaction(resource.db, {
      transactionToken: created.token,
      accountSessionToken: accountSession.token,
    }, { now: () => now })
    expect(bound).toMatchObject({ subject: TEST_SUBJECTS.alice, clientId: client.id })
    expect(await resource.db.get(
      `SELECT auth_generation FROM users WHERE id = 'alice'`,
    )).toEqual({ auth_generation: 0 })
    expect(await resource.db.get(`SELECT COUNT(*) AS count FROM sessions WHERE user_id = 'alice'`)).toEqual({ count: 1 })

    const confirmed = await confirmLogoutTransaction(resource.db, {
      transactionToken: created.token,
      accountSessionToken: accountSession.token,
      csrfToken: accountSession.csrfToken,
      origin: 'http://auth.localhost:5174',
      referer: 'http://auth.localhost:5174/account/logout?transaction=logout-transaction-secret',
    }, {
      client,
      expectedOrigin: 'http://auth.localhost:5174',
      now: () => now,
    })
    expect(confirmed.redirectTo).toBe(
      'http://jieya.localhost:4180/auth/logout/callback?state=jieya-logout-state',
    )
    expect(await resource.db.get(
      `SELECT auth_generation FROM users WHERE id = 'alice'`,
    )).toEqual({ auth_generation: 1 })
    expect(await resource.db.get(`SELECT COUNT(*) AS count FROM sessions WHERE user_id = 'alice'`)).toEqual({ count: 0 })
    expect(await resource.db.get(`SELECT COUNT(*) AS count FROM account_center_sessions`)).toEqual({ count: 0 })
    expect(await resource.db.get(
      `SELECT status FROM oidc_login_sessions WHERE sid = 'hydra-sid-1'`,
    )).toEqual({ status: 'revocation_pending' })
    expect(await resource.db.get(
      `SELECT status FROM oidc_logout_transactions`,
    )).toEqual({ status: 'consumed' })
    expect(await resource.db.all(
      `SELECT event_type, sid, status FROM identity_outbox ORDER BY event_type, sid`,
    )).toEqual([
      { event_type: 'oidc.revoke_consent', sid: null, status: 'pending' },
      { event_type: 'oidc.revoke_session', sid: 'hydra-sid-1', status: 'pending' },
      { event_type: 'oidc.revoke_session', sid: 'hydra-sid-2', status: 'pending' },
    ])

    await expect(confirmLogoutTransaction(resource.db, {
      transactionToken: created.token,
      accountSessionToken: accountSession.token,
      csrfToken: accountSession.csrfToken,
      origin: 'http://auth.localhost:5174',
      referer: 'http://auth.localhost:5174/account/logout',
    }, { client, expectedOrigin: 'http://auth.localhost:5174', now: () => now }))
      .rejects.toThrow(/consumed|重复|session|会话/i)
    expect(await resource.db.get(
      `SELECT auth_generation FROM users WHERE id = 'alice'`,
    )).toEqual({ auth_generation: 1 })
  })

  it('rolls back the logout transaction when the account generation CAS is lost', async () => {
    const { resource, accountSession } = await prepare()
    const created = await createLogoutTransaction(resource.db, {
      subject: TEST_SUBJECTS.alice,
      clientId: client.id,
      sid: 'hydra-sid-1',
      state: 'cas-lost-state',
    }, {
      client,
      issuer: 'http://auth.localhost:5174',
      now: () => now,
      randomToken: () => 'cas-lost-transaction',
    })
    await bindLogoutTransaction(resource.db, {
      transactionToken: created.token,
      accountSessionToken: accountSession.token,
    }, { now: () => now })

    const originalRun = resource.db.run.bind(resource.db)
    resource.db.run = async (sql, ...params) => (
      /UPDATE users SET auth_generation/.test(sql)
        ? { changes: 0 }
        : originalRun(sql, ...params)
    )
    try {
      await expect(confirmLogoutTransaction(resource.db, {
        transactionToken: created.token,
        accountSessionToken: accountSession.token,
        csrfToken: accountSession.csrfToken,
        origin: 'http://auth.localhost:5174',
        referer: 'http://auth.localhost:5174/account/logout',
      }, { client, expectedOrigin: 'http://auth.localhost:5174', now: () => now }))
        .rejects.toThrow(/race|世代|变化|重试/i)
    } finally {
      resource.db.run = originalRun
    }

    expect(await resource.db.get(
      `SELECT auth_generation FROM users WHERE id = 'alice'`,
    )).toEqual({ auth_generation: 0 })
    expect(await resource.db.get(`SELECT status FROM oidc_logout_transactions`))
      .toEqual({ status: 'bound' })
    expect(await resource.db.get(`SELECT COUNT(*) AS count FROM account_center_sessions`))
      .toEqual({ count: 1 })
    expect(await resource.db.get(`SELECT COUNT(*) AS count FROM identity_outbox`))
      .toEqual({ count: 0 })
  })

  it('fails closed and remains retry-idempotent when one logout generation reaches the outbox cap', async () => {
    const { resource, accountSession } = await prepare()
    const created = await createLogoutTransaction(resource.db, {
      subject: TEST_SUBJECTS.alice,
      clientId: client.id,
      sid: 'hydra-sid-1',
      state: 'outbox-cap-state',
    }, {
      client,
      issuer: 'http://auth.localhost:5174',
      now: () => now,
      randomToken: () => 'outbox-cap-transaction',
    })
    await bindLogoutTransaction(resource.db, {
      transactionToken: created.token,
      accountSessionToken: accountSession.token,
    }, { now: () => now })
    const existingCount = MAX_UNRESOLVED_IDENTITY_OUTBOX_EVENTS_PER_GENERATION - 2
    for (let index = 0; index < existingCount; index += 1) {
      await resource.db.run(
        `INSERT INTO identity_outbox
           (id, event_type, subject, client_id, sid, payload_json, status, attempts,
            next_attempt_at, dedupe_key, created_at, updated_at)
         VALUES (?, 'oidc.revoke_session', ?, 'fixture-client', ?, ?, 'pending', 0,
                 ?, ?, ?, ?)`,
        `existing-cap-${index}`,
        TEST_SUBJECTS.alice,
        `existing-cap-sid-${index}`,
        JSON.stringify({ generation: 1 }),
        now.toISOString(),
        `existing-cap-dedupe-${index}`,
        now.toISOString(),
        now.toISOString(),
      )
    }
    const confirm = () => confirmLogoutTransaction(resource.db, {
      transactionToken: created.token,
      accountSessionToken: accountSession.token,
      csrfToken: accountSession.csrfToken,
      origin: 'http://auth.localhost:5174',
      referer: 'http://auth.localhost:5174/account/logout',
    }, { client, expectedOrigin: 'http://auth.localhost:5174', now: () => now })

    await expect(confirm()).rejects.toThrow(/capacity|outbox|容量|上限/i)
    await expect(confirm()).rejects.toThrow(/capacity|outbox|容量|上限/i)

    expect(await resource.db.get(
      `SELECT auth_generation FROM users WHERE id = 'alice'`,
    )).toEqual({ auth_generation: 0 })
    expect(await resource.db.get(`SELECT status FROM oidc_logout_transactions`))
      .toEqual({ status: 'bound' })
    expect(await resource.db.get(`SELECT COUNT(*) AS count FROM account_center_sessions`))
      .toEqual({ count: 1 })
    expect(await resource.db.get(
      `SELECT COUNT(*) AS count FROM oidc_login_sessions WHERE status = 'active'`,
    )).toEqual({ count: 2 })
    expect(await resource.db.get(`SELECT COUNT(*) AS count FROM identity_outbox`))
      .toEqual({ count: existingCount })
  })

  it('rejects legacy sid fan-out above the generation cap before changing account state', async () => {
    const { resource, accountSession } = await prepare()
    for (let index = 2; index <= MAX_UNRESOLVED_IDENTITY_OUTBOX_EVENTS_PER_GENERATION; index += 1) {
      await resource.db.run(
        `INSERT INTO oidc_login_sessions
           (account_subject, client_id, sid, auth_generation, consent_request_id,
            status, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, 0, ?, 'active', ?, ?, ?)`,
        TEST_SUBJECTS.alice,
        client.id,
        `legacy-amplification-sid-${index}`,
        `legacy-amplification-consent-${index}`,
        now.toISOString(),
        now.toISOString(),
        '2026-09-29T00:00:00.000Z',
      )
    }
    const created = await createLogoutTransaction(resource.db, {
      subject: TEST_SUBJECTS.alice,
      clientId: client.id,
      sid: 'hydra-sid-1',
      state: 'legacy-fanout-state',
    }, {
      client,
      issuer: 'http://auth.localhost:5174',
      now: () => now,
      randomToken: () => 'legacy-fanout-transaction',
    })
    await bindLogoutTransaction(resource.db, {
      transactionToken: created.token,
      accountSessionToken: accountSession.token,
    }, { now: () => now })

    const originalAll = resource.db.all.bind(resource.db)
    let sessionEnumerationSql = ''
    resource.db.all = async (sql, ...params) => {
      if (/FROM oidc_login_sessions/.test(sql)) sessionEnumerationSql = sql
      return originalAll(sql, ...params)
    }
    try {
      await expect(confirmLogoutTransaction(resource.db, {
        transactionToken: created.token,
        accountSessionToken: accountSession.token,
        csrfToken: accountSession.csrfToken,
        origin: 'http://auth.localhost:5174',
        referer: 'http://auth.localhost:5174/account/logout',
      }, { client, expectedOrigin: 'http://auth.localhost:5174', now: () => now }))
        .rejects.toThrow(/capacity|outbox|容量|上限/i)
    } finally {
      resource.db.all = originalAll
    }

    expect(sessionEnumerationSql).toMatch(/LIMIT\s+\?/i)
    expect(await resource.db.get(
      `SELECT auth_generation FROM users WHERE id = 'alice'`,
    )).toEqual({ auth_generation: 0 })
    expect(await resource.db.get(`SELECT status FROM oidc_logout_transactions`))
      .toEqual({ status: 'bound' })
    expect(await resource.db.get(`SELECT COUNT(*) AS count FROM identity_outbox`))
      .toEqual({ count: 0 })
    expect(await resource.db.get(
      `SELECT COUNT(*) AS count FROM oidc_login_sessions WHERE status = 'active'`,
    )).toEqual({ count: MAX_UNRESOLVED_IDENTITY_OUTBOX_EVENTS_PER_GENERATION + 1 })
  })

  it.each([
    ['origin', { origin: 'https://attacker.example', referer: 'http://auth.localhost:5174/account/logout' }],
    ['referer', { origin: 'http://auth.localhost:5174', referer: 'https://attacker.example/logout' }],
    ['csrf', { origin: 'http://auth.localhost:5174', referer: 'http://auth.localhost:5174/account/logout', csrfToken: 'wrong' }],
  ])('rejects an invalid %s before changing account state', async (_label, override) => {
    const { resource, accountSession } = await prepare()
    const created = await createLogoutTransaction(resource.db, {
      subject: TEST_SUBJECTS.alice,
      clientId: client.id,
      sid: 'hydra-sid-1',
      state: `state-${_label}`,
    }, { client, issuer: 'http://auth.localhost:5174', now: () => now })
    await bindLogoutTransaction(resource.db, {
      transactionToken: created.token,
      accountSessionToken: accountSession.token,
    }, { now: () => now })

    await expect(confirmLogoutTransaction(resource.db, {
      transactionToken: created.token,
      accountSessionToken: accountSession.token,
      csrfToken: accountSession.csrfToken,
      ...override,
    }, { client, expectedOrigin: 'http://auth.localhost:5174', now: () => now }))
      .rejects.toBeInstanceOf(LogoutBrokerError)

    expect(await resource.db.get(
      `SELECT auth_generation FROM users WHERE id = 'alice'`,
    )).toEqual({ auth_generation: 0 })
    expect(await resource.db.get(`SELECT COUNT(*) AS count FROM sessions WHERE user_id = 'alice'`)).toEqual({ count: 1 })
  })
})
