const AUTHORIZATION_PENDING_RETENTION_MS = 15 * 60 * 1000
const REVOKED_LOGIN_SESSION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

const asDate = (value) => {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid identity retention time')
  return date
}

export const cleanupIdentityRetention = async (
  db,
  {
    now = () => new Date(),
    authorizationPendingRetentionMs = AUTHORIZATION_PENDING_RETENTION_MS,
    revokedRetentionMs = REVOKED_LOGIN_SESSION_RETENTION_MS,
  } = {},
) => {
  const nowDate = asDate(now())
  const expiredActive = await db.run(
    `DELETE FROM oidc_login_sessions
     WHERE status = 'active' AND expires_at <= ?`,
    nowDate.toISOString(),
  )
  const staleAuthorizationPending = await db.run(
    `DELETE FROM oidc_login_sessions
     WHERE status = 'authorization_pending' AND updated_at <= ?`,
    new Date(nowDate.getTime() - authorizationPendingRetentionMs).toISOString(),
  )
  const oldRevoked = await db.run(
    `DELETE FROM oidc_login_sessions
     WHERE status = 'revoked' AND COALESCE(revoked_at, updated_at) <= ?`,
    new Date(nowDate.getTime() - revokedRetentionMs).toISOString(),
  )
  return {
    expiredActive: expiredActive.changes || 0,
    staleAuthorizationPending: staleAuthorizationPending.changes || 0,
    oldRevoked: oldRevoked.changes || 0,
  }
}
