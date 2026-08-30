#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process'
import { lstat, readFile, realpath, statfs } from 'node:fs/promises'
import { isIP } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { parseEnv } from 'node:util'
import {
  assertActiveBackchannelNginx,
  assertBackchannelNginxComposition,
} from './productionNginxContract.mjs'

const fail = (message) => { throw new Error(message) }
let configuration = process.env
const requireValue = (name) => {
  const value = configuration[name]
  if (typeof value !== 'string' || !value.trim()) fail(`${name} is required`)
  return value.trim()
}
const requirePrivateSecret = (name) => {
  const value = requireValue(name)
  if (Buffer.byteLength(value, 'utf8') < 32) fail(`${name} must contain at least 32 bytes`)
  return value
}
const assertLoopbackOrigin = (value, name) => {
  const url = new URL(value)
  if (url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/'
    || url.search || url.hash || !['127.0.0.1', '::1', 'localhost'].includes(url.hostname)) {
    fail(`${name} must be an HTTP loopback origin`)
  }
  return url.origin
}
const assertPrivateHostCidr = (value, name) => {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/32$/.exec(value)
  if (!match || isIP(match[1]) !== 4) fail(`${name} must be one private IPv4 /32`)
  const octets = match[1].split('.').map(Number)
  if (!(octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168))) fail(`${name} must be RFC1918 private space`)
  return value
}
const privateIpv4 = (value, name) => {
  if (isIP(value) !== 4) fail(`${name} must be an IPv4 address`)
  const octets = value.split('.').map(Number)
  if (!(octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168))) fail(`${name} must be RFC1918 private space`)
  return octets.reduce((result, part) => ((result << 8) | part) >>> 0, 0)
}
const assertHookNetwork = (address, subnet) => {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(2[89]|30)$/.exec(subnet)
  if (!match) fail('IDENTITY_HOOK_SUBNET must be a narrow /28 to /30 IPv4 CIDR')
  privateIpv4(address, 'IDENTITY_HOST_GATEWAY_IP')
  const subnetAddress = privateIpv4(match[1], 'IDENTITY_HOOK_SUBNET')
  const prefix = Number(match[2])
  const mask = (0xffffffff << (32 - prefix)) >>> 0
  if (((subnetAddress & mask) >>> 0) !== subnetAddress) fail('IDENTITY_HOOK_SUBNET must use its network address')
  return { subnetAddress, prefix, mask, broadcast: (subnetAddress | (~mask >>> 0)) >>> 0 }
}
const assertHydraHookAddress = (value, network) => {
  const address = privateIpv4(value, 'IDENTITY_HYDRA_HOOK_IP')
  if (((address & network.mask) >>> 0) !== network.subnetAddress
    || address === network.subnetAddress || address === network.broadcast) {
    fail('IDENTITY_HYDRA_HOOK_IP must be one usable address inside IDENTITY_HOOK_SUBNET')
  }
  return value
}
const assertPrivateFile = async (file, { allowPublicRead = false, allowedUids = [] } = {}) => {
  const resolved = path.resolve(file)
  const info = await lstat(resolved, { bigint: true })
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n) fail(`${resolved} must be a single-link regular file`)
  if (await realpath(resolved) !== resolved) fail(`${resolved} must not traverse symbolic links`)
  const mode = Number(info.mode & 0o777n)
  if (allowPublicRead ? ![0o600, 0o640, 0o644].includes(mode) : ![0o600, 0o640].includes(mode)) {
    fail(`${resolved} has unsafe permissions`)
  }
  const currentUid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : info.uid
  const acceptedUids = new Set([0n, currentUid, ...allowedUids.map((uid) => BigInt(uid))])
  if (!acceptedUids.has(info.uid)) fail(`${resolved} has an unexpected owner`)
  return resolved
}
const fetchJson = async (url, { forwardedHttps = false } = {}) => {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      ...(forwardedHttps ? { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'auth.xingzhan.cc' } : {}),
    },
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) fail(`${url} returned HTTP ${response.status}`)
  return response.json()
}
const readActiveNginxConfig = () => {
  const command = configuration.IDENTITY_NGINX_BIN?.trim() || 'nginx'
  const result = spawnSync(command, ['-T'], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error || result.status !== 0) fail('nginx -T failed; active configuration cannot be verified')
  return `${result.stdout || ''}\n${result.stderr || ''}`
}

