import {
  IdentityOutboxCapacityError,
  MAX_UNRESOLVED_IDENTITY_OUTBOX_EVENTS_PER_GENERATION,
  enqueueIdentityOutboxEvent,
} from './identityOutboxStore.js'
import { runIdentityOperation } from './identityOperation.js'

export const CONNECTED_APPLICATION_ID = 'jieya'

const JIEYA_METADATA = Object.freeze({
  id: CONNECTED_APPLICATION_ID,
  name: '界芽计划',
  description: '本地优先的创造型世界沙盒。登录是可选的，游客模式与本地存档不受影响。',
  homepage: 'https://jieya.xingzhan.cc',
  permissions: Object.freeze([
    Object.freeze({
      id: 'identity',
      label: '识别你的星栈账号',
      description: '使用不可变账号标识建立界芽自己的应用会话。',
    }),
    Object.freeze({
      id: 'profile',
      label: '读取基础资料',
      description: '读取昵称和头像；不会获得管理员权限、密码、邮箱或 OJ 数据。',
    }),
    Object.freeze({
      id: 'offline_access',
      label: '保持登录',
      description: '仅在授权页明确同意后启用，授权族最长 30 天。',
    }),
  ]),
})

export class ConnectedApplicationError extends Error {
  constructor(code, message, { status = 400 } = {}) {
    super(message)
    this.name = 'ConnectedApplicationError'
    this.code = code
    this.status = status
  }
}
const asDate = (value) => {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) {
    throw new ConnectedApplicationError('INVALID_TIMESTAMP', '连接状态时间无效', { status: 500 })
  }
  return date
}

const assertClient = (client) => {
  if (!client || typeof client.id !== 'string' || !client.id) {
    throw new ConnectedApplicationError('INVALID_CLIENT', '连接应用配置无效', { status: 500 })
  }
  return client
}

const getAccount = async (db, accountId) => {
  if (typeof accountId !== 'string' || !accountId) {
    throw new ConnectedApplicationError('INVALID_ACCOUNT', '账号无效')
  }
  const account = await db.get(
    `SELECT id, account_subject, account_status, auth_generation
     FROM users WHERE id = ?`,
    accountId,
  )
  if (!account) {
    throw new ConnectedApplicationError('ACCOUNT_NOT_FOUND', '账号不存在', { status: 404 })
  }
  if (account.account_status !== 'active') {
    throw new ConnectedApplicationError('ACCOUNT_NOT_ACTIVE', '账号当前不可用', { status: 403 })
  }
  return account
}

const serializeApplication = ({ status, connectedAt = null, sessionCount = 0 }) => ({
  ...JIEYA_METADATA,
  permissions: JIEYA_METADATA.permissions.map((permission) => ({ ...permission })),
  status,
  connectedAt,
  sessionCount,
  canRevoke: status === 'connected',
})

export const listConnectedApplications = async (
  db,
  { accountId, client, now = () => new Date() },
) => {
  const configuredClient = assertClient(client)
  const account = await getAccount(db, accountId)
  const nowDate = asDate(now())
  const sessions = await db.all(
    `SELECT status, created_at, expires_at
     FROM oidc_login_sessions
     WHERE account_subject = ? AND client_id = ? AND status <> 'revoked'`,
    account.account_subject,
    configuredClient.id,
  )
  const active = sessions.filter((session) => (
    session.status === 'active' && Date.parse(session.expires_at) > nowDate.getTime()
  ))
  const pendingSession = sessions.some((session) => session.status === 'revocation_pending')
  const pendingOutbox = await db.get(
    `SELECT COUNT(*) AS count FROM identity_outbox
     WHERE subject = ? AND client_id = ?
       AND event_type IN ('oidc.revoke_session', 'oidc.revoke_consent')
       AND status IN ('pending', 'processing', 'dead')`,
    account.account_subject,
    configuredClient.id,
  )
  const revocationPending = pendingSession || (pendingOutbox?.count || 0) > 0
  if (revocationPending) {
    return [serializeApplication({ status: 'revocation_pending' })]
  }
  if (active.length === 0) {
    return [serializeApplication({ status: 'not_connected' })]
  }
  const connectedAt = active
    .map((session) => session.created_at)
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0]
  return [serializeApplication({
    status: 'connected',
    connectedAt,
    sessionCount: active.length,
  })]
}

