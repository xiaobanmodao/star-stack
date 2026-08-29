import { randomUUID } from 'node:crypto'
import {
  chmod,
  mkdir,
  open,
  readFile,
  rm,
} from 'node:fs/promises'
import path from 'node:path'
import { LOCAL_IDENTITY_RUNTIME_ROOT } from './localIdentityCredentials.mjs'

const LOCK_PATH = path.join(LOCAL_IDENTITY_RUNTIME_ROOT, 'runtime.lock')

const processExists = (pid) => {
  if (!Number.isSafeInteger(pid) || pid < 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

const removeStaleLock = async () => {
  let owner
  try {
    owner = JSON.parse(await readFile(LOCK_PATH, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return true
    return false
  }
  if (processExists(Number(owner?.pid))) return false
  await rm(LOCK_PATH, { force: true })
  return true
}

export const acquireLocalIdentityRuntimeLock = async () => {
  await mkdir(LOCAL_IDENTITY_RUNTIME_ROOT, { recursive: true, mode: 0o700 })
  await chmod(LOCAL_IDENTITY_RUNTIME_ROOT, 0o700)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const token = randomUUID()
      const handle = await open(LOCK_PATH, 'wx', 0o600)
      try {
        await handle.writeFile(`${JSON.stringify({ pid: process.pid, token })}\n`, 'utf8')
      } catch (error) {
        await handle.close()
        await rm(LOCK_PATH, { force: true })
        throw error
      }
      await handle.close()
      let released = false
      return async () => {
        if (released) return
        released = true
        let current
        try {
          current = JSON.parse(await readFile(LOCK_PATH, 'utf8'))
        } catch (error) {
          if (error?.code === 'ENOENT') return
          throw error
        }
        if (current?.pid !== process.pid || current?.token !== token) {
          throw new Error('Local identity runtime lock ownership changed before release')
        }
        await rm(LOCK_PATH, { force: true })
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      if (!(await removeStaleLock())) {
        throw new Error('Another local StarStack identity runtime already owns the shared Hydra database')
      }
    }
  }
  throw new Error('Could not acquire the local StarStack identity runtime lock')
}
