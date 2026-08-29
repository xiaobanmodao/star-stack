import { afterEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import net from 'node:net'
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  LOCAL_IDENTITY_PROJECT_ROOT,
  LOCAL_IDENTITY_DSN_FINGERPRINT,
  LOCAL_IDENTITY_RUNTIME_ROOT,
  __ensureSecureLocalIdentityDirectoryForTest,
  __openSecureLocalIdentityFileForTest,
  __stageLocalIdentityCredentialsRotationForTest,
} from './localIdentityCredentials.mjs'
import { LOCAL_HYDRA_TEST_DSN } from './localHydraDsn.mjs'
import {
  __acquireLocalIdentityRuntimeLockForTest,
} from './localIdentityRuntimeLock.mjs'
import {
  IdentityProcessSupervisor,
  waitForManagedHttp,
} from './localIdentityProcessSupervisor.mjs'

const directories = []
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))

const makeDirectory = async (prefix) => {
  const directory = await mkdtemp(path.join(tmpdir(), prefix))
  directories.push(directory)
  return realpath(directory)
}

const waitForExit = (child, timeoutMs = 5000) => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode })
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('child process did not exit in time')),
      timeoutMs,
    )
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      resolve({ code, signal })
    })
  })
}

const processExists = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

const assertPortFree = (port) => new Promise((resolve, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(port, '127.0.0.1', () => server.close(resolve))
})

const stateRootForHome = (home) => path.join(
  home,
  '.local',
  'state',
  'starstack',
  'identity',
  `hydra-test-${LOCAL_IDENTITY_DSN_FINGERPRINT}`,
)

afterEach(async () => {
  while (directories.length) await rm(directories.pop(), { recursive: true, force: true })
})

describe('local identity machine state and credentials', () => {
  it('uses one DSN-bound state root outside every checkout', () => {
    expect(path.isAbsolute(LOCAL_IDENTITY_RUNTIME_ROOT)).toBe(true)
    expect(LOCAL_IDENTITY_RUNTIME_ROOT.startsWith(`${LOCAL_IDENTITY_PROJECT_ROOT}${path.sep}`))
      .toBe(false)
    expect(path.basename(LOCAL_IDENTITY_RUNTIME_ROOT)).toMatch(/^hydra-test-[a-f0-9]{16}$/)
  })

  it('rejects symlinked directories, symlinked files and unsafe modes', async () => {
    const root = await makeDirectory('starstack-identity-secure-state-')
    const target = path.join(root, 'target')
    const linkedDirectory = path.join(root, 'linked-directory')
    await mkdir(target, { mode: 0o700 })
    await symlink(target, linkedDirectory)
    await expect(__ensureSecureLocalIdentityDirectoryForTest(linkedDirectory))
      .rejects.toThrow(/symbolic link|real path|secure directory/i)

    const safeDirectory = path.join(root, 'safe')
    await mkdir(safeDirectory, { mode: 0o700 })
    const regular = path.join(safeDirectory, 'credentials.json')
    const linkedFile = path.join(safeDirectory, 'linked.json')
    await writeFile(regular, '{"ok":true}\n', { mode: 0o600 })
    await symlink(regular, linkedFile)
    await expect(__openSecureLocalIdentityFileForTest(linkedFile))
      .rejects.toThrow(/symbolic link|regular file|secure file/i)

    await chmod(regular, 0o644)
    await expect(__openSecureLocalIdentityFileForTest(regular))
      .rejects.toThrow(/0600|mode|permissions/i)
  })

  it('detects a credentials path replacement after the secure open', async () => {
    const root = await makeDirectory('starstack-identity-credential-race-')
    await chmod(root, 0o700)
    const credentials = path.join(root, 'credentials.json')
    const displaced = path.join(root, 'credentials.old')
    await writeFile(credentials, '{"value":"first"}\n', { mode: 0o600 })
    const opened = await __openSecureLocalIdentityFileForTest(credentials)
    await rename(credentials, displaced)
    await writeFile(credentials, '{"value":"replacement"}\n', { mode: 0o600 })
    await expect(opened.readJsonAndVerify()).rejects.toThrow(/changed|replaced|identity/i)
    await opened.close()
  })

  it('refuses to commit a replaced credential staging inode', async () => {
    const root = await makeDirectory('starstack-identity-stage-race-')
    await chmod(root, 0o700)
    const credentials = path.join(root, 'credentials.json')
    const staging = path.join(root, '.credentials.pending.json')
    const displaced = path.join(root, '.credentials.pending.old')
    const rotation = await __stageLocalIdentityCredentialsRotationForTest({
      runtimeRoot: root,
      credentialsPath: credentials,
      stagingPath: staging,
    })
    await rename(staging, displaced)
    await writeFile(staging, '{"replacement":true}\n', { mode: 0o600 })
    await expect(rotation.commit()).rejects.toThrow(/changed|replaced|identity/i)
    await expect(access(credentials)).rejects.toMatchObject({ code: 'ENOENT' })
    await rotation.abort()
  })
})

