import { describe, expect, it } from 'vitest'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const readProjectFile = (relativePath) => readFile(path.join(projectRoot, relativePath), 'utf8')

const HYDRA_IMAGE = 'oryd/hydra:v26.2.0-distroless@sha256:ad53a123ddf869fc23ea74f3d76b47e2966dc52f559e93ab31f81440f4d60c5e'
const POSTGRES_IMAGE = 'postgres:16.15-alpine3.24@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685'

const composeService = (compose, service, nextService) => {
  const start = compose.indexOf(`\n  ${service}:`)
  const end = compose.indexOf(`\n  ${nextService}:`, start + 1)
  if (start < 0 || end < 0) throw new Error(`Compose service ${service} was not found`)
  return compose.slice(start, end)
}

describe('SS-AUTH-003 production deployment contract', () => {
  for (const environment of ['production', 'staging']) {
    it(`${environment} compose is isolated, pinned and private by construction`, async () => {
      const compose = await readProjectFile(`infra/identity/compose.${environment}.yaml`)
      expect(compose).toContain(HYDRA_IMAGE)
      expect(compose).toContain(POSTGRES_IMAGE)
      expect(compose).toContain('internal: true')
      expect(compose).toContain('host.docker.internal:host-gateway')
      expect(compose).toMatch(/127\.0\.0\.1:\$\{HYDRA_PUBLIC_PORT[^}]*\}:4444/)
      expect(compose).toMatch(/127\.0\.0\.1:\$\{HYDRA_ADMIN_PORT[^}]*\}:4445/)
      expect(composeService(compose, 'postgres', 'hydra-migrate')).not.toContain('\n    ports:')
      expect(compose).not.toContain('--dev')
      expect(compose).not.toContain('sslmode=disable')
      expect(compose).not.toContain('network_mode: host')
      expect(compose).not.toContain('auth.localhost')
      expect(compose).not.toContain('jieya.localhost')
      expect(compose).not.toMatch(/(?:^|["'])0\.0\.0\.0:/m)
    })

    it(`${environment} Hydra config freezes production protocol policy`, async () => {
      const config = await readProjectFile(`infra/identity/hydra.${environment}.yaml`)
      expect(config).toContain('issuer: https://auth.xingzhan.cc')
      expect(config).toContain('userinfo_url: https://auth.xingzhan.cc/oauth2/userinfo')
      expect(config).toContain('enforced: true')
      expect(config).toContain('encrypt_at_rest: true')
      expect(config).toContain('rotation_grace_period: 0s')
      expect(config).toContain('rotation_grace_reuse_count: 0')
      expect(config).toContain('access_token: opaque')
      expect(config).toContain('enabled: false')
      expect(config).not.toContain('localhost')
      expect(config).not.toContain('secret')
    })
  }

  it('public and bridge Nginx templates expose only their frozen trust surfaces', async () => {
    const publicConfig = await readProjectFile('infra/identity/nginx/auth.xingzhan.cc.conf')
    const hookTemplate = await readProjectFile('infra/identity/nginx/token-hook.bridge.conf.template')
    expect(publicConfig).toContain('server_name auth.xingzhan.cc;')
    expect(publicConfig).toMatch(/location \^~ \/internal\/oidc\/[^]*?return 404;/)
    expect(publicConfig).toContain('proxy_pass http://127.0.0.1:5174;')
    expect(publicConfig).not.toContain('proxy_pass http://127.0.0.1:4445')
    expect(hookTemplate).toContain('listen __IDENTITY_HOST_GATEWAY_IP__:5175;')
    expect(hookTemplate).toContain('allow __IDENTITY_HOOK_SUBNET__;')
    expect(hookTemplate).toMatch(/location = \/internal\/oidc\/token-hook/)
    expect(hookTemplate).toMatch(/limit_except POST/)
    expect(hookTemplate).toContain('proxy_pass http://127.0.0.1:5174;')
    expect(hookTemplate).not.toContain('logout-transactions')
  })

  it('PM2 keeps identity disabled and Node loopback-only by default', async () => {
    const ecosystem = await readProjectFile('ecosystem.config.cjs')
    expect(ecosystem).toContain("OIDC_ENABLED: process.env.OIDC_ENABLED || 'false'")
    expect(ecosystem).toContain("OIDC_ISSUER: process.env.OIDC_ISSUER || 'https://auth.xingzhan.cc'")
    expect(ecosystem).toContain("HOST: process.env.HOST || '127.0.0.1'")
    expect(ecosystem).not.toContain("HOST: '0.0.0.0'")
  })

  it('ships a read-only preflight and separate backup tooling', async () => {
    const packageJson = JSON.parse(await readProjectFile('package.json'))
    expect(packageJson.scripts['identity:production:preflight']).toBe('node scripts/identity/production-preflight.mjs')
    expect(packageJson.scripts['identity:production:backup']).toBe('node scripts/identity/production-backup.mjs')
    const preflight = await readProjectFile('scripts/identity/production-preflight.mjs')
    expect(preflight).toContain('OIDC_ENABLED must remain false during pre-release')
    expect(preflight).not.toMatch(/\b(?:writeFile|rm|unlink|rename|mkdir|chmod|chown)\b/)
    const backup = await readProjectFile('scripts/identity/production-backup.mjs')
    expect(backup).toContain('pg_dump')
    expect(backup).toContain('sqlite3')
    expect(backup).toContain('manifest.json')
    expect(backup).toContain("'compose'")
    expect(backup).toContain("'exec'")
    expect(backup).not.toContain('HYDRA_BACKUP_DSN')
  })

  it('does not use the development HBA or environment contract', async () => {
    const production = await readProjectFile('infra/identity/compose.production.yaml')
    const staging = await readProjectFile('infra/identity/compose.staging.yaml')
    expect(production).toContain('./postgres.production.pg_hba.conf')
    expect(staging).toContain('./postgres.staging.pg_hba.conf')
    expect(production).not.toContain('infra/identity/.env.example')
    expect(staging).not.toContain('infra/identity/.env.example')
  })

  it('renders only a narrow private Token Hook bridge', () => {
    const script = path.join(projectRoot, 'scripts/identity/render-token-hook-nginx.mjs')
    const valid = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        IDENTITY_HOST_GATEWAY_IP: '172.17.0.1',
        IDENTITY_HOOK_SUBNET: '172.30.40.0/29',
      },
    })
    expect(valid.status).toBe(0)
    expect(valid.stdout).toContain('listen 172.17.0.1:5175;')
    expect(valid.stdout).toContain('allow 172.30.40.0/29;')
    for (const [address, subnet] of [
      ['8.8.8.8', '8.8.8.0/29'],
      ['172.17.0.1', '8.8.8.0/29'],
      ['172.30.40.1', '172.30.0.0/16'],
      ['172.17.0.1', '172.30.40.1/29'],
    ]) {
      const rejected = spawnSync(process.execPath, [script], {
        encoding: 'utf8',
        env: { ...process.env, IDENTITY_HOST_GATEWAY_IP: address, IDENTITY_HOOK_SUBNET: subnet },
      })
      expect(rejected.status).not.toBe(0)
      expect(rejected.stdout).toBe('')
    }
  })

  it('rejects an enabled identity runtime before any preflight action', () => {
    const script = path.join(projectRoot, 'scripts/identity/production-preflight.mjs')
    const result = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: { ...process.env, OIDC_ENABLED: 'true' },
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('OIDC_ENABLED must remain false during pre-release')
    expect(result.stdout).toBe('')
  })

  it('also rejects OIDC enablement hidden inside the private env file', async () => {
    const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ss-auth-003-preflight-')))
    try {
      const envFile = path.join(temporary, 'production.env')
      await writeFile(envFile, 'OIDC_ENABLED=true\n', { mode: 0o600 })
      const env = { ...process.env, IDENTITY_ENV_FILE: envFile }
      delete env.OIDC_ENABLED
      const result = spawnSync(process.execPath, [path.join(projectRoot, 'scripts/identity/production-preflight.mjs')], {
        encoding: 'utf8',
        env,
      })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('OIDC_ENABLED must remain false during pre-release')
      expect(result.stdout).toBe('')
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  })

  it('creates and re-verifies one manifest-bound dual-database backup set', async () => {
    const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ss-auth-003-backup-')))
    try {
      const bin = path.join(temporary, 'bin')
      const backupRoot = path.join(temporary, 'backups')
      await mkdir(bin, { mode: 0o700 })
      await mkdir(backupRoot, { mode: 0o700 })
      const sqlite = path.join(bin, 'sqlite3')
      const docker = path.join(bin, 'docker')
      const pgRestore = path.join(bin, 'pg_restore')
      await writeFile(sqlite, `#!/usr/bin/env node
import { copyFileSync } from 'node:fs'
const command = process.argv[3] || ''
if (command.startsWith('.backup ')) {
  const target = command.slice(9).replace(/^'|'$/g, '').replaceAll("''", "'")
  copyFileSync(process.argv[2], target)
} else if (command === 'PRAGMA integrity_check;') process.stdout.write('ok\\n')
else process.exit(2)
`)
      await writeFile(docker, '#!/usr/bin/env node\nprocess.stdout.write("fixture-postgres-archive")\n')
      await writeFile(pgRestore, '#!/usr/bin/env node\nprocess.exit(0)\n')
      await Promise.all([sqlite, docker, pgRestore].map((file) => chmod(file, 0o700)))

      const database = path.join(temporary, 'starstack.sqlite')
      const compose = path.join(temporary, 'compose.production.yaml')
      const envFile = path.join(temporary, 'production.env')
      await writeFile(database, 'fixture-sqlite', { mode: 0o600 })
      await writeFile(compose, 'services: {}\n', { mode: 0o644 })
      await writeFile(envFile, 'HYDRA_POSTGRES_PASSWORD=not-logged\n', { mode: 0o600 })
      const password = 'p'.repeat(48)
      const commandEnv = {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        IDENTITY_BACKUP_CONFIRM: 'CREATE_VERIFIED_BACKUP',
        IDENTITY_ENVIRONMENT: 'production',
        IDENTITY_BACKUP_DIR: backupRoot,
        STARSTACK_DB_PATH: database,
        IDENTITY_COMPOSE_FILE: compose,
        IDENTITY_ENV_FILE: envFile,
        HYDRA_POSTGRES_PASSWORD: password,
      }
      const created = spawnSync(process.execPath, [path.join(projectRoot, 'scripts/identity/production-backup.mjs')], {
        cwd: projectRoot,
        encoding: 'utf8',
        env: commandEnv,
      })
      expect(created.status).toBe(0)
      expect(`${created.stdout}${created.stderr}`).not.toContain(password)
      const sets = await readdir(backupRoot)
      expect(sets).toHaveLength(1)
      const backupSet = path.join(backupRoot, sets[0])
      const verified = spawnSync(process.execPath, [path.join(projectRoot, 'scripts/identity/production-backup-verify.mjs')], {
        cwd: projectRoot,
        encoding: 'utf8',
        env: { ...commandEnv, IDENTITY_BACKUP_SET: backupSet },
      })
      expect(verified.status).toBe(0)
      await writeFile(path.join(backupSet, 'hydra.dump'), 'tampered')
      const rejected = spawnSync(process.execPath, [path.join(projectRoot, 'scripts/identity/production-backup-verify.mjs')], {
        cwd: projectRoot,
        encoding: 'utf8',
        env: { ...commandEnv, IDENTITY_BACKUP_SET: backupSet },
      })
      expect(rejected.status).not.toBe(0)
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  })
})
