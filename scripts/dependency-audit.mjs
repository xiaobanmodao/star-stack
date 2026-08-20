#!/usr/bin/env node

import { execFileSync } from 'node:child_process'

const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const runAudit = (label, args) => {
  let raw = ''
  try {
    raw = execFileSync(npmBin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    raw = error?.stdout?.toString?.() || ''
  }

  let report
  try {
    report = JSON.parse(raw)
  } catch {
    throw new Error(`${label} 审计没有返回可解析的 JSON`)
  }

  const vulnerabilities = report.metadata?.vulnerabilities || {}
  const summary = ['info', 'low', 'moderate', 'high', 'critical']
    .map((level) => `${level}=${vulnerabilities[level] || 0}`)
    .join(', ')
  console.log(`[依赖审计] ${label}: ${summary}`)

  const notable = Object.entries(report.vulnerabilities || {})
    .filter(([, item]) => ['high', 'critical'].includes(item.severity))
    .map(([name, item]) => `${name}(${item.severity})`)
  if (notable.length > 0) {
    console.warn(`  高风险条目：${notable.join(', ')}`)
  }

  return Number(vulnerabilities.critical || 0)
}

const critical = runAudit('前端生产依赖', ['audit', '--omit=dev', '--json'])
  + runAudit('后端生产依赖', ['--prefix', 'server', 'audit', '--omit=dev', '--json'])

if (critical > 0) {
  console.error(`发现 ${critical} 个 Critical 依赖漏洞，禁止发布。`)
  process.exit(1)
}

console.log('依赖审计完成：当前没有 Critical 条目；High/Moderate/Low 条目需按发布记录复核。')
