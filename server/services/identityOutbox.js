import { runIdentityOperation } from './identityOperation.js'

const claimQueues = new WeakMap()
const DEFAULT_STALE_MS = 60 * 1000
const DEFAULT_RETRY_BASE_MS = 2000
const DEFAULT_MAX_ATTEMPTS = 20
export const MAX_IDENTITY_OUTBOX_BATCH_SIZE = 25
export const MAX_SYNC_IDENTITY_OUTBOX_DRAIN = 8

const runSerialized = (db, operation) => {
  const previous = claimQueues.get(db) || Promise.resolve()
  const current = previous.catch(() => undefined).then(operation)
  claimQueues.set(db, current)
  return current.finally(() => {
    if (claimQueues.get(db) === current) claimQueues.delete(db)
  })
}

const asDate = (value) => {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid outbox timestamp')
  return date
}

const sanitizeFailure = (error) => {
  const name = typeof error?.name === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(error.name)
    ? error.name
    : 'Error'
  const status = Number.isInteger(error?.status) ? ` status=${error.status}` : ''
  return `Hydra revocation failed (${name}${status})`.slice(0, 200)
}

const claimNext = async (db, nowDate, staleMs, { subject = null, generation = null } = {}) => {
  await db.exec('BEGIN IMMEDIATE')
  try {
    const staleBefore = new Date(nowDate.getTime() - staleMs).toISOString()
    const event = await db.get(
      `SELECT event.* FROM identity_outbox event
       WHERE (
         (event.status = 'pending' AND event.next_attempt_at <= ?)
         OR (event.status = 'processing' AND event.updated_at <= ?)
       )
       AND (? IS NULL OR event.subject = ?)
       AND (
         ? IS NULL
         OR CAST(json_extract(event.payload_json, '$.generation') AS INTEGER) = ?
       )
       AND (
         event.event_type <> 'oidc.revoke_consent'
         OR NOT EXISTS (
           SELECT 1 FROM identity_outbox prerequisite
           WHERE prerequisite.subject = event.subject
             AND prerequisite.client_id = event.client_id
             AND prerequisite.event_type = 'oidc.revoke_session'
             AND json_extract(prerequisite.payload_json, '$.generation')
               = json_extract(event.payload_json, '$.generation')
             AND prerequisite.status <> 'completed'
         )
       )
       ORDER BY CASE event.event_type
         WHEN 'oidc.revoke_session' THEN 0
         WHEN 'oidc.revoke_consent' THEN 1
         ELSE 2
       END, event.created_at, event.id
       LIMIT 1`,
      nowDate.toISOString(),
      staleBefore,
      subject,
      subject,
      generation,
      generation,
    )
    if (!event) {
      await db.exec('COMMIT')
      return null
    }
    const claimed = await db.run(
      `UPDATE identity_outbox
       SET status = 'processing', attempts = attempts + 1, updated_at = ?
       WHERE id = ? AND (
         (status = 'pending' AND next_attempt_at <= ?)
         OR (status = 'processing' AND updated_at <= ?)
       )`,
      nowDate.toISOString(),
      event.id,
      nowDate.toISOString(),
      staleBefore,
    )
    if (claimed.changes !== 1) {
      await db.exec('COMMIT')
      return null
    }
    await db.exec('COMMIT')
    return { ...event, attempts: event.attempts + 1 }
  } catch (error) {
    await db.exec('ROLLBACK').catch(() => undefined)
    throw error
  }
}

const dispatch = async (admin, event) => {
  if (event.event_type === 'oidc.revoke_session') {
    if (!event.sid) throw new Error('Revocation event is missing sid')
    await admin.revokeLoginSession(event.sid)
    return
  }
  if (event.event_type === 'oidc.revoke_consent'
    || event.event_type.startsWith('account.')) {
    if (!event.client_id) {
      // Account lifecycle events without a client are audit/fan-out markers. The
      // per-session events perform the concrete Hydra revocation.
      return
    }
    await admin.revokeConsentSessions(event.subject, event.client_id)
    return
  }
  throw new Error('Unsupported identity outbox event')
}

export const processIdentityOutboxOnce = async (
  db,
  admin,
  {
    now = () => new Date(),
    staleMs = DEFAULT_STALE_MS,
    retryBaseMs = DEFAULT_RETRY_BASE_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    subject = null,
    generation = null,
    operationLocked = false,
  } = {},
) => {
  const process = () => runSerialized(db, async () => {
    const nowDate = asDate(now())
    const event = await claimNext(db, nowDate, staleMs, { subject, generation })
    if (!event) return { processed: false, idle: true }

    try {
      await dispatch(admin, event)
      await db.exec('BEGIN IMMEDIATE')
      try {
        await db.run(
          `UPDATE identity_outbox
           SET status = 'completed', last_error = NULL, completed_at = ?, updated_at = ?
           WHERE id = ? AND status = 'processing'`,
          nowDate.toISOString(),
          nowDate.toISOString(),
          event.id,
        )
        if (event.event_type === 'oidc.revoke_session' && event.sid) {
          await db.run(
            `UPDATE oidc_login_sessions
             SET status = 'revoked', revoked_at = ?, updated_at = ?
             WHERE client_id = ? AND sid = ?`,
            nowDate.toISOString(),
            nowDate.toISOString(),
            event.client_id,
            event.sid,
          )
        }
        await db.exec('COMMIT')
      } catch (error) {
        await db.exec('ROLLBACK').catch(() => undefined)
        throw error
      }
      return { processed: true, id: event.id, attempts: event.attempts }
    } catch (error) {
      const dead = event.attempts >= maxAttempts
      const delay = Math.min(retryBaseMs * (2 ** Math.max(0, event.attempts - 1)), 60 * 60 * 1000)
      await db.run(
        `UPDATE identity_outbox
         SET status = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
         WHERE id = ? AND status = 'processing'`,
        dead ? 'dead' : 'pending',
        new Date(nowDate.getTime() + delay).toISOString(),
        sanitizeFailure(error),
        nowDate.toISOString(),
        event.id,
      )
      return { processed: false, retrying: !dead, dead, id: event.id, attempts: event.attempts }
    }
  })
  return operationLocked ? process() : runIdentityOperation(db, process)
}

export const processIdentityOutboxBatch = async (
  db,
  admin,
  { limit = MAX_IDENTITY_OUTBOX_BATCH_SIZE, ...options } = {},
) => {
  const boundedLimit = Number.isSafeInteger(limit)
    ? Math.min(Math.max(limit, 0), MAX_IDENTITY_OUTBOX_BATCH_SIZE)
    : MAX_IDENTITY_OUTBOX_BATCH_SIZE
  const results = []
  for (let index = 0; index < boundedLimit; index += 1) {
    const result = await processIdentityOutboxOnce(db, admin, options)
    if (result.idle) break
    results.push(result)
  }
  return results
}

export const processIdentityOutboxGeneration = async (
  db,
  admin,
  { subject, generation, ...options },
) => {
  if (typeof subject !== 'string' || !subject || !Number.isInteger(generation) || generation < 0) {
    throw new Error('A valid subject and auth generation are required')
  }
  return processIdentityOutboxBatch(db, admin, {
    ...options,
    subject,
    generation,
    limit: MAX_SYNC_IDENTITY_OUTBOX_DRAIN,
  })
}
