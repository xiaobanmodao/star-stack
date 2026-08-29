import { randomUUID } from 'node:crypto'
import { ACCOUNT_STATUSES } from '../utils/accountIdentityMigration.js'
import { runIdentityOperation } from './identityOperation.js'

const statusSet = new Set(ACCOUNT_STATUSES)

export class AccountLifecycleError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AccountLifecycleError'
    this.code = code
  }
}

const assertTimestamp = (value) => {
  if (typeof value !== 'string' || !value.trim() || !Number.isFinite(Date.parse(value))) {
    throw new AccountLifecycleError('INVALID_TIMESTAMP', '账号状态时间无效')
  }
  return value
}

const enqueueIdentityEvent = async (
  db,
  { eventType, subject, clientId = null, sid = null, generation, timestamp },
) => {
  const dedupeKey = `${eventType}:${subject}:${clientId || '*'}:${sid || '*'}:${generation}`
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

const revokeIdentitySessions = async (db, { accountId, subject, generation, eventType, timestamp }) => {
  const loginSessions = await db.all(
    `SELECT client_id, sid FROM oidc_login_sessions
     WHERE account_subject = ? AND status <> 'revoked'`,
    subject,
  )
  await db.run(
    `UPDATE oidc_login_sessions
     SET status = 'revocation_pending', updated_at = ?
     WHERE account_subject = ? AND status <> 'revoked'`,
    timestamp,
    subject,
  )
  await db.run(`DELETE FROM account_center_sessions WHERE account_subject = ?`, subject)
  await db.run(`DELETE FROM sessions WHERE user_id = ?`, accountId)

  await enqueueIdentityEvent(db, {
    eventType,
    subject,
    generation,
    timestamp,
  })
  for (const session of loginSessions) {
    await enqueueIdentityEvent(db, {
      eventType: 'oidc.revoke_session',
      subject,
      clientId: session.client_id,
      sid: session.sid,
      generation,
      timestamp,
    })
  }
  for (const clientId of new Set(loginSessions.map((session) => session.client_id))) {
    await enqueueIdentityEvent(db, {
      eventType: 'oidc.revoke_consent',
      subject,
      clientId,
      generation,
      timestamp,
    })
  }
}

export const transitionAccountStatus = async (
  db,
  {
    accountId,
    status,
    now = () => new Date().toISOString(),
    validate,
  },
) => {
  if (typeof accountId !== 'string' || !accountId) {
    throw new AccountLifecycleError('INVALID_ACCOUNT_ID', '账号 ID 无效')
  }
  if (!statusSet.has(status)) {
    throw new AccountLifecycleError('INVALID_STATUS', '账号状态无效')
  }
  const transitionTime = assertTimestamp(now())

  return runIdentityOperation(db, async () => {
    await db.exec('BEGIN IMMEDIATE')
    try {
      const account = await db.get(
        `SELECT id, account_status, account_subject, auth_generation, is_admin, is_banned
         FROM users WHERE id = ?`,
        accountId,
      )
      if (!account) throw new AccountLifecycleError('NOT_FOUND', '用户不存在')
      if (account.account_status === 'deleted' && status !== 'deleted') {
        throw new AccountLifecycleError('TERMINAL_STATUS', '已注销账号是终态，不可恢复')
      }
      if (typeof validate === 'function') await validate({ db, account, status })

      if (account.account_status === status) {
        await db.exec('COMMIT')
        return { id: accountId, status, generation: account.auth_generation, changed: false }
      }

      const generation = account.auth_generation + 1

      if (status === 'deleted') {
        await db.run(
          `UPDATE users
           SET account_status = 'deleted',
               account_tombstoned_at = COALESCE(account_tombstoned_at, ?),
               is_banned = 1,
               is_admin = 0,
               name = '已注销用户',
               password_hash = '!tombstoned-account',
               email = NULL,
               email_verified_at = NULL,
               avatar = NULL,
               bio = '',
               avatar_frame = 'none',
               avatar_overlay = 'none',
               equipped_title = NULL,
               auth_generation = ?
           WHERE id = ?`,
          transitionTime,
          generation,
          accountId,
        )
      } else {
        await db.run(
          `UPDATE users
           SET account_status = ?, account_tombstoned_at = NULL, is_banned = ?,
               auth_generation = ?
           WHERE id = ?`,
          status,
          status === 'suspended' ? 1 : 0,
          generation,
          accountId,
        )
      }

      await revokeIdentitySessions(db, {
        accountId,
        subject: account.account_subject,
        generation,
        eventType: `account.${status}`,
        timestamp: transitionTime,
      })
      await db.exec('COMMIT')
      return { id: accountId, status, generation, changed: true }
    } catch (error) {
      await db.exec('ROLLBACK').catch(() => undefined)
      throw error
    }
  })
}

export const changeAccountPassword = async (
  db,
  {
    accountId,
    passwordHash,
    now = () => new Date().toISOString(),
  },
) => {
  if (typeof accountId !== 'string' || !accountId) {
    throw new AccountLifecycleError('INVALID_ACCOUNT_ID', '账号 ID 无效')
  }
  if (typeof passwordHash !== 'string' || !passwordHash) {
    throw new AccountLifecycleError('INVALID_PASSWORD_HASH', '密码摘要无效')
  }
  const changedAt = assertTimestamp(now())

  return runIdentityOperation(db, async () => {
    await db.exec('BEGIN IMMEDIATE')
    try {
      const account = await db.get(
        `SELECT id, account_subject, account_status, auth_generation
         FROM users WHERE id = ?`,
        accountId,
      )
      if (!account) throw new AccountLifecycleError('NOT_FOUND', '用户不存在')
      if (account.account_status === 'deleted') {
        throw new AccountLifecycleError('TERMINAL_STATUS', '已注销账号不可修改密码')
      }
      const generation = account.auth_generation + 1
      const updated = await db.run(
        `UPDATE users SET password_hash = ?, auth_generation = ?
         WHERE id = ? AND auth_generation = ? AND account_status <> 'deleted'`,
        passwordHash,
        generation,
        accountId,
        account.auth_generation,
      )
      if (updated.changes !== 1) {
        throw new AccountLifecycleError('RACE_LOST', '账号安全状态已变化，请重试')
      }
      await revokeIdentitySessions(db, {
        accountId,
        subject: account.account_subject,
        generation,
        eventType: 'account.password_changed',
        timestamp: changedAt,
      })
      await db.exec('COMMIT')
      return { id: accountId, generation }
    } catch (error) {
      await db.exec('ROLLBACK').catch(() => undefined)
      throw error
    }
  })
}
