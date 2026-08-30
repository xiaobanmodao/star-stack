#!/usr/bin/env node
import { constants } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
} from 'node:fs/promises'
import path from 'node:path'
import { parseArgs, TextDecoder } from 'node:util'
import { fileURLToPath } from 'node:url'

const IDENTITY_SECRET_KEYS = Object.freeze([
  'OIDC_TOKEN_HOOK_SECRET',
  'OIDC_LOGOUT_BROKER_SECRET',
])
const EXACT_APPLICATION_KEYS = new Set([
  'NODE_ENV', 'PORT', 'HOST', 'TRUST_PROXY_HOPS', 'ALLOWED_ORIGINS',
  'TURNSTILE_HOSTNAMES', 'TURNSTILE_SECRET_KEY',
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM',
  'JUDGE_MEMORY_LIMIT_KB', 'JUDGE_CONCURRENCY', 'JUDGE_CACHE_MAX_AGE_MS',
  'JUDGE_CACHE_MAX_BYTES', 'JUDGE_CACHE_MAX_FILES', 'JUDGE_DEBUG_SANDBOX',
  'GPP_PATH', 'PYTHON_PATH', 'JAVA_PATH', 'JAVAC_PATH', 'JAVA_HOME', 'MINGW_HOME',
  'DB_PATH', 'DISK_CHECK_PATH', 'BACKUP_DIR', 'BACKUP_FILE',
  'ADMIN_ID', 'ADMIN_NAME', 'ADMIN_PASSWORD',
  'OIDC_ENABLED', 'OIDC_ISSUER', 'OIDC_HYDRA_PUBLIC_URL', 'OIDC_HYDRA_ADMIN_URL',
  'PATH', 'LANG', 'LC_ALL', 'TZ',
])
const APPLICATION_KEY_PREFIXES = Object.freeze(['JWT_', 'WEBPUSH_', 'VAPID_', 'PUSH_'])
const KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/
const VAPID_KEY_PATTERN = /^[A-Za-z0-9_-]{32,256}$/
const utf8Decoder = new TextDecoder('utf-8', { fatal: true })

export const isApprovedApplicationKey = (key) => EXACT_APPLICATION_KEYS.has(key)
  || APPLICATION_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))

const assertCredentialSecret = (value, label) => {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') < 32
    || value.includes('\0') || /[\r\n]/.test(value)) {
    throw new Error(`${label} secret must be one line containing at least 32 bytes`)
  }
  return value
}

const validateApplicationEnvironment = (environment) => {
  if (environment.NODE_ENV !== 'production') throw new Error('NODE_ENV must be production')
  if (environment.HOST !== '127.0.0.1') throw new Error('HOST must remain 127.0.0.1')
  if (environment.PORT !== '5174') throw new Error('PORT must remain 5174')
  if (!['true', 'false'].includes(environment.OIDC_ENABLED)) {
    throw new Error('OIDC_ENABLED must be an explicit true or false')
  }
  if (environment.OIDC_ENABLED === 'true') {
    if (environment.OIDC_ISSUER !== 'https://auth.xingzhan.cc'
      || environment.OIDC_HYDRA_PUBLIC_URL !== 'http://127.0.0.1:4444'
      || environment.OIDC_HYDRA_ADMIN_URL !== 'http://127.0.0.1:4445') {
      throw new Error('Enabled OIDC production origins must match the frozen contract')
    }
  }
  if (!VAPID_KEY_PATTERN.test(environment.VAPID_PUBLIC_KEY || '')
    || !VAPID_KEY_PATTERN.test(environment.VAPID_PRIVATE_KEY || '')) {
    throw new Error('VAPID public/private keys must both be preserved in the systemd credential')
  }
  return environment
}

export const parseCredentialEnvironment = (text) => {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 128 * 1024) {
    throw new Error('Systemd application environment credential is invalid')
  }
  let environment
  try { environment = JSON.parse(text) } catch {
    throw new Error('Systemd application environment credential must be strict JSON')
  }
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
    throw new Error('Systemd application environment credential must be one JSON object')
  }
  for (const [key, value] of Object.entries(environment)) {
    if (IDENTITY_SECRET_KEYS.includes(key)) {
      throw new Error('Identity secret keys must use dedicated systemd credentials')
    }
    if (!KEY_PATTERN.test(key) || !isApprovedApplicationKey(key)) {
      throw new Error(`Application environment key is not approved: ${key}`)
    }
    if (typeof value !== 'string' || value.includes('\0') || /[\r\n]/.test(value)) {
      throw new Error(`Application environment value is invalid: ${key}`)
    }
  }
  return validateApplicationEnvironment(environment)
}

