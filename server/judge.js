import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import { spawn, spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import {
  DEFAULT_TESTCASE_TIME_LIMIT_MS,
  MAX_TESTCASE_COUNT,
  normalizeTestcaseTimeLimit,
} from './utils/testcaseLimits.js'

const TIME_LIMIT_MS = DEFAULT_TESTCASE_TIME_LIMIT_MS
const COMPILE_LIMIT_MS = 15000
const IS_WIN = process.platform === 'win32'
const IS_LINUX = process.platform === 'linux'
const WORK_ROOT = IS_WIN ? path.join('C:\\', 'Temp', 'starstack-oj') : path.join(os.tmpdir(), 'starstack-oj')
const CACHE_ROOT = path.join(WORK_ROOT, 'cache')
const CACHE_MAX_FILES = Math.max(20, Number(process.env.JUDGE_CACHE_MAX_FILES) || 200)
const CACHE_MAX_BYTES = Math.max(64 * 1024 * 1024, Number(process.env.JUDGE_CACHE_MAX_BYTES) || 512 * 1024 * 1024)
const CACHE_MAX_AGE_MS = Math.max(60 * 60 * 1000, Number(process.env.JUDGE_CACHE_MAX_AGE_MS) || 14 * 24 * 60 * 60 * 1000)
const configuredMemoryLimit = Number(process.env.JUDGE_MEMORY_LIMIT_KB)
const MEMORY_LIMIT_KB = Number.isFinite(configuredMemoryLimit) && configuredMemoryLimit >= 64 * 1024
  ? Math.min(configuredMemoryLimit, 512 * 1024)
  : 256 * 1024 // 默认 256MB，允许生产环境在 64～512MB 内调整
const NPROC_LIMIT = 32
const SANDBOX_UNAVAILABLE_MESSAGE = '评测沙箱不可用，请联系管理员'

// 带容量上限的编译缓存，防止内存泄漏
class CompileCache {
  constructor(maxSize = 200) {
    this._map = new Map()
    this._maxSize = maxSize
  }
  has(key) { return this._map.has(key) }
  get(key) {
    if (!this._map.has(key)) return undefined
    const v = this._map.get(key)
    this._map.delete(key)
    this._map.set(key, v)
    return v
  }
  set(key, value) {
    this._map.delete(key)
    if (this._map.size >= this._maxSize) {
      const oldest = this._map.keys().next().value
      this._map.delete(oldest)
    }
    this._map.set(key, value)
  }
  delete(key) { this._map.delete(key) }
}

const compileCache = new CompileCache(200)

let cachePrunePromise = null
const pruneCompileCache = async () => {
  if (cachePrunePromise) return cachePrunePromise
  cachePrunePromise = (async () => {
    try {
      await fs.promises.mkdir(CACHE_ROOT, { recursive: true })
      const entries = await fs.promises.readdir(CACHE_ROOT, { withFileTypes: true })
      const files = []
      for (const entry of entries) {
        if (!entry.isFile() || !/^[a-f0-9]{64}(?:\.exe|\.class)?$/.test(entry.name)) continue
        try {
          const filePath = path.join(CACHE_ROOT, entry.name)
          const stat = await fs.promises.stat(filePath)
          files.push({ path: filePath, size: stat.size, mtimeMs: stat.mtimeMs })
        } catch {
          // 文件可能在扫描期间被清理，忽略即可。
        }
      }
      files.sort((a, b) => b.mtimeMs - a.mtimeMs)
      const cutoff = Date.now() - CACHE_MAX_AGE_MS
      let keptBytes = 0
      const removals = []
      files.forEach((file, index) => {
        const overLimit = index >= CACHE_MAX_FILES || keptBytes + file.size > CACHE_MAX_BYTES
        const expired = file.mtimeMs < cutoff
        if (overLimit || expired) removals.push(file.path)
        else keptBytes += file.size
      })
      await Promise.all(removals.map((filePath) => fs.promises.unlink(filePath).catch(() => undefined)))
    } catch {
      // 缓存清理失败不影响评测，下一轮继续尝试。
    } finally {
      cachePrunePromise = null
    }
  })()
  return cachePrunePromise
}

const cleanupStaleWorkspaces = async () => {
  try {
    await fs.promises.mkdir(WORK_ROOT, { recursive: true })
    const entries = await fs.promises.readdir(WORK_ROOT, { withFileTypes: true })
    await Promise.all(entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('run-'))
      .map((entry) => fs.promises.rm(path.join(WORK_ROOT, entry.name), { recursive: true, force: true }).catch(() => undefined)))
  } catch {
    // 残留目录清理失败不影响评测，当前任务仍会使用新的随机工作目录。
  }
}

