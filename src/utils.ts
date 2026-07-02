import { TOKEN_KEY } from './constants'

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

export const fetchJson = async <T = unknown>(url: string, options: RequestInit = {}) => {
  const headers = new Headers(options.headers || {})
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const token = localStorage.getItem(TOKEN_KEY)
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  const response = await fetch(url, { ...options, headers })
  if (response.status === 401) {
    localStorage.removeItem(TOKEN_KEY)
    window.dispatchEvent(new CustomEvent('starstack:auth-expired'))
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
