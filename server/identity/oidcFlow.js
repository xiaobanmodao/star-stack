import {
  createOpaqueToken,
  hashOpaqueToken,
  verifyOpaqueToken,
} from './opaqueToken.js'
import { validateJieyaAuthorizationRequest } from './authorizationPolicy.js'
import { getAccountCenterSession } from '../services/accountCenterSession.js'

const INTERACTION_TTL_MS = 10 * 60 * 1000
const HYDRA_LOGIN_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60
const flowQueues = new WeakMap()

export class OidcFlowError extends Error {
  constructor(code, message, { status = 400, cause } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = 'OidcFlowError'
    this.code = code
    this.status = status
  }
}

const runSerialized = (db, operation) => {
  const previous = flowQueues.get(db) || Promise.resolve()
  const current = previous.catch(() => undefined).then(operation)
  flowQueues.set(db, current)
  return current.finally(() => {
    if (flowQueues.get(db) === current) flowQueues.delete(db)
  })
}

const asDate = (value) => {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new OidcFlowError('INVALID_TIME', 'OIDC 交互时间无效')
  return date
}

const assertChallenge = (value) => {
  if (typeof value !== 'string' || !value || value.length > 2048 || /\s/.test(value)) {
    throw new OidcFlowError('INVALID_CHALLENGE', 'OIDC challenge 格式无效')
  }
  return value
}

const registerInteraction = async (
  db,
  { challenge, type, clientId, session, nowDate },
) => {
  const challengeHash = hashOpaqueToken(challenge, 2048)
  if (!challengeHash) throw new OidcFlowError('INVALID_CHALLENGE', 'OIDC challenge 无法安全持久化')
  const expiresAt = new Date(nowDate.getTime() + INTERACTION_TTL_MS).toISOString()
  await db.run(
    `INSERT INTO oidc_interactions
       (challenge_hash, interaction_type, account_session_hash, account_subject,
        client_id, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(challenge_hash) DO NOTHING`,
    challengeHash,
    type,
    session?.tokenHash || null,
    session?.subject || null,
    clientId,
    session ? 'bound' : 'pending',
    nowDate.toISOString(),
    expiresAt,
  )
  const interaction = await db.get(
    `SELECT * FROM oidc_interactions WHERE challenge_hash = ?`,
    challengeHash,
  )
  if (!interaction) throw new OidcFlowError('INTERACTION_NOT_PERSISTED', 'OIDC challenge 未持久化')
  if (interaction.interaction_type !== type) {
    throw new OidcFlowError('INTERACTION_TYPE_CONFLICT', 'OIDC challenge 类型绑定冲突')
  }
  if (interaction.client_id !== clientId) {
    throw new OidcFlowError('INTERACTION_CLIENT_CONFLICT', 'OIDC challenge 客户端绑定冲突')
  }
  if (Date.parse(interaction.expires_at) <= nowDate.getTime()) {
    throw new OidcFlowError('INTERACTION_EXPIRED', 'OIDC challenge 已过期')
  }
  if (!['pending', 'bound'].includes(interaction.status)) {
    throw new OidcFlowError('INTERACTION_CONSUMED', 'OIDC challenge 已处理，不能重复使用', { status: 409 })
  }
  if (session) {
    if (interaction.account_subject && interaction.account_subject !== session.subject) {
      throw new OidcFlowError('ACCOUNT_MISMATCH', 'OIDC challenge 已绑定其他账号', { status: 403 })
    }
    await db.run(
      `UPDATE oidc_interactions
       SET account_session_hash = ?, account_subject = ?, status = 'bound'
       WHERE challenge_hash = ? AND status IN ('pending', 'bound')`,
      session.tokenHash,
      session.subject,
      challengeHash,
    )
  }
  return challengeHash
}

const claimInteraction = async (db, challengeHash, session) => runSerialized(db, async () => {
  await db.exec('BEGIN IMMEDIATE')
  try {
    const result = await db.run(
      `UPDATE oidc_interactions SET status = 'processing'
       WHERE challenge_hash = ? AND status = 'bound'
         AND account_session_hash = ? AND account_subject = ?`,
      challengeHash,
      session.tokenHash,
      session.subject,
    )
    if (result.changes !== 1) {
      throw new OidcFlowError('INTERACTION_CONSUMED', 'OIDC challenge 未绑定或已被消费', { status: 409 })
    }
    await db.exec('COMMIT')
  } catch (error) {
    await db.exec('ROLLBACK').catch(() => undefined)
    throw error
  }
})

const finishInteraction = async (db, challengeHash, status, nowDate) => {
  await db.run(
    `UPDATE oidc_interactions SET status = ?, consumed_at = ?
     WHERE challenge_hash = ? AND status = 'processing'`,
    status,
    nowDate.toISOString(),
    challengeHash,
  )
}

