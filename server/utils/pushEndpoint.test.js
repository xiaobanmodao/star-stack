import { describe, expect, it } from 'vitest'
import { isTrustedPushEndpoint } from './pushEndpoint.js'

describe('push endpoint validation', () => {
  it('accepts supported browser push services', () => {
    expect(isTrustedPushEndpoint('https://fcm.googleapis.com/fcm/send/token')).toBe(true)
    expect(isTrustedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/token')).toBe(true)
    expect(isTrustedPushEndpoint('https://web.push.apple.com/Q-token')).toBe(true)
  })

  it('rejects arbitrary or local endpoints', () => {
    expect(isTrustedPushEndpoint('https://example.com/push')).toBe(false)
    expect(isTrustedPushEndpoint('https://127.0.0.1/push')).toBe(false)
    expect(isTrustedPushEndpoint('http://fcm.googleapis.com/push')).toBe(false)
  })
})
