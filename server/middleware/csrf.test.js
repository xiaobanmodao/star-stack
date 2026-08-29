import { describe, expect, it } from 'vitest'
import { createCsrfProtection } from './csrf.js'

const makeResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this },
  json(body) { this.body = body; return this },
})

const makeRequest = (headers = {}, method = 'POST') => ({
  method,
  headers: { cookie: 'starstack_session=0123456789abcdef0123456789abcdef0123456789abcdef', ...headers },
  protocol: 'https',
  get(name) { return this.headers[name.toLowerCase()] || this.headers[name] || '' },
})

describe('cookie session CSRF protection', () => {
  it('accepts configured same-origin requests and rejects other origins', () => {
    const middleware = createCsrfProtection({ allowedOrigins: ['https://xingzhan.cc'], isProduction: true })
    const trustedResponse = makeResponse()
    let trustedNext = false
    middleware(makeRequest({ origin: 'https://xingzhan.cc' }), trustedResponse, () => { trustedNext = true })
    expect(trustedNext).toBe(true)

    const rejectedResponse = makeResponse()
    let rejectedNext = false
    middleware(makeRequest({ origin: 'https://evil.example' }), rejectedResponse, () => { rejectedNext = true })
    expect(rejectedNext).toBe(false)
    expect(rejectedResponse.statusCode).toBe(403)
  })

  it('leaves bearer-only clients and safe methods compatible', () => {
    const middleware = createCsrfProtection({ allowedOrigins: [], isProduction: true })
    const bearerRequest = makeRequest({ cookie: '', authorization: 'Bearer token' })
    const safeRequest = makeRequest({ origin: 'https://evil.example' }, 'GET')
    for (const request of [bearerRequest, safeRequest]) {
      let nextCalled = false
      middleware(request, makeResponse(), () => { nextCalled = true })
      expect(nextCalled).toBe(true)
    }
  })
})
