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

const fileMarkerCount = (dump, file) => {
  const marker = `# configuration file ${file}:`
  return dump.split('\n').filter((line) => line.trim() === marker).length
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

export const assertActiveBackchannelNginx = ({ dump, sitePath, accessPath }) => {
  if ([dump, sitePath, accessPath].some((value) => typeof value !== 'string' || !value)) {
    fail('Active Nginx Back-Channel inputs are required')
  }
  if (fileMarkerCount(dump, sitePath) !== 1 || fileMarkerCount(dump, accessPath) !== 1) {
    fail('Jieya Back-Channel site and access snippet must both be active in Nginx')
  }
  if (exactLocationCount(dump) !== 1) fail('Active Nginx must contain exactly one Back-Channel exact location')
  return true
}
