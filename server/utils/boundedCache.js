// 带容量上限和 TTL 的 LRU 缓存，防止内存泄漏
export class BoundedCache {
  constructor(maxSize = 500, ttlMs = 0) {
    this._map = new Map()
    this._maxSize = maxSize
    this._ttlMs = ttlMs // 0 = 不过期
  }
  has(key) {
    if (!this._map.has(key)) return false
    if (this._ttlMs && Date.now() - this._map.get(key).ts > this._ttlMs) {
      this._map.delete(key)
      return false
    }
    return true
  }
  get(key) {
    if (!this.has(key)) return undefined
    const entry = this._map.get(key)
    // LRU: 移到末尾
    this._map.delete(key)
    this._map.set(key, entry)
    return entry.v
  }
  set(key, value) {
    this._map.delete(key)
    if (this._map.size >= this._maxSize) {
      // 淘汰最旧的条目
      const oldest = this._map.keys().next().value
      this._map.delete(oldest)
    }
    this._map.set(key, { v: value, ts: Date.now() })
  }
  delete(key) { this._map.delete(key) }
  get size() { return this._map.size }
  entries() { return this._map.entries() }
}
