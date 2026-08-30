const REQUIRED_SINGLE_PARAMETERS = Object.freeze([
  'client_id',
  'redirect_uri',
  'response_type',
  'scope',
  'state',
  'nonce',
  'code_challenge',
  'code_challenge_method',
])
const PKCE_S256_PATTERN = /^[A-Za-z0-9_-]{43,128}$/

export class AuthorizationPolicyError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AuthorizationPolicyError'
    this.code = code
  }
}

const getSingle = (params, name) => {
  const values = params.getAll(name)
  if (values.length !== 1 || !values[0]) {
    const label = name.startsWith('code_challenge') ? `PKCE ${name}` : name
    throw new AuthorizationPolicyError('INVALID_PARAMETER', `${label} must be present exactly once`)
  }
  return values[0]
}

export const validateJieyaAuthorizationRequest = (loginRequest, client) => {
  if (!loginRequest || typeof loginRequest.request_url !== 'string' || !loginRequest.client) {
    throw new AuthorizationPolicyError('MALFORMED_REQUEST', 'Hydra login request is malformed')
  }
  if (!client || loginRequest.client.client_id !== client.id) {
    throw new AuthorizationPolicyError('INVALID_CLIENT', 'client is not registered')
  }

  let requestUrl
  try {
    requestUrl = new URL(loginRequest.request_url)
  } catch {
    throw new AuthorizationPolicyError('MALFORMED_REQUEST', 'Hydra request_url is malformed')
  }
  const params = requestUrl.searchParams
  const values = Object.fromEntries(
    REQUIRED_SINGLE_PARAMETERS.map((name) => [name, getSingle(params, name)]),
  )

  if (values.client_id !== client.id) {
    throw new AuthorizationPolicyError('INVALID_CLIENT', 'client_id does not match the registered client')
  }
  if (values.redirect_uri !== client.redirectUri) {
    throw new AuthorizationPolicyError('INVALID_REDIRECT', 'redirect_uri does not match the registered redirect')
  }
  if (values.response_type !== 'code') {
    throw new AuthorizationPolicyError('INVALID_RESPONSE_TYPE', 'response_type must be code')
  }
  if (values.code_challenge_method !== 'S256' || !PKCE_S256_PATTERN.test(values.code_challenge)) {
    throw new AuthorizationPolicyError('INVALID_PKCE', 'PKCE must use a valid S256 code challenge')
  }
  if (values.state.length < 16 || values.state.length > 512) {
    throw new AuthorizationPolicyError('INVALID_STATE', 'state must contain sufficient entropy')
  }
  if (values.nonce.length < 16 || values.nonce.length > 512) {
    throw new AuthorizationPolicyError('INVALID_NONCE', 'nonce must contain sufficient entropy')
  }

  const requestedScopes = values.scope.split(/\s+/).filter(Boolean)
  const uniqueScopes = new Set(requestedScopes)
  if (uniqueScopes.size !== requestedScopes.length
    || !uniqueScopes.has('openid')
    || requestedScopes.some((scope) => !client.allowedScopes.includes(scope))) {
    throw new AuthorizationPolicyError('INVALID_SCOPE', 'scope contains an unregistered value')
  }

  return {
    clientId: client.id,
    redirectUri: client.redirectUri,
    requestedScopes,
    offlineAccessRequested: uniqueScopes.has('offline_access'),
  }
}
