import { isIP } from 'node:net'

const SECRET_MIN_LENGTH = 32

export const HYDRA_BROWSER_COOKIE_NAMES = Object.freeze({
  loginCsrf: 'starstack_hydra_login_csrf',
  consentCsrf: 'starstack_hydra_consent_csrf',
  session: 'starstack_hydra_session',
  deviceCsrf: 'starstack_hydra_device_csrf',
})
export const HYDRA_BROWSER_COOKIE_PATH = '/oauth2'
export const JIEYA_BROWSER_ORIGINS = Object.freeze({
  local: 'http://jieya.localhost:4180',
  production: 'https://jieya.xingzhan.cc',
})
export const IDENTITY_ISSUERS = Object.freeze({
  local: 'http://auth.localhost:5174',
  production: 'https://auth.xingzhan.cc',
})

// Hydra v26.2.0 appends `_dev` in development and a deterministic Murmur3
// suffix for client-specific CSRF cookies. These values are frozen for the two
// registered Jieya client IDs so the proxy can use exact names, not a prefix.
const HYDRA_CLIENT_COOKIE_SUFFIX = Object.freeze({
  'jieya-server-local': '464740523',
  'jieya-server': '681216528',
})

const parseOriginOnly = (value, name) => {
  let url
  try { url = new URL(value) } catch { throw new Error(`${name} must be a valid URL`) }
  if (!['http:', 'https:'].includes(url.protocol)
    || url.username || url.password || url.search || url.hash
    || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error(`${name} must be an origin without credentials, path, query or fragment`)
  }
  return url.origin
}
const isPrivateIpv4 = (hostname) => {
  const octets = hostname.split('.').map((part) => Number(part))
  return octets[0] === 127
    || octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
}

const isPrivateHostname = (hostname) => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const addressFamily = isIP(normalized)
  if (addressFamily === 4) return isPrivateIpv4(normalized)
  if (addressFamily === 6) return normalized === '::1'
  if (normalized === 'localhost') return true
  // Deployment-network DNS is intentionally limited to a single RFC-style
  // service label. Dotted lookalike names such as 10.attacker.example are not
  // IP literals and must never inherit private-address trust.
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(normalized)
    && /[a-z]/.test(normalized)
    && !normalized.includes('.')
}

const parsePrivateOrigin = (value, name) => {
  const origin = parseOriginOnly(value, name)
  const url = new URL(origin)
  if (!isPrivateHostname(url.hostname)) {
    throw new Error(`${name} must use a loopback or private-network host`)
  }
  return origin
}

const requireSecret = (value, name) => {
  if (typeof value !== 'string' || value.length < SECRET_MIN_LENGTH) {
    throw new Error(`${name} secret must contain at least ${SECRET_MIN_LENGTH} characters`)
  }
  return value
}

export const loadIdentityConfig = (env = process.env) => {
  const enabled = String(env.OIDC_ENABLED || '').toLowerCase() === 'true'
  const production = env.NODE_ENV === 'production'
  const expectedIssuer = production ? IDENTITY_ISSUERS.production : IDENTITY_ISSUERS.local
  const rawIssuer = env.OIDC_ISSUER || expectedIssuer
  const issuer = parseOriginOnly(rawIssuer, 'OIDC issuer')
  if (enabled && rawIssuer !== expectedIssuer) {
    throw new Error(`OIDC issuer must exactly match ${expectedIssuer} in this environment`)
  }
  const hydraPublicUrl = parsePrivateOrigin(
    env.OIDC_HYDRA_PUBLIC_URL || 'http://127.0.0.1:4444',
    'Hydra Public URL',
  )
  const hydraAdminUrl = parsePrivateOrigin(
    env.OIDC_HYDRA_ADMIN_URL || 'http://127.0.0.1:4445',
    'Hydra Admin URL',
  )

  let tokenHookSecret = null
  let logoutBrokerSecret = null
  if (enabled) {
    tokenHookSecret = requireSecret(env.OIDC_TOKEN_HOOK_SECRET, 'Token hook')
    logoutBrokerSecret = requireSecret(env.OIDC_LOGOUT_BROKER_SECRET, 'Logout broker')
    if (tokenHookSecret === logoutBrokerSecret) {
      throw new Error('Token hook and Logout broker secrets must be separate/分离')
    }
  }

  const jieyaOrigin = production
    ? JIEYA_BROWSER_ORIGINS.production
    : JIEYA_BROWSER_ORIGINS.local
  const client = production
    ? {
        id: 'jieya-server',
        redirectUri: `${jieyaOrigin}/auth/callback`,
        logoutCallbackUri: `${jieyaOrigin}/auth/logout/callback`,
        backchannelLogoutUri: `${jieyaOrigin}/auth/backchannel-logout`,
      }
    : {
        id: 'jieya-server-local',
        redirectUri: `${jieyaOrigin}/auth/callback`,
        logoutCallbackUri: `${jieyaOrigin}/auth/logout/callback`,
        backchannelLogoutUri: `${jieyaOrigin}/auth/backchannel-logout`,
      }

  const environmentSuffix = production ? '' : '_dev'
  const clientCookieSuffix = HYDRA_CLIENT_COOKIE_SUFFIX[client.id]
  const hydraBrowserCookieAllowlist = Object.freeze([
    `${HYDRA_BROWSER_COOKIE_NAMES.loginCsrf}${environmentSuffix}_${clientCookieSuffix}`,
    `${HYDRA_BROWSER_COOKIE_NAMES.consentCsrf}${environmentSuffix}_${clientCookieSuffix}`,
    `${HYDRA_BROWSER_COOKIE_NAMES.session}${environmentSuffix}`,
    `${HYDRA_BROWSER_COOKIE_NAMES.deviceCsrf}${environmentSuffix}`,
  ])

  return Object.freeze({
    enabled,
    production,
    issuer,
    hydraPublicUrl,
    hydraAdminUrl,
    tokenHookSecret,
    logoutBrokerSecret,
    tokenHookHeader: 'x-starstack-hydra-hook',
    logoutBrokerHeader: 'X-StarStack-Logout-Broker',
    accountCookieName: production ? '__Host-starstack_auth' : 'starstack_auth_dev',
    hydraCookies: Object.freeze({
      names: hydraBrowserCookieAllowlist,
      path: HYDRA_BROWSER_COOKIE_PATH,
    }),
    client: Object.freeze({
      ...client,
      tokenEndpointAuthMethod: 'client_secret_basic',
      allowedGrantTypes: Object.freeze(['authorization_code', 'refresh_token']),
      allowedResponseTypes: Object.freeze(['code']),
      allowedScopes: Object.freeze(['openid', 'profile', 'offline_access']),
    }),
  })
}
