#!/usr/bin/env node

import { access } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import {
  HYDRA_BROWSER_COOKIE_NAMES,
  HYDRA_BROWSER_COOKIE_PATH,
} from '../../server/identity/config.js'
import { assertLocalHydraTestDsn } from './localHydraDsn.mjs'
import {
  assertCanonicalLocalIdentityCredentialsPath,
  assertCanonicalLocalIdentityStarStackDatabasePath,
  loadLocalIdentityCredentials,
  LOCAL_IDENTITY_PROJECT_RUNTIME_ROOT,
} from './localIdentityCredentials.mjs'
import {
  IdentityProcessSupervisor,
  waitForManagedHttp,
} from './localIdentityProcessSupervisor.mjs'
import { acquireLocalIdentityRuntimeLock } from './localIdentityRuntimeLock.mjs'
import {
  prepareSecureSqliteUnit,
} from '../../server/utils/secureSqliteGuard.js'

const assertPortFree = (port) => new Promise((resolve, reject) => {
  const server = net.createServer()
  server.once('error', () => reject(new Error(`Local port ${port} is already in use`)))
  server.listen(port, '127.0.0.1', () => server.close(resolve))
})

const main = async () => {
  const supervisor = new IdentityProcessSupervisor()
  supervisor.installSignalHandlers()
  let releaseRuntimeLock
  let sqliteGuard
  try {
    // This guard intentionally precedes every filesystem write, child spawn,
    // migration and client registration.
    const hydraDsn = assertLocalHydraTestDsn(process.env.HYDRA_TEST_DSN)
    const credentialsPath = assertCanonicalLocalIdentityCredentialsPath(
      process.env.IDENTITY_TEST_CREDENTIALS_FILE,
    )
    const starStackDatabase = assertCanonicalLocalIdentityStarStackDatabasePath(
      process.env.IDENTITY_TEST_STARSTACK_DB,
    )
    const hydraBinary = process.env.HYDRA_TEST_BINARY
      || path.join(LOCAL_IDENTITY_PROJECT_RUNTIME_ROOT, 'hydra')
    await access(hydraBinary).catch(() => {
      throw new Error('Hydra binary is missing; set HYDRA_TEST_BINARY or run identity:hydra:fetch')
    })

    releaseRuntimeLock = await acquireLocalIdentityRuntimeLock()
    supervisor.throwIfShuttingDown()
    const credentials = await loadLocalIdentityCredentials(credentialsPath)
    sqliteGuard = await prepareSecureSqliteUnit({ databasePath: starStackDatabase })
    const issuer = 'http://auth.localhost:5174'
    const adminOrigin = 'http://127.0.0.1:4445'
    const localNoProxy = [
      'localhost',
      '127.0.0.1',
      '::1',
      '.localhost',
      'auth.localhost',
      'jieya.localhost',
    ].join(',')
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
      IDENTITY_TEST_SQLITE_GUARD: sqliteGuard.environmentValue,
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

    const run = async (command, args, env) => {
      const managed = supervisor.spawn(command, args, {
        cwd: process.cwd(),
        env,
        stdio: 'ignore',
      })
      const result = await managed.exited
      supervisor.throwIfShuttingDown()
      if (result.error) throw result.error
      if (result.code !== 0) throw new Error(`${managed.command} exited with ${result.code}`)
    }
    const capture = async (command, args, env) => {
      const managed = supervisor.spawn(command, args, {
        cwd: process.cwd(),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      managed.child.stdout.on('data', (chunk) => {
        stdout = `${stdout}${chunk.toString()}`.slice(-4000)
      })
      managed.child.stderr.resume()
      const result = await managed.exited
      supervisor.throwIfShuttingDown()
      if (result.error) throw result.error
      if (result.code !== 0) throw new Error(`${managed.command} exited with ${result.code}`)
      return stdout
    }
    const start = (command, args, env) => supervisor.spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: 'inherit',
    })

    await Promise.all([4444, 4445, 5174].map(assertPortFree))
    supervisor.throwIfShuttingDown()
    const hydraVersion = await capture(hydraBinary, ['version'], hydraEnv)
    if (!/^Version:\s+v26\.2\.0\s*$/m.test(hydraVersion)) {
      throw new Error('Local identity runtime requires exactly Hydra v26.2.0')
    }
    await run(hydraBinary, ['migrate', 'sql', 'up', '-e', '--yes'], hydraEnv)
    const hydra = start(hydraBinary, ['serve', 'all', '--dev', '--sqa-opt-out'], hydraEnv)
    await waitForManagedHttp(`${adminOrigin}/health/ready`, { child: hydra, supervisor })
    await run(process.execPath, ['scripts/identity/bootstrap-hydra.mjs'], {
      ...process.env,
      NODE_ENV: 'development',
      OIDC_HYDRA_ADMIN_URL: adminOrigin,
      JIEYA_OIDC_CLIENT_SECRET: credentials.clientSecret,
    })
    const starStack = start(process.execPath, ['server/index.js'], starStackEnv)
    await waitForManagedHttp('http://127.0.0.1:5174/api/health', {
      expected: [200, 503],
      child: starStack,
      supervisor,
    })
    await sqliteGuard.verify({ allowNewSidecars: true })
    await run(process.execPath, ['scripts/identity/verify-hydra-runtime.mjs'], {
      ...process.env,
      NODE_ENV: 'development',
      OIDC_ISSUER: issuer,
      OIDC_HYDRA_ADMIN_URL: adminOrigin,
    })
    // verify-hydra-runtime has now proven both Public Discovery/JWKS and the
    // exact confidential client before this process advertises readiness.
    console.log(JSON.stringify({
      ready: true,
      issuer,
      clientId: 'jieya-server-local',
      callback: 'http://jieya.localhost:4180/auth/callback',
      fixtureAccount: credentials.fixtureId,
      credentialsFile: credentialsPath,
    }, null, 2))

    const reason = await Promise.race([
      supervisor.shutdown.then((signal) => ({ type: 'signal', signal })),
      hydra.exited.then((result) => ({ type: 'child', name: 'Hydra', result })),
      starStack.exited.then((result) => ({ type: 'child', name: 'StarStack', result })),
    ])
    if (reason.type === 'child') {
      process.exitCode = 1
      throw new Error(
        `${reason.name} exited while local identity runtime was active `
        + `(code=${reason.result.code ?? 'none'}, signal=${reason.result.signal ?? 'none'})`,
      )
    }
  } catch (error) {
    if (!supervisor.shutdownRequested) throw error
  } finally {
    await supervisor.stop()
    if (sqliteGuard) await sqliteGuard.close()
    if (releaseRuntimeLock) await releaseRuntimeLock()
    supervisor.removeSignalHandlers()
  }
}

await main()
