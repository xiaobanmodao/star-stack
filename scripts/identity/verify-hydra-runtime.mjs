#!/usr/bin/env node

const issuer = process.env.OIDC_ISSUER || 'http://auth.localhost:5174'
const adminOrigin = process.env.OIDC_HYDRA_ADMIN_URL || 'http://127.0.0.1:4445'
const production = process.env.NODE_ENV === 'production'
const expected = production
  ? {
      id: 'jieya-server',
      redirect: 'https://jieya.xingzhan.cc/auth/callback',
      logoutCallback: 'https://jieya.xingzhan.cc/auth/logout/callback',
      backchannel: 'https://jieya.xingzhan.cc/auth/backchannel-logout',
    }
  : {
      id: 'jieya-server-local',
      redirect: 'http://jieya.localhost:4180/auth/callback',
      logoutCallback: 'http://jieya.localhost:4180/auth/logout/callback',
      backchannel: 'http://jieya.localhost:4180/auth/backchannel-logout',
    }

const fetchJson = async (url) => {
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
  return response.json()
}

const discovery = await fetchJson(new URL('/.well-known/openid-configuration', issuer))
const expectedEndpoints = {
  issuer,
  authorization_endpoint: `${issuer}/oauth2/auth`,
  token_endpoint: `${issuer}/oauth2/token`,
  userinfo_endpoint: `${issuer}/oauth2/userinfo`,
  jwks_uri: `${issuer}/.well-known/jwks.json`,
  revocation_endpoint: `${issuer}/oauth2/revoke`,
  end_session_endpoint: `${issuer}/oauth2/sessions/logout`,
}
for (const [key, value] of Object.entries(expectedEndpoints)) {
  if (discovery[key] !== value) throw new Error(`Discovery ${key} mismatch`)
}
if (!discovery.code_challenge_methods_supported?.includes('S256')) throw new Error('Discovery is missing S256 PKCE')
if (!Array.isArray(discovery.id_token_signing_alg_values_supported)
  || discovery.id_token_signing_alg_values_supported.length !== 1
  || discovery.id_token_signing_alg_values_supported[0] !== 'RS256') {
  throw new Error('Discovery does not restrict ID Token signing to RS256')
}

const jwks = await fetchJson(discovery.jwks_uri)
if (!Array.isArray(jwks.keys) || !jwks.keys.some((key) => key.kty === 'RSA' && key.use === 'sig' && key.kid)) {
  throw new Error('JWKS does not contain an RSA signing key with kid')
}

const client = await fetchJson(new URL(`/admin/clients/${encodeURIComponent(expected.id)}`, adminOrigin))
const exactArray = (actual, values) => Array.isArray(actual)
  && actual.length === values.length
  && values.every((value, index) => actual[index] === value)
if (!exactArray(client.grant_types, ['authorization_code', 'refresh_token'])
  || !exactArray(client.response_types, ['code'])
  || !exactArray(client.redirect_uris, [expected.redirect])
  || !exactArray(client.post_logout_redirect_uris, [expected.logoutCallback])
  || client.scope !== 'openid profile offline_access'
  || client.token_endpoint_auth_method !== 'client_secret_basic'
  || client.subject_type !== 'public'
  || client.backchannel_logout_uri !== expected.backchannel
  || client.backchannel_logout_session_required !== true
  || client.skip_consent !== false
  || client.skip_logout_consent !== false) {
  throw new Error('Hydra confidential client metadata is not exact')
}

console.log(JSON.stringify({
  ok: true,
  issuer,
  clientId: expected.id,
  signingKeys: jwks.keys.length,
}, null, 2))