if (String(process.env.OIDC_ENABLED || 'false').toLowerCase() !== 'false') {
  fail('OIDC_ENABLED must remain false during pre-release')
}
const rawEnvFile = process.env.IDENTITY_ENV_FILE
if (typeof rawEnvFile !== 'string' || !rawEnvFile.trim()) fail('IDENTITY_ENV_FILE is required')
const identityEnvFile = await assertPrivateFile(rawEnvFile.trim())
configuration = { ...parseEnv(await readFile(identityEnvFile, 'utf8')), ...process.env }
if (String(configuration.OIDC_ENABLED || 'false').toLowerCase() !== 'false') {
  fail('OIDC_ENABLED must remain false during pre-release')
}
if (configuration.NODE_ENV !== 'production') fail('NODE_ENV must be production')
if (requireValue('OIDC_ISSUER') !== 'https://auth.xingzhan.cc') fail('OIDC_ISSUER is not the frozen production issuer')
const hydraPublic = assertLoopbackOrigin(requireValue('OIDC_HYDRA_PUBLIC_URL'), 'OIDC_HYDRA_PUBLIC_URL')
const hydraAdmin = assertLoopbackOrigin(requireValue('OIDC_HYDRA_ADMIN_URL'), 'OIDC_HYDRA_ADMIN_URL')
const hookUrl = new URL(requireValue('OIDC_TOKEN_HOOK_URL'))
if (hookUrl.origin !== 'http://host.docker.internal:5175'
  || hookUrl.pathname !== '/internal/oidc/token-hook'
  || hookUrl.username || hookUrl.password || hookUrl.search || hookUrl.hash) {
  fail('OIDC_TOKEN_HOOK_URL must be the exact private bridge Token Hook URL')
}
assertPrivateHostCidr(requireValue('IDENTITY_PROXY_CIDR'), 'IDENTITY_PROXY_CIDR')
const hookGateway = requireValue('IDENTITY_HOST_GATEWAY_IP')
const hookSubnet = requireValue('IDENTITY_HOOK_SUBNET')
const hookNetwork = assertHookNetwork(hookGateway, hookSubnet)
const hydraHookIp = assertHydraHookAddress(requireValue('IDENTITY_HYDRA_HOOK_IP'), hookNetwork)
if (hydraHookIp === hookGateway) fail('Hydra hook IP and host-gateway IP must be different')

const sensitiveValues = [
  requirePrivateSecret('HYDRA_POSTGRES_PASSWORD'),
  requirePrivateSecret('HYDRA_SYSTEM_SECRET'),
  requirePrivateSecret('HYDRA_COOKIE_SECRET'),
  requirePrivateSecret('OIDC_TOKEN_HOOK_SECRET'),
  requirePrivateSecret('OIDC_LOGOUT_BROKER_SECRET'),
  requirePrivateSecret('JIEYA_OIDC_CLIENT_SECRET'),
]
if (new Set(sensitiveValues).size !== sensitiveValues.length) fail('Identity credentials must all be distinct')

// The pinned postgres:16.15-alpine image runs postgres as UID 70. The key must
// remain 0600 instead of becoming globally readable merely for bind-mount use.
await assertPrivateFile(requireValue('POSTGRES_TLS_KEY_FILE'), { allowedUids: [70] })
await assertPrivateFile(requireValue('POSTGRES_TLS_CERT_FILE'), { allowPublicRead: true })
await assertPrivateFile(requireValue('POSTGRES_TLS_CA_FILE'), { allowPublicRead: true })
const authNginx = await assertPrivateFile(requireValue('IDENTITY_NGINX_AUTH_CONFIG'), { allowPublicRead: true })
const hookNginx = await assertPrivateFile(requireValue('IDENTITY_NGINX_HOOK_CONFIG'), { allowPublicRead: true })
if (configuration.IDENTITY_NGINX_BCL_CONFIG) {
  fail('IDENTITY_NGINX_BCL_CONFIG is obsolete; provide the active Jieya site and access snippet separately')
}
const backchannelSite = await assertPrivateFile(
  requireValue('IDENTITY_NGINX_BCL_SITE_CONFIG'),
  { allowPublicRead: true },
)
const backchannelAccess = await assertPrivateFile(
  requireValue('IDENTITY_NGINX_BCL_ACCESS_CONFIG'),
  { allowPublicRead: true },
)
const authText = await readFile(authNginx, 'utf8')
const hookText = await readFile(hookNginx, 'utf8')
const backchannelSiteText = await readFile(backchannelSite, 'utf8')
const backchannelAccessText = await readFile(backchannelAccess, 'utf8')
if (!authText.includes('server_name auth.xingzhan.cc;')
  || !/location \^~ \/internal\/oidc\/[\s\S]*?return 404;/.test(authText)) fail('Public identity Nginx trust surface is invalid')
