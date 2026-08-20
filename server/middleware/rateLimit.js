const getClientKey = (req) => req.ip || req.socket?.remoteAddress || 'unknown'

const pruneState = (state, now, windowMs, maxKeys, preserveKey) => {
  for (const [key, entry] of state) {
    if (now - entry.startedAt >= windowMs) state.delete(key)
  }
  if (state.size >= maxKeys && !state.has(preserveKey)) {
    const oldestKey = state.keys().next().value
    if (oldestKey !== undefined) state.delete(oldestKey)
  }
}

export const consumeRateLimit = (state, key, { now = Date.now(), windowMs, max }) => {
  pruneState(state, now, windowMs, 10000, key)
  const previous = state.get(key)
  const entry = !previous || now - previous.startedAt >= windowMs
    ? { startedAt: now, count: 0 }
    : previous
  entry.count += 1
  state.set(key, entry)
  const limited = entry.count > max
  return {
    limited,
    count: entry.count,
    remaining: Math.max(0, max - entry.count),
    retryAfter: limited ? Math.max(1, Math.ceil((windowMs - (now - entry.startedAt)) / 1000)) : 0,
  }
}

export const createRateLimiter = ({ windowMs, max, message = '请求过于频繁，请稍后再试', keyGenerator = getClientKey }) => {
  const state = new Map()
  return (req, res, next) => {
    const result = consumeRateLimit(state, String(keyGenerator(req)), { windowMs, max })
    res.setHeader('RateLimit-Limit', String(max))
    res.setHeader('RateLimit-Remaining', String(result.remaining))
    if (result.limited) {
      res.setHeader('Retry-After', String(result.retryAfter))
      return res.status(429).json({ message, retryAfter: result.retryAfter })
    }
    return next()
  }
}
