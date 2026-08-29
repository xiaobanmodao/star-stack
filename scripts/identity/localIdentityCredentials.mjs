import { createHash, randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOCAL_HYDRA_TEST_DSN } from './localHydraDsn.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
export const LOCAL_IDENTITY_PROJECT_ROOT = path.resolve(scriptDirectory, '../..')
export const LOCAL_IDENTITY_PROJECT_RUNTIME_ROOT = path.join(
  LOCAL_IDENTITY_PROJECT_ROOT,
  '.identity-runtime',
)

// The PostgreSQL fixture DSN is shared by every checkout on this host. Its
// credentials, fixture SQLite database and lock therefore live in one
// checkout-independent, DSN-namespaced state directory. Keeping only the
// Hydra binary and disposable logs in the checkout avoids giving two
// worktrees independent "canonical" secrets for the same PostgreSQL data.
export const LOCAL_IDENTITY_DSN_FINGERPRINT = createHash('sha256')
  .update(LOCAL_HYDRA_TEST_DSN)
  .digest('hex')
  .slice(0, 16)
export const LOCAL_IDENTITY_RUNTIME_ROOT = path.join(
  homedir(),
  '.local',
  'state',
  'starstack',
  'identity',
  `hydra-test-${LOCAL_IDENTITY_DSN_FINGERPRINT}`,
)
export const LOCAL_IDENTITY_CREDENTIALS_PATH = path.join(
  LOCAL_IDENTITY_RUNTIME_ROOT,
  'ss-auth-002-local-credentials.json',
)
export const LOCAL_IDENTITY_CREDENTIALS_STAGING_PATH = path.join(
  LOCAL_IDENTITY_RUNTIME_ROOT,
  '.credentials-rotation.pending.json',
)
export const LOCAL_IDENTITY_STARSTACK_DB_PATH = path.join(
  LOCAL_IDENTITY_RUNTIME_ROOT,
  'ss-auth-002-starstack.sqlite',
)
export const LOCAL_IDENTITY_STATE_MARKER_PATH = path.join(
  LOCAL_IDENTITY_RUNTIME_ROOT,
  'state-identity.json',
)

const stateIdentity = Object.freeze({
  version: 1,
  dsnFingerprint: LOCAL_IDENTITY_DSN_FINGERPRINT,
  database: 'hydra_test',
  endpoint: '127.0.0.1:55432',
})

const currentUid = typeof process.getuid === 'function' ? process.getuid() : undefined
const modeBits = (stat) => stat.mode & 0o777
const sameInode = (left, right) => left.dev === right.dev && left.ino === right.ino

const assertOwnedByCurrentUser = (stat, description) => {
  if (currentUid !== undefined && stat.uid !== currentUid) {
    throw new Error(`${description} must be owned by the current operating-system user`)
  }
}

const assertSecureDirectoryStat = (stat, description) => {
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${description} must be a real secure directory, not a symbolic link`)
  }
  assertOwnedByCurrentUser(stat, description)
  if (modeBits(stat) !== 0o700) {
    throw new Error(`${description} permissions must be exactly 0700`)
  }
}

const assertSecureFileStat = (stat, description) => {
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${description} must be a regular secure file, not a symbolic link`)
  }
  assertOwnedByCurrentUser(stat, description)
  if (modeBits(stat) !== 0o600) {
    throw new Error(`${description} permissions must be exactly 0600`)
  }
}

const assertLexicalRealPath = async (target, description) => {
  const resolved = path.resolve(target)
  if (await realpath(target) !== resolved) {
    throw new Error(`${description} real path changed or contains a symbolic link`)
  }
}

const ensureSecureDirectory = async (directory) => {
  const resolved = path.resolve(directory)
  await mkdir(resolved, { recursive: true, mode: 0o700 })
  const stat = await lstat(resolved)
  assertSecureDirectoryStat(stat, 'Local identity state directory')
  await assertLexicalRealPath(resolved, 'Local identity state directory')
  return resolved
}