const cacheCleanupTimer = setInterval(() => { void pruneCompileCache() }, 30 * 60 * 1000)
cacheCleanupTimer.unref?.()
void cleanupStaleWorkspaces()
void pruneCompileCache()

// 计算代码的hash值（使用 SHA-256 替代 MD5 避免碰撞）
const getCodeHash = (language, code) => {
  return crypto.createHash('sha256').update(`${language}:${code}`).digest('hex')
}

const buildWorkEnv = (extraBins) => {
  if (!IS_WIN) return null
  const currentPath = process.env.PATH || ''
  const bins = extraBins.filter(Boolean)
  const pathValue = bins.length ? `${bins.join(path.delimiter)}${path.delimiter}${currentPath}` : currentPath
  return { TEMP: WORK_ROOT, TMP: WORK_ROOT, PATH: pathValue }
}

const normalizeOutput = (text) =>
  text.replace(/\r\n/g, '\n').trim()

const statusPriority = (status) => {
  if (status === 'Accepted') return 0
  if (status === 'Wrong Answer') return 1
  if (status === 'Runtime Error') return 2
  if (status === 'Time Limit Exceeded') return 3
  return 4
}

const statusMessage = (status) => {
  if (status === 'Accepted') return '通过'
  if (status === 'Wrong Answer') return '答案错误'
  if (status === 'Runtime Error') return '运行错误'
  if (status === 'Time Limit Exceeded') return '超时'
  if (status === 'Compile Error') return '编译错误'
  return '判题失败'
}

const SANDBOX_SH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sandbox.sh')

const hasCommand = (command) => {
  if (!IS_LINUX) return false
  const searchPath = String(process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin')
  return searchPath.split(path.delimiter).some((directory) => {
    try {
      fs.accessSync(path.join(directory, command), fs.constants.X_OK)
      return true
    } catch {
      return false
    }
  })
}

// 不仅检查脚本文件，还要在启动时验证完整沙箱能力。
// 生产环境如果当前内核/容器不允许用户 namespace、挂载或 chroot，必须拒绝执行用户代码。
const canCreateSandbox = () => {
  if (!IS_LINUX || !fs.existsSync(SANDBOX_SH)) return false
  const requiredCommands = ['unshare', 'timeout', 'mount', 'chroot']
  const missingCommands = requiredCommands.filter((command) => !hasCommand(command))
  if (missingCommands.length) {
    if (process.env.JUDGE_DEBUG_SANDBOX === '1') {
      console.error(`[sandbox] missing commands: ${missingCommands.join(', ')}`)
    }
    return false
  }
  const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'starstack-sandbox-probe-'))
  const probe = spawnSync('/bin/bash', [
    SANDBOX_SH, probeRoot, '100', '65536', '-', '/bin/true',
  ], {
    stdio: process.env.JUDGE_DEBUG_SANDBOX === '1' ? 'pipe' : 'ignore',
    encoding: 'utf8',
    timeout: 3000,
  })
  try { fs.rmSync(probeRoot, { recursive: true, force: true }) } catch {}
  if (probe.status !== 0 && process.env.JUDGE_DEBUG_SANDBOX === '1') {
    console.error(`[sandbox] probe failed: status=${probe.status ?? 'null'} signal=${probe.signal ?? 'null'} error=${probe.error?.message || 'none'} stderr=${probe.stderr?.toString().trim() || 'none'}`)
  }
  return probe.status === 0
}

const sandboxAvailable = canCreateSandbox()
if (sandboxAvailable) {
  try { fs.chmodSync(SANDBOX_SH, 0o755) } catch {}
  console.log('Sandbox enabled: Linux namespaces and resource limits are available')
} else if (IS_LINUX) {
  console.warn('Sandbox unavailable: refusing production judge execution unless the host supports unshare/timeout')
}