export const buildSystemdCredentialPayloads = (sourceEnvironment) => {
  if (!sourceEnvironment || typeof sourceEnvironment !== 'object') {
    throw new Error('PM2 application environment is required')
  }
  const tokenHookSecret = assertCredentialSecret(
    sourceEnvironment.OIDC_TOKEN_HOOK_SECRET,
    'Token hook',
  )
  const logoutBrokerSecret = assertCredentialSecret(
    sourceEnvironment.OIDC_LOGOUT_BROKER_SECRET,
    'Logout broker',
  )
  if (tokenHookSecret === logoutBrokerSecret) {
    throw new Error('Identity credentials must be distinct and separate')
  }

  const application = {}
  for (const [key, rawValue] of Object.entries(sourceEnvironment)) {
    if (!KEY_PATTERN.test(key) || !isApprovedApplicationKey(key)) continue
    const value = String(rawValue)
    if (value.includes('\0') || /[\r\n]/.test(value)) {
      throw new Error(`Application environment value is invalid: ${key}`)
    }
    application[key] = value
  }
  application.NODE_ENV = application.NODE_ENV || 'production'
  application.HOST = application.HOST || '127.0.0.1'
  application.PORT = application.PORT || '5174'
  application.OIDC_ENABLED = application.OIDC_ENABLED || 'false'
  validateApplicationEnvironment(application)
  const environment = `${JSON.stringify(
    Object.fromEntries(Object.keys(application).sort().map((key) => [key, application[key]])),
    null,
    2,
  )}\n`
  parseCredentialEnvironment(environment)
  return Object.freeze({ environment, tokenHookSecret, logoutBrokerSecret })
}

const assertRootDirectory = async (directory, { create = false } = {}) => {
  const resolved = path.resolve(directory)
  if (create) await mkdir(resolved, { mode: 0o700 })
  const stat = await lstat(resolved)
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0
    || (stat.mode & 0o777) !== 0o700 || await realpath(resolved) !== resolved) {
    throw new Error(`${resolved} must be a root-owned real directory with mode 0700`)
  }
  return resolved
}

const writeCredential = async (target, value) => {
  const noFollow = constants.O_NOFOLLOW || 0
  const handle = await open(
    target,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
    0o400,
  )
  try {
    await handle.writeFile(value, 'utf8')
    await handle.sync()
    const stat = await handle.stat()
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== 0 || (stat.mode & 0o777) !== 0o400) {
      throw new Error('Created systemd credential has unsafe metadata')
    }
  } finally {
    await handle.close()
  }
}

export const readLegacyVapidKeys = async (
  filePath,
  { allowedUid = typeof process.getuid === 'function' ? process.getuid() : undefined } = {},
) => {
  const resolved = path.resolve(filePath)
  const before = await lstat(resolved)
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1
    || (allowedUid !== undefined && ![0, allowedUid].includes(before.uid))
    || (before.mode & 0o777) !== 0o600 || await realpath(resolved) !== resolved) {
    throw new Error('Legacy VAPID key file is unsafe')
  }
  const noFollow = constants.O_NOFOLLOW || 0
  const handle = await open(resolved, constants.O_RDONLY | noFollow)
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.nlink !== 1
      || opened.dev !== before.dev || opened.ino !== before.ino || opened.uid !== before.uid
      || (opened.mode & 0o777) !== 0o600 || opened.size < 1 || opened.size > 4096) {
      throw new Error('Legacy VAPID key file changed while opening')
    }
    const value = JSON.parse(await handle.readFile('utf8'))
    const after = await lstat(resolved)
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.nlink !== 1
      || !VAPID_KEY_PATTERN.test(value?.publicKey || '')
      || !VAPID_KEY_PATTERN.test(value?.privateKey || '')) {
      throw new Error('Legacy VAPID key file is invalid')
    }
    return Object.freeze({
      VAPID_PUBLIC_KEY: value.publicKey,
      VAPID_PRIVATE_KEY: value.privateKey,
    })
  } finally {
    await handle.close()
  }
}