describe('local identity runtime lock', () => {
  it('does not delete a replacement lock when the owner releases', async () => {
    const root = await makeDirectory('starstack-identity-lock-release-')
    const release = await __acquireLocalIdentityRuntimeLockForTest(root)
    const lockPath = path.join(root, 'runtime.lock')
    const original = path.join(root, 'runtime.original')
    const contents = await readFile(lockPath, 'utf8')
    await rename(lockPath, original)
    await writeFile(lockPath, contents, { mode: 0o600 })

    await expect(release()).rejects.toThrow(/ownership|inode|changed/i)
    await expect(access(lockPath)).resolves.toBeUndefined()
  })

  it('allows only one contender to reclaim a stale lock across two checkouts', async () => {
    const root = await makeDirectory('starstack-identity-lock-race-')
    await chmod(root, 0o700)
    await writeFile(
      path.join(root, 'runtime.lock'),
      `${JSON.stringify({ pid: 2147483647, token: 'stale-owner' })}\n`,
      { mode: 0o600 },
    )
    const barrier = path.join(root, 'start')
    const releaseBarrier = path.join(root, 'release')
    const checkoutA = path.join(root, 'checkout-a', 'scripts', 'identity')
    const checkoutB = path.join(root, 'checkout-b', 'scripts', 'identity')
    for (const checkout of [checkoutA, checkoutB]) {
      await mkdir(checkout, { recursive: true })
      for (const file of [
        'localHydraDsn.mjs',
        'localIdentityCredentials.mjs',
        'localIdentityRuntimeLock.mjs',
      ]) {
        await copyFile(path.join(scriptDirectory, file), path.join(checkout, file))
      }
    }
    const worker = `
      import { access } from 'node:fs/promises'
      const [moduleUrl, root, start, release] = process.argv.slice(1)
      const { __acquireLocalIdentityRuntimeLockForTest } = await import(moduleUrl)
      const credentialsUrl = new URL('./localIdentityCredentials.mjs', moduleUrl)
      const { LOCAL_IDENTITY_RUNTIME_ROOT } = await import(credentialsUrl)
      console.log('READY ' + LOCAL_IDENTITY_RUNTIME_ROOT)
      while (true) { try { await access(start); break } catch { await new Promise(r => setTimeout(r, 5)) } }
      try {
        const unlock = await __acquireLocalIdentityRuntimeLockForTest(root)
        console.log('ACQUIRED')
        while (true) { try { await access(release); break } catch { await new Promise(r => setTimeout(r, 5)) } }
        await unlock()
      } catch { console.log('REJECTED') }
    `
    const workers = Array.from({ length: 12 }, (_, index) => {
      const checkout = index % 2 === 0 ? checkoutA : checkoutB
      return spawn(process.execPath, [
        '--input-type=module',
        '-e',
        worker,
        pathToFileURL(path.join(checkout, 'localIdentityRuntimeLock.mjs')).href,
        root,
        barrier,
        releaseBarrier,
      ], { cwd: path.resolve(checkout, '../../..'), stdio: ['ignore', 'pipe', 'pipe'] })
    })
    const output = new Map(workers.map((child) => [child, '']))
    for (const child of workers) {
      child.stdout.on('data', (chunk) => output.set(child, output.get(child) + chunk.toString()))
    }
    const readyDeadline = Date.now() + 5000
    while ([...output.values()].filter((value) => value.includes('READY')).length < workers.length) {
      if (Date.now() > readyDeadline) throw new Error('lock workers did not reach the barrier')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    for (const value of output.values()) expect(value).toContain(`READY ${LOCAL_IDENTITY_RUNTIME_ROOT}`)
    await writeFile(barrier, 'start')
    const acquiredDeadline = Date.now() + 5000
    while ([...output.values()].filter((value) => value.includes('ACQUIRED')).length < 1) {
      if (Date.now() > acquiredDeadline) throw new Error('no lock worker acquired the stale lock')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect([...output.values()].filter((value) => value.includes('ACQUIRED'))).toHaveLength(1)
    await writeFile(releaseBarrier, 'release')
    await Promise.all(workers.map((child) => waitForExit(child)))
    await expect(access(path.join(root, 'runtime.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
  }, 15000)
})

describe('local identity child lifecycle', () => {
  it('observes an immediate child exit even when awaited later', async () => {
    const supervisor = new IdentityProcessSupervisor()
    const child = supervisor.spawn(process.execPath, ['-e', 'process.exit(23)'], {
      stdio: 'ignore',
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    await expect(child.exited).resolves.toMatchObject({ code: 23 })
    await expect(waitForManagedHttp('http://127.0.0.1:9/unreachable', {
      child,
      timeoutMs: 3000,
    })).rejects.toThrow(/exited before|child/i)
    await supervisor.stop()
  })

  it('forwards termination, waits for children and runs cleanup before exit', async () => {
    const root = await makeDirectory('starstack-identity-signal-')
    const childPidFile = path.join(root, 'child.pid')
    const readyFile = path.join(root, 'ready')
    const moduleUrl = pathToFileURL(path.join(scriptDirectory, 'localIdentityProcessSupervisor.mjs')).href
    const lockUrl = pathToFileURL(path.join(scriptDirectory, 'localIdentityRuntimeLock.mjs')).href
    const parentSource = `
      import { writeFile } from 'node:fs/promises'
      const [{ IdentityProcessSupervisor }, { __acquireLocalIdentityRuntimeLockForTest }] = await Promise.all([
        import(${JSON.stringify(moduleUrl)}), import(${JSON.stringify(lockUrl)}),
      ])
      const [root, childPidFile, readyFile] = process.argv.slice(1)
      const supervisor = new IdentityProcessSupervisor()
      supervisor.installSignalHandlers()
      const release = await __acquireLocalIdentityRuntimeLockForTest(root)
      try {
        const child = supervisor.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
        await writeFile(childPidFile, String(child.child.pid))
        await writeFile(readyFile, 'ready')
        await supervisor.shutdown
      } finally {
        await supervisor.stop()
        await release()
        supervisor.removeSignalHandlers()
      }
    `
    const parent = spawn(process.execPath, [
      '--input-type=module',
      '-e',
      parentSource,
      root,
      childPidFile,
      readyFile,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    const deadline = Date.now() + 5000
    while (true) {
      try { await access(readyFile); break } catch {}
      if (Date.now() > deadline) throw new Error('signal fixture did not become ready')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const childPid = Number(await readFile(childPidFile, 'utf8'))
    parent.kill('SIGTERM')
    const result = await waitForExit(parent, 10000)
    expect(result.code).toBe(143)
    expect(processExists(childPid)).toBe(false)
    await expect(access(path.join(root, 'runtime.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
  }, 10000)

  it('fails run-local quickly when Hydra exits before readiness', async () => {
    const root = await makeDirectory('starstack-identity-run-local-early-exit-')
    const home = path.join(root, 'home')
    await mkdir(home, { mode: 0o700 })
    const stateRoot = stateRootForHome(home)
    const credentialsPath = path.join(stateRoot, 'ss-auth-002-local-credentials.json')
    const stagingPath = path.join(stateRoot, '.credentials-rotation.pending.json')
    const rotation = await __stageLocalIdentityCredentialsRotationForTest({
      runtimeRoot: stateRoot,
      credentialsPath,
      stagingPath,
    })
    await rotation.commit()
    const fakeHydra = path.join(root, 'fake-hydra.mjs')
    await writeFile(fakeHydra, `#!/usr/bin/env node
const command = process.argv[2]
if (command === 'version') { console.log('Version: v26.2.0'); process.exit(0) }
if (command === 'migrate') process.exit(0)
if (command === 'serve') process.exit(27)
process.exit(1)
`)
    await chmod(fakeHydra, 0o700)
    const runner = spawn(process.execPath, [path.join(scriptDirectory, 'run-local-runtime.mjs')], {
      cwd: LOCAL_IDENTITY_PROJECT_ROOT,
      env: {
        ...process.env,
        HOME: home,
        HYDRA_TEST_BINARY: fakeHydra,
        HYDRA_TEST_DSN: LOCAL_HYDRA_TEST_DSN,
        IDENTITY_TEST_CREDENTIALS_FILE: credentialsPath,
        IDENTITY_TEST_STARSTACK_DB: path.join(stateRoot, 'ss-auth-002-starstack.sqlite'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    runner.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    runner.stderr.resume()
    const result = await waitForExit(runner, 5000)
    expect(result.code).not.toBe(0)
    expect(stdout).not.toMatch(/"ready"\s*:\s*true/)
    for (const file of ['runtime.lock', 'runtime.lock.operation']) {
      await expect(access(path.join(stateRoot, file))).rejects.toMatchObject({ code: 'ENOENT' })
    }
    await Promise.all([4444, 4445, 5174, 4180].map(assertPortFree))
  }, 10000)

  it('cleans protocol children, pending rotation and lock on SIGTERM before reset commits', async () => {
    const root = await makeDirectory('starstack-identity-protocol-signal-')
    const home = path.join(root, 'home')
    await mkdir(home, { mode: 0o700 })
    const stateRoot = stateRootForHome(home)
    const fakeHydra = path.join(root, 'fake-hydra.mjs')
    const fakePsql = path.join(root, 'fake-psql.mjs')
    const psqlPid = path.join(root, 'psql.pid')
    await writeFile(fakeHydra, `#!/usr/bin/env node
if (process.argv[2] === 'version') { console.log('Version: v26.2.0'); process.exit(0) }
process.exit(0)
`)
    await writeFile(fakePsql, `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
if (process.argv.includes('--version')) { console.log('psql (PostgreSQL) 16.15'); process.exit(0) }
writeFileSync(process.env.IDENTITY_SIGNAL_PSQL_PID, String(process.pid))
process.on('SIGTERM', () => process.exit(143))
process.on('SIGINT', () => process.exit(130))
setInterval(() => {}, 1000)
`)
    await Promise.all([chmod(fakeHydra, 0o700), chmod(fakePsql, 0o700)])
    const protocol = spawn(process.execPath, [path.join(scriptDirectory, 'local-protocol-test.mjs')], {
      cwd: LOCAL_IDENTITY_PROJECT_ROOT,
      env: {
        ...process.env,
        HOME: home,
        HYDRA_TEST_BINARY: fakeHydra,
        HYDRA_TEST_PSQL_BINARY: fakePsql,
        HYDRA_TEST_DSN: LOCAL_HYDRA_TEST_DSN,
        IDENTITY_SIGNAL_PSQL_PID: psqlPid,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    protocol.stdout.resume()
    protocol.stderr.resume()
    const deadline = Date.now() + 5000
    while (true) {
      try { await access(psqlPid); break } catch {}
      if (Date.now() > deadline) throw new Error('protocol did not enter the reset child process')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const childPid = Number(await readFile(psqlPid, 'utf8'))
    protocol.kill('SIGTERM')
    const result = await waitForExit(protocol, 10000)
    expect(result.code).toBe(143)
    expect(processExists(childPid)).toBe(false)
    for (const file of [
      'runtime.lock',
      'runtime.lock.operation',
      '.credentials-rotation.pending.json',
      'ss-auth-002-local-credentials.json',
    ]) {
      await expect(access(path.join(stateRoot, file))).rejects.toMatchObject({ code: 'ENOENT' })
    }
    await Promise.all([4444, 4445, 5174, 4180].map(assertPortFree))
  }, 15000)
})
