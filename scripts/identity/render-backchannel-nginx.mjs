#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const toIpv4Number = (value, name) => {
  if (isIP(value) !== 4) throw new Error(`${name} must be an IPv4 address`)
  const octets = value.split('.').map(Number)
  if (!(octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168))) {
    throw new Error(`${name} must use RFC1918 private space`)
  }
  return octets.reduce((result, part) => ((result << 8) | part) >>> 0, 0)
}

const hydraAddress = String(process.env.IDENTITY_HYDRA_HOOK_IP || '').trim()
const subnet = String(process.env.IDENTITY_HOOK_SUBNET || '').trim()
const gatewayAddress = String(process.env.IDENTITY_HOST_GATEWAY_IP || '').trim()
const subnetMatch = /^(\d{1,3}(?:\.\d{1,3}){3})\/(2[89]|30)$/.exec(subnet)
if (!subnetMatch) throw new Error('IDENTITY_HOOK_SUBNET must be a narrow /28 to /30 IPv4 CIDR')

const hydra = toIpv4Number(hydraAddress, 'IDENTITY_HYDRA_HOOK_IP')
const network = toIpv4Number(subnetMatch[1], 'IDENTITY_HOOK_SUBNET')
const gateway = toIpv4Number(gatewayAddress, 'IDENTITY_HOST_GATEWAY_IP')
const prefix = Number(subnetMatch[2])
const mask = (0xffffffff << (32 - prefix)) >>> 0
const broadcast = (network | (~mask >>> 0)) >>> 0
if (((network & mask) >>> 0) !== network) {
  throw new Error('IDENTITY_HOOK_SUBNET must use its network address')
}
if (((hydra & mask) >>> 0) !== network || hydra === network || hydra === broadcast) {
  throw new Error('IDENTITY_HYDRA_HOOK_IP must be one usable address inside IDENTITY_HOOK_SUBNET')
}
if (hydra === gateway) throw new Error('Hydra hook IP and host-gateway IP must be different')

const template = await readFile(
  path.join(root, 'infra/identity/nginx/jieya-backchannel.access.conf.template'),
  'utf8',
)
process.stdout.write(template.replaceAll('__IDENTITY_HYDRA_HOOK_IP__', hydraAddress))
