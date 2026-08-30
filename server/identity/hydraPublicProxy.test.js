import { afterEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import { createHydraPublicProxy } from './hydraPublicProxy.js'

const servers = []
const config = {
  issuer: 'http://auth.localhost:5174',
  hydraPublicUrl: 'http://127.0.0.1:4444',
  production: false,
  accountCookieName: 'starstack_auth_dev',
  hydraCookies: {
    names: [
      'starstack_hydra_login_csrf_dev_464740523',
      'starstack_hydra_consent_csrf_dev_464740523',
      'starstack_hydra_session_dev',
      'starstack_hydra_device_csrf_dev',
    ],
    path: '/oauth2',
  },
  client: { redirectUri: 'http://jieya.localhost:4180/auth/callback' },
}

const start = async (fetchImpl, proxyConfig = config) => {
  const app = express()
  app.use(createHydraPublicProxy({ config: proxyConfig, fetchImpl }))
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
  })
  servers.push(server)
  return `http://127.0.0.1:${server.address().port}`
}

afterEach(async () => {
  while (servers.length) await new Promise((resolve) => servers.pop().close(resolve))
  vi.restoreAllMocks()
})

describe('Hydra fixed public proxy', () => {
  it('forwards only a fixed protocol route and preserves opaque token bodies without logging', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const fetchImpl = vi.fn(async (_url, options) => new Response(
      JSON.stringify({ access_token: 'upstream-token', token_type: 'bearer' }),
      { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
    ))
    const baseUrl = await start(fetchImpl)
    const body = 'grant_type=authorization_code&code=opaque-code&code_verifier=opaque-verifier'
    const response = await fetch(`${baseUrl}/oauth2/token`, {
      method: 'POST',
      headers: {
        authorization: 'Basic confidential-client-secret',
        'content-type': 'application/x-www-form-urlencoded',
        'x-injected-forwarded-for': 'attacker',
      },
      body,
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ access_token: 'upstream-token', token_type: 'bearer' })
    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:4444/oauth2/token')
    expect(options.method).toBe('POST')
    expect(Buffer.from(options.body).toString()).toBe(body)
    expect(options.headers.authorization).toBe('Basic confidential-client-secret')
    expect(options.headers['x-injected-forwarded-for']).toBeUndefined()
    expect(consoleSpy).not.toHaveBeenCalled()

    const unknown = await fetch(`${baseUrl}/admin/clients`)
    expect(unknown.status).toBe(404)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('sets trusted forwarding metadata from the frozen issuer instead of browser headers', async () => {
    const productionConfig = {
      ...config,
      issuer: 'https://auth.xingzhan.cc',
      production: true,
      accountCookieName: '__Host-starstack_auth',
      hydraCookies: {
        ...config.hydraCookies,
        names: [
          'starstack_hydra_login_csrf_681216528',
          'starstack_hydra_consent_csrf_681216528',
          'starstack_hydra_session',
          'starstack_hydra_device_csrf',
        ],
      },
      client: { redirectUri: 'https://jieya.xingzhan.cc/auth/callback' },
    }
    const fetchImpl = vi.fn(async () => new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const baseUrl = await start(fetchImpl, productionConfig)
    const response = await fetch(`${baseUrl}/.well-known/openid-configuration`, {
      headers: { 'x-forwarded-proto': 'http', 'x-forwarded-host': 'attacker.example' },
    })

    expect(response.status).toBe(200)
    const headers = fetchImpl.mock.calls[0][1].headers
    expect(headers['x-forwarded-proto']).toBe('https')
    expect(headers['x-forwarded-host']).toBe('auth.xingzhan.cc')
  })

  it('rejects an upstream redirect outside the issuer and exact client callback', async () => {
    const baseUrl = await start(vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'https://attacker.example/callback' },
    })))
    const response = await fetch(`${baseUrl}/oauth2/auth?client_id=x`, { redirect: 'manual' })
    expect(response.status).toBe(502)
    expect(response.headers.get('location')).toBeNull()
  })

  it('sends only audited Hydra cookies upstream and cannot overwrite the account cookie', async () => {
    const upstreamHeaders = new Headers({
      location: 'http://auth.localhost:5174/account/login?login_challenge=test',
    })
    upstreamHeaders.append(
      'set-cookie',
      'starstack_hydra_login_csrf_dev_464740523=hydra-next; Path=/; SameSite=None',
    )
    upstreamHeaders.append(
      'set-cookie',
      'starstack_auth_dev=attacker-controlled; Path=/; HttpOnly; SameSite=Lax',
    )
    upstreamHeaders.append('set-cookie', 'unreviewed_hydra_cookie=opaque; Path=/')
    const fetchImpl = vi.fn(async () => new Response(null, {
      status: 302,
      headers: upstreamHeaders,
    }))
    const baseUrl = await start(fetchImpl)
    const response = await fetch(`${baseUrl}/oauth2/auth?client_id=test`, {
      headers: {
        cookie: [
          'starstack_auth_dev=account-secret',
          'starstack_hydra_login_csrf_dev_464740523=hydra-current',
          'unreviewed_hydra_cookie=other-secret',
        ].join('; '),
      },
      redirect: 'manual',
    })

    expect(response.status).toBe(302)
    expect(fetchImpl.mock.calls[0][1].headers.cookie)
      .toBe('starstack_hydra_login_csrf_dev_464740523=hydra-current')
    const setCookies = response.headers.getSetCookie()
    expect(setCookies).toEqual([
      'starstack_hydra_login_csrf_dev_464740523=hydra-next; Path=/oauth2; HttpOnly; SameSite=Lax',
    ])
    expect(setCookies.join(';')).not.toContain('starstack_auth_dev')
    expect(setCookies.join(';')).not.toContain('unreviewed_hydra_cookie')
  })

  it('fails closed when a protocol request body exceeds its bound', async () => {
    const fetchImpl = vi.fn()
    const app = express()
    app.use(createHydraPublicProxy({ config, fetchImpl, maxRequestBodyBytes: 32 }))
    const server = await new Promise((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
    })
    servers.push(server)
    const baseUrl = `http://127.0.0.1:${server.address().port}`

    const response = await fetch(`${baseUrl}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `code=${'x'.repeat(100)}`,
    })
    expect(response.status).toBe(413)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('stops reading a chunked upstream response as soon as its bound is exceeded', async () => {
    let yielded = 0
    const upstream = {
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      body: {
        async *[Symbol.asyncIterator]() {
          yielded += 1
          yield Buffer.alloc(20)
          yielded += 1
          yield Buffer.alloc(20)
          yielded += 1
          throw new Error('the proxy read beyond its response limit')
        },
      },
    }
    const app = express()
    app.use(createHydraPublicProxy({
      config,
      fetchImpl: vi.fn(async () => upstream),
      maxResponseBodyBytes: 32,
    }))
    const server = await new Promise((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
    })
    servers.push(server)
    const baseUrl = `http://127.0.0.1:${server.address().port}`

    const response = await fetch(`${baseUrl}/.well-known/openid-configuration`)
    expect(response.status).toBe(502)
    expect(yielded).toBe(2)
  })
})