// 生产环境强制沙箱：Linux 无沙箱或非 Linux 平台一律拒绝评测（防止用户代码无资源限制运行）
// 开发环境（NODE_ENV !== production）允许本地评测以便调试
const allowUnsafeJudge = process.env.NODE_ENV !== 'production'
if (!sandboxAvailable && !allowUnsafeJudge) {
  console.error('Refusing to judge: sandbox unavailable in production mode')
}

// 在 Linux 上通过沙箱执行命令，限制网络/文件系统/内存/进程数。
const runCommand = (cmd, args, options = {}) =>
  new Promise((resolve) => {
    // 生产环境无沙箱：拒绝执行
    if (!sandboxAvailable && !allowUnsafeJudge) {
      resolve({
        stdout: '',
        stderr: SANDBOX_UNAVAILABLE_MESSAGE,
        code: -1,
        timedOut: false,
        sandboxUnavailable: true,
        duration: 0,
      })
      return
    }
    const start = process.hrtime.bigint()
    const timeoutMs = Math.max(1, Math.round(Number(options.timeout ?? TIME_LIMIT_MS)))
    // sandbox.sh 会把 CPU 兜底上限换算为整秒，并用 GNU timeout 按毫秒执行墙钟限时，
    // 避免 100～999ms 的测试点被错误放大到 2 秒。
    // Production never honors a request to bypass the sandbox. The option is
    // retained only for local debugging, where unsafe execution is explicit.
    const useSandbox = sandboxAvailable && (options.sandbox !== false || !allowUnsafeJudge)
    const cpuTimeMarker = useSandbox
      ? `__STARSTACK_CPU_${crypto.randomBytes(12).toString('hex')}__`
      : null
    const elapsedWallTime = () => Math.max(0, Math.round(Number(process.hrtime.bigint() - start) / 1e6))
    const parseDuration = (rawStderr, fallbackDuration) => {
      if (!cpuTimeMarker) return { stderr: rawStderr, duration: fallbackDuration }
      const timingPattern = new RegExp(
        `${escapeRegExp(cpuTimeMarker)}[ \\t]+([0-9]+(?:\\.[0-9]+)?)[ \\t]+([0-9]+(?:\\.[0-9]+)?)`,
      )
      const timingMatch = rawStderr.match(timingPattern)
      if (!timingMatch) return { stderr: rawStderr, duration: fallbackDuration }
      const userSeconds = Number(timingMatch[1])
      const systemSeconds = Number(timingMatch[2])
      const duration = Math.max(0, Math.round((userSeconds + systemSeconds) * 1000))
      return {
        stderr: rawStderr.replace(timingMatch[0], '').replace(/\n$/, ''),
        duration,
      }
    }

    let spawnCmd = cmd
    let spawnArgs = args
    let spawnEnv = options.env ? { ...process.env, ...options.env } : process.env

    // Linux 沙箱模式：通过 sandbox.sh 包裹执行
    if (useSandbox) {
      spawnCmd = '/bin/bash'
      spawnArgs = [
        SANDBOX_SH,
        options.cwd || '.',
        String(timeoutMs),
        String(MEMORY_LIMIT_KB),
        cpuTimeMarker || '-',
        cmd,
        ...args,
      ]
      // 沙箱环境下限制 PATH，移除敏感环境变量
      spawnEnv = {
        PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin',
        HOME: options.cwd || '/tmp',
        LANG: 'en_US.UTF-8',
        ...(options.env || {}),
      }
    }

    const child = spawn(spawnCmd, spawnArgs, {
      cwd: options.cwd,
      windowsHide: true,
      env: spawnEnv,
      // Linux 下让 wrapper 与用户代码处于独立进程组，超时或异常时可以一次性回收所有子进程。
      detached: !IS_WIN,
    })
    let stdout = ''
    let stderr = ''
    let finished = false
    const killProcessGroup = (signal) => {
      if (!child.pid) return
      if (IS_WIN) {
        child.kill(signal)
        return
      }
      try {
        process.kill(-child.pid, signal)
      } catch {
        child.kill(signal)
      }
    }
    // 应用层超时（双重保险，沙箱内 timeout 命令也会限制）
    const timer = setTimeout(() => {
      if (finished) return
      finished = true
      killProcessGroup('SIGKILL')
      resolve({
        stdout,
        stderr,
        code: -1,
        timedOut: true,
        duration: elapsedWallTime(),
      })
    }, timeoutMs + 1000) // 给 sandbox wrapper 留出进程回收余量

    if (options.input) {
      child.stdin.write(options.input)
    }
    child.stdin.end()

    child.stdout.on('data', (data) => {
      // 限制输出大小，防止内存爆炸
      if (stdout.length < 10 * 1024 * 1024) {
        stdout += data.toString()
      }
    })
    child.stderr.on('data', (data) => {
      if (stderr.length < 1024 * 1024) {
        stderr += data.toString()
      }
    })
    child.on('error', (error) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      const measured = parseDuration(stderr, elapsedWallTime())
      resolve({
        stdout,
        stderr: error.message || measured.stderr || '执行失败',
        code: -1,
        timedOut: false,
        duration: measured.duration,
      })
    })
    child.on('close', (code) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      // 被 SIGKILL (code 137) 或 timeout 杀死视为超时
      const timedOut = code === 137 || code === 124
      const measured = parseDuration(stderr, elapsedWallTime())
      resolve({
        stdout,
        stderr: measured.stderr,
        code: timedOut ? -1 : code,
        timedOut,
        sandboxUnavailable: code === 125,
        // 正常结束时统计用户态 + 内核态 CPU 时间，排除进程启动和等待开销。
        // 超时时间仍使用墙钟时间，确保页面能反映实际的超时长度。
        duration: timedOut ? elapsedWallTime() : measured.duration,
      })
    })
  })

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const pickCommand = (fallback, candidates) => {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate
    }
  }
  return fallback
}

