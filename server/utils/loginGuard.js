// 按 IP 失败计数，5 次失败后锁定 10 分钟
const loginFailures = new Map() // ip -> { count, lockedUntil }
const MAX_LOGIN_FAILURES = 5
const LOGIN_LOCK_MS = 10 * 60 * 1000

export const checkLoginLock = (ip) => {
  const entry = loginFailures.get(ip)
  if (!entry) return false
  if (entry.lockedUntil && entry.lockedUntil > Date.now()) return true
  if (entry.lockedUntil && entry.lockedUntil <= Date.now()) loginFailures.delete(ip)
  return false
}

export const recordLoginFailure = (ip) => {
  const entry = loginFailures.get(ip) || { count: 0, lockedUntil: 0 }
  entry.count += 1
  if (entry.count >= MAX_LOGIN_FAILURES) {
    entry.lockedUntil = Date.now() + LOGIN_LOCK_MS
    entry.count = 0
  }
  loginFailures.set(ip, entry)
}

export const clearLoginFailures = (ip) => loginFailures.delete(ip)
