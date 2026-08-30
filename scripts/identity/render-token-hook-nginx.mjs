#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertIdentityHookNetwork } from './productionNetworkContract.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const subnet = String(process.env.IDENTITY_HOOK_SUBNET || '').trim()
const gatewayIp = String(process.env.IDENTITY_HOOK_GATEWAY_IP || '').trim()
const hydraIp = String(process.env.IDENTITY_HYDRA_HOOK_IP || '').trim()
assertIdentityHookNetwork({ subnet, gatewayIp, hydraIp })

const template = await readFile(path.join(root, 'infra/identity/nginx/token-hook.bridge.conf.template'), 'utf8')
process.stdout.write(template
  .replaceAll('__IDENTITY_HOOK_GATEWAY_IP__', gatewayIp)
  .replaceAll('__IDENTITY_HYDRA_HOOK_IP__', hydraIp))
