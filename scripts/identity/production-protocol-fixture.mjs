#!/usr/bin/env node
import { randomBytes, randomUUID } from 'node:crypto'
import { fstatSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { TextDecoder } from 'node:util'
import { fileURLToPath } from 'node:url'
import { createHydraAdminClient } from '../../server/identity/hydraAdminClient.js'
import {
  JIEYA_ACCOUNT_LIFECYCLE_HEADER,
  JIEYA_ACCOUNT_LIFECYCLE_HOST,
  JIEYA_ACCOUNT_LIFECYCLE_ISSUER,
  JIEYA_ACCOUNT_LIFECYCLE_URL,
  createJieyaAccountLifecycleClient,
} from '../../server/identity/jieyaLifecycleClient.js'
import { processIdentityOutboxBatch } from '../../server/services/identityOutbox.js'
import { transitionAccountStatus } from '../../server/services/accountLifecycle.js'
import { isAccountSubject, verifyAccountIdentityData } from '../../server/utils/accountIdentityMigration.js'
import { verifyOidcIdentitySchema } from '../../server/utils/oidcIdentityMigration.js'
import { SQLITE_OPEN_NOFOLLOW } from '../../server/utils/secureSqliteGuard.js'
import {
  acquireProductionFixtureLock,
  createProductionFixtureReceipt,
  readProductionLifecycleCredential,
  readProductionFixtureReceipt,
  replaceProductionFixtureReceipt,
  resolveProductionFixturePaths,
  verifyProductionDatabasePath,
} from './productionFixtureSafety.mjs'

const require = createRequire(new URL('../../server/package.json', import.meta.url))
const bcrypt = require('bcryptjs')
const sqlite3 = require('sqlite3')
const { open } = require('sqlite')

export const PRODUCTION_FIXTURE_PROTOCOL = 'starstack-production-fixture/v1'
export const PRODUCTION_FIXTURE_MAX_FRAME_BYTES = 16 * 1024
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/
const TOMBSTONE_PATTERN = /^[A-Za-z0-9_-]{24,128}$/
const LOGIN_ID_PATTERN = /^jy-gate-[a-f0-9]{24}$/
const RECEIPT_PHASES = new Set(['preparing', 'prepared', 'cleanup-pending', 'cleaned'])
const MAX_PROTOCOL_FRAMES = 16
const MAX_OUTBOX_DRAIN_BATCHES = 4
const PRODUCTION_LIFECYCLE_CREDENTIAL =
  '/etc/starstack/server/jieya-account-lifecycle-secret'
const utf8Decoder = new TextDecoder('utf-8', { fatal: true })

const fail = (code) => {
  const error = new Error('Production fixture protocol rejected')
  error.code = code
  throw error
}

const exactKeys = (value, expected) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

const assertFrame = (frame, seenRequestIds) => {
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) fail('INVALID_FRAME')
  if (frame.protocol !== PRODUCTION_FIXTURE_PROTOCOL) fail('INVALID_PROTOCOL')
  if (typeof frame.requestId !== 'string' || !REQUEST_ID_PATTERN.test(frame.requestId)) {
    fail('INVALID_REQUEST_ID')
  }
  if (seenRequestIds.has(frame.requestId)) fail('DUPLICATE_REQUEST_ID')
  if (!['prepare', 'cleanup', 'close'].includes(frame.type)) fail('INVALID_TYPE')
  const expected = frame.type === 'close'
    ? ['protocol', 'requestId', 'type']
    : ['protocol', 'requestId', 'type', 'tombstone']
  if (!exactKeys(frame, expected)) fail('EXTRA_OR_MISSING_FIELDS')
  if (frame.type !== 'close'
    && (typeof frame.tombstone !== 'string' || !TOMBSTONE_PATTERN.test(frame.tombstone))) {
    fail('INVALID_TOMBSTONE')
  }
  seenRequestIds.add(frame.requestId)
  return frame
}