const loadSession = async (db, token, nowDate) => (
  token ? getAccountCenterSession(db, token, { now: () => nowDate }) : null
)

const toHydraSessionId = (tokenHash) => {
  if (typeof tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(tokenHash)) {
    throw new OidcFlowError('INVALID_ACCOUNT_SESSION', '账号中心会话标识无效', { status: 500 })
  }
  return tokenHash.slice(0, 40)
}

const assertRequestedScopes = (request, policy) => {
  const hydraScopes = Array.isArray(request.requested_scope) ? request.requested_scope : []
  if (hydraScopes.length !== policy.requestedScopes.length
    || hydraScopes.some((scope, index) => scope !== policy.requestedScopes[index])) {
    throw new OidcFlowError('SCOPE_MISMATCH', 'Hydra requested scope 与原始请求不一致')
  }
  if (Array.isArray(request.requested_access_token_audience)
    && request.requested_access_token_audience.length > 0) {
    throw new OidcFlowError('AUDIENCE_NOT_ALLOWED', 'Jieya 客户端不允许自定义 access token audience')
  }
}

export const prepareLogin = async (
  db,
  admin,
  { challenge: rawChallenge, accountSessionToken, client, now = () => new Date() },
) => {
  const challenge = assertChallenge(rawChallenge)
  const nowDate = asDate(now())
  const request = await admin.getLoginRequest(challenge)
  const policy = validateJieyaAuthorizationRequest(request, client)
  assertRequestedScopes(request, policy)
  const session = await loadSession(db, accountSessionToken, nowDate)
  if (request.skip && session && request.subject !== session.subject) {
    throw new OidcFlowError('SKIP_SUBJECT_MISMATCH', 'Hydra skip subject 与当前账号不匹配', { status: 403 })
  }
  const challengeHash = await registerInteraction(db, {
    challenge,
    type: 'login',
    clientId: client.id,
    session,
    nowDate,
  })
  return {
    challenge,
    challengeHash,
    request,
    policy,
    session,
    requiresAuthentication: !session,
    skipRequested: Boolean(request.skip),
  }
}

export const acceptLogin = async (db, admin, options) => {
  const prepared = await prepareLogin(db, admin, options)
  if (!prepared.session) {
    throw new OidcFlowError('ACCOUNT_SESSION_REQUIRED', '需要有效的账号中心会话', { status: 401 })
  }
  await claimInteraction(db, prepared.challengeHash, prepared.session)
  const hydraSessionId = toHydraSessionId(prepared.session.tokenHash)
  let result
  try {
    result = await admin.acceptLoginRequest(prepared.challenge, {
      subject: prepared.session.subject,
      // Hydra's sid-based headless revoke only performs Back-Channel Logout
      // for remembered login sessions. StarStack still revalidates every
      // skip=true request against its own account-center session.
      remember: true,
      remember_for: HYDRA_LOGIN_SESSION_TTL_SECONDS,
      identity_provider_session_id: hydraSessionId,
      context: {
        account_session_id: hydraSessionId,
        auth_generation: prepared.session.generation,
      },
    })
  } catch (cause) {
    throw new OidcFlowError('HYDRA_LOGIN_FAILED', 'Hydra login accept 失败', { status: 502, cause })
  }
  await finishInteraction(db, prepared.challengeHash, 'accepted', asDate(options.now?.() || new Date()))
  return { redirectTo: result.redirect_to }
}

export const prepareConsent = async (
  db,
  admin,
  { challenge: rawChallenge, accountSessionToken, client, now = () => new Date() },
) => {
  const challenge = assertChallenge(rawChallenge)
  const nowDate = asDate(now())
  const request = await admin.getConsentRequest(challenge)
  if (request?.client?.client_id !== client.id || request.subject === undefined) {
    throw new OidcFlowError('INVALID_CONSENT', 'Hydra consent request 客户端无效')
  }
  const policy = validateJieyaAuthorizationRequest(request, client)
  assertRequestedScopes(request, policy)
  const session = await loadSession(db, accountSessionToken, nowDate)
  if (!session) throw new OidcFlowError('ACCOUNT_SESSION_REQUIRED', '需要有效的账号中心会话', { status: 401 })
  if (request.subject !== session.subject) {
    throw new OidcFlowError('CONSENT_SUBJECT_MISMATCH', 'Consent subject 与账号会话不匹配', { status: 403 })
  }
  if (typeof request.login_session_id !== 'string' || !request.login_session_id
    || typeof request.consent_request_id !== 'string' || !request.consent_request_id) {
    throw new OidcFlowError('MISSING_SESSION_ID', 'Hydra consent 缺少 login_session_id 或 consent_request_id')
  }
  const challengeHash = await registerInteraction(db, {
    challenge,
    type: 'consent',
    clientId: client.id,
    session,
    nowDate,
  })
  return {
    challenge,
    challengeHash,
    request,
    session,
    requestedScopes: policy.requestedScopes,
    offlineAccessRequested: policy.offlineAccessRequested,
  }
}

