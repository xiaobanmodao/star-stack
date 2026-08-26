// 单进程长连接上限，避免一个账号或大量账号耗尽 Node/Nginx 连接资源。
// 多实例部署时还需要在负载均衡层配置 limit_conn，或改为共享存储计数。
export const createConnectionLimiter = ({ maxTotal = 200, maxPerKey = 4 } = {}) => {
  const counts = new Map()
  let total = 0

  const tryAcquire = (key) => {
    const normalizedKey = String(key || 'anonymous')
    const current = counts.get(normalizedKey) || 0
    if (total >= maxTotal || current >= maxPerKey) return null
    counts.set(normalizedKey, current + 1)
    total += 1
    let released = false
    return () => {
      if (released) return
      released = true
      total = Math.max(0, total - 1)
      const next = (counts.get(normalizedKey) || 1) - 1
      if (next > 0) counts.set(normalizedKey, next)
      else counts.delete(normalizedKey)
    }
  }

  return {
    tryAcquire,
    get total() { return total },
  }
}

export const sseConnectionLimiter = createConnectionLimiter({ maxTotal: 200, maxPerKey: 4 })