const findWinLibsGpp = () => {
  const base = process.env.LOCALAPPDATA
  if (!base) return null
  const dir = path.join(base, 'Microsoft', 'WinGet', 'Packages')
  if (!fs.existsSync(dir)) return null
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!entry.name.startsWith('BrechtSanders.WinLibs')) continue
    const candidate = path.join(dir, entry.name, 'mingw64', 'bin', 'g++.exe')
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

const findMsys2Gpp = () => {
  const candidate = path.join('C:\\', 'msys64', 'mingw64', 'bin', 'g++.exe')
  if (fs.existsSync(candidate)) return candidate
  return null
}

const findMicrosoftJdk = () => {
  const base = path.join('C:\\', 'Program Files', 'Microsoft')
  if (!fs.existsSync(base)) return null
  const entries = fs.readdirSync(base, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!entry.name.startsWith('jdk-')) continue
    return path.join(base, entry.name, 'bin')
  }
  return null
}

const findPython = () => {
  const base = process.env.LOCALAPPDATA
  if (!base) return null
  const root = path.join(base, 'Programs', 'Python')
  if (!fs.existsSync(root)) return null
  const entries = fs.readdirSync(root, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!entry.name.startsWith('Python')) continue
    const candidate = path.join(root, entry.name, 'python.exe')
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

const winGpp = IS_WIN ? findWinLibsGpp() : null
const winMsys2Gpp = IS_WIN ? findMsys2Gpp() : null
const winJdkBin = IS_WIN ? findMicrosoftJdk() : null
const winPython = IS_WIN ? findPython() : null

const WORK_ENV = buildWorkEnv([
  process.env.MINGW_HOME ? path.join(process.env.MINGW_HOME, 'bin') : null,
  winMsys2Gpp ? path.dirname(winMsys2Gpp) : null,
  winGpp ? path.dirname(winGpp) : null,
])

const GPP_CMD = pickCommand(process.env.GPP_PATH || 'g++', [
  process.env.GPP_PATH,
  process.env.MINGW_HOME ? path.join(process.env.MINGW_HOME, 'bin', 'g++.exe') : null,
  winMsys2Gpp,
  winGpp,
])
const JAVAC_CMD = pickCommand(process.env.JAVAC_PATH || 'javac', [
  process.env.JAVAC_PATH,
  process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'javac.exe') : null,
  winJdkBin ? path.join(winJdkBin, 'javac.exe') : null,
])
const JAVA_CMD = pickCommand(process.env.JAVA_PATH || 'java', [
  process.env.JAVA_PATH,
  process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java.exe') : null,
  winJdkBin ? path.join(winJdkBin, 'java.exe') : null,
])
const PYTHON_CMD = pickCommand(process.env.PYTHON_PATH || 'python', [
  process.env.PYTHON_PATH,
  winPython,
])

