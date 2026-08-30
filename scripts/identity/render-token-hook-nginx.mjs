#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const address = String(process.env.IDENTITY_HOST_GATEWAY_IP || '').trim()
const subnet = String(process.env.IDENTITY_HOOK_SUBNET || '').trim()
if (isIP(address) !== 4 || address === '0.0.0.0' || address.startsWith('127.')) {
  throw new Error('IDENTITY_HOST_GATEWAY_IP must be a dedicated private IPv4 bridge address')
}
const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(2[89]|30)$/.exec(subnet)
if (!match || isIP(match[1]) !== 4) throw new Error('IDENTITY_HOOK_SUBNET must be an IPv4 CIDR')
const octets = address.split('.').map(Number)
if (!(octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
  || (octets[0] === 192 && octets[1] === 168))) throw new Error('Bridge address must be RFC1918 private space')
const subnetOctets = match[1].split('.').map(Number)
if (!(subnetOctets[0] === 10
  || (subnetOctets[0] === 172 && subnetOctets[1] >= 16 && subnetOctets[1] <= 31)
  || (subnetOctets[0] === 192 && subnetOctets[1] === 168))) {
  throw new Error('IDENTITY_HOOK_SUBNET must use RFC1918 private space')
}
const subnetAddress = subnetOctets.reduce((result, part) => ((result << 8) | part) >>> 0, 0)
const prefix = Number(match[2])
const mask = (0xffffffff << (32 - prefix)) >>> 0
if (((subnetAddress & mask) >>> 0) !== subnetAddress) {
  throw new Error('IDENTITY_HOOK_SUBNET must use its network address')
}

const template = await readFile(path.join(root, 'infra/identity/nginx/token-hook.bridge.conf.template'), 'utf8')
process.stdout.write(template
  .replaceAll('__IDENTITY_HOST_GATEWAY_IP__', address)
  .replaceAll('__IDENTITY_HOOK_SUBNET__', subnet))
