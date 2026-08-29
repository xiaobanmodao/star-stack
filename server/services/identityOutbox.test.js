import { afterEach, describe, expect, it, vi } from 'vitest'
import { openIdentityFixture, TEST_SUBJECTS } from '../identity/testIdentityFixture.js'
import {
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
} = {}) => {
  await db.run(
    `INSERT INTO identity_outbox
       (id, event_type, subject, client_id, sid, payload_json, status, attempts,
        next_attempt_at, dedupe_key, created_at, updated_at)
     VALUES (?, ?, ?, 'jieya-server-local', ?, ?, 'pending', 0, ?, ?, ?, ?)`,
    id,
    eventType,
    TEST_SUBJECTS.alice,
    sid,
    JSON.stringify({ generation }),
    baseTime.toISOString(),
    `dedupe-${id}`,
    baseTime.toISOString(),
    baseTime.toISOString(),
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
         (account_subject, client_id, sid, auth_generation, status, created_at, updated_at)
       VALUES (?, 'jieya-server-local', 'sid-1', 0, 'revocation_pending', ?, ?)`,
      TEST_SUBJECTS.alice,
      baseTime.toISOString(),
      baseTime.toISOString(),
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
})
