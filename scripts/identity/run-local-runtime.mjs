#!/usr/bin/env node

import { access } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'
import {
  HYDRA_BROWSER_COOKIE_NAMES,
  HYDRA_BROWSER_COOKIE_PATH,
} from '../../server/identity/config.js'
import { assertLocalHydraTestDsn } from './localHydraDsn.mjs'
import {
  assertCanonicalLocalIdentityCredentialsPath,
  assertCanonicalLocalIdentityStarStackDatabasePath,
  loadLocalIdentityCredentials,
  LOCAL_IDENTITY_RUNTIME_ROOT,
} from './localIdentityCredentials.mjs'
import { acquireLocalIdentityRuntimeLock } from './localIdentityRuntimeLock.mjs'

const runtimeRoot = LOCAL_IDENTITY_RUNTIME_ROOT
const hydraDsn = assertLocalHydraTestDsn(process.env.HYDRA_TEST_DSN)
const credentialsPath = assertCanonicalLocalIdentityCredentialsPath(
  process.env.IDENTITY_TEST_CREDENTIALS_FILE,
)
const starStackDatabase = assertCanonicalLocalIdentityStarStackDatabasePath(
  process.env.IDENTITY_TEST_STARSTACK_DB,
)
const hydraBinary = process.env.HYDRA_TEST_BINARY || path.join(runtimeRoot, 'hydra')
await access(hydraBinary).catch(() => {
  throw new Error('Hydra binary is missing; set HYDRA_TEST_BINARY or run identity:hydra:fetch')
})
const releaseRuntimeLock = await acquireLocalIdentityRuntimeLock()
let credentials
try {
  credentials = await loadLocalIdentityCredentials(credentialsPath)
} catch (error) {
  await releaseRuntimeLock()
  throw error
}

const issuer = 'http://auth.localhost:5174'
const adminOrigin = 'http://127.0.0.1:4445'
const localNoProxy = ['localhost', '127.0.0.1', '::1', '.localhost', 'auth.localhost', 'jieya.localhost']
  .join(',')
const hydraEnv = {
  ...process.env,
  DSN: hydraDsn,
  NO_PROXY: [process.env.NO_PROXY, localNoProxy].filter(Boolean).join(','),
  no_proxy: [process.env.no_proxy, localNoProxy].filter(Boolean).join(','),
  SECRETS_SYSTEM: credentials.systemSecret,
  SECRETS_COOKIE: credentials.cookieSecret,
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
  OAUTH2_TOKEN_HOOK_AUTH_CONFIG_VALUE: credentials.tokenHookSecret,
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
  ADMIN_ID: credentials.fixtureId,
  ADMIN_NAME: 'OIDC Fixture',
  ADMIN_PASSWORD: credentials.fixturePassword,
  OIDC_ENABLED: 'true',
  OIDC_ISSUER: issuer,
  OIDC_HYDRA_PUBLIC_URL: 'http://127.0.0.1:4444',
  OIDC_HYDRA_ADMIN_URL: adminOrigin,
  OIDC_TOKEN_HOOK_SECRET: credentials.tokenHookSecret,
  OIDC_LOGOUT_BROKER_SECRET: credentials.logoutBrokerSecret,
  ALLOWED_ORIGINS: issuer,
}

const children = []
const assertPortFree = (port) => new Promise((resolve, reject) => {
  const server = net.createServer()
  server.once('error', () => reject(new Error(`Local port ${port} is already in use`)))
  server.listen(port, '127.0.0.1', () => server.close(resolve))
})
const run = (command, args, env, { quiet = false } = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env,
    stdio: quiet ? ['ignore', 'ignore', 'inherit'] : 'inherit',
  })
  child.once('error', reject)
  child.once('exit', (code) => code === 0
    ? resolve()
    : reject(new Error(`${path.basename(command)} exited with ${code}`)))
})
const capture = (command, args, env) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk.toString()}`.slice(-4000) })
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk.toString()}`.slice(-4000) })
  child.once('error', reject)
  child.once('exit', (code) => code === 0
    ? resolve(stdout)
    : reject(new Error(`${path.basename(command)} exited with ${code}: ${stderr}`)))
})
const start = (command, args, env) => {
  const child = spawn(command, args, { cwd: process.cwd(), env, stdio: 'inherit' })
  children.push(child)
  return child
}
const waitForHttp = async (url, { expected = [200], timeoutMs = 30000 } = {}) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) })
      if (expected.includes(response.status)) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

const stop = async () => {
  const exits = []
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      exits.push(new Promise((resolve) => child.once('exit', resolve)))
      child.kill('SIGTERM')
    }
  }
  await Promise.all(exits)
}

const shutdownSignal = new Promise((resolve) => {
  process.once('SIGINT', () => resolve('SIGINT'))
  process.once('SIGTERM', () => resolve('SIGTERM'))
})

try {
  await Promise.all([4444, 4445, 5174].map(assertPortFree))
  const hydraVersion = await capture(hydraBinary, ['version'], hydraEnv)
  if (!/^Version:\s+v26\.2\.0\s*$/m.test(hydraVersion)) {
    throw new Error('Local identity runtime requires exactly Hydra v26.2.0')
  }
  await run(hydraBinary, ['migrate', 'sql', 'up', '-e', '--yes'], hydraEnv, { quiet: true })
  const hydra = start(hydraBinary, ['serve', 'all', '--dev', '--sqa-opt-out'], hydraEnv)
  await waitForHttp(`${adminOrigin}/health/ready`)
  await run(process.execPath, ['scripts/identity/bootstrap-hydra.mjs'], {
    ...process.env,
    NODE_ENV: 'development',
    OIDC_HYDRA_ADMIN_URL: adminOrigin,
    JIEYA_OIDC_CLIENT_SECRET: credentials.clientSecret,
  }, { quiet: true })
  const starStack = start(process.execPath, ['server/index.js'], starStackEnv)
  await waitForHttp('http://127.0.0.1:5174/api/health', { expected: [200, 503] })
  await run(process.execPath, ['scripts/identity/verify-hydra-runtime.mjs'], {
    ...process.env,
    NODE_ENV: 'development',
    OIDC_ISSUER: issuer,
    OIDC_HYDRA_ADMIN_URL: adminOrigin,
  }, { quiet: true })
  console.log(JSON.stringify({
    ready: true,
    issuer,
    clientId: 'jieya-server-local',
    callback: 'http://jieya.localhost:4180/auth/callback',
    fixtureAccount: credentials.fixtureId,
    credentialsFile: credentialsPath,
  }, null, 2))

  const exited = Promise.race([hydra, starStack].map((child) => new Promise((resolve) => {
    child.once('exit', (code) => resolve(`child-exit:${code}`))
  })))
  const reason = await Promise.race([shutdownSignal, exited])
  if (reason.startsWith('child-exit')) process.exitCode = 1
} finally {
  await stop()
  await releaseRuntimeLock()
}
