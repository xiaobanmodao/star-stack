import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import 'highlight.js/styles/github-dark.css'
import 'katex/dist/katex.min.css'
import { applyAccent, applyTheme, readSavedAccent, readSavedTheme } from './utils/theme'
import App from './App.tsx'
import AppErrorBoundary from './components/AppErrorBoundary'
import { ToastProvider } from './components/ui/Toast'

// 渲染前应用主题与强调色，避免闪烁
;(() => {
  applyTheme(readSavedTheme())
  applyAccent(readSavedAccent())
})()

// 基础前端错误监控：把运行时错误上报到后端 client_errors
let lastClientErrorReportAt = 0
const reportClientError = (message: string, source = '', line = 0, column = 0, error?: unknown) => {
  try {
    const now = Date.now()
    if (now - lastClientErrorReportAt < 2000) return
    lastClientErrorReportAt = now
    const token = localStorage.getItem('starstack_token')
    const stack = error instanceof Error ? error.stack : undefined
    void fetch('/api/client-errors', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        message: String(message).slice(0, 500),
        source: String(source).slice(0, 500),
        line,
        column,
        stack: stack ? String(stack).slice(0, 2000) : undefined,
        url: window.location.href,
        userAgent: navigator.userAgent,
      }),
    }).catch(() => {})
  } catch {
    // 上报失败不能影响页面运行
  }
}

window.addEventListener('error', (event) => {
  reportClientError(event.message, event.filename, event.lineno, event.colno, event.error)
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  reportClientError(
    reason instanceof Error ? reason.message : String(reason),
    '',
    0,
    0,
    reason instanceof Error ? reason : undefined
  )
})

window.addEventListener('starstack:app-error', (event) => {
  const detail = (event as CustomEvent<{ error?: unknown }>).detail
  reportClientError(
    detail?.error instanceof Error ? detail.error.message : 'React 页面渲染异常',
    '',
    0,
    0,
    detail?.error,
  )
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <BrowserRouter>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </BrowserRouter>
    </ToastProvider>
  </StrictMode>,
)

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
