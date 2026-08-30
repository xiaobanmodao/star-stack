import { describe, expect, it } from 'vitest'
import { decodeCursor, decodePositiveIntegerCursor, encodeCursor } from './cursor.js'

describe('pagination cursors', () => {
  it('round-trips a bounded cursor payload', () => {
    const cursor = encodeCursor({ id: 42 })
    expect(decodeCursor(cursor)).toEqual({ id: 42 })
    expect(decodePositiveIntegerCursor(cursor)).toBe(42)
  })

  it('rejects malformed, oversized and non-positive cursors', () => {
    expect(decodeCursor('not-json')).toBeNull()
    expect(decodePositiveIntegerCursor(encodeCursor({ id: 0 }))).toBeNull()
    expect(decodeCursor('x'.repeat(201))).toBeNull()
  })
})
