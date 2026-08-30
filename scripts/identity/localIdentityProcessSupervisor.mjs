import { spawn as spawnChild } from 'node:child_process'
import path from 'node:path'

const isRunning = (child) => child.exitCode === null && child.signalCode === null
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

export class IdentityProcessSupervisor {
  #children = new Set()
  #shutdownResolve
  #signalHandlers = new Map()
  #stopPromise

  constructor() {
    this.shutdownRequested = false
    this.shutdownSignal = undefined
    this.shutdown = new Promise((resolve) => { this.#shutdownResolve = resolve })
  }

  spawn(command, args, options = {}) {
    const child = spawnChild(command, args, options)
    const managed = {
      child,
      command: path.basename(command),
      result: undefined,
    }
    managed.exited = new Promise((resolve) => {
      let settled = false
      const settle = (result) => {
        if (settled) return
        settled = true
        managed.result = Object.freeze(result)
        this.#children.delete(managed)
        resolve(managed.result)
      }
      child.once('error', (error) => settle({ code: null, signal: null, error }))
      child.once('exit', (code, signal) => settle({ code, signal, error: undefined }))
      if (!isRunning(child)) {
        queueMicrotask(() => settle({
          code: child.exitCode,
          signal: child.signalCode,
          error: undefined,
        }))
      }
    })
    this.#children.add(managed)
    if (this.shutdownRequested && isRunning(child)) child.kill('SIGTERM')
    return managed
  }

  installSignalHandlers() {
    if (this.#signalHandlers.size > 0) return
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const handler = () => {
        if (this.shutdownRequested) return
        this.shutdownRequested = true
        this.shutdownSignal = signal
        process.exitCode = signal === 'SIGINT' ? 130 : 143
        this.#shutdownResolve(signal)
        void this.stop()
      }
      this.#signalHandlers.set(signal, handler)
      process.on(signal, handler)
    }
  }

  removeSignalHandlers() {
    for (const [signal, handler] of this.#signalHandlers) process.off(signal, handler)
    this.#signalHandlers.clear()
  }

  throwIfShuttingDown() {
    if (this.shutdownRequested) {
      throw new Error(`Local identity runtime interrupted by ${this.shutdownSignal}`)
    }
  }

  async stop({ graceMs = 5000 } = {}) {
    if (this.#stopPromise) return this.#stopPromise
    const operation = (async () => {
      const running = [...this.#children].filter(({ child }) => isRunning(child)).reverse()
      for (const managed of running) managed.child.kill('SIGTERM')
      const allExited = Promise.all(running.map(({ exited }) => exited))
      if (running.length === 0) return
      let graceTimer
      const graceExpired = new Promise((resolve) => {
        graceTimer = setTimeout(() => resolve(false), graceMs)
      })
      const graceful = await Promise.race([allExited.then(() => true), graceExpired])
      clearTimeout(graceTimer)
      if (graceful) return
      for (const managed of running) {
        if (isRunning(managed.child)) managed.child.kill('SIGKILL')
      }
      await Promise.all(running.map(({ exited }) => exited))
    })()
    this.#stopPromise = operation
    try {
      return await operation
    } finally {
      if (this.#stopPromise === operation) this.#stopPromise = undefined
    }
  }
}

export const waitForManagedHttp = async (url, {
  expected = [200],
  timeoutMs = 30000,
  child,
  supervisor,
} = {}) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    supervisor?.throwIfShuttingDown()
    if (child?.result || (child && !isRunning(child.child))) {
      const result = child.result || await child.exited
      throw new Error(
        `${child.command || 'Child'} exited before ${url} became ready `
        + `(code=${result.code ?? 'none'}, signal=${result.signal ?? 'none'})`,
      )
    }
    try {
      const response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(1000),
      })
      if (expected.includes(response.status)) return response
    } catch {}
    await delay(100)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

export const managedProcessIsRunning = (managed) => (
  !managed.result && isRunning(managed.child)
)
