import { chmod, link, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const resources = []
const readProjectFile = (relative) => readFile(path.resolve(relative), 'utf8')

afterEach(async () => {
  await Promise.all(resources.splice(0).map((resource) => rm(resource, { recursive: true, force: true })))
})

describe('systemd StarStack identity runtime', () => {
  it('allowlists every current production application setting and only approved secret families', async () => {
    const migration = await import('./migrate-pm2-to-systemd-credentials.mjs')
    for (const key of [
      'NODE_ENV', 'PORT', 'HOST', 'TRUST_PROXY_HOPS', 'ALLOWED_ORIGINS',
      'TURNSTILE_HOSTNAMES', 'TURNSTILE_SECRET_KEY',
      'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM',
      'JUDGE_MEMORY_LIMIT_KB', 'JUDGE_CONCURRENCY', 'JUDGE_CACHE_MAX_AGE_MS',
      'JUDGE_CACHE_MAX_BYTES', 'JUDGE_CACHE_MAX_FILES', 'JUDGE_DEBUG_SANDBOX',
      'GPP_PATH', 'PYTHON_PATH', 'JAVA_PATH', 'JAVAC_PATH', 'JAVA_HOME', 'MINGW_HOME',
      'DB_PATH', 'DISK_CHECK_PATH', 'BACKUP_DIR', 'BACKUP_FILE',
      'ADMIN_ID', 'ADMIN_NAME', 'ADMIN_PASSWORD',
      'OIDC_ENABLED', 'OIDC_ISSUER', 'OIDC_HYDRA_PUBLIC_URL', 'OIDC_HYDRA_ADMIN_URL',
      'JIEYA_ACCOUNT_LIFECYCLE_ENABLED',
      'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'WEBPUSH_PRIVATE_KEY', 'JWT_SECRET',
      'PATH', 'LANG', 'LC_ALL', 'TZ',
    ]) expect(migration.isApprovedApplicationKey(key)).toBe(true)
    expect(migration.isApprovedApplicationKey('AWS_SECRET_ACCESS_KEY')).toBe(false)
    expect(migration.isApprovedApplicationKey('OIDC_TOKEN_HOOK_SECRET')).toBe(false)
    expect(migration.isApprovedApplicationKey('JIEYA_ACCOUNT_LIFECYCLE_SECRET')).toBe(false)
  })

  it('loads all runtime configuration through systemd credentials and never persists secrets in PM2', async () => {
    const [unit, launcher, example, ecosystem] = await Promise.all([
      readProjectFile('infra/identity/systemd/starstack-api.service'),
      readProjectFile('scripts/identity/systemd-server-launcher.mjs'),
      readProjectFile('infra/identity/systemd/starstack-environment.example'),
      readProjectFile('ecosystem.config.cjs'),
    ])

    expect(unit).toContain('User=starstack')
    expect(unit).toContain('WorkingDirectory=/opt/star-stack')
    expect(unit).toContain('LoadCredential=starstack-environment:/etc/starstack/server/starstack-environment')
    expect(unit).toContain('LoadCredential=oidc-token-hook-secret:/etc/starstack/server/oidc-token-hook-secret')
    expect(unit).toContain('LoadCredential=oidc-logout-broker-secret:/etc/starstack/server/oidc-logout-broker-secret')
    expect(unit).toContain('LoadCredential=jieya-account-lifecycle-secret:/etc/starstack/server/jieya-account-lifecycle-secret')
    expect(unit).toContain('ExecStart=/usr/bin/node /opt/star-stack/scripts/identity/systemd-server-launcher.mjs')
    expect(unit).toContain('NoNewPrivileges=true')
    expect(unit).toContain('CapabilityBoundingSet=\n')
    expect(unit).toContain('AmbientCapabilities=\n')
    expect(unit).toContain('ReadWritePaths=/opt/star-stack/server/data')
    expect(unit).toContain('ProtectKernelTunables=false')
    expect(unit).toContain('ProtectKernelModules=false')
    expect(unit).toContain('ProtectKernelLogs=false')
    expect(unit).toContain('ProtectControlGroups=true')
    expect(unit).toContain('SystemCallFilter=~@module syslog')
    expect(unit).not.toMatch(/Environment(File)?=/)

    expect(launcher).toContain('process.execve(')
    expect(launcher).toContain('CREDENTIALS_DIRECTORY')
    expect(launcher).not.toMatch(/console\.(log|error).*secret/i)
    expect(JSON.parse(example)).toMatchObject({
      OIDC_ENABLED: 'false',
      JIEYA_ACCOUNT_LIFECYCLE_ENABLED: 'false',
      TURNSTILE_SECRET_KEY: '',
      SMTP_PASS: '',
      VAPID_PRIVATE_KEY: '',
      JWT_SECRET: '',
    })
    expect(ecosystem).toContain("OIDC_ENABLED: 'false'")
    expect(ecosystem).toContain("OIDC_TOKEN_HOOK_SECRET: ''")
    expect(ecosystem).toContain("OIDC_LOGOUT_BROKER_SECRET: ''")
    expect(ecosystem).toContain("JIEYA_ACCOUNT_LIFECYCLE_ENABLED: 'false'")
    expect(ecosystem).toContain("JIEYA_ACCOUNT_LIFECYCLE_SECRET: ''")
  })

  it('separates identity secrets while preserving approved PM2 application variables', async () => {
    const migration = await import('./migrate-pm2-to-systemd-credentials.mjs')
    const tokenHook = 't'.repeat(48)
    const logoutBroker = 'l'.repeat(48)
    const result = migration.buildSystemdCredentialPayloads({
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: '5174',
      OIDC_ENABLED: 'false',
      OIDC_TOKEN_HOOK_SECRET: tokenHook,
      OIDC_LOGOUT_BROKER_SECRET: logoutBroker,
      TURNSTILE_SECRET_KEY: 'turnstile-fixture',
      SMTP_PASS: 'smtp fixture with spaces',
      VAPID_PUBLIC_KEY: 'p'.repeat(64),
      VAPID_PRIVATE_KEY: 'v'.repeat(48),
      JWT_SECRET: 'jwt-fixture',
      WEBPUSH_PRIVATE_KEY: 'webpush-fixture',
      AWS_SECRET_ACCESS_KEY: 'must-not-be-copied',
    })

    expect(result.tokenHookSecret).toBe(tokenHook)
    expect(result.logoutBrokerSecret).toBe(logoutBroker)
    expect(Buffer.byteLength(result.lifecycleSecret, 'utf8')).toBeGreaterThanOrEqual(32)
    expect(new Set([result.tokenHookSecret, result.logoutBrokerSecret, result.lifecycleSecret]).size).toBe(3)
    expect(JSON.parse(result.environment)).toMatchObject({
      TURNSTILE_SECRET_KEY: 'turnstile-fixture',
      SMTP_PASS: 'smtp fixture with spaces',
      VAPID_PRIVATE_KEY: 'v'.repeat(48),
      JWT_SECRET: 'jwt-fixture',
      WEBPUSH_PRIVATE_KEY: 'webpush-fixture',
    })
    expect(result.environment).not.toContain(tokenHook)
    expect(result.environment).not.toContain(logoutBroker)
    expect(result.environment).not.toContain(result.lifecycleSecret)
    expect(result.environment).not.toContain('AWS_SECRET_ACCESS_KEY')
  })

  it('imports an existing VAPID file only when its identity and permissions are safe', async () => {
    const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'starstack-vapid-migration-')))
    resources.push(directory)
    const file = path.join(directory, '.vapid.json')
    await writeFile(file, JSON.stringify({
      publicKey: 'p'.repeat(64),
      privateKey: 'v'.repeat(48),
    }), { mode: 0o600 })
    const migration = await import('./migrate-pm2-to-systemd-credentials.mjs')
    await expect(migration.readLegacyVapidKeys(file)).resolves.toEqual({
      VAPID_PUBLIC_KEY: 'p'.repeat(64),
      VAPID_PRIVATE_KEY: 'v'.repeat(48),
    })
    await link(file, path.join(directory, 'vapid-hard-link'))
    await expect(migration.readLegacyVapidKeys(file)).rejects.toThrow(/unsafe|link/i)
  })

  it('refuses missing, short, duplicate or embedded identity credentials', async () => {
    const migration = await import('./migrate-pm2-to-systemd-credentials.mjs')
    const base = {
      NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '5174', OIDC_ENABLED: 'false',
      OIDC_TOKEN_HOOK_SECRET: 'a'.repeat(48),
      OIDC_LOGOUT_BROKER_SECRET: 'b'.repeat(48),
      VAPID_PUBLIC_KEY: 'p'.repeat(64),
      VAPID_PRIVATE_KEY: 'v'.repeat(48),
    }
    expect(() => migration.buildSystemdCredentialPayloads({ ...base, OIDC_TOKEN_HOOK_SECRET: '' }))
      .toThrow(/token hook/i)
    expect(() => migration.buildSystemdCredentialPayloads({ ...base, OIDC_LOGOUT_BROKER_SECRET: 'short' }))
      .toThrow(/logout broker/i)
    expect(() => migration.buildSystemdCredentialPayloads({ ...base, OIDC_LOGOUT_BROKER_SECRET: base.OIDC_TOKEN_HOOK_SECRET }))
      .toThrow(/distinct|separate/i)
    expect(() => migration.parseCredentialEnvironment('{"OIDC_TOKEN_HOOK_SECRET":"forbidden"}\n'))
      .toThrow(/identity secret/i)
    expect(() => migration.parseCredentialEnvironment('{"JIEYA_ACCOUNT_LIFECYCLE_SECRET":"forbidden"}\n'))
      .toThrow(/identity secret/i)
    const quoted = migration.buildSystemdCredentialPayloads({
      ...base,
      SMTP_PASS: "it's still exact",
    })
    expect(migration.parseCredentialEnvironment(quoted.environment).SMTP_PASS)
      .toBe("it's still exact")
  })

  it('loads the four runtime credentials without exposing identity secrets in the env bundle', async () => {
    const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'starstack-systemd-credentials-')))
    resources.push(directory)
    await chmod(directory, 0o700)
    const environment = JSON.stringify({
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: '5174',
      OIDC_ENABLED: 'false',
      SMTP_PASS: 'smtp test value',
      VAPID_PUBLIC_KEY: 'p'.repeat(64),
      VAPID_PRIVATE_KEY: 'v'.repeat(48),
    })
    await Promise.all([
      writeFile(path.join(directory, 'starstack-environment'), `${environment}\n`, { mode: 0o600 }),
      writeFile(path.join(directory, 'oidc-token-hook-secret'), 't'.repeat(48), { mode: 0o600 }),
      writeFile(path.join(directory, 'oidc-logout-broker-secret'), 'l'.repeat(48), { mode: 0o600 }),
      writeFile(path.join(directory, 'jieya-account-lifecycle-secret'), 'c'.repeat(48), { mode: 0o600 }),
    ])
    const launcher = await import('./systemd-server-launcher.mjs')
    const loaded = await launcher.loadSystemdServerEnvironment({ CREDENTIALS_DIRECTORY: directory })
    expect(loaded).toMatchObject({
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: '5174',
      OIDC_ENABLED: 'false',
      SMTP_PASS: 'smtp test value',
      VAPID_PUBLIC_KEY: 'p'.repeat(64),
      VAPID_PRIVATE_KEY: 'v'.repeat(48),
      OIDC_TOKEN_HOOK_SECRET: 't'.repeat(48),
      OIDC_LOGOUT_BROKER_SECRET: 'l'.repeat(48),
      JIEYA_ACCOUNT_LIFECYCLE_SECRET: 'c'.repeat(48),
    })
    expect(environment).not.toContain('t'.repeat(48))
    expect(environment).not.toContain('l'.repeat(48))
    expect(environment).not.toContain('c'.repeat(48))

    const lifecycleFile = path.join(directory, 'jieya-account-lifecycle-secret')
    await writeFile(lifecycleFile, 't'.repeat(48), { mode: 0o600 })
    await expect(launcher.loadSystemdServerEnvironment({ CREDENTIALS_DIRECTORY: directory }))
      .rejects.toThrow(/distinct/i)
    await writeFile(lifecycleFile, 'c'.repeat(48), { mode: 0o600 })

    const leakedLink = path.join(directory, 'leaked-token-hook')
    await link(path.join(directory, 'oidc-token-hook-secret'), leakedLink)
    await expect(launcher.loadSystemdServerEnvironment({ CREDENTIALS_DIRECTORY: directory }))
      .rejects.toThrow(/metadata|link/i)
  })

  it('accepts exact systemd runtime mode 0440 and rejects every broader group or other mode', async () => {
    const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'starstack-systemd-runtime-credentials-')))
    resources.push(directory)
    const files = [
      ['starstack-environment', `${JSON.stringify({
        NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '5174', OIDC_ENABLED: 'false',
        VAPID_PUBLIC_KEY: 'p'.repeat(64), VAPID_PRIVATE_KEY: 'v'.repeat(48),
      })}\n`],
      ['oidc-token-hook-secret', 't'.repeat(48)],
      ['oidc-logout-broker-secret', 'l'.repeat(48)],
      ['jieya-account-lifecycle-secret', 'c'.repeat(48)],
    ]
    await Promise.all(files.map(([name, value]) => writeFile(path.join(directory, name), value, { mode: 0o440 })))
    await chmod(directory, 0o550)

    const launcher = await import('./systemd-server-launcher.mjs')
    try {
      await expect(launcher.loadSystemdServerEnvironment({ CREDENTIALS_DIRECTORY: directory }))
        .resolves.toMatchObject({
          NODE_ENV: 'production',
          HOST: '127.0.0.1',
          PORT: '5174',
          OIDC_ENABLED: 'false',
          OIDC_TOKEN_HOOK_SECRET: 't'.repeat(48),
          OIDC_LOGOUT_BROKER_SECRET: 'l'.repeat(48),
          JIEYA_ACCOUNT_LIFECYCLE_SECRET: 'c'.repeat(48),
        })

      const environmentFile = path.join(directory, 'starstack-environment')
      for (const unsafeMode of [0o640, 0o460, 0o444]) {
        await chmod(environmentFile, unsafeMode)
        await expect(launcher.loadSystemdServerEnvironment({ CREDENTIALS_DIRECTORY: directory }))
          .rejects.toThrow(/metadata|unsafe/i)
      }
    } finally {
      await chmod(directory, 0o700)
    }
  })

  it('documents a value-safe migration and removal of the persisted PM2 dump', async () => {
    const production = await readProjectFile('infra/identity/PRODUCTION.md')
    expect(production).toContain('migrate-pm2-to-systemd-credentials.mjs')
    expect(production).toContain('pm2 cleardump')
    expect(production).not.toContain('pm2 save')
    expect(production).toContain('/etc/starstack/server/starstack-environment')
    expect(production).toContain('OIDC_ENABLED=false')
    expect(production).toContain('production-protocol-fixture.mjs')
    expect(production).toContain('cleanup-only')
  })
})
