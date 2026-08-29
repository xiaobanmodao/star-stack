import express, { Router } from 'express'
import bcrypt from 'bcryptjs'
import { createRateLimiter } from '../middleware/rateLimit.js'
import { JIEYA_BROWSER_ORIGINS } from './config.js'
import { hashOpaqueToken, verifyOpaqueToken } from './opaqueToken.js'
import { validateHydraTokenHook, TokenPolicyError } from './tokenPolicy.js'
import { resolveUserInfo, UserInfoError } from './userInfo.js'
import {
  OidcFlowError,
  acceptConsent,
  acceptLogin,
  issueInteractionCsrf,
  prepareConsent,
  prepareLogin,
  rejectConsent,
  verifyInteractionCsrf,
} from './oidcFlow.js'
import {
  createAccountCenterSession,
  establishAccountCenterSession,
  getAccountCenterSession,
  revokeAccountCenterSession,
  rotateAccountCenterCsrf,
} from '../services/accountCenterSession.js'
import {
  bindLogoutTransaction,
  confirmLogoutTransaction,
  createLogoutTransaction,
  issueLogoutReauthCsrf,
  verifyLogoutReauthCsrf,
} from '../services/logoutBroker.js'
import { processIdentityOutboxGeneration } from '../services/identityOutbox.js'
import {
  IdentityOperationCapacityError,
  acquireIdentityOperation,
} from '../services/identityOperation.js'
import { createPasswordAttemptLimiter } from './passwordRateLimit.js'

const ACCOUNT_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
const MAX_PASSWORD_LENGTH = 128
const DEFAULT_IDENTITY_LIMITS = Object.freeze({
  accountRate: Object.freeze({ windowMs: 60_000, perSourceMax: 60, globalMax: 300 }),
  userInfoRate: Object.freeze({ windowMs: 60_000, perSourceMax: 300, globalMax: 600 }),
  passwordRate: Object.freeze({
    windowMs: 10 * 60 * 1000,
    perAccountMax: 20,
    globalMax: 200,
    maxTrackedAccounts: 512,
  }),
  publicQueueMaxPending: 32,
  criticalQueueMaxPending: 64,
  userInfoMaxConcurrent: 16,
})
const getIdentityCsp = (production) => {
  const jieyaOrigin = production
    ? JIEYA_BROWSER_ORIGINS.production
    : JIEYA_BROWSER_ORIGINS.local
  return [
    "default-src 'none'",
    "base-uri 'none'",
    `form-action 'self' ${jieyaOrigin}`,
    "frame-ancestors 'none'",
    "style-src 'unsafe-inline'",
  ].join('; ')
}

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

const page = (title, body) => `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · 星栈账号中心</title>
  <style>
    :root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#050816;color:#eef2ff}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 20% 10%,#172554 0,transparent 38%),#050816}
    main{width:min(460px,100%);padding:28px;border:1px solid #334155;border-radius:20px;background:rgba(15,23,42,.94);box-shadow:0 24px 80px rgba(0,0,0,.45)}
    h1{font-size:1.45rem;margin:0 0 8px}p{color:#cbd5e1;line-height:1.6}label{display:grid;gap:7px;margin:16px 0;color:#dbeafe}
    input[type=text],input[type=password]{width:100%;padding:12px 14px;border:1px solid #475569;border-radius:10px;background:#0f172a;color:#fff;font:inherit}
    input:focus-visible,button:focus-visible{outline:3px solid #60a5fa;outline-offset:2px}
    button{width:100%;margin-top:12px;padding:12px 16px;border:0;border-radius:10px;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;font:700 inherit;cursor:pointer}
    .scope{display:flex;align-items:center;gap:10px;padding:10px 0;color:#dbeafe}.muted{font-size:.9rem;color:#94a3b8}.error{color:#fecaca}
  </style>
</head>
<body><main>${body}</main></body>
</html>`

const loginForm = ({ action, hiddenName, hiddenValue, csrfToken, title = '登录星栈账号', message = '' }) => page(title, `
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(message || '使用星栈账号继续。密码只提交到星栈账号中心。')}</p>
  <form method="post" action="${escapeHtml(action)}" autocomplete="on">
    <input type="hidden" name="${escapeHtml(hiddenName)}" value="${escapeHtml(hiddenValue)}">
    <input type="hidden" name="csrf_token" value="${escapeHtml(csrfToken)}">
    <label>账号 ID<input name="id" type="text" maxlength="64" required autocomplete="username"></label>
    <label>密码<input name="password" type="password" maxlength="128" required autocomplete="current-password"></label>
    <button type="submit">继续</button>
  </form>`)

