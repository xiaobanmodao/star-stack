import { TOKEN_KEY } from './constants'

export type FetchJsonOptions = RequestInit & {
  /** 请求超时时间；传 0 可关闭超时（仅用于长连接）。 */
  timeoutMs?: number
  /** 登录/注册等认证接口不应触发全局会话失效事件。 */
  skipAuthExpiry?: boolean
}

export type ApiRequestErrorCode = 'NETWORK_ERROR' | 'TIMEOUT' | 'ABORTED'

export class ApiRequestError extends Error {
  code: ApiRequestErrorCode
  cause?: unknown

  constructor(message: string, code: ApiRequestErrorCode, cause?: unknown) {
    super(message)
    this.name = 'ApiRequestError'
    this.code = code
    this.cause = cause
  }
}

export const isPollingPageVisible = () =>
  typeof document === 'undefined' || document.visibilityState === 'visible'

// 格式化时间显示为确切时间
export const formatTime = (dateString?: string): string => {
  if (!dateString) return '-'
  const date = new Date(dateString)
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}`
}

export const openInNewTab = (url: string) => {
  window.open(url, '_blank', 'noopener,noreferrer')
}

export const decodeHtmlEntities = (value = ''): string => {
  if (!value) return ''
  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea')
    textarea.innerHTML = value
    return textarea.value
  }
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

export const htmlToPlainText = (value = ''): string => {
  const withoutTags = value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|pre|blockquote|h[1-6])>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
  return decodeHtmlEntities(withoutTags).replace(/\s+/g, ' ').trim()
}

export const fetchJson = async <T = unknown>(url: string, options: FetchJsonOptions = {}) => {
  const {
    timeoutMs = 15000,
    skipAuthExpiry = false,
    signal: externalSignal,
    ...requestInit
  } = options
  const headers = new Headers(requestInit.headers || {})
  if (requestInit.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const token = localStorage.getItem(TOKEN_KEY)
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const controller = new AbortController()
  let timedOut = false
  let timeoutId: number | null = null
  const abortFromExternal = () => controller.abort(externalSignal?.reason)
  if (externalSignal) {
    if (externalSignal.aborted) abortFromExternal()
    else externalSignal.addEventListener('abort', abortFromExternal, { once: true })
  }
  if (timeoutMs > 0) {
    timeoutId = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
  }

  let response: Response
  try {
    response = await fetch(url, { ...requestInit, headers, signal: controller.signal })
  } catch (error) {
    if (externalSignal?.aborted) {
      throw new ApiRequestError('请求已取消', 'ABORTED', error)
    }
    if (timedOut) {
      throw new ApiRequestError('请求超时，请稍后重试', 'TIMEOUT', error)
    }
    throw new ApiRequestError('网络连接失败，请检查网络后重试', 'NETWORK_ERROR', error)
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId)
    externalSignal?.removeEventListener('abort', abortFromExternal)
  }

  if (response.status === 401 && token && !skipAuthExpiry) {
    localStorage.removeItem(TOKEN_KEY)
    window.dispatchEvent(new CustomEvent('starstack:auth-expired', {
      detail: { from: `${window.location.pathname}${window.location.search}${window.location.hash}` },
    }))
  }
  let data: T | null = null
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    data = await response.json().catch(() => null)
  }
  return { response, data }
}

let ojIdeAssetsPreloadPromise: Promise<unknown> | null = null
export const preloadOjIdeAssets = () => {
  if (!ojIdeAssetsPreloadPromise) {
    ojIdeAssetsPreloadPromise = Promise.allSettled([
      import('./components/OjIdePanel'),
      import('@monaco-editor/react').then(m => m.loader.init()),
    ])
  }
  return ojIdeAssetsPreloadPromise
}
