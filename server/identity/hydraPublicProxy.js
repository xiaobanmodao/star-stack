import { Router } from 'express'

const GET_PATHS = Object.freeze([
  '/.well-known/openid-configuration',
  '/.well-known/jwks.json',
  '/oauth2/auth',
  '/oauth2/sessions/logout',
])
const POST_PATHS = Object.freeze([
  '/oauth2/token',
  '/oauth2/revoke',
  '/oauth2/sessions/logout',
])
const REQUEST_HEADER_ALLOWLIST = Object.freeze([
  'accept',
  'authorization',
  'content-type',
  'user-agent',
])
const RESPONSE_HEADER_ALLOWLIST = Object.freeze([
  'cache-control',
  'content-type',
  'expires',
  'pragma',
  'www-authenticate',
])
const DEFAULT_REQUEST_LIMIT = 64 * 1024
const DEFAULT_RESPONSE_LIMIT = 5 * 1024 * 1024

class HydraProxyError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'HydraProxyError'
    this.status = status
  }
}

const readBoundedBody = async (req, maxBytes) => {
  const declared = Number.parseInt(req.get('content-length') || '', 10)
  if (Number.isFinite(declared) && declared > maxBytes) {
    req.resume()
    throw new HydraProxyError(413, 'request body too large')
  }
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) {
      req.resume()
      throw new HydraProxyError(413, 'request body too large')
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

const assertHydraCookieConfig = (config) => {
  const names = config?.hydraCookies?.names
  const cookiePath = config?.hydraCookies?.path
  if (!Array.isArray(names) || names.length === 0 || new Set(names).size !== names.length
    || names.some((name) => typeof name !== 'string'
      || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)
      || name === config.accountCookieName)
    || typeof cookiePath !== 'string' || !cookiePath.startsWith('/')) {
    throw new Error('Hydra browser cookie isolation is not configured safely')
  }
  return {
    names: Object.freeze([...names]),
    allowedNames: new Set(names),
    path: cookiePath,
  }
}

const filterRequestCookies = (rawCookie, cookieConfig) => {
  if (!rawCookie) return null
  const selected = new Map()
  for (const rawPart of String(rawCookie).split(';')) {
    const part = rawPart.trim()
    const separator = part.indexOf('=')
    if (separator <= 0) continue
    const name = part.slice(0, separator).trim()
    if (!cookieConfig.allowedNames.has(name)) continue
    if (selected.has(name)) throw new HydraProxyError(400, 'duplicate Hydra browser cookie')
    const value = part.slice(separator + 1).trim()
    if (value.length > 4096 || /[\u0000-\u0020\u007f;,]/.test(value)) {
      throw new HydraProxyError(400, 'invalid Hydra browser cookie')
    }
    selected.set(name, value)
  }
  const filtered = cookieConfig.names
    .filter((name) => selected.has(name))
    .map((name) => `${name}=${selected.get(name)}`)
  return filtered.length > 0 ? filtered.join('; ') : null
}

const copyRequestHeaders = (req, cookieConfig) => {
  const headers = {}
  for (const name of REQUEST_HEADER_ALLOWLIST) {
    const value = req.get(name)
    if (value) headers[name] = value
  }
  const cookie = filterRequestCookies(req.get('cookie'), cookieConfig)
  if (cookie) headers.cookie = cookie
  return headers
}

const sanitizeHydraSetCookie = (rawCookie, cookieConfig, production) => {
  if (typeof rawCookie !== 'string' || /[\r\n]/.test(rawCookie)) return null
  const [pair, ...rawAttributes] = rawCookie.split(';')
  const separator = pair.indexOf('=')
  if (separator <= 0) return null
  const name = pair.slice(0, separator).trim()
  if (!cookieConfig.allowedNames.has(name)) return null
  const value = pair.slice(separator + 1).trim()
  if (value.length > 4096 || /[\u0000-\u0020\u007f;,]/.test(value)) return null

  let maxAge = null
  let expires = null
  for (const rawAttribute of rawAttributes) {
    const attribute = rawAttribute.trim()
    const attributeSeparator = attribute.indexOf('=')
    const attributeName = (attributeSeparator < 0 ? attribute : attribute.slice(0, attributeSeparator))
      .trim().toLowerCase()
    const attributeValue = attributeSeparator < 0 ? '' : attribute.slice(attributeSeparator + 1).trim()
    if (attributeName === 'max-age' && /^-?\d+$/.test(attributeValue)) {
      maxAge = String(Number.parseInt(attributeValue, 10))
    } else if (attributeName === 'expires') {
      const parsed = new Date(attributeValue)
      if (Number.isFinite(parsed.getTime())) expires = parsed.toUTCString()
    }
  }

  return [
    `${name}=${value}`,
    `Path=${cookieConfig.path}`,
    'HttpOnly',
    ...(production ? ['Secure'] : []),
    'SameSite=Lax',
    ...(maxAge === null ? [] : [`Max-Age=${maxAge}`]),
    ...(expires === null ? [] : [`Expires=${expires}`]),
  ].join('; ')
}

