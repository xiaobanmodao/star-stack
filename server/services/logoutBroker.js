import { randomUUID } from 'node:crypto'
import {
  createOpaqueToken,
  hashOpaqueToken,
  verifyOpaqueToken,
} from '../identity/opaqueToken.js'
import { getAccountCenterSession, verifyAccountCenterCsrf } from './accountCenterSession.js'

const LOGOUT_TRANSACTION_TTL_MS = 5 * 60 * 1000
const transactionQueues = new WeakMap()

export class LogoutBrokerError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'LogoutBrokerError'
    this.code = code
  }
}

const runSerialized = (db, operation) => {
  const previous = transactionQueues.get(db) || Promise.resolve()
  const current = previous.catch(() => undefined).then(operation)
  transactionQueues.set(db, current)
  return current.finally(() => {
    if (transactionQueues.get(db) === current) transactionQueues.delete(db)
  })
}

const parseDate = (value) => {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new LogoutBrokerError('INVALID_TIME', '退出事务时间无效')
  return date
}

const assertClient = (client, clientId) => {
  if (!client || client.id !== clientId || typeof client.logoutCallbackUri !== 'string') {
    throw new LogoutBrokerError('INVALID_CLIENT', '退出客户端未登记')
  }
}

const assertBrokerInput = ({ subject, clientId, sid, state }) => {
  if (typeof subject !== 'string' || !subject
    || typeof clientId !== 'string' || !clientId
    || typeof sid !== 'string' || !sid || sid.length > 512
    || typeof state !== 'string' || state.length < 8 || state.length > 512) {
    throw new LogoutBrokerError('INVALID_REQUEST', '退出事务请求格式无效')
  }
}

