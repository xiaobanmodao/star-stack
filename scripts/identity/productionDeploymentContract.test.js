import { describe, expect, it } from 'vitest'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertActiveBackchannelNginx,
  assertBackchannelNginxComposition,
  assertHookFirewallStatus,
  assertHydraLoopbackNginx,
  assertLoopbackNginxListeners,
  assertTokenHookNginx,
} from './productionNginxContract.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const readProjectFile = (relativePath) => readFile(path.join(projectRoot, relativePath), 'utf8')

const HYDRA_IMAGE = 'oryd/hydra:v26.2.0-distroless@sha256:ad53a123ddf869fc23ea74f3d76b47e2966dc52f559e93ab31f81440f4d60c5e'
const POSTGRES_IMAGE = 'postgres:16.15-alpine3.24@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685'
const BCL_ACCESS_PATH = '/etc/nginx/snippets/jieya-backchannel-access.conf'

const validBackchannelSite = ({ accessPath = BCL_ACCESS_PATH } = {}) => `
server {
  listen 443 ssl;
  server_name jieya.xingzhan.cc;
  location = /auth/backchannel-logout {
    access_log off;
    include ${accessPath};
    proxy_pass http://127.0.0.1:4180;
    proxy_set_header Host jieya.xingzhan.cc;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header Authorization "";
  }
}
`

const validBackchannelAccess = ({ hydraIp = '172.30.40.2' } = {}) => `
allow ${hydraIp}/32;
deny all;
limit_except POST { deny all; }
add_header X-StarStack-BCL-Route private always;
`

const activeNginxDump = ({
  siteMarkerPath,
  accessPath,
  authMarkerPath,
  hydraLoopbackPath,
  siteText = validBackchannelSite({ accessPath }),
  accessText = validBackchannelAccess(),
  authText = 'server { listen 443 ssl; server_name auth.xingzhan.cc; }',
  hydraLoopbackText = '# loopback bridge fixture',
} = {}) => `
# configuration file ${authMarkerPath}:
${authText}
# configuration file ${siteMarkerPath}:
${siteText}
# configuration file ${accessPath}:
${accessText}
# configuration file ${hydraLoopbackPath}:
${hydraLoopbackText}
`

const createActiveNginxFixture = async () => {
  const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ss-auth-003-nginx-active-')))
  const sitesAvailable = path.join(temporary, 'sites-available')
  const sitesEnabled = path.join(temporary, 'sites-enabled')
  const snippets = path.join(temporary, 'snippets')
  await Promise.all([
    mkdir(sitesAvailable, { mode: 0o700 }),
    mkdir(sitesEnabled, { mode: 0o700 }),
    mkdir(snippets, { mode: 0o700 }),
  ])
  const sitePath = path.join(sitesAvailable, 'jieya.xingzhan.cc')
  const siteMarkerPath = path.join(sitesEnabled, 'jieya.xingzhan.cc')
  const authPath = path.join(sitesAvailable, 'auth.xingzhan.cc')
  const authMarkerPath = path.join(sitesEnabled, 'auth.xingzhan.cc')
  const accessPath = path.join(snippets, 'jieya-backchannel-access.conf')
  const hydraLoopbackPath = path.join(snippets, 'hydra-loopback.conf')
  const otherSitePath = path.join(sitesAvailable, 'other.xingzhan.cc')
  await Promise.all([
    writeFile(sitePath, validBackchannelSite({ accessPath }), { mode: 0o644 }),
    writeFile(authPath, 'server { listen 443 ssl; server_name auth.xingzhan.cc; }\n', { mode: 0o644 }),
    writeFile(accessPath, validBackchannelAccess(), { mode: 0o644 }),
    writeFile(hydraLoopbackPath, '# loopback bridge fixture\n', { mode: 0o644 }),
    writeFile(otherSitePath, 'server { listen 443 ssl; server_name other.xingzhan.cc; }\n', { mode: 0o644 }),
  ])
  await Promise.all([
    symlink('../sites-available/jieya.xingzhan.cc', siteMarkerPath),
    symlink('../sites-available/auth.xingzhan.cc', authMarkerPath),
  ])
  return {
    temporary,
    sitePath,
    siteMarkerPath,
    authPath,
    authMarkerPath,
    accessPath,
    hydraLoopbackPath,
    otherSitePath,
  }
}

const composeService = (compose, service, nextService = null) => {
  const start = compose.indexOf(`\n  ${service}:`)
  const end = nextService
    ? compose.indexOf(`\n  ${nextService}:`, start + 1)
    : compose.indexOf('\nvolumes:', start + 1)
  if (start < 0 || end < 0) throw new Error(`Compose service ${service} was not found`)
  return compose.slice(start, end)
}

const nginxBlocks = (source, directive) => {
  const blocks = []
  const pattern = new RegExp(`(^|\\n)\\s*${directive}\\s*\\{`, 'g')
  let match
  while ((match = pattern.exec(source)) !== null) {
    const start = source.indexOf('{', match.index)
    let depth = 0
    for (let index = start; index < source.length; index += 1) {
      if (source[index] === '{') depth += 1
      if (source[index] === '}') depth -= 1
      if (depth === 0) {
        blocks.push(source.slice(match.index + match[1].length, index + 1).trim())
        pattern.lastIndex = index + 1
        break
      }
    }
  }
  return blocks
}

