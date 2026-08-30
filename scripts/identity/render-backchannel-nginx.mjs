#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertIdentityHookNetwork } from './productionNetworkContract.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const hydraAddress = String(process.env.IDENTITY_HYDRA_HOOK_IP || '').trim()
const subnet = String(process.env.IDENTITY_HOOK_SUBNET || '').trim()
const gatewayAddress = String(process.env.IDENTITY_HOOK_GATEWAY_IP || '').trim()
assertIdentityHookNetwork({ subnet, gatewayIp: gatewayAddress, hydraIp: hydraAddress })

const template = await readFile(
  path.join(root, 'infra/identity/nginx/jieya-backchannel.access.conf.template'),
  'utf8',
)
process.stdout.write(template.replaceAll('__IDENTITY_HYDRA_HOOK_IP__', hydraAddress))