const openSecureStateFile = async (filePath) => {
  const resolved = path.resolve(filePath)
  const before = await lstat(resolved)
  assertSecureFileStat(before, 'Local identity state file')
  await assertLexicalRealPath(resolved, 'Local identity state file')
  const noFollow = constants.O_NOFOLLOW || 0
  const handle = await open(resolved, constants.O_RDONLY | noFollow)
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    await handle.close()
  }
  try {
    const opened = await handle.stat()
    assertSecureFileStat(opened, 'Opened local identity state file')
    if (!sameInode(before, opened)) {
      throw new Error('Local identity state file identity changed while opening')
    }
    const verifyPath = async () => {
      const current = await lstat(resolved)
      assertSecureFileStat(current, 'Local identity state file')
      await assertLexicalRealPath(resolved, 'Local identity state file')
      if (!sameInode(opened, current)) {
        throw new Error('Local identity state file was replaced after its secure open')
      }
      return current
    }
    return Object.freeze({
      path: resolved,
      stat: opened,
      close,
      verifyPath,
      async readJsonAndVerify() {
        const text = await handle.readFile('utf8')
        await verifyPath()
        return JSON.parse(text)
      },
    })
  } catch (error) {
    await close()
    throw error
  }
}

const createSecureJsonFile = async (filePath, value) => {
  const resolved = path.resolve(filePath)
  const noFollow = constants.O_NOFOLLOW || 0
  const handle = await open(
    resolved,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
    0o600,
  )
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    await handle.close()
  }
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
    const opened = await handle.stat()
    assertSecureFileStat(opened, 'Created local identity state file')
    const verifyPath = async () => {
      const current = await lstat(resolved)
      assertSecureFileStat(current, 'Local identity state file')
      await assertLexicalRealPath(resolved, 'Local identity state file')
      if (!sameInode(opened, current)) {
        throw new Error('Local identity state file was replaced after creation')
      }
      return current
    }
    await verifyPath()
    return Object.freeze({
      path: resolved,
      stat: opened,
      close,
      verifyPath,
      async readJsonAndVerify() {
        await verifyPath()
        return value
      },
    })
  } catch (error) {
    await close().catch(() => {})
    throw error
  }
}

const closeAndRethrow = async (opened, error) => {
  await opened.close().catch(() => {})
  throw error
}

const readSecureJson = async (filePath) => {
  const opened = await openSecureStateFile(filePath)
  try {
    return await opened.readJsonAndVerify()
  } finally {
    await opened.close()
  }
}

const ensureCanonicalStateIdentity = async () => {
  await ensureSecureDirectory(LOCAL_IDENTITY_RUNTIME_ROOT)
  let marker
  try {
    marker = await openSecureStateFile(LOCAL_IDENTITY_STATE_MARKER_PATH)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    try {
      marker = await createSecureJsonFile(LOCAL_IDENTITY_STATE_MARKER_PATH, stateIdentity)
    } catch (createError) {
      if (createError?.code !== 'EEXIST') throw createError
      marker = await openSecureStateFile(LOCAL_IDENTITY_STATE_MARKER_PATH)
    }
  }
  try {
    const actual = await marker.readJsonAndVerify()
    if (JSON.stringify(actual) !== JSON.stringify(stateIdentity)) {
      throw new Error('Local identity state marker does not match the frozen Hydra test DSN')
    }
  } finally {
    await marker.close()
  }
}

export const ensureCanonicalLocalIdentityState = ensureCanonicalStateIdentity

const createCredentials = () => ({
  fixtureId: 'oidc-fixture-user',
  fixturePassword: randomBytes(32).toString('base64url'),
  clientSecret: randomBytes(48).toString('base64url'),
  tokenHookSecret: randomBytes(48).toString('base64url'),
  logoutBrokerSecret: randomBytes(48).toString('base64url'),
  systemSecret: randomBytes(48).toString('base64url'),
  cookieSecret: randomBytes(48).toString('base64url'),
})

const REQUIRED_CREDENTIALS = Object.freeze({
  fixtureId: 3,
  fixturePassword: 32,
  clientSecret: 32,
  tokenHookSecret: 32,
  logoutBrokerSecret: 32,
  systemSecret: 32,
  cookieSecret: 32,
})

const validateCredentials = (credentials) => {
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
    throw new Error('Local identity credentials must be a JSON object')
  }
  for (const [name, minimumLength] of Object.entries(REQUIRED_CREDENTIALS)) {
    const value = credentials[name]
    if (typeof value !== 'string' || value.length < minimumLength) {
      throw new Error(`Local identity credential ${name} is missing or too short`)
    }
  }
  return Object.freeze(credentials)
}

