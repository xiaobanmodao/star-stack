#!/usr/bin/env node
import { constants as fsConstants } from 'node:fs'
import { access, chmod, lstat, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sqlite3 from 'sqlite3'
import { open } from 'sqlite'
import {
  applyAvatarCompressionPlan,
  prepareAvatarCompressionPlan,
} from './services/avatarCompressionMigration.js'

const assertRegularOwnedFile = async (filePath, label) => {
  const stats = await lstat(filePath)
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
    throw new Error(`${label}必须是非链接的普通文件`)
  }
  if (typeof process.getuid === 'function' && stats.uid !== process.getuid()) {
    throw new Error(`${label}必须归当前用户所有`)
  }
}

const assertDatabaseSchema = async (db) => {
  const columns = await db.all(`PRAGMA table_info(users)`)
  const names = new Set(columns.map((column) => column.name))
  for (const required of ['id', 'avatar', 'avatar_revision']) {
    if (!names.has(required)) throw new Error(`数据库缺少 users.${required}，请先运行数据库迁移`)
  }
}

const assertIntegrity = async (db, label) => {
  const result = await db.get('PRAGMA integrity_check')
  if (String(result?.integrity_check || '').toLowerCase() !== 'ok') {
    throw new Error(`${label}完整性检查失败`)
  }
}

const createVerifiedBackup = async (db, backupPath) => {
  if (!path.isAbsolute(backupPath)) throw new Error('备份路径必须是绝对路径')
  const backupDirectory = path.dirname(backupPath)
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 })
  const directoryStats = await lstat(backupDirectory)
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
    throw new Error('备份目录必须是真实目录')
  }
  try {
    await access(backupPath, fsConstants.F_OK)
    throw new Error('备份文件已存在，拒绝覆盖')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  await db.run('VACUUM INTO ?', backupPath)
  await chmod(backupPath, 0o600)
  await assertRegularOwnedFile(backupPath, '备份文件')

  const backupDb = await open({ filename: backupPath, driver: sqlite3.Database })
  try {
    await assertIntegrity(backupDb, '备份数据库')
  } finally {
    await backupDb.close()
  }
}

export const runAvatarCompression = async ({ databasePath, apply = false, backupPath = null }) => {
  if (!path.isAbsolute(databasePath || '')) throw new Error('数据库路径必须是绝对路径')
  await assertRegularOwnedFile(databasePath, '数据库')
  if (apply && !backupPath) throw new Error('--apply 必须同时提供 --backup')

  const db = await open({ filename: databasePath, driver: sqlite3.Database })
  try {
    await db.exec('PRAGMA busy_timeout = 5000')
    await assertIntegrity(db, '源数据库')
    await assertDatabaseSchema(db)
    const plan = await prepareAvatarCompressionPlan(db)
    const originalBytes = plan.replacements.reduce((total, item) => total + item.originalBytes, 0)
    const compressedBytes = plan.replacements.reduce((total, item) => total + item.compressedBytes, 0)

    if (!apply || plan.replacements.length === 0) {
      return {
        mode: apply ? 'apply' : 'dry-run',
        scanned: plan.scanned,
        candidates: plan.replacements.length,
        alreadyWithinLimit: plan.alreadyWithinLimit,
        skipped: plan.skipped,
        originalBytes,
        compressedBytes,
        updated: 0,
        conflicts: 0,
        backupCreated: false,
      }
    }

    await createVerifiedBackup(db, backupPath)
    const applied = await applyAvatarCompressionPlan(db, plan)
    await assertIntegrity(db, '迁移后数据库')
    return {
      mode: 'apply',
      scanned: plan.scanned,
      candidates: plan.replacements.length,
      alreadyWithinLimit: plan.alreadyWithinLimit,
      skipped: plan.skipped,
      originalBytes,
      compressedBytes,
      ...applied,
      backupCreated: true,
    }
  } finally {
    await db.close()
  }
}

const parseArguments = (args) => {
  const options = { apply: false, databasePath: null, backupPath: null }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--apply') options.apply = true
    else if (argument === '--database') options.databasePath = args[++index]
    else if (argument === '--backup') options.backupPath = args[++index]
    else throw new Error(`未知参数：${argument}`)
  }
  if (!options.databasePath) throw new Error('必须提供 --database /absolute/path/to/starstack.sqlite')
  return options
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const report = await runAvatarCompression(parseArguments(process.argv.slice(2)))
  console.log(JSON.stringify(report, null, 2))
}
