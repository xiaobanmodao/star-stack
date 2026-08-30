#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { lstat, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import {
  assertIdentityEnvironment,
  assertIdentityHookNetwork,
  identityHookBridgeName,
} from './productionNetworkContract.mjs'

const fail = (message) => { throw new Error(message) }
const tokenHookRouteHeader = 'X-StarStack-Hook-Route'
const requireValue = (name) => {
  const value = process.env[name]
  if (typeof value !== 'string' || !value.trim()) fail(`${name} is required`)
  return value.trim()
}
const safeFile = async (value, name, { allowPublicRead = false } = {}) => {
  const resolved = path.resolve(value)
  const info = await lstat(resolved, { bigint: true })
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n) {
    fail(`${name} must be a single-link regular file`)
  }
  if (await realpath(resolved) !== resolved) fail(`${name} must not traverse symbolic links`)
  const mode = Number(info.mode & 0o777n)
  if (allowPublicRead ? ![0o600, 0o640, 0o644].includes(mode) : ![0o600, 0o640].includes(mode)) {
    fail(`${name} has unsafe permissions`)
  }
  const currentUid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : info.uid
  if (![0n, currentUid].includes(info.uid)) fail(`${name} has an unexpected owner`)
  return resolved
}
const run = (command, args, options = {}) => execFileSync(command, args, {
  cwd: process.cwd(),
  encoding: 'utf8',
  maxBuffer: 1024 * 1024,
  timeout: 10_000,
  stdio: ['ignore', 'pipe', 'pipe'],
  ...options,
})

const environment = assertIdentityEnvironment(requireValue('IDENTITY_ENVIRONMENT'))
const composeFile = await safeFile(requireValue('IDENTITY_COMPOSE_FILE'), 'IDENTITY_COMPOSE_FILE', { allowPublicRead: true })
if (path.basename(composeFile) !== `compose.${environment}.yaml`) {
  fail('IDENTITY_COMPOSE_FILE does not match IDENTITY_ENVIRONMENT')
}
const envFile = await safeFile(requireValue('IDENTITY_ENV_FILE'), 'IDENTITY_ENV_FILE')
const hookGateway = requireValue('IDENTITY_HOOK_GATEWAY_IP')
const expectedHydraIp = requireValue('IDENTITY_HYDRA_HOOK_IP')
assertIdentityHookNetwork({
  subnet: requireValue('IDENTITY_HOOK_SUBNET'),
  gatewayIp: hookGateway,
  hydraIp: expectedHydraIp,
})
const caBundle = await safeFile(
  process.env.IDENTITY_TLS_CA_BUNDLE || '/etc/ssl/certs/ca-certificates.crt',
  'IDENTITY_TLS_CA_BUNDLE',
  { allowPublicRead: true },
)
const composeArgs = ['compose', '--env-file', envFile, '-f', composeFile]
const containerId = run('docker', [...composeArgs, 'ps', '-q', 'hydra']).trim()
if (!/^[a-f0-9]{12,64}$/.test(containerId)) fail('Hydra container is not running or is ambiguous')

const inspected = JSON.parse(run('docker', ['inspect', containerId]))
if (!Array.isArray(inspected) || inspected.length !== 1) fail('Hydra inspect result is invalid')
const container = inspected[0]
if (container?.State?.Running !== true || !Number.isSafeInteger(container?.State?.Pid) || container.State.Pid <= 1) {
  fail('Hydra container is not running with a usable network namespace')
}
const expectedHostEntries = [
  `host.docker.internal:${hookGateway}`,
  `jieya.xingzhan.cc:${hookGateway}`,
]
if (container?.HostConfig?.ExtraHosts?.length !== expectedHostEntries.length
  || !expectedHostEntries.every((entry) => container.HostConfig.ExtraHosts.includes(entry))) {
  fail('Hydra container lacks the exact internal hook gateway mappings')
}
if (Object.keys(container?.HostConfig?.PortBindings || {}).length > 0
  || Object.values(container?.NetworkSettings?.Ports || {}).some((bindings) => bindings !== null)) {
  fail('Hydra container must not publish Docker host ports')
}
if (typeof container?.HostsPath !== 'string' || !path.isAbsolute(container.HostsPath)) {
  fail('Hydra container hosts file cannot be inspected')
}
const hostsText = await readFile(container.HostsPath, 'utf8')
const canonicalHostPattern = new RegExp(`^${hookGateway.replaceAll('.', '\\.')}[\\t ]+jieya\\.xingzhan\\.cc(?:[\\t ]|$)`, 'm')
if (!canonicalHostPattern.test(hostsText)) {
  fail('Canonical Jieya hostname does not resolve to the internal hook gateway inside Hydra')
}
const hookNetworkName = `starstack-identity-hook-${environment}`
const databaseNetworkName = `starstack-identity-database-${environment}`
const attachedNetworks = Object.keys(container?.NetworkSettings?.Networks || {}).sort()
if (attachedNetworks.join(',') !== [databaseNetworkName, hookNetworkName].sort().join(',')) {
  fail('Hydra must attach only to the two frozen internal networks')
}
if (container?.NetworkSettings?.Networks?.[hookNetworkName]?.IPAddress !== expectedHydraIp) {
  fail('Hydra is not using the expected fixed hook network source IP')
}
const networkDetails = JSON.parse(run('docker', ['network', 'inspect', databaseNetworkName, hookNetworkName]))
if (!Array.isArray(networkDetails) || networkDetails.length !== 2) {
  fail('Hydra internal networks cannot be inspected')
}
const databaseNetwork = networkDetails.find((network) => network?.Name === databaseNetworkName)
const hookNetwork = networkDetails.find((network) => network?.Name === hookNetworkName)
const hookIpam = hookNetwork?.IPAM?.Config?.find((entry) => entry?.Subnet === requireValue('IDENTITY_HOOK_SUBNET'))
if (databaseNetwork?.Internal !== true || hookNetwork?.Internal !== true
  || hookNetwork?.Options?.['com.docker.network.bridge.name'] !== identityHookBridgeName(environment)
  || hookIpam?.Gateway !== hookGateway
  || Object.keys(hookNetwork?.Containers || {}).length !== 1
  || !Object.keys(hookNetwork?.Containers || {}).some((id) => container.Id?.startsWith(id) || id.startsWith(container.Id))) {
  fail('Hydra internal network topology is not exact')
}

