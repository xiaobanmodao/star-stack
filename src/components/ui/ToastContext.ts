import { createContext, useContext } from 'react'

export type ToastTone = 'success' | 'error' | 'warning' | 'info'

export type ToastOptions = {
  duration?: number
  tone?: ToastTone
}

export type ToastContextValue = {
  showToast: (message: string, options?: ToastOptions | ToastTone) => number
  dismissToast: (id: number) => void
}

export const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast() {
  const value = useContext(ToastContext)
  if (!value) throw new Error('useToast 必须在 ToastProvider 内使用')
  return value
}
