#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  realpath,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'

const requireValue = (name) => {
  const value = process.env[name]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`)
  return value.trim()
}
const run = (command, args, env = process.env) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env })
  let output = ''
  let errors = ''
  child.stdout.on('data', (chunk) => { output += chunk.toString() })
  child.stderr.on('data', (chunk) => { errors += chunk.toString() })
  child.once('error', reject)
  child.once('exit', (code) => code === 0
    ? resolve(output)
    : reject(new Error(`${command} failed: ${errors.slice(0, 300)}`)))
})
const runToFile = async (command, args, target, env = process.env) => {
  const output = await open(target, 'wx', 0o600)
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['ignore', output.fd, 'pipe'], env })
      let errors = ''
      child.stderr.on('data', (chunk) => { errors += chunk.toString() })
      child.once('error', reject)
      child.once('exit', (code) => code === 0
        ? resolve()
        : reject(new Error(`${command} failed: ${errors.slice(0, 300)}`)))
    })
    await output.sync()
  } finally {
    await output.close()
  }
}
const digest = async (file) => createHash('sha256').update(await readFile(file)).digest('hex')
const assertSafeBackupRoot = async (value) => {
  const resolved = path.resolve(value)
  if (['/', path.parse(resolved).root, process.cwd(), path.dirname(process.cwd())].includes(resolved)) {
    throw new Error('IDENTITY_BACKUP_DIR is too broad')
  }
  const info = await lstat(resolved)
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
    throw new Error('IDENTITY_BACKUP_DIR must be an existing private directory')
  }
  if (await realpath(resolved) !== resolved) throw new Error('IDENTITY_BACKUP_DIR must not traverse symbolic links')
  return resolved
}
if (process.env.IDENTITY_BACKUP_CONFIRM !== 'CREATE_VERIFIED_BACKUP') {
  throw new Error('Set IDENTITY_BACKUP_CONFIRM=CREATE_VERIFIED_BACKUP')
}
const backupRoot = await assertSafeBackupRoot(requireValue('IDENTITY_BACKUP_DIR'))
const sqliteSource = path.resolve(requireValue('STARSTACK_DB_PATH'))
const sqliteSourceInfo = await lstat(sqliteSource)
if (!sqliteSourceInfo.isFile() || sqliteSourceInfo.isSymbolicLink() || sqliteSourceInfo.nlink !== 1
  || (sqliteSourceInfo.mode & 0o007) !== 0 || await realpath(sqliteSource) !== sqliteSource) {
  throw new Error('STARSTACK_DB_PATH must be a single-link real database file')
}
const environment = requireValue('IDENTITY_ENVIRONMENT')
if (!['production', 'staging'].includes(environment)) throw new Error('IDENTITY_ENVIRONMENT must be production or staging')
const postgres = environment === 'production'
  ? { user: 'hydra', database: 'hydra' }
  : { user: 'hydra_staging', database: 'hydra_staging' }
const composeFile = path.resolve(requireValue('IDENTITY_COMPOSE_FILE'))
if (path.basename(composeFile) !== `compose.${environment}.yaml`) {
  throw new Error('IDENTITY_COMPOSE_FILE does not match IDENTITY_ENVIRONMENT')
}
const envFile = path.resolve(requireValue('IDENTITY_ENV_FILE'))
for (const [file, label] of [[composeFile, 'Compose file'], [envFile, 'identity environment file']]) {
  const info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || await realpath(file) !== file) {
    throw new Error(`${label} must be a single-link real file`)
  }
  const mode = info.mode & 0o777
  if (file === envFile ? ![0o600, 0o640].includes(mode) : ![0o600, 0o640, 0o644].includes(mode)) {
    throw new Error(`${label} has unsafe permissions`)
  }
}
const postgresPassword = requireValue('HYDRA_POSTGRES_PASSWORD')
if (Buffer.byteLength(postgresPassword, 'utf8') < 32) throw new Error('HYDRA_POSTGRES_PASSWORD is too short')
const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-').replace('T', '_').replace('Z', '')
const stage = path.join(backupRoot, `.starstack-identity-backup-${randomUUID()}`)
const target = path.join(backupRoot, `starstack-identity-${timestamp}`)
await mkdir(stage, { mode: 0o700 })

try {
  const sqliteBackup = path.join(stage, 'starstack.sqlite')
  const hydraBackup = path.join(stage, 'hydra.dump')
  await run('sqlite3', [sqliteSource, `.backup '${sqliteBackup.replaceAll("'", "''")}'`])
  const integrity = await run('sqlite3', [sqliteBackup, 'PRAGMA integrity_check;'])
  if (integrity.trim() !== 'ok') throw new Error('SQLite backup integrity check failed')
  await runToFile('docker', [
    'compose', '--env-file', envFile, '-f', composeFile,
    'exec', '-T', '-e', 'PGPASSWORD', 'postgres',
    'pg_dump', '--format=custom', '--no-owner', '--no-privileges',
    '--username', postgres.user, '--dbname', postgres.database,
  ], hydraBackup, {
    ...process.env,
    PGPASSWORD: postgresPassword,
  })
  await run('pg_restore', ['--list', hydraBackup])
  await chmod(sqliteBackup, 0o600)
  await chmod(hydraBackup, 0o600)
  const [sqliteInfo, hydraInfo] = await Promise.all([stat(sqliteBackup), stat(hydraBackup)])
  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    source: {
      starstackDatabase: path.basename(sqliteSource),
      hydraRuntime: `starstack-identity-${environment}`,
      hydraDatabase: postgres.database,
    },
    files: {
      'starstack.sqlite': { bytes: sqliteInfo.size, sha256: await digest(sqliteBackup) },
      'hydra.dump': { bytes: hydraInfo.size, sha256: await digest(hydraBackup) },
    },
  }
  const manifestPath = path.join(stage, 'manifest.json')
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  await rename(stage, target)
  console.log(JSON.stringify({ ok: true, backup: path.basename(target), manifest: 'manifest.json' }))
} catch (error) {
  await rm(stage, { recursive: true, force: true })
  throw error
}
