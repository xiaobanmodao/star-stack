import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeHtmlEntities, htmlToPlainText, openInNewTab } from './utils'

describe('decodeHtmlEntities', () => {
  it('decodes common HTML entities', () => {
    expect(decodeHtmlEntities('a&amp;b &lt;x&gt; &quot;q&quot; &#39;s&#39;')).toBe('a&b <x> "q" \'s\'')
  })
})

describe('htmlToPlainText', () => {
  it('strips tags and converts block breaks to spaces', () => {
    expect(htmlToPlainText('<p>Hello</p><p>World</p>')).toBe('Hello World')
  })

  it('treats br as a space separator', () => {
    expect(htmlToPlainText('line1<br>line2')).toBe('line1 line2')
  })

  it('returns empty string for empty input', () => {
    expect(htmlToPlainText('')).toBe('')
  })
})

describe('openInNewTab', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens a URL in a new tab with noopener and noreferrer', () => {
    const open = vi.fn()
    vi.stubGlobal('window', { open })

    openInNewTab('/oj')

    expect(open).toHaveBeenCalledWith('/oj', '_blank', 'noopener,noreferrer')
  })
})
