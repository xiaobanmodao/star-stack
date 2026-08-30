#!/usr/bin/env node
import { fstatSync } from 'node:fs'
import path from 'node:path'
import { TextDecoder } from 'node:util'
import { fileURLToPath } from 'node:url'

export const PRODUCTION_JUDGE_FIXTURE_PROTOCOL = 'starstack-production-judge/v1'
const MAX_REQUEST_BYTES = 8 * 1024
const MAX_RESPONSE_BYTES = 64 * 1024
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/
const LOGIN_ID_PATTERN = /^jy-gate-[a-f0-9]{24}$/
const utf8Decoder = new TextDecoder('utf-8', { fatal: true })
const FIXTURE_CODE = `#include <iostream>
int main() {
  long long a = 0, b = 0;
  if (!(std::cin >> a >> b)) return 2;
  std::cout << (a + b) << '\\n';
  return 0;
}`

const fail = (code) => {
  const error = new Error('Production judge fixture rejected')
  error.code = code
  throw error
}

const assertAnonymousPipes = () => {
  const isAnonymous = (stat) => stat.isFIFO() || stat.isSocket()
  if (!isAnonymous(fstatSync(0)) || !isAnonymous(fstatSync(1))) {
    fail('ANONYMOUS_PIPES_REQUIRED')
  }
}

const exactKeys = (value, expected) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

const readRequest = async () => {
  const chunks = []
  let bytes = 0
  for await (const chunk of process.stdin) {
    bytes += chunk.length
    if (bytes > MAX_REQUEST_BYTES) fail('FRAME_TOO_LARGE')
    chunks.push(Buffer.from(chunk))
  }
  let text
  try { text = utf8Decoder.decode(Buffer.concat(chunks)) } catch { fail('INVALID_UTF8') }
  if (!text.endsWith('\n') || text.slice(0, -1).includes('\n')) fail('ONE_NDJSON_FRAME_REQUIRED')
  let request
  try { request = JSON.parse(text.slice(0, -1)) } catch { fail('INVALID_JSON') }
  if (!exactKeys(request, ['protocol', 'requestId', 'type', 'loginId', 'password'])
    || request.protocol !== PRODUCTION_JUDGE_FIXTURE_PROTOCOL
    || request.type !== 'judge'
    || typeof request.requestId !== 'string' || !REQUEST_ID_PATTERN.test(request.requestId)
    || typeof request.loginId !== 'string' || !LOGIN_ID_PATTERN.test(request.loginId)
    || typeof request.password !== 'string' || request.password.length < 32
    || request.password.length > 256 || /[\r\n\0]/.test(request.password)) {
    fail('INVALID_REQUEST')
  }
  return request
}

const readJson = async (response) => {
  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) fail('UPSTREAM_RESPONSE_TOO_LARGE')
  try { return JSON.parse(text) } catch { fail('INVALID_UPSTREAM_RESPONSE') }
}

const resolveBaseUrl = (env) => {
  if (env.NODE_ENV === 'test') {
    const value = env.STARSTACK_PRODUCTION_JUDGE_TEST_URL
    const url = new URL(value)
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1'
      || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
      fail('INVALID_TEST_URL')
    }
    return url.origin
  }
  if (env.NODE_ENV !== 'production' || typeof process.getuid !== 'function' || process.getuid() !== 0) {
    fail('PRODUCTION_ROOT_REQUIRED')
  }
  return 'http://127.0.0.1:5174'
}

const requestJson = async (url, { method = 'GET', token, json, timeoutMs = 15_000 } = {}) => {
  const response = await fetch(url, {
    method,
    redirect: 'error',
    headers: {
      accept: 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(json ? { 'content-type': 'application/json' } : {}),
    },
    body: json ? JSON.stringify(json) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  })
  return response
}

const writeResponse = (value) => new Promise((resolve, reject) => {
  process.stdout.write(`${JSON.stringify(value)}\n`, (error) => error ? reject(error) : resolve())
})

export const runProductionJudgeFixture = async (env = process.env) => {
  assertAnonymousPipes()
  const baseUrl = resolveBaseUrl(env)
  const request = await readRequest()
  let token = null
  let result = null
  try {
    const login = await requestJson(`${baseUrl}/api/login`, {
      method: 'POST',
      json: { id: request.loginId, password: request.password },
    })
    if (login.status !== 200) fail('LOGIN_REJECTED')
    const loginBody = await readJson(login)
    if (typeof loginBody?.token !== 'string' || loginBody.token.length < 16
      || loginBody?.user?.id !== request.loginId) fail('INVALID_LOGIN_RESPONSE')
    token = loginBody.token

    const judged = await requestJson(`${baseUrl}/api/oj/run-custom`, {
      method: 'POST',
      token,
      timeoutMs: 30_000,
      json: {
        language: 'C++',
        code: FIXTURE_CODE,
        input: '1 2\n',
        expected: '3\n',
      },
    })
    if (judged.status !== 200) fail('JUDGE_REJECTED')
    const body = await readJson(judged)
    if (body?.status !== 'Accepted' || String(body?.output || '').trim() !== '3'
      || String(body?.expected || '').trim() !== '3'
      || !Number.isFinite(Number(body?.timeMs)) || Number(body.timeMs) < 0) {
      fail('JUDGE_RESULT_INVALID')
    }
    result = { status: 'Accepted', timeMs: Number(body.timeMs) }
  } finally {
    if (token) {
      const logout = await requestJson(`${baseUrl}/api/logout`, {
        method: 'POST',
        token,
        timeoutMs: 10_000,
      }).catch(() => null)
      if (!logout || logout.status !== 204) fail('LOGOUT_INCOMPLETE')
    }
  }
  await writeResponse({
    protocol: PRODUCTION_JUDGE_FIXTURE_PROTOCOL,
    requestId: request.requestId,
    ok: true,
    type: 'judged',
    ...result,
  })
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  runProductionJudgeFixture().catch((error) => {
    const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code)
      ? error.code
      : 'FAILED_CLOSED'
    process.stderr.write(`[production-judge-fixture] failed closed (${code})\n`)
    process.exitCode = 1
  })
}
