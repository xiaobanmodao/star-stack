import { request as nodeHttpRequest } from 'node:http'

export const JIEYA_ACCOUNT_LIFECYCLE_URL =
  'http://127.0.0.1:4180/internal/starstack/account-lifecycle'
export const JIEYA_ACCOUNT_LIFECYCLE_HEADER = 'X-StarStack-Account-Lifecycle'
export const JIEYA_ACCOUNT_LIFECYCLE_HOST = 'jieya.xingzhan.cc'
export const JIEYA_ACCOUNT_LIFECYCLE_ISSUER = 'https://auth.xingzhan.cc'
export const JIEYA_ACCOUNT_LIFECYCLE_VERSION = 1

const SECRET_MIN_BYTES = 32
const DEFAULT_TIMEOUT_MS = 3000
const MAX_RESPONSE_BYTES = 4096
const wireKeys = Object.freeze([
  'version',
  'eventId',
  'issuer',
  'sub',
  'status',
  'authGeneration',
  'occurredAt',
])
const sortedWireKeys = Object.freeze([...wireKeys].sort())
const lifecycleStatuses = new Set(['active', 'suspended', 'deleted'])
const lifecycleAcknowledgements = new Set(['applied', 'duplicate', 'stale', 'terminal'])
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export class JieyaAccountLifecycleDeliveryError extends Error {
  constructor(message, { status, retryable = false, retryAfterMs } = {}) {
    super(message)
    this.name = 'JieyaAccountLifecycleDeliveryError'
    if (Number.isInteger(status)) this.status = status
    this.retryable = retryable === true
    if (Number.isSafeInteger(retryAfterMs) && retryAfterMs >= 0) {
      this.retryAfterMs = retryAfterMs
    }
  }
}

const assertSecret = (secret) => {
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < SECRET_MIN_BYTES
    || secret.includes('\0') || /[\r\n]/.test(secret)) {
    throw new Error('Jieya account lifecycle secret is invalid')
  }
}

const assertWireEvent = (event) => {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new Error('Jieya account lifecycle wire event is invalid')
  }
  const keys = Object.keys(event).sort()
  if (keys.length !== wireKeys.length
    || keys.some((key, index) => key !== sortedWireKeys[index])) {
    throw new Error('Jieya account lifecycle wire event fields are invalid')
  }
  if (event.version !== JIEYA_ACCOUNT_LIFECYCLE_VERSION
    || event.issuer !== JIEYA_ACCOUNT_LIFECYCLE_ISSUER
    || !uuidV4Pattern.test(event.eventId)
    || !uuidV4Pattern.test(event.sub)
    || !lifecycleStatuses.has(event.status)
    || !Number.isSafeInteger(event.authGeneration) || event.authGeneration < 0
    || typeof event.occurredAt !== 'string'
    || !Number.isFinite(Date.parse(event.occurredAt))
    || new Date(event.occurredAt).toISOString() !== event.occurredAt) {
    throw new Error('Jieya account lifecycle wire event is invalid')
  }
}

const parseRetryAfterMs = (response) => {
  const value = response?.headers?.get?.('retry-after')
  if (typeof value !== 'string' || !/^\d{1,5}$/.test(value)) return undefined
  const seconds = Number(value)
  if (!Number.isSafeInteger(seconds) || seconds < 0) return undefined
  return Math.min(seconds * 1000, 60 * 60 * 1000)
}

