#!/usr/bin/env node

const adminOrigin = process.env.OIDC_HYDRA_ADMIN_URL || 'http://127.0.0.1:4445'
const production = process.env.NODE_ENV === 'production'
const clientSecret = process.env.JIEYA_OIDC_CLIENT_SECRET

if (typeof clientSecret !== 'string' || clientSecret.length < 32) {
  throw new Error('JIEYA_OIDC_CLIENT_SECRET must contain at least 32 characters')
}

const client = production
  ? {
      client_id: 'jieya-server',
      client_name: 'Jieya Server',
      redirect_uris: ['https://jieya.xingzhan.cc/auth/callback'],
      post_logout_redirect_uris: ['https://jieya.xingzhan.cc/auth/logout/callback'],
      backchannel_logout_uri: 'https://jieya.xingzhan.cc/auth/backchannel-logout',
    }
  : {
      client_id: 'jieya-server-local',
      client_name: 'Jieya Server (local)',
      redirect_uris: ['http://jieya.localhost:4180/auth/callback'],
      post_logout_redirect_uris: ['http://jieya.localhost:4180/auth/logout/callback'],
      backchannel_logout_uri: 'http://jieya.localhost:4180/auth/backchannel-logout',
    }

const payload = {
  ...client,
  client_secret: clientSecret,
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  scope: 'openid profile offline_access',
  token_endpoint_auth_method: 'client_secret_basic',
  subject_type: 'public',
  backchannel_logout_session_required: true,
  skip_consent: false,
  skip_logout_consent: false,
}

const itemUrl = new URL(`/admin/clients/${encodeURIComponent(client.client_id)}`, adminOrigin)
const lookup = await fetch(itemUrl, {
  headers: { accept: 'application/json' },
  signal: AbortSignal.timeout(5000),
})
if (!lookup.ok && lookup.status !== 404) {
  throw new Error(`Hydra client lookup failed with HTTP ${lookup.status}`)
}
const response = await fetch(lookup.status === 404 ? new URL('/admin/clients', adminOrigin) : itemUrl, {
  method: lookup.status === 404 ? 'POST' : 'PUT',
  headers: { 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify(payload),
  signal: AbortSignal.timeout(5000),
})
if (!response.ok) {
  throw new Error(`Hydra client registration failed with HTTP ${response.status}`)
}
const registered = await response.json()
if (registered.client_id !== client.client_id) throw new Error('Hydra returned an unexpected client')
console.log(`Hydra client registered: ${registered.client_id}`)
