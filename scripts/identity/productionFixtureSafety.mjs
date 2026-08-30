import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
} from 'node:fs/promises'
import path from 'node:path'

const currentUid = typeof process.getuid === 'function' ? process.getuid() : undefined
const modeBits = (stat) => stat.mode & 0o777
const sameInode = (left, right) => left.dev === right.dev && left.ino === right.ino
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const assertOwnedByCurrentUser = (stat, description) => {
  if (currentUid !== undefined && stat.uid !== currentUid) {
    throw new Error(`${description} has an unexpected owner`)
  }
}

const assertSecureDirectory = async (directory, description, expectedUid = currentUid) => {
  const resolved = path.resolve(directory)
  const stat = await lstat(resolved)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${description} must be a real directory`)
  }
  if (expectedUid !== undefined && stat.uid !== expectedUid) {
    throw new Error(`${description} has an unexpected owner`)
  }
  if (modeBits(stat) !== 0o700) throw new Error(`${description} permissions must be 0700`)
  if (await realpath(resolved) !== resolved) throw new Error(`${description} contains a symbolic link`)
  return resolved
}

const assertTrustedSharedLockDirectory = async (directory) => {
  const resolved = path.resolve(directory)
  const stat = await lstat(resolved)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Production fixture shared lock directory must be a real directory')
  }
  assertOwnedByCurrentUser(stat, 'Production fixture shared lock directory')
  const permissions = stat.mode & 0o1777
  if ((permissions & 0o022) !== 0 && (permissions & 0o1000) === 0) {
    throw new Error('Production fixture shared lock directory must use sticky write protection')
  }
  if (await realpath(resolved) !== resolved) {
    throw new Error('Production fixture shared lock directory contains a symbolic link')
  }
  return Object.freeze({ resolved, stat })
}

export const ensureProductionFixtureLockDirectory = async (
  sharedDirectory,
  expectedUid = currentUid,
) => {
  if (expectedUid !== undefined && (!Number.isSafeInteger(expectedUid) || expectedUid < 0)) {
    throw new Error('Production fixture lock directory owner is invalid')
  }
  const parentBefore = await assertTrustedSharedLockDirectory(sharedDirectory)
  const directory = path.join(parentBefore.resolved, 'starstack-identity')
  try {
    await mkdir(directory, { mode: 0o700 })
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
  }
  const resolved = await assertSecureDirectory(
    directory,
    'Production fixture private lock directory',
    expectedUid,
  )
  const parentAfter = await assertTrustedSharedLockDirectory(sharedDirectory)
  if (!sameInode(parentBefore.stat, parentAfter.stat)) {
    throw new Error('Production fixture shared lock directory changed during setup')
  }
  return resolved
}

const assertSecureFileStat = (stat, description) => {
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${description} must be a regular file`)
  }
  assertOwnedByCurrentUser(stat, description)
  if (modeBits(stat) !== 0o600) throw new Error(`${description} permissions must be 0600`)
  if (stat.nlink !== 1) throw new Error(`${description} must have exactly one link`)
}

const assertSecurePathIdentity = async (filePath, expected, description) => {
  const resolved = path.resolve(filePath)
  const current = await lstat(resolved)
  assertSecureFileStat(current, description)
  if (await realpath(resolved) !== resolved) throw new Error(`${description} contains a symbolic link`)
  if (expected && !sameInode(current, expected)) throw new Error(`${description} changed during use`)
  return current
}

const createSecureFile = async (filePath, text, description) => {
  const noFollow = constants.O_NOFOLLOW || 0
  const handle = await open(
    filePath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
    0o600,
  )
  try {
    await handle.writeFile(text, 'utf8')
    await handle.sync()
    const stat = await handle.stat()
    assertSecureFileStat(stat, description)
    await assertSecurePathIdentity(filePath, stat, description)
    return stat
  } catch (error) {
    await rm(filePath, { force: true }).catch(() => undefined)
    throw error
  } finally {
    await handle.close()
  }
}

const readSecureJson = async (filePath, description) => {
  const before = await assertSecurePathIdentity(filePath, null, description)
  const noFollow = constants.O_NOFOLLOW || 0
  const handle = await open(filePath, constants.O_RDONLY | noFollow)
  try {
    const opened = await handle.stat()
    assertSecureFileStat(opened, description)
    if (!sameInode(before, opened)) throw new Error(`${description} changed while opening`)
    const text = await handle.readFile({ encoding: 'utf8' })
    if (Buffer.byteLength(text, 'utf8') > 16 * 1024) throw new Error(`${description} is unexpectedly large`)
    await assertSecurePathIdentity(filePath, opened, description)
    return { value: JSON.parse(text), stat: opened }
  } finally {
    await handle.close()
  }
}

