import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  lstat,
  open,
  realpath,
  rename,
  rm,
} from 'node:fs/promises'
import path from 'node:path'
import {
  LOCAL_IDENTITY_RUNTIME_ROOT,
  __ensureSecureLocalIdentityDirectoryForTest,
  ensureCanonicalLocalIdentityState,
} from './localIdentityCredentials.mjs'

const currentUid = typeof process.getuid === 'function' ? process.getuid() : undefined
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const sameInode = (left, right) => left.dev === right.dev && left.ino === right.ino
const modeBits = (stat) => stat.mode & 0o777

const processExists = (pid) => {
  if (!Number.isSafeInteger(pid) || pid < 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

const assertSecureLockStat = (stat, description) => {
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${description} must be a regular file, not a symbolic link`)
  }
  if (currentUid !== undefined && stat.uid !== currentUid) {
    throw new Error(`${description} must be owned by the current operating-system user`)
  }
  if (modeBits(stat) !== 0o600) {
    throw new Error(`${description} permissions must be exactly 0600`)
  }
  if (stat.size > 4096) throw new Error(`${description} is unexpectedly large`)
}

const assertPathIdentity = async (filePath, expectedStat, description) => {
  const current = await lstat(filePath)
  assertSecureLockStat(current, description)
  if (await realpath(filePath) !== path.resolve(filePath)) {
    throw new Error(`${description} path contains a symbolic link`)
  }
  if (!sameInode(current, expectedStat)) {
    throw new Error(`${description} inode changed before the operation completed`)
  }
  return current
}

const createOwnedLockFile = async (filePath) => {
  const token = randomUUID()
  const owner = Object.freeze({ pid: process.pid, token })
  const noFollow = constants.O_NOFOLLOW || 0
  const handle = await open(
    filePath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
    0o600,
  )
  let stat
  try {
    stat = await handle.stat()
    assertSecureLockStat(stat, 'Created local identity runtime lock')
    await handle.writeFile(`${JSON.stringify(owner)}\n`, 'utf8')
    await handle.sync()
    stat = await handle.stat()
    assertSecureLockStat(stat, 'Created local identity runtime lock')
  } catch (error) {
    await handle.close().catch(() => {})
    if (stat) {
      try {
        await assertPathIdentity(filePath, stat, 'Failed local identity runtime lock')
        await rm(filePath)
      } catch {}
    }
    throw error
  }
  await handle.close()
  await assertPathIdentity(filePath, stat, 'Created local identity runtime lock')
  return Object.freeze({ owner, stat })
}

const readOwnedLockFile = async (filePath) => {
  const before = await lstat(filePath)
  assertSecureLockStat(before, 'Local identity runtime lock')
  if (await realpath(filePath) !== path.resolve(filePath)) {
    throw new Error('Local identity runtime lock path contains a symbolic link')
  }
  const noFollow = constants.O_NOFOLLOW || 0
  const handle = await open(filePath, constants.O_RDONLY | noFollow)
  try {
    const opened = await handle.stat()
    assertSecureLockStat(opened, 'Opened local identity runtime lock')
    if (!sameInode(before, opened)) {
      throw new Error('Local identity runtime lock changed while opening')
    }
    const owner = JSON.parse(await handle.readFile('utf8'))
    if (!Number.isSafeInteger(Number(owner?.pid))
      || Number(owner.pid) < 1
      || typeof owner?.token !== 'string'
      || owner.token.length < 8
      || owner.token.length > 128) {
      throw new Error('Local identity runtime lock owner is invalid')
    }
    await assertPathIdentity(filePath, opened, 'Local identity runtime lock')
    return Object.freeze({
      owner: Object.freeze({ pid: Number(owner.pid), token: owner.token }),
      stat: opened,
    })
  } finally {
    await handle.close()
  }
}

const quarantineAndRemove = async (filePath, snapshot, reason) => {
  await assertPathIdentity(filePath, snapshot.stat, reason)
  const quarantine = `${filePath}.${reason.replaceAll(' ', '-')}.${randomUUID()}`
  await rename(filePath, quarantine)
  try {
    const moved = await lstat(quarantine)
    assertSecureLockStat(moved, reason)
    if (!sameInode(moved, snapshot.stat)) {
      throw new Error(`${reason} identity changed while moving to quarantine`)
    }
    const movedSnapshot = await readOwnedLockFile(quarantine)
    if (movedSnapshot.owner.pid !== snapshot.owner.pid
      || movedSnapshot.owner.token !== snapshot.owner.token
      || !sameInode(movedSnapshot.stat, snapshot.stat)) {
      throw new Error(`${reason} ownership changed while moving to quarantine`)
    }
    await rm(quarantine)
  } catch (error) {
    // The operation guard excludes every cooperating writer. If post-rename
    // verification fails, restore the exact inode when possible instead of
    // leaving the canonical path empty and allowing a second owner in.
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
    throw new Error(`${reason} could not be removed safely`, { cause: error })
  }
}

const acquireOperationGuard = async (guardPath) => {
  // Every acquire/release operation uses this short-lived guard. It is never
  // auto-deleted when stale: a crash in this millisecond-scale critical
  // section fails closed and requires explicit operator recovery, avoiding a
  // recursive stale-lock check/delete race.
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const guard = await createOwnedLockFile(guardPath)
      let released = false
      return async () => {
        if (released) return
        released = true
        const current = await readOwnedLockFile(guardPath)
        if (current.owner.pid !== guard.owner.pid
          || current.owner.token !== guard.owner.token
          || !sameInode(current.stat, guard.stat)) {
          throw new Error('Local identity runtime operation guard ownership changed before release')
        }
        await quarantineAndRemove(guardPath, guard, 'operation-guard-release')
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      await delay(5)
    }
  }
  let owner
  try { owner = await readOwnedLockFile(guardPath) } catch {}
  const stale = owner && !processExists(owner.owner.pid)
  throw new Error(stale
    ? 'A stale local identity operation guard requires explicit recovery'
    : 'Another local identity lock operation is still in progress')
}

const acquireAtRoot = async ({ runtimeRoot, canonical }) => {
  if (canonical) await ensureCanonicalLocalIdentityState()
  else await __ensureSecureLocalIdentityDirectoryForTest(runtimeRoot)
  const lockPath = path.join(runtimeRoot, 'runtime.lock')
  const guardPath = path.join(runtimeRoot, 'runtime.lock.operation')
  const releaseGuard = await acquireOperationGuard(guardPath)
  let acquired
  try {
    try {
      const existing = await readOwnedLockFile(lockPath)
      if (processExists(existing.owner.pid)) {
        throw new Error('Another local StarStack identity runtime already owns the shared Hydra database')
      }
      await quarantineAndRemove(lockPath, existing, 'stale-runtime-lock')
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    acquired = await createOwnedLockFile(lockPath)
  } finally {
    await releaseGuard()
  }

  let released = false
  return async () => {
    if (released) return
    const releaseOperationGuard = await acquireOperationGuard(guardPath)
    try {
      const current = await readOwnedLockFile(lockPath)
      if (current.owner.pid !== acquired.owner.pid
        || current.owner.token !== acquired.owner.token
        || !sameInode(current.stat, acquired.stat)) {
        throw new Error('Local identity runtime lock ownership or inode changed before release')
      }
      await quarantineAndRemove(lockPath, acquired, 'runtime-lock-release')
      released = true
    } finally {
      await releaseOperationGuard()
    }
  }
}

export const acquireLocalIdentityRuntimeLock = async () => acquireAtRoot({
  runtimeRoot: LOCAL_IDENTITY_RUNTIME_ROOT,
  canonical: true,
})

export const __acquireLocalIdentityRuntimeLockForTest = async (runtimeRoot) => acquireAtRoot({
  runtimeRoot: path.resolve(runtimeRoot),
  canonical: false,
})