const assertReceipt = (receipt, tombstone) => {
  const expectedKeys = [
    'version', 'protocol', 'tombstone', 'loginId', 'accountSubject', 'accountCreated',
    'phase', 'cleanupGeneration', 'createdAt', 'cleanedAt',
  ]
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
    || !exactKeys(receipt, expectedKeys)
    || receipt.version !== 1
    || receipt.protocol !== PRODUCTION_FIXTURE_PROTOCOL
    || receipt.tombstone !== tombstone
    || typeof receipt.loginId !== 'string' || !LOGIN_ID_PATTERN.test(receipt.loginId)
    || !isAccountSubject(receipt.accountSubject)
    || typeof receipt.accountCreated !== 'boolean'
    || !RECEIPT_PHASES.has(receipt.phase)
    || typeof receipt.createdAt !== 'string' || !Number.isFinite(Date.parse(receipt.createdAt))
    || (receipt.cleanedAt !== null
      && (typeof receipt.cleanedAt !== 'string' || !Number.isFinite(Date.parse(receipt.cleanedAt))))
    || (receipt.cleanupGeneration !== null
      && (!Number.isSafeInteger(receipt.cleanupGeneration) || receipt.cleanupGeneration < 0))) {
    fail('INVALID_RECEIPT')
  }
  return receipt
}

const openProductionDatabase = async (paths) => {
  await verifyProductionDatabasePath(paths)
  const db = await open({
    filename: paths.databasePath,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READWRITE | sqlite3.OPEN_FULLMUTEX | SQLITE_OPEN_NOFOLLOW,
  })
  try {
    await db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
    await verifyAccountIdentityData(db)
    await verifyOidcIdentitySchema(db)
    const userColumns = new Set((await db.all('PRAGMA table_info(users)')).map((column) => column.name))
    for (const column of [
      'id', 'name', 'password_hash', 'email', 'email_verified_at', 'is_admin', 'is_banned',
      'account_subject', 'account_status', 'account_tombstoned_at', 'auth_generation',
      'onboarded_at', 'avatar', 'bio', 'avatar_frame', 'avatar_overlay', 'equipped_title',
      'created_at',
    ]) {
      if (!userColumns.has(column)) throw new Error(`Production users schema is missing ${column}`)
    }
    await verifyProductionDatabasePath(paths)
    return db
  } catch (error) {
    await db.close().catch(() => undefined)
    throw error
  }
}

const createFixtureAccount = async ({ db, receiptsDirectory, tombstone }) => {
  const now = new Date().toISOString()
  const loginId = `jy-gate-${randomBytes(12).toString('hex')}`
  const accountSubject = randomUUID()
  const password = randomBytes(36).toString('base64url')
  const receipt = {
    version: 1,
    protocol: PRODUCTION_FIXTURE_PROTOCOL,
    tombstone,
    loginId,
    accountSubject,
    accountCreated: false,
    phase: 'preparing',
    cleanupGeneration: null,
    createdAt: now,
    cleanedAt: null,
  }

  await createProductionFixtureReceipt(receiptsDirectory, tombstone, receipt)
  try {
    const passwordHash = await bcrypt.hash(password, 10)
    await db.exec('BEGIN IMMEDIATE')
    try {
      await db.run(
        `INSERT INTO users
         (id, name, password_hash, email, email_verified_at, is_admin, is_banned,
          account_subject, account_status, account_tombstoned_at, auth_generation,
          onboarded_at, avatar, bio, avatar_frame, avatar_overlay, equipped_title, created_at)
         VALUES (?, ?, ?, NULL, NULL, 0, 0, ?, 'active', NULL, 0,
                 NULL, NULL, '', 'none', 'none', NULL, ?)`,
        loginId,
        '预发布协议夹具',
        passwordHash,
        accountSubject,
        now,
      )
      await db.exec('COMMIT')
    } catch (error) {
      await db.exec('ROLLBACK').catch(() => undefined)
      throw error
    }
    const preparedReceipt = { ...receipt, accountCreated: true, phase: 'prepared' }
    await replaceProductionFixtureReceipt(receiptsDirectory, tombstone, preparedReceipt)
    return { loginId, password, receipt: preparedReceipt }
  } catch (error) {
    error.productionFixtureReceiptCreated = true
    throw error
  }
}

