import { createOpaqueToken, hashOpaqueToken, verifyOpaqueToken } from '../identity/opaqueToken.js'

export const ACCOUNT_CENTER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

const asDate = (value) => {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid account-center session timestamp')
  return date
}

export const createAccountCenterSession = async (
  db,
  {
    userId,
    now = () => new Date(),
    randomToken = createOpaqueToken,
    randomCsrf = createOpaqueToken,
  },
) => {
  const account = await db.get(
    `SELECT id, account_subject, account_status, auth_generation
     FROM users WHERE id = ?`,
    userId,
  )
  if (!account || account.account_status !== 'active') throw new Error('Account is not active')

  const token = randomToken()
  const csrfToken = randomCsrf()
  const tokenHash = hashOpaqueToken(token)
  const csrfHash = hashOpaqueToken(csrfToken)
  if (!tokenHash || !csrfHash) throw new Error('Failed to generate account-center session material')
  const createdAt = asDate(now())
  const expiresAt = new Date(createdAt.getTime() + ACCOUNT_CENTER_SESSION_TTL_MS)

  await db.run(
    `INSERT INTO account_center_sessions
       (token_hash, user_id, account_subject, auth_generation, csrf_hash,
        created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    tokenHash,
    account.id,
    account.account_subject,
    account.auth_generation,
    csrfHash,
    createdAt.toISOString(),
    expiresAt.toISOString(),
    createdAt.toISOString(),
  )
  return {
    token,
    csrfToken,
    subject: account.account_subject,
    generation: account.auth_generation,
    expiresAt: expiresAt.toISOString(),
  }
}

export const getAccountCenterSession = async (
  db,
  token,
  { now = () => new Date(), touch = true } = {},
) => {
  const tokenHash = hashOpaqueToken(token)
  if (!tokenHash) return null
  const row = await db.get(
    `SELECT s.token_hash, s.user_id, s.account_subject, s.auth_generation,
            s.csrf_hash, s.expires_at,
            u.account_status, u.auth_generation AS current_generation,
            u.name, u.password_hash
     FROM account_center_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`,
    tokenHash,
  )
  if (!row) return null

  const nowDate = asDate(now())
  const valid = row.account_status === 'active'
    && row.auth_generation === row.current_generation
    && Date.parse(row.expires_at) > nowDate.getTime()
  if (!valid) {
    await db.run(`DELETE FROM account_center_sessions WHERE token_hash = ?`, tokenHash)
    return null
  }
  if (touch) {
    await db.run(
      `UPDATE account_center_sessions SET last_seen_at = ? WHERE token_hash = ?`,
      nowDate.toISOString(),
      tokenHash,
    )
  }
  return {
    tokenHash: row.token_hash,
    userId: row.user_id,
    subject: row.account_subject,
    generation: row.auth_generation,
    csrfHash: row.csrf_hash,
    expiresAt: row.expires_at,
    accountStatus: row.account_status,
    name: row.name,
    passwordHash: row.password_hash,
  }
}

export const verifyAccountCenterCsrf = (session, csrfToken) => (
  Boolean(session?.csrfHash) && verifyOpaqueToken(session.csrfHash, csrfToken)
)

export const rotateAccountCenterCsrf = async (
  db,
  session,
  { randomCsrf = createOpaqueToken } = {},
) => {
  const csrfToken = randomCsrf()
  const csrfHash = hashOpaqueToken(csrfToken)
  if (!session?.tokenHash || !csrfHash) throw new Error('Cannot rotate account-center CSRF')
  const result = await db.run(
    `UPDATE account_center_sessions SET csrf_hash = ? WHERE token_hash = ?`,
    csrfHash,
    session.tokenHash,
  )
  if (result.changes !== 1) throw new Error('Account-center session disappeared during CSRF rotation')
  session.csrfHash = csrfHash
  return csrfToken
}
