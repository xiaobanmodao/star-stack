import { describe, expect, it } from 'vitest'
import { formatBytes, isBackupFresh } from './monitoring.js'

describe('monitoring helpers', () => {
  it('formats process and backup sizes for the admin dashboard', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
  })

  it('only treats a recent successful backup as healthy', () => {
    expect(isBackupFresh({ healthy: true })).toBe(true)
    expect(isBackupFresh({ healthy: false })).toBe(false)
    expect(isBackupFresh(null)).toBe(false)
  })
})