const createOutboxAdmin = (env) => {
  const adminUrl = env.OIDC_HYDRA_ADMIN_URL || 'http://127.0.0.1:4445'
  if (adminUrl !== 'http://127.0.0.1:4445') fail('INVALID_HYDRA_ADMIN_URL')
  return createHydraAdminClient({
    baseUrl: adminUrl,
    issuer: 'https://auth.xingzhan.cc',
  })
}

const createFixtureLifecycleClient = async (paths) => {
  if (paths.testing) {
    const secret = randomBytes(48).toString('base64url')
    return createJieyaAccountLifecycleClient({
      secret,
      fetchImpl: async (url, request) => {
        if (url !== JIEYA_ACCOUNT_LIFECYCLE_URL
          || request?.method !== 'POST'
          || request?.headers?.Host !== JIEYA_ACCOUNT_LIFECYCLE_HOST
          || request?.headers?.[JIEYA_ACCOUNT_LIFECYCLE_HEADER] !== secret) {
          fail('INVALID_TEST_LIFECYCLE_WIRE')
        }
        return { status: 200, json: async () => ({ status: 'applied' }) }
      },
    })
  }
  const secret = await readProductionLifecycleCredential(
    PRODUCTION_LIFECYCLE_CREDENTIAL,
    0,
  )
  return createJieyaAccountLifecycleClient({ secret })
}

const drainFixtureOutbox = async (db, admin, lifecycleClient, subject, generation) => {
  for (let batch = 0; batch < MAX_OUTBOX_DRAIN_BATCHES; batch += 1) {
    const results = await processIdentityOutboxBatch(db, admin, {
      subject,
      generation,
      limit: 25,
      lifecycleClient,
      lifecycleIssuer: JIEYA_ACCOUNT_LIFECYCLE_ISSUER,
    })
    if (results.length === 0) break
    if (results.some((result) => !result.processed)) break
  }
  const unresolved = await db.get(
    `SELECT COUNT(*) AS count FROM identity_outbox
     WHERE subject = ? AND status <> 'completed'`,
    subject,
  )
  return unresolved.count === 0
}

