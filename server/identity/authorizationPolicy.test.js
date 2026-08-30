import { describe, expect, it } from 'vitest'
import {
  AuthorizationPolicyError,
  validateJieyaAuthorizationRequest,
} from './authorizationPolicy.js'

const client = Object.freeze({
  id: 'jieya-server-local',
  redirectUri: 'http://jieya.localhost:4180/auth/callback',
  allowedScopes: ['openid', 'profile', 'offline_access'],
})
const makeRequest = (overrides = {}) => {
  const params = new URLSearchParams({
    client_id: client.id,
    redirect_uri: client.redirectUri,
    response_type: 'code',
    scope: 'openid profile offline_access',
    state: 'state-with-128-bits-of-randomness',
    nonce: 'nonce-with-128-bits-of-randomness',
    code_challenge: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    code_challenge_method: 'S256',
    ...overrides,
  })
  return {
    client: { client_id: client.id },
    request_url: `http://auth.localhost:5174/oauth2/auth?${params}`,
  }
}

describe('Jieya authorization policy', () => {
  it('accepts only the exact confidential client code flow with S256 PKCE', () => {
    expect(validateJieyaAuthorizationRequest(makeRequest(), client)).toEqual({
      clientId: client.id,
      redirectUri: client.redirectUri,
      requestedScopes: ['openid', 'profile', 'offline_access'],
      offlineAccessRequested: true,
    })
  })

  it.each([
    [{ code_challenge_method: 'plain' }, 'PKCE'],
    [{ code_challenge_method: '' }, 'PKCE'],
    [{ code_challenge: '' }, 'PKCE'],
    [{ response_type: 'token' }, 'response_type'],
    [{ redirect_uri: 'https://attacker.example/callback' }, 'redirect'],
    [{ state: '' }, 'state'],
    [{ nonce: '' }, 'nonce'],
    [{ scope: 'openid admin' }, 'scope'],
  ])('rejects an unsafe authorization request (%o)', (override, expected) => {
    expect(() => validateJieyaAuthorizationRequest(makeRequest(override), client)).toThrow(expected)
  })

  it('rejects duplicate security parameters instead of accepting the first value', () => {
    const request = makeRequest()
    request.request_url += '&redirect_uri=https%3A%2F%2Fattacker.example%2Fcallback'
    expect(() => validateJieyaAuthorizationRequest(request, client)).toThrow(AuthorizationPolicyError)
  })
})
