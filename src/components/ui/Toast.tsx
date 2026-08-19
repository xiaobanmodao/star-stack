import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import './Toast.css'
import { ToastContext, type ToastOptions, type ToastTone } from './ToastContext'

type ToastItem = {
  id: number
  message: string
  tone: ToastTone
  duration: number
}

const toneLabels: Record<ToastTone, string> = {
  success: '成功',
  error: '错误',
  warning: '提醒',
  info: '提示',
}

const toneIcons: Record<ToastTone, string> = {
  success: '✓',
  error: '!',
  warning: '⚠',
  info: 'i',
}

const normalizeOptions = (options?: ToastOptions | ToastTone): ToastOptions => {
  if (typeof options === 'string') return { tone: options }
  return options || {}
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(0)

  const dismissToast = useCallback((id: number) => {
    setToasts((items) => items.filter((item) => item.id !== id))
  }, [])

  const showToast = useCallback((message: string, options?: ToastOptions | ToastTone) => {
    const normalized = normalizeOptions(options)
    const id = nextId.current + 1
    nextId.current = id
    const item: ToastItem = {
      id,
      message,
      tone: normalized.tone || 'info',
      duration: Math.max(1800, normalized.duration || 3200),
    }
    setToasts((items) => [...items.slice(-3), item])
    return id
  }, [])

  const value = useMemo(() => ({ showToast, dismissToast }), [dismissToast, showToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-viewport" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={dismissToast} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.duration)
    return () => window.clearTimeout(timer)
  }, [onDismiss, toast.duration, toast.id])

  return (
    <div className={`toast-card toast-${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
      <span className="toast-icon" aria-hidden="true">{toneIcons[toast.tone]}</span>
      <div className="toast-content">
        <strong>{toneLabels[toast.tone]}</strong>
        <span>{toast.message}</span>
      </div>
      <button
        className="toast-close"
        type="button"
        aria-label="关闭提示"
        onClick={() => onDismiss(toast.id)}
      >
        ×
      </button>
      <span className="toast-progress" style={{ animationDuration: `${toast.duration}ms` }} aria-hidden="true" />
    </div>
  )
}
