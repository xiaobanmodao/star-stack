import { randomBytes } from 'node:crypto'
import {
  access,
  chmod,
  mkdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
export const LOCAL_IDENTITY_PROJECT_ROOT = path.resolve(scriptDirectory, '../..')
export const LOCAL_IDENTITY_RUNTIME_ROOT = path.join(
  LOCAL_IDENTITY_PROJECT_ROOT,
  '.identity-runtime',
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
  const resolved = value
    ? path.resolve(value)
    : LOCAL_IDENTITY_CREDENTIALS_PATH
  if (resolved !== LOCAL_IDENTITY_CREDENTIALS_PATH) {
    throw new Error(
      'The shared Hydra test database must use the canonical StarStack credentials file '
      + `${LOCAL_IDENTITY_CREDENTIALS_PATH}`,
    )
  }
  return resolved
}

export const assertCanonicalLocalIdentityStarStackDatabasePath = (value) => {
  const resolved = value
    ? path.resolve(value)
    : LOCAL_IDENTITY_STARSTACK_DB_PATH
  if (resolved !== LOCAL_IDENTITY_STARSTACK_DB_PATH) {
    throw new Error(
      'The shared Hydra test database must use the canonical StarStack fixture database '
      + `${LOCAL_IDENTITY_STARSTACK_DB_PATH}`,
    )
  }
  return resolved
}

export const loadLocalIdentityCredentials = async (credentialsPath) => {
  assertCanonicalLocalIdentityCredentialsPath(credentialsPath)
  await mkdir(LOCAL_IDENTITY_RUNTIME_ROOT, { recursive: true, mode: 0o700 })
  await chmod(LOCAL_IDENTITY_RUNTIME_ROOT, 0o700)
  try {
    await access(LOCAL_IDENTITY_CREDENTIALS_STAGING_PATH)
    throw new Error(
      'The local identity credential/database rotation is incomplete; rerun the protocol gate',
    )
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  let credentials
  try {
    credentials = JSON.parse(await readFile(credentialsPath, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    credentials = createCredentials()
    await writeFile(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
  }
  await chmod(credentialsPath, 0o600)
  return validateCredentials(credentials)
}

export const stageLocalIdentityCredentialsRotation = async (credentialsPath) => {
  assertCanonicalLocalIdentityCredentialsPath(credentialsPath)
  await mkdir(LOCAL_IDENTITY_RUNTIME_ROOT, { recursive: true, mode: 0o700 })
  await chmod(LOCAL_IDENTITY_RUNTIME_ROOT, 0o700)
  const credentials = validateCredentials(createCredentials())
  const stagingPath = LOCAL_IDENTITY_CREDENTIALS_STAGING_PATH
  await writeFile(stagingPath, `${JSON.stringify(credentials, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'w',
    mode: 0o600,
  })
  await chmod(stagingPath, 0o600)
  let committed = false
  return Object.freeze({
    credentials,
    async commit() {
      if (committed) throw new Error('Local identity credentials rotation is already committed')
      await rename(stagingPath, credentialsPath)
      await chmod(credentialsPath, 0o600)
      committed = true
    },
  })
}
