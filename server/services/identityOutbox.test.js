import { afterEach, describe, expect, it, vi } from 'vitest'
import { openIdentityFixture, TEST_SUBJECTS } from '../identity/testIdentityFixture.js'
import {
  MAX_IDENTITY_OUTBOX_BATCH_SIZE,
  MAX_SYNC_IDENTITY_OUTBOX_DRAIN,
  processIdentityOutboxBatch,
  processIdentityOutboxGeneration,
  processIdentityOutboxOnce,
} from './identityOutbox.js'

const resources = []
const baseTime = new Date('2026-08-30T00:00:00.000Z')

const addEvent = async (db, {
  id = 'event-1',
  eventType = 'oidc.revoke_session',
  sid = 'sid-1',
  generation = 1,
  clientId = 'jieya-server-local',
  createdAt = baseTime.toISOString(),
} = {}) => {
  await db.run(
    `INSERT INTO identity_outbox
       (id, event_type, subject, client_id, sid, payload_json, status, attempts,
        next_attempt_at, dedupe_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)`,
    id,
    eventType,
    TEST_SUBJECTS.alice,
    clientId,
    sid,
    JSON.stringify({ generation }),
    createdAt,
    `dedupe-${id}`,
    createdAt,
    createdAt,
  )
}

afterEach(async () => {
  while (resources.length) await resources.pop().close()
})