const writeSecureJson = (filePath, value, description) => createSecureFile(
  filePath,
  `${JSON.stringify(value, null, 2)}\n`,
  description,
)

const processExists = (pid) => {
  if (!Number.isSafeInteger(pid) || pid < 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

const createLockFile = async (filePath) => {
  const owner = Object.freeze({ pid: process.pid, token: randomUUID() })
  const stat = await writeSecureJson(filePath, owner, 'Production fixture lock')
  return Object.freeze({ owner, stat })
}

const readLockFile = async (filePath) => {
  const snapshot = await readSecureJson(filePath, 'Production fixture lock')
  const pid = Number(snapshot.value?.pid)
  const token = snapshot.value?.token
  if (!Number.isSafeInteger(pid) || pid < 1
    || typeof token !== 'string' || token.length < 8 || token.length > 128) {
    throw new Error('Production fixture lock owner is invalid')
  }
  return Object.freeze({ owner: Object.freeze({ pid, token }), stat: snapshot.stat })
}

const quarantineLock = async (filePath, snapshot, label) => {
  await assertSecurePathIdentity(filePath, snapshot.stat, label)
  const quarantine = `${filePath}.${randomUUID()}.quarantine`
  await rename(filePath, quarantine)
  try {
    const moved = await readLockFile(quarantine)
    if (!sameInode(moved.stat, snapshot.stat)
      || moved.owner.pid !== snapshot.owner.pid
      || moved.owner.token !== snapshot.owner.token) {
      throw new Error(`${label} changed while moving to quarantine`)
    }
    await rm(quarantine)
  } catch (error) {
    try {
      const moved = await lstat(quarantine)
      if (sameInode(moved, snapshot.stat)) {
        try {
          await lstat(filePath)
        } catch (pathError) {
          if (pathError?.code === 'ENOENT') await rename(quarantine, filePath)
        }
      }
    } catch {}
    throw error
  }
}

const acquireOperationGuard = async (guardPath) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const guard = await createLockFile(guardPath)
      let released = false
      return async () => {
        if (released) return
        const current = await readLockFile(guardPath)
        if (!sameInode(current.stat, guard.stat)
          || current.owner.pid !== guard.owner.pid
          || current.owner.token !== guard.owner.token) {
          throw new Error('Production fixture operation guard ownership changed')
        }
        await quarantineLock(guardPath, guard, 'Production fixture operation guard')
        released = true
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      await delay(5)
    }
  }
  throw new Error('Production fixture operation guard is unavailable')
}

