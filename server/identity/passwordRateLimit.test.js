import { describe, expect, it } from 'vitest'
import {
  PASSWORD_ATTEMPT_LIMITS,
  createPasswordAttemptLimiter,
  hashAccountRateLimitKey,
} from './passwordRateLimit.js'

describe('identity password-attempt limiter', () => {
  it('stores only a keyed digest for an account identifier', () => {
    const digest = hashAccountRateLimitKey('  Alice  ', Buffer.alloc(32, 7))
    expect(digest).toMatch(/^[a-f0-9]{64}$/)
    expect(digest).not.toContain('Alice')
    expect(hashAccountRateLimitKey('Alice', Buffer.alloc(32, 7))).toBe(digest)
    expect(hashAccountRateLimitKey('alice', Buffer.alloc(32, 7))).not.toBe(digest)
    expect(hashAccountRateLimitKey('Ａlice', Buffer.alloc(32, 7))).not.toBe(digest)
    expect(hashAccountRateLimitKey('', Buffer.alloc(32, 7)))
      .not.toBe(hashAccountRateLimitKey('<invalid>', Buffer.alloc(32, 7)))
    expect(hashAccountRateLimitKey('Alice', Buffer.alloc(32, 8))).not.toBe(digest)
  })

  it.each([
    ['alice', 'Alice'],
    ['Alice', 'Ａlice'],
  ])('keeps coexisting exact IDs %s and %s in independent buckets', (firstId, secondId) => {
    const limiter = createPasswordAttemptLimiter({
      windowMs: 60_000,
      perAccountMax: 1,
      globalMax: 10,
      maxTrackedAccounts: 20,
      hmacKey: Buffer.alloc(32, 11),
    })

    expect(limiter.consume(firstId, 0)).toMatchObject({ limited: false })
    expect(limiter.consume(firstId, 1)).toMatchObject({ limited: true, scope: 'account' })
    expect(limiter.consume(secondId, 2)).toMatchObject({ limited: false })
    expect(limiter.consume(secondId, 3)).toMatchObject({ limited: true, scope: 'account' })
  })

  it('counts successful and failed-shaped attempts alike and stops at the account limit', () => {
    const limiter = createPasswordAttemptLimiter({
      windowMs: 60_000,
      perAccountMax: 2,
      globalMax: 10,
      maxTrackedAccounts: 20,
      hmacKey: Buffer.alloc(32, 9),
    })

    expect(limiter.consume('alice', 0)).toMatchObject({ limited: false })
    expect(limiter.consume('alice', 1)).toMatchObject({ limited: false })
    expect(limiter.consume('alice', 2)).toMatchObject({ limited: true, scope: 'account' })
  })

  it('bounds memory under identifier spray and preserves mathematical headroom', () => {
    const limiter = createPasswordAttemptLimiter({
      windowMs: 60_000,
      perAccountMax: 20,
      globalMax: 20,
      maxTrackedAccounts: 40,
      hmacKey: Buffer.alloc(32, 10),
    })

    for (let index = 0; index < 10_000; index += 1) {
      limiter.consume(`spray-account-${index}`, index % 1000)
    }

    expect(limiter.getStats()).toMatchObject({
      trackedAccounts: 20,
      maxTrackedAccounts: 40,
      globalMax: 20,
    })
    expect(limiter.getStats().trackedAccounts)
      .toBeLessThanOrEqual(PASSWORD_ATTEMPT_LIMITS.maxTrackedAccounts)
  })
})