export const revokeConnectedApplication = async (
  db,
  {
    accountId,
    applicationId,
    client,
    now = () => new Date().toISOString(),
  },
) => {
  if (applicationId !== CONNECTED_APPLICATION_ID) {
    throw new ConnectedApplicationError('APPLICATION_NOT_FOUND', '应用不存在', { status: 404 })
  }
  const configuredClient = assertClient(client)
  const timestamp = asDate(now()).toISOString()

  return runIdentityOperation(db, async () => {
    await db.exec('BEGIN IMMEDIATE')
    try {
      const account = await getAccount(db, accountId)
      await db.run(
        `DELETE FROM oidc_login_sessions
         WHERE account_subject = ? AND status = 'active' AND expires_at <= ?`,
        account.account_subject,
        timestamp,
      )
      const sessions = await db.all(
        `SELECT client_id, sid, status
         FROM oidc_login_sessions
         WHERE account_subject = ? AND status <> 'revoked'
         ORDER BY client_id, sid
         LIMIT ?`,
        account.account_subject,
        MAX_UNRESOLVED_IDENTITY_OUTBOX_EVENTS_PER_GENERATION + 1,
      )
      const unsupportedClient = sessions.find((session) => session.client_id !== configuredClient.id)
      if (unsupportedClient) {
        throw new ConnectedApplicationError(
          'UNSUPPORTED_CLIENT_STATE',
          '账号存在尚未识别的应用授权，已停止自动撤销',
          { status: 503 },
        )
      }
      if (sessions.length + 1 > MAX_UNRESOLVED_IDENTITY_OUTBOX_EVENTS_PER_GENERATION) {
        throw new IdentityOutboxCapacityError(
          'IDENTITY_OUTBOX_GENERATION_FANOUT_EXCEEDED',
          'Connected application revocation exceeds the identity outbox generation capacity',
        )
      }

      const actionable = sessions.filter((session) => (
        session.status === 'active' || session.status === 'authorization_pending'
      ))
      const alreadyPending = sessions.some((session) => session.status === 'revocation_pending')
      if (actionable.length === 0) {
        await db.exec('COMMIT')
        return {
          changed: false,
          status: alreadyPending ? 'revocation_pending' : 'not_connected',
        }
      }

      const generation = account.auth_generation + 1
      const updated = await db.run(
        `UPDATE users SET auth_generation = ?
         WHERE id = ? AND auth_generation = ? AND account_status = 'active'`,
        generation,
        account.id,
        account.auth_generation,
      )
      if (updated.changes !== 1) {
        throw new ConnectedApplicationError(
          'ACCOUNT_STATE_CHANGED',
          '账号安全状态已变化，请重试',
          { status: 409 },
        )
      }

      await db.run(
        `DELETE FROM account_center_sessions WHERE account_subject = ?`,
        account.account_subject,
      )
      await db.run(
        `UPDATE oidc_login_sessions
         SET status = 'revocation_pending', updated_at = ?
         WHERE account_subject = ? AND client_id = ? AND status <> 'revoked'`,
        timestamp,
        account.account_subject,
        configuredClient.id,
      )

      for (const session of sessions) {
        await enqueueIdentityOutboxEvent(db, {
          eventType: 'oidc.revoke_session',
          subject: account.account_subject,
          clientId: configuredClient.id,
          sid: session.sid,
          generation,
          timestamp,
        })
      }
      await enqueueIdentityOutboxEvent(db, {
        eventType: 'oidc.revoke_consent',
        subject: account.account_subject,
        clientId: configuredClient.id,
        generation,
        timestamp,
      })

      await db.exec('COMMIT')
      return { changed: true, status: 'revocation_pending', generation }
    } catch (error) {
      await db.exec('ROLLBACK').catch(() => undefined)
      throw error
    }
  })
}
