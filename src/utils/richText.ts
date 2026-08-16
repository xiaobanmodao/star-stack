import { renderLatex } from '../latex'
import { highlightCode } from './highlight'

/**
 * 富文本帖子/评论渲染：
 * 1. renderLatex —— HTML 白名单清洗 + KaTeX 公式（$...$ / $$...$$ / \(...\) / \[...\]），代码块内不渲染公式
 * 2. 对 <pre><code class="language-xxx"> 代码块做语法高亮
 * 仅在浏览器端使用（依赖 document）。
 */
export const renderRichText = (html: string): string => {
  if (!html) return ''
  if (typeof document === 'undefined') return renderLatex(html)

  const template = document.createElement('template')
  template.innerHTML = renderLatex(html)

  const walk = (node: Node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node as HTMLElement
    Array.from(element.childNodes).forEach(walk)

    if (element.tagName.toLowerCase() === 'pre') {
      const codeEl = element.querySelector(':scope > code')
      if (codeEl) {
        const langMatch = /(?:^|\s)language-([a-z0-9+-]+)/i.exec(codeEl.className || '')
        const lang = langMatch ? langMatch[1].toLowerCase() : 'plaintext'
        const code = codeEl.textContent || ''
        const highlighted = highlightCode(code, lang)
        if (highlighted !== code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')) {
          codeEl.innerHTML = highlighted
        }
      }
    }
  }

  Array.from(template.content.childNodes).forEach(walk)
  return template.innerHTML
}
