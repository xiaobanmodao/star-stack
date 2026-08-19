import type { ReactNode } from 'react'
import Button from './Button'

type ErrorStateProps = {
  title?: string
  description: string
  onRetry?: () => void
  retryLabel?: string
  action?: ReactNode
}

export default function ErrorState({
  title = '加载失败',
  description,
  onRetry,
  retryLabel = '重新加载',
  action,
}: ErrorStateProps) {
  return (
    <div className="ss-error-state" role="alert">
      <div className="ss-error-state-icon" aria-hidden="true">!</div>
      <div className="ss-error-state-copy">
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      {action ?? (onRetry ? (
        <Button variant="ghost" size="sm" onClick={onRetry}>{retryLabel}</Button>
      ) : null)}
    </div>
  )
}