const readPm2ProcessEnvironment = async (pid) => {
  if (!Number.isSafeInteger(pid) || pid < 2) throw new Error('A valid PM2 application PID is required')
  const proc = `/proc/${pid}`
  const beforeProc = await lstat(proc)
  if (!beforeProc.isDirectory() || beforeProc.uid === 0) {
    throw new Error('PM2 application must run as a dedicated non-root service account')
  }
  const readStartTime = async () => {
    const text = await readFile(path.join(proc, 'stat'), 'utf8')
    const closing = text.lastIndexOf(')')
    const fields = closing >= 0 ? text.slice(closing + 2).trim().split(/\s+/) : []
    if (!/^\d+$/.test(fields[19] || '')) throw new Error('PM2 process identity is invalid')
    return fields[19]
  }
  const startTime = await readStartTime()
  const [cwd, command, encoded] = await Promise.all([
    readlink(path.join(proc, 'cwd')),
    readFile(path.join(proc, 'cmdline')),
    readFile(path.join(proc, 'environ')),
  ])
  const afterProc = await lstat(proc)
  if (afterProc.dev !== beforeProc.dev || afterProc.ino !== beforeProc.ino
    || afterProc.uid !== beforeProc.uid || await readStartTime() !== startTime) {
    throw new Error('PM2 process changed while reading its environment')
  }
  if (path.resolve(cwd) !== '/opt/star-stack'
    || !utf8Decoder.decode(command).split('\0').some((item) => /server\/index\.js$/.test(item))) {
    throw new Error('PID is not the /opt/star-stack API process')
  }
  const environment = {}
  for (const entry of utf8Decoder.decode(encoded).split('\0')) {
    if (!entry) continue
    const separator = entry.indexOf('=')
    if (separator <= 0) continue
    environment[entry.slice(0, separator)] = entry.slice(separator + 1)
  }
  return { environment, uid: beforeProc.uid }
}

export const migratePm2Environment = async ({ pid, root = '/etc/starstack' }) => {
  if (process.platform !== 'linux' || typeof process.getuid !== 'function' || process.getuid() !== 0) {
    throw new Error('PM2 credential migration must run as root on the production Linux host')
  }
  const secureRoot = await assertRootDirectory(root)
  const target = path.join(secureRoot, 'server')
  try {
    await lstat(target)
    throw new Error('Systemd credential target already exists; refusing to overwrite it')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const source = await readPm2ProcessEnvironment(pid)
  const hasVapidPublic = Boolean(source.environment.VAPID_PUBLIC_KEY)
  const hasVapidPrivate = Boolean(source.environment.VAPID_PRIVATE_KEY)
  if (hasVapidPublic !== hasVapidPrivate) {
    throw new Error('PM2 process contains only half of the VAPID key pair')
  }
  const legacyVapid = hasVapidPublic
    ? {}
    : await readLegacyVapidKeys('/opt/star-stack/server/.vapid.json', { allowedUid: source.uid })
  const sourceEnvironment = { ...source.environment, ...legacyVapid }
  const payloads = buildSystemdCredentialPayloads(sourceEnvironment)
  const staging = path.join(secureRoot, `.server-migration-${process.pid}`)
  await mkdir(staging, { mode: 0o700 })
  try {
    await assertRootDirectory(staging)
    await Promise.all([
      writeCredential(path.join(staging, 'starstack-environment'), payloads.environment),
      writeCredential(path.join(staging, 'oidc-token-hook-secret'), payloads.tokenHookSecret),
      writeCredential(path.join(staging, 'oidc-logout-broker-secret'), payloads.logoutBrokerSecret),
    ])
    await rename(staging, target)
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
  return {
    target,
    applicationKeys: Object.keys(parseCredentialEnvironment(payloads.environment)).length,
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  try {
    const { values } = parseArgs({
      options: { pid: { type: 'string' } },
      strict: true,
    })
    const pid = Number(values.pid)
    const result = await migratePm2Environment({ pid })
    process.stdout.write(`${JSON.stringify({ ok: true, target: result.target })}\n`)
  } catch {
    process.stderr.write('[systemd-migration] failed closed; no credential values were printed\n')
    process.exitCode = 1
  }
}
