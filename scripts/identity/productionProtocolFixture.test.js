import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import {
  chmod,
  lstat,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureAccountIdentitySchema } from '../../server/utils/accountIdentityMigration.js'
import { ensureOidcIdentitySchema } from '../../server/utils/oidcIdentityMigration.js'

const require = createRequire(new URL('../../server/package.json', import.meta.url))
const sqlite3 = require('sqlite3')
const { open } = require('sqlite')
const helperPath = path.resolve('scripts/identity/production-protocol-fixture.mjs')
const protocol = 'starstack-production-fixture/v1'
const resources = []

const createDatabase = async (root) => {
  const filename = path.join(root, 'fixture.sqlite')
  const db = await open({ filename, driver: sqlite3.Database })
  await db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      email TEXT,
      email_verified_at TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      is_banned INTEGER NOT NULL DEFAULT 0,
      onboarded_at TEXT,
      avatar TEXT,
      bio TEXT DEFAULT '',
      avatar_frame TEXT NOT NULL DEFAULT 'none',
      avatar_overlay TEXT NOT NULL DEFAULT 'none',
      equipped_title TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `)
  await ensureAccountIdentitySchema(db)
  await ensureOidcIdentitySchema(db)
  await db.close()
  await chmod(filename, 0o600)
  for (const suffix of ['-wal', '-shm']) await rm(`${filename}${suffix}`, { force: true })
  return filename
}

const createRuntime = async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'starstack-production-fixture-')))
  resources.push(root)
  const filename = await createDatabase(root)
  const sharedLockDirectory = path.join(root, 'run-lock')
  const lockDirectory = path.join(sharedLockDirectory, 'starstack-identity')
  await mkdir(sharedLockDirectory, { mode: 0o700 })
  await chmod(sharedLockDirectory, 0o1777)
  return { root, filename, sharedLockDirectory, lockDirectory }
}

const startHelper = ({ root, mode = 'normal' }) => {
  const child = spawn(process.execPath, [helperPath], {
    cwd: path.resolve('.'),
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'test',
      STARSTACK_PRODUCTION_FIXTURE_TEST_ROOT: root,
      STARSTACK_PRODUCTION_FIXTURE_MODE: mode,
      STARSTACK_PRODUCTION_FIXTURE_TEST_DIAGNOSTICS: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
  let errors = ''
  child.stderr.on('data', (chunk) => { errors += chunk.toString() })
  const queue = []
  const waiters = []
  lines.on('line', (line) => {
    const value = JSON.parse(line)
    const waiter = waiters.shift()
    if (waiter) waiter.resolve(value)
    else queue.push(value)
  })
  child.once('exit', (code, signal) => {
    while (waiters.length > 0) {
      waiters.shift().reject(new Error(
        `fixture helper exited before a response (${code ?? signal}): ${errors.slice(0, 300)}`,
      ))
    }
  })
  const next = () => queue.length > 0
    ? Promise.resolve(queue.shift())
    : new Promise((resolve, reject) => waiters.push({ resolve, reject }))
  const send = async (value) => {
    child.stdin.write(`${JSON.stringify(value)}\n`)
    return next()
  }
  const exit = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })))
  return { child, send, next, exit, stderr: () => errors }
}

const frame = (type, tombstone, requestId = randomUUID()) => ({
  protocol,
  requestId,
  type,
  ...(tombstone ? { tombstone } : {}),
})

afterEach(async () => {
  await Promise.all(resources.splice(0).map((resource) => rm(resource, { recursive: true, force: true })))
})

describe('production protocol fixture helper', () => {
  it('creates one ordinary no-email account and tombstones it through the lifecycle service', async () => {
    const runtime = await createRuntime()
    const tombstone = randomBytes(24).toString('base64url')
    const helper = startHelper(runtime)
    const prepared = await helper.send(frame('prepare', tombstone, 'prepare-1'))

    expect(prepared).toEqual({
      protocol,
      requestId: 'prepare-1',
      ok: true,
      type: 'prepared',
      fixture: {
        loginId: expect.stringMatching(/^jy-gate-[a-f0-9]{24}$/),
        password: expect.stringMatching(/^[A-Za-z0-9_-]{40,}$/),
      },
    })

    const db = await open({ filename: runtime.filename, driver: sqlite3.Database })
    const active = await db.get('SELECT * FROM users WHERE id = ?', prepared.fixture.loginId)
    expect(active).toMatchObject({
      email: null,
      is_admin: 0,
      is_banned: 0,
      account_status: 'active',
    })
    expect(await require('bcryptjs').compare(prepared.fixture.password, active.password_hash)).toBe(true)
    await db.run(
      `INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)`,
      'fixture-main-session',
      active.id,
      new Date().toISOString(),
    )
    await db.run(
      `INSERT INTO account_center_sessions
       (token_hash, user_id, account_subject, auth_generation, csrf_hash,
        created_at, expires_at, last_seen_at, established_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'fixture-account-session', active.id, active.account_subject, 0, 'csrf',
      new Date().toISOString(), new Date(Date.now() + 60_000).toISOString(),
      new Date().toISOString(), new Date().toISOString(),
    )
    await db.close()

    const cleaned = await helper.send(frame('cleanup', tombstone, 'cleanup-1'))
    expect(cleaned).toEqual({
      protocol,
      requestId: 'cleanup-1',
      ok: true,
      type: 'cleaned',
      accountDisabled: true,
      sessionsRevoked: true,
      outboxDrained: true,
    })
    expect(await helper.send(frame('cleanup', tombstone, 'cleanup-2'))).toEqual({
      protocol,
      requestId: 'cleanup-2',
      ok: true,
      type: 'cleaned',
      accountDisabled: true,
      sessionsRevoked: true,
      outboxDrained: true,
    })
    expect(await helper.send(frame('close', null, 'close-1'))).toEqual({
      protocol,
      requestId: 'close-1',
      ok: true,
      type: 'closed',
    })
    expect((await helper.exit).code).toBe(0)
    expect(helper.stderr()).toBe('')

    const sharedLockStat = await lstat(runtime.sharedLockDirectory)
    const lockDirectoryStat = await lstat(runtime.lockDirectory)
    expect(sharedLockStat.mode & 0o1777).toBe(0o1777)
    expect(lockDirectoryStat.mode & 0o777).toBe(0o700)
    expect(lockDirectoryStat.uid).toBe(process.getuid())
    expect(await readdir(runtime.lockDirectory)).toEqual([])

    const verify = await open({ filename: runtime.filename, driver: sqlite3.Database })
    expect(await verify.get('SELECT account_status, email, is_admin, is_banned FROM users WHERE id = ?', active.id))
      .toEqual({ account_status: 'deleted', email: null, is_admin: 0, is_banned: 1 })
    expect(await verify.get('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?', active.id))
      .toEqual({ count: 0 })
    expect(await verify.get('SELECT COUNT(*) AS count FROM account_center_sessions WHERE account_subject = ?', active.account_subject))
      .toEqual({ count: 0 })
    expect(await verify.get("SELECT COUNT(*) AS count FROM identity_outbox WHERE subject = ? AND status <> 'completed'", active.account_subject))
      .toEqual({ count: 0 })
    expect(await verify.get(
      `SELECT status, attempts FROM identity_outbox
       WHERE subject = ? AND event_type = 'account.deleted'`,
      active.account_subject,
    )).toEqual({ status: 'completed', attempts: 1 })
    await verify.close()

    const receiptFiles = (await import('node:fs/promises')).readdir(path.join(runtime.root, 'receipts'))
    const receiptPath = path.join(runtime.root, 'receipts', (await receiptFiles)[0])
    const receipt = await readFile(receiptPath, 'utf8')
    const receiptStat = await lstat(receiptPath)
    expect(receiptStat.mode & 0o777).toBe(0o600)
    expect(receiptStat.nlink).toBe(1)
    expect(receipt).not.toContain(prepared.fixture.password)
    expect(receipt).not.toContain(active.password_hash)
  }, 30_000)

  it('rejects tombstone reuse and permits cleanup-only recovery after an abrupt owner exit', async () => {
    const runtime = await createRuntime()
    const tombstone = randomBytes(24).toString('base64url')
    const first = startHelper(runtime)
    const prepared = await first.send(frame('prepare', tombstone, 'prepare-abrupt'))
    first.child.kill('SIGKILL')
    await first.exit

    const recovery = startHelper({ ...runtime, mode: 'cleanup-only' })
    expect(await recovery.send(frame('cleanup', tombstone, 'cleanup-recovery'))).toMatchObject({
      ok: true,
      type: 'cleaned',
      accountDisabled: true,
    })
    await recovery.send(frame('close', null, 'close-recovery'))
    expect((await recovery.exit).code).toBe(0)

    const reused = startHelper(runtime)
    reused.child.stdin.write(`${JSON.stringify(frame('prepare', tombstone, 'prepare-reused'))}\n`)
    expect((await reused.exit).code).not.toBe(0)
    const db = await open({ filename: runtime.filename, driver: sqlite3.Database })
    expect(await db.get('SELECT account_status FROM users WHERE id = ?', prepared.fixture.loginId))
      .toEqual({ account_status: 'deleted' })
    await db.close()
  }, 30_000)

  it('fails closed for extra fields, out-of-order frames, duplicate request IDs and oversized frames', async () => {
    for (const payload of [
      { ...frame('prepare', randomBytes(24).toString('base64url'), 'extra'), extra: true },
      frame('cleanup', randomBytes(24).toString('base64url'), 'out-of-order'),
    ]) {
      const runtime = await createRuntime()
      const helper = startHelper(runtime)
      helper.child.stdin.write(`${JSON.stringify(payload)}\n`)
      expect((await helper.exit).code).not.toBe(0)
    }

    const duplicateRuntime = await createRuntime()
    const duplicate = startHelper(duplicateRuntime)
    const tombstone = randomBytes(24).toString('base64url')
    const duplicatePrepared = await duplicate.send(frame('prepare', tombstone, 'duplicate'))
    duplicate.child.stdin.write(`${JSON.stringify(frame('cleanup', tombstone, 'duplicate'))}\n`)
    expect((await duplicate.exit).code).not.toBe(0)
    expect(duplicate.stderr()).not.toContain(duplicatePrepared.fixture.loginId)
    expect(duplicate.stderr()).not.toContain(duplicatePrepared.fixture.password)

    const oversizedRuntime = await createRuntime()
    const oversized = startHelper(oversizedRuntime)
    oversized.child.stdin.write(`${'x'.repeat(20 * 1024)}\n`)
    expect((await oversized.exit).code).not.toBe(0)
  }, 30_000)

  it('holds a single machine fixture lock', async () => {
    const runtime = await createRuntime()
    const first = startHelper(runtime)
    const tombstone = randomBytes(24).toString('base64url')
    await first.send(frame('prepare', tombstone, 'prepare-lock'))
    expect(await readdir(runtime.lockDirectory)).toEqual(['starstack-production-fixture.lock'])

    const second = startHelper(runtime)
    second.child.stdin.write(`${JSON.stringify(frame('prepare', randomBytes(24).toString('base64url'), 'other'))}\n`)
    expect((await second.exit).code).not.toBe(0)

    await first.send(frame('cleanup', tombstone, 'cleanup-lock'))
    await first.send(frame('close', null, 'close-lock'))
    expect((await first.exit).code).toBe(0)
    expect(await readdir(runtime.lockDirectory)).toEqual([])
  }, 30_000)

  it('rejects unsafe shared or dedicated lock directories before creating an account', async () => {
    const safety = await import('./productionFixtureSafety.mjs')
    expect(typeof safety.ensureProductionFixtureLockDirectory).toBe('function')

    const wrongOwner = await createRuntime()
    await expect(safety.ensureProductionFixtureLockDirectory(
      wrongOwner.sharedLockDirectory,
      process.getuid() + 1,
    )).rejects.toThrow(/owner/i)

    const unsafeParent = await createRuntime()
    await chmod(unsafeParent.sharedLockDirectory, 0o777)
    const parentHelper = startHelper(unsafeParent)
    expect((await parentHelper.exit).code).not.toBe(0)

    const unsafeMode = await createRuntime()
    await mkdir(unsafeMode.lockDirectory, { mode: 0o700 })
    await chmod(unsafeMode.lockDirectory, 0o755)
    const modeHelper = startHelper(unsafeMode)
    expect((await modeHelper.exit).code).not.toBe(0)

    const unsafeLink = await createRuntime()
    const linkTarget = path.join(unsafeLink.root, 'lock-target')
    await mkdir(linkTarget, { mode: 0o700 })
    await symlink(linkTarget, unsafeLink.lockDirectory)
    const linkHelper = startHelper(unsafeLink)
    expect((await linkHelper.exit).code).not.toBe(0)

    for (const runtime of [unsafeParent, unsafeMode, unsafeLink]) {
      const db = await open({ filename: runtime.filename, driver: sqlite3.Database })
      expect(await db.get('SELECT COUNT(*) AS count FROM users')).toEqual({ count: 0 })
      await db.close()
    }
  }, 30_000)

  it('reads only a private single-link lifecycle credential', async () => {
    const { readProductionLifecycleCredential } = await import('./productionFixtureSafety.mjs')
    const runtime = await createRuntime()
    const credential = path.join(runtime.root, 'lifecycle-credential')
    const duplicate = path.join(runtime.root, 'lifecycle-credential-hardlink')
    const secret = randomBytes(48).toString('base64url')
    await writeFile(credential, secret, { mode: 0o600 })

    await expect(readProductionLifecycleCredential(credential)).resolves.toBe(secret)
    await link(credential, duplicate)
    await expect(readProductionLifecycleCredential(credential)).rejects.toThrow(/metadata|link/i)
  })
})
