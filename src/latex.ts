import katex from 'katex'

const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'em', 'code', 'pre', 'a', 'ul', 'ol', 'li', 'b', 'i',
  'div', 'span', 'h1', 'h2', 'h3', 'blockquote', 'hr', 'table', 'thead', 'tbody',
  'tr', 'th', 'td',
])

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'target', 'rel']),
  span: new Set(['class']),
  code: new Set(['class']),
  pre: new Set(['class']),
}

const SAFE_URL_RE = /^(?:https?:\/\/|mailto:|\/(?!\/))/i
// class 白名单：只允许文字大小类与代码语言类（与服务端 sanitizeHtml 一致）
const SAFE_CLASS_RE = /^(?:text-(?:sm|lg|xl)|language-[a-z0-9+-]+)$/i
const LATEX_PLAIN_TEXT_MAP: Array<[RegExp, string]> = [
  [/\\leq?/g, '≤'],
  [/\\geq?/g, '≥'],
  [/\\neq/g, '≠'],
  [/\\times/g, '×'],
  [/\\cdot/g, '·'],
  [/\\to/g, '→'],
  [/\\rightarrow/g, '→'],
  [/\\leftarrow/g, '←'],
  [/\\Rightarrow/g, '⇒'],
  [/\\Leftarrow/g, '⇐'],
  [/\\infty/g, '∞'],
  [/\\pm/g, '±'],
  [/\\ldots/g, '…'],
]

const escapeHtml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const normalizePlainMathText = (text: string) =>
  LATEX_PLAIN_TEXT_MAP.reduce((result, [pattern, value]) => result.replace(pattern, value), text)

const sanitizeRichHtml = (raw: string) => {
  if (!raw) return ''
  if (typeof document === 'undefined') {
    return escapeHtml(normalizePlainMathText(raw)).replace(/\n/g, '<br>')
  }

  const template = document.createElement('template')
  template.innerHTML = raw

  const sanitizeNode = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) return
    if (node.nodeType !== Node.ELEMENT_NODE) {
      node.parentNode?.removeChild(node)
      return
    }

    const element = node as HTMLElement
    const tag = element.tagName.toLowerCase()

    Array.from(element.childNodes).forEach(sanitizeNode)

    if (!ALLOWED_TAGS.has(tag)) {
      const replacement = document.createTextNode(element.textContent || '')
      element.replaceWith(replacement)
      return
    }

    const allowedAttrs = ALLOWED_ATTRS[tag] ?? new Set<string>()
    Array.from(element.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase()
      const value = attr.value.trim()
      if (!allowedAttrs.has(name)) {
        element.removeAttribute(attr.name)
        return
      }
      if (name === 'href' && !SAFE_URL_RE.test(value)) {
        element.removeAttribute(attr.name)
        return
      }
      if (name === 'class' && !SAFE_CLASS_RE.test(value)) {
        element.removeAttribute(attr.name)
        return
      }
      if (name === 'target' && value !== '_blank' && value !== '_self') {
        element.removeAttribute(attr.name)
      }
    })

    if (tag === 'a') {
      element.setAttribute('rel', 'noopener noreferrer')
    }
  }

  Array.from(template.content.childNodes).forEach(sanitizeNode)
  return template.innerHTML
}

const renderFormula = (formula: string, displayMode: boolean) => {
  try {
    return katex.renderToString(formula.trim(), {
      displayMode,
      throwOnError: false,
    })
  } catch {
    return escapeHtml(normalizePlainMathText(formula))
  }
}

const renderTextSegment = (text: string) => {
  const formulas: Array<{ token: string; html: string }> = []
  const makeToken = (formula: string, displayMode: boolean) => {
    const token = `__STARSTACK_LATEX_${formulas.length}__`
    formulas.push({ token, html: renderFormula(formula, displayMode) })
    return token
  }

  const normalized = normalizePlainMathText(text)
    .replace(/\\\[([\s\S]+?)\\\]/g, (_match, formula) => makeToken(formula, true))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_match, formula) => makeToken(formula, false))
    .replace(/\$\$([\s\S]+?)\$\$/g, (_match, formula) => makeToken(formula, true))
    .replace(/\$([^$\n]+)\$/g, (_match, formula) => makeToken(formula, false))

  const escaped = escapeHtml(normalized).replace(/\n/g, '<br>')
  return formulas.reduce((result, item) => result.replaceAll(item.token, item.html), escaped)
}

export const renderLatex = (text: string): string => {
  if (!text) return ''
  const sanitized = sanitizeRichHtml(text)

  if (typeof document === 'undefined') {
    return renderTextSegment(sanitized)
  }

  const template = document.createElement('template')
  template.innerHTML = sanitized

  const walk = (node: Node, inCodeBlock = false) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (inCodeBlock) return
      const content = node.textContent || ''
      if (!content.trim() && !content.includes('\n')) return
      const rendered = renderTextSegment(content)
      if (rendered === escapeHtml(normalizePlainMathText(content)).replace(/\n/g, '<br>')) {
        node.textContent = normalizePlainMathText(content)
        return
      }
      const holder = document.createElement('span')
      holder.innerHTML = rendered
      const fragment = document.createDocumentFragment()
      Array.from(holder.childNodes).forEach((child) => fragment.appendChild(child))
      node.parentNode?.replaceChild(fragment, node)
      return
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node as HTMLElement
    const nextInCodeBlock = inCodeBlock || element.tagName.toLowerCase() === 'code' || element.tagName.toLowerCase() === 'pre'
    Array.from(element.childNodes).forEach((child) => walk(child, nextInCodeBlock))
  }

  Array.from(template.content.childNodes).forEach((child) => walk(child))
  return template.innerHTML
}
