import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import 'highlight.js/styles/github-dark.css'
import 'katex/dist/katex.min.css'
import { applyAccent, applyTheme, readSavedAccent, readSavedTheme } from './utils/theme'
import App from './App.tsx'

// 渲染前应用主题与强调色，避免闪烁
;(() => {
  applyTheme(readSavedTheme())
  applyAccent(readSavedAccent())
})()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