export const assertCanonicalLocalIdentityCredentialsPath = (value) => {
  const resolved = value ? path.resolve(value) : LOCAL_IDENTITY_CREDENTIALS_PATH
  if (resolved !== LOCAL_IDENTITY_CREDENTIALS_PATH) {
    throw new Error(
      'The shared Hydra test database must use the machine-canonical StarStack credentials file '
      + `${LOCAL_IDENTITY_CREDENTIALS_PATH}`,
    )
  }
  return resolved
}

export const assertCanonicalLocalIdentityStarStackDatabasePath = (value) => {
  const resolved = value ? path.resolve(value) : LOCAL_IDENTITY_STARSTACK_DB_PATH
  if (resolved !== LOCAL_IDENTITY_STARSTACK_DB_PATH) {
    throw new Error(
      'The shared Hydra test database must use the machine-canonical StarStack fixture database '
      + `${LOCAL_IDENTITY_STARSTACK_DB_PATH}`,
    )
  }
  return resolved
}

export const loadLocalIdentityCredentials = async (credentialsPath) => {
  assertCanonicalLocalIdentityCredentialsPath(credentialsPath)
  await ensureCanonicalStateIdentity()
  try {
    await lstat(LOCAL_IDENTITY_CREDENTIALS_STAGING_PATH)
    throw new Error(
      'The local identity credential/database rotation is incomplete; rerun the protocol gate',
    )
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  let credentials
  try {
    credentials = await readSecureJson(credentialsPath)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(
        'Machine-canonical local identity credentials are missing; run the protocol gate first',
      )
    }
    throw error
  }
  return validateCredentials(credentials)
}

const stageCredentialsRotationAtPaths = async ({
  runtimeRoot,
  credentialsPath,
  stagingPath,
  canonical = false,
}) => {
  await ensureSecureDirectory(runtimeRoot)
  if (canonical) await ensureCanonicalStateIdentity()

  // A destination may be absent on first setup. If it exists, validate it now;
  // rename(2) will replace the final directory entry atomically without ever
  // following that destination as a symlink.
  try {
    const destination = await openSecureStateFile(credentialsPath)
    await destination.close()
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  let staged
  let credentials
  try {
    staged = await openSecureStateFile(stagingPath)
    credentials = validateCredentials(await staged.readJsonAndVerify())
  } catch (error) {
    if (staged) await staged.close().catch(() => {})
    if (error?.code !== 'ENOENT') throw error
    credentials = validateCredentials(createCredentials())
    try {
      staged = await createSecureJsonFile(stagingPath, credentials)
    } catch (createError) {
      if (createError?.code !== 'EEXIST') throw createError
      staged = await openSecureStateFile(stagingPath)
      try {
        credentials = validateCredentials(await staged.readJsonAndVerify())
      } catch (readError) {
        await closeAndRethrow(staged, readError)
      }
    }
  }

  let finalized = false
  return Object.freeze({
    credentials,
    async commit() {
      if (finalized) throw new Error('Local identity credentials rotation is already finalized')
      await ensureSecureDirectory(runtimeRoot)
      await staged.verifyPath()
      try {
        const destination = await openSecureStateFile(credentialsPath)
        await destination.close()
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      await rename(stagingPath, credentialsPath)
      const installed = await lstat(credentialsPath)
      assertSecureFileStat(installed, 'Installed local identity credentials')
      if (!sameInode(installed, staged.stat)) {
        throw new Error('Local identity credentials staging identity changed during commit')
      }
      finalized = true
      await staged.close()
    },
    async abort() {
      if (finalized) return false
      finalized = true
      try {
        await staged.verifyPath()
        await rm(stagingPath)
        await staged.close()
        return true
      } catch {
        await staged.close().catch(() => {})
        return false
      }
    },
  })
}

export const stageLocalIdentityCredentialsRotation = async (credentialsPath) => {
  assertCanonicalLocalIdentityCredentialsPath(credentialsPath)
  return stageCredentialsRotationAtPaths({
    runtimeRoot: LOCAL_IDENTITY_RUNTIME_ROOT,
    credentialsPath: LOCAL_IDENTITY_CREDENTIALS_PATH,
    stagingPath: LOCAL_IDENTITY_CREDENTIALS_STAGING_PATH,
    canonical: true,
  })
}

export const __ensureSecureLocalIdentityDirectoryForTest = ensureSecureDirectory
export const __openSecureLocalIdentityFileForTest = openSecureStateFile
export const __stageLocalIdentityCredentialsRotationForTest = (paths) => (
  stageCredentialsRotationAtPaths({ ...paths, canonical: false })
)
