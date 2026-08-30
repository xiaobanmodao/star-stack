#!/usr/bin/env node
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertLocalHydraTestDsn } from './localHydraDsn.mjs'
import {
  assertCanonicalLocalIdentityCredentialsPath,
  loadLocalIdentityCredentials,
} from './localIdentityCredentials.mjs'
import { acquireLocalIdentityRuntimeLock } from './localIdentityRuntimeLock.mjs'
import { IdentityProcessSupervisor } from './localIdentityProcessSupervisor.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const hydraBinary = String(process.env.HYDRA_TEST_BINARY || '').trim()
if (!hydraBinary) throw new Error('HYDRA_TEST_BINARY is required')
const hydraDsn = assertLocalHydraTestDsn(process.env.HYDRA_TEST_DSN)
const credentialsPath = assertCanonicalLocalIdentityCredentialsPath(
  process.env.IDENTITY_TEST_CREDENTIALS_FILE,
)

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer()
  server.unref()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    server.close((error) => error ? reject(error) : resolve(port))
  })
})

const fetchJson = async (url) => {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'x-forwarded-proto': 'https' },
    signal: AbortSignal.timeout(2000),
  })
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
  return response.json()
}

const waitForJson = async (url, managed, supervisor) => {
  const deadline = Date.now() + 20000
  let lastError
  while (Date.now() < deadline) {
    supervisor.throwIfShuttingDown()
    const child = managed.child
    if (child.exitCode !== null || child.signalCode !== null) {
      const result = managed.result || await managed.exited
      throw new Error(`Hydra exited before readiness (${result.code ?? result.signal})`)
    }
    try {
      return await fetchJson(url)
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw new Error(`Hydra readiness timed out: ${lastError?.message || 'unknown error'}`)
}

const verifyEnvironment = async (environment, credentials, supervisor) => {
  const [publicPort, adminPort] = await Promise.all([freePort(), freePort()])
  const env = {
    ...process.env,
    DSN: hydraDsn,
    SECRETS_SYSTEM: credentials.systemSecret,
    SECRETS_COOKIE: credentials.cookieSecret,
    SERVE_PUBLIC_HOST: '127.0.0.1',
    SERVE_PUBLIC_PORT: String(publicPort),
    SERVE_ADMIN_HOST: '127.0.0.1',
    SERVE_ADMIN_PORT: String(adminPort),
    SERVE_TLS_ALLOW_TERMINATION_FROM: '127.0.0.1/32',
    LOG_LEVEL: 'error',
    LOG_LEAK_SENSITIVE_VALUES: 'false',
  }
  const managed = supervisor.spawn(hydraBinary, [
    'serve', 'all', '--config', path.join(root, `infra/identity/hydra.${environment}.yaml`), '--sqa-opt-out',
  ], { cwd: root, env, stdio: 'ignore' })
  try {
    const health = await waitForJson(`http://127.0.0.1:${adminPort}/health/ready`, managed, supervisor)
    if (health.status !== 'ok') throw new Error('Hydra Admin readiness is not ok')
    const discovery = await fetchJson(`http://127.0.0.1:${publicPort}/.well-known/openid-configuration`)
    const expected = {
      issuer: 'https://auth.xingzhan.cc',
      authorization_endpoint: 'https://auth.xingzhan.cc/oauth2/auth',
      token_endpoint: 'https://auth.xingzhan.cc/oauth2/token',
      userinfo_endpoint: 'https://auth.xingzhan.cc/oauth2/userinfo',
      jwks_uri: 'https://auth.xingzhan.cc/.well-known/jwks.json',
      revocation_endpoint: 'https://auth.xingzhan.cc/oauth2/revoke',
      end_session_endpoint: 'https://auth.xingzhan.cc/oauth2/sessions/logout',
    }
    for (const [key, value] of Object.entries(expected)) {
      if (discovery[key] !== value) throw new Error(`${environment} Discovery ${key} mismatch`)
    }
    if (!discovery.code_challenge_methods_supported?.includes('S256')
      || discovery.id_token_signing_alg_values_supported?.length !== 1
      || discovery.id_token_signing_alg_values_supported[0] !== 'RS256') {
      throw new Error(`${environment} Discovery policy is not frozen to S256/RS256`)
    }
    const jwks = await fetchJson(`http://127.0.0.1:${publicPort}/.well-known/jwks.json`)
    if (!jwks.keys?.some((key) => key.kty === 'RSA' && key.use === 'sig' && key.kid)) {
      throw new Error(`${environment} JWKS has no RSA signing key`)
    }
    return { environment, signingKids: jwks.keys.map((key) => key.kid).filter(Boolean).sort() }
  } catch (error) {
    throw new Error(`${environment} Hydra config verification failed: ${error.message}`)
  } finally {
    if (managed.child.exitCode === null && managed.child.signalCode === null) managed.child.kill('SIGTERM')
    await managed.exited
  }
}

const supervisor = new IdentityProcessSupervisor()
supervisor.installSignalHandlers()
const releaseRuntimeLock = await acquireLocalIdentityRuntimeLock()
try {
  const credentials = await loadLocalIdentityCredentials(credentialsPath)
  const results = []
  for (const environment of ['production', 'staging']) {
    results.push(await verifyEnvironment(environment, credentials, supervisor))
  }
  const kids = results.map((result) => JSON.stringify(result.signingKids))
  if (new Set(kids).size !== 1) throw new Error('Hydra signing keys changed between config checks')
  console.log(JSON.stringify({ ok: true, isolatedFixture: true, environments: results }, null, 2))
} finally {
  await supervisor.stop()
  supervisor.removeSignalHandlers()
  await releaseRuntimeLock()
}
