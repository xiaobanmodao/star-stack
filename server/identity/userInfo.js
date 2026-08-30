export class UserInfoError extends Error {
  constructor(code, message, { status = 401, cause } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = 'UserInfoError'
    this.code = code
    this.status = status
  }
}
export const resolveUserInfo = async (db, admin, accessToken, { client }) => {
  if (typeof accessToken !== 'string' || !accessToken || accessToken.length > 2048) {
    throw new UserInfoError('INVALID_TOKEN', 'Access Token 格式无效')
  }
  let introspection
  try { introspection = await admin.introspectToken(accessToken) } catch (cause) {
    throw new UserInfoError('INTROSPECTION_FAILED', 'Token introspection 失败', { status: 503, cause })
  }
  const scopes = new Set(
    typeof introspection?.scope === 'string'
      ? introspection.scope.split(/\s+/).filter(Boolean)
      : [],
  )
  if (!introspection?.active
    || introspection.client_id !== client.id
    || introspection.token_use !== 'access_token'
    || !scopes.has('openid')
    || [...scopes].some((scope) => !client.allowedScopes.includes(scope))
    || typeof introspection.sub !== 'string') {
    throw new UserInfoError('INACTIVE_TOKEN', 'Access Token 不满足 UserInfo 策略')
  }
  const generation = introspection.ext?.auth_generation
  if (!Number.isInteger(generation) || generation < 0) {
    throw new UserInfoError('INVALID_GENERATION', 'Token 缺少有效认证世代')
  }
  const account = await db.get(
    `SELECT name, avatar, account_status, auth_generation
     FROM users WHERE account_subject = ?`,
    introspection.sub,
  )
  if (!account || account.account_status !== 'active') {
    throw new UserInfoError('ACCOUNT_NOT_ACTIVE', '账号不是 active 状态', { status: 403 })
  }
  if (account.auth_generation !== generation) {
    throw new UserInfoError('GENERATION_MISMATCH', 'Token 认证世代已失效')
  }
  const result = {
    sub: introspection.sub,
    preferred_username: account.name,
    name: account.name,
  }
  if (account.avatar) result.picture = account.avatar
  return result
}