const prepareWorkspace = async (language, code) => {
  await fs.promises.mkdir(WORK_ROOT, { recursive: true })
  const root = await fs.promises.mkdtemp(path.join(WORK_ROOT, 'run-'))
  if (language === 'C++') {
    const source = path.join(root, 'main.cpp')
    await fs.promises.writeFile(source, code, 'utf-8')
    return { root, source, exec: path.join(root, IS_WIN ? 'main.exe' : 'main') }
  }
  if (language === 'Python') {
    const source = path.join(root, 'main.py')
    await fs.promises.writeFile(source, code, 'utf-8')
    return { root, source, exec: source }
  }
  if (language === 'Java') {
    const source = path.join(root, 'Main.java')
    await fs.promises.writeFile(source, code, 'utf-8')
    return { root, source, exec: 'Main' }
  }
  return { root, source: null, exec: null }
}

const compileSource = async (language, code, workspace) => {
  const codeHash = getCodeHash(language, code)

  // 检查缓存
  if (compileCache.has(codeHash)) {
    const cachedFile = compileCache.get(codeHash)
    // 验证缓存文件是否存在
    if (fs.existsSync(cachedFile)) {
      // 复制缓存的可执行文件到工作目录
      try {
        if (language === 'Java') {
          // Java需要复制.class文件
          const targetClass = path.join(workspace.root, 'Main.class')
          await fs.promises.copyFile(cachedFile, targetClass)
        } else {
          // C++复制可执行文件
          await fs.promises.copyFile(cachedFile, workspace.exec)
        }
        return { ok: true, cached: true }
      } catch (e) {
        // 复制失败，删除缓存，继续编译
        console.error('Failed to copy cached executable:', e)
        compileCache.delete(codeHash)
      }
    } else {
      // 缓存文件不存在，删除缓存
      console.warn('Cached file not found, removing from cache:', cachedFile)
      compileCache.delete(codeHash)
    }
  }

  if (language === 'C++') {
    const compile = await runCommand(
      GPP_CMD,
      [workspace.source, '-O2', '-std=c++17', '-o', workspace.exec],
      { cwd: workspace.root, timeout: COMPILE_LIMIT_MS, env: WORK_ENV || undefined }
    )
    if (compile.sandboxUnavailable) {
      return {
        ok: false,
        status: 'Judge Error',
        message: SANDBOX_UNAVAILABLE_MESSAGE,
        timeMs: 0,
      }
    }
    if (compile.timedOut) {
      return {
        ok: false,
        status: compile.sandboxUnavailable ? 'Judge Error' : 'Compile Error',
        message: compile.sandboxUnavailable ? SANDBOX_UNAVAILABLE_MESSAGE : '编译超时',
        timeMs: compile.duration,
      }
    }
    if (compile.code !== 0) {
      return {
        ok: false,
        status: 'Compile Error',
        message: (compile.stderr || '编译失败').slice(0, 500),
        timeMs: compile.duration,
      }
    }

    // 保存到缓存
    try {
      await fs.promises.mkdir(CACHE_ROOT, { recursive: true })
      const cachedExec = path.join(CACHE_ROOT, `${codeHash}${IS_WIN ? '.exe' : ''}`)
      await fs.promises.copyFile(workspace.exec, cachedExec)
      compileCache.set(codeHash, cachedExec)
      void pruneCompileCache()
    } catch (e) {
      // 缓存失败不影响判题
    }
  }
  if (language === 'Java') {
    const compile = await runCommand(JAVAC_CMD, [workspace.source], {
      cwd: workspace.root,
      timeout: COMPILE_LIMIT_MS,
      env: WORK_ENV || undefined,
    })
    if (compile.sandboxUnavailable) {
      return {
        ok: false,
        status: 'Judge Error',
        message: SANDBOX_UNAVAILABLE_MESSAGE,
        timeMs: 0,
      }
    }
    if (compile.timedOut) {
      return {
        ok: false,
        status: compile.sandboxUnavailable ? 'Judge Error' : 'Compile Error',
        message: compile.sandboxUnavailable ? SANDBOX_UNAVAILABLE_MESSAGE : '编译超时',
        timeMs: compile.duration,
      }
    }
    if (compile.code !== 0) {
      return {
        ok: false,
        status: 'Compile Error',
        message: (compile.stderr || '编译失败').slice(0, 500),
        timeMs: compile.duration,
      }
    }

    // Java编译后是.class文件，也可以缓存
    try {
      await fs.promises.mkdir(CACHE_ROOT, { recursive: true })
      const cachedClass = path.join(CACHE_ROOT, `${codeHash}.class`)
      const compiledClass = path.join(workspace.root, 'Main.class')
      await fs.promises.copyFile(compiledClass, cachedClass)
      compileCache.set(codeHash, cachedClass)
      void pruneCompileCache()
    } catch (e) {
      // 缓存失败不影响判题
    }
  }
  return { ok: true, cached: false }
}

