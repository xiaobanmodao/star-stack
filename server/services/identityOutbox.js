import { runIdentityOperation } from './identityOperation.js'

const claimQueues = new WeakMap()
const DEFAULT_STALE_MS = 60 * 1000
const DEFAULT_RETRY_BASE_MS = 2000
const DEFAULT_MAX_ATTEMPTS = 20
export const MAX_IDENTITY_OUTBOX_BATCH_SIZE = 25
export const MAX_SYNC_IDENTITY_OUTBOX_DRAIN = 8
const LIFECYCLE_EVENT_TYPES = Object.freeze([
  'account.active',
  'account.suspended',
  'account.deleted',
])
const lifecycleEventTypes = new Set(LIFECYCLE_EVENT_TYPES)
const lifecycleEventSql = LIFECYCLE_EVENT_TYPES.map((value) => `'${value}'`).join(', ')

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
  return `Identity delivery failed (${name}${status})`.slice(0, 200)
}

const parseGeneration = (event) => {
  let payload
  try { payload = JSON.parse(event.payload_json) } catch {
    throw new Error('Identity outbox payload is invalid')
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).length !== 1
    || !Number.isSafeInteger(payload.generation) || payload.generation < 0) {
    throw new Error('Identity outbox generation is invalid')
  }
  return payload.generation
}

const buildLifecycleEvent = (event, issuer) => {
  if (!lifecycleEventTypes.has(event.event_type)
    || event.client_id !== null || event.sid !== null
    || typeof issuer !== 'string' || !issuer) {
    throw new Error('Account lifecycle outbox event is invalid')
  }
  const occurredAt = new Date(event.created_at)
  if (!Number.isFinite(occurredAt.getTime()) || occurredAt.toISOString() !== event.created_at) {
    throw new Error('Account lifecycle timestamp is invalid')
  }
  return {
    version: 1,
    eventId: event.id,
    issuer,
    sub: event.subject,
    status: event.event_type.slice('account.'.length),
    authGeneration: parseGeneration(event),
    occurredAt: event.created_at,
  }
}

const claimNext = async (
  db,
  nowDate,
  staleMs,
  { subject = null, generation = null, includeLifecycle = false } = {},
) => {
  await db.exec('BEGIN IMMEDIATE')
  try {
    const staleBefore = new Date(nowDate.getTime() - staleMs).toISOString()
    const event = await db.get(
      `SELECT event.* FROM identity_outbox event
       WHERE (
         (event.status = 'pending' AND event.next_attempt_at <= ?)
         OR (event.status = 'processing' AND event.updated_at <= ?)
       )
       AND (? = 1 OR event.event_type NOT IN (${lifecycleEventSql}))
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
       AND (
         event.event_type NOT IN (${lifecycleEventSql})
         OR json_valid(event.payload_json) <> 1
         OR json_type(event.payload_json, '$.generation') IS NOT 'integer'
         OR NOT EXISTS (
           SELECT 1 FROM identity_outbox prerequisite
           WHERE prerequisite.subject = event.subject
             AND prerequisite.id <> event.id
             AND prerequisite.event_type IN (${lifecycleEventSql})
             AND prerequisite.status <> 'completed'
             AND CASE
               WHEN json_valid(prerequisite.payload_json) <> 1 THEN 1
               WHEN json_type(prerequisite.payload_json, '$.generation') IS NOT 'integer' THEN 1
               ELSE CAST(json_extract(prerequisite.payload_json, '$.generation') AS INTEGER)
                 < CAST(json_extract(event.payload_json, '$.generation') AS INTEGER)
             END
         )
       )
       AND (
         event.event_type NOT IN (${lifecycleEventSql})
         OR NOT EXISTS (
           SELECT 1 FROM identity_outbox prerequisite
           WHERE prerequisite.subject = event.subject
             AND prerequisite.event_type IN ('oidc.revoke_session', 'oidc.revoke_consent')
             AND prerequisite.status <> 'completed'
             AND json_extract(prerequisite.payload_json, '$.generation')
               = json_extract(event.payload_json, '$.generation')
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
      includeLifecycle ? 1 : 0,
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

const dispatch = async (admin, event, { lifecycleClient, lifecycleIssuer }) => {
  if (lifecycleEventTypes.has(event.event_type)) {
    if (!lifecycleClient) throw new Error('Account lifecycle delivery is disabled')
    await lifecycleClient.deliver(buildLifecycleEvent(event, lifecycleIssuer))
    return { lifecycle: true, delivered: true }
  }
  if (event.event_type === 'oidc.revoke_session') {
    if (!event.sid) throw new Error('Revocation event is missing sid')
    await admin.revokeLoginSession(event.sid)
    return { lifecycle: false }
  }
  if (event.event_type === 'oidc.revoke_consent') {
    if (!event.client_id) throw new Error('Consent revocation is missing client id')
    await admin.revokeConsentSessions(event.subject, event.client_id)
    return { lifecycle: false }
  }
  if (event.event_type === 'account.password_changed') {
    if (event.client_id !== null || event.sid !== null) {
      throw new Error('Password change outbox marker is invalid')
    }
    // Password changes revoke sessions through their dedicated fan-out events;
    // they never delete or suspend Jieya cloud data.
    return { lifecycle: false }
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
    lifecycleClient = null,
    lifecycleIssuer = null,
  } = {},
) => {
  const process = () => runSerialized(db, async () => {
    const nowDate = asDate(now())
    const event = await claimNext(db, nowDate, staleMs, {
      subject,
      generation,
      includeLifecycle: Boolean(lifecycleClient),
    })
    if (!event) return { processed: false, idle: true }
    const lifecycle = lifecycleEventTypes.has(event.event_type)

    try {
      const dispatchResult = await dispatch(admin, event, { lifecycleClient, lifecycleIssuer })
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
      return {
        processed: true,
        id: event.id,
        attempts: event.attempts,
        lifecycle: dispatchResult.lifecycle,
        delivered: Boolean(dispatchResult.delivered),
      }
    } catch (error) {
      const retryable = error?.retryable !== false
      const dead = !retryable || event.attempts >= maxAttempts
      const exponentialDelay = Math.min(
        retryBaseMs * (2 ** Math.max(0, event.attempts - 1)),
        60 * 60 * 1000,
      )
      const retryAfterMs = Number.isSafeInteger(error?.retryAfterMs)
        ? Math.min(Math.max(error.retryAfterMs, 0), 60 * 60 * 1000)
        : 0
      const delay = Math.max(exponentialDelay, retryAfterMs)
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
      return {
        processed: false,
        retrying: !dead,
        dead,
        id: event.id,
        attempts: event.attempts,
        lifecycle,
        alert: dead && lifecycle,
      }
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
