#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'

const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  let errors = ''
  child.stdout.on('data', (chunk) => { output += chunk.toString() })
  child.stderr.on('data', (chunk) => { errors += chunk.toString() })
  child.once('error', reject)
  child.once('exit', (code) => code === 0
    ? resolve(output)
    : reject(new Error(`${command} failed: ${errors.slice(0, 300)}`)))
})
const digest = async (file) => createHash('sha256').update(await readFile(file)).digest('hex')
const directory = path.resolve(String(process.env.IDENTITY_BACKUP_SET || ''))
if (!process.env.IDENTITY_BACKUP_SET || ['/', path.parse(directory).root].includes(directory)) {
  throw new Error('IDENTITY_BACKUP_SET must name one backup directory')
}
const directoryInfo = await lstat(directory)
if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || (directoryInfo.mode & 0o077) !== 0) {
  throw new Error('Backup set must be a private real directory')
}
if (await realpath(directory) !== directory) throw new Error('Backup set must not traverse symbolic links')
const manifestPath = path.join(directory, 'manifest.json')
const manifestInfo = await lstat(manifestPath)
if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.nlink !== 1
  || (manifestInfo.mode & 0o077) !== 0 || await realpath(manifestPath) !== manifestPath) {
  throw new Error('Backup manifest must be one private real file')
}
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
if (manifest.version !== 1 || !manifest.files || Object.keys(manifest.files).sort().join(',') !== 'hydra.dump,starstack.sqlite') {
  throw new Error('Backup manifest is invalid')
}
for (const [name, expected] of Object.entries(manifest.files)) {
  const file = path.join(directory, name)
  const info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (info.mode & 0o077) !== 0
    || await realpath(file) !== file || info.size !== expected.bytes
    || await digest(file) !== expected.sha256) {
    throw new Error(`Backup member ${name} failed verification`)
  }
}
const integrity = await run('sqlite3', [path.join(directory, 'starstack.sqlite'), 'PRAGMA integrity_check;'])
if (integrity.trim() !== 'ok') throw new Error('SQLite backup integrity check failed')
await run('pg_restore', ['--list', path.join(directory, 'hydra.dump')])
console.log(JSON.stringify({ ok: true, readOnly: true, createdAt: manifest.createdAt }))
