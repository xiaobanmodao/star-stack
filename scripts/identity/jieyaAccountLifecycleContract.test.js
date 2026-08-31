import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const readProjectFile = (relative) => readFile(path.resolve(relative), 'utf8')

describe('Jieya account lifecycle production contract', () => {
  it('keeps lifecycle delivery disabled in PM2 and the production environment template', async () => {
    const [ecosystem, environment, preflight] = await Promise.all([
      readProjectFile('ecosystem.config.cjs'),
      readProjectFile('infra/identity/systemd/starstack-environment.example'),
      readProjectFile('scripts/identity/production-preflight.mjs'),
    ])
    expect(ecosystem).toContain("JIEYA_ACCOUNT_LIFECYCLE_ENABLED: 'false'")
    expect(ecosystem).toContain("JIEYA_ACCOUNT_LIFECYCLE_SECRET: ''")
    expect(JSON.parse(environment)).toMatchObject({
      OIDC_ENABLED: 'false',
      JIEYA_ACCOUNT_LIFECYCLE_ENABLED: 'false',
    })
    expect(preflight).toContain('JIEYA_ACCOUNT_LIFECYCLE_ENABLED must remain false during pre-release')
  })

  it('loads a fourth independent systemd credential and documents the loopback-only endpoint', async () => {
    const [unit, launcher, production, preflight, client] = await Promise.all([
      readProjectFile('infra/identity/systemd/starstack-api.service'),
      readProjectFile('scripts/identity/systemd-server-launcher.mjs'),
      readProjectFile('infra/identity/PRODUCTION.md'),
      readProjectFile('scripts/identity/production-preflight.mjs'),
      readProjectFile('server/identity/jieyaLifecycleClient.js'),
    ])
    expect(unit).toContain('LoadCredential=jieya-account-lifecycle-secret:/etc/starstack/server/jieya-account-lifecycle-secret')
    expect(launcher).toContain("'jieya-account-lifecycle-secret'")
    expect(production).toContain('http://127.0.0.1:4180/internal/starstack/account-lifecycle')
    expect(production).toContain('X-StarStack-Account-Lifecycle')
    expect(production).toContain('Host` 固定为 `jieya.xingzhan.cc')
    expect(production).toContain('applied|duplicate|stale|terminal')
    expect(production).toContain('503 Retry-After: 60')
    expect(production).toContain('其他 `4xx`')
    expect(production).toContain('Node 内置 `fetch`')
    expect(production).toContain('`node:http.request`')
    expect(production).toContain('JIEYA_ACCOUNT_LIFECYCLE_ENABLED=false')
    expect(production).toMatch(/不得.*Token Hook.*Logout Broker|不得复用.*(?:Token Hook|Logout Broker)/)
    expect(preflight).toContain("'/etc/starstack/server/jieya-account-lifecycle-secret'")
    expect(preflight).toContain('Identity credentials must all be distinct')
    expect(client).toContain("import { request as nodeHttpRequest } from 'node:http'")
    expect(client).toContain("Host: JIEYA_ACCOUNT_LIFECYCLE_HOST")
    expect(client).not.toContain('fetchImpl = globalThis.fetch')
  })

  it('warns admins that deletion is terminal and Jieya cloud data must be exported first', async () => {
    const page = await readProjectFile('src/pages/AdminPage.tsx')
    expect(page).toContain('请先让用户导出界芽云档')
    expect(page).toContain('触发界芽云档永久删除')
  })

  it('requires the production fixture to drain deletion through the real lifecycle client', async () => {
    const [fixture, safety, production] = await Promise.all([
      readProjectFile('scripts/identity/production-protocol-fixture.mjs'),
      readProjectFile('scripts/identity/productionFixtureSafety.mjs'),
      readProjectFile('infra/identity/PRODUCTION.md'),
    ])
    expect(fixture).toContain("'/etc/starstack/server/jieya-account-lifecycle-secret'")
    expect(fixture).toContain('createJieyaAccountLifecycleClient')
    expect(fixture).toContain('lifecycleClient,')
    expect(fixture).toContain('lifecycleIssuer: JIEYA_ACCOUNT_LIFECYCLE_ISSUER')
    expect(safety).toContain('readProductionLifecycleCredential')
    expect(production).toContain('只有收到有效 200 回执')
    expect(production).toContain('不得把事件手工改成 completed')
  })
})