const nginxTopLevelLines = (block) => {
  let depth = 0
  const lines = []
  for (const line of block.split('\n')) {
    if (depth === 1) lines.push(line.trim())
    depth += [...line].filter((character) => character === '{').length
    depth -= [...line].filter((character) => character === '}').length
  }
  return lines
}

describe('SS-AUTH-003 production deployment contract', () => {
  for (const environment of ['production', 'staging']) {
    it(`${environment} compose is isolated, pinned and private by construction`, async () => {
      const compose = await readProjectFile(`infra/identity/compose.${environment}.yaml`)
      expect(compose).toContain(HYDRA_IMAGE)
      expect(compose).toContain(POSTGRES_IMAGE)
      expect(compose).toContain('internal: true')
      expect(compose).toContain('host.docker.internal:${IDENTITY_HOOK_GATEWAY_IP:')
      expect(compose).toContain('jieya.xingzhan.cc:${IDENTITY_HOOK_GATEWAY_IP:')
      expect(compose).not.toContain(':host-gateway')
      expect(compose).toContain('ipv4_address: ${IDENTITY_HYDRA_HOOK_IP:')
      expect(compose).toContain('gateway: ${IDENTITY_HOOK_GATEWAY_IP:')
      expect(compose).toContain(environment === 'production' ? 'br-ss-hook-prod' : 'br-ss-hook-stg')
      expect(compose.match(/internal: true/g)).toHaveLength(2)
      expect(compose).not.toContain('identity-host-proxy')
      expect(composeService(compose, 'hydra')).not.toContain('\n    ports:')
      expect(composeService(compose, 'postgres', 'hydra-migrate')).not.toContain('\n    ports:')
      expect(compose).not.toContain('--dev')
      expect(compose).not.toContain('sslmode=disable')
      expect(compose).not.toContain('network_mode: host')
      expect(compose).not.toContain('auth.localhost')
      expect(compose).not.toContain('jieya.localhost')
      expect(compose).not.toMatch(/(?:^|["'])0\.0\.0\.0:/m)
    })

    it(`${environment} Hydra config freezes production protocol policy`, async () => {
      const config = await readProjectFile(`infra/identity/hydra.${environment}.yaml`)
      expect(config).toContain('issuer: https://auth.xingzhan.cc')
      expect(config).toContain('userinfo_url: https://auth.xingzhan.cc/oauth2/userinfo')
      expect(config).toContain('enforced: true')
      expect(config).toContain('encrypt_at_rest: true')
      expect(config).toContain('rotation_grace_period: 0s')
      expect(config).toContain('rotation_grace_reuse_count: 0')
      expect(config).toContain('access_token: opaque')
      expect(config).toContain('enabled: false')
      expect(config).not.toContain('localhost')
      expect(config).not.toContain('secret')
    })
  }

  it('public and bridge Nginx templates expose only their frozen trust surfaces', async () => {
    const publicConfig = await readProjectFile('infra/identity/nginx/auth.xingzhan.cc.conf')
    const hookTemplate = await readProjectFile('infra/identity/nginx/token-hook.bridge.conf.template')
    const backchannelTemplate = await readProjectFile('infra/identity/nginx/jieya-backchannel.access.conf.template')
    const hydraLoopbackTemplate = await readProjectFile('infra/identity/nginx/hydra-loopback.bridge.conf.template')
    const productionGuide = await readProjectFile('infra/identity/PRODUCTION.md')
    expect(publicConfig).toContain('server_name auth.xingzhan.cc;')
    expect(publicConfig).toContain('access_log off;')
    expect(publicConfig).toContain('Strict-Transport-Security "max-age=31536000" always;')
    expect(publicConfig).not.toContain('includeSubDomains')
    expect(publicConfig).toMatch(/location \^~ \/internal\/oidc\/[^]*?return 404;/)
    expect(publicConfig).toContain('proxy_pass http://127.0.0.1:5174;')
    expect(publicConfig).toContain('proxy_set_header X-Forwarded-For $remote_addr;')
    expect(publicConfig).not.toContain('$proxy_add_x_forwarded_for')
    expect(publicConfig).not.toContain('proxy_pass http://127.0.0.1:4445')
    expect(publicConfig).not.toContain('starstack-hydra-loopback')
    expect(productionGuide).toContain('http://127.0.0.1:5174/internal/oidc/logout-transactions')
    expect(productionGuide).not.toContain('https://auth.xingzhan.cc/internal/oidc/logout-transactions')
    expect(productionGuide).toContain('IDENTITY_NGINX_AUTH_CONFIG=/etc/nginx/sites-available/auth.xingzhan.cc')
    expect(productionGuide).toContain('IDENTITY_NGINX_BCL_SITE_CONFIG=/etc/nginx/sites-available/jieya.xingzhan.cc')
    expect(productionGuide).toContain('sites-enabled')
    expect(productionGuide).toContain('realpath')
    expect(hookTemplate).toContain('listen __IDENTITY_HOOK_GATEWAY_IP__:5175;')
    expect(hookTemplate).toContain('allow __IDENTITY_HYDRA_HOOK_IP__/32;')
    expect(hookTemplate).not.toContain('allow __IDENTITY_HOOK_SUBNET__;')
    expect(hookTemplate).toMatch(/location = \/internal\/oidc\/token-hook/)
    expect(hookTemplate).toMatch(/limit_except POST/)
    expect(hookTemplate).toContain('proxy_pass http://127.0.0.1:5174;')
    expect(hookTemplate).toContain('add_header X-StarStack-Hook-Route private always;')
    expect(hookTemplate).not.toContain('logout-transactions')
    expect(backchannelTemplate).toContain('allow __IDENTITY_HYDRA_HOOK_IP__/32;')
    expect(backchannelTemplate).toContain('deny all;')
    expect(backchannelTemplate).toMatch(/limit_except POST\s*\{\s*deny all;\s*\}/)
    expect(backchannelTemplate).toContain('add_header X-StarStack-BCL-Route private always;')
    expect(backchannelTemplate).not.toMatch(/\blocation\b|\blisten\b|proxy_pass/)
    expect(backchannelTemplate).not.toContain('listen ')
    expect(hydraLoopbackTemplate).toContain('listen 127.0.0.1:__HYDRA_PUBLIC_PORT__;')
    expect(hydraLoopbackTemplate).toContain('listen 127.0.0.1:__HYDRA_ADMIN_PORT__;')
    expect(hydraLoopbackTemplate).toContain('proxy_pass http://__IDENTITY_HYDRA_HOOK_IP__:4444;')
    expect(hydraLoopbackTemplate).toContain('proxy_pass http://__IDENTITY_HYDRA_HOOK_IP__:4445;')
    expect(hydraLoopbackTemplate).not.toMatch(/listen\s+(?:0\.0\.0\.0|\[::\]|\*:)/)
    const renderedHook = hookTemplate
      .replaceAll('__IDENTITY_HOOK_GATEWAY_IP__', '172.30.40.9')
      .replaceAll('__IDENTITY_HYDRA_HOOK_IP__', '172.30.40.10')
    expect(() => assertTokenHookNginx({
      text: renderedHook,
      gatewayIp: '172.30.40.9',
      hydraIp: '172.30.40.10',
    })).not.toThrow()
    expect(() => assertTokenHookNginx({
      text: renderedHook.replace('deny all;', 'allow 172.30.40.8/29;\n    deny all;'),
      gatewayIp: '172.30.40.9',
      hydraIp: '172.30.40.10',
    })).toThrow(/unexpected|allow|Token Hook/i)
  })

  it('accepts standard sites-enabled links only when they resolve to the audited regular files', async () => {
    const fixture = await createActiveNginxFixture()
    try {
      expect(() => assertBackchannelNginxComposition({
        siteText: validBackchannelSite({ accessPath: fixture.accessPath }),
        accessText: validBackchannelAccess(),
        accessPath: fixture.accessPath,
        hydraHookIp: '172.30.40.2',
      })).not.toThrow()
      await expect(Promise.resolve().then(() => assertActiveBackchannelNginx({
        dump: activeNginxDump({
          siteMarkerPath: fixture.siteMarkerPath,
          accessPath: fixture.accessPath,
          authMarkerPath: fixture.authMarkerPath,
          hydraLoopbackPath: fixture.hydraLoopbackPath,
        }),
        sitePath: fixture.sitePath,
        accessPath: fixture.accessPath,
        authPath: fixture.authPath,
        hydraLoopbackPath: fixture.hydraLoopbackPath,
      }))).resolves.toBe(true)
    } finally {
      await rm(fixture.temporary, { recursive: true, force: true })
    }
  })

  it('rejects a marker for another file, broken or multi-hop links, duplicate markers and unloaded files', async () => {
    const fixture = await createActiveNginxFixture()
    try {
      const active = (siteMarkerPath = fixture.siteMarkerPath) => activeNginxDump({
        siteMarkerPath,
        accessPath: fixture.accessPath,
        authMarkerPath: fixture.authMarkerPath,
        hydraLoopbackPath: fixture.hydraLoopbackPath,
      })
      const assertion = (dump) => Promise.resolve().then(() => assertActiveBackchannelNginx({
        dump,
        sitePath: fixture.sitePath,
        accessPath: fixture.accessPath,
        authPath: fixture.authPath,
        hydraLoopbackPath: fixture.hydraLoopbackPath,
      }))

      await expect(assertion(active(fixture.otherSitePath))).rejects.toThrow(/active|marker/i)
      await expect(assertion(activeNginxDump({
        siteMarkerPath: fixture.siteMarkerPath,
        accessPath: fixture.accessPath,
        authMarkerPath: fixture.otherSitePath,
        hydraLoopbackPath: fixture.hydraLoopbackPath,
      }))).rejects.toThrow(/active|marker/i)

      const brokenMarker = path.join(path.dirname(fixture.siteMarkerPath), 'broken.xingzhan.cc')
      await symlink('../sites-available/missing.xingzhan.cc', brokenMarker)
      await expect(assertion(active(brokenMarker))).rejects.toThrow(/active|marker/i)

      const intermediateMarker = path.join(path.dirname(fixture.siteMarkerPath), 'intermediate.xingzhan.cc')
      const multiHopMarker = path.join(path.dirname(fixture.siteMarkerPath), 'multi-hop.xingzhan.cc')
      await symlink('../sites-available/jieya.xingzhan.cc', intermediateMarker)
      await symlink('intermediate.xingzhan.cc', multiHopMarker)
      await expect(assertion(active(multiHopMarker))).rejects.toThrow(/active|marker/i)

      const linkedAccessMarker = path.join(path.dirname(fixture.accessPath), 'linked-access.conf')
      await symlink(path.basename(fixture.accessPath), linkedAccessMarker)
      await expect(assertion(activeNginxDump({
        siteMarkerPath: fixture.siteMarkerPath,
        accessPath: linkedAccessMarker,
        authMarkerPath: fixture.authMarkerPath,
        hydraLoopbackPath: fixture.hydraLoopbackPath,
      }))).rejects.toThrow(/regular-file path directly|active|marker/i)

      await expect(assertion(`${active()}\n# configuration file ${fixture.sitePath}:\n`))
        .rejects.toThrow(/exactly once|active|marker/i)
      await expect(assertion(active().replace(
        `# configuration file ${fixture.accessPath}:`,
        '# access snippet was not loaded:',
      ))).rejects.toThrow(/active|marker/i)
    } finally {
      await rm(fixture.temporary, { recursive: true, force: true })
    }
  })

  it('rejects an unreferenced fake Back-Channel file and duplicate exact locations', async () => {
    expect(() => assertBackchannelNginxComposition({
      siteText: validBackchannelSite({ accessPath: '/etc/nginx/snippets/unrelated.conf' }),
      accessText: validBackchannelAccess(),
      accessPath: BCL_ACCESS_PATH,
      hydraHookIp: '172.30.40.2',
    })).toThrow(/include/i)
    const duplicated = `${validBackchannelSite()}\n${validBackchannelSite()}`
    expect(() => assertBackchannelNginxComposition({
      siteText: duplicated,
      accessText: validBackchannelAccess(),
      accessPath: BCL_ACCESS_PATH,
      hydraHookIp: '172.30.40.2',
    })).toThrow(/exactly one/i)

    const fixture = await createActiveNginxFixture()
    try {
      await expect(Promise.resolve().then(() => assertActiveBackchannelNginx({
        dump: activeNginxDump({
          siteMarkerPath: fixture.siteMarkerPath,
          accessPath: fixture.accessPath,
          authMarkerPath: fixture.authMarkerPath,
          hydraLoopbackPath: fixture.hydraLoopbackPath,
          siteText: duplicated.replaceAll(BCL_ACCESS_PATH, fixture.accessPath),
        }),
        sitePath: fixture.sitePath,
        accessPath: fixture.accessPath,
        authPath: fixture.authPath,
        hydraLoopbackPath: fixture.hydraLoopbackPath,
      }))).rejects.toThrow(/exactly one/i)
    } finally {
      await rm(fixture.temporary, { recursive: true, force: true })
    }
  })

  it.each([
    ['an extra allow', `${validBackchannelAccess()}allow 172.30.40.3/32;`, /allow/i],
    ['a loopback allow', `${validBackchannelAccess()}allow 127.0.0.1;`, /allow/i],
    ['a missing POST restriction', validBackchannelAccess().replace('limit_except POST { deny all; }', ''), /POST/i],
    ['a missing private marker', validBackchannelAccess().replace('add_header X-StarStack-BCL-Route private always;', ''), /marker/i],
  ])('rejects Back-Channel access snippets with %s', (_label, accessText, expected) => {
    expect(() => assertBackchannelNginxComposition({
      siteText: validBackchannelSite(),
      accessText,
      accessPath: BCL_ACCESS_PATH,
      hydraHookIp: '172.30.40.2',
    })).toThrow(expected)
  })

  it.each([
    ['proxy_pass http://127.0.0.1:4180;', /proxy/i],
    ['proxy_set_header Host jieya.xingzhan.cc;', /header/i],
    ['proxy_set_header X-Real-IP $remote_addr;', /header/i],
    ['proxy_set_header X-Forwarded-For $remote_addr;', /header/i],
    ['proxy_set_header X-Forwarded-Proto https;', /header/i],
    ['proxy_set_header Authorization "";', /header/i],
  ])('rejects the Jieya Back-Channel location without %s', (required, expected) => {
    expect(() => assertBackchannelNginxComposition({
      siteText: validBackchannelSite().replace(required, ''),
      accessText: validBackchannelAccess(),
      accessPath: BCL_ACCESS_PATH,
      hydraHookIp: '172.30.40.2',
    })).toThrow(expected)
  })

  it('accepts only the exact loopback Hydra bridge and loopback listeners', async () => {
    const text = (await readProjectFile('infra/identity/nginx/hydra-loopback.bridge.conf.template'))
      .replaceAll('__IDENTITY_HYDRA_HOOK_IP__', '172.30.40.10')
      .replaceAll('__HYDRA_PUBLIC_PORT__', '4544')
      .replaceAll('__HYDRA_ADMIN_PORT__', '4545')
    expect(() => assertHydraLoopbackNginx({
      text,
      hydraHookIp: '172.30.40.10',
      publicPort: 4544,
      adminPort: 4545,
    })).not.toThrow()
    expect(() => assertHydraLoopbackNginx({
      text: text.replace('listen 127.0.0.1:4545;', 'listen 0.0.0.0:4545;'),
      hydraHookIp: '172.30.40.10',
      publicPort: 4544,
      adminPort: 4545,
    })).toThrow(/loopback|listen/i)

    const listeners = 'LISTEN 0 511 127.0.0.1:4544 0.0.0.0:*\nLISTEN 0 511 127.0.0.1:4545 0.0.0.0:*\n'
    expect(() => assertLoopbackNginxListeners({ output: listeners, publicPort: 4544, adminPort: 4545 }))
      .not.toThrow()
    expect(() => assertLoopbackNginxListeners({
      output: listeners.replace('127.0.0.1:4545', '0.0.0.0:4545'),
      publicPort: 4544,
      adminPort: 4545,
    })).toThrow(/loopback|listener/i)
  })

  it('accepts only the exact persistent UFW ingress contract for the internal hook gateway', () => {
    const verbose = 'Status: active\nLogging: on (low)\nDefault: deny (incoming), allow (outgoing), disabled (routed)\n'
    const numbered = [
      '[ 1] 172.30.40.9 443/tcp on br-ss-hook-stg ALLOW IN 172.30.40.10 # StarStack Hydra BCL',
      '[ 2] 172.30.40.9 5175/tcp on br-ss-hook-stg ALLOW IN 172.30.40.10 # StarStack Hydra token hook',
      '[ 3] Anywhere on br-ss-hook-stg DENY IN Anywhere # StarStack identity hook default deny',
    ].join('\n')
    expect(() => assertHookFirewallStatus({
      verbose,
      numbered,
      bridge: 'br-ss-hook-stg',
      gatewayIp: '172.30.40.9',
      hydraIp: '172.30.40.10',
    })).not.toThrow()
    expect(() => assertHookFirewallStatus({
      verbose,
      numbered: numbered.replace(
        '[ 3] Anywhere on br-ss-hook-stg DENY IN Anywhere',
        '[ 3] 172.30.40.9 80/tcp on br-ss-hook-stg ALLOW IN 172.30.40.8/29',
      ),
      bridge: 'br-ss-hook-stg',
      gatewayIp: '172.30.40.9',
      hydraIp: '172.30.40.10',
    })).toThrow(/firewall|allow|deny/i)

    expect(() => assertHookFirewallStatus({
      verbose,
      numbered: [
        '[ 4] 172.30.40.9 443/tcp on br-ss-hook-stg ALLOW IN 172.30.40.10',
        '[ 5] 172.30.40.9 5175/tcp on br-ss-hook-stg ALLOW IN 172.30.40.10',
        '[ 6] Anywhere on br-ss-hook-stg DENY IN Anywhere',
      ].join('\n'),
      bridge: 'br-ss-hook-stg',
      gatewayIp: '172.30.40.9',
      hydraIp: '172.30.40.10',
    })).toThrow(/rules 1 and 2/)
  })

  it('serves only exact HTTP-01 files before redirecting other auth HTTP traffic', async () => {
    const publicConfig = await readProjectFile('infra/identity/nginx/auth.xingzhan.cc.conf')
    const httpServer = nginxBlocks(publicConfig, 'server')
      .find((block) => block.includes('listen 80;'))
    expect(httpServer).toBeTruthy()
    expect(httpServer).toContain('listen [::]:80;')
    expect(httpServer).toContain('server_name auth.xingzhan.cc;')
    expect(httpServer).toContain('access_log off;')

    const challenge = nginxBlocks(httpServer, 'location \\^~ /\\.well-known/acme-challenge/')
    expect(challenge).toHaveLength(1)
    expect(challenge[0]).toContain('root /var/lib/acme;')
    expect(challenge[0]).toContain('default_type text/plain;')
    expect(challenge[0]).toContain('try_files $uri =404;')
    expect(challenge[0]).toMatch(/limit_except GET\s*\{\s*deny all;\s*\}/)
    expect(challenge[0]).not.toMatch(/proxy_pass|fastcgi_pass|uwsgi_pass|scgi_pass|grpc_pass|rewrite|alias/)

    const fallback = nginxBlocks(httpServer, 'location /')
    expect(fallback).toHaveLength(1)
    expect(fallback[0]).toContain('return 308 https://auth.xingzhan.cc$request_uri;')
    expect(nginxTopLevelLines(httpServer)).not.toContain('return 308 https://auth.xingzhan.cc$request_uri;')
  })

  it('ships a fail-closed Back-Channel TLS route verifier', async () => {
    const packageJson = JSON.parse(await readProjectFile('package.json'))
    expect(packageJson.scripts['identity:production:render-backchannel-nginx'])
      .toBe('node scripts/identity/render-backchannel-nginx.mjs')
    expect(packageJson.scripts['identity:production:render-hydra-loopback-nginx'])
      .toBe('node scripts/identity/render-hydra-loopback-nginx.mjs')
    expect(packageJson.scripts['identity:production:render-hook-firewall'])
      .toBe('node scripts/identity/render-hook-firewall.mjs')
    expect(packageJson.scripts['identity:production:verify-backchannel'])
      .toBe('node scripts/identity/verify-production-backchannel-route.mjs')
    const verifier = await readProjectFile('scripts/identity/verify-production-backchannel-route.mjs')
    expect(verifier).toContain("'nsenter'")
    expect(verifier).toContain("'openssl'")
    expect(verifier).toContain("'-verify_hostname', 'jieya.xingzhan.cc'")
    expect(verifier).toContain("'-verify_return_error'")
    expect(verifier).toContain("'-servername', 'jieya.xingzhan.cc'")
    expect(verifier).toContain('X-StarStack-BCL-Route')
    expect(verifier).toContain('X-StarStack-Hook-Route')
    expect(verifier).not.toMatch(/rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED|--insecure|-k\b/)
  })

  it('PM2 keeps identity disabled and Node loopback-only by default', async () => {
    const ecosystem = await readProjectFile('ecosystem.config.cjs')
    expect(ecosystem).toContain("OIDC_ENABLED: process.env.OIDC_ENABLED || 'false'")
    expect(ecosystem).toContain("OIDC_ISSUER: process.env.OIDC_ISSUER || 'https://auth.xingzhan.cc'")
    expect(ecosystem).toContain("HOST: process.env.HOST || '127.0.0.1'")
    expect(ecosystem).not.toContain("HOST: '0.0.0.0'")
  })

  it('ships a read-only preflight and separate backup tooling', async () => {
    const packageJson = JSON.parse(await readProjectFile('package.json'))
    expect(packageJson.scripts['identity:production:preflight']).toBe('node scripts/identity/production-preflight.mjs')
    expect(packageJson.scripts['identity:production:backup']).toBe('node scripts/identity/production-backup.mjs')
    const preflight = await readProjectFile('scripts/identity/production-preflight.mjs')
    expect(preflight).toContain('OIDC_ENABLED must remain false during pre-release')
    expect(preflight).toContain("requireValue('IDENTITY_NGINX_BCL_SITE_CONFIG')")
    expect(preflight).toContain("requireValue('IDENTITY_NGINX_BCL_ACCESS_CONFIG')")
    expect(preflight).toContain("requireValue('IDENTITY_NGINX_HYDRA_LOOPBACK_CONFIG')")
    expect(preflight).toContain('assertBackchannelNginxComposition({')
    expect(preflight).toContain('await assertActiveBackchannelNginx({')
    expect(preflight).toContain('authPath: authNginx')
    expect(preflight).toContain("['-T']")
    expect(preflight).toContain("['-H', '-ltn']")
    expect(preflight).toContain("['status', 'verbose']")
    expect(preflight).toContain("['status', 'numbered']")
    expect(preflight).toContain('IDENTITY_PROXY_CIDR must be the exact internal hook gateway /32')
    expect(preflight).not.toMatch(/\b(?:writeFile|rm|unlink|rename|mkdir|chmod|chown)\b/)
    const backup = await readProjectFile('scripts/identity/production-backup.mjs')
    expect(backup).toContain('pg_dump')
    expect(backup).toContain('sqlite3')
    expect(backup).toContain('manifest.json')
    expect(backup).toContain("'compose'")
    expect(backup).toContain("'exec'")
    expect(backup).not.toContain('HYDRA_BACKUP_DSN')
  })

  it('does not use the development HBA or environment contract', async () => {
    const production = await readProjectFile('infra/identity/compose.production.yaml')
    const staging = await readProjectFile('infra/identity/compose.staging.yaml')
    expect(production).toContain('./postgres.production.pg_hba.conf')
    expect(staging).toContain('./postgres.staging.pg_hba.conf')
    expect(production).not.toContain('infra/identity/.env.example')
    expect(staging).not.toContain('infra/identity/.env.example')
  })

  it('renders only a narrow private Token Hook bridge', () => {
    const script = path.join(projectRoot, 'scripts/identity/render-token-hook-nginx.mjs')
    const valid = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        IDENTITY_HOOK_SUBNET: '172.30.40.0/29',
        IDENTITY_HOOK_GATEWAY_IP: '172.30.40.1',
        IDENTITY_HYDRA_HOOK_IP: '172.30.40.2',
      },
    })
    expect(valid.status).toBe(0)
    expect(valid.stdout).toContain('listen 172.30.40.1:5175;')
    expect(valid.stdout).toContain('allow 172.30.40.2/32;')
    for (const [gateway, subnet, hydra] of [
      ['8.8.8.8', '8.8.8.0/29', '8.8.8.2'],
      ['172.30.40.2', '172.30.40.0/29', '172.30.40.3'],
      ['172.30.40.1', '172.30.0.0/16', '172.30.40.2'],
      ['172.30.40.1', '172.30.40.1/29', '172.30.40.2'],
    ]) {
      const rejected = spawnSync(process.execPath, [script], {
        encoding: 'utf8',
        env: {
          ...process.env,
          IDENTITY_HOOK_GATEWAY_IP: gateway,
          IDENTITY_HOOK_SUBNET: subnet,
          IDENTITY_HYDRA_HOOK_IP: hydra,
        },
      })
      expect(rejected.status).not.toBe(0)
      expect(rejected.stdout).toBe('')
    }
  })

  it('renders only the fixed Hydra /32 policy for the Jieya Back-Channel include', () => {
    const script = path.join(projectRoot, 'scripts/identity/render-backchannel-nginx.mjs')
    const valid = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        IDENTITY_HOOK_SUBNET: '172.30.40.0/29',
        IDENTITY_HOOK_GATEWAY_IP: '172.30.40.1',
        IDENTITY_HYDRA_HOOK_IP: '172.30.40.2',
      },
    })
    expect(valid.status).toBe(0)
    expect(valid.stdout).toContain('allow 172.30.40.2/32;')
    expect(valid.stdout).toMatch(/limit_except POST\s*\{\s*deny all;\s*\}/)
    expect(valid.stdout).toContain('add_header X-StarStack-BCL-Route private always;')
    expect(valid.stdout).not.toMatch(/\blocation\b|\blisten\b|proxy_pass/)
    expect(valid.stdout).not.toContain('__IDENTITY_')
    for (const hydraIp of ['8.8.8.8', '172.30.40.0', '172.30.40.7', '172.30.41.2', '172.17.0.1']) {
      const rejected = spawnSync(process.execPath, [script], {
        encoding: 'utf8',
        env: {
          ...process.env,
          IDENTITY_HOOK_SUBNET: '172.30.40.0/29',
          IDENTITY_HOOK_GATEWAY_IP: '172.30.40.1',
          IDENTITY_HYDRA_HOOK_IP: hydraIp,
        },
      })
      expect(rejected.status).not.toBe(0)
      expect(rejected.stdout).toBe('')
    }
  })

  it('renders frozen loopback Nginx and exact persistent firewall candidates', () => {
    const common = {
      ...process.env,
      IDENTITY_ENVIRONMENT: 'staging',
      IDENTITY_HOOK_SUBNET: '172.30.40.8/29',
      IDENTITY_HOOK_GATEWAY_IP: '172.30.40.9',
      IDENTITY_HYDRA_HOOK_IP: '172.30.40.10',
      HYDRA_PUBLIC_PORT: '4544',
      HYDRA_ADMIN_PORT: '4545',
    }
    const loopback = spawnSync(process.execPath, [
      path.join(projectRoot, 'scripts/identity/render-hydra-loopback-nginx.mjs'),
    ], { encoding: 'utf8', env: common })
    expect(loopback.status).toBe(0)
    expect(loopback.stdout).toContain('listen 127.0.0.1:4544;')
    expect(loopback.stdout).toContain('listen 127.0.0.1:4545;')
    expect(loopback.stdout).toContain('proxy_pass http://172.30.40.10:4444;')
    expect(loopback.stdout).not.toContain('__IDENTITY_')

    const firewall = spawnSync(process.execPath, [
      path.join(projectRoot, 'scripts/identity/render-hook-firewall.mjs'),
    ], { encoding: 'utf8', env: common })
    expect(firewall.status).toBe(0)
    expect(firewall.stdout).toContain('on br-ss-hook-stg')
    expect(firewall.stdout).toContain('from 172.30.40.10 to 172.30.40.9 port 443')
    expect(firewall.stdout).toContain('from 172.30.40.10 to 172.30.40.9 port 5175')
    expect(firewall.stdout).toContain('deny in on br-ss-hook-stg from any to any')
    expect(firewall.stdout).not.toContain('allow in on br-ss-hook-stg proto tcp from 172.30.40.8/29')
  })

  it('proves the exact source route and verified canonical TLS path without credentials', async () => {
    const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ss-auth-003-bcl-')))
    try {
      const bin = path.join(temporary, 'bin')
      await mkdir(bin, { mode: 0o700 })
      const docker = path.join(bin, 'docker')
      const nsenter = path.join(bin, 'nsenter')
      const containerHosts = path.join(temporary, 'hydra-hosts')
      await writeFile(containerHosts, '172.30.40.1\tjieya.xingzhan.cc\n', { mode: 0o644 })
      await writeFile(docker, `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args[0] === 'compose') process.stdout.write('aaaaaaaaaaaa\\n')
else if (args[0] === 'inspect') process.stdout.write(JSON.stringify([{
  Id: 'aaaaaaaaaaaa',
  State: { Running: true, Pid: 4242 },
  HostConfig: {
    ExtraHosts: ['host.docker.internal:172.30.40.1', 'jieya.xingzhan.cc:172.30.40.1'],
    PortBindings: {},
  },
  HostsPath: ${JSON.stringify(containerHosts)},
  NetworkSettings: {
    Ports: { '4444/tcp': null, '4445/tcp': null },
    Networks: {
      'starstack-identity-database-production': { IPAddress: '172.30.41.2' },
      'starstack-identity-hook-production': { IPAddress: '172.30.40.2' },
    },
  },
}]))
else if (args[0] === 'network' && args[1] === 'inspect') process.stdout.write(JSON.stringify([
  { Name: 'starstack-identity-database-production', Internal: true },
  {
    Name: 'starstack-identity-hook-production', Internal: true,
    Options: { 'com.docker.network.bridge.name': 'br-ss-hook-prod' },
    IPAM: { Config: [{ Subnet: '172.30.40.0/29', Gateway: '172.30.40.1' }] },
    Containers: { aaaaaaaaaaaa: { Name: 'hydra' } },
  },
]))
else process.exit(2)
`)
      await writeFile(nsenter, `#!/usr/bin/env node
const { readFileSync } = require('node:fs')
const args = process.argv.slice(2)
if (args.includes('ip')) process.stdout.write('172.30.40.1 dev eth1 src 172.30.40.2\\n')
else if (args.includes('openssl')) {
  const request = readFileSync(0, 'utf8')
  const body = 'logout_token=invalid'
  const valid = request.includes('Content-Type: application/x-www-form-urlencoded\\r\\n')
    && request.includes('Content-Length: ' + Buffer.byteLength(body) + '\\r\\n')
    && request.endsWith('\\r\\n\\r\\n' + body)
  process.stdout.write(valid
    ? 'HTTP/1.1 401 Unauthorized\\r\\nX-StarStack-BCL-Route: private\\r\\n\\r\\n'
    : 'HTTP/1.1 415 Unsupported Media Type\\r\\nX-StarStack-BCL-Route: private\\r\\n\\r\\n')
}
else if (args.includes('-e')) process.stdout.write(JSON.stringify({ status: 401, marker: 'private' }))
else process.exit(2)
`)
      await Promise.all([docker, nsenter].map((file) => chmod(file, 0o700)))
      const compose = path.join(temporary, 'compose.production.yaml')
      const envFile = path.join(temporary, 'production.env')
      const caBundle = path.join(temporary, 'ca-certificates.crt')
      await writeFile(compose, 'services: {}\n', { mode: 0o644 })
      await writeFile(envFile, 'fixture=true\n', { mode: 0o600 })
      await writeFile(caBundle, 'fixture-ca\n', { mode: 0o644 })
      const result = spawnSync(process.execPath, [path.join(projectRoot, 'scripts/identity/verify-production-backchannel-route.mjs')], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          IDENTITY_ENVIRONMENT: 'production',
          IDENTITY_COMPOSE_FILE: compose,
          IDENTITY_ENV_FILE: envFile,
          IDENTITY_HOOK_SUBNET: '172.30.40.0/29',
          IDENTITY_HOOK_GATEWAY_IP: '172.30.40.1',
          IDENTITY_HYDRA_HOOK_IP: '172.30.40.2',
          IDENTITY_TLS_CA_BUNDLE: caBundle,
        },
      })
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true,
        readOnly: true,
        canonicalHost: 'jieya.xingzhan.cc',
        tlsVerified: true,
        hydraSourceIp: '172.30.40.2',
        tokenHookStatus: 401,
        httpStatus: 401,
      })
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  })

  it('rejects an enabled identity runtime before any preflight action', () => {
    const script = path.join(projectRoot, 'scripts/identity/production-preflight.mjs')
    const result = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: { ...process.env, OIDC_ENABLED: 'true' },
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('OIDC_ENABLED must remain false during pre-release')
    expect(result.stdout).toBe('')
  })

  it('also rejects OIDC enablement hidden inside the private env file', async () => {
    const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ss-auth-003-preflight-')))
    try {
      const envFile = path.join(temporary, 'production.env')
      await writeFile(envFile, 'OIDC_ENABLED=true\n', { mode: 0o600 })
      const env = { ...process.env, IDENTITY_ENV_FILE: envFile }
      delete env.OIDC_ENABLED
      const result = spawnSync(process.execPath, [path.join(projectRoot, 'scripts/identity/production-preflight.mjs')], {
        encoding: 'utf8',
        env,
      })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('OIDC_ENABLED must remain false during pre-release')
      expect(result.stdout).toBe('')
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  })

  it('creates and re-verifies one manifest-bound dual-database backup set', async () => {
    const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ss-auth-003-backup-')))
    try {
      const bin = path.join(temporary, 'bin')
      const backupRoot = path.join(temporary, 'backups')
      await mkdir(bin, { mode: 0o700 })
      await mkdir(backupRoot, { mode: 0o700 })
      const sqlite = path.join(bin, 'sqlite3')
      const docker = path.join(bin, 'docker')
      const pgRestore = path.join(bin, 'pg_restore')
      await writeFile(sqlite, `#!/usr/bin/env node
import { copyFileSync } from 'node:fs'
const command = process.argv[3] || ''
if (command.startsWith('.backup ')) {
  const target = command.slice(9).replace(/^'|'$/g, '').replaceAll("''", "'")
  copyFileSync(process.argv[2], target)
} else if (command === 'PRAGMA integrity_check;') process.stdout.write('ok\\n')
else process.exit(2)
`)
      await writeFile(docker, '#!/usr/bin/env node\nprocess.stdout.write("fixture-postgres-archive")\n')
      await writeFile(pgRestore, '#!/usr/bin/env node\nprocess.exit(0)\n')
      await Promise.all([sqlite, docker, pgRestore].map((file) => chmod(file, 0o700)))

      const database = path.join(temporary, 'starstack.sqlite')
      const compose = path.join(temporary, 'compose.production.yaml')
      const envFile = path.join(temporary, 'production.env')
      await writeFile(database, 'fixture-sqlite', { mode: 0o600 })
      await writeFile(compose, 'services: {}\n', { mode: 0o644 })
      await writeFile(envFile, 'HYDRA_POSTGRES_PASSWORD=not-logged\n', { mode: 0o600 })
      const password = 'p'.repeat(48)
      const commandEnv = {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        IDENTITY_BACKUP_CONFIRM: 'CREATE_VERIFIED_BACKUP',
        IDENTITY_ENVIRONMENT: 'production',
        IDENTITY_BACKUP_DIR: backupRoot,
        STARSTACK_DB_PATH: database,
        IDENTITY_COMPOSE_FILE: compose,
        IDENTITY_ENV_FILE: envFile,
        HYDRA_POSTGRES_PASSWORD: password,
      }
      const created = spawnSync(process.execPath, [path.join(projectRoot, 'scripts/identity/production-backup.mjs')], {
        cwd: projectRoot,
        encoding: 'utf8',
        env: commandEnv,
      })
      expect(created.status).toBe(0)
      expect(`${created.stdout}${created.stderr}`).not.toContain(password)
      const sets = await readdir(backupRoot)
      expect(sets).toHaveLength(1)
      const backupSet = path.join(backupRoot, sets[0])
      const verified = spawnSync(process.execPath, [path.join(projectRoot, 'scripts/identity/production-backup-verify.mjs')], {
        cwd: projectRoot,
        encoding: 'utf8',
        env: { ...commandEnv, IDENTITY_BACKUP_SET: backupSet },
      })
      expect(verified.status).toBe(0)
      await writeFile(path.join(backupSet, 'hydra.dump'), 'tampered')
      const rejected = spawnSync(process.execPath, [path.join(projectRoot, 'scripts/identity/production-backup-verify.mjs')], {
        cwd: projectRoot,
        encoding: 'utf8',
        env: { ...commandEnv, IDENTITY_BACKUP_SET: backupSet },
      })
      expect(rejected.status).not.toBe(0)
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  })
})
