import { describe, expect, it } from 'vitest'
import { sanitizeHtml } from './htmlFilter.js'

describe('sanitizeHtml links', () => {
  it('keeps regular links and adds safe rel attributes', () => {
    expect(sanitizeHtml('<a href="https://example.com" target="_blank">link</a>'))
      .toBe('<a href="https://example.com" target="_blank" rel="noopener noreferrer">link</a>')
  })

  it('rejects javascript, protocol-relative and backslash-obfuscated links', () => {
    const html = sanitizeHtml([
      '<a href="javascript:alert(1)">x</a>',
      '<a href="//evil.example">y</a>',
      '<a href="/\\\\evil.example">z</a>',
    ].join(''))
    expect(html).toBe('<a rel="noopener noreferrer">x</a><a rel="noopener noreferrer">y</a><a rel="noopener noreferrer">z</a>')
  })
})