const pid = String(container.State.Pid)
const route = run('nsenter', ['-t', pid, '-n', '--', 'ip', '-4', 'route', 'get', hookGateway])
const routeSource = /(?:^|\s)src\s+(\d{1,3}(?:\.\d{1,3}){3})(?:\s|$)/.exec(route)?.[1]
if (routeSource !== expectedHydraIp) {
  fail(`Hydra route to the hook gateway does not use the expected source IP (${routeSource || 'missing'})`)
}

const hookProbeScript = `
const http = require('node:http')
const request = http.request({
  host: process.argv[1], port: 5175, path: '/internal/oidc/token-hook', method: 'POST',
  headers: { Host: 'auth.xingzhan.cc', 'Content-Type': 'application/json', 'Content-Length': '2' },
  timeout: 3000,
}, (response) => {
  process.stdout.write(JSON.stringify({ status: response.statusCode, marker: response.headers[${JSON.stringify(tokenHookRouteHeader.toLowerCase())}] }))
  response.resume()
})
request.on('timeout', () => request.destroy(new Error('timeout')))
request.on('error', () => process.exit(2))
request.end('{}')
`
const hookProbe = JSON.parse(run('nsenter', [
  '-t', pid, '-n', '--', process.execPath, '-e', hookProbeScript, hookGateway,
]))
if (![400, 401, 422].includes(hookProbe.status) || hookProbe.marker !== 'private') {
  fail('Token Hook probe did not traverse the frozen internal gateway route')
}

const backchannelProbeBody = 'logout_token=invalid'
const request = [
  'POST /auth/backchannel-logout HTTP/1.1',
  'Host: jieya.xingzhan.cc',
  'Content-Type: application/x-www-form-urlencoded',
  `Content-Length: ${Buffer.byteLength(backchannelProbeBody, 'utf8')}`,
  'Connection: close',
  '',
  backchannelProbeBody,
].join('\r\n')
const tlsResponse = run('nsenter', [
  '-t', pid, '-n', '--',
  'openssl', 's_client',
  '-connect', `${hookGateway}:443`,
  '-CAfile', caBundle,
  '-verify_hostname', 'jieya.xingzhan.cc',
  '-verify_return_error',
  '-servername', 'jieya.xingzhan.cc',
  '-quiet',
], { input: request, stdio: ['pipe', 'pipe', 'pipe'] })
const status = Number(/^HTTP\/\d(?:\.\d)?\s+(\d{3})\b/m.exec(tlsResponse)?.[1])
if (![400, 401, 422].includes(status)) {
  fail(`Back-Channel probe did not reach the private Jieya handler (HTTP ${status || 'missing'})`)
}
if (!/^X-StarStack-BCL-Route:\s*private\s*$/im.test(tlsResponse)) {
  fail('Back-Channel probe did not traverse the frozen private Nginx location')
}

console.log(JSON.stringify({
  ok: true,
  readOnly: true,
  environment,
  canonicalHost: 'jieya.xingzhan.cc',
  tlsVerified: true,
  hydraSourceIp: expectedHydraIp,
  tokenHookStatus: hookProbe.status,
  httpStatus: status,
}, null, 2))
