#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { closeSync, openSync } from 'node:fs'
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  HYDRA_BROWSER_COOKIE_NAMES,
  HYDRA_BROWSER_COOKIE_PATH,
  loadIdentityConfig,
} from '../../server/identity/config.js'
import { assertLocalHydraTestDsn } from './localHydraDsn.mjs'

const requireFromServer = createRequire(new URL('../../server/package.json', import.meta.url))
const sqlite3 = requireFromServer('sqlite3')
const { open } = requireFromServer('sqlite')

const runtimeRoot = path.resolve('.identity-runtime')
const hydraBinary = process.env.HYDRA_TEST_BINARY || path.join(runtimeRoot, 'hydra')
const hydraDsn = assertLocalHydraTestDsn(process.env.HYDRA_TEST_DSN)
await access(hydraBinary).catch(() => {
  throw new Error('Hydra binary is missing; set HYDRA_TEST_BINARY or run npm run identity:hydra:fetch')
})
await mkdir(runtimeRoot, { recursive: true, mode: 0o700 })
await chmod(runtimeRoot, 0o700)
const workDir = await mkdtemp(path.join(runtimeRoot, 'protocol-'))
const starStackDatabase = process.env.IDENTITY_TEST_STARSTACK_DB
  || path.join(runtimeRoot, 'ss-auth-002-starstack.sqlite')
const issuer = 'http://auth.localhost:5174'
const adminOrigin = 'http://127.0.0.1:4445'
const localIdentityConfig = loadIdentityConfig({ NODE_ENV: 'development' })
const accountCookieName = localIdentityConfig.accountCookieName
// Independent v26.2.0 audit fixture: do not derive these final names from the
// proxy configuration, otherwise the live Set-Cookie assertion would only
// prove that one shared constant agrees with itself.
const expectedLiveHydraCookieNames = Object.freeze([
  'starstack_hydra_login_csrf_dev_464740523',
  'starstack_hydra_consent_csrf_dev_464740523',
  'starstack_hydra_session_dev',
  'starstack_hydra_device_csrf_dev',
])
if (JSON.stringify(localIdentityConfig.hydraCookies.names)
  !== JSON.stringify(expectedLiveHydraCookieNames)) {
  throw new Error('StarStack local Hydra cookie allowlist drifted from the v26.2.0 audit fixture')
}
const allowedHydraCookieNames = new Set(expectedLiveHydraCookieNames)
const observedHydraCookieNames = new Set()
const credentialsPath = process.env.IDENTITY_TEST_CREDENTIALS_FILE
  || path.join(runtimeRoot, 'ss-auth-002-local-credentials.json')

const createCredentials = () => ({
  fixtureId: 'oidc-fixture-user',
  fixturePassword: randomBytes(32).toString('base64url'),
  clientSecret: randomBytes(48).toString('base64url'),
  tokenHookSecret: randomBytes(48).toString('base64url'),
  logoutBrokerSecret: randomBytes(48).toString('base64url'),
  systemSecret: randomBytes(48).toString('base64url'),
  cookieSecret: randomBytes(48).toString('base64url'),
})

