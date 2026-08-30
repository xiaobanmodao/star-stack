#!/usr/bin/env node
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCredentialEnvironment } from './migrate-pm2-to-systemd-credentials.mjs'

const APPLICATION_ROOT = '/opt/star-stack'
const NODE_BINARY = '/usr/bin/node'
const SERVER_ENTRYPOINT = '/opt/star-stack/server/index.js'
const currentUid = typeof process.getuid === 'function' ? process.getuid() : undefined

const isExpectedOwner = (stat) => currentUid === undefined
  || stat.uid === 0
  || stat.uid === currentUid

const assertCredentialStat = (stat, name) => {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
    || !isExpectedOwner(stat) || ![0o400, 0o600].includes(stat.mode & 0o777)) {
    throw new Error(`Systemd credential metadata is unsafe: ${name}`)
  }
}

const readCredential = async (directory, name, maxBytes) => {
  const filePath = path.join(directory, name)
  const before = await lstat(filePath)
  assertCredentialStat(before, name)
  if (await realpath(filePath) !== filePath) throw new Error(`Systemd credential path is unsafe: ${name}`)
  if (before.size < 1 || before.size > maxBytes) throw new Error(`Systemd credential size is invalid: ${name}`)
  const noFollow = constants.O_NOFOLLOW || 0
  const handle = await open(filePath, constants.O_RDONLY | noFollow)
  try {
    const opened = await handle.stat()
    assertCredentialStat(opened, name)
    if (opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error(`Systemd credential changed while opening: ${name}`)
    }
    const value = await handle.readFile('utf8')
    const after = await lstat(filePath)
    assertCredentialStat(after, name)
    if (after.dev !== opened.dev || after.ino !== opened.ino) {
      throw new Error(`Systemd credential changed while reading: ${name}`)
    }
    return value
  } finally {
    await handle.close()
  }
}

const assertSecret = (value, label) => {
  if (Buffer.byteLength(value, 'utf8') < 32 || value.includes('\0') || /[\r\n]/.test(value)) {
    throw new Error(`${label} credential is invalid`)
  }
  return value
}

export const loadSystemdServerEnvironment = async (env = process.env) => {
  const credentialsDirectory = env.CREDENTIALS_DIRECTORY
  if (typeof credentialsDirectory !== 'string' || !path.isAbsolute(credentialsDirectory)) {
    throw new Error('CREDENTIALS_DIRECTORY must be an absolute systemd credential directory')
  }
  const directoryStat = await lstat(credentialsDirectory)
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()
    || !isExpectedOwner(directoryStat) || (directoryStat.mode & 0o022) !== 0
    || await realpath(credentialsDirectory) !== path.resolve(credentialsDirectory)) {
    throw new Error('CREDENTIALS_DIRECTORY must be a real directory')
  }
  const [applicationText, tokenHookText, logoutBrokerText] = await Promise.all([
    readCredential(credentialsDirectory, 'starstack-environment', 128 * 1024),
    readCredential(credentialsDirectory, 'oidc-token-hook-secret', 4096),
    readCredential(credentialsDirectory, 'oidc-logout-broker-secret', 4096),
  ])
  const application = parseCredentialEnvironment(applicationText)
  const tokenHookSecret = assertSecret(tokenHookText, 'Token hook')
  const logoutBrokerSecret = assertSecret(logoutBrokerText, 'Logout broker')
  if (tokenHookSecret === logoutBrokerSecret) throw new Error('Identity credentials must be distinct')
  return Object.freeze({
    ...application,
    PATH: application.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    OIDC_TOKEN_HOOK_SECRET: tokenHookSecret,
    OIDC_LOGOUT_BROKER_SECRET: logoutBrokerSecret,
  })
}

export const launchSystemdServer = async () => {
  if (process.cwd() !== APPLICATION_ROOT) throw new Error('StarStack systemd working directory is invalid')
  if (typeof process.execve !== 'function') {
    throw new Error('Production Node runtime must provide process.execve')
  }
  const environment = await loadSystemdServerEnvironment()
  process.execve(NODE_BINARY, [NODE_BINARY, SERVER_ENTRYPOINT], environment)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  launchSystemdServer().catch(() => {
    process.stderr.write('[starstack-systemd] launcher failed closed; no credential values were printed\n')
    process.exitCode = 1
  })
}