if (hookText.includes('__IDENTITY_') || !hookText.includes(`listen ${hookGateway}:5175;`)
  || !hookText.includes(`allow ${hookSubnet};`) || /listen\s+(?:0\.0\.0\.0|\[::\])/.test(hookText)
  || !hookText.includes('location = /internal/oidc/token-hook')
  || !hookText.includes('allow ') || !hookText.includes('deny all;')) fail('Bridge Token Hook Nginx trust surface is invalid')
assertBackchannelNginxComposition({
  siteText: backchannelSiteText,
  accessText: backchannelAccessText,
  accessPath: backchannelAccess,
  hydraHookIp,
})
assertActiveBackchannelNginx({
  dump: readActiveNginxConfig(),
  sitePath: backchannelSite,
  accessPath: backchannelAccess,
})

if (os.availableParallelism() < 2) fail('Pre-release host must provide at least two CPU cores')
const totalMemory = os.totalmem()
if (totalMemory < 1900 * 1024 * 1024) fail('Pre-release host must provide approximately 2 GiB RAM')
const disk = await statfs(process.cwd())
const availableDisk = Number(disk.bavail) * Number(disk.bsize)
if (availableDisk < 5 * 1024 * 1024 * 1024) fail('Pre-release host needs at least 5 GiB free disk')

const composeFile = path.resolve(requireValue('IDENTITY_COMPOSE_FILE'))
await assertPrivateFile(composeFile, { allowPublicRead: true })
execFileSync('docker', ['compose', '--env-file', requireValue('IDENTITY_ENV_FILE'), '-f', composeFile, 'config', '--quiet'], {
  stdio: ['ignore', 'ignore', 'pipe'],
})

if (configuration.IDENTITY_PREFLIGHT_RUNTIME === '1') {
  const [discovery, jwks, adminHealth] = await Promise.all([
    fetchJson(new URL('/.well-known/openid-configuration', hydraPublic), { forwardedHttps: true }),
    fetchJson(new URL('/.well-known/jwks.json', hydraPublic), { forwardedHttps: true }),
    fetchJson(new URL('/health/ready', hydraAdmin)),
  ])
  if (discovery.issuer !== 'https://auth.xingzhan.cc'
    || discovery.authorization_endpoint !== 'https://auth.xingzhan.cc/oauth2/auth'
    || discovery.token_endpoint !== 'https://auth.xingzhan.cc/oauth2/token'
    || discovery.userinfo_endpoint !== 'https://auth.xingzhan.cc/oauth2/userinfo') fail('Hydra Discovery is not exact')
  if (!discovery.code_challenge_methods_supported?.includes('S256')
    || !Array.isArray(jwks.keys) || !jwks.keys.some((key) => key.kty === 'RSA' && key.kid)
    || adminHealth.status !== 'ok') fail('Hydra runtime readiness is incomplete')
}

console.log(JSON.stringify({
  ok: true,
  readOnly: true,
  identityEnabled: false,
  cpuCores: os.availableParallelism(),
  memoryMiB: Math.floor(totalMemory / 1024 / 1024),
  diskAvailableMiB: Math.floor(availableDisk / 1024 / 1024),
  activeNginxChecked: true,
  runtimeChecked: configuration.IDENTITY_PREFLIGHT_RUNTIME === '1',
}, null, 2))