describe('identity outbox worker', () => {
  it('claims an event once under concurrency and marks session revocation durable', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    await resource.db.run(
      `INSERT INTO oidc_login_sessions
         (account_subject, client_id, sid, auth_generation, status,
          created_at, updated_at, expires_at)
       VALUES (?, 'jieya-server-local', 'sid-1', 0, 'revocation_pending', ?, ?, ?)`,
      TEST_SUBJECTS.alice,
      baseTime.toISOString(),
      baseTime.toISOString(),
      '2026-09-29T00:00:00.000Z',
    )
    await addEvent(resource.db)
    const admin = { revokeLoginSession: vi.fn(async () => undefined) }

    const results = await Promise.all([
      processIdentityOutboxOnce(resource.db, admin, { now: () => baseTime }),
      processIdentityOutboxOnce(resource.db, admin, { now: () => baseTime }),
    ])

    expect(results.filter((result) => result?.processed)).toHaveLength(1)
    expect(admin.revokeLoginSession).toHaveBeenCalledTimes(1)
    expect(await resource.db.get(`SELECT status, attempts FROM identity_outbox WHERE id = 'event-1'`))
      .toEqual({ status: 'completed', attempts: 1 })
    expect(await resource.db.get(`SELECT status FROM oidc_login_sessions WHERE sid = 'sid-1'`))
      .toEqual({ status: 'revoked' })
  })

  it('persists a sanitized retry and succeeds after a simulated restart', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    await addEvent(resource.db, { eventType: 'oidc.revoke_consent', sid: null })
    const sensitive = 'Bearer secret-token-value'
    const failingAdmin = {
      revokeConsentSessions: vi.fn(async () => { throw new Error(`upstream failed ${sensitive}`) }),
    }

    await expect(processIdentityOutboxOnce(resource.db, failingAdmin, {
      now: () => baseTime,
      retryBaseMs: 1000,
    })).resolves.toMatchObject({ processed: false, retrying: true })
    const failed = await resource.db.get(
      `SELECT status, attempts, next_attempt_at, last_error FROM identity_outbox WHERE id = 'event-1'`,
    )
    expect(failed.status).toBe('pending')
    expect(failed.attempts).toBe(1)
    expect(failed.last_error).not.toContain(sensitive)

    const recoveredAdmin = { revokeConsentSessions: vi.fn(async () => undefined) }
    await expect(processIdentityOutboxOnce(resource.db, recoveredAdmin, {
      now: () => new Date(baseTime.getTime() + 1001),
    })).resolves.toMatchObject({ processed: true })
    expect(recoveredAdmin.revokeConsentSessions).toHaveBeenCalledWith(
      TEST_SUBJECTS.alice,
      'jieya-server-local',
    )
    expect(await resource.db.get(`SELECT status, attempts FROM identity_outbox WHERE id = 'event-1'`))
      .toEqual({ status: 'completed', attempts: 2 })
  })

  it('never revokes consent before every session in the same generation succeeds', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    await addEvent(resource.db, {
      id: 'a-consent-sorts-first',
      eventType: 'oidc.revoke_consent',
      sid: null,
    })
    await addEvent(resource.db, { id: 'z-session-sorts-last', sid: 'sid-1' })
    const order = []
    const admin = {
      revokeLoginSession: vi.fn(async () => { order.push('session') }),
      revokeConsentSessions: vi.fn(async () => { order.push('consent') }),
    }

    await processIdentityOutboxOnce(resource.db, admin, { now: () => baseTime })
    await processIdentityOutboxOnce(resource.db, admin, { now: () => baseTime })

    expect(order).toEqual(['session', 'consent'])
  })

  it('keeps consent pending while a prerequisite session revocation is retrying', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    await addEvent(resource.db, { id: 'consent', eventType: 'oidc.revoke_consent', sid: null })
    await addEvent(resource.db, { id: 'session', sid: 'sid-1' })
    const admin = {
      revokeLoginSession: vi.fn(async () => { throw new Error('temporary failure') }),
      revokeConsentSessions: vi.fn(async () => undefined),
    }

    await processIdentityOutboxOnce(resource.db, admin, {
      now: () => baseTime,
      retryBaseMs: 1000,
    })
    const second = await processIdentityOutboxOnce(resource.db, admin, {
      now: () => baseTime,
      retryBaseMs: 1000,
    })

    expect(second).toMatchObject({ idle: true })
    expect(admin.revokeConsentSessions).not.toHaveBeenCalled()
    expect(await resource.db.get(`SELECT status FROM identity_outbox WHERE id = 'consent'`))
      .toEqual({ status: 'pending' })
  })

  it('drains only the requested account generation for synchronous logout', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    await addEvent(resource.db, { id: 'current-session', generation: 3 })
    await addEvent(resource.db, {
      id: 'current-consent',
      eventType: 'oidc.revoke_consent',
      sid: null,
      generation: 3,
    })
    await addEvent(resource.db, { id: 'older-session', sid: 'sid-old', generation: 2 })
    const admin = {
      revokeLoginSession: vi.fn(async () => undefined),
      revokeConsentSessions: vi.fn(async () => undefined),
    }

    const results = await processIdentityOutboxGeneration(resource.db, admin, {
      subject: TEST_SUBJECTS.alice,
      generation: 3,
      now: () => baseTime,
    })

    expect(results).toHaveLength(2)
    expect(admin.revokeLoginSession).toHaveBeenCalledWith('sid-1')
    expect(admin.revokeLoginSession).not.toHaveBeenCalledWith('sid-old')
    expect(await resource.db.get(`SELECT status FROM identity_outbox WHERE id = 'older-session'`))
      .toEqual({ status: 'pending' })
  })

  it('bounds the synchronous generation drain and leaves the remainder for the worker', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    const total = MAX_SYNC_IDENTITY_OUTBOX_DRAIN + 4
    for (let index = 0; index < total; index += 1) {
      await addEvent(resource.db, {
        id: `sync-${index}`,
        sid: `sync-sid-${index}`,
        generation: 7,
      })
    }
    const admin = { revokeLoginSession: vi.fn(async () => undefined) }

    const results = await processIdentityOutboxGeneration(resource.db, admin, {
      subject: TEST_SUBJECTS.alice,
      generation: 7,
      now: () => baseTime,
    })

    expect(results).toHaveLength(MAX_SYNC_IDENTITY_OUTBOX_DRAIN)
    expect(admin.revokeLoginSession).toHaveBeenCalledTimes(MAX_SYNC_IDENTITY_OUTBOX_DRAIN)
    expect(await resource.db.get(
      `SELECT COUNT(*) AS count FROM identity_outbox WHERE status = 'pending'`,
    )).toEqual({ count: total - MAX_SYNC_IDENTITY_OUTBOX_DRAIN })
  })

  it('clamps an oversized worker batch request to the audited maximum', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    const total = MAX_IDENTITY_OUTBOX_BATCH_SIZE + 5
    for (let index = 0; index < total; index += 1) {
      await addEvent(resource.db, {
        id: `worker-${index}`,
        sid: `worker-sid-${index}`,
        generation: 9,
      })
    }
    const admin = { revokeLoginSession: vi.fn(async () => undefined) }

    const results = await processIdentityOutboxBatch(resource.db, admin, {
      limit: 100_000,
      now: () => baseTime,
    })

    expect(results).toHaveLength(MAX_IDENTITY_OUTBOX_BATCH_SIZE)
    expect(admin.revokeLoginSession).toHaveBeenCalledTimes(MAX_IDENTITY_OUTBOX_BATCH_SIZE)
    expect(await resource.db.get(
      `SELECT COUNT(*) AS count FROM identity_outbox WHERE status = 'pending'`,
    )).toEqual({ count: total - MAX_IDENTITY_OUTBOX_BATCH_SIZE })
  })

  it('delivers an exact lifecycle v1 event and completes only after Jieya 2xx', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    await addEvent(resource.db, {
      id: 'lifecycle-suspended',
      eventType: 'account.suspended',
      clientId: null,
      sid: null,
      generation: 4,
    })
    const lifecycleClient = { deliver: vi.fn(async () => ({ status: 'applied' })) }

    await expect(processIdentityOutboxOnce(resource.db, {}, {
      lifecycleClient,
      lifecycleIssuer: 'https://auth.xingzhan.cc',
      now: () => baseTime,
    })).resolves.toMatchObject({ processed: true, lifecycle: true })

    expect(lifecycleClient.deliver).toHaveBeenCalledWith({
      version: 1,
      eventId: 'lifecycle-suspended',
      issuer: 'https://auth.xingzhan.cc',
      sub: TEST_SUBJECTS.alice,
      status: 'suspended',
      authGeneration: 4,
      occurredAt: baseTime.toISOString(),
    })
    expect(await resource.db.get(
      `SELECT status, completed_at FROM identity_outbox WHERE id = 'lifecycle-suspended'`,
    )).toEqual({ status: 'completed', completed_at: baseTime.toISOString() })
  })

  it('keeps lifecycle events pending while delivery is disabled instead of falsely completing them', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    await addEvent(resource.db, {
      id: 'lifecycle-disabled',
      eventType: 'account.suspended',
      clientId: null,
      sid: null,
      generation: 4,
    })

    await expect(processIdentityOutboxOnce(resource.db, {}, {
      now: () => baseTime,
    })).resolves.toMatchObject({ idle: true, processed: false })
    expect(await resource.db.get(
      `SELECT status, attempts, completed_at FROM identity_outbox WHERE id = 'lifecycle-disabled'`,
    )).toEqual({ status: 'pending', attempts: 0, completed_at: null })
  })

  it('continues Hydra revocation while disabled lifecycle delivery remains pending', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    await addEvent(resource.db, {
      id: 'lifecycle-waits',
      eventType: 'account.suspended',
      clientId: null,
      sid: null,
      generation: 4,
    })
    await addEvent(resource.db, {
      id: 'session-revokes',
      eventType: 'oidc.revoke_session',
      clientId: 'jieya-server-local',
      sid: 'sid-disabled-lifecycle',
      generation: 4,
    })
    const admin = { revokeLoginSession: vi.fn(async () => undefined) }

    await expect(processIdentityOutboxOnce(resource.db, admin, {
      now: () => baseTime,
    })).resolves.toMatchObject({ processed: true, lifecycle: false })
    expect(admin.revokeLoginSession).toHaveBeenCalledWith('sid-disabled-lifecycle')
    expect(await resource.db.all(
      `SELECT id, status, attempts FROM identity_outbox ORDER BY id`,
    )).toEqual([
      { id: 'lifecycle-waits', status: 'pending', attempts: 0 },
      { id: 'session-revokes', status: 'completed', attempts: 1 },
    ])
  })

  it('persists lifecycle failures and retries the same event after a simulated restart', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    await addEvent(resource.db, {
      id: 'lifecycle-deleted',
      eventType: 'account.deleted',
      clientId: null,
      sid: null,
      generation: 9,
    })
    const lifecycleClient = { deliver: vi.fn(async () => {
      const error = new Error('private response contains never-log-this')
      error.status = 500
      throw error
    }) }

    await expect(processIdentityOutboxOnce(resource.db, {}, {
      lifecycleClient,
      lifecycleIssuer: 'https://auth.xingzhan.cc',
      now: () => baseTime,
      retryBaseMs: 1000,
    })).resolves.toMatchObject({ retrying: true, lifecycle: true })
    expect(await resource.db.get(
      `SELECT status, attempts FROM identity_outbox WHERE id = 'lifecycle-deleted'`,
    )).toEqual({ status: 'pending', attempts: 1 })
    expect((await resource.db.get(
      `SELECT last_error FROM identity_outbox WHERE id = 'lifecycle-deleted'`,
    )).last_error).not.toContain('never-log-this')

    const restartedDb = await resource.openConnection()
    const recoveredClient = { deliver: vi.fn(async () => ({ status: 'applied' })) }
    await expect(processIdentityOutboxOnce(restartedDb, {}, {
      lifecycleClient: recoveredClient,
      lifecycleIssuer: 'https://auth.xingzhan.cc',
      now: () => new Date(baseTime.getTime() + 1001),
    })).resolves.toMatchObject({ processed: true, attempts: 2, lifecycle: true })
    expect(recoveredClient.deliver).toHaveBeenCalledTimes(1)
  })

  it('does not retry a lifecycle 4xx conflict and raises an immediate operator alert', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    await addEvent(resource.db, {
      id: 'lifecycle-conflict',
      eventType: 'account.suspended',
      clientId: null,
      sid: null,
      generation: 3,
    })
    const lifecycleClient = { deliver: vi.fn(async () => {
      const error = new Error('same-generation conflict')
      error.status = 409
      error.retryable = false
      throw error
    }) }

    await expect(processIdentityOutboxOnce(resource.db, {}, {
      lifecycleClient,
      lifecycleIssuer: 'https://auth.xingzhan.cc',
      now: () => baseTime,
    })).resolves.toMatchObject({ dead: true, retrying: false, lifecycle: true, alert: true })
    expect(await resource.db.get(
      `SELECT status, attempts FROM identity_outbox WHERE id = 'lifecycle-conflict'`,
    )).toEqual({ status: 'dead', attempts: 1 })
  })

  it('uses Jieya Retry-After for a retryable 503 response', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    await addEvent(resource.db, {
      id: 'lifecycle-overloaded',
      eventType: 'account.active',
      clientId: null,
      sid: null,
      generation: 8,
    })
    const lifecycleClient = { deliver: vi.fn(async () => {
      const error = new Error('temporarily unavailable')
      error.status = 503
      error.retryable = true
      error.retryAfterMs = 60_000
      throw error
    }) }

    await expect(processIdentityOutboxOnce(resource.db, {}, {
      lifecycleClient,
      lifecycleIssuer: 'https://auth.xingzhan.cc',
      now: () => baseTime,
      retryBaseMs: 1000,
    })).resolves.toMatchObject({ retrying: true, dead: false })
    expect(await resource.db.get(
      `SELECT status, next_attempt_at FROM identity_outbox WHERE id = 'lifecycle-overloaded'`,
    )).toEqual({
      status: 'pending',
      next_attempt_at: new Date(baseTime.getTime() + 60_000).toISOString(),
    })
  })

  it('blocks a newer lifecycle generation until the older event completes', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    await addEvent(resource.db, {
      id: 'z-suspended-old',
      eventType: 'account.suspended',
      clientId: null,
      sid: null,
      generation: 1,
    })
    await addEvent(resource.db, {
      id: 'a-active-new',
      eventType: 'account.active',
      clientId: null,
      sid: null,
      generation: 2,
    })
    let failOld = true
    const delivered = []
    const lifecycleClient = { deliver: vi.fn(async (payload) => {
      delivered.push(payload.status)
      if (payload.status === 'suspended' && failOld) throw new Error('temporary')
      return { status: 'applied' }
    }) }

    await processIdentityOutboxOnce(resource.db, {}, {
      lifecycleClient,
      lifecycleIssuer: 'https://auth.xingzhan.cc',
      now: () => baseTime,
      retryBaseMs: 1000,
    })
    const blocked = await processIdentityOutboxOnce(resource.db, {}, {
      lifecycleClient,
      lifecycleIssuer: 'https://auth.xingzhan.cc',
      now: () => baseTime,
      retryBaseMs: 1000,
    })
    expect(blocked).toMatchObject({ idle: true })
    expect(delivered).toEqual(['suspended'])

    failOld = false
    await processIdentityOutboxOnce(resource.db, {}, {
      lifecycleClient,
      lifecycleIssuer: 'https://auth.xingzhan.cc',
      now: () => new Date(baseTime.getTime() + 1001),
    })
    await processIdentityOutboxOnce(resource.db, {}, {
      lifecycleClient,
      lifecycleIssuer: 'https://auth.xingzhan.cc',
      now: () => new Date(baseTime.getTime() + 1001),
    })
    expect(delivered).toEqual(['suspended', 'suspended', 'active'])
  })

  it('fails closed instead of bypassing an older malformed lifecycle generation', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    await addEvent(resource.db, {
      id: 'z-malformed-old',
      eventType: 'account.suspended',
      clientId: null,
      sid: null,
      generation: 1,
    })
    await resource.db.run(
      `UPDATE identity_outbox SET payload_json = '{}' WHERE id = 'z-malformed-old'`,
    )
    await addEvent(resource.db, {
      id: 'a-active-new',
      eventType: 'account.active',
      clientId: null,
      sid: null,
      generation: 2,
    })
    const lifecycleClient = { deliver: vi.fn(async () => ({ status: 'applied' })) }

    await expect(processIdentityOutboxOnce(resource.db, {}, {
      lifecycleClient,
      lifecycleIssuer: 'https://auth.xingzhan.cc',
      now: () => baseTime,
      retryBaseMs: 1000,
    })).resolves.toMatchObject({ retrying: true, lifecycle: true })
    await expect(processIdentityOutboxOnce(resource.db, {}, {
      lifecycleClient,
      lifecycleIssuer: 'https://auth.xingzhan.cc',
      now: () => baseTime,
      retryBaseMs: 1000,
    })).resolves.toMatchObject({ idle: true })
    expect(lifecycleClient.deliver).not.toHaveBeenCalled()
  })

  it('does not notify Jieya before same-generation Hydra revocation completes', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    await addEvent(resource.db, {
      id: 'consent-revocation',
      eventType: 'oidc.revoke_consent',
      clientId: 'jieya-server-local',
      sid: null,
      generation: 5,
    })
    await addEvent(resource.db, {
      id: 'lifecycle-after-revocation',
      eventType: 'account.suspended',
      clientId: null,
      sid: null,
      generation: 5,
    })
    const lifecycleClient = { deliver: vi.fn(async () => ({ status: 'applied' })) }
    const admin = { revokeConsentSessions: vi.fn(async () => { throw new Error('Hydra unavailable') }) }

    await processIdentityOutboxOnce(resource.db, admin, {
      lifecycleClient,
      lifecycleIssuer: 'https://auth.xingzhan.cc',
      now: () => baseTime,
      retryBaseMs: 1000,
    })
    await expect(processIdentityOutboxOnce(resource.db, admin, {
      lifecycleClient,
      lifecycleIssuer: 'https://auth.xingzhan.cc',
      now: () => baseTime,
      retryBaseMs: 1000,
    })).resolves.toMatchObject({ idle: true })
    expect(lifecycleClient.deliver).not.toHaveBeenCalled()
  })

  it('never sends password changes to the cloud lifecycle endpoint', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    await addEvent(resource.db, {
      id: 'password-marker',
      eventType: 'account.password_changed',
      clientId: null,
      sid: null,
      generation: 2,
    })
    const lifecycleClient = { deliver: vi.fn() }

    await expect(processIdentityOutboxOnce(resource.db, {}, {
      lifecycleClient,
      lifecycleIssuer: 'https://auth.xingzhan.cc',
      now: () => baseTime,
    })).resolves.toMatchObject({ processed: true, lifecycle: false })
    expect(lifecycleClient.deliver).not.toHaveBeenCalled()
  })

  it('retains a dead lifecycle event and marks it for an operator alert', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    await addEvent(resource.db, {
      id: 'lifecycle-dead',
      eventType: 'account.deleted',
      clientId: null,
      sid: null,
    })
    const lifecycleClient = { deliver: vi.fn(async () => { throw new Error('offline') }) }

    await expect(processIdentityOutboxOnce(resource.db, {}, {
      lifecycleClient,
      lifecycleIssuer: 'https://auth.xingzhan.cc',
      now: () => baseTime,
      maxAttempts: 1,
    })).resolves.toMatchObject({ dead: true, lifecycle: true, alert: true })
    expect(await resource.db.get(
      `SELECT status, completed_at FROM identity_outbox WHERE id = 'lifecycle-dead'`,
    )).toEqual({ status: 'dead', completed_at: null })
  })
})
