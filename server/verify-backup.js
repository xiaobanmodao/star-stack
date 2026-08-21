#!/usr/bin/env node
/*
 * 在临时目录解压并打开一份 SQLite 备份，验证备份可恢复且没有破损。
 * 用法：BACKUP_FILE=/www/backup/starstack/starstack_x.db.gz npm run db:verify-backup
 */
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import sqlite3 from 'sqlite3'
import { open } from 'sqlite'

const backupFile = process.env.BACKUP_FILE
if (!backupFile) {
  console.error('缺少 BACKUP_FILE，例如 BACKUP_FILE=/www/backup/starstack/starstack_20260820_151540.db.gz')
  process.exit(1)
}

const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'starstack-backup-'))
const restoredFile = path.join(tempDir, 'restored.sqlite')
let db

try {
  await pipeline(fs.createReadStream(backupFile), createGunzip(), fs.createWriteStream(restoredFile))
  db = await open({ filename: restoredFile, driver: sqlite3.Database })
  const integrity = await db.get('PRAGMA integrity_check')
  if (String(integrity?.integrity_check).toLowerCase() !== 'ok') {
    throw new Error(`SQLite integrity_check 失败：${integrity?.integrity_check || 'unknown'}`)
  }
  const requiredTables = ['users', 'sessions', 'problems', 'testcases', 'submissions']
  const tables = await db.all(`SELECT name FROM sqlite_master WHERE type = 'table'`)
  const available = new Set(tables.map((table) => table.name))
  const missing = requiredTables.filter((table) => !available.has(table))
  if (missing.length > 0) throw new Error(`备份缺少核心数据表：${missing.join(', ')}`)
  const [users, problems, submissions] = await Promise.all([
    db.get('SELECT COUNT(*) AS count FROM users'),
    db.get('SELECT COUNT(*) AS count FROM problems'),
    db.get('SELECT COUNT(*) AS count FROM submissions'),
  ])
  console.log(JSON.stringify({
    ok: true,
    backupFile: path.basename(backupFile),
    tables: available.size,
    users: users?.count || 0,
    problems: problems?.count || 0,
    submissions: submissions?.count || 0,
  }, null, 2))
} catch (error) {
  console.error(`备份恢复验证失败：${error?.message || error}`)
  process.exitCode = 1
} finally {
  if (db?.open) await db.close()
  await fsPromises.rm(tempDir, { recursive: true, force: true })
}
