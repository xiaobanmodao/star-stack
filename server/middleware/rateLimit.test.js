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

  it('keeps attacker-controlled keys from growing the map without bound', () => {
    const state = new Map()
    for (let index = 0; index < 10000; index += 1) {
      consumeRateLimit(state, `ip-${index}`, { now: 100, windowMs: 1000, max: 1 })
    }

    consumeRateLimit(state, 'new-ip', { now: 100, windowMs: 1000, max: 1 })

    expect(state.size).toBe(10000)
    expect(state.has('ip-0')).toBe(false)
    expect(state.has('new-ip')).toBe(true)
  })
})