export const judgeSubmission = async ({ language, code, testcases, onTestCase }) => {
  if (!Array.isArray(testcases) || testcases.length === 0 || testcases.length > MAX_TESTCASE_COUNT) {
    return {
      status: 'Judge Error',
      message: `测试点数量必须在 1～${MAX_TESTCASE_COUNT} 个之间`,
      timeMs: 0,
      results: [],
    }
  }
  const workspace = await prepareWorkspace(language, code)
  const result = {
    status: 'Judge Error',
    message: '不支持的语言',
    timeMs: 0,
    results: [],
  }

  try {
    if (!workspace.exec || !workspace.source) {
      return result
    }
    const compileResult = await compileSource(language, code, workspace)
    if (!compileResult.ok) {
      return {
        status: compileResult.status,
        message: compileResult.message,
        timeMs: compileResult.timeMs,
        results: [],
      }
    }

    // 预热运行：编译完成后先运行一次空输入，丢弃这次的时间
    // 这样可以消除第一次运行的进程启动、缓存加载等开销
    try {
      if (language === 'C++') {
        await runCommand(workspace.exec, [], {
          cwd: workspace.root,
          input: '',
          timeout: TIME_LIMIT_MS,
          env: WORK_ENV || undefined,
        })
      } else if (language === 'Python') {
        await runCommand(PYTHON_CMD, [workspace.exec], {
          cwd: workspace.root,
          input: '',
          timeout: TIME_LIMIT_MS,
          env: WORK_ENV || undefined,
        })
      } else if (language === 'Java') {
        await runCommand(JAVA_CMD, [workspace.exec], {
          cwd: workspace.root,
          input: '',
          timeout: TIME_LIMIT_MS,
          env: WORK_ENV || undefined,
        })
      }
    } catch (e) {
      // 预热失败不影响判题，继续执行
    }

    const normalizedCases = testcases.map((tc) => ({
      input: String(tc.input ?? ''),
      expected: normalizeOutput(String(tc.output ?? '')),
      timeLimitMs: normalizeTestcaseTimeLimit(tc.timeLimitMs),
    }))

    const results = []
    let overallStatus = 'Accepted'

    for (let index = 0; index < normalizedCases.length; index += 1) {
      const tc = normalizedCases[index]
      let execResult
      if (language === 'C++') {
        execResult = await runCommand(workspace.exec, [], {
          cwd: workspace.root,
          input: tc.input,
          timeout: tc.timeLimitMs,
          env: WORK_ENV || undefined,
        })
      } else if (language === 'Python') {
        execResult = await runCommand(PYTHON_CMD, [workspace.exec], {
          cwd: workspace.root,
          input: tc.input,
          timeout: tc.timeLimitMs,
          env: WORK_ENV || undefined,
        })
      } else {
        execResult = await runCommand(JAVA_CMD, [workspace.exec], {
          cwd: workspace.root,
          input: tc.input,
          timeout: tc.timeLimitMs,
          env: WORK_ENV || undefined,
        })
      }

      let caseStatus = 'Accepted'
      let caseMessage = '通过'
      if (execResult.sandboxUnavailable) {
        caseStatus = 'Judge Error'
        caseMessage = SANDBOX_UNAVAILABLE_MESSAGE
      } else if (execResult.timedOut) {
        caseStatus = 'Time Limit Exceeded'
        caseMessage = '超时'
      } else if (execResult.code !== 0) {
        caseStatus = 'Runtime Error'
        caseMessage = (execResult.stderr || '运行错误').slice(0, 500)
      } else {
        const output = normalizeOutput(execResult.stdout)
        if (output !== tc.expected) {
          caseStatus = 'Wrong Answer'
          caseMessage = '答案错误'
        }
      }

      if (statusPriority(caseStatus) > statusPriority(overallStatus)) {
        overallStatus = caseStatus
      }

      results.push({
        index,
        status: caseStatus,
        message: caseMessage,
        timeMs: execResult.duration,
        timeLimitMs: tc.timeLimitMs,
      })

      if (typeof onTestCase === 'function') {
        try {
          onTestCase({
            index,
            status: caseStatus,
            message: caseMessage,
            timeMs: execResult.duration,
            timeLimitMs: tc.timeLimitMs,
          })
        } catch {}
      }
    }

    const totalTime = results.reduce((sum, item) => sum + (item.timeMs ?? 0), 0)
    const totalTests = results.length
    const passedTests = results.filter(r => r.status === 'Accepted').length
    const score = totalTests > 0 ? Math.round((passedTests / totalTests) * 100) : 0

    return {
      status: overallStatus,
      message: statusMessage(overallStatus),
      timeMs: totalTime,
      results,
      score,
    }
  } catch (error) {
    console.error('Judge execution failed:', error)
    return {
      status: 'Judge Error',
      message: '判题失败，请稍后重试',
      timeMs: 0,
      results: [],
    }
  } finally {
    if (workspace?.root) {
      await fs.promises.rm(workspace.root, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}
export const runSample = async ({ language, code, input, timeLimitMs = TIME_LIMIT_MS }) => {
  const workspace = await prepareWorkspace(language, code)
  const codeHash = getCodeHash(language, code)

  const result = {
    status: 'Judge Error',
    message: '不支持的语言',
    timeMs: 0,
    output: '',
  }
  try {
    if (!workspace.exec || !workspace.source) {
      return result
    }
    const sampleTimeLimitMs = normalizeTestcaseTimeLimit(timeLimitMs)
    const compileResult = await compileSource(language, code, workspace)
    if (!compileResult.ok) {
      return {
        status: compileResult.status,
        message: compileResult.message,
        timeMs: 0, // 编译错误不计时
        output: '',
      }
    }

    // 预热运行：编译完成后先运行一次空输入，丢弃这次的时间
    try {
      if (language === 'C++') {
        await runCommand(workspace.exec, [], {
          cwd: workspace.root,
          input: '',
          timeout: TIME_LIMIT_MS,
          env: WORK_ENV || undefined,
        })
      } else if (language === 'Python') {
        await runCommand(PYTHON_CMD, [workspace.exec], {
          cwd: workspace.root,
          input: '',
          timeout: TIME_LIMIT_MS,
          env: WORK_ENV || undefined,
        })
      } else if (language === 'Java') {
        await runCommand(JAVA_CMD, [workspace.exec], {
          cwd: workspace.root,
          input: '',
          timeout: TIME_LIMIT_MS,
          env: WORK_ENV || undefined,
        })
      }
    } catch (e) {
      // 预热失败不影响运行，继续执行
    }

    let execResult
    if (language === 'C++') {
      execResult = await runCommand(workspace.exec, [], {
        cwd: workspace.root,
        input,
        timeout: sampleTimeLimitMs,
        env: WORK_ENV || undefined,
      })
    } else if (language === 'Python') {
      execResult = await runCommand(PYTHON_CMD, [workspace.exec], {
        cwd: workspace.root,
        input,
        timeout: sampleTimeLimitMs,
        env: WORK_ENV || undefined,
      })
    } else {
      execResult = await runCommand(JAVA_CMD, [workspace.exec], {
        cwd: workspace.root,
        input,
        timeout: sampleTimeLimitMs,
        env: WORK_ENV || undefined,
      })
    }

    if (execResult.sandboxUnavailable) {
      return {
        status: 'Judge Error',
        message: SANDBOX_UNAVAILABLE_MESSAGE,
        timeMs: 0,
        output: '',
      }
    }
    if (execResult.timedOut) {
      return {
        status: 'Time Limit Exceeded',
        message: '运行超时',
        timeMs: execResult.duration,
        output: execResult.stdout,
      }
    }
    if (execResult.code !== 0) {
      return {
        status: 'Runtime Error',
        message: (execResult.stderr || '运行时错误').slice(0, 500),
        timeMs: execResult.duration,
        output: execResult.stdout,
      }
    }
    return {
      status: 'OK',
      message: '运行完成',
      timeMs: execResult.duration,
      output: execResult.stdout,
    }
  } catch (error) {
    console.error('Sample execution failed:', error)
    return {
      status: 'Judge Error',
      message: '运行失败，请稍后重试',
      timeMs: 0,
      output: '',
    }
  } finally {
    if (workspace?.root) {
      await fs.promises.rm(workspace.root, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

export const runSamples = async ({ language, code, inputs }) => {
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > MAX_TESTCASE_COUNT) {
    return {
      status: 'Judge Error',
      message: `样例数量必须在 1～${MAX_TESTCASE_COUNT} 个之间`,
      results: [],
    }
  }
  const workspace = await prepareWorkspace(language, code)
  const fallback = {
    status: 'Judge Error',
    message: '不支持的语言',
    results: [],
  }
  try {
    if (!workspace.exec || !workspace.source) {
      return fallback
    }
    const compileResult = await compileSource(language, code, workspace)
    if (!compileResult.ok) {
      return {
        status: compileResult.status,
        message: compileResult.message,
        results: [],
      }
    }
    const results = []
    let overallStatus = 'OK'
    let overallMessage = '运行完成'
    for (const rawInput of inputs) {
      const input = typeof rawInput === 'object'
        ? {
          value: String(rawInput?.input ?? ''),
          timeLimitMs: normalizeTestcaseTimeLimit(rawInput?.timeLimitMs),
        }
        : { value: String(rawInput ?? ''), timeLimitMs: TIME_LIMIT_MS }
      let execResult
      if (language === 'C++') {
        execResult = await runCommand(workspace.exec, [], {
          cwd: workspace.root,
          input: input.value,
          timeout: input.timeLimitMs,
          env: WORK_ENV || undefined,
        })
      } else if (language === 'Python') {
        execResult = await runCommand(PYTHON_CMD, [workspace.exec], {
          cwd: workspace.root,
          input: input.value,
          timeout: input.timeLimitMs,
          env: WORK_ENV || undefined,
        })
      } else {
        execResult = await runCommand(JAVA_CMD, [workspace.exec], {
          cwd: workspace.root,
          input: input.value,
          timeout: input.timeLimitMs,
          env: WORK_ENV || undefined,
        })
      }

      if (execResult.sandboxUnavailable) {
        results.push({
          status: 'Judge Error',
          message: SANDBOX_UNAVAILABLE_MESSAGE,
          timeMs: 0,
          output: '',
        })
        overallStatus = 'Judge Error'
        overallMessage = SANDBOX_UNAVAILABLE_MESSAGE
        break
      }
      if (execResult.timedOut) {
        results.push({
          status: 'Time Limit Exceeded',
          message: '运行超时',
          timeMs: execResult.duration,
          output: execResult.stdout,
        })
        overallStatus = 'Time Limit Exceeded'
        overallMessage = '运行超时'
        break
      }
      if (execResult.code !== 0) {
        results.push({
          status: 'Runtime Error',
          message: (execResult.stderr || '运行时错误').slice(0, 500),
          timeMs: execResult.duration,
          output: execResult.stdout,
        })
        overallStatus = 'Runtime Error'
        overallMessage = '运行时错误'
        break
      }
      results.push({
        status: 'OK',
        message: '运行完成',
        timeMs: execResult.duration,
        output: execResult.stdout,
      })
    }
    return { status: overallStatus, message: overallMessage, results }
  } catch (error) {
    console.error('Samples execution failed:', error)
    return {
      status: 'Judge Error',
      message: '运行失败，请稍后重试',
      results: [],
    }
  } finally {
    if (workspace?.root) {
      await fs.promises.rm(workspace.root, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}
