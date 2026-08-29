import { afterEach, describe, expect, it } from 'vitest'
import { access, chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  LOCAL_HYDRA_TEST_DSN,
  assertLocalHydraTestDsn,
} from './localHydraDsn.mjs'

const directories = []
const identityScripts = [
  'run-local-runtime.mjs',
  'local-protocol-test.mjs',
]
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))

const runScript = (script, { cwd, env }) => new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(scriptDirectory, script)], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
  child.once('exit', (code) => resolve({ code, stderr }))
})

afterEach(async () => {
  while (directories.length) await rm(directories.pop(), { recursive: true, force: true })
})

describe('local Hydra test DSN guard', () => {
  it('accepts only the frozen passwordless loopback hydra_test database', () => {
    expect(assertLocalHydraTestDsn(LOCAL_HYDRA_TEST_DSN)).toBe(LOCAL_HYDRA_TEST_DSN)
    for (const value of [
      undefined,
      '',
      'postgres://hydra_test@localhost:55432/hydra_test?sslmode=disable',
      'postgres://hydra_test@127.0.0.1:5432/hydra_test?sslmode=disable',
      'postgres://postgres@127.0.0.1:55432/hydra_test?sslmode=disable',
      'postgres://hydra_test:password@127.0.0.1:55432/hydra_test?sslmode=disable',
      'postgres://hydra_test@127.0.0.1:55432/production?sslmode=disable',
      'postgres://hydra_test@127.0.0.1:55432/hydra_test?sslmode=require',
      'postgres://hydra_test@127.0.0.1:55432/hydra_test?sslmode=disable&application_name=test',
      'postgresql://hydra_test@127.0.0.1:55432/hydra_test?sslmode=disable',
    ]) {
      expect(() => assertLocalHydraTestDsn(value)).toThrow(/isolated|本地|hydra_test|DSN/i)
    }
  })

  it.each(identityScripts)('rejects a bad DSN before %s can spawn Hydra or write credentials', async (script) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'starstack-hydra-dsn-guard-'))
    directories.push(directory)
    const marker = path.join(directory, 'hydra-spawned')
    const credentials = path.join(directory, 'credentials.json')
    const starStackDatabase = path.join(directory, 'starstack.sqlite')
    const runtimeDirectory = path.join(directory, '.identity-runtime')
    const fakeHydra = path.join(directory, 'fake-hydra.mjs')
    await writeFile(fakeHydra, `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs'\nwriteFileSync(process.env.HYDRA_SPAWN_MARKER, 'spawned')\nconsole.log('Version: v26.2.0')\n`)
    await chmod(fakeHydra, 0o700)

    const result = await runScript(script, {
      cwd: directory,
      env: {
        ...process.env,
        HYDRA_TEST_DSN: 'postgres://production@db.example:5432/starstack?sslmode=require',
        HYDRA_TEST_BINARY: fakeHydra,
        HYDRA_SPAWN_MARKER: marker,
        IDENTITY_TEST_CREDENTIALS_FILE: credentials,
        IDENTITY_TEST_STARSTACK_DB: starStackDatabase,
      },
    })

    expect(result.code).not.toBe(0)
    expect(result.stderr).toMatch(/isolated|本地|hydra_test|DSN/i)
    await expect(access(marker)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(credentials)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(starStackDatabase)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(runtimeDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
