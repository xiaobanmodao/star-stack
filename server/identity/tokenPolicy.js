import { randomUUID } from 'node:crypto'

export const REFRESH_ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const CLOCK_SKEW_MS = 60 * 1000

export class TokenPolicyError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'TokenPolicyError'
    this.code = code
  }
}

const asStringArray = (value, name) => {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string')) {
    throw new TokenPolicyError('MALFORMED_REQUEST', `${name} has malformed format`)
  }
  return value
}

const queueExpiredGrantCleanup = async (db, {
  subject, clientId, generation, timestamp,
}) => {
  const eventType = 'oidc.revoke_consent'
  const dedupeKey = `${eventType}:${subject}:${clientId}:*:${generation}`
  await db.run(
    `INSERT INTO identity_outbox
       (id, event_type, subject, client_id, sid, payload_json, status, attempts,
        next_attempt_at, dedupe_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, 'pending', 0, ?, ?, ?, ?)
     ON CONFLICT(dedupe_key) DO NOTHING`,
    randomUUID(),
    eventType,
    subject,
    clientId,
    JSON.stringify({ generation }),
    timestamp,
    dedupeKey,
    timestamp,
    timestamp,
  )
}

export const validateHydraTokenHook = async (
  db,
  payload,
  { client, now = () => new Date() },
) => {
  const request = payload?.request
  const idToken = payload?.session?.id_token
  const extra = payload?.session?.extra
  const subject = idToken?.subject || idToken?.id_token_claims?.sub
  if (!request || !extra || typeof subject !== 'string') {
    throw new TokenPolicyError('MALFORMED_SESSION', 'Hydra session payload is malformed')
  }
  if (!client || request.client_id !== client.id) {
    throw new TokenPolicyError('INVALID_CLIENT', 'Token client is not registered')
  }
  const grantTypes = asStringArray(request.grant_types, 'grant_types')
  const requestedScopes = asStringArray(request.requested_scopes, 'requested_scopes')
  const grantedScopes = request.granted_scopes
  if (!Array.isArray(grantedScopes)
    || grantedScopes.some((scope) => typeof scope !== 'string')) {
    throw new TokenPolicyError('MALFORMED_REQUEST', 'granted_scopes has malformed format')
  }
  // Hydra v26.2.0 invokes the authorization_code hook before copying the
  // consented scopes into granted_scopes. Its official hook payload still
  // carries that exact set in requested_scopes; refresh hooks populate both.
  const scopes = grantedScopes.length > 0 ? grantedScopes : requestedScopes
  if (grantTypes.some((grant) => !client.allowedGrantTypes.includes(grant))) {
    throw new TokenPolicyError('INVALID_GRANT', 'Token grant is not allowed')
  }
  if (scopes.some((scope) => !client.allowedScopes.includes(scope))) {
    throw new TokenPolicyError('INVALID_SCOPE', 'Token scope is not allowed')
  }
  if (!scopes.includes('openid') || new Set(scopes).size !== scopes.length) {
    throw new TokenPolicyError('INVALID_SCOPE', 'Token scope must be unique and include openid')
  }
  if (!Number.isInteger(extra.auth_generation) || extra.auth_generation < 0) {
    throw new TokenPolicyError('INVALID_GENERATION', 'Hydra auth_generation is malformed')
  }

  const account = await db.get(
    `SELECT account_status, auth_generation FROM users WHERE account_subject = ?`,
    subject,
  )
  if (!account || account.account_status !== 'active') {
    throw new TokenPolicyError('ACCOUNT_NOT_ACTIVE', 'Account is not active')
  }
  if (account.auth_generation !== extra.auth_generation) {
    throw new TokenPolicyError('GENERATION_MISMATCH', 'Account auth generation/世代 does not match')
  }

  const issuedAt = Date.parse(extra.grant_issued_at)
  const nowValue = now()
  const nowDate = nowValue instanceof Date ? nowValue : new Date(nowValue)
  const currentTime = nowDate.getTime()
  if (!Number.isFinite(issuedAt)) {
    throw new TokenPolicyError('INVALID_GRANT_TIME', 'Hydra grant_issued_at is malformed')
  }
  if (issuedAt > currentTime + CLOCK_SKEW_MS || currentTime - issuedAt > REFRESH_ABSOLUTE_TTL_MS) {
    if (issuedAt <= currentTime + CLOCK_SKEW_MS) {
      await queueExpiredGrantCleanup(db, {
        subject,
        clientId: client.id,
        generation: account.auth_generation,
        timestamp: nowDate.toISOString(),
      })
    }
    throw new TokenPolicyError('GRANT_EXPIRED', 'The 30-day grant absolute期限 has expired')
  }
  return { subject, generation: account.auth_generation }
}
