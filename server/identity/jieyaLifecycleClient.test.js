import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  JIEYA_ACCOUNT_LIFECYCLE_HEADER,
  JIEYA_ACCOUNT_LIFECYCLE_URL,
  createNodeHttpLifecycleFetch,
  createJieyaAccountLifecycleClient,
} from './jieyaLifecycleClient.js'

const secret = 'lifecycle-secret-with-at-least-thirty-two-bytes'
const event = Object.freeze({
  version: 1,
  eventId: '11111111-1111-4111-8111-111111111111',
  issuer: 'https://auth.xingzhan.cc',
  sub: '22222222-2222-4222-8222-222222222222',
  status: 'suspended',
  authGeneration: 7,
  occurredAt: '2026-08-31T10:00:00.000Z',
})

describe('Jieya account lifecycle client', () => {
  it('preserves the canonical Host header in the actual node:http request options', async () => {
    let respond
    const request = new EventEmitter()
    request.end = vi.fn(() => {
      const response = new EventEmitter()
      response.statusCode = 200
      response.headers = { 'content-type': 'application/json' }
      respond(response)
      queueMicrotask(() => {
        response.emit('data', Buffer.from('{"status":"applied"}'))
        response.emit('end')
      })
    })
    request.destroy = vi.fn((error) => request.emit('error', error))
    const requestImpl = vi.fn((options, callback) => {
      respond = callback
      return request
    })
    const fetchImpl = createNodeHttpLifecycleFetch({ requestImpl })
    const client = createJieyaAccountLifecycleClient({ secret, fetchImpl })

    await expect(client.deliver(event)).resolves.toEqual({ status: 'applied' })
    expect(requestImpl).toHaveBeenCalledWith(expect.objectContaining({
      agent: false,
      hostname: '127.0.0.1',
      method: 'POST',
      path: '/internal/starstack/account-lifecycle',
      port: 4180,
      headers: expect.objectContaining({
        Host: 'jieya.xingzhan.cc',
        [JIEYA_ACCOUNT_LIFECYCLE_HEADER]: secret,
      }),
    }), expect.any(Function))
    expect(request.end).toHaveBeenCalledWith(JSON.stringify(event))
  })

  it('bounds the node:http response body and retries without parsing oversized content', async () => {
    let respond
    const request = new EventEmitter()
    request.end = vi.fn(() => {
      const response = new EventEmitter()
      response.statusCode = 200
      response.headers = { 'content-type': 'application/json' }
      response.destroy = vi.fn()
      respond(response)
      queueMicrotask(() => {
        response.emit('data', Buffer.alloc(129, 0x78))
        response.emit('end')
      })
    })
    request.destroy = vi.fn((error) => request.emit('error', error))
    const requestImpl = vi.fn((_options, callback) => {
      respond = callback
      return request
    })
    const client = createJieyaAccountLifecycleClient({
      secret,
      fetchImpl: createNodeHttpLifecycleFetch({ requestImpl, maxResponseBytes: 128 }),
    })

    const error = await client.deliver(event).catch((caught) => caught)
    expect(error).toMatchObject({ retryable: true })
  })

  it('aborts a stalled node:http request at the configured deadline', async () => {
    const request = new EventEmitter()
    request.end = vi.fn()
    request.destroy = vi.fn((error) => request.emit('error', error))
    const requestImpl = vi.fn(() => request)
    const client = createJieyaAccountLifecycleClient({
      secret,
      fetchImpl: createNodeHttpLifecycleFetch({ requestImpl }),
      timeoutMs: 100,
    })

    const error = await client.deliver(event).catch((caught) => caught)
    expect(error).toMatchObject({ retryable: true })
    expect(error.message).toMatch(/timed out/i)
    expect(request.destroy).toHaveBeenCalledTimes(1)
  })

  it('posts the exact v1 wire to the fixed loopback endpoint with its dedicated header', async () => {
    const fetchImpl = vi.fn(async () => ({
      status: 200,
      json: async () => ({ status: 'applied' }),
    }))
    const client = createJieyaAccountLifecycleClient({ secret, fetchImpl })

    await expect(client.deliver(event)).resolves.toEqual({ status: 'applied' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, request] = fetchImpl.mock.calls[0]
    expect(url).toBe(JIEYA_ACCOUNT_LIFECYCLE_URL)
    expect(url).toBe('http://127.0.0.1:4180/internal/starstack/account-lifecycle')
    expect(request).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Host: 'jieya.xingzhan.cc',
        [JIEYA_ACCOUNT_LIFECYCLE_HEADER]: secret,
      },
      body: JSON.stringify(event),
    })
    expect(request.signal).toBeInstanceOf(AbortSignal)
  })

  it.each(['applied', 'duplicate', 'stale', 'terminal'])(
    'accepts only the exact Jieya 200 %s acknowledgement',
    async (status) => {
      const fetchImpl = vi.fn(async () => ({
        status: 200,
        json: async () => ({ status }),
      }))
      const client = createJieyaAccountLifecycleClient({ secret, fetchImpl })

      await expect(client.deliver(event)).resolves.toEqual({ status })
    },
  )

  it.each([
    [{ status: 'conflict' }],
    [{ status: 'applied', extra: true }],
    [{ result: 'applied' }],
    [null],
  ])('retries instead of completing on a malformed 200 acknowledgement %#', async (body) => {
    const fetchImpl = vi.fn(async () => ({
      status: 200,
      json: async () => body,
    }))
    const client = createJieyaAccountLifecycleClient({ secret, fetchImpl })

    const error = await client.deliver(event).catch((caught) => caught)
    expect(error).toMatchObject({ retryable: true, status: 200 })
  })

  it('retries a non-contractual 2xx response instead of falsely completing the outbox', async () => {
    const fetchImpl = vi.fn(async () => ({ status: 204 }))
    const client = createJieyaAccountLifecycleClient({ secret, fetchImpl })

    const error = await client.deliver(event).catch((caught) => caught)
    expect(error).toMatchObject({ retryable: true, status: 204 })
  })

  it.each([
    [300, false],
    [400, false],
    [401, false],
    [403, false],
    [409, false],
    [429, false],
    [500, true],
  ])('classifies HTTP %s retryability without exposing response or secret', async (status, retryable) => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status,
      text: async () => `upstream body includes ${secret}`,
    }))
    const client = createJieyaAccountLifecycleClient({ secret, fetchImpl })

    const error = await client.deliver(event).catch((caught) => caught)
    expect(error).toBeInstanceOf(Error)
    expect(error.status).toBe(status)
    expect(error.retryable).toBe(retryable)
    expect(error.message).not.toContain(secret)
    expect(error.message).not.toContain('upstream body')
  })

  it('honors Jieya 503 Retry-After seconds for durable backoff', async () => {
    const fetchImpl = vi.fn(async () => ({
      status: 503,
      headers: { get: (name) => name.toLowerCase() === 'retry-after' ? '60' : null },
    }))
    const client = createJieyaAccountLifecycleClient({ secret, fetchImpl })

    const error = await client.deliver(event).catch((caught) => caught)
    expect(error).toMatchObject({ status: 503, retryable: true, retryAfterMs: 60_000 })
  })

  it('marks a network failure as retryable without copying the upstream message', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`network details contain ${secret}`)
    })
    const client = createJieyaAccountLifecycleClient({ secret, fetchImpl })

    const error = await client.deliver(event).catch((caught) => caught)
    expect(error).toMatchObject({ retryable: true })
    expect(error.message).not.toContain(secret)
  })

  it('fails closed for extra, malformed or non-production wire fields before any request', async () => {
    const fetchImpl = vi.fn()
    const client = createJieyaAccountLifecycleClient({ secret, fetchImpl })
    const invalid = [
      { ...event, version: 2 },
      { ...event, issuer: 'http://auth.localhost:5174' },
      { ...event, status: 'password_changed' },
      { ...event, authGeneration: -1 },
      { ...event, eventId: '11111111-1111-1111-8111-111111111111' },
      { ...event, eventId: '11111111-1111-4111-8111-11111111111A' },
      { ...event, extra: true },
    ]
    for (const payload of invalid) {
      await expect(client.deliver(payload)).rejects.toThrow(/lifecycle|event|wire/i)
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