const getCookies = (req) => {
  const result = {}
  for (const part of String(req.headers.cookie || '').split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    const name = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (!name) continue
    try { result[name] = decodeURIComponent(value) } catch { result[name] = value }
  }
  return result
}

const appendSetCookie = (res, value) => {
  const current = res.getHeader('Set-Cookie')
  if (!current) res.setHeader('Set-Cookie', value)
  else res.setHeader('Set-Cookie', [...(Array.isArray(current) ? current : [current]), value])
}

const setAccountCookie = (res, config, token) => {
  const flags = [
    `${config.accountCookieName}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    `Max-Age=${ACCOUNT_SESSION_MAX_AGE_SECONDS}`,
    'SameSite=Lax',
    ...(config.production ? ['Secure'] : []),
  ]
  appendSetCookie(res, flags.join('; '))
}

const clearAccountCookie = (res, config) => {
  appendSetCookie(res, [
    `${config.accountCookieName}=`,
    'HttpOnly',
    'Path=/',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'SameSite=Lax',
    ...(config.production ? ['Secure'] : []),
  ].join('; '))
}

const getAccountToken = (req, config) => getCookies(req)[config.accountCookieName] || null

const createIdentityHeaders = (config) => (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  // Identity forms require an exact same-origin Referer in addition to Origin
  // and CSRF. This policy retains it for same-origin POSTs without leaking the
  // account URL to Jieya or any other cross-origin destination.
  res.setHeader('Referrer-Policy', 'same-origin')
  // The browser may evaluate form-action across Hydra's redirect chain. Keep
  // the only cross-origin target frozen by deployment mode; never source it
  // from request data or an arbitrary environment value.
  res.setHeader('Content-Security-Policy', getIdentityCsp(config.production))
  next()
}

const exactSource = (req, config, pathname) => {
  if (req.get('origin') !== config.issuer) return false
  let referer
  try { referer = new URL(req.get('referer')) } catch { return false }
  return referer.origin === config.issuer && referer.pathname === pathname
}

const privateCredentialMatches = (req, headerName, secret) => {
  const storedHash = hashOpaqueToken(secret)
  return Boolean(storedHash) && verifyOpaqueToken(storedHash, req.get(headerName))
}

const readBearer = (req) => {
  const match = String(req.get('authorization') || '').match(/^Bearer ([^\s]{1,2048})$/)
  return match?.[1] || null
}

const sendHtmlError = (res, status, message) => res.status(status).type('html').send(page(
  '操作未完成',
  `<h1>操作未完成</h1><p class="error">${escapeHtml(message)}</p><p class="muted">请返回发起登录的应用后重试。</p>`,
))

const reportIdentityFailure = (operation, error) => {
  const name = typeof error?.name === 'string' ? error.name : 'Error'
  const code = typeof error?.code === 'string' ? error.code : 'UNCLASSIFIED'
  const status = Number.isInteger(error?.status) ? error.status : undefined
  console.warn(`[identity] ${operation} failed`, { name, code, status })
}

const normalizeCredentials = (body) => ({
  id: typeof body?.id === 'string' ? body.id.trim() : '',
  password: typeof body?.password === 'string' ? body.password : '',
})

const authenticateAccount = async (db, body, comparePassword) => {
  const { id, password } = normalizeCredentials(body)
  if (!id || id.length > 64 || password.length < 6 || password.length > MAX_PASSWORD_LENGTH) return null
  const account = await db.get(
    `SELECT id, password_hash, account_status FROM users WHERE id = ?`,
    id,
  )
  if (!account || account.account_status !== 'active') return null
  return (await comparePassword(password, account.password_hash)) ? account : null
}

const mergeLimits = (limits = {}) => ({
  ...DEFAULT_IDENTITY_LIMITS,
  ...limits,
  accountRate: { ...DEFAULT_IDENTITY_LIMITS.accountRate, ...limits.accountRate },
  userInfoRate: { ...DEFAULT_IDENTITY_LIMITS.userInfoRate, ...limits.userInfoRate },
  passwordRate: { ...DEFAULT_IDENTITY_LIMITS.passwordRate, ...limits.passwordRate },
})

const createDualRateLimit = ({ windowMs, perSourceMax, globalMax }, message) => {
  const perSource = createRateLimiter({ windowMs, max: perSourceMax, message })
  const global = createRateLimiter({
    windowMs,
    max: globalMax,
    message,
    keyGenerator: () => 'identity-global',
  })
  return (req, res, next) => perSource(req, res, (error) => {
    if (error) return next(error)
    return global(req, res, next)
  })
}

const createConcurrencyLimit = (max, message) => {
  let active = 0
  return (req, res, next) => {
    if (active >= max) return res.status(503).json({ error: 'temporarily_unavailable', message })
    active += 1
    let released = false
    const release = () => {
      if (released) return
      released = true
      active -= 1
    }
    res.once('finish', release)
    res.once('close', release)
    return next()
  }
}

const requirePrivateCredential = (headerName, secret) => (req, res, next) => {
  if (!privateCredentialMatches(req, headerName, secret)) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  return next()
}

export const createIdentityRouter = ({
  getDb,
  getPublicDb = getDb,
  getUserInfoDb = getDb,
  getCriticalDb = getDb,
  admin,
  config,
  now = () => new Date(),
  limits: limitOverrides,
  comparePassword = bcrypt.compare,
}) => {
  const router = Router()
  const limits = mergeLimits(limitOverrides)
  const jsonParser = express.json({ limit: '32kb', type: 'application/json' })
  const formParser = express.urlencoded({ extended: false, limit: '16kb' })
  const loginLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000,
    max: 20,
    message: '登录请求过于频繁，请稍后再试',
  })
  const passwordAttemptLimiter = createPasswordAttemptLimiter(limits.passwordRate)
  const consumePasswordAttempt = (req, res) => {
    const result = passwordAttemptLimiter.consume(req.body?.id, now())
    const limit = result.scope === 'account'
      ? limits.passwordRate.perAccountMax
      : limits.passwordRate.globalMax
    res.setHeader('RateLimit-Limit', String(limit))
    if (!result.limited) return true
    res.setHeader('RateLimit-Remaining', '0')
    res.setHeader('Retry-After', String(result.retryAfter))
    sendHtmlError(res, 429, '密码尝试过于频繁，请稍后再试。')
    return false
  }
  const requireExactAccountSource = (pathname) => (req, res, next) => (
    exactSource(req, config, pathname)
      ? next()
      : sendHtmlError(res, 403, '请求来源验证失败。')
  )
  const accountGetLimiter = createDualRateLimit(
    limits.accountRate,
    '账号中心请求过于频繁，请稍后再试',
  )
  const userInfoLimiter = createDualRateLimit(
    limits.userInfoRate,
    'UserInfo 请求过于频繁，请稍后再试',
  )
  const userInfoConcurrency = createConcurrencyLimit(
    limits.userInfoMaxConcurrent,
    'UserInfo 当前负载已满',
  )

  router.use(['/account', '/oauth2/userinfo', '/internal/oidc'], createIdentityHeaders(config))
  router.use('/account', (req, res, next) => (
    req.method === 'GET' ? accountGetLimiter(req, res, next) : next()
  ))
  router.use('/account', async (req, res, next) => {
    try {
      const db = await getPublicDb()
      const release = await acquireIdentityOperation(db, {
        maxPending: limits.publicQueueMaxPending,
      })
      if (req.aborted || res.destroyed) {
        release()
        return
      }
      req.identityDb = db
      let released = false
      const releaseOnce = () => {
        if (released) return
        released = true
        release()
      }
      res.once('finish', releaseOnce)
      res.once('close', releaseOnce)
      next()
    } catch (error) {
      if (error instanceof IdentityOperationCapacityError) {
        return sendHtmlError(res, 503, '账号中心当前负载已满，请稍后重试。')
      }
      next(error)
    }
  })

  const runCritical = async (operation) => {
    const db = await getCriticalDb()
    const release = await acquireIdentityOperation(db, {
      maxPending: limits.criticalQueueMaxPending,
    })
    try {
      return await operation(db)
    } finally {
      release()
    }
  }

  router.post(
    '/internal/oidc/token-hook',
    requirePrivateCredential(config.tokenHookHeader, config.tokenHookSecret),
    jsonParser,
    async (req, res) => {
      try {
        await runCritical((db) => validateHydraTokenHook(
          db,
          req.body,
          { client: config.client, now },
        ))
        return res.status(204).end()
      } catch (error) {
        reportIdentityFailure('token hook', error)
        if (error instanceof TokenPolicyError) {
          const request = req.body?.request
          console.warn('[identity] token hook rejected shape', {
            grantTypes: Array.isArray(request?.grant_types) ? request.grant_types.length : -1,
            requestedScopes: Array.isArray(request?.requested_scopes) ? request.requested_scopes.length : -1,
            grantedScopes: Array.isArray(request?.granted_scopes) ? request.granted_scopes.length : -1,
            payloadGrantTypes: Array.isArray(request?.payload?.grant_type)
              ? request.payload.grant_type.length
              : -1,
            hasSessionExtra: Boolean(req.body?.session?.extra),
            hasSubject: typeof req.body?.session?.id_token?.subject === 'string',
          })
        }
        if (error instanceof TokenPolicyError) return res.status(403).json({ error: 'access_denied' })
        return res.status(503).json({ error: 'temporarily_unavailable' })
      }
    },
  )

  router.post(
    '/internal/oidc/logout-transactions',
    requirePrivateCredential(config.logoutBrokerHeader, config.logoutBrokerSecret),
    jsonParser,
    async (req, res) => {
      try {
        const result = await runCritical((db) => createLogoutTransaction(db, {
          subject: req.body?.subject,
          sid: req.body?.sid,
          clientId: req.body?.client_id,
          state: req.body?.state,
        }, { client: config.client, issuer: config.issuer, now }))
        return res.status(201).json({ url: result.url, expires_at: result.expiresAt })
      } catch (error) {
        const status = error instanceof IdentityOperationCapacityError ? 503 : (error?.status || 400)
        return res.status(status).json({
          error: status === 503 ? 'temporarily_unavailable' : 'invalid_logout_transaction',
        })
      }
    },
  )

  router.get('/oauth2/userinfo', userInfoLimiter, userInfoConcurrency, async (req, res) => {
    const token = readBearer(req)
    if (!token) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="userinfo"')
      return res.status(401).json({ error: 'invalid_token' })
    }
    try {
      const db = await getUserInfoDb()
      return res.json(await resolveUserInfo(db, admin, token, { client: config.client }))
    } catch (error) {
      const status = error instanceof UserInfoError ? error.status : 503
      if (status === 401) res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"')
      return res.status(status).json({ error: status === 503 ? 'temporarily_unavailable' : 'invalid_token' })
    }
  })

  router.get('/account/login', async (req, res) => {
    const challenge = req.query.login_challenge
    const accountSessionToken = getAccountToken(req, config)
    let provisionalSession = false
    try {
      const db = req.identityDb
      const prepared = await prepareLogin(db, admin, {
        challenge,
        accountSessionToken,
        client: config.client,
        now,
      })
      provisionalSession = Boolean(prepared.session?.provisional)
      if (prepared.session) {
        const accepted = await acceptLogin(db, admin, {
          challenge,
          accountSessionToken,
          client: config.client,
          now,
        })
        return res.redirect(303, accepted.redirectTo)
      }
      const csrfToken = await issueInteractionCsrf(db, challenge)
      return res.type('html').send(loginForm({
        action: '/account/login',
        hiddenName: 'login_challenge',
        hiddenValue: challenge,
        csrfToken,
      }))
    } catch (error) {
      if (provisionalSession) {
        await revokeAccountCenterSession(
          req.identityDb,
          accountSessionToken,
          { provisionalOnly: true },
        ).catch(() => undefined)
      }
      reportIdentityFailure('login preparation', error)
      return sendHtmlError(res, error?.status === 503 ? 503 : 400, '登录请求无效、已过期或暂时不可用。')
    }
  })

  router.post(
    '/account/login',
    loginLimiter,
    formParser,
    requireExactAccountSource('/account/login'),
    async (req, res) => {
    let createdSessionToken = null
    const challenge = req.body?.login_challenge
    try {
      const db = req.identityDb
      if (!(await verifyInteractionCsrf(db, challenge, req.body?.csrf_token))) {
        return sendHtmlError(res, 403, '登录表单已过期，请重新发起登录。')
      }
      if (!consumePasswordAttempt(req, res)) return undefined
      const account = await authenticateAccount(db, req.body, comparePassword)
      if (!account) return sendHtmlError(res, 401, '账号或密码错误，或账号不可用。')
      const session = await createAccountCenterSession(db, { userId: account.id, now })
      createdSessionToken = session.token
      const accepted = await acceptLogin(db, admin, {
        challenge,
        accountSessionToken: session.token,
        client: config.client,
        now,
      })
      setAccountCookie(res, config, session.token)
      return res.redirect(303, accepted.redirectTo)
    } catch (error) {
      if (createdSessionToken) {
        await revokeAccountCenterSession(req.identityDb, createdSessionToken).catch(() => undefined)
      }
      reportIdentityFailure('login acceptance', error)
      return sendHtmlError(res, error?.status === 503 ? 503 : 400, '登录请求已失效，请重新发起。')
    }
  })

  router.get('/account/consent', async (req, res) => {
    const challenge = req.query.consent_challenge
    const accountSessionToken = getAccountToken(req, config)
    let provisionalSession = false
    try {
      const db = req.identityDb
      const currentSession = await getAccountCenterSession(db, accountSessionToken, {
        now,
        touch: false,
      })
      provisionalSession = Boolean(currentSession?.provisional)
      const prepared = await prepareConsent(db, admin, {
        challenge,
        accountSessionToken,
        client: config.client,
        now,
      })
      const csrfToken = await rotateAccountCenterCsrf(db, prepared.session)
      const scopes = prepared.requestedScopes.map((scope) => `
        <div class="scope"><span aria-hidden="true">✦</span><span>${escapeHtml(scope)}</span></div>`).join('')
      const offline = prepared.offlineAccessRequested
        ? '<label class="scope"><input type="checkbox" name="offline_access_confirmed" value="yes" required>允许界芽保持登录（可随时退出）</label>'
        : ''
      return res.type('html').send(page('授权界芽', `
        <h1>授权界芽计划</h1><p>界芽将获得以下最小账号信息：</p>${scopes}
        <form method="post" action="/account/consent">
          <input type="hidden" name="consent_challenge" value="${escapeHtml(challenge)}">
          <input type="hidden" name="csrf_token" value="${escapeHtml(csrfToken)}">
          ${offline}
          <button type="submit" name="decision" value="approve">确认授权</button>
          <button type="submit" name="decision" value="deny" formnovalidate>拒绝授权</button>
        </form>`))
    } catch (error) {
      if (provisionalSession) {
        await revokeAccountCenterSession(
          req.identityDb,
          accountSessionToken,
          { provisionalOnly: true },
        ).catch(() => undefined)
      }
      reportIdentityFailure('consent preparation', error)
      return sendHtmlError(res, error?.status === 503 ? 503 : 401, '账号会话或授权请求已失效，请重新登录。')
    }
  })

  router.post('/account/consent', formParser, async (req, res) => {
    if (!exactSource(req, config, '/account/consent')) return sendHtmlError(res, 403, '请求来源验证失败。')
    const accountSessionToken = getAccountToken(req, config)
    let provisionalSession = false
    try {
      const db = req.identityDb
      const session = await getAccountCenterSession(db, accountSessionToken, { now })
      provisionalSession = Boolean(session?.provisional)
      if (!session || !verifyOpaqueToken(session.csrfHash, req.body?.csrf_token)) {
        if (provisionalSession) {
          await revokeAccountCenterSession(db, accountSessionToken, { provisionalOnly: true })
        }
        return sendHtmlError(res, 403, '授权表单已失效。')
      }
      const operation = req.body?.decision === 'deny' ? rejectConsent : acceptConsent
      const accepted = await operation(db, admin, {
        challenge: req.body?.consent_challenge,
        accountSessionToken,
        offlineAccessConfirmed: req.body?.offline_access_confirmed === 'yes',
        client: config.client,
        now,
      })
      if (operation === rejectConsent || accepted.capacityRejected) {
        if (provisionalSession) {
          await revokeAccountCenterSession(db, accountSessionToken, { provisionalOnly: true })
        }
      } else if (!(await establishAccountCenterSession(db, accountSessionToken, { now }))) {
        throw new OidcFlowError(
          'ACCOUNT_SESSION_ESTABLISH_FAILED',
          '账号中心会话在授权完成前失效',
          { status: 503 },
        )
      }
      return res.redirect(303, accepted.redirectTo)
    } catch (error) {
      if (provisionalSession) {
        await revokeAccountCenterSession(
          req.identityDb,
          accountSessionToken,
          { provisionalOnly: true },
        ).catch(() => undefined)
      }
      reportIdentityFailure('consent decision', error)
      return sendHtmlError(res, error?.status === 503 ? 503 : 400, '授权请求无效或已消费。')
    }
  })

  router.get('/account/logout', async (req, res) => {
    const transaction = req.query.transaction
    try {
      const db = req.identityDb
      const accountSessionToken = getAccountToken(req, config)
      const session = await getAccountCenterSession(db, accountSessionToken, { now })
      if (!session) {
        const csrfToken = await issueLogoutReauthCsrf(db, transaction, { now })
        return res.type('html').send(loginForm({
          action: '/account/logout/login',
          hiddenName: 'transaction',
          hiddenValue: transaction,
          csrfToken,
          title: '重新验证账号',
          message: '全局退出前需要重新验证当前星栈账号。此步骤不会立即注销任何会话。',
        }))
      }
      const bound = await bindLogoutTransaction(db, {
        transactionToken: transaction,
        accountSessionToken,
      }, { now })
      const csrfToken = await rotateAccountCenterCsrf(db, session)
      return res.type('html').send(page('确认全局退出', `
        <h1>确认全局退出</h1>
        <p>将退出星栈账号中心和已知的界芽会话。这个操作不会删除界芽本地存档。</p>
        <p class="muted">当前账号：${escapeHtml(session.name)} · 应用：${escapeHtml(bound.clientId)}</p>
        <form method="post" action="/account/logout">
          <input type="hidden" name="transaction" value="${escapeHtml(transaction)}">
          <input type="hidden" name="csrf_token" value="${escapeHtml(csrfToken)}">
          <button type="submit">确认全局退出</button>
        </form>`))
    } catch (error) {
      return sendHtmlError(
        res,
        error?.status === 503 ? 503 : 400,
        '退出事务无效、已过期或与当前账号不匹配。',
      )
    }
  })

  router.post(
    '/account/logout/login',
    loginLimiter,
    formParser,
    requireExactAccountSource('/account/logout'),
    async (req, res) => {
    let createdSessionToken = null
    try {
      const db = req.identityDb
      if (!(await verifyLogoutReauthCsrf(db, req.body?.transaction, req.body?.csrf_token))) {
        return sendHtmlError(res, 403, '重新验证表单已失效。')
      }
      if (!consumePasswordAttempt(req, res)) return undefined
      const account = await authenticateAccount(db, req.body, comparePassword)
      if (!account) return sendHtmlError(res, 401, '账号或密码错误，或账号不可用。')
      const session = await createAccountCenterSession(db, { userId: account.id, now })
      createdSessionToken = session.token
      if (!(await establishAccountCenterSession(db, session.token, { now }))) {
        throw new Error('Account-center logout reauthentication session disappeared')
      }
      await bindLogoutTransaction(db, {
        transactionToken: req.body?.transaction,
        accountSessionToken: session.token,
      }, { now })
      setAccountCookie(res, config, session.token)
      const redirect = new URL('/account/logout', config.issuer)
      redirect.searchParams.set('transaction', req.body.transaction)
      return res.redirect(303, redirect.toString())
    } catch (error) {
      if (createdSessionToken) {
        await revokeAccountCenterSession(req.identityDb, createdSessionToken).catch(() => undefined)
      }
      return sendHtmlError(res, error?.status === 503 ? 503 : 400, '重新验证失败，请重新发起全局退出。')
    }
  })

  router.post('/account/logout', formParser, async (req, res) => {
    if (!exactSource(req, config, '/account/logout')) return sendHtmlError(res, 403, '请求来源验证失败。')
    try {
      const db = req.identityDb
      const confirmed = await confirmLogoutTransaction(db, {
        transactionToken: req.body?.transaction,
        accountSessionToken: getAccountToken(req, config),
        csrfToken: req.body?.csrf_token,
        origin: req.get('origin'),
        referer: req.get('referer'),
      }, {
        client: config.client,
        expectedOrigin: config.issuer,
        now,
      })
      clearAccountCookie(res, config)
      try {
        await processIdentityOutboxGeneration(db, admin, {
          subject: confirmed.subject,
          generation: confirmed.generation,
          now,
          operationLocked: true,
        })
      } catch (error) {
        reportIdentityFailure('logout outbox immediate drain', error)
      }
      return res.redirect(303, confirmed.redirectTo)
    } catch (error) {
      return sendHtmlError(
        res,
        error?.status === 503 ? 503 : 400,
        '退出事务已消费、过期或验证失败。',
      )
    }
  })

  router.get('/account/error', (_req, res) => sendHtmlError(res, 400, '授权请求未完成。'))

  router.use((error, req, res, next) => {
    if (!req.path.startsWith('/account')
      && !req.path.startsWith('/oauth2/userinfo')
      && !req.path.startsWith('/internal/oidc')) return next(error)
    if (res.headersSent) return next(error)
    if (req.path.startsWith('/account')) return sendHtmlError(res, 400, '请求格式无效。')
    return res.status(400).json({ error: 'invalid_request' })
  })

  return router
}
