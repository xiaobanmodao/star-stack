import { spawn } from 'node:child_process'
import { once } from 'node:events'
import http from 'node:http'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const script = path.resolve('scripts/identity/production-judge-fixture.mjs')
const protocol = 'starstack-production-judge/v1'
const servers = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

const readBody = async (request) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

describe('production single judge fixture', () => {
  it('keeps credentials pipe-only and performs exactly login, non-persistent custom run and logout', async () => {
    const calls = []
    const loginId = `jy-gate-${'a'.repeat(24)}`
    const password = 'p'.repeat(48)
    const token = 'ephemeral-session-token-for-test-only'
    const server = http.createServer(async (request, response) => {
      calls.push({ method: request.method, url: request.url })
      if (request.url === '/api/login') {
        expect(await readBody(request)).toEqual({ id: loginId, password })
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ token, user: { id: loginId } }))
        return
      }
      expect(request.headers.authorization).toBe(`Bearer ${token}`)
      if (request.url === '/api/oj/run-custom') {
        const body = await readBody(request)
        expect(body).toMatchObject({ language: 'C++', input: '1 2\n', expected: '3\n' })
        expect(body.code).toContain('a + b')
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ status: 'Accepted', output: '3\n', expected: '3\n', timeMs: 7 }))
        return
      }
      if (request.url === '/api/logout') {
        response.writeHead(204)
        response.end()
        return
      }
      response.writeHead(404)
      response.end()
    })
    server.listen(0, '127.0.0.1')
    servers.push(server)
    await once(server, 'listening')
    const address = server.address()
    const child = spawn(process.execPath, [script], {
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'test',
        STARSTACK_PRODUCTION_JUDGE_TEST_URL: `http://127.0.0.1:${address.port}`,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.stdin.end(`${JSON.stringify({
      protocol,
      requestId: 'judge-1',
      type: 'judge',
      loginId,
      password,
    })}\n`)
    const [code] = await once(child, 'exit')

    expect(code).toBe(0)
    expect(stderr).toBe('')
    expect(stdout.trim().split('\n')).toHaveLength(1)
    expect(JSON.parse(stdout)).toEqual({
      protocol,
      requestId: 'judge-1',
      ok: true,
      type: 'judged',
      status: 'Accepted',
      timeMs: 7,
    })
    expect(stdout).not.toContain(loginId)
    expect(stdout).not.toContain(password)
    expect(stdout).not.toContain(token)
    expect(calls).toEqual([
      { method: 'POST', url: '/api/login' },
      { method: 'POST', url: '/api/oj/run-custom' },
      { method: 'POST', url: '/api/logout' },
    ])
  })

  it('fails closed without echoing credentials when the judge rejects the run', async () => {
    const loginId = `jy-gate-${'b'.repeat(24)}`
    const password = 'q'.repeat(48)
    const server = http.createServer(async (request, response) => {
      if (request.url === '/api/login') {
        await readBody(request)
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ token: 'another-ephemeral-session-token', user: { id: loginId } }))
      } else if (request.url === '/api/oj/run-custom') {
        await readBody(request)
        response.writeHead(503, { 'content-type': 'application/json' })
        response.end('{}')
      } else {
        response.writeHead(204)
        response.end()
      }
    })
    server.listen(0, '127.0.0.1')
    servers.push(server)
    await once(server, 'listening')
    const child = spawn(process.execPath, [script], {
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'test',
        STARSTACK_PRODUCTION_JUDGE_TEST_URL: `http://127.0.0.1:${server.address().port}`,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let output = ''
    let errors = ''
    child.stdout.on('data', (chunk) => { output += chunk.toString() })
    child.stderr.on('data', (chunk) => { errors += chunk.toString() })
    child.stdin.end(`${JSON.stringify({ protocol, requestId: 'judge-fail', type: 'judge', loginId, password })}\n`)
    const [code] = await once(child, 'exit')
    expect(code).not.toBe(0)
    expect(output).toBe('')
    expect(errors).not.toContain(loginId)
    expect(errors).not.toContain(password)
  })
})
