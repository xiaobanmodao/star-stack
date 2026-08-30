import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_BACKUP_DIR = '/www/backup/starstack'
const BACKUP_MAX_AGE_SECONDS = 26 * 60 * 60
const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_DB_PATH = path.resolve(process.env.DB_PATH || path.join(SERVER_ROOT, 'data', 'starstack.sqlite'))
const DATABASE_HEALTH_CACHE_MS = 60 * 1000
const databaseHealthCache = new WeakMap()

export const formatBytes = (value) => {
  const bytes = Number(value) || 0
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

export const getBackupHealth = async (backupDir = process.env.BACKUP_DIR || DEFAULT_BACKUP_DIR) => {
  try {
    const entries = await fs.readdir(backupDir, { withFileTypes: true })
    const files = await Promise.all(entries
      .filter((entry) => entry.isFile() && /^starstack_.*\.db\.gz$/.test(entry.name))
      .map(async (entry) => {
        const filePath = path.join(backupDir, entry.name)
        const stat = await fs.stat(filePath)
        return { name: entry.name, sizeBytes: stat.size, updatedAt: stat.mtime.toISOString() }
      }))
    files.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    const latest = files[0] || null
    const ageSeconds = latest ? Math.max(0, Math.round((Date.now() - new Date(latest.updatedAt).getTime()) / 1000)) : null
    return {
      directory: backupDir,
      latest: latest ? { ...latest, size: formatBytes(latest.sizeBytes) } : null,
      ageSeconds,
      healthy: ageSeconds !== null && ageSeconds <= BACKUP_MAX_AGE_SECONDS,
      retentionCount: files.length,
    }
  } catch {
    return { directory: backupDir, latest: null, ageSeconds: null, healthy: false, retentionCount: 0 }
  }
}

const formatPercent = (value) => `${Math.round(Math.max(0, Math.min(100, value)))}%`

export const getDiskHealth = async (targetPath = process.env.DISK_CHECK_PATH || path.dirname(DEFAULT_DB_PATH)) => {
  try {
    if (typeof fs.statfs !== 'function') return { path: targetPath, available: false, healthy: true }
    const stats = await fs.statfs(targetPath)
    const blockSize = Number(stats.bsize || stats.frsize || 0)
    const totalBytes = Number(stats.blocks || 0) * blockSize
    const freeBytes = Number(stats.bavail || stats.bfree || 0) * blockSize
    const usedPercent = totalBytes > 0 ? ((totalBytes - freeBytes) / totalBytes) * 100 : 0
    return {
      path: targetPath,
      available: true,
      totalBytes,
      freeBytes,
      total: formatBytes(totalBytes),
      free: formatBytes(freeBytes),
      usedPercent: formatPercent(usedPercent),
      healthy: usedPercent < 90,
    }
  } catch {
    return { path: targetPath, available: false, healthy: false }
  }
}

export const getDatabaseHealth = async (db) => {
  const cached = databaseHealthCache.get(db)
  if (cached && Date.now() - cached.checkedAt < DATABASE_HEALTH_CACHE_MS) return cached.value
  try {
    const result = await db.get('PRAGMA integrity_check')
    const integrity = String(result?.integrity_check || '').toLowerCase()
    const value = { integrity: integrity || 'unknown', healthy: integrity === 'ok' }
    databaseHealthCache.set(db, { checkedAt: Date.now(), value })
    return value
  } catch {
    const value = { integrity: 'unavailable', healthy: false }
    databaseHealthCache.set(db, { checkedAt: Date.now(), value })
    return value
  }
}

export const collectSystemMetrics = async ({ db, judge }) => {
  const [submissionStatus, users, problems, revisions, history, backup, disk, database, clientErrors] = await Promise.all([
    db.all(`SELECT status, COUNT(*) AS count FROM submissions GROUP BY status`),
    db.get(`SELECT COUNT(*) AS count FROM users`),
    db.get(`SELECT COUNT(*) AS count FROM problems`),
    db.get(`SELECT COUNT(*) AS count FROM problem_revisions`),
    db.get(`SELECT COUNT(*) AS count FROM problem_status_history`),
    getBackupHealth(),
    getDiskHealth(),
    getDatabaseHealth(db),
    db.get(`SELECT COUNT(*) AS count FROM client_errors WHERE created_at >= ?`, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
  ])
  const memory = process.memoryUsage()
  return {
    process: {
      uptimeSeconds: Math.round(process.uptime()),
      rssBytes: memory.rss,
      rss: formatBytes(memory.rss),
      heapUsedBytes: memory.heapUsed,
      heapUsed: formatBytes(memory.heapUsed),
    },
    database: {
      users: users?.count || 0,
      problems: problems?.count || 0,
      revisions: revisions?.count || 0,
      statusHistory: history?.count || 0,
      submissions: Object.fromEntries(submissionStatus.map((row) => [row.status, row.count])),
      ...database,
    },
    judge,
    backup,
    disk,
    clientErrors24h: clientErrors?.count || 0,
  }
}

export const isBackupFresh = (backup) => Boolean(backup?.healthy)
