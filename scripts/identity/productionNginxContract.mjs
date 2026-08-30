import { lstat, readlink, realpath } from 'node:fs/promises'
import path from 'node:path'

const fail = (message) => { throw new Error(message) }

const tokenize = (source) => {
  const tokens = []
  let current = ''
  let quote = ''
  let escaped = false
  let comment = false
  const flush = () => {
    if (current) tokens.push(current)
    current = ''
  }

  for (const character of source) {
    if (comment) {
      if (character === '\n') comment = false
      continue
    }
    if (quote) {
      current += character
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) {
        quote = ''
        flush()
      }
      continue
    }
    if (character === '#') {
      flush()
      comment = true
    } else if (character === '"' || character === "'") {
      flush()
      quote = character
      current = character
    } else if (/\s/.test(character)) {
      flush()
    } else if (['{', '}', ';'].includes(character)) {
      flush()
      tokens.push(character)
    } else {
      current += character
    }
  }
  if (quote) fail('Nginx configuration contains an unterminated quote')
  flush()
  return tokens
}

const parseStatements = (source) => {
  const tokens = tokenize(source)
  let offset = 0
  const parseScope = (nested = false) => {
    const statements = []
    while (offset < tokens.length) {
      if (tokens[offset] === '}') {
        if (!nested) fail('Nginx configuration contains an unexpected closing brace')
        offset += 1
        return statements
      }
      const header = []
      while (offset < tokens.length && !['{', '}', ';'].includes(tokens[offset])) {
        header.push(tokens[offset])
        offset += 1
      }
      if (!header.length) fail('Nginx configuration contains an empty directive')
      if (tokens[offset] === ';') {
        offset += 1
        statements.push({ header, children: null })
      } else if (tokens[offset] === '{') {
        offset += 1
        statements.push({ header, children: parseScope(true) })
      } else {
        fail('Nginx configuration contains an unterminated directive')
      }
    }
    if (nested) fail('Nginx configuration contains an unterminated block')
    return statements
  }
  return parseScope()
}

const walk = (statements, result = []) => {
  for (const statement of statements) {
    result.push(statement)
    if (statement.children) walk(statement.children, result)
  }
  return result
}

const headerEquals = (statement, expected) => statement.header.length === expected.length
  && statement.header.every((token, index) => token === expected[index])

const findExactLocations = (statements) => walk(statements)
  .filter((statement) => headerEquals(statement, ['location', '=', '/auth/backchannel-logout']))

const requireOneDirective = (statements, expected, label) => {
  const matches = statements.filter((statement) => headerEquals(statement, expected))
  if (matches.length !== 1) fail(`Jieya Back-Channel ${label} directive must appear exactly once`)
  return matches[0]
}

const requireOneProxyHeader = (statements, name, value) => {
  const matches = statements.filter((statement) => statement.header[0] === 'proxy_set_header'
    && statement.header[1]?.toLowerCase() === name.toLowerCase())
  if (matches.length !== 1 || !headerEquals(matches[0], ['proxy_set_header', name, value])) {
    fail(`Jieya Back-Channel proxy header ${name} is invalid`)
  }
}

const requireExactStatementSet = (statements, expected, label) => {
  if (statements.length !== expected.length
    || expected.some((header) => statements.filter((statement) => headerEquals(statement, header)).length !== 1)) {
    fail(`${label} contains an unexpected or missing directive`)
  }
}

const fileMarkers = (dump) => dump.split('\n').flatMap((line) => {
  const marker = line.trim()
  const prefix = '# configuration file '
  if (!marker.startsWith(prefix) || !marker.endsWith(':')) return []
  const file = marker.slice(prefix.length, -1)
  return file ? [file] : []
})

const auditedRegularFile = async (file, label) => {
  if (!path.isAbsolute(file)) fail(`${label} must use an absolute regular-file path`)
  const resolved = path.resolve(file)
  try {
    const info = await lstat(resolved)
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
      fail(`${label} must be a single-link regular file`)
    }
    if (await realpath(resolved) !== resolved) fail(`${label} must not traverse symbolic links`)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(label)) throw error
    fail(`${label} cannot be resolved safely`)
  }
  return resolved
}