export const createLogoutTransaction = async (
  db,
  input,
  { client, issuer, now = () => new Date(), randomToken = createOpaqueToken },
) => {
  assertBrokerInput(input)
  assertClient(client, input.clientId)
  const binding = await db.get(
    `SELECT s.id FROM oidc_login_sessions s
     JOIN users u ON u.account_subject = s.account_subject
     WHERE s.account_subject = ? AND s.client_id = ? AND s.sid = ?
       AND s.status = 'active' AND u.account_status = 'active'`,
    input.subject,
    input.clientId,
    input.sid,
  )
  if (!binding) throw new LogoutBrokerError('SESSION_NOT_BOUND', 'subject/client/sid 未绑定有效登录会话')

  const token = randomToken()
  const tokenHash = hashOpaqueToken(token)
  if (!tokenHash) throw new LogoutBrokerError('TOKEN_GENERATION_FAILED', '无法创建退出事务')
  const createdAt = parseDate(now())
  const expiresAt = new Date(createdAt.getTime() + LOGOUT_TRANSACTION_TTL_MS)
  try {
    await db.run(
      `INSERT INTO oidc_logout_transactions
         (token_hash, account_subject, client_id, sid, state, status, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      tokenHash,
      input.subject,
      input.clientId,
      input.sid,
      input.state,
      createdAt.toISOString(),
      expiresAt.toISOString(),
    )
  } catch (error) {
    throw new LogoutBrokerError('TRANSACTION_CONFLICT', `退出事务创建冲突: ${error.message}`)
  }

  const url = new URL('/account/logout', issuer)
  url.searchParams.set('transaction', token)
  return { token, url: url.toString(), expiresAt: expiresAt.toISOString() }
}

const getUsableTransaction = async (db, tokenHash, nowDate) => {
  const transaction = await db.get(
    `SELECT * FROM oidc_logout_transactions WHERE token_hash = ?`,
    tokenHash,
  )
  if (!transaction) throw new LogoutBrokerError('NOT_FOUND', '退出事务不存在')
  if (Date.parse(transaction.expires_at) <= nowDate.getTime()) {
    await db.run(
      `UPDATE oidc_logout_transactions SET status = 'expired'
       WHERE token_hash = ? AND status IN ('pending', 'bound')`,
      tokenHash,
    )
    throw new LogoutBrokerError('EXPIRED', '退出事务已过期')
  }
  return transaction
}

export const bindLogoutTransaction = async (
  db,
  { transactionToken, accountSessionToken },
  { now = () => new Date() } = {},
) => {
  const tokenHash = hashOpaqueToken(transactionToken)
  if (!tokenHash) throw new LogoutBrokerError('INVALID_TOKEN', '退出事务无效')
  const nowDate = parseDate(now())
  const session = await getAccountCenterSession(db, accountSessionToken, { now: () => nowDate })
  if (!session) throw new LogoutBrokerError('ACCOUNT_SESSION_REQUIRED', '需要有效账号中心会话')

  return runSerialized(db, async () => {
    await db.exec('BEGIN IMMEDIATE')
    try {
      const transaction = await getUsableTransaction(db, tokenHash, nowDate)
      if (transaction.account_subject !== session.subject) {
        throw new LogoutBrokerError('ACCOUNT_MISMATCH', '退出事务与当前账号不匹配')
      }
      if (transaction.status === 'pending') {
        const result = await db.run(
          `UPDATE oidc_logout_transactions
           SET status = 'bound', account_session_hash = ?, bound_at = ?
           WHERE token_hash = ? AND status = 'pending'`,
          session.tokenHash,
          nowDate.toISOString(),
          tokenHash,
        )
        if (result.changes !== 1) throw new LogoutBrokerError('RACE_LOST', '退出事务绑定失败')
      } else if (transaction.status !== 'bound'
        || transaction.account_session_hash !== session.tokenHash) {
        throw new LogoutBrokerError('INVALID_STATUS', '退出事务已消费或绑定到其他会话')
      }
      await db.exec('COMMIT')
      return {
        subject: transaction.account_subject,
        clientId: transaction.client_id,
        sid: transaction.sid,
        csrfTokenRequired: true,
      }
    } catch (error) {
      await db.exec('ROLLBACK').catch(() => undefined)
      throw error
    }
  })
}

const assertExactBrowserSource = ({ origin, referer }, expectedOrigin) => {
  if (origin !== expectedOrigin) {
    throw new LogoutBrokerError('INVALID_ORIGIN', 'Origin 与账号中心不匹配')
  }
  let refererUrl
  try { refererUrl = new URL(referer) } catch {
    throw new LogoutBrokerError('INVALID_REFERER', 'Referer 无效')
  }
  if (refererUrl.origin !== expectedOrigin || refererUrl.pathname !== '/account/logout') {
    throw new LogoutBrokerError('INVALID_REFERER', 'Referer 与退出确认页不匹配')
  }
}

const insertOutbox = async (db, {
  eventType, subject, clientId, sid = null, generation, timestamp,
}) => {
  const dedupeKey = `${eventType}:${subject}:${clientId}:${sid || '*'}:${generation}`
  await db.run(
    `INSERT INTO identity_outbox
       (id, event_type, subject, client_id, sid, payload_json, status, attempts,
        next_attempt_at, dedupe_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)
     ON CONFLICT(dedupe_key) DO NOTHING`,
    randomUUID(),
    eventType,
    subject,
    clientId,
    sid,
    JSON.stringify({ generation }),
    timestamp,
    dedupeKey,
    timestamp,
    timestamp,
  )
}

export const confirmLogoutTransaction = async (
  db,
  {
    transactionToken,
    accountSessionToken,
    csrfToken,
    origin,
    referer,
  },
  { client, expectedOrigin, now = () => new Date() },
) => {
  assertExactBrowserSource({ origin, referer }, expectedOrigin)
  const tokenHash = hashOpaqueToken(transactionToken)
  if (!tokenHash) throw new LogoutBrokerError('INVALID_TOKEN', '退出事务无效')
  const nowDate = parseDate(now())
  const session = await getAccountCenterSession(db, accountSessionToken, {
    now: () => nowDate,
    touch: false,
  })
  if (!session) throw new LogoutBrokerError('ACCOUNT_SESSION_REQUIRED', '账号中心会话已失效')
  if (!verifyAccountCenterCsrf(session, csrfToken)) {
    throw new LogoutBrokerError('INVALID_CSRF', '退出确认 CSRF 无效')
  }

  return runSerialized(db, async () => {
    await db.exec('BEGIN IMMEDIATE')
    try {
      const transaction = await getUsableTransaction(db, tokenHash, nowDate)
      assertClient(client, transaction.client_id)
      if (transaction.status !== 'bound') {
        throw new LogoutBrokerError('ALREADY_CONSUMED', '退出事务已 consumed 或尚未绑定')
      }
      if (transaction.account_session_hash !== session.tokenHash
        || transaction.account_subject !== session.subject) {
        throw new LogoutBrokerError('ACCOUNT_MISMATCH', '退出事务与账号会话不匹配')
      }
      const claimed = await db.run(
        `UPDATE oidc_logout_transactions SET status = 'processing'
         WHERE token_hash = ? AND status = 'bound' AND account_session_hash = ?`,
        tokenHash,
        session.tokenHash,
      )
      if (claimed.changes !== 1) throw new LogoutBrokerError('RACE_LOST', '退出事务已被其他请求消费')

      const account = await db.get(
        `SELECT id, account_status, auth_generation FROM users WHERE account_subject = ?`,
        session.subject,
      )
      if (!account || account.account_status !== 'active'
        || account.auth_generation !== session.generation) {
        throw new LogoutBrokerError('ACCOUNT_NOT_ACTIVE', '账号状态或认证世代已变化')
      }
      const generation = account.auth_generation + 1
      const oidcSessions = await db.all(
        `SELECT DISTINCT client_id, sid FROM oidc_login_sessions
         WHERE account_subject = ? AND status <> 'revoked'`,
        session.subject,
      )
      const generationAdvanced = await db.run(
        `UPDATE users SET auth_generation = ? WHERE id = ? AND auth_generation = ?`,
        generation,
        account.id,
        account.auth_generation,
      )
      if (generationAdvanced.changes !== 1) {
        throw new LogoutBrokerError('RACE_LOST', '账号认证世代已变化，请重新发起退出')
      }
      await db.run(`DELETE FROM sessions WHERE user_id = ?`, account.id)
      await db.run(`DELETE FROM account_center_sessions WHERE account_subject = ?`, session.subject)
      await db.run(
        `UPDATE oidc_login_sessions
         SET status = 'revocation_pending', updated_at = ?
         WHERE account_subject = ? AND status <> 'revoked'`,
        nowDate.toISOString(),
        session.subject,
      )
      for (const oidcSession of oidcSessions) {
        await insertOutbox(db, {
          eventType: 'oidc.revoke_session',
          subject: session.subject,
          clientId: oidcSession.client_id,
          sid: oidcSession.sid,
          generation,
          timestamp: nowDate.toISOString(),
        })
      }
      for (const clientId of new Set([
        transaction.client_id,
        ...oidcSessions.map((oidcSession) => oidcSession.client_id),
      ])) {
        await insertOutbox(db, {
          eventType: 'oidc.revoke_consent',
          subject: session.subject,
          clientId,
          generation,
          timestamp: nowDate.toISOString(),
        })
      }
      await db.run(
        `UPDATE oidc_logout_transactions
         SET status = 'consumed', consumed_at = ? WHERE token_hash = ? AND status = 'processing'`,
        nowDate.toISOString(),
        tokenHash,
      )
      await db.exec('COMMIT')

      const callback = new URL(client.logoutCallbackUri)
      callback.searchParams.set('state', transaction.state)
      return {
        redirectTo: callback.toString(),
        subject: session.subject,
        clientId: transaction.client_id,
        sid: transaction.sid,
        generation,
      }
    } catch (error) {
      await db.exec('ROLLBACK').catch(() => undefined)
      throw error
    }
  })
}

export const issueLogoutReauthCsrf = async (
  db,
  transactionToken,
  { now = () => new Date(), randomCsrf = createOpaqueToken } = {},
) => {
  const tokenHash = hashOpaqueToken(transactionToken)
  if (!tokenHash) throw new LogoutBrokerError('INVALID_TOKEN', '退出事务无效')
  const nowDate = parseDate(now())
  await getUsableTransaction(db, tokenHash, nowDate)
  const csrfToken = randomCsrf()
  const csrfHash = hashOpaqueToken(csrfToken)
  const result = await db.run(
    `UPDATE oidc_logout_transactions SET browser_csrf_hash = ?
     WHERE token_hash = ? AND status = 'pending'`,
    csrfHash,
    tokenHash,
  )
  if (result.changes !== 1) throw new LogoutBrokerError('INVALID_STATUS', '退出事务不可重新认证')
  return csrfToken
}

export const verifyLogoutReauthCsrf = async (db, transactionToken, csrfToken) => {
  const tokenHash = hashOpaqueToken(transactionToken)
  if (!tokenHash) return false
  const row = await db.get(
    `SELECT browser_csrf_hash FROM oidc_logout_transactions
     WHERE token_hash = ? AND status = 'pending'`,
    tokenHash,
  )
  return Boolean(row?.browser_csrf_hash) && verifyOpaqueToken(row.browser_csrf_hash, csrfToken)
}
