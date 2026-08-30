#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertIdentityEnvironment,
  assertIdentityHookNetwork,
  identityLoopbackPorts,
} from './productionNetworkContract.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const environment = assertIdentityEnvironment(String(process.env.IDENTITY_ENVIRONMENT || '').trim())
const subnet = String(process.env.IDENTITY_HOOK_SUBNET || '').trim()
const gatewayIp = String(process.env.IDENTITY_HOOK_GATEWAY_IP || '').trim()
const hydraIp = String(process.env.IDENTITY_HYDRA_HOOK_IP || '').trim()
assertIdentityHookNetwork({ subnet, gatewayIp, hydraIp })
const { publicPort, adminPort } = identityLoopbackPorts(
  environment,
  process.env.HYDRA_PUBLIC_PORT,
  process.env.HYDRA_ADMIN_PORT,
)
const template = await readFile(
  path.join(root, 'infra/identity/nginx/hydra-loopback.bridge.conf.template'),
  'utf8',
)
process.stdout.write(template
  .replaceAll('__IDENTITY_HYDRA_HOOK_IP__', hydraIp)
  .replaceAll('__HYDRA_PUBLIC_PORT__', String(publicPort))
  .replaceAll('__HYDRA_ADMIN_PORT__', String(adminPort)))
