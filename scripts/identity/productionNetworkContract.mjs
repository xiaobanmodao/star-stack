import { isIP } from 'node:net'

const fail = (message) => { throw new Error(message) }

const ipv4Number = (value, name) => {
  if (isIP(value) !== 4) fail(`${name} must be an IPv4 address`)
  const octets = value.split('.').map(Number)
  if (!(octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168))) {
    fail(`${name} must use RFC1918 private space`)
  }
  return octets.reduce((result, part) => ((result << 8) | part) >>> 0, 0)
}

export const assertIdentityEnvironment = (value) => {
  if (!['production', 'staging'].includes(value)) {
    fail('IDENTITY_ENVIRONMENT must be production or staging')
  }
  return value
}

export const identityHookBridgeName = (environment) => ({
  production: 'br-ss-hook-prod',
  staging: 'br-ss-hook-stg',
})[assertIdentityEnvironment(environment)]

export const identityLoopbackPorts = (environment, publicValue, adminValue) => {
  const expected = assertIdentityEnvironment(environment) === 'production'
    ? { publicPort: 4444, adminPort: 4445 }
    : { publicPort: 4544, adminPort: 4545 }
  const publicPort = Number(publicValue)
  const adminPort = Number(adminValue)
  if (publicPort !== expected.publicPort || adminPort !== expected.adminPort) {
    fail(`Hydra loopback ports must use the frozen ${environment} pair`)
  }
  return expected
}

export const assertIdentityHookNetwork = ({ subnet, gatewayIp, hydraIp }) => {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(2[89]|30)$/.exec(subnet)
  if (!match) fail('IDENTITY_HOOK_SUBNET must be a narrow /28 to /30 IPv4 CIDR')
  const network = ipv4Number(match[1], 'IDENTITY_HOOK_SUBNET')
  const gateway = ipv4Number(gatewayIp, 'IDENTITY_HOOK_GATEWAY_IP')
  const hydra = ipv4Number(hydraIp, 'IDENTITY_HYDRA_HOOK_IP')
  const prefix = Number(match[2])
  const mask = (0xffffffff << (32 - prefix)) >>> 0
  if (((network & mask) >>> 0) !== network) {
    fail('IDENTITY_HOOK_SUBNET must use its network address')
  }
  const broadcast = (network | (~mask >>> 0)) >>> 0
  if (gateway !== network + 1) {
    fail('IDENTITY_HOOK_GATEWAY_IP must be the first usable address in IDENTITY_HOOK_SUBNET')
  }
  if (((hydra & mask) >>> 0) !== network || hydra === network || hydra === gateway || hydra === broadcast) {
    fail('IDENTITY_HYDRA_HOOK_IP must be a distinct usable address inside IDENTITY_HOOK_SUBNET')
  }
  return { subnet, gatewayIp, hydraIp, prefix }
}
