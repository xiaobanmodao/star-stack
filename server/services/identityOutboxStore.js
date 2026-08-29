import { randomUUID } from 'node:crypto'

export const MAX_IDENTITY_OUTBOX_ROWS = 10_000
export const MAX_UNRESOLVED_IDENTITY_OUTBOX_EVENTS = 1024
export const MAX_UNRESOLVED_IDENTITY_OUTBOX_EVENTS_PER_GENERATION = 64

export class IdentityOutboxCapacityError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'IdentityOutboxCapacityError'
    this.code = code
    this.status = 503
  }
}

const assertEvent = ({ eventType, subject, clientId, sid, generation, timestamp }) => {
  if (typeof eventType !== 'string' || !eventType
    || typeof subject !== 'string' || !subject
    || (clientId !== null && clientId !== undefined && typeof clientId !== 'string')
    || (sid !== null && sid !== undefined && typeof sid !== 'string')
    || !Number.isSafeInteger(generation) || generation < 0
    || typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp))) {
    throw new Error('Invalid identity outbox event')
  }
}

const getDedupeKey = ({ eventType, subject, clientId, sid, generation }) => (
  `${eventType}:${subject}:${clientId || '*'}:${sid || '*'}:${generation}`
)

// Callers must hold a SQLite BEGIN IMMEDIATE transaction. That makes the
// dedupe check, both capacity checks and insertion one atomic writer action.
export const enqueueIdentityOutboxEvent = async (db, event) => {
  assertEvent(event)
  const {
    eventType,
    subject,
    clientId = null,
    sid = null,
    generation,
    timestamp,
  } = event
  const dedupeKey = getDedupeKey(event)
  const existing = await db.get(
    `SELECT id, status FROM identity_outbox WHERE dedupe_key = ?`,
    dedupeKey,
  )
  if (existing) return { inserted: false, id: existing.id, status: existing.status }

  const globalCapacity = await db.get(
    `SELECT COUNT(*) AS count FROM identity_outbox`,
  )
  if (globalCapacity.count >= MAX_IDENTITY_OUTBOX_ROWS) {
    throw new IdentityOutboxCapacityError(
      'IDENTITY_OUTBOX_TOTAL_CAPACITY_EXCEEDED',
      'Identity outbox total row capacity exceeded',
    )
  }
  const unresolvedCapacity = await db.get(
    `SELECT COUNT(*) AS count FROM identity_outbox
     WHERE status IN ('pending', 'processing', 'dead')`,
  )
  if (unresolvedCapacity.count >= MAX_UNRESOLVED_IDENTITY_OUTBOX_EVENTS) {
    throw new IdentityOutboxCapacityError(
      'IDENTITY_OUTBOX_GLOBAL_CAPACITY_EXCEEDED',
      'Identity outbox unresolved event capacity exceeded',
    )
  }
  const generationCapacity = await db.get(
    `SELECT COUNT(*) AS count FROM identity_outbox
     WHERE subject = ?
       AND CAST(json_extract(payload_json, '$.generation') AS INTEGER) = ?`,
    subject,
    generation,
  )
  if (generationCapacity.count >= MAX_UNRESOLVED_IDENTITY_OUTBOX_EVENTS_PER_GENERATION) {
    throw new IdentityOutboxCapacityError(
      'IDENTITY_OUTBOX_GENERATION_CAPACITY_EXCEEDED',
      'Identity outbox account generation capacity exceeded',
    )
  }

  const id = randomUUID()
  await db.run(
    `INSERT INTO identity_outbox
       (id, event_type, subject, client_id, sid, payload_json, status, attempts,
        next_attempt_at, dedupe_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)`,
    id,
    eventType,
    subject,
    clientId,
    sid,
    JSON.stringify({ generation }),
    timestamp,
    dedupeKey,
    timestamp,
    timestamp,
  )
  return { inserted: true, id, status: 'pending' }
}
