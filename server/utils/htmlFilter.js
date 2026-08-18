const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'em', 'code', 'pre', 'a', 'ul', 'ol', 'li', 'b', 'i',
  'div', 'span', 'h1', 'h2', 'h3', 'blockquote', 'hr', 'table', 'thead', 'tbody',
  'tr', 'th', 'td',
])

const ALLOWED_ATTR_MAP = {
  a: new Set(['href', 'target', 'rel']),
  span: new Set(['class']),
  code: new Set(['class']),
  pre: new Set(['class']),
}

const SAFE_URL_RE = /^(?:https?:\/\/|mailto:|\/(?!\/))/i
const SAFE_CLASS_RE = /^(?:text-(?:sm|lg|xl)|language-[a-z0-9+-]+)$/i

export function sanitizeHtml(html) {
  if (!html) return ''
  return html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)?\/?>/g, (match, tag, attrStr) => {
    const lower = tag.toLowerCase()
    if (!ALLOWED_TAGS.has(lower)) {
      return match.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }
    if (match.startsWith('</')) return `</${lower}>`
    if (lower === 'br') return '<br>'
    const allowedAttrs = ALLOWED_ATTR_MAP[lower]
    if (!allowedAttrs || !attrStr || !attrStr.trim()) return `<${lower}>`
    const safeAttrs = []
    const attrRe = /([a-zA-Z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g
    let m
    while ((m = attrRe.exec(attrStr)) !== null) {
      const attrName = m[1].toLowerCase()
      const attrVal = m[2] ?? m[3] ?? m[4] ?? ''
      if (!allowedAttrs.has(attrName)) continue
      if (attrName === 'href' && !SAFE_URL_RE.test(attrVal.trim())) continue
      if (attrName === 'target' && attrVal !== '_blank' && attrVal !== '_self') continue
      if (attrName === 'rel') continue
      if (attrName === 'class' && !SAFE_CLASS_RE.test(attrVal.trim())) continue
      const escaped = attrVal.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      safeAttrs.push(`${attrName}="${escaped}"`)
    }
    if (lower === 'a') {
      safeAttrs.push('rel="noopener noreferrer"')
    }
    return safeAttrs.length > 0 ? `<${lower} ${safeAttrs.join(' ')}>` : `<${lower}>`
  })
}
