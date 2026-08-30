#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { isIP } from 'node:net'
import path from 'node:path'

const fail = (message) => { throw new Error(message) }
const requireValue = (name) => {
  const value = process.env[name]
  if (typeof value !== 'string' || !value.trim()) fail(`${name} is required`)
  return value.trim()
}
const privateIpv4 = (value, name) => {
  if (isIP(value) !== 4) fail(`${name} must be an IPv4 address`)
  const octets = value.split('.').map(Number)
  if (!(octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168))) fail(`${name} must use RFC1918 private space`)
  return value
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

const environment = requireValue('IDENTITY_ENVIRONMENT')
if (!['production', 'staging'].includes(environment)) {
  fail('IDENTITY_ENVIRONMENT must be production or staging')
}
const composeFile = await safeFile(requireValue('IDENTITY_COMPOSE_FILE'), 'IDENTITY_COMPOSE_FILE', { allowPublicRead: true })
if (path.basename(composeFile) !== `compose.${environment}.yaml`) {
  fail('IDENTITY_COMPOSE_FILE does not match IDENTITY_ENVIRONMENT')
}
const envFile = await safeFile(requireValue('IDENTITY_ENV_FILE'), 'IDENTITY_ENV_FILE')
const hostGateway = privateIpv4(requireValue('IDENTITY_HOST_GATEWAY_IP'), 'IDENTITY_HOST_GATEWAY_IP')
const expectedHydraIp = privateIpv4(requireValue('IDENTITY_HYDRA_HOOK_IP'), 'IDENTITY_HYDRA_HOOK_IP')
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
const expectedHostEntry = 'jieya.xingzhan.cc:host-gateway'
if (!container?.HostConfig?.ExtraHosts?.includes(expectedHostEntry)) {
  fail('Hydra container lacks the exact canonical host-gateway mapping')
}
if (typeof container?.HostsPath !== 'string' || !path.isAbsolute(container.HostsPath)) {
  fail('Hydra container hosts file cannot be inspected')
}
const hostsText = await readFile(container.HostsPath, 'utf8')
const canonicalHostPattern = new RegExp(`^${hostGateway.replaceAll('.', '\\.')}[\\t ]+jieya\\.xingzhan\\.cc(?:[\\t ]|$)`, 'm')
if (!canonicalHostPattern.test(hostsText)) {
  fail('Canonical Jieya hostname does not resolve to the expected host-gateway inside Hydra')
}
const hookNetworkName = `starstack-identity-hook-${environment}`
if (container?.NetworkSettings?.Networks?.[hookNetworkName]?.IPAddress !== expectedHydraIp) {
  fail('Hydra is not using the expected fixed hook network source IP')
}

const pid = String(container.State.Pid)
const route = run('nsenter', ['-t', pid, '-n', '--', 'ip', '-4', 'route', 'get', hostGateway])
const routeSource = /(?:^|\s)src\s+(\d{1,3}(?:\.\d{1,3}){3})(?:\s|$)/.exec(route)?.[1]
if (routeSource !== expectedHydraIp) {
  fail(`Hydra route to host-gateway does not use the expected source IP (${routeSource || 'missing'})`)
}

const request = [
  'POST /auth/backchannel-logout HTTP/1.1',
  'Host: jieya.xingzhan.cc',
  'Content-Type: application/json',
  'Content-Length: 2',
  'Connection: close',
  '',
  '{}',
].join('\r\n')
const tlsResponse = run('nsenter', [
  '-t', pid, '-n', '--',
  'openssl', 's_client',
  '-connect', `${hostGateway}:443`,
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
  httpStatus: status,
}, null, 2))
