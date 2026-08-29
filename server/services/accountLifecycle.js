import { ACCOUNT_STATUSES } from '../utils/accountIdentityMigration.js'

const statusSet = new Set(ACCOUNT_STATUSES)
const transactionQueues = new WeakMap()

export class AccountLifecycleError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AccountLifecycleError'
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

const assertTimestamp = (value) => {
  if (typeof value !== 'string' || !value.trim() || !Number.isFinite(Date.parse(value))) {
    throw new AccountLifecycleError('INVALID_TIMESTAMP', '账号状态时间无效')
  }
  return value
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

  return runSerialized(db, async () => {
    await db.exec('BEGIN IMMEDIATE')
    try {
      const account = await db.get(
        `SELECT id, account_status, account_subject, is_admin, is_banned
         FROM users WHERE id = ?`,
        accountId,
      )
      if (!account) throw new AccountLifecycleError('NOT_FOUND', '用户不存在')
      if (account.account_status === 'deleted' && status !== 'deleted') {
        throw new AccountLifecycleError('TERMINAL_STATUS', '已注销账号是终态，不可恢复')
      }
      if (typeof validate === 'function') await validate({ db, account, status })

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
               equipped_title = NULL
           WHERE id = ?`,
          transitionTime,
          accountId,
        )
      } else {
        await db.run(
          `UPDATE users
           SET account_status = ?, account_tombstoned_at = NULL, is_banned = ?
           WHERE id = ?`,
          status,
          status === 'suspended' ? 1 : 0,
          accountId,
        )
      }

      await db.run(`DELETE FROM sessions WHERE user_id = ?`, accountId)
      await db.exec('COMMIT')
      return { id: accountId, status }
    } catch (error) {
      await db.exec('ROLLBACK').catch(() => undefined)
      throw error
    }
  })
}
