import { describe, expect, it } from 'vitest'
import { consumeRateLimit } from './rateLimit.js'

describe('rate limit helper', () => {
  it('limits within a window and resets after expiry', () => {
    const state = new Map()
    expect(consumeRateLimit(state, 'user', { now: 100, windowMs: 1000, max: 2 }).limited).toBe(false)
    expect(consumeRateLimit(state, 'user', { now: 200, windowMs: 1000, max: 2 }).limited).toBe(false)
    expect(consumeRateLimit(state, 'user', { now: 300, windowMs: 1000, max: 2 }).limited).toBe(true)
    expect(consumeRateLimit(state, 'user', { now: 1200, windowMs: 1000, max: 2 }).limited).toBe(false)
  })
})
