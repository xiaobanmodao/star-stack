#!/usr/bin/env node
// 只读验证当前 SQLite 数据库完整性，不执行迁移、不修改用户数据。
import sqlite3 from 'sqlite3'
import { open } from 'sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const databasePath = process.env.DB_PATH || path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'starstack.sqlite')
const requiredTables = [
  'users', 'sessions', 'problems', 'testcases', 'submissions',
  'user_stats', 'daily_activity', 'solved_problems',
]
const requiredColumns = {
  users: ['id', 'name', 'password_hash', 'email', 'is_admin', 'is_banned', 'avatar', 'avatar_frame', 'avatar_overlay', 'equipped_title'],
  sessions: ['token', 'user_id', 'created_at'],
  problems: ['id', 'slug', 'title', 'difficulty', 'tags', 'topic_tags', 'technique_tags', 'estimated_minutes', 'recommended_for', 'quality_status', 'editorial_status', 'revision_summary', 'status', 'creator_id'],
  testcases: ['id', 'problem_id', 'input', 'output', 'is_sample', 'time_limit_ms'],
  submissions: ['id', 'problem_id', 'user_id', 'language', 'code', 'status', 'time_ms', 'results_json', 'score', 'queue_position', 'started_at', 'finished_at', 'attempts', 'updated_at'],
  user_stats: ['user_id', 'xp', 'total_submissions', 'accepted_count'],
}
const requiredIndexes = [
  'idx_messages_conversation_id',
  'idx_notifications_user_id',
  'idx_problems_status_id',
  'idx_problems_quality_status',
]

const db = await open({
  filename: databasePath,
  driver: sqlite3.Database,
  mode: sqlite3.OPEN_READONLY,
})

try {
  const integrity = await db.get('PRAGMA integrity_check')
  if (String(integrity?.integrity_check || '').toLowerCase() !== 'ok') {
    throw new Error(`integrity_check 失败：${integrity?.integrity_check || 'unknown'}`)
  }
  const foreignKeys = await db.all('PRAGMA foreign_key_check')
  if (foreignKeys.length > 0) throw new Error(`发现 ${foreignKeys.length} 条外键错误`)
  const tables = await db.all(`SELECT name FROM sqlite_master WHERE type = 'table'`)
  const available = new Set(tables.map((table) => table.name))
  const missing = requiredTables.filter((table) => !available.has(table))
  if (missing.length > 0) throw new Error(`缺少核心数据表：${missing.join(', ')}`)
  const missingColumns = []
  for (const [table, columns] of Object.entries(requiredColumns)) {
    const info = await db.all(`PRAGMA table_info(${table})`)
    const availableColumns = new Set(info.map((column) => column.name))
    for (const column of columns) {
      if (!availableColumns.has(column)) missingColumns.push(`${table}.${column}`)
    }
  }
  if (missingColumns.length > 0) throw new Error(`数据库缺少必需字段：${missingColumns.join(', ')}`)
  const indexes = await db.all(`SELECT name FROM sqlite_master WHERE type = 'index'`)
  const availableIndexes = new Set(indexes.map((index) => index.name))
  const missingIndexes = requiredIndexes.filter((index) => !availableIndexes.has(index))
  if (missingIndexes.length > 0) throw new Error(`数据库缺少必需索引：${missingIndexes.join(', ')}`)
  console.log(JSON.stringify({
    ok: true,
    database: path.basename(databasePath),
    tableCount: tables.length,
    foreignKeyIssues: 0,
  }, null, 2))
} finally {
  await db.close()
}
