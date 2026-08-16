#!/usr/bin/env node
/**
 * StarStack 审查工具：真实浏览器（Chrome CDP）对比度审计
 *
 * 用法：
 *   node scripts/audit.mjs                 # 双主题 + 默认页面清单
 *   node scripts/audit.mjs --theme light   # 只审浅色
 *   node scripts/audit.mjs --theme dark    # 只审深色
 *   node scripts/audit.mjs --url /oj/list  # 追加自定义页面
 *
 * 审计项：对每个可见文字元素，计算其颜色与主题底色的对比度，
 *        浅色 <4.5 / 深色 <4.5 记为违规。
 * 退出码：0 = 通过；1 = 存在违规（供 CI 使用）
 */

import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CHROME_BIN = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const CDP_PORT = Number(process.env.CDP_PORT || 9222)
const BASE = process.env.BASE_URL || 'http://localhost:5173'
const MIN_CONTRAST = 4.5

const DEFAULT_PAGES = [
  '/',                  // 首页（项目大厅）
  '/oj/list',           // 题库
  '/oj/1001',           // 题目详情
  '/oj/judge',          // 评测页
  '/chat/plaza',        // 讨论广场
  '/chat/dm/astro10',   // 私信
  '/leaderboard',       // 排行榜
  '/user/astro01',      // 他人主页
  '/oj/records/1001',   // 提交记录
]

const args = process.argv.slice(2)
let themes = ['light', 'dark']
let pages = [...DEFAULT_PAGES]
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--theme') themes = [args[++i]]
  if (args[i] === '--url') pages.push(args[++i])
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ---------- Chrome 启动与 CDP 连接 ---------- */

async function launchChrome() {
  return spawn(CHROME_BIN, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    `--user-data-dir=${ROOT}/.audit-chrome`,
    `--remote-debugging-port=${CDP_PORT}`,
    '--disable-crash-reporter', 'about:blank',
  ], { stdio: 'ignore' })
}

async function getPageTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()
      const page = list.find((t) => t.type === 'page')
      if (page) return page
    } catch { /* chrome 尚未就绪 */ }
    await sleep(500)
  }
  throw new Error(`Chrome CDP 未就绪（端口 ${CDP_PORT}）`)
}

function connectWS(url) {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(url)
    sock.onopen = () => resolve(sock)
    sock.onerror = () => reject(new Error('WebSocket 连接失败: ' + url))
  })
}

/* ---------- 审计脚本（在页面内执行） ---------- */

const AUDIT_JS = `(() => {
  const results = [];
  const seen = new Set();
  const parseColor = (c) => {
    const m = c.match(/rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)/);
    if (!m) return null;
    let [r, g, b] = [m[1], m[2], m[3]].map(Number);
    const a = m[4] === undefined ? 1 : Number(m[4]);
    const bg = window.__AUDIT_BG__;
    r = r * a + bg[0] * (1 - a); g = g * a + bg[1] * (1 - a); b = b * a + bg[2] * (1 - a);
    return [r, g, b];
  };
  const lum = (rgb) => {
    const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const text = (node.textContent || '').trim();
    if (text.length < 1) continue;
    const el = node.parentElement;
    if (!el) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const rgb = parseColor(cs.color);
    if (!rgb) continue;
    const L = lum(rgb);
    const Lbg = lum(window.__AUDIT_BG__);
    const contrast = (Math.max(L, Lbg) + 0.05) / (Math.min(L, Lbg) + 0.05);
    if (contrast < ${MIN_CONTRAST}) {
      const key = cs.color + '|' + text.slice(0, 24);
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        color: cs.color,
        contrast: Math.round(contrast * 100) / 100,
        text: text.slice(0, 48),
        cls: String(el.className || '').slice(0, 70),
        tag: el.tagName,
      });
    }
  }
  return results;
})()`

/* ---------- 主流程 ---------- */

const chrome = await launchChrome()
const target = await getPageTarget()
const sock = await connectWS(target.webSocketDebuggerUrl)

let msgId = 0
const pending = new Map()
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++msgId
    pending.set(id, { res, rej })
    sock.send(JSON.stringify({ id, method, params }))
  })
sock.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) }
}
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

const report = []
let violations = 0

for (const theme of themes) {
  const bg = theme === 'dark' ? [13, 17, 23] : [255, 255, 255]
  process.stderr.write(`[主题] ${theme}\n`)

  // 设置主题（localStorage 同 origin 保留，后续页面自动应用）
  await send('Page.navigate', { url: BASE + '/' })
  await sleep(3500)
  await send('Runtime.evaluate', {
    expression: `localStorage.setItem('starstack_theme','${theme}'); window.__AUDIT_BG__=[${bg.join(',')}]; location.reload(); true`,
  })
  await sleep(3500)

  for (const path of pages) {
    process.stderr.write(`  [审] ${path} ... `)
    await send('Page.navigate', { url: BASE + path })
    await sleep(3500)
    const r = await send('Runtime.evaluate', { expression: AUDIT_JS, returnByValue: true })
    const issues = (r.result && r.result.value) || []
    process.stderr.write(`${issues.length} 处违规\n`)
    violations += issues.length
    report.push({ path, theme, issues })
  }
}

/* ---------- 输出报告 ---------- */

const lines = []
lines.push('# StarStack 审查报告')
lines.push(`时间：${new Date().toLocaleString('zh-CN')}`)
lines.push(`主题：${themes.join(' / ')}    页面：${pages.length}    最小对比度：${MIN_CONTRAST}`)
lines.push('')
for (const r of report) {
  lines.push(`## [${r.theme}] ${r.path} — ${r.issues.length} 处违规`)
  for (const it of r.issues.slice(0, 12)) {
    lines.push(`- 对比度 ${it.contrast}  ${it.color}  <${it.tag} .${it.cls}> "${it.text}"`)
  }
  if (r.issues.length > 12) lines.push(`- … 另有 ${r.issues.length - 12} 处`)
  lines.push('')
}
lines.push(`## 汇总：${violations} 处违规（对比度 < ${MIN_CONTRAST}）`)
lines.push(violations === 0 ? '✅ 全部通过' : '❌ 存在违规，请修复后重审')

const outDir = resolve(ROOT, '.audit')
mkdirSync(outDir, { recursive: true })
const reportFile = resolve(outDir, `audit-${themes.join('-')}.md`)
writeFileSync(reportFile, lines.join('\n'))
console.log(lines.join('\n'))
console.log(`\n报告已保存：${reportFile}`)

sock.close()
chrome.kill()
process.exit(violations === 0 ? 0 : 1)
