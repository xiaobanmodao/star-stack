import fs from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_BACKUP_DIR = '/www/backup/starstack'
const BACKUP_MAX_AGE_SECONDS = 26 * 60 * 60

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

export const collectSystemMetrics = async ({ db, judge }) => {
  const [submissionStatus, users, problems, revisions, history, backup] = await Promise.all([
    db.all(`SELECT status, COUNT(*) AS count FROM submissions GROUP BY status`),
    db.get(`SELECT COUNT(*) AS count FROM users`),
    db.get(`SELECT COUNT(*) AS count FROM problems`),
    db.get(`SELECT COUNT(*) AS count FROM problem_revisions`),
    db.get(`SELECT COUNT(*) AS count FROM problem_status_history`),
    getBackupHealth(),
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
    },
    judge,
    backup,
  }
}

export const isBackupFresh = (backup) => Boolean(backup?.healthy)