const resolveActiveMarker = async (file) => {
  if (!path.isAbsolute(file)) fail('Active Nginx configuration marker must be an absolute path')
  const resolved = path.resolve(file)
  try {
    const info = await lstat(resolved)
    if (info.isSymbolicLink()) {
      const parent = path.dirname(resolved)
      if (await realpath(parent) !== parent) {
        fail('Active Nginx configuration marker must not traverse a linked directory')
      }
      const target = path.resolve(parent, await readlink(resolved))
      const targetInfo = await lstat(target)
      if (!targetInfo.isFile() || targetInfo.isSymbolicLink()) {
        fail('Active Nginx site marker may contain only one direct symbolic link')
      }
      const canonical = await realpath(target)
      if (canonical !== target) {
        fail('Active Nginx site marker may contain only one direct symbolic link')
      }
      return { canonical, directSymlink: true }
    }
    if (!info.isFile()) fail('Active Nginx configuration marker must identify a regular file')
    const canonical = await realpath(resolved)
    if (canonical !== resolved) {
      fail('Active Nginx configuration marker must not traverse a linked directory')
    }
    return { canonical, directSymlink: false }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Active Nginx')) throw error
    fail('Active Nginx configuration marker cannot be resolved safely')
  }
}

const requireActiveCanonicalFile = (markers, canonical, { label, allowDirectSymlink }) => {
  const matches = markers.filter((marker) => marker.canonical === canonical)
  if (matches.length !== 1) fail(`${label} must have exactly one active canonical marker in Nginx`)
  if (!allowDirectSymlink && matches[0].directSymlink) {
    fail(`${label} active marker must use the audited regular-file path directly`)
  }
}

const stripComments = (source) => {
  let result = ''
  let quote = ''
  let escaped = false
  let comment = false
  for (const character of source) {
    if (comment) {
      if (character === '\n') {
        comment = false
        result += character
      }
    } else if (quote) {
      result += character
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = ''
    } else if (character === '#') {
      comment = true
    } else {
      result += character
      if (character === '"' || character === "'") quote = character
    }
  }
  return result
}

