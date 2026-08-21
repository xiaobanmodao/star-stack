#!/usr/bin/env node
/**
 * 发布前质量门禁。默认执行静态检查、单元测试、构建和 API smoke。
 * API 已在其他端口运行时可设置 RELEASE_BASE_URL；否则 smoke 只会被跳过并明确提示。
 * 浏览器审计可通过 RELEASE_RUN_AUDIT=1 显式加入，避免普通发布检查意外打开浏览器。
 */
import { spawn } from 'node:child_process'

const run = (label, command, args, env = {}) => new Promise((resolve, reject) => {
  console.log(`\n[release] ${label}`)
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
  child.on('error', reject)
  child.on('exit', (code, signal) => {
    if (code === 0) resolve()
    else reject(new Error(`${label} 失败（code=${code ?? 'null'}, signal=${signal || 'none'}）`))
  })
})

const checks = [
  ['lint', 'npm', ['run', 'lint']],
  ['unit tests', 'npm', ['test', '--', '--run']],
  ['production build', 'npm', ['run', 'build']],
]

try {
  for (const [label, command, args] of checks) await run(label, command, args)

  if (process.env.RELEASE_BASE_URL) {
    await run('API smoke', 'npm', ['run', 'test:smoke'], { SMOKE_BASE_URL: process.env.RELEASE_BASE_URL })
    await run('health stress', 'npm', ['run', 'stress', '--', 'health'], {
      STRESS_TARGET: process.env.RELEASE_BASE_URL,
      STRESS_REQUESTS: process.env.RELEASE_STRESS_REQUESTS || '100',
      STRESS_CONCURRENCY: process.env.RELEASE_STRESS_CONCURRENCY || '10',
      STRESS_CONFIRM: /localhost|127\.0\.0\.1/.test(process.env.RELEASE_BASE_URL) ? '' : 'YES',
    })
  } else {
    console.log('\n[release] API smoke / stress skipped: set RELEASE_BASE_URL to a running local API')
  }

  if (process.env.RELEASE_RUN_AUDIT === '1') {
    await run('browser light/dark audit', 'npm', ['run', 'audit'])
  } else {
    console.log('[release] browser audit skipped: set RELEASE_RUN_AUDIT=1 to include it')
  }

  console.log('\nRelease checks passed.')
} catch (error) {
  console.error(`\nRelease checks failed: ${error?.message || error}`)
  process.exitCode = 1
}
