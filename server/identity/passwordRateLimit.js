import { createHmac, randomBytes } from 'node:crypto'

export const ACCOUNT_IDENTIFIER_MAX_LENGTH = 64
export const PASSWORD_ATTEMPT_LIMITS = Object.freeze({
  windowMs: 10 * 60 * 1000,
  perAccountMax: 20,
  globalMax: 200,
  // A fixed map bound greater than two complete global windows prevents
  // identifier spray from forcing unbounded memory or evicting a target key.
  maxTrackedAccounts: 512,
})

export const normalizeAccountIdentifier = (value) => {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized || normalized.length > ACCOUNT_IDENTIFIER_MAX_LENGTH) return null
  return normalized
}

const encodeIdentifier = (value) => {
  const normalized = normalizeAccountIdentifier(value)
  // Keep invalid form input outside the namespace of valid account IDs. The
  // registration contract permits punctuation, so a string sentinel could
  // otherwise collide with a real account.
  return normalized === null
    ? Buffer.from([0])
    : Buffer.concat([Buffer.from([1]), Buffer.from(normalized, 'utf8')])
}

const asTimestamp = (value) => {
  const timestamp = value instanceof Date ? value.getTime() : Number(value)
  if (!Number.isFinite(timestamp) || timestamp < 0) throw new Error('Invalid password limiter time')
  return timestamp
}

const validateLimits = ({ windowMs, perAccountMax, globalMax, maxTrackedAccounts }) => {
  for (const [name, value] of Object.entries({
    windowMs,
    perAccountMax,
    globalMax,
    maxTrackedAccounts,
  })) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`Password limiter ${name} must be a positive safe integer`)
    }
  }
  if (maxTrackedAccounts < globalMax * 2) {
    throw new Error('Password limiter account map must hold at least two global windows')
  }
}

export const hashAccountRateLimitKey = (identifier, hmacKey) => createHmac('sha256', hmacKey)
  .update(encodeIdentifier(identifier))
  .digest('hex')

const consumeWindow = (entry, now, windowMs) => {
  const current = !entry || now - entry.startedAt >= windowMs
    ? { startedAt: now, count: 0 }
    : entry
  current.count += 1
  return current
}

const retryAfterSeconds = (entry, now, windowMs) => Math.max(
  1,
  Math.ceil((windowMs - (now - entry.startedAt)) / 1000),
)

export const createPasswordAttemptLimiter = ({
  ...overrides
} = {}) => {
  const limits = { ...PASSWORD_ATTEMPT_LIMITS, ...overrides }
  const hmacKey = overrides.hmacKey || randomBytes(32)
  delete limits.hmacKey
  validateLimits(limits)
  if (!Buffer.isBuffer(hmacKey) || hmacKey.length < 32) {
    throw new Error('Password limiter HMAC key must contain at least 32 bytes')
  }

  const accountWindows = new Map()
  let globalWindow = null
  const overflowKey = hashAccountRateLimitKey('<overflow>', hmacKey)

  const pruneExpired = (now) => {
    for (const [key, entry] of accountWindows) {
      if (now - entry.startedAt >= limits.windowMs) accountWindows.delete(key)
    }
  }

  return Object.freeze({
    consume(identifier, at = Date.now()) {
      const timestamp = asTimestamp(at)
      pruneExpired(timestamp)
      globalWindow = consumeWindow(globalWindow, timestamp, limits.windowMs)
      if (globalWindow.count > limits.globalMax) {
        return {
          limited: true,
          scope: 'global',
          retryAfter: retryAfterSeconds(globalWindow, timestamp, limits.windowMs),
        }
      }

      const digest = hashAccountRateLimitKey(identifier, hmacKey)
      const storageKey = accountWindows.has(digest) || accountWindows.size < limits.maxTrackedAccounts
        ? digest
        : overflowKey
      const accountWindow = consumeWindow(
        accountWindows.get(storageKey),
        timestamp,
        limits.windowMs,
      )
      accountWindows.set(storageKey, accountWindow)
      if (accountWindow.count > limits.perAccountMax) {
        return {
          limited: true,
          scope: 'account',
          retryAfter: retryAfterSeconds(accountWindow, timestamp, limits.windowMs),
        }
      }
      return { limited: false, scope: null, retryAfter: 0 }
    },
    getStats() {
      return {
        trackedAccounts: accountWindows.size,
        maxTrackedAccounts: limits.maxTrackedAccounts,
        globalMax: limits.globalMax,
      }
    },
  })
}