export const acquireProductionFixtureLock = async (lockPath) => {
  const guardPath = `${lockPath}.operation`
  const releaseGuard = await acquireOperationGuard(guardPath)
  let acquired
  try {
    try {
      const existing = await readLockFile(lockPath)
      if (processExists(existing.owner.pid)) throw new Error('Another production fixture helper is active')
      await quarantineLock(lockPath, existing, 'Stale production fixture lock')
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    acquired = await createLockFile(lockPath)
  } finally {
    await releaseGuard()
  }

  let released = false
  return async () => {
    if (released) return
    const releaseOperationGuard = await acquireOperationGuard(guardPath)
    try {
      const current = await readLockFile(lockPath)
      if (!sameInode(current.stat, acquired.stat)
        || current.owner.pid !== acquired.owner.pid
        || current.owner.token !== acquired.owner.token) {
        throw new Error('Production fixture lock ownership changed before release')
      }
      await quarantineLock(lockPath, acquired, 'Production fixture lock')
      released = true
    } finally {
      await releaseOperationGuard()
    }
  }
}

const ensureReceiptDirectory = async (directory) => {
  try {
    await mkdir(directory, { mode: 0o700 })
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
  }
  return assertSecureDirectory(directory, 'Production fixture receipt directory')
}

export const resolveProductionFixturePaths = async (env = process.env) => {
  const testing = env.NODE_ENV === 'test'
  let databasePath
  let receiptsDirectory
  let lockPath
  const databaseSidecars = []
  if (testing) {
    if (typeof env.STARSTACK_PRODUCTION_FIXTURE_TEST_ROOT !== 'string'
      || !path.isAbsolute(env.STARSTACK_PRODUCTION_FIXTURE_TEST_ROOT)) {
      throw new Error('Test fixture root must be an absolute path')
    }
    const root = await assertSecureDirectory(
      env.STARSTACK_PRODUCTION_FIXTURE_TEST_ROOT,
      'Production fixture test root',
    )
    databasePath = path.join(root, 'fixture.sqlite')
    receiptsDirectory = path.join(root, 'receipts')
    const lockDirectory = await ensureProductionFixtureLockDirectory(path.join(root, 'run-lock'))
    lockPath = path.join(lockDirectory, 'starstack-production-fixture.lock')
  } else {
    if (env.NODE_ENV !== 'production' || currentUid !== 0) {
      throw new Error('Production fixture helper must run as root in NODE_ENV=production')
    }
    databasePath = '/opt/star-stack/server/data/starstack.sqlite'
    await assertSecureDirectory('/var/lib/starstack', 'StarStack private state directory')
    receiptsDirectory = '/var/lib/starstack/identity-gates'
    const lockDirectory = await ensureProductionFixtureLockDirectory('/run/lock', 0)
    lockPath = path.join(lockDirectory, 'starstack-production-fixture.lock')
  }
  await ensureReceiptDirectory(receiptsDirectory)
  const databaseStat = await lstat(databasePath)
  if (!databaseStat.isFile() || databaseStat.isSymbolicLink() || databaseStat.nlink !== 1
    || (modeBits(databaseStat) & 0o077) !== 0 || await realpath(databasePath) !== databasePath) {
    throw new Error('StarStack production database path is not a private single-link regular file')
  }
  if (testing) assertOwnedByCurrentUser(databaseStat, 'Production fixture test database')
  if (!testing) {
    for (const suffix of ['-wal', '-shm']) {
      const sidecarPath = `${databasePath}${suffix}`
      const sidecar = await lstat(sidecarPath)
      if (!sidecar.isFile() || sidecar.isSymbolicLink() || sidecar.nlink !== 1
        || sidecar.uid !== databaseStat.uid || modeBits(sidecar) !== 0o600
        || await realpath(sidecarPath) !== sidecarPath) {
        throw new Error('Live StarStack SQLite sidecars must already be private and service-owned')
      }
      databaseSidecars.push(Object.freeze({ path: sidecarPath, stat: sidecar }))
    }
  }
  return Object.freeze({
    databasePath,
    databaseStat,
    databaseSidecars: Object.freeze(databaseSidecars),
    receiptsDirectory,
    lockPath,
    testing,
  })
}

export const verifyProductionDatabasePath = async ({
  databasePath,
  databaseStat,
  databaseSidecars = [],
  testing,
}) => {
  const current = await lstat(databasePath)
  if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1
    || (modeBits(current) & 0o077) !== 0 || await realpath(databasePath) !== databasePath
    || !sameInode(current, databaseStat)) {
    throw new Error('StarStack production database identity changed during fixture use')
  }
  if (testing) assertOwnedByCurrentUser(current, 'Production fixture test database')
  for (const sidecar of databaseSidecars) {
    const currentSidecar = await lstat(sidecar.path)
    if (!currentSidecar.isFile() || currentSidecar.isSymbolicLink() || currentSidecar.nlink !== 1
      || currentSidecar.uid !== databaseStat.uid || modeBits(currentSidecar) !== 0o600
      || await realpath(sidecar.path) !== sidecar.path
      || !sameInode(currentSidecar, sidecar.stat)) {
      throw new Error('StarStack production database sidecar identity changed during fixture use')
    }
  }
}

export const productionFixtureReceiptPath = (receiptsDirectory, tombstone) => {
  const digest = createHash('sha256').update(tombstone).digest('hex')
  return path.join(receiptsDirectory, `${digest}.json`)
}

export const createProductionFixtureReceipt = async (receiptsDirectory, tombstone, receipt) => {
  const filePath = productionFixtureReceiptPath(receiptsDirectory, tombstone)
  await writeSecureJson(filePath, receipt, 'Production fixture receipt')
  return filePath
}

export const readProductionFixtureReceipt = async (receiptsDirectory, tombstone) => {
  const filePath = productionFixtureReceiptPath(receiptsDirectory, tombstone)
  return (await readSecureJson(filePath, 'Production fixture receipt')).value
}

export const replaceProductionFixtureReceipt = async (receiptsDirectory, tombstone, receipt) => {
  const filePath = productionFixtureReceiptPath(receiptsDirectory, tombstone)
  const existing = await assertSecurePathIdentity(filePath, null, 'Production fixture receipt')
  const temporary = path.join(receiptsDirectory, `.${randomUUID()}.receipt`)
  try {
    await writeSecureJson(temporary, receipt, 'Production fixture receipt staging file')
    await assertSecurePathIdentity(filePath, existing, 'Production fixture receipt')
    await rename(temporary, filePath)
    await assertSecurePathIdentity(filePath, null, 'Production fixture receipt')
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}
