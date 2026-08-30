const CHALLENGE_PATTERN = /^[A-Za-z0-9._~+/=-]{1,2048}$/
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._~:/+=-]{1,2048}$/
const DEFAULT_TIMEOUT_MS = 3000

export class HydraAdminError extends Error {
  constructor(code, message, { status = 502, cause } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = 'HydraAdminError'
    this.code = code
    this.status = status
  }

  toJSON() {
    return { name: this.name, code: this.code, status: this.status }
  }
}

const isPrivateHostname = (hostname) => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (normalized === 'localhost' || normalized === '::1' || normalized.startsWith('127.')) return true
  if (normalized.startsWith('10.') || normalized.startsWith('192.168.')) return true
  const match = normalized.match(/^172\.(\d{1,3})\./)
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(normalized) && !normalized.includes('.')
}

const parseAdminBase = (value) => {
  let url
  try { url = new URL(value) } catch { throw new HydraAdminError('INVALID_ADMIN_URL', 'Hydra Admin URL is invalid') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash || !isPrivateHostname(url.hostname)) {
    throw new HydraAdminError('INVALID_ADMIN_URL', 'Hydra Admin URL must use a private or loopback origin')
  }
  return url.origin
}

const parseIssuer = (value) => {
  let url
  try { url = new URL(value) } catch { throw new HydraAdminError('INVALID_ISSUER', 'OIDC issuer is invalid') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) {
    throw new HydraAdminError('INVALID_ISSUER', 'OIDC issuer must be an origin')
  }
  return url.origin
}

const assertIdentifier = (value, label, pattern = IDENTIFIER_PATTERN) => {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new HydraAdminError('INVALID_IDENTIFIER', `${label} is malformed`, { status: 400 })
  }
  return value
}

export const createHydraAdminClient = ({
  baseUrl,
  issuer,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) => {
  const adminOrigin = parseAdminBase(baseUrl)
  const issuerOrigin = parseIssuer(issuer)
  if (typeof fetchImpl !== 'function') throw new HydraAdminError('FETCH_UNAVAILABLE', 'fetch is unavailable')

  const request = async (pathname, {
    method = 'GET',
    query,
    json,
    form,
    expectedStatuses = [200],
  } = {}) => {
    const url = new URL(pathname, adminOrigin)
    for (const [name, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null) url.searchParams.set(name, String(value))
    }
    const headers = { accept: 'application/json' }
    let body
    if (json !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(json)
    } else if (form !== undefined) {
      headers['content-type'] = 'application/x-www-form-urlencoded'
      body = new URLSearchParams(form)
    }

    let response
    try {
      response = await fetchImpl(url.toString(), {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (cause) {
      throw new HydraAdminError('ADMIN_UNAVAILABLE', 'Hydra Admin request failed', { cause })
    }
    if (!expectedStatuses.includes(response.status)) {
      throw new HydraAdminError('ADMIN_REJECTED', `Hydra Admin rejected the request (${response.status})`, {
        status: response.status,
      })
    }
    if (response.status === 204) return null
    try { return await response.json() } catch (cause) {
      throw new HydraAdminError('INVALID_RESPONSE', 'Hydra Admin returned malformed JSON', { cause })
    }
  }

  const assertRedirect = (result) => {
    let redirect
    try { redirect = new URL(result?.redirect_to) } catch {
      throw new HydraAdminError('INVALID_REDIRECT', 'Hydra Admin returned an invalid redirect')
    }
    if (redirect.origin !== issuerOrigin || !redirect.pathname.startsWith('/oauth2/')) {
      throw new HydraAdminError('INVALID_REDIRECT', 'Hydra Admin returned an untrusted redirect')
    }
    return { ...result, redirect_to: redirect.toString() }
  }

  return Object.freeze({
    getLoginRequest: (challenge) => request('/admin/oauth2/auth/requests/login', {
      query: { login_challenge: assertIdentifier(challenge, 'login challenge', CHALLENGE_PATTERN) },
    }),
    acceptLoginRequest: async (challenge, payload) => assertRedirect(await request(
      '/admin/oauth2/auth/requests/login/accept',
      {
        method: 'PUT',
        query: { login_challenge: assertIdentifier(challenge, 'login challenge', CHALLENGE_PATTERN) },
        json: payload,
      },
    )),
    rejectLoginRequest: async (challenge, payload) => assertRedirect(await request(
      '/admin/oauth2/auth/requests/login/reject',
      {
        method: 'PUT',
        query: { login_challenge: assertIdentifier(challenge, 'login challenge', CHALLENGE_PATTERN) },
        json: payload,
      },
    )),
    getConsentRequest: (challenge) => request('/admin/oauth2/auth/requests/consent', {
      query: { consent_challenge: assertIdentifier(challenge, 'consent challenge', CHALLENGE_PATTERN) },
    }),
    acceptConsentRequest: async (challenge, payload) => assertRedirect(await request(
      '/admin/oauth2/auth/requests/consent/accept',
      {
        method: 'PUT',
        query: { consent_challenge: assertIdentifier(challenge, 'consent challenge', CHALLENGE_PATTERN) },
        json: payload,
      },
    )),
    rejectConsentRequest: async (challenge, payload) => assertRedirect(await request(
      '/admin/oauth2/auth/requests/consent/reject',
      {
        method: 'PUT',
        query: { consent_challenge: assertIdentifier(challenge, 'consent challenge', CHALLENGE_PATTERN) },
        json: payload,
      },
    )),
    introspectToken: (token) => request('/admin/oauth2/introspect', {
      method: 'POST',
      form: { token: assertIdentifier(token, 'access token') },
    }),
    revokeLoginSession: (sid) => request('/admin/oauth2/auth/sessions/login', {
      method: 'DELETE',
      query: { sid: assertIdentifier(sid, 'login session id') },
      expectedStatuses: [204],
    }),
    revokeConsentSessions: (subject, clientId) => request('/admin/oauth2/auth/sessions/consent', {
      method: 'DELETE',
      query: {
        subject: assertIdentifier(subject, 'subject'),
        client: assertIdentifier(clientId, 'client id'),
      },
      expectedStatuses: [204],
    }),
    upsertClient: async (clientId, payload) => {
      const id = assertIdentifier(clientId, 'client id')
      const pathname = `/admin/clients/${encodeURIComponent(id)}`
      try {
        await request(pathname)
      } catch (error) {
        if (!(error instanceof HydraAdminError) || error.status !== 404) throw error
        return request('/admin/clients', {
          method: 'POST',
          json: { ...payload, client_id: id },
          expectedStatuses: [201],
        })
      }
      return request(pathname, { method: 'PUT', json: { ...payload, client_id: id } })
    },
  })
}
