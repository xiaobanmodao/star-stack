// 按 IP 失败计数，5 次失败后锁定 10 分钟
const loginFailures = new Map() // ip -> { count, lockedUntil }
const MAX_LOGIN_FAILURES = 5
const LOGIN_LOCK_MS = 10 * 60 * 1000
const MAX_LOGIN_FAILURE_KEYS = 10000

const pruneLoginFailures = (now = Date.now()) => {
  for (const [ip, entry] of loginFailures) {
    if (now - (entry.lastSeenAt || 0) >= LOGIN_LOCK_MS && (!entry.lockedUntil || entry.lockedUntil <= now)) {
      loginFailures.delete(ip)
    }
  }
}

const makeRoomForKey = (ip, now) => {
  pruneLoginFailures(now)
  if (loginFailures.has(ip) || loginFailures.size < MAX_LOGIN_FAILURE_KEYS) return
  const oldest = loginFailures.keys().next().value
  if (oldest !== undefined) loginFailures.delete(oldest)
}

export const checkLoginLock = (ip) => {
  pruneLoginFailures()
  const entry = loginFailures.get(ip)
  if (!entry) return false
  if (entry.lockedUntil && entry.lockedUntil > Date.now()) return true
  if (entry.lockedUntil && entry.lockedUntil <= Date.now()) loginFailures.delete(ip)
  return false
}

export const recordLoginFailure = (ip) => {
  const now = Date.now()
  makeRoomForKey(ip, now)
  const entry = loginFailures.get(ip) || { count: 0, lockedUntil: 0, lastSeenAt: now }
  entry.count += 1
  if (entry.count >= MAX_LOGIN_FAILURES) {
    entry.lockedUntil = now + LOGIN_LOCK_MS
    entry.count = 0
  }
  entry.lastSeenAt = now
  loginFailures.set(ip, entry)
}

export const getLoginFailureCount = (ip) => {
  pruneLoginFailures()
  return loginFailures.get(ip)?.count || 0
}

export const clearLoginFailures = (ip) => loginFailures.delete(ip)
