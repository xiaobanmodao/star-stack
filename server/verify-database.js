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
  console.log(JSON.stringify({
    ok: true,
    database: path.basename(databasePath),
    tableCount: tables.length,
    foreignKeyIssues: 0,
  }, null, 2))
} finally {
  await db.close()
}
