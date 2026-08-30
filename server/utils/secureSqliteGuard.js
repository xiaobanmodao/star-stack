import { constants } from 'node:fs'
import {
  lstat,
  open,
  realpath,
} from 'node:fs/promises'
import path from 'node:path'

export const SQLITE_OPEN_NOFOLLOW = 0x01000000

const SQLITE_SUFFIXES = Object.freeze(['', '-journal', '-wal', '-shm'])
const currentUid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : undefined
const noFollow = constants.O_NOFOLLOW || 0
const closeOnExec = constants.O_CLOEXEC || 0
const modeBits = (stat) => stat.mode & 0o777n
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
  if (modeBits(stat) !== 0o700n) {
    throw new Error(`${description} permissions must be exactly 0700`)
  }
}

const assertSecureSqliteFileStat = (stat, description) => {
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${description} must be a regular file, not a symbolic link`)
  }
  assertOwnedByCurrentUser(stat, description)
  if (modeBits(stat) !== 0o600n) {
    throw new Error(`${description} permissions must be exactly 0600`)
  }
  if (stat.nlink !== 1n) {
    throw new Error(`${description} link count must be exactly one; hard links are forbidden`)
  }
}

const assertLexicalRealPath = async (target, description) => {
  const resolved = path.resolve(target)
  if (await realpath(target) !== resolved) {
    throw new Error(`${description} real path changed or contains a symbolic link`)
  }
}

const fileIdentity = (stat) => Object.freeze({
  dev: stat.dev.toString(),
  ino: stat.ino.toString(),
  uid: stat.uid.toString(),
  mode: modeBits(stat).toString(8),
  nlink: stat.nlink.toString(),
})

const assertIdentityShape = (identity, description) => {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    throw new Error(`${description} identity is invalid`)
  }
  for (const name of ['dev', 'ino', 'uid', 'mode', 'nlink']) {
    if (typeof identity[name] !== 'string' || !/^\d+$/.test(identity[name])) {
      throw new Error(`${description} identity ${name} is invalid`)
    }
  }
  if (identity.mode !== '600' || identity.nlink !== '1') {
    throw new Error(`${description} identity is not a private single-link file`)
  }
}

const assertExpectedIdentity = (actual, expected, description) => {
  assertIdentityShape(expected, description)
  const current = fileIdentity(actual)
  for (const name of Object.keys(current)) {
    if (current[name] !== expected[name]) {
      throw new Error(`${description} identity changed across the open boundary`)
    }
  }
}

const openSecureSqliteFile = async (filePath, { create = false } = {}) => {
  const resolved = path.resolve(filePath)
  let before
  try {
    before = await lstat(resolved, { bigint: true })
  } catch (error) {
    if (error?.code !== 'ENOENT' || !create) throw error
    let created
    try {
      created = await open(
        resolved,
        constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | noFollow | closeOnExec,
        0o600,
      )
    } catch (createError) {
      if (createError?.code !== 'EEXIST') throw createError
      return openSecureSqliteFile(resolved)
    }
    try {
      await created.sync()
      const opened = await created.stat({ bigint: true })
      assertSecureSqliteFileStat(opened, 'Created local identity SQLite file')
      const current = await lstat(resolved, { bigint: true })
      assertSecureSqliteFileStat(current, 'Created local identity SQLite file')
      await assertLexicalRealPath(resolved, 'Created local identity SQLite file')
      if (!sameInode(opened, current)) {
        throw new Error('Created local identity SQLite file identity changed while opening')
      }
      before = current
    } catch (error) {
      await created.close().catch(() => {})
      throw error
    }
    return createOpenedFile(resolved, created, before)
  }

  assertSecureSqliteFileStat(before, 'Local identity SQLite file')
  await assertLexicalRealPath(resolved, 'Local identity SQLite file')
  const handle = await open(resolved, constants.O_RDONLY | noFollow | closeOnExec)
  try {
    const opened = await handle.stat({ bigint: true })
    assertSecureSqliteFileStat(opened, 'Opened local identity SQLite file')
    if (!sameInode(before, opened)) {
      throw new Error('Local identity SQLite file identity changed while opening')
    }
    return createOpenedFile(resolved, handle, opened)
  } catch (error) {
    await handle.close().catch(() => {})
    throw error
  }
}

const createOpenedFile = (resolved, handle, opened) => {
  let closed = false
  const verify = async () => {
    if (closed) throw new Error('Local identity SQLite file guard is closed')
    const descriptor = await handle.stat({ bigint: true })
    assertSecureSqliteFileStat(descriptor, 'Opened local identity SQLite file')
    if (!sameInode(opened, descriptor)) {
      throw new Error('Local identity SQLite descriptor identity changed during use')
    }
    const current = await lstat(resolved, { bigint: true })
    assertSecureSqliteFileStat(current, 'Local identity SQLite file')
    await assertLexicalRealPath(resolved, 'Local identity SQLite file')
    if (!sameInode(opened, current)) {
      throw new Error('Local identity SQLite file was replaced after its secure open')
    }
    return current
  }
  return {
    path: resolved,
    stat: opened,
    verify,
    async close() {
      if (closed) return
      closed = true
      await handle.close()
    },
  }
}

const encodeGuard = (databasePath, opened) => Buffer.from(JSON.stringify({
  version: 1,
  databasePath,
  files: Object.fromEntries([...opened].map(([suffix, file]) => [
    suffix,
    fileIdentity(file.stat),
  ])),
}), 'utf8').toString('base64url')

const decodeGuard = (value, databasePath) => {
  if (typeof value !== 'string' || value.length < 16 || value.length > 8192) {
    throw new Error('Local identity SQLite guard is missing or invalid')
  }
  let parsed
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
  } catch {
    throw new Error('Local identity SQLite guard is malformed')
  }
  if (parsed?.version !== 1 || parsed.databasePath !== databasePath
    || !parsed.files || typeof parsed.files !== 'object' || Array.isArray(parsed.files)) {
    throw new Error('Local identity SQLite guard does not match the canonical database path')
  }
  const keys = Object.keys(parsed.files)
  if (!keys.includes('') || keys.some((suffix) => !SQLITE_SUFFIXES.includes(suffix))) {
    throw new Error('Local identity SQLite guard file set is invalid')
  }
  for (const [suffix, identity] of Object.entries(parsed.files)) {
    assertIdentityShape(identity, `Local identity SQLite${suffix || ' main'} file`)
  }
  return parsed
}

export const prepareSecureSqliteUnit = async ({
  databasePath,
  createMain = true,
  expectedGuard,
}) => {
  const resolved = path.resolve(databasePath)
  const directory = path.dirname(resolved)
  const directoryStat = await lstat(directory, { bigint: true })
  assertSecureDirectoryStat(directoryStat, 'Local identity SQLite directory')
  await assertLexicalRealPath(directory, 'Local identity SQLite directory')
  const expected = expectedGuard ? decodeGuard(expectedGuard, resolved) : undefined
  const opened = new Map()
  let closed = false
  let failed
  let operation = Promise.resolve()

  const serialized = (task) => {
    const result = operation.then(task, task)
    operation = result.catch(() => {})
    return result
  }

  const openInitialFiles = async () => {
    try {
      for (const suffix of SQLITE_SUFFIXES) {
        const expectedIdentity = expected?.files[suffix]
        let file
        try {
          file = await openSecureSqliteFile(`${resolved}${suffix}`, {
            create: suffix === '' && createMain,
          })
        } catch (error) {
          if (error?.code === 'ENOENT' && suffix !== '') {
            if (expectedIdentity) {
              throw new Error(`Expected local identity SQLite sidecar ${suffix} disappeared`)
            }
            continue
          }
          throw error
        }
        try {
          if (expected && !expectedIdentity) {
            throw new Error(`Unexpected local identity SQLite sidecar ${suffix || 'main'} appeared`)
          }
          if (expectedIdentity) {
            assertExpectedIdentity(file.stat, expectedIdentity, `Local identity SQLite${suffix || ' main'} file`)
          }
          opened.set(suffix, file)
        } catch (error) {
          await file.close().catch(() => {})
          throw error
        }
      }
      if (!opened.has('')) throw new Error('Local identity SQLite main database is missing')
    } catch (error) {
      await Promise.all([...opened.values()].map((file) => file.close().catch(() => {})))
      throw error
    }
  }

  await openInitialFiles()

  const verifyNow = async ({ allowNewSidecars = false } = {}) => {
    if (closed) throw new Error('Local identity SQLite guard is closed')
    if (failed) throw failed
    try {
      await assertLexicalRealPath(directory, 'Local identity SQLite directory')
      const currentDirectory = await lstat(directory, { bigint: true })
      assertSecureDirectoryStat(currentDirectory, 'Local identity SQLite directory')
      if (!sameInode(directoryStat, currentDirectory)) {
        throw new Error('Local identity SQLite directory identity changed during use')
      }
      for (const file of opened.values()) await file.verify()
      for (const suffix of SQLITE_SUFFIXES.slice(1)) {
        if (opened.has(suffix)) continue
        let file
        try {
          file = await openSecureSqliteFile(`${resolved}${suffix}`)
        } catch (error) {
          if (error?.code === 'ENOENT') continue
          throw error
        }
        if (!allowNewSidecars) {
          await file.close()
          throw new Error(`Unexpected local identity SQLite sidecar ${suffix} appeared`)
        }
        opened.set(suffix, file)
      }
    } catch (error) {
      failed = error
      throw error
    }
  }

  return Object.freeze({
    databasePath: resolved,
    get environmentValue() {
      if (closed || failed) throw new Error('Local identity SQLite guard is unavailable')
      return encodeGuard(resolved, opened)
    },
    verify: (options) => serialized(() => verifyNow(options)),
    async close() {
      if (closed) return
      await operation
      closed = true
      await Promise.all([...opened.values()].map((file) => file.close()))
    },
  })
}
