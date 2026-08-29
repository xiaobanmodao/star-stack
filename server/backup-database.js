#!/usr/bin/env node
// 在没有 sqlite3 CLI 时使用 SQLite 自身的 VACUUM INTO 生成一致性备份。
import sqlite3 from 'sqlite3'
import { open } from 'sqlite'

const source = process.env.DB_PATH
const target = process.env.BACKUP_FILE
if (!source || !target) throw new Error('DB_PATH 和 BACKUP_FILE 均为必需参数')

const db = await open({ filename: source, driver: sqlite3.Database })
try {
  const integrity = await db.get('PRAGMA integrity_check')
  if (String(integrity?.integrity_check || '').toLowerCase() !== 'ok') {
    throw new Error(`源数据库完整性检查失败：${integrity?.integrity_check || 'unknown'}`)
  }
  await db.run('VACUUM INTO ?', target)
} finally {
  await db.close()
}
