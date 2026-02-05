import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import { spawn } from 'child_process'

const TIME_LIMIT_MS = 1500
const COMPILE_LIMIT_MS = 15000
const IS_WIN = process.platform === 'win32'
const WORK_ROOT = IS_WIN ? path.join('C:\\', 'Temp', 'starstack-oj') : path.join(os.tmpdir(), 'starstack-oj')
const CACHE_ROOT = path.join(WORK_ROOT, 'cache')

// 编译缓存：key是代码hash，value是编译后的可执行文件路径
const compileCache = new Map()

// 计算代码的hash值
const getCodeHash = (language, code) => {
  return crypto.createHash('md5').update(`${language}:${code}`).digest('hex')
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

const runCommand = (cmd, args, options = {}) =>
  new Promise((resolve) => {
    const start = Date.now()
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      windowsHide: true,
      env: options.env ? { ...process.env, ...options.env } : process.env,
    })
    let stdout = ''
    let stderr = ''
    let finished = false
    const timeout = setTimeout(() => {
      if (finished) return
      finished = true
      child.kill('SIGKILL')
      resolve({
        stdout,
        stderr,
        code: -1,
        timedOut: true,
        duration: Date.now() - start,
      })
    }, options.timeout ?? TIME_LIMIT_MS)

    if (options.input) {
      child.stdin.write(options.input)
    }
    child.stdin.end()

    child.stdout.on('data', (data) => {
      stdout += data.toString()
    })
    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })
    child.on('error', (error) => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      resolve({
        stdout,
        stderr: error.message || '执行失败',
        code: -1,
        timedOut: false,
        duration: Date.now() - start,
      })
    })
    child.on('close', (code) => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      resolve({
        stdout,
        stderr,
        code,
        timedOut: false,
        duration: Date.now() - start,
      })
    })
  })

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
    return { root, source, exec: path.join(root, 'main.exe') }
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
    if (compile.timedOut) {
      return {
        ok: false,
        status: 'Compile Error',
        message: '编译超时',
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
      const cachedExec = path.join(CACHE_ROOT, `${codeHash}.exe`)
      await fs.promises.copyFile(workspace.exec, cachedExec)
      compileCache.set(codeHash, cachedExec)
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
    if (compile.timedOut) {
      return {
        ok: false,
        status: 'Compile Error',
        message: '编译超时',
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
    } catch (e) {
      // 缓存失败不影响判题
    }
  }
  return { ok: true, cached: false }
}

export const judgeSubmission = async ({ language, code, testcases }) => {
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
          timeout: TIME_LIMIT_MS,
          env: WORK_ENV || undefined,
        })
      } else if (language === 'Python') {
        execResult = await runCommand(PYTHON_CMD, [workspace.exec], {
          cwd: workspace.root,
          input: tc.input,
          timeout: TIME_LIMIT_MS,
          env: WORK_ENV || undefined,
        })
      } else {
        execResult = await runCommand(JAVA_CMD, [workspace.exec], {
          cwd: workspace.root,
          input: tc.input,
          timeout: TIME_LIMIT_MS,
          env: WORK_ENV || undefined,
        })
      }

      let caseStatus = 'Accepted'
      let caseMessage = '通过'
      if (execResult.timedOut) {
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
      })
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
    return {
      status: 'Judge Error',
      message: error?.message ? String(error.message).slice(0, 500) : '判题失败',
      timeMs: 0,
      results: [],
    }
  } finally {
    if (workspace?.root) {
      fs.promises.rm(workspace.root, { recursive: true, force: true }).catch(() => undefined)
    }
    // 注意：不删除编译缓存，让缓存继续有效以提高性能
  }
}
export const runSample = async ({ language, code, input }) => {
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
        timeout: TIME_LIMIT_MS,
        env: WORK_ENV || undefined,
      })
    } else if (language === 'Python') {
      execResult = await runCommand(PYTHON_CMD, [workspace.exec], {
        cwd: workspace.root,
        input,
        timeout: TIME_LIMIT_MS,
        env: WORK_ENV || undefined,
      })
    } else {
      execResult = await runCommand(JAVA_CMD, [workspace.exec], {
        cwd: workspace.root,
        input,
        timeout: TIME_LIMIT_MS,
        env: WORK_ENV || undefined,
      })
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
    return {
      status: 'Judge Error',
      message: error?.message ? String(error.message).slice(0, 500) : '运行失败',
      timeMs: 0,
      output: '',
    }
  } finally {
    if (workspace?.root) {
      fs.promises.rm(workspace.root, { recursive: true, force: true }).catch(() => undefined)
    }
    // 注意：不删除编译缓存，让缓存继续有效以提高性能
  }
}

export const runSamples = async ({ language, code, inputs }) => {
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
    for (const input of inputs) {
      let execResult
      if (language === 'C++') {
        execResult = await runCommand(workspace.exec, [], {
          cwd: workspace.root,
          input,
          timeout: TIME_LIMIT_MS,
          env: WORK_ENV || undefined,
        })
      } else if (language === 'Python') {
        execResult = await runCommand(PYTHON_CMD, [workspace.exec], {
          cwd: workspace.root,
          input,
          timeout: TIME_LIMIT_MS,
          env: WORK_ENV || undefined,
        })
      } else {
        execResult = await runCommand(JAVA_CMD, [workspace.exec], {
          cwd: workspace.root,
          input,
          timeout: TIME_LIMIT_MS,
          env: WORK_ENV || undefined,
        })
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
    return {
      status: 'Judge Error',
      message: error?.message ? String(error.message).slice(0, 500) : '运行失败',
      results: [],
    }
  } finally {
    if (workspace?.root) {
      fs.promises.rm(workspace.root, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}
