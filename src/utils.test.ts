import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError, decodeHtmlEntities, fetchJson, htmlToPlainText, openInNewTab } from './utils'

afterEach(() => {
  vi.unstubAllGlobals()
})

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
  it('opens a URL in a new tab with noopener and noreferrer', () => {
    const open = vi.fn()
    vi.stubGlobal('window', { open })

    openInNewTab('/oj')

    expect(open).toHaveBeenCalledWith('/oj', '_blank', 'noopener,noreferrer')
  })
})

describe('fetchJson', () => {
  const installBrowserGlobals = (token = '') => {
    const storage = {
      getItem: vi.fn(() => token),
      removeItem: vi.fn(),
    }
    const dispatchEvent = vi.fn()
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      dispatchEvent,
      location: { pathname: '/oj/list', search: '?page=2', hash: '#top' },
    })
    return { storage, dispatchEvent }
  }

  it('adds the current token and emits a recoverable auth-expired event on 401', async () => {
    const { storage, dispatchEvent } = installBrowserGlobals('expired-token')
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(input).toBe('/api/me')
      expect(init?.headers).toBeInstanceOf(Headers)
      expect((init?.headers as Headers).get('Authorization')).toBe('Bearer expired-token')
      return new Response(JSON.stringify({ message: '登录已过期' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    }))

    const { response } = await fetchJson('/api/me')

    expect(response.status).toBe(401)
    expect(storage.removeItem).toHaveBeenCalledWith('starstack_token')
    expect(dispatchEvent).toHaveBeenCalledTimes(1)
    expect((dispatchEvent.mock.calls[0][0] as CustomEvent).detail.from).toBe('/oj/list?page=2#top')
  })

  it('normalizes network failures for callers', async () => {
    installBrowserGlobals()
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))

    const request = fetchJson('/api/health')

    await expect(request).rejects.toBeInstanceOf(ApiRequestError)
    await expect(request).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
  })

  it('normalizes caller cancellation without treating it as a network failure', async () => {
    installBrowserGlobals()
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })))
    const controller = new AbortController()
    const request = fetchJson('/api/oj/problems', { signal: controller.signal })
    controller.abort()
    await expect(request).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('emits auth-expired for cookie-only sessions without a local token', async () => {
    const { storage, dispatchEvent } = installBrowserGlobals()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: '登录已过期' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })))

    const { response } = await fetchJson('/api/me')

    expect(response.status).toBe(401)
    expect(storage.removeItem).not.toHaveBeenCalled()
    expect(dispatchEvent).toHaveBeenCalledTimes(1)
  })
})
