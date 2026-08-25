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
  ['dependency audit', 'npm', ['run', 'audit:deps']],
  ['database integrity', 'npm', ['run', 'db:verify']],
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
    if (process.env.RELEASE_ADMIN_TOKEN) {
      await run('admin stress', 'npm', ['run', 'stress', '--', 'admin'], {
        STRESS_TARGET: process.env.RELEASE_BASE_URL,
        STRESS_TOKEN: process.env.RELEASE_ADMIN_TOKEN,
        STRESS_REQUESTS: process.env.RELEASE_STRESS_REQUESTS || '50',
        STRESS_CONCURRENCY: process.env.RELEASE_STRESS_CONCURRENCY || '10',
        STRESS_CONFIRM: /localhost|127\.0\.0\.1/.test(process.env.RELEASE_BASE_URL) ? '' : 'YES',
      })
    } else {
      console.log('[release] admin stress skipped: set RELEASE_ADMIN_TOKEN to include it')
    }
    if (process.env.RELEASE_JUDGE_TOKEN && process.env.RELEASE_PROBLEM_ID && process.env.RELEASE_ALLOW_JUDGE === 'YES') {
      await run('judge stress', 'npm', ['run', 'stress', '--', 'judge'], {
        STRESS_TARGET: process.env.RELEASE_BASE_URL,
        STRESS_TOKEN: process.env.RELEASE_JUDGE_TOKEN,
        STRESS_PROBLEM_ID: process.env.RELEASE_PROBLEM_ID,
        STRESS_ALLOW_JUDGE: 'YES',
        STRESS_REQUESTS: process.env.RELEASE_STRESS_REQUESTS || '10',
        STRESS_CONCURRENCY: process.env.RELEASE_STRESS_CONCURRENCY || '2',
        STRESS_CONFIRM: /localhost|127\.0\.0\.1/.test(process.env.RELEASE_BASE_URL) ? '' : 'YES',
      })
    } else {
      console.log('[release] judge stress skipped: requires RELEASE_JUDGE_TOKEN, RELEASE_PROBLEM_ID and RELEASE_ALLOW_JUDGE=YES')
    }
  } else {
    if (process.env.RELEASE_ALLOW_SKIP_API === '1') {
      console.log('\n[release] API smoke / stress explicitly skipped by RELEASE_ALLOW_SKIP_API=1')
    } else {
      throw new Error('缺少 RELEASE_BASE_URL；如需跳过 API 检查，必须显式设置 RELEASE_ALLOW_SKIP_API=1')
    }
  }

  if (process.env.BACKUP_FILE) {
    await run('backup restore verification', 'npm', ['run', 'db:verify-backup'], { BACKUP_FILE: process.env.BACKUP_FILE })
  } else {
    console.log('[release] backup restore verification skipped: set BACKUP_FILE to a .db.gz backup')
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
