import { describe, expect, it } from 'vitest'
import { renderLatex } from './latex'

describe('renderLatex', () => {
  it('escapes raw script tags', () => {
    const output = renderLatex('<script>alert(1)</script>')
    expect(output).not.toContain('<script>')
    expect(output).toContain('script')
  })

  it('does not preserve executable javascript URLs', () => {
    const output = renderLatex('<a href="javascript:alert(1)">x</a>')
    expect(output).not.toContain('href="javascript:')
    expect(output).not.toContain('<a')
  })

  it('converts plain math symbols', () => {
    expect(renderLatex('a \\leq b')).toContain('≤')
    expect(renderLatex('a \\times b')).toContain('×')
  })

  it('renders inline math with KaTeX', () => {
    const output = renderLatex('$x^2$')
    expect(output).toContain('katex')
    expect(output).toContain('x')
  })
})
