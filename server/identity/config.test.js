import { describe, expect, it } from 'vitest'
import { loadIdentityConfig } from './config.js'

const enabledEnv = {
  NODE_ENV: 'development',
  OIDC_ENABLED: 'true',
  OIDC_ISSUER: 'http://auth.localhost:5174',
  OIDC_HYDRA_PUBLIC_URL: 'http://127.0.0.1:4444',
  OIDC_HYDRA_ADMIN_URL: 'http://127.0.0.1:4445',
  OIDC_TOKEN_HOOK_SECRET: 'hook-secret-with-at-least-thirty-two-bytes',
  OIDC_LOGOUT_BROKER_SECRET: 'broker-secret-with-at-least-thirty-two-bytes',
}

describe('identity runtime config', () => {
  it('is disabled by default and contains no fallback secret', () => {
    const config = loadIdentityConfig({ NODE_ENV: 'development' })
    expect(config.enabled).toBe(false)
    expect(config.tokenHookSecret).toBeNull()
    expect(config.logoutBrokerSecret).toBeNull()
  })

  it('loads the exact local confidential client and host-only cookie policy', () => {
    const config = loadIdentityConfig(enabledEnv)
    expect(config).toMatchObject({
      enabled: true,
      issuer: 'http://auth.localhost:5174',
      hydraPublicUrl: 'http://127.0.0.1:4444',
      hydraAdminUrl: 'http://127.0.0.1:4445',
      logoutBrokerHeader: 'X-StarStack-Logout-Broker',
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
    })
    expect(config.client).toMatchObject({
      id: 'jieya-server-local',
      redirectUri: 'http://jieya.localhost:4180/auth/callback',
      logoutCallbackUri: 'http://jieya.localhost:4180/auth/logout/callback',
      tokenEndpointAuthMethod: 'client_secret_basic',
      allowedGrantTypes: ['authorization_code', 'refresh_token'],
      allowedResponseTypes: ['code'],
      allowedScopes: ['openid', 'profile', 'offline_access'],
    })
  })

  it('canonicalizes the issuer to the exact no-trailing-slash origin', () => {
    const config = loadIdentityConfig({ ...enabledEnv, OIDC_ISSUER: 'http://auth.localhost:5174/' })
    expect(config.issuer).toBe('http://auth.localhost:5174')
  })

  it('uses the exact production Hydra cookie names for the fixed Jieya client', () => {
    const config = loadIdentityConfig({ NODE_ENV: 'production' })
    expect(config.client.id).toBe('jieya-server')
    expect(config.hydraCookies).toEqual({
      names: [
        'starstack_hydra_login_csrf_681216528',
        'starstack_hydra_consent_csrf_681216528',
        'starstack_hydra_session',
        'starstack_hydra_device_csrf',
      ],
      path: '/oauth2',
    })
  })

  it.each([
    [{ ...enabledEnv, OIDC_TOKEN_HOOK_SECRET: '' }, /hook.*secret|密钥/i],
    [{ ...enabledEnv, OIDC_LOGOUT_BROKER_SECRET: 'short' }, /broker.*secret|密钥/i],
    [{ ...enabledEnv, OIDC_LOGOUT_BROKER_SECRET: enabledEnv.OIDC_TOKEN_HOOK_SECRET }, /separate|不同|分离/i],
    [{ ...enabledEnv, OIDC_ISSUER: 'http://auth.localhost:5174/path' }, /issuer/i],
    [{ ...enabledEnv, OIDC_HYDRA_ADMIN_URL: 'https://admin.example.com' }, /private|loopback|私网/i],
  ])('fails closed for unsafe enabled configuration', (env, expected) => {
    expect(() => loadIdentityConfig(env)).toThrow(expected)
  })
})