export const acceptConsent = async (db, admin, options) => {
  const prepared = await prepareConsent(db, admin, options)
  if (prepared.offlineAccessRequested && options.offlineAccessConfirmed !== true) {
    throw new OidcFlowError('OFFLINE_CONSENT_REQUIRED', 'offline_access 必须由用户明确确认')
  }
  const nowDate = asDate(options.now?.() || new Date())
  await claimInteraction(db, prepared.challengeHash, prepared.session)

  const existing = await db.get(
    `SELECT id, account_subject, status FROM oidc_login_sessions
     WHERE client_id = ? AND sid = ?`,
    options.client.id,
    prepared.request.login_session_id,
  )
  if (existing && existing.account_subject !== prepared.session.subject) {
    throw new OidcFlowError('SID_SUBJECT_CONFLICT', 'Hydra sid 已绑定其他账号', { status: 409 })
  }
  if (!existing) {
    await db.run(
      `INSERT INTO oidc_login_sessions
         (account_subject, client_id, sid, auth_generation, consent_request_id,
          status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'authorization_pending', ?, ?)`,
      prepared.session.subject,
      options.client.id,
      prepared.request.login_session_id,
      prepared.session.generation,
      prepared.request.consent_request_id,
      nowDate.toISOString(),
      nowDate.toISOString(),
    )
  }

  let result
  try {
    result = await admin.acceptConsentRequest(prepared.challenge, {
      grant_scope: prepared.requestedScopes,
      grant_access_token_audience: [],
      remember: false,
      remember_for: 0,
      session: {
        access_token: {
          auth_generation: prepared.session.generation,
          grant_issued_at: nowDate.toISOString(),
        },
        id_token: {
          preferred_username: prepared.session.name,
          name: prepared.session.name,
        },
      },
    })
  } catch (cause) {
    throw new OidcFlowError('HYDRA_CONSENT_FAILED', 'Hydra consent accept 失败', { status: 502, cause })
  }
  await db.run(
    `UPDATE oidc_login_sessions
     SET auth_generation = ?, consent_request_id = ?, status = 'active', updated_at = ?
     WHERE client_id = ? AND sid = ? AND account_subject = ?`,
    prepared.session.generation,
    prepared.request.consent_request_id,
    nowDate.toISOString(),
    options.client.id,
    prepared.request.login_session_id,
    prepared.session.subject,
  )
  await finishInteraction(db, prepared.challengeHash, 'accepted', nowDate)
  return { redirectTo: result.redirect_to }
}

export const rejectConsent = async (db, admin, options) => {
  const prepared = await prepareConsent(db, admin, options)
  const nowDate = asDate(options.now?.() || new Date())
  await claimInteraction(db, prepared.challengeHash, prepared.session)
  let result
  try {
    result = await admin.rejectConsentRequest(prepared.challenge, {
      error: 'access_denied',
      error_description: 'The resource owner denied the request.',
    })
  } catch (cause) {
    throw new OidcFlowError('HYDRA_CONSENT_REJECT_FAILED', 'Hydra consent reject 失败', {
      status: 502,
      cause,
    })
  }
  await finishInteraction(db, prepared.challengeHash, 'rejected', nowDate)
  return { redirectTo: result.redirect_to }
}

export const issueInteractionCsrf = async (
  db,
  challenge,
  { randomCsrf = createOpaqueToken } = {},
) => {
  const challengeHash = hashOpaqueToken(assertChallenge(challenge), 2048)
  const csrfToken = randomCsrf()
  const csrfHash = hashOpaqueToken(csrfToken)
  const result = await db.run(
    `UPDATE oidc_interactions SET csrf_hash = ?
     WHERE challenge_hash = ? AND status IN ('pending', 'bound')`,
    csrfHash,
    challengeHash,
  )
  if (result.changes !== 1) throw new OidcFlowError('INTERACTION_NOT_FOUND', 'OIDC 交互不存在或已消费')
  return csrfToken
}

export const verifyInteractionCsrf = async (db, challenge, csrfToken) => {
  const challengeHash = hashOpaqueToken(assertChallenge(challenge), 2048)
  const row = await db.get(
    `SELECT csrf_hash FROM oidc_interactions
     WHERE challenge_hash = ? AND status IN ('pending', 'bound')`,
    challengeHash,
  )
  return Boolean(row?.csrf_hash) && verifyOpaqueToken(row.csrf_hash, csrfToken)
}