const filterResponseCookies = (headers, cookieConfig, production) => {
  const rawCookies = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : (headers.get('set-cookie') ? [headers.get('set-cookie')] : [])
  const accepted = []
  const seen = new Set()
  for (const rawCookie of rawCookies) {
    const sanitized = sanitizeHydraSetCookie(rawCookie, cookieConfig, production)
    if (!sanitized) continue
    const name = sanitized.slice(0, sanitized.indexOf('='))
    if (seen.has(name)) throw new HydraProxyError(502, 'Hydra returned duplicate browser cookies')
    seen.add(name)
    accepted.push(sanitized)
  }
  return accepted
}

const readBoundedResponseBody = async (response, maxBytes) => {
  if (!response.body) return Buffer.alloc(0)
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > maxBytes) {
      if (typeof response.body.cancel === 'function') {
        await response.body.cancel().catch(() => undefined)
      }
      throw new HydraProxyError(502, 'Hydra response exceeded its size limit')
    }
    chunks.push(bytes)
  }
  return Buffer.concat(chunks, size)
}

const isAllowedRedirect = (value, config) => {
  let target
  try { target = new URL(value) } catch { return false }
  const issuer = new URL(config.issuer)
  if (target.origin === issuer.origin) {
    return [
      '/account/login',
      '/account/consent',
      '/account/error',
      '/account/logout',
      '/oauth2/auth',
      '/oauth2/sessions/logout',
    ].includes(target.pathname)
  }
  const callback = new URL(config.client.redirectUri)
  return target.origin === callback.origin && target.pathname === callback.pathname
}

export const createHydraPublicProxy = ({
  config,
  fetchImpl = globalThis.fetch,
  maxRequestBodyBytes = DEFAULT_REQUEST_LIMIT,
  maxResponseBodyBytes = DEFAULT_RESPONSE_LIMIT,
}) => {
  const router = Router()
  const upstreamOrigin = new URL(config.hydraPublicUrl).origin
  const cookieConfig = assertHydraCookieConfig(config)

  const proxy = async (req, res) => {
    try {
      const target = new URL(req.path, upstreamOrigin)
      const queryIndex = req.originalUrl.indexOf('?')
      if (queryIndex >= 0) target.search = req.originalUrl.slice(queryIndex)
      const body = req.method === 'GET' || req.method === 'HEAD'
        ? undefined
        : await readBoundedBody(req, maxRequestBodyBytes)
      const issuer = new URL(config.issuer)
      const upstreamHeaders = copyRequestHeaders(req, cookieConfig)
      upstreamHeaders['x-forwarded-proto'] = issuer.protocol.slice(0, -1)
      upstreamHeaders['x-forwarded-host'] = issuer.host
      let upstream
      try {
        upstream = await fetchImpl(target.toString(), {
          method: req.method,
          headers: upstreamHeaders,
          body,
          redirect: 'manual',
          signal: AbortSignal.timeout(10000),
        })
      } catch {
        throw new HydraProxyError(502, 'Hydra public endpoint unavailable')
      }

      const location = upstream.headers.get('location')
      if (location && !isAllowedRedirect(location, config)) {
        throw new HydraProxyError(502, 'Hydra returned an untrusted redirect')
      }
      const declaredResponseSize = Number.parseInt(upstream.headers.get('content-length') || '', 10)
      if (Number.isFinite(declaredResponseSize) && declaredResponseSize > maxResponseBodyBytes) {
        throw new HydraProxyError(502, 'Hydra response exceeded its size limit')
      }
      const responseBody = await readBoundedResponseBody(upstream, maxResponseBodyBytes)

      for (const name of RESPONSE_HEADER_ALLOWLIST) {
        const value = upstream.headers.get(name)
        if (value) res.setHeader(name, value)
      }
      if (location) res.setHeader('Location', location)
      const setCookies = filterResponseCookies(upstream.headers, cookieConfig, config.production)
      if (setCookies.length > 0) res.setHeader('Set-Cookie', setCookies)
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.status(upstream.status)
      return responseBody.length > 0 ? res.send(responseBody) : res.end()
    } catch (error) {
      const status = error instanceof HydraProxyError ? error.status : 502
      res.setHeader('Cache-Control', 'no-store')
      const responseError = status === 413
        ? 'request_too_large'
        : (status === 400 ? 'invalid_request' : 'upstream_unavailable')
      return res.status(status).json({ error: responseError })
    }
  }

  for (const path of GET_PATHS) router.get(path, proxy)
  for (const path of POST_PATHS) router.post(path, proxy)
  return router
}
