import { hasSessionCookie } from './auth.js'

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const originFromReferer = (referer) => {
  if (!referer) return null
  try { return new URL(referer).origin } catch { return null }
}

/**
 * Cookie sessions need a same-origin check in addition to SameSite=Lax.
 * Bearer-token clients remain compatible and are intentionally not blocked.
 */
export const createCsrfProtection = ({ allowedOrigins = [], isProduction = false } = {}) => {
  const trustedOrigins = new Set(allowedOrigins.filter(Boolean))
  return (req, res, next) => {
    if (!STATE_CHANGING_METHODS.has(req.method) || !hasSessionCookie(req)) return next()

    const origin = req.get('origin') || originFromReferer(req.get('referer'))
    // Native clients and same-origin tools may omit both headers. SameSite
    // still protects browser cookie requests in that case.
    if (!origin) return next()
    if (trustedOrigins.has(origin)) return next()
    if (!isProduction && origin === `${req.protocol}://${req.get('host')}`) return next()

    return res.status(403).json({ message: '请求来源不受信任' })
  }
}