const cleanupFixtureAccount = async ({
  db,
  receiptsDirectory,
  tombstone,
  env,
  lifecycleClient,
}) => {
  let receipt = assertReceipt(
    await readProductionFixtureReceipt(receiptsDirectory, tombstone),
    tombstone,
  )
  const receiptWasCleaned = receipt.phase === 'cleaned'
  const account = await db.get(
    `SELECT id, account_subject, account_status, auth_generation
     FROM users WHERE id = ?`,
    receipt.loginId,
  )
  if (!account) {
    if (receipt.accountCreated) fail('FIXTURE_ACCOUNT_MISSING')
    if (receipt.phase !== 'cleaned') {
      receipt = { ...receipt, phase: 'cleaned', cleanedAt: new Date().toISOString() }
      await replaceProductionFixtureReceipt(receiptsDirectory, tombstone, receipt)
    }
    return { accountDisabled: true, sessionsRevoked: true, outboxDrained: true }
  }
  if (account.account_subject !== receipt.accountSubject) fail('FIXTURE_ACCOUNT_MISMATCH')

  let generation = receipt.cleanupGeneration
  if (account.account_status !== 'deleted') {
    const transition = await transitionAccountStatus(db, {
      accountId: receipt.loginId,
      status: 'deleted',
    })
    generation = transition.generation
  } else if (generation === null) {
    generation = account.auth_generation
  }
  if (!receiptWasCleaned) {
    receipt = {
      ...receipt,
      accountCreated: true,
      phase: 'cleanup-pending',
      cleanupGeneration: generation,
    }
    await replaceProductionFixtureReceipt(receiptsDirectory, tombstone, receipt)
  }

  const outboxDrained = await drainFixtureOutbox(
    db,
    createOutboxAdmin(env),
    lifecycleClient,
    receipt.accountSubject,
    generation,
  )
  const [disabled, mainSessions, accountSessions, oidcSessions] = await Promise.all([
    db.get(
      `SELECT COUNT(*) AS count FROM users
       WHERE id = ? AND account_subject = ? AND account_status = 'deleted'
         AND is_banned = 1 AND is_admin = 0 AND email IS NULL`,
      receipt.loginId,
      receipt.accountSubject,
    ),
    db.get('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?', receipt.loginId),
    db.get(
      'SELECT COUNT(*) AS count FROM account_center_sessions WHERE account_subject = ?',
      receipt.accountSubject,
    ),
    db.get(
      `SELECT COUNT(*) AS count FROM oidc_login_sessions
       WHERE account_subject = ? AND status <> 'revoked'`,
      receipt.accountSubject,
    ),
  ])
  const accountDisabled = disabled.count === 1
  const sessionsRevoked = mainSessions.count === 0
    && accountSessions.count === 0
    && oidcSessions.count === 0
  if (!accountDisabled || !sessionsRevoked || !outboxDrained) fail('CLEANUP_INCOMPLETE')

  if (!receiptWasCleaned) {
    receipt = {
      ...receipt,
      phase: 'cleaned',
      cleanedAt: new Date().toISOString(),
    }
    await replaceProductionFixtureReceipt(receiptsDirectory, tombstone, receipt)
  }
  return { accountDisabled, sessionsRevoked, outboxDrained }
}

const writeFrame = (value) => new Promise((resolve, reject) => {
  const line = `${JSON.stringify(value)}\n`
  if (Buffer.byteLength(line, 'utf8') > PRODUCTION_FIXTURE_MAX_FRAME_BYTES) {
    reject(new Error('Production fixture response frame exceeded its limit'))
    return
  }
  process.stdout.write(line, (error) => error ? reject(error) : resolve())
})

const readFrames = async function* () {
  let pending = Buffer.alloc(0)
  let count = 0
  for await (const chunk of process.stdin) {
    pending = Buffer.concat([pending, Buffer.from(chunk)])
    if (pending.length > PRODUCTION_FIXTURE_MAX_FRAME_BYTES && !pending.includes(0x0a)) {
      fail('FRAME_TOO_LARGE')
    }
    while (true) {
      const newline = pending.indexOf(0x0a)
      if (newline < 0) break
      const encoded = pending.subarray(0, newline)
      pending = pending.subarray(newline + 1)
      if (encoded.length === 0 || encoded.length > PRODUCTION_FIXTURE_MAX_FRAME_BYTES) {
        fail('INVALID_FRAME_SIZE')
      }
      count += 1
      if (count > MAX_PROTOCOL_FRAMES) fail('TOO_MANY_FRAMES')
      let parsed
      try { parsed = JSON.parse(utf8Decoder.decode(encoded)) } catch { fail('INVALID_JSON') }
      yield parsed
    }
    if (pending.length > PRODUCTION_FIXTURE_MAX_FRAME_BYTES) fail('FRAME_TOO_LARGE')
  }
  if (pending.length !== 0) fail('TRUNCATED_FRAME')
}

const assertAnonymousPipes = () => {
  const input = fstatSync(0)
  const output = fstatSync(1)
  const isAnonymous = (stat) => stat.isFIFO() || stat.isSocket()
  if (!isAnonymous(input) || !isAnonymous(output)) {
    throw new Error('Production fixture protocol requires anonymous parent-child pipes')
  }
}