const exactLocationCount = (source) => stripComments(source)
  .match(/(^|\n)\s*location\s*=\s*\/auth\/backchannel-logout\s*\{/g)?.length || 0

export const assertBackchannelNginxComposition = ({
  siteText,
  accessText,
  accessPath,
  hydraHookIp,
}) => {
  if ([siteText, accessText, accessPath, hydraHookIp].some((value) => typeof value !== 'string' || !value)) {
    fail('Jieya Back-Channel composition inputs are required')
  }
  if (siteText.includes('__IDENTITY_') || accessText.includes('__IDENTITY_')) {
    fail('Jieya Back-Channel configuration still contains a placeholder')
  }

  const siteStatements = parseStatements(siteText)
  const locations = findExactLocations(siteStatements)
  if (locations.length !== 1) fail('Jieya site must contain exactly one Back-Channel exact location')
  const locationStatements = locations[0].children || []
  const includes = locationStatements.filter((statement) => statement.header[0] === 'include')
  if (includes.length !== 1 || !headerEquals(includes[0], ['include', accessPath])) {
    fail('Jieya Back-Channel location must include the exact access snippet')
  }
  requireOneDirective(locationStatements, ['access_log', 'off'], 'access log')
  requireOneDirective(locationStatements, ['proxy_pass', 'http://127.0.0.1:4180'], 'proxy')
  requireOneProxyHeader(locationStatements, 'Host', 'jieya.xingzhan.cc')
  requireOneProxyHeader(locationStatements, 'X-Real-IP', '$remote_addr')
  requireOneProxyHeader(locationStatements, 'X-Forwarded-For', '$remote_addr')
  requireOneProxyHeader(locationStatements, 'X-Forwarded-Proto', 'https')
  requireOneProxyHeader(locationStatements, 'Authorization', '""')
  if (locationStatements.some((statement) => ['allow', 'deny', 'limit_except', 'satisfy'].includes(statement.header[0]))) {
    fail('Jieya Back-Channel access policy must live only in the access snippet')
  }

  const accessStatements = parseStatements(accessText)
  const allowedTopLevel = new Set(['allow', 'deny', 'limit_except', 'add_header'])
  if (accessStatements.some((statement) => !allowedTopLevel.has(statement.header[0]))) {
    fail('Jieya Back-Channel access snippet contains a forbidden directive')
  }
  const allowStatements = accessStatements.filter((statement) => statement.header[0] === 'allow')
  if (allowStatements.length !== 1
    || !headerEquals(allowStatements[0], ['allow', `${hydraHookIp}/32`])) {
    fail('Jieya Back-Channel access snippet must allow only the exact Hydra /32')
  }
  requireOneDirective(accessStatements, ['deny', 'all'], 'deny')
  const methodBlocks = accessStatements.filter((statement) => statement.header[0] === 'limit_except')
  if (methodBlocks.length !== 1 || !headerEquals(methodBlocks[0], ['limit_except', 'POST'])
    || methodBlocks[0].children?.length !== 1
    || !headerEquals(methodBlocks[0].children[0], ['deny', 'all'])) {
    fail('Jieya Back-Channel access snippet must enforce POST only')
  }
  const marker = accessStatements.filter((statement) => statement.header[0] === 'add_header'
    && statement.header[1] === 'X-StarStack-BCL-Route')
  if (marker.length !== 1
    || !headerEquals(marker[0], ['add_header', 'X-StarStack-BCL-Route', 'private', 'always'])) {
    fail('Jieya Back-Channel private route marker is invalid')
  }
  return true
}

export const assertTokenHookNginx = ({ text, gatewayIp, hydraIp }) => {
  if ([text, gatewayIp, hydraIp].some((value) => typeof value !== 'string' || !value)) {
    fail('Token Hook Nginx inputs are required')
  }
  if (text.includes('__IDENTITY_')) fail('Token Hook Nginx configuration still contains a placeholder')
  const topLevel = parseStatements(text)
  if (topLevel.length !== 1 || !headerEquals(topLevel[0], ['server'])) {
    fail('Token Hook Nginx must contain one dedicated server')
  }
  const server = topLevel[0].children || []
  requireExactStatementSet(server, [
    ['listen', `${gatewayIp}:5175`],
    ['server_name', '_'],
    ['access_log', 'off'],
    ['server_tokens', 'off'],
    ['client_max_body_size', '16k'],
    ['allow', `${hydraIp}/32`],
    ['deny', 'all'],
    ['location', '=', '/internal/oidc/token-hook'],
    ['location', '/'],
  ], 'Token Hook server')
  const tokenLocation = server.find((statement) => headerEquals(
    statement,
    ['location', '=', '/internal/oidc/token-hook'],
  ))
  const fallbackLocation = server.find((statement) => headerEquals(statement, ['location', '/']))
  const tokenStatements = tokenLocation?.children || []
  requireExactStatementSet(tokenStatements, [
    ['limit_except', 'POST'],
    ['proxy_pass', 'http://127.0.0.1:5174'],
    ['proxy_set_header', 'Host', 'auth.xingzhan.cc'],
    ['proxy_set_header', 'X-Real-IP', '$remote_addr'],
    ['proxy_set_header', 'X-Forwarded-For', '$remote_addr'],
    ['proxy_set_header', 'X-Forwarded-Proto', 'http'],
    ['proxy_connect_timeout', '2s'],
    ['proxy_read_timeout', '5s'],
    ['proxy_send_timeout', '5s'],
    ['proxy_buffering', 'off'],
    ['add_header', 'X-StarStack-Hook-Route', 'private', 'always'],
  ], 'Token Hook location')
  const methodBlock = tokenStatements.find((statement) => headerEquals(statement, ['limit_except', 'POST']))
  if (!methodBlock?.children || methodBlock.children.length !== 1
    || !headerEquals(methodBlock.children[0], ['deny', 'all'])) {
    fail('Token Hook Nginx must enforce POST only')
  }
  if (!fallbackLocation?.children || fallbackLocation.children.length !== 1
    || !headerEquals(fallbackLocation.children[0], ['return', '404'])) {
    fail('Token Hook Nginx fallback must return 404')
  }
  return true
}

export const assertHydraLoopbackNginx = ({ text, hydraHookIp, publicPort, adminPort }) => {
  if (typeof text !== 'string' || !text || typeof hydraHookIp !== 'string'
    || !Number.isInteger(publicPort) || !Number.isInteger(adminPort)) {
    fail('Hydra loopback Nginx inputs are required')
  }
  if (text.includes('__IDENTITY_') || text.includes('__HYDRA_')) {
    fail('Hydra loopback Nginx configuration still contains a placeholder')
  }
  const topLevel = parseStatements(text)
  if (topLevel.length !== 2 || topLevel.some((statement) => !headerEquals(statement, ['server']))) {
    fail('Hydra loopback Nginx must contain exactly two dedicated servers')
  }

  const assertServer = ({ port, upstreamPort, publicBridge }) => {
    const matches = topLevel.filter((server) => (server.children || [])
      .some((statement) => headerEquals(statement, ['listen', `127.0.0.1:${port}`])))
    if (matches.length !== 1) fail('Hydra Nginx bridge must listen on each exact loopback port once')
    const server = matches[0]
    const location = (server.children || []).filter((statement) => headerEquals(statement, ['location', '/']))
    requireExactStatementSet(server.children || [], [
      ['listen', `127.0.0.1:${port}`],
      ['server_name', '_'],
      ['server_tokens', 'off'],
      ['access_log', 'off'],
      ['client_max_body_size', publicBridge ? '64k' : '1m'],
      ['location', '/'],
    ], 'Hydra loopback server')
    if (location.length !== 1 || !location[0].children) {
      fail('Hydra loopback server requires one root proxy location')
    }
    const expectedHeaders = publicBridge
      ? [
          ['proxy_set_header', 'Host', 'auth.xingzhan.cc'],
          ['proxy_set_header', 'X-Forwarded-Host', 'auth.xingzhan.cc'],
          ['proxy_set_header', 'X-Forwarded-Proto', 'https'],
          ['proxy_set_header', 'X-Forwarded-For', '127.0.0.1'],
          ['proxy_set_header', 'Authorization', '$http_authorization'],
        ]
      : [
          ['proxy_set_header', 'Host', '127.0.0.1'],
          ['proxy_set_header', 'X-Forwarded-For', '127.0.0.1'],
          ['proxy_set_header', 'Authorization', '$http_authorization'],
        ]
    requireExactStatementSet(location[0].children, [
      ['allow', '127.0.0.1'],
      ['deny', 'all'],
      ['proxy_http_version', '1.1'],
      ['proxy_pass', `http://${hydraHookIp}:${upstreamPort}`],
      ...expectedHeaders,
      ['proxy_connect_timeout', '2s'],
      ['proxy_read_timeout', '15s'],
      ['proxy_send_timeout', '15s'],
      ['proxy_buffering', 'off'],
    ], 'Hydra loopback proxy')
  }

  assertServer({ port: publicPort, upstreamPort: 4444, publicBridge: true })
  assertServer({ port: adminPort, upstreamPort: 4445, publicBridge: false })
  return true
}

export const assertLoopbackNginxListeners = ({ output, publicPort, adminPort }) => {
  if (typeof output !== 'string' || !Number.isInteger(publicPort) || !Number.isInteger(adminPort)) {
    fail('Hydra loopback listener inputs are required')
  }
  const localEndpoints = output.split('\n').flatMap((line) => {
    const fields = line.trim().split(/\s+/)
    return fields.length >= 4 && fields[0] === 'LISTEN' ? [fields[3]] : []
  })
  for (const port of [publicPort, adminPort]) {
    const matches = localEndpoints.filter((endpoint) => endpoint.endsWith(`:${port}`))
    if (matches.length !== 1 || matches[0] !== `127.0.0.1:${port}`) {
      fail(`Hydra Nginx bridge listener ${port} must exist exactly once on IPv4 loopback`)
    }
  }
  return true
}

export const assertHookFirewallStatus = ({ verbose, numbered, bridge, gatewayIp, hydraIp }) => {
  if ([verbose, numbered, bridge, gatewayIp, hydraIp]
    .some((value) => typeof value !== 'string' || !value)) {
    fail('Identity hook firewall inputs are required')
  }
  if (!/^Status:\s*active\s*$/im.test(verbose)
    || !/^Default:\s*deny\s*\(incoming\)/im.test(verbose)) {
    fail('Identity hook firewall must be active with default-deny incoming policy')
  }
  const bridgeLines = numbered.split('\n')
    // UFW appends the optional human-readable rule comment after ` # `.
    // Comments are not part of the packet-matching contract, so normalize
    // them away while keeping interface/source/target/port/action exact.
    .map((line) => line.split(/\s+#\s+/, 1)[0].trim().replace(/\s+/g, ' '))
    .filter((line) => line.includes(` on ${bridge} `) && !line.includes('(v6)'))
  const allowLines = bridgeLines.filter((line) => line.includes(' ALLOW IN '))
  const escapedBridge = bridge.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const allowPattern = (position, port) => new RegExp(
    `^\\[ ${position}\\] ${gatewayIp.replaceAll('.', '\\.')} ${port}/tcp on ${escapedBridge} ALLOW IN ${hydraIp.replaceAll('.', '\\.')}(/32)?$`,
  )
  if (allowLines.length !== 2
    || !allowLines.some((line) => allowPattern(1, 443).test(line))
    || !allowLines.some((line) => allowPattern(2, 5175).test(line))) {
    fail('Identity hook firewall rules 1 and 2 must allow only Hydra /32 to gateway TCP 443 and 5175')
  }
  const denyLines = bridgeLines.filter((line) => line.includes(' DENY IN '))
  if (denyLines.length !== 1
    || !new RegExp(`^\\[ 3\\] Anywhere on ${escapedBridge} DENY IN Anywhere$`).test(denyLines[0])) {
    fail('Identity hook firewall rule 3 must be the catch-all bridge deny rule')
  }
  return true
}

export const assertActiveBackchannelNginx = async ({
  dump,
  sitePath,
  accessPath,
  authPath,
  hydraLoopbackPath,
}) => {
  if ([dump, sitePath, accessPath, authPath, hydraLoopbackPath]
    .some((value) => typeof value !== 'string' || !value)) {
    fail('Active Nginx Back-Channel inputs are required')
  }
  const [siteCanonical, accessCanonical, authCanonical, hydraLoopbackCanonical] = await Promise.all([
    auditedRegularFile(sitePath, 'Jieya Back-Channel site'),
    auditedRegularFile(accessPath, 'Jieya Back-Channel access snippet'),
    auditedRegularFile(authPath, 'StarStack identity site'),
    auditedRegularFile(hydraLoopbackPath, 'Hydra loopback bridge'),
  ])
  const markers = await Promise.all(fileMarkers(dump).map(resolveActiveMarker))
  requireActiveCanonicalFile(markers, siteCanonical, {
    label: 'Jieya Back-Channel site',
    allowDirectSymlink: true,
  })
  requireActiveCanonicalFile(markers, accessCanonical, {
    label: 'Jieya Back-Channel access snippet',
    allowDirectSymlink: false,
  })
  requireActiveCanonicalFile(markers, authCanonical, {
    label: 'StarStack identity site',
    allowDirectSymlink: true,
  })
  requireActiveCanonicalFile(markers, hydraLoopbackCanonical, {
    label: 'Hydra loopback bridge',
    allowDirectSymlink: false,
  })
  if (exactLocationCount(dump) !== 1) fail('Active Nginx must contain exactly one Back-Channel exact location')
  return true
}