export const createNodeHttpLifecycleFetch = ({
  requestImpl = nodeHttpRequest,
  maxResponseBytes = MAX_RESPONSE_BYTES,
} = {}) => {
  if (typeof requestImpl !== 'function') throw new Error('A node:http request implementation is required')
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 128 || maxResponseBytes > 16_384) {
    throw new Error('Jieya account lifecycle response limit is invalid')
  }

  return (url, options = {}) => new Promise((resolve, reject) => {
    if (url !== JIEYA_ACCOUNT_LIFECYCLE_URL
      || options.method !== 'POST'
      || typeof options.body !== 'string') {
      reject(new Error('Jieya account lifecycle transport request is invalid'))
      return
    }
    let settled = false
    let request
    const cleanup = () => options.signal?.removeEventListener?.('abort', onAbort)
    const fail = (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error instanceof Error ? error : new Error('Jieya lifecycle transport failed'))
    }
    const complete = (value) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }
    const onAbort = () => {
      const reason = options.signal?.reason
      const error = reason instanceof Error ? reason : new Error('Jieya lifecycle transport aborted')
      request?.destroy(error)
      fail(error)
    }

    try {
      request = requestImpl({
        agent: false,
        hostname: '127.0.0.1',
        port: 4180,
        path: '/internal/starstack/account-lifecycle',
        method: 'POST',
        headers: {
          ...options.headers,
          'Content-Length': Buffer.byteLength(options.body, 'utf8'),
        },
      }, (response) => {
        const chunks = []
        let bytes = 0
        response.on('data', (chunk) => {
          const buffer = Buffer.from(chunk)
          bytes += buffer.length
          if (bytes > maxResponseBytes) {
            response.destroy?.()
            fail(new Error('Jieya account lifecycle response exceeded its limit'))
            return
          }
          chunks.push(buffer)
        })
        response.once('error', fail)
        response.once('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          complete({
            status: response.statusCode,
            headers: {
              get(name) {
                const value = response.headers?.[String(name).toLowerCase()]
                return Array.isArray(value) ? value[0] : value ?? null
              },
            },
            json: async () => JSON.parse(text),
          })
        })
      })
      request.once('error', fail)
      if (options.signal?.aborted) {
        onAbort()
        return
      }
      options.signal?.addEventListener?.('abort', onAbort, { once: true })
      request.end(options.body)
    } catch (error) {
      fail(error)
    }
  })
}

export const createJieyaAccountLifecycleClient = ({
  secret,
  fetchImpl = createNodeHttpLifecycleFetch(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) => {
  assertSecret(secret)
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) {
    throw new Error('Jieya account lifecycle timeout is invalid')
  }

  return Object.freeze({
    async deliver(event) {
      assertWireEvent(event)
      let response
      try {
        response = await fetchImpl(JIEYA_ACCOUNT_LIFECYCLE_URL, {
          method: 'POST',
          redirect: 'error',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Host: JIEYA_ACCOUNT_LIFECYCLE_HOST,
            [JIEYA_ACCOUNT_LIFECYCLE_HEADER]: secret,
          },
          body: JSON.stringify(event),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (error) {
        throw new JieyaAccountLifecycleDeliveryError(
          error?.name === 'TimeoutError'
            ? 'Jieya account lifecycle delivery timed out'
            : 'Jieya account lifecycle delivery failed',
          { retryable: true },
        )
      }
      const status = Number(response?.status)
      if (status !== 200) {
        const retryable = !Number.isInteger(status)
          || (status >= 200 && status <= 299)
          || (status >= 500 && status <= 599)
        throw new JieyaAccountLifecycleDeliveryError(
          'Jieya account lifecycle endpoint rejected the event',
          {
            status: Number.isInteger(status) ? status : undefined,
            retryable,
            retryAfterMs: status === 503 ? parseRetryAfterMs(response) : undefined,
          },
        )
      }
      let acknowledgement
      try {
        acknowledgement = await response.json()
      } catch {
        throw new JieyaAccountLifecycleDeliveryError(
          'Jieya account lifecycle acknowledgement is invalid',
          { status, retryable: true },
        )
      }
      if (!acknowledgement || typeof acknowledgement !== 'object'
        || Array.isArray(acknowledgement)
        || Object.keys(acknowledgement).length !== 1
        || !lifecycleAcknowledgements.has(acknowledgement.status)) {
        throw new JieyaAccountLifecycleDeliveryError(
          'Jieya account lifecycle acknowledgement is invalid',
          { status, retryable: true },
        )
      }
      return { status: acknowledgement.status }
    },
  })
}
