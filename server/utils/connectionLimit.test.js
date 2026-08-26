import { describe, expect, it } from 'vitest'
import { createConnectionLimiter } from './connectionLimit.js'

describe('connection limiter', () => {
  it('enforces per-key and global limits and releases idempotently', () => {
    const limiter = createConnectionLimiter({ maxTotal: 2, maxPerKey: 1 })
    const releaseA = limiter.tryAcquire('a')
    expect(releaseA).toEqual(expect.any(Function))
    expect(limiter.tryAcquire('a')).toBeNull()
    const releaseB = limiter.tryAcquire('b')
    expect(releaseB).toEqual(expect.any(Function))
    expect(limiter.tryAcquire('c')).toBeNull()
    expect(limiter.total).toBe(2)

    releaseA()
    releaseA()
    expect(limiter.total).toBe(1)
    const releaseC = limiter.tryAcquire('c')
    expect(releaseC).toEqual(expect.any(Function))
    releaseB()
    releaseC()
    expect(limiter.total).toBe(0)
  })
})