export const runProductionProtocolFixture = async (env = process.env) => {
  assertAnonymousPipes()
  const mode = env.STARSTACK_PRODUCTION_FIXTURE_MODE || 'normal'
  if (!['normal', 'cleanup-only'].includes(mode)) fail('INVALID_MODE')
  const paths = await resolveProductionFixturePaths(env)
  const releaseLock = await acquireProductionFixtureLock(paths.lockPath)
  let db
  let lifecycleClient
  let activeTombstone = null
  let cleaned = false
  let closed = false
  let signalCode = 0
  const onSignal = (signal) => {
    signalCode = signal === 'SIGINT' ? 130 : 143
    process.stdin.destroy(new Error('Fixture helper interrupted'))
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  try {
    lifecycleClient = await createFixtureLifecycleClient(paths)
    db = await openProductionDatabase(paths)
    const seenRequestIds = new Set()
    let state = mode === 'normal' ? 'await-prepare' : 'await-cleanup'
    for await (const rawFrame of readFrames()) {
      const request = assertFrame(rawFrame, seenRequestIds)
      if (request.type === 'prepare') {
        if (state !== 'await-prepare') fail('OUT_OF_ORDER')
        let prepared
        try {
          prepared = await createFixtureAccount({
            db,
            receiptsDirectory: paths.receiptsDirectory,
            tombstone: request.tombstone,
          })
          activeTombstone = request.tombstone
        } catch (error) {
          if (error?.productionFixtureReceiptCreated) activeTombstone = request.tombstone
          throw error
        }
        await verifyProductionDatabasePath(paths)
        await writeFrame({
          protocol: PRODUCTION_FIXTURE_PROTOCOL,
          requestId: request.requestId,
          ok: true,
          type: 'prepared',
          fixture: { loginId: prepared.loginId, password: prepared.password },
        })
        state = 'await-cleanup'
      } else if (request.type === 'cleanup') {
        if (!['await-cleanup', 'cleaned'].includes(state)) fail('OUT_OF_ORDER')
        if (activeTombstone !== null && request.tombstone !== activeTombstone) {
          fail('TOMBSTONE_MISMATCH')
        }
        activeTombstone = request.tombstone
        const result = await cleanupFixtureAccount({
          db,
          receiptsDirectory: paths.receiptsDirectory,
          tombstone: request.tombstone,
          env,
          lifecycleClient,
        })
        cleaned = true
        state = 'cleaned'
        await verifyProductionDatabasePath(paths)
        await writeFrame({
          protocol: PRODUCTION_FIXTURE_PROTOCOL,
          requestId: request.requestId,
          ok: true,
          type: 'cleaned',
          ...result,
        })
      } else {
        if (state !== 'cleaned') fail('OUT_OF_ORDER')
        await writeFrame({
          protocol: PRODUCTION_FIXTURE_PROTOCOL,
          requestId: request.requestId,
          ok: true,
          type: 'closed',
        })
        closed = true
        break
      }
    }
    if (!closed) fail('PROTOCOL_NOT_CLOSED')
  } finally {
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
    if (db && activeTombstone && !cleaned) {
      await cleanupFixtureAccount({
        db,
        receiptsDirectory: paths.receiptsDirectory,
        tombstone: activeTombstone,
        env,
        lifecycleClient,
      }).catch(() => undefined)
    }
    if (db) await db.close().catch(() => undefined)
    await verifyProductionDatabasePath(paths).catch(() => undefined)
    await releaseLock()
    if (signalCode) process.exitCode = signalCode
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  runProductionProtocolFixture().catch((error) => {
    const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code)
      ? error.code
      : 'FAILED_CLOSED'
    const diagnostic = process.env.NODE_ENV === 'test'
      && process.env.STARSTACK_PRODUCTION_FIXTURE_TEST_DIAGNOSTICS === '1'
      ? `: ${String(error?.message || '').slice(0, 300)}`
      : ''
    process.stderr.write(`[production-fixture] failed closed (${code})${diagnostic}\n`)
    process.exitCode = 1
  })
}
