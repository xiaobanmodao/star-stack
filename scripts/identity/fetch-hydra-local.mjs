#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

const VERSION = '26.2.0'
const CHECKSUMS_SHA256 = '778bebe8c3838359d3a37064a3ac17e1287c0eb4e31c4d7ad60e467c757941f3'
const ASSETS = {
  arm64: {
    name: `hydra_${VERSION}-macOS_sqlite_arm64.tar.gz`,
    sha256: 'd45f26be758196e66e98dff06a9eaefcd21d719123f74f43a0f1fabcfb71da60',
  },
  x64: {
    name: `hydra_${VERSION}-macOS_sqlite_64bit.tar.gz`,
    sha256: 'ede453fa15c82cfb23e61b138a0b4d9558127a26ebf51eead97d0c58a7eff422',
  },
}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')
const asset = ASSETS[process.arch]
if (process.platform !== 'darwin' || !asset) throw new Error('Local Hydra fetch supports macOS arm64/x64 only')

const root = path.resolve('.identity-runtime')
const archive = path.join(root, asset.name)
const checksumsUrl = `https://github.com/ory/hydra/releases/download/v${VERSION}/checksums.txt`
const assetUrl = `https://github.com/ory/hydra/releases/download/v${VERSION}/${asset.name}`
await mkdir(root, { recursive: true, mode: 0o700 })

const download = async (url) => {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120000) })
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

const checksums = await download(checksumsUrl)
if (sha256(checksums) !== CHECKSUMS_SHA256) throw new Error('Hydra checksums.txt digest mismatch')
const listed = checksums.toString('utf8').split('\n').find((line) => line.endsWith(`  ${asset.name}`))
if (!listed || listed.split(/\s+/)[0] !== asset.sha256) throw new Error('Pinned Hydra asset is absent from checksums.txt')

let bytes
try { bytes = await readFile(archive) } catch { bytes = await download(assetUrl); await writeFile(archive, bytes, { mode: 0o600 }) }
if (sha256(bytes) !== asset.sha256) throw new Error('Hydra archive digest mismatch')

await new Promise((resolve, reject) => {
  const child = spawn('tar', ['-xzf', archive, '-C', root], { stdio: 'inherit' })
  child.once('error', reject)
  child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`tar exited with ${code}`)))
})
const binary = path.join(root, 'hydra')
await chmod(binary, 0o700)
console.log(`Verified Hydra v${VERSION} local binary: ${binary}`)