const loadCredentials = async () => {
  try {
    return JSON.parse(await readFile(credentialsPath, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    const generated = createCredentials()
    await writeFile(credentialsPath, `${JSON.stringify(generated, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    await chmod(credentialsPath, 0o600)
    return generated
  }
}

const credentials = await loadCredentials()
await chmod(credentialsPath, 0o600)
for (const [name, value] of Object.entries(credentials)) {
  const minimumLength = name === 'fixtureId' ? 3 : 32
  if (typeof value !== 'string' || value.length < minimumLength) {
    throw new Error(`Local identity credential ${name} is missing or too short`)
  }
}
const {
  fixtureId,
  fixturePassword,
  clientSecret,
  tokenHookSecret,
  logoutBrokerSecret,
  systemSecret,
  cookieSecret,
} = credentials
const processes = []
let bffServer
let succeeded = false

const waitForExit = (child) => new Promise((resolve) => child.once('exit', resolve))

const run = (command, args, { env = process.env } = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout = `${stdout}${chunk.toString()}`.slice(-4000)
  })
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-12000)
  })
  child.once('error', reject)
  child.once('exit', (code) => {
    if (code === 0) resolve(stdout)
    else reject(new Error(`${path.basename(command)} exited with ${code}: ${stderr.slice(-4000)}`))
  })
})

const spawnService = (name, command, args, env) => {
  const output = openSync(path.join(workDir, `${name}.log`), 'a', 0o600)
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', output, output],
  })
  closeSync(output)
  processes.push(child)
  return child
}

const assertPortFree = (port, host = '127.0.0.1') => new Promise((resolve, reject) => {
  const server = net.createServer()
  server.once('error', () => reject(new Error(`Local ${host}:${port} is already in use`)))
  server.listen(port, host, () => server.close(resolve))
})

const waitForHttp = async (url, { expected = [200], timeoutMs = 20000 } = {}) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(1000) })
      if (expected.includes(response.status)) return response
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

class CookieJar {
  #cookies = new Map()

  clone() {
    const cloned = new CookieJar()
    cloned.#cookies = new Map(this.#cookies)
    return cloned
  }

  add(response) {
    const values = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : []
    for (const value of values) {
      const [pair, ...attributes] = value.split(';')
      const separator = pair.indexOf('=')
      if (separator < 0) continue
      const name = pair.slice(0, separator).trim()
      const cookieValue = pair.slice(separator + 1).trim()
      const expired = attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute))
      if (expired || !cookieValue) this.#cookies.delete(name)
      else this.#cookies.set(name, cookieValue)
    }
  }

  header() {
    return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join('; ')
  }

  get(name) {
    return this.#cookies.get(name)
  }
}

const jar = new CookieJar()
let accountCookieShieldExercised = false
let hydraCookiePolicyObserved = false
const requestWithJar = async (sessionJar, url, options = {}) => {
  const target = new URL(url)
  const headers = new Headers(options.headers || {})
  const cookie = sessionJar.header()
  if (cookie) headers.set('cookie', cookie)
  const accountCookieBefore = sessionJar.get(accountCookieName)
  const hydraPublicRequest = target.origin === issuer && target.pathname.startsWith('/oauth2/')
  if (hydraPublicRequest && accountCookieBefore) {
    accountCookieShieldExercised = true
  }
  const response = await fetch(url, { ...options, headers, redirect: 'manual' })
  if (hydraPublicRequest) {
    for (const setCookie of response.headers.getSetCookie()) {
      const name = setCookie.slice(0, setCookie.indexOf('='))
      if (!allowedHydraCookieNames.has(name)
        || !setCookie.includes(`Path=${HYDRA_BROWSER_COOKIE_PATH}`)
        || !setCookie.includes('HttpOnly')
        || !setCookie.includes('SameSite=Lax')
        || /;\s*Domain=/i.test(setCookie)) {
        throw new Error(`Hydra browser cookie policy mismatch for ${name}`)
      }
      observedHydraCookieNames.add(name)
      hydraCookiePolicyObserved = true
    }
  }
  sessionJar.add(response)
  if (hydraPublicRequest && accountCookieBefore
    && sessionJar.get(accountCookieName) !== accountCookieBefore) {
    throw new Error('Hydra public response overwrote the StarStack account cookie')
  }
  return response
}
const request = (url, options) => requestWithJar(jar, url, options)

const browserEquivalentFormHeaders = (pageResponse, pageUrl) => {
  if (pageResponse.headers.get('referrer-policy') !== 'same-origin') {
    throw new Error('Identity page must retain same-origin Referer for protected form POSTs')
  }
  const csp = pageResponse.headers.get('content-security-policy') || ''
  const formAction = csp.split(';').map((directive) => directive.trim())
    .find((directive) => directive.startsWith('form-action '))
  if (formAction !== "form-action 'self' http://jieya.localhost:4180") {
    throw new Error('Identity page must allow only self and the frozen local Jieya origin in form-action')
  }
  const page = new URL(pageUrl)
  if (page.origin !== issuer) throw new Error('Identity form page origin mismatch')
  return {
    'content-type': 'application/x-www-form-urlencoded',
    origin: issuer,
    referer: page.toString(),
  }
}

const decodeHtml = (value) => value
  .replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'")
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')
  .replaceAll('&amp;', '&')

const hidden = (html, name) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = html.match(new RegExp(`<input[^>]+name="${escaped}"[^>]+value="([^"]*)"`, 'i'))
  if (!match) throw new Error(`Missing hidden field ${name}`)
  return decodeHtml(match[1])
}

const absoluteLocation = (response, currentUrl) => {
  const location = response.headers.get('location')
  if (!location) throw new Error(`Expected redirect from ${currentUrl}, got ${response.status}`)
  return new URL(location, currentUrl).toString()
}

const randomUrlValue = () => randomBytes(24).toString('base64url')
const pkce = () => {
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

const authorize = async ({ sessionJar = jar, allowPassword = true } = {}) => {
  const proof = pkce()
  const state = randomUrlValue()
  const nonce = randomUrlValue()
  const authorization = new URL('/oauth2/auth', issuer)
  authorization.search = new URLSearchParams({
    client_id: 'jieya-server-local',
    redirect_uri: 'http://jieya.localhost:4180/auth/callback',
    response_type: 'code',
    scope: 'openid profile offline_access',
    state,
    nonce,
    code_challenge: proof.challenge,
    code_challenge_method: 'S256',
  })

  let current = authorization.toString()
  for (let step = 0; step < 20; step += 1) {
    const url = new URL(current)
    if (url.origin === 'http://jieya.localhost:4180' && url.pathname === '/auth/callback') {
      if (url.searchParams.get('state') !== state || !url.searchParams.get('code')) {
        throw new Error('Authorization callback state/code mismatch')
      }
      return { code: url.searchParams.get('code'), verifier: proof.verifier, nonce }
    }

    const response = await requestWithJar(sessionJar, current)
    if (response.status >= 300 && response.status < 400) {
      current = absoluteLocation(response, current)
      continue
    }
    const html = await response.text()
    if (url.pathname === '/account/login' && response.status === 200) {
      if (!allowPassword) return { blocked: true }
      const loginChallenge = hidden(html, 'login_challenge')
      const csrf = hidden(html, 'csrf_token')
      const form = new URLSearchParams({
        login_challenge: loginChallenge,
        csrf_token: csrf,
        id: fixtureId,
        password: fixturePassword,
      })
      const submitted = await requestWithJar(sessionJar, new URL('/account/login', issuer), {
        method: 'POST',
        headers: browserEquivalentFormHeaders(response, current),
        body: form,
      })
      current = absoluteLocation(submitted, current)
      continue
    }
    if (url.pathname === '/account/consent' && response.status === 200) {
      const consentChallenge = hidden(html, 'consent_challenge')
      const csrf = hidden(html, 'csrf_token')
      const form = new URLSearchParams({
        consent_challenge: consentChallenge,
        csrf_token: csrf,
        offline_access_confirmed: 'yes',
        decision: 'approve',
      })
      const submitted = await requestWithJar(sessionJar, new URL('/account/consent', issuer), {
        method: 'POST',
        headers: browserEquivalentFormHeaders(response, current),
        body: form,
      })
      current = absoluteLocation(submitted, current)
      continue
    }
    if (!allowPassword && url.origin === issuer && response.status >= 400) {
      return { blocked: true }
    }
    throw new Error(`Unexpected authorization response ${response.status} at ${url.pathname}`)
  }
  throw new Error('Authorization redirect loop exceeded its limit')
}

const tokenRequest = async (form) => fetch(new URL('/oauth2/token', issuer), {
  method: 'POST',
  headers: {
    authorization: `Basic ${Buffer.from(`jieya-server-local:${clientSecret}`).toString('base64')}`,
    'content-type': 'application/x-www-form-urlencoded',
  },
  body: new URLSearchParams(form),
  redirect: 'manual',
})

const exchangeCode = async ({ code, verifier }) => tokenRequest({
  grant_type: 'authorization_code',
  code,
  code_verifier: verifier,
  redirect_uri: 'http://jieya.localhost:4180/auth/callback',
})

const decodeJwtPayload = (token) => {
  const parts = String(token || '').split('.')
  if (parts.length !== 3) throw new Error('Expected a compact ID Token')
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
}

const decodeJwtHeader = (token) => {
  const parts = String(token || '').split('.')
  if (parts.length !== 3) throw new Error('Expected a compact signed JWT')
  return JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
}

const localNoProxy = ['localhost', '127.0.0.1', '::1', '.localhost', 'auth.localhost', 'jieya.localhost']
  .join(',')

const hydraEnv = {
  ...process.env,
  NO_PROXY: [process.env.NO_PROXY, localNoProxy].filter(Boolean).join(','),
  no_proxy: [process.env.no_proxy, localNoProxy].filter(Boolean).join(','),
  DSN: hydraDsn,
  SECRETS_SYSTEM: systemSecret,
  SECRETS_COOKIE: cookieSecret,
  URLS_SELF_ISSUER: issuer,
  URLS_LOGIN: `${issuer}/account/login`,
  URLS_CONSENT: `${issuer}/account/consent`,
  URLS_LOGOUT: `${issuer}/account/error`,
  URLS_ERROR: `${issuer}/account/error`,
  WEBFINGER_OIDC_DISCOVERY_USERINFO_URL: `${issuer}/oauth2/userinfo`,
  STRATEGIES_ACCESS_TOKEN: 'opaque',
  OAUTH2_PKCE_ENFORCED: 'true',
  OAUTH2_SESSION_ENCRYPT_AT_REST: 'true',
  OAUTH2_TOKEN_HOOK_URL: 'http://127.0.0.1:5174/internal/oidc/token-hook',
  OAUTH2_TOKEN_HOOK_AUTH_TYPE: 'api_key',
  OAUTH2_TOKEN_HOOK_AUTH_CONFIG_IN: 'header',
  OAUTH2_TOKEN_HOOK_AUTH_CONFIG_NAME: 'X-StarStack-Hydra-Hook',
  OAUTH2_TOKEN_HOOK_AUTH_CONFIG_VALUE: tokenHookSecret,
  TTL_LOGIN_CONSENT_REQUEST: '10m',
  TTL_AUTH_CODE: '1m',
  TTL_ID_TOKEN: '5m',
  TTL_ACCESS_TOKEN: '10m',
  TTL_REFRESH_TOKEN: '720h',
  OAUTH2_GRANT_REFRESH_TOKEN_ROTATION_GRACE_PERIOD: '0s',
  OAUTH2_GRANT_REFRESH_TOKEN_ROTATION_GRACE_REUSE_COUNT: '0',
  OAUTH2_EXPOSE_INTERNAL_ERRORS: 'false',
  SERVE_PUBLIC_CORS_ENABLED: 'false',
  SERVE_ADMIN_CORS_ENABLED: 'false',
  SERVE_COOKIES_SAME_SITE_MODE: 'Lax',
  SERVE_COOKIES_NAMES_LOGIN_CSRF: HYDRA_BROWSER_COOKIE_NAMES.loginCsrf,
  SERVE_COOKIES_NAMES_CONSENT_CSRF: HYDRA_BROWSER_COOKIE_NAMES.consentCsrf,
  SERVE_COOKIES_NAMES_SESSION: HYDRA_BROWSER_COOKIE_NAMES.session,
  SERVE_COOKIES_NAMES_DEVICE_CSRF: HYDRA_BROWSER_COOKIE_NAMES.deviceCsrf,
  SERVE_COOKIES_PATHS_SESSION: HYDRA_BROWSER_COOKIE_PATH,
  LOG_LEVEL: 'warn',
  LOG_LEAK_SENSITIVE_VALUES: 'false',
}

const starStackEnv = {
  ...process.env,
  NODE_ENV: 'development',
  HOST: '127.0.0.1',
  PORT: '5174',
  DB_PATH: starStackDatabase,
  ADMIN_ID: fixtureId,
  ADMIN_NAME: 'OIDC Fixture',
  ADMIN_PASSWORD: fixturePassword,
  OIDC_ENABLED: 'true',
  OIDC_ISSUER: issuer,
  OIDC_HYDRA_PUBLIC_URL: 'http://127.0.0.1:4444',
  OIDC_HYDRA_ADMIN_URL: adminOrigin,
  OIDC_TOKEN_HOOK_SECRET: tokenHookSecret,
  OIDC_LOGOUT_BROKER_SECRET: logoutBrokerSecret,
  ALLOWED_ORIGINS: issuer,
}

const registerClient = async () => {
  const itemUrl = new URL('/admin/clients/jieya-server-local', adminOrigin)
  const lookup = await fetch(itemUrl, { signal: AbortSignal.timeout(5000) })
  if (!lookup.ok && lookup.status !== 404) {
    throw new Error(`Fixture client lookup failed with ${lookup.status}`)
  }
  const response = await fetch(lookup.status === 404 ? new URL('/admin/clients', adminOrigin) : itemUrl, {
    method: lookup.status === 404 ? 'POST' : 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: 'jieya-server-local',
      client_name: 'Jieya Server (protocol fixture)',
      client_secret: clientSecret,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      redirect_uris: ['http://jieya.localhost:4180/auth/callback'],
      post_logout_redirect_uris: ['http://jieya.localhost:4180/auth/logout/callback'],
      scope: 'openid profile offline_access',
      token_endpoint_auth_method: 'client_secret_basic',
      subject_type: 'public',
      backchannel_logout_uri: 'http://jieya.localhost:4180/auth/backchannel-logout',
      backchannel_logout_session_required: true,
      skip_consent: false,
      skip_logout_consent: false,
    }),
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) throw new Error(`Fixture client registration failed with ${response.status}`)
  const registeredResponse = await fetch(itemUrl, { signal: AbortSignal.timeout(5000) })
  if (!registeredResponse.ok) throw new Error('Fixture client could not be read after registration')
  const registered = await registeredResponse.json()
  const exactArray = (actual, expected) => Array.isArray(actual)
    && actual.length === expected.length
    && expected.every((value, index) => actual[index] === value)
  if (registered.client_id !== 'jieya-server-local'
    || !exactArray(registered.redirect_uris, ['http://jieya.localhost:4180/auth/callback'])
    || !exactArray(registered.grant_types, ['authorization_code', 'refresh_token'])
    || !exactArray(registered.response_types, ['code'])
    || registered.token_endpoint_auth_method !== 'client_secret_basic'
    || registered.scope !== 'openid profile offline_access') {
    throw new Error('Fixture client registration is not exact')
  }
}

const logoutTokens = []

try {
  await Promise.all([
    ...[4444, 4445, 5174, 4180].map((port) => assertPortFree(port)),
  ])
  const hydraVersion = await run(hydraBinary, ['version'])
  if (!/^Version:\s+v26\.2\.0\s*$/m.test(hydraVersion)) {
    throw new Error('Hydra protocol gate requires exactly v26.2.0')
  }
  console.log('1/6 迁移 Hydra PostgreSQL 测试数据库')
  await run(hydraBinary, ['migrate', 'sql', 'up', '-e', '--yes'], { env: hydraEnv })

  bffServer = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/auth/backchannel-logout') {
      res.writeHead(404).end()
      return
    }
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => { if (body.length < 128 * 1024) body += chunk })
    req.on('end', () => {
      const token = new URLSearchParams(body).get('logout_token')
      if (token) logoutTokens.push(token)
      res.writeHead(200).end()
    })
  })
  // *.localhost resolves to both ::1 and 127.0.0.1 on macOS. Listen on the
  // dual-stack wildcard so Hydra can deliver Back-Channel Logout over either.
  await new Promise((resolve, reject) => {
    bffServer.once('error', reject)
    bffServer.listen(4180, '::', () => {
      bffServer.off('error', reject)
      resolve()
    })
  })

  console.log('2/6 启动固定 Hydra v26.2.0 与临时 StarStack 身份服务')
  let hydra = spawnService('hydra', hydraBinary, ['serve', 'all', '--dev', '--sqa-opt-out'], hydraEnv)
  await waitForHttp('http://127.0.0.1:4445/health/ready')
  await registerClient()
  spawnService('starstack', process.execPath, ['server/index.js'], starStackEnv)
  await waitForHttp('http://127.0.0.1:5174/api/health', { expected: [200, 503], timeoutMs: 30000 })

  const discoveryResponse = await fetch(new URL('/.well-known/openid-configuration', issuer))
  if (discoveryResponse.status !== 200) throw new Error('OIDC Discovery is unavailable')
  const discovery = await discoveryResponse.json()
  const expectedDiscoveryEndpoints = {
    issuer,
    authorization_endpoint: `${issuer}/oauth2/auth`,
    token_endpoint: `${issuer}/oauth2/token`,
    userinfo_endpoint: `${issuer}/oauth2/userinfo`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    revocation_endpoint: `${issuer}/oauth2/revoke`,
  }
  if (issuer.endsWith('/')
    || Object.entries(expectedDiscoveryEndpoints).some(([key, value]) => discovery[key] !== value)
    || !discovery.code_challenge_methods_supported?.includes('S256')) {
    throw new Error('OIDC Discovery issuer, PKCE or UserInfo metadata mismatch')
  }
  const jwksResponse = await fetch(discovery.jwks_uri)
  const jwks = await jwksResponse.json()
  if (!jwks.keys?.some((key) => key.kty === 'RSA' && (!key.alg || key.alg === 'RS256'))) {
    throw new Error('Hydra JWKS does not expose an RSA signing key')
  }

  console.log('3/6 验证 Discovery/JWKS、授权码 + PKCE、Token Hook 与最小 UserInfo')
  const authorization = await authorize()
  const tokenResponse = await exchangeCode(authorization)
  if (tokenResponse.status !== 200) throw new Error(`Authorization code exchange failed with ${tokenResponse.status}`)
  const tokens = await tokenResponse.json()
  if (!tokens.access_token || !tokens.refresh_token || !tokens.id_token) throw new Error('Token response is incomplete')
  const idClaims = decodeJwtPayload(tokens.id_token)
  const idHeader = decodeJwtHeader(tokens.id_token)
  const audiences = Array.isArray(idClaims.aud) ? idClaims.aud : [idClaims.aud]
  if (idHeader.alg !== 'RS256' || typeof idHeader.kid !== 'string' || !idHeader.kid
    || !idClaims.sid || idClaims.nonce !== authorization.nonce
    || !audiences.includes('jieya-server-local') || idClaims.iss !== issuer
    || !Number.isInteger(idClaims.iat) || !Number.isInteger(idClaims.exp)
    || idClaims.exp - idClaims.iat > 5 * 60
    || 'auth_generation' in idClaims || 'grant_issued_at' in idClaims
    || String(tokens.access_token).split('.').length === 3) {
    throw new Error('ID/Access Token signing, claims, TTL or strategy mismatch')
  }
  const userInfo = await fetch(new URL('/oauth2/userinfo', issuer), {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  })
  if (userInfo.status !== 200) throw new Error(`UserInfo failed with ${userInfo.status}`)
  const profile = await userInfo.json()
  if (!profile.sub || profile.name !== 'OIDC Fixture'
    || 'email' in profile || 'auth_generation' in profile || 'is_admin' in profile) {
    throw new Error('UserInfo claims are not minimal')
  }

  console.log('4/6 验证 code/Refresh 一次性消费与重放失败')
  const replayCode = await exchangeCode(authorization)
  if (replayCode.status < 400) throw new Error('Authorization code replay unexpectedly succeeded')
  const refreshAuthorization = await authorize()
  const refreshTokenResponse = await exchangeCode(refreshAuthorization)
  if (refreshTokenResponse.status !== 200) throw new Error('Refresh fixture authorization failed')
  const refreshTokens = await refreshTokenResponse.json()
  const refreshedResponse = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: refreshTokens.refresh_token,
  })
  if (refreshedResponse.status !== 200) throw new Error(`Refresh failed with ${refreshedResponse.status}`)
  const refreshed = await refreshedResponse.json()
  if (!refreshed.access_token || !refreshed.refresh_token) throw new Error('Rotated token response is incomplete')
  const refreshReplay = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: refreshTokens.refresh_token,
  })
  if (refreshReplay.status < 400) throw new Error('Refresh Token replay unexpectedly succeeded')
  const refreshFamilyAfterReplay = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: refreshed.refresh_token,
  })
  if (refreshFamilyAfterReplay.status < 400) {
    throw new Error('Refresh Token replay did not invalidate the rotated token family')
  }

  console.log('5/6 验证自定义全局退出、旧授权竞态与 Back-Channel Logout')
  const logoutAuthorization = await authorize()
  const logoutTokenResponse = await exchangeCode(logoutAuthorization)
  if (logoutTokenResponse.status !== 200) throw new Error('Logout fixture authorization failed')
  const logoutSessionTokens = await logoutTokenResponse.json()
  const logoutIdClaims = decodeJwtPayload(logoutSessionTokens.id_token)
  const staleAuthorization = await authorize()
  const dbBeforeLogout = await open({
    filename: starStackDatabase,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READONLY,
  })
  const beforeLogout = await dbBeforeLogout.get(
    `SELECT auth_generation FROM users WHERE account_subject = ?`,
    profile.sub,
  )
  await dbBeforeLogout.close()
  const broker = await fetch(new URL('/internal/oidc/logout-transactions', issuer), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-StarStack-Logout-Broker': logoutBrokerSecret,
    },
    body: JSON.stringify({
      subject: profile.sub,
      sid: logoutIdClaims.sid,
      client_id: 'jieya-server-local',
      state: randomUrlValue(),
    }),
  })
  if (broker.status !== 201) throw new Error(`Logout Broker rejected fixture with ${broker.status}`)
  const brokerBody = await broker.json()
  if (JSON.stringify(Object.keys(brokerBody).sort()) !== JSON.stringify(['expires_at', 'url'])
    || typeof brokerBody.url !== 'string'
    || !Number.isFinite(Date.parse(brokerBody.expires_at))) {
    throw new Error('Logout Broker response is not exact {url, expires_at}')
  }
  const logoutUrl = brokerBody.url
  const logoutPage = await request(logoutUrl)
  if (logoutPage.status !== 200) throw new Error(`Logout confirmation failed with ${logoutPage.status}`)
  const logoutHtml = await logoutPage.text()
  const logoutCsrf = hidden(logoutHtml, 'csrf_token')
  const transaction = hidden(logoutHtml, 'transaction')
  const concurrentAuthorizations = Array.from({ length: 4 }, () => authorize({
    sessionJar: jar.clone(),
    allowPassword: false,
  }))
  const [confirmed, ...raceResults] = await Promise.all([
    request(new URL('/account/logout', issuer), {
      method: 'POST',
      headers: browserEquivalentFormHeaders(logoutPage, logoutUrl),
      body: new URLSearchParams({ transaction, csrf_token: logoutCsrf }),
    }),
    ...concurrentAuthorizations,
  ])
  if (confirmed.status !== 303) throw new Error(`Global logout failed with ${confirmed.status}`)
  for (const raced of raceResults) {
    if (raced.blocked) continue
    const racedExchange = await exchangeCode(raced)
    if (racedExchange.status < 400) {
      throw new Error('#4070 concurrent authorization produced a post-logout token')
    }
  }
  const staleExchange = await exchangeCode(staleAuthorization)
  if (staleExchange.status < 400) throw new Error('Pre-logout authorization code survived auth_generation advance')
  const oldUserInfo = await fetch(new URL('/oauth2/userinfo', issuer), {
    headers: { authorization: `Bearer ${logoutSessionTokens.access_token}` },
  })
  if (oldUserInfo.status < 400) throw new Error('Pre-logout Access Token survived global logout')
  const oldRefresh = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: logoutSessionTokens.refresh_token,
  })
  if (oldRefresh.status < 400) throw new Error('Pre-logout Refresh Token survived global logout')
  const bclDeadline = Date.now() + 5000
  while (logoutTokens.length === 0 && Date.now() < bclDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (logoutTokens.length === 0) throw new Error('Hydra did not deliver Back-Channel Logout')
  const logoutHeader = decodeJwtHeader(logoutTokens[0])
  const logoutClaims = decodeJwtPayload(logoutTokens[0])
  if (logoutHeader.alg !== 'RS256' || logoutHeader.typ !== 'JWT'
    || typeof logoutHeader.kid !== 'string' || !logoutHeader.kid
    || !logoutClaims.iat || !logoutClaims.jti || (!logoutClaims.sid && !logoutClaims.sub)
    || logoutClaims.nonce || !logoutClaims.events) {
    throw new Error('Back-Channel Logout Token header or claims are invalid')
  }

  console.log('6/6 重启 Hydra 后确认重放仍失败并检查持久状态')
  hydra.kill('SIGTERM')
  await waitForExit(hydra)
  hydra = spawnService('hydra-restarted', hydraBinary, ['serve', 'all', '--dev', '--sqa-opt-out'], hydraEnv)
  await waitForHttp('http://127.0.0.1:4445/health/ready')
  const restartedJwks = await (await fetch(new URL('/.well-known/jwks.json', issuer))).json()
  const signingKids = jwks.keys.map((key) => key.kid).filter(Boolean).sort()
  const restartedKids = restartedJwks.keys?.map((key) => key.kid).filter(Boolean).sort()
  if (JSON.stringify(restartedKids) !== JSON.stringify(signingKids)) {
    throw new Error('Hydra signing keys changed across a database-backed restart')
  }
  const afterRestartCodeReplay = await exchangeCode(authorization)
  if (afterRestartCodeReplay.status < 400) throw new Error('Consumed code replay succeeded after Hydra restart')
  const afterRestartRefreshReplay = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: refreshed.refresh_token,
  })
  if (afterRestartRefreshReplay.status < 400) {
    throw new Error('Revoked Refresh token family recovered after Hydra restart')
  }

  const db = await open({ filename: starStackDatabase, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY })
  try {
    const account = await db.get(
      `SELECT auth_generation FROM users WHERE account_subject = ?`,
      profile.sub,
    )
    const outbox = await db.get(
      `SELECT COUNT(*) AS count FROM identity_outbox WHERE subject = ? AND status = 'completed'`,
      profile.sub,
    )
    if (account?.auth_generation !== beforeLogout?.auth_generation + 1 || outbox?.count < 2) {
      throw new Error('Global logout generation/outbox state was not durable')
    }
  } finally {
    await db.close()
  }
  if (!accountCookieShieldExercised || !hydraCookiePolicyObserved) {
    throw new Error('Real authorization flow did not exercise Hydra/account cookie isolation')
  }
  for (const requiredCookie of expectedLiveHydraCookieNames.slice(0, 3)) {
    if (!observedHydraCookieNames.has(requiredCookie)) {
      throw new Error(`Real Hydra flow did not emit audited cookie ${requiredCookie}`)
    }
  }

  succeeded = true
  console.log(JSON.stringify({
    ok: true,
    hydra: 'v26.2.0 PostgreSQL development evidence',
    discoveryAndJwks: true,
    authorizationCodePkce: true,
    tokenHookAndUserInfo: true,
    codeAndRefreshReplay: true,
    globalLogoutGeneration: true,
    concurrentLogoutRaceFailClosed: true,
    backChannelLogoutDelivered: true,
    backChannelLogoutTypJwt: true,
    exactLogoutBrokerContract: true,
    sameOriginFormPolicy: true,
    exactJieyaFormActionPolicy: true,
    hydraCookieIsolation: true,
    restartReplayRejected: true,
    postgres16Runtime: true,
  }, null, 2))
} finally {
  for (const child of processes.reverse()) {
    if (child.exitCode === null) child.kill('SIGTERM')
  }
  await Promise.all(processes.map((child) => child.exitCode === null ? waitForExit(child) : undefined))
  if (bffServer) await new Promise((resolve) => bffServer.close(resolve))
  if (succeeded) await rm(workDir, { recursive: true, force: true })
  else console.error(`Protocol test artifacts retained at ${workDir}`)
}
