import { afterEach, describe, expect, it } from 'vitest'
import { openIdentityFixture, TEST_SUBJECTS } from '../identity/testIdentityFixture.js'
import {
  IdentityOutboxCapacityError,
  MAX_IDENTITY_OUTBOX_ROWS,
  MAX_UNRESOLVED_IDENTITY_OUTBOX_EVENTS,
  MAX_UNRESOLVED_IDENTITY_OUTBOX_EVENTS_PER_GENERATION,
  enqueueIdentityOutboxEvent,
} from './identityOutboxStore.js'

const resources = []
const timestamp = '2026-08-30T00:00:00.000Z'

const enqueue = (db, overrides = {}) => enqueueIdentityOutboxEvent(db, {
  eventType: 'oidc.revoke_session',
  subject: TEST_SUBJECTS.alice,
  clientId: 'jieya-server-local',
  sid: 'new-sid',
  generation: 5,
  timestamp,
  ...overrides,
})

afterEach(async () => {
  while (resources.length) await resources.pop().close()
})

describe('identity outbox storage limits', () => {
  it('rejects new events at the absolute outbox row cap even after prior work completed', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    await resource.db.exec(`
      WITH RECURSIVE sequence(value) AS (
        SELECT 1
        UNION ALL
        SELECT value + 1 FROM sequence
        WHERE value < ${MAX_IDENTITY_OUTBOX_ROWS}
      )
      INSERT INTO identity_outbox
        (id, event_type, subject, client_id, sid, payload_json, status, attempts,
         next_attempt_at, dedupe_key, created_at, updated_at, completed_at)
      SELECT 'completed-' || value, 'account.suspended', 'completed-subject-' || value,
             NULL, NULL, json_object('generation', value), 'completed', 1,
             '${timestamp}', 'completed-dedupe-' || value, '${timestamp}', '${timestamp}', '${timestamp}'
      FROM sequence;
    `)
    await resource.db.exec('BEGIN IMMEDIATE')
    try {
      await expect(enqueue(resource.db)).rejects.toBeInstanceOf(IdentityOutboxCapacityError)
    } finally {
      await resource.db.exec('ROLLBACK')
    }
    expect(await resource.db.get('SELECT COUNT(*) AS count FROM identity_outbox'))
      .toEqual({ count: MAX_IDENTITY_OUTBOX_ROWS })
  })

  it('rejects new unresolved events at the global hard cap', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    await resource.db.exec(`
      WITH RECURSIVE sequence(value) AS (
        SELECT 1
        UNION ALL
        SELECT value + 1 FROM sequence
        WHERE value < ${MAX_UNRESOLVED_IDENTITY_OUTBOX_EVENTS}
      )
      INSERT INTO identity_outbox
        (id, event_type, subject, client_id, sid, payload_json, status, attempts,
         next_attempt_at, dedupe_key, created_at, updated_at)
      SELECT 'global-' || value, 'account.suspended', 'subject-' || value, NULL, NULL,
             json_object('generation', value), 'pending', 0,
             '${timestamp}', 'global-dedupe-' || value, '${timestamp}', '${timestamp}'
      FROM sequence;
    `)
    await resource.db.exec('BEGIN IMMEDIATE')
    try {
      await expect(enqueue(resource.db)).rejects.toBeInstanceOf(IdentityOutboxCapacityError)
    } finally {
      await resource.db.exec('ROLLBACK')
    }
    expect(await resource.db.get('SELECT COUNT(*) AS count FROM identity_outbox'))
      .toEqual({ count: MAX_UNRESOLVED_IDENTITY_OUTBOX_EVENTS })
  })

  it('rejects event fan-out at the per-account generation hard cap', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    await resource.db.exec(`
      WITH RECURSIVE sequence(value) AS (
        SELECT 1
        UNION ALL
        SELECT value + 1 FROM sequence
        WHERE value < ${MAX_UNRESOLVED_IDENTITY_OUTBOX_EVENTS_PER_GENERATION}
      )
      INSERT INTO identity_outbox
        (id, event_type, subject, client_id, sid, payload_json, status, attempts,
         next_attempt_at, dedupe_key, created_at, updated_at)
      SELECT 'generation-' || value, 'oidc.revoke_session', '${TEST_SUBJECTS.alice}',
             'jieya-server-local', 'existing-sid-' || value,
             json_object('generation', 5), 'pending', 0,
             '${timestamp}', 'generation-dedupe-' || value, '${timestamp}', '${timestamp}'
      FROM sequence;
    `)
    await resource.db.exec('BEGIN IMMEDIATE')
    try {
      await expect(enqueue(resource.db)).rejects.toBeInstanceOf(IdentityOutboxCapacityError)
    } finally {
      await resource.db.exec('ROLLBACK')
    }
    expect(await resource.db.get('SELECT COUNT(*) AS count FROM identity_outbox'))
      .toEqual({ count: MAX_UNRESOLVED_IDENTITY_OUTBOX_EVENTS_PER_GENERATION })
  })

  it('keeps an existing dedupe event idempotent even when capacity is full', async () => {
    const resource = await openIdentityFixture()
    resources.push(resource)
    const dedupeKey = `oidc.revoke_session:${TEST_SUBJECTS.alice}:jieya-server-local:new-sid:5`
    await resource.db.run(
      `INSERT INTO identity_outbox
         (id, event_type, subject, client_id, sid, payload_json, status, attempts,
          next_attempt_at, dedupe_key, created_at, updated_at)
       VALUES ('existing', 'oidc.revoke_session', ?, 'jieya-server-local', 'new-sid', ?,
               'pending', 0, ?, ?, ?, ?)`,
      TEST_SUBJECTS.alice,
      JSON.stringify({ generation: 5 }),
      timestamp,
      dedupeKey,
      timestamp,
      timestamp,
    )
    for (let index = 1; index < MAX_UNRESOLVED_IDENTITY_OUTBOX_EVENTS_PER_GENERATION; index += 1) {
      await resource.db.run(
        `INSERT INTO identity_outbox
           (id, event_type, subject, client_id, sid, payload_json, status, attempts,
            next_attempt_at, dedupe_key, created_at, updated_at)
         VALUES (?, 'oidc.revoke_session', ?, 'jieya-server-local', ?, ?,
                 'pending', 0, ?, ?, ?, ?)`,
        `existing-${index}`,
        TEST_SUBJECTS.alice,
        `sid-${index}`,
        JSON.stringify({ generation: 5 }),
        timestamp,
        `dedupe-${index}`,
        timestamp,
        timestamp,
      )
    }
    await resource.db.exec('BEGIN IMMEDIATE')
    try {
      await expect(enqueue(resource.db)).resolves.toMatchObject({ inserted: false })
      await resource.db.exec('COMMIT')
    } catch (error) {
      await resource.db.exec('ROLLBACK').catch(() => undefined)
      throw error
    }
    expect(await resource.db.get('SELECT COUNT(*) AS count FROM identity_outbox'))
      .toEqual({ count: MAX_UNRESOLVED_IDENTITY_OUTBOX_EVENTS_PER_GENERATION })
  })
})
