import { describe, expect, it, vi } from 'vitest'
import { HydraAdminError, createHydraAdminClient } from './hydraAdminClient.js'

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
})

describe('Hydra Admin client', () => {
  it('uses the v26.2.0 challenge, introspection and revocation endpoints', async () => {
    const fetchImpl = vi.fn(async (url, options) => {
      if (url.includes('/introspect')) return jsonResponse({ active: true, sub: 'subject-1' })
      if (options?.method === 'DELETE') return new Response(null, { status: 204 })
      if (options?.method === 'PUT') return jsonResponse({ redirect_to: 'http://auth.localhost:5174/oauth2/auth?x=1' })
      return jsonResponse({ challenge: 'challenge-1', client: { client_id: 'jieya-server-local' } })
    })
    const admin = createHydraAdminClient({
      baseUrl: 'http://127.0.0.1:4445',
      issuer: 'http://auth.localhost:5174',
      fetchImpl,
    })

    await admin.getLoginRequest('login-challenge')
    await admin.acceptLoginRequest('login-challenge', { subject: 'subject-1' })
    await admin.getConsentRequest('consent-challenge')
    await admin.acceptConsentRequest('consent-challenge', { grant_scope: ['openid'] })
    await admin.rejectConsentRequest('consent-challenge', { error: 'access_denied' })
    await admin.introspectToken('opaque-access-token')
    await admin.revokeLoginSession('sid-1')
    await admin.revokeConsentSessions('subject-1', 'jieya-server-local')

    const calls = fetchImpl.mock.calls.map(([url, options]) => ({ url, options }))
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      '/admin/oauth2/auth/requests/login',
      '/admin/oauth2/auth/requests/login/accept',
      '/admin/oauth2/auth/requests/consent',
      '/admin/oauth2/auth/requests/consent/accept',
      '/admin/oauth2/auth/requests/consent/reject',
      '/admin/oauth2/introspect',
      '/admin/oauth2/auth/sessions/login',
      '/admin/oauth2/auth/sessions/consent',
    ])
    expect(calls[5].options.body.toString()).toBe('token=opaque-access-token')
    expect(calls[6].url).toContain('sid=sid-1')
    expect(calls[7].url).toContain('subject=subject-1')
    expect(calls[7].url).toContain('client=jieya-server-local')
  })

  it('rejects unsafe Admin URLs, malformed challenge values and untrusted redirects', async () => {
    expect(() => createHydraAdminClient({
      baseUrl: 'https://public.example.com',
      issuer: 'http://auth.localhost:5174',
    })).toThrow(/private|loopback|私网/i)

    const admin = createHydraAdminClient({
      baseUrl: 'http://127.0.0.1:4445',
      issuer: 'http://auth.localhost:5174',
      fetchImpl: vi.fn(async () => jsonResponse({ redirect_to: 'https://attacker.example/callback' })),
    })
    await expect(admin.acceptLoginRequest('bad challenge with spaces', { subject: 'subject' }))
      .rejects.toBeInstanceOf(HydraAdminError)
    await expect(admin.acceptLoginRequest('valid-challenge', { subject: 'subject' }))
      .rejects.toThrow(/redirect|跳转/i)
  })

  it('does not include response bodies or submitted tokens in errors', async () => {
    const secret = 'opaque-access-token-that-must-not-leak'
    const admin = createHydraAdminClient({
      baseUrl: 'http://127.0.0.1:4445',
      issuer: 'http://auth.localhost:5174',
      fetchImpl: vi.fn(async () => jsonResponse({ error_description: secret }, 503)),
    })
    let error
    try { await admin.introspectToken(secret) } catch (caught) { error = caught }
    expect(error).toBeInstanceOf(HydraAdminError)
    expect(error.message).not.toContain(secret)
    expect(JSON.stringify(error)).not.toContain(secret)
  })

  it('creates a missing client and updates an existing client using Hydra v26 semantics', async () => {
    let exists = false
    const fetchImpl = vi.fn(async (_url, options) => {
      if (options?.method === 'POST') {
        exists = true
        return jsonResponse({ client_id: 'jieya-server-local' }, 201)
      }
      if (options?.method === 'PUT') return jsonResponse({ client_id: 'jieya-server-local' })
      return exists
        ? jsonResponse({ client_id: 'jieya-server-local' })
        : jsonResponse({ error: 'not_found' }, 404)
    })
    const admin = createHydraAdminClient({
      baseUrl: 'http://127.0.0.1:4445',
      issuer: 'http://auth.localhost:5174',
      fetchImpl,
    })

    await admin.upsertClient('jieya-server-local', { scope: 'openid profile' })
    await admin.upsertClient('jieya-server-local', { scope: 'openid profile offline_access' })

    expect(fetchImpl.mock.calls.map(([url, options]) => [
      options?.method || 'GET',
      new URL(url).pathname,
    ])).toEqual([
      ['GET', '/admin/clients/jieya-server-local'],
      ['POST', '/admin/clients'],
      ['GET', '/admin/clients/jieya-server-local'],
      ['PUT', '/admin/clients/jieya-server-local'],
    ])
  })
})
