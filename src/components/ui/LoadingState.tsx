import type { HTMLAttributes } from 'react'
import { classNames } from './classNames'

type LoadingVariant = 'page' | 'ide' | 'inline' | 'compact' | 'list'

type LoadingStateProps = HTMLAttributes<HTMLDivElement> & {
  label?: string
  variant?: LoadingVariant
}

export default function LoadingState({
  label = '加载中…',
  variant = 'page',
  className,
  ...props
}: LoadingStateProps) {
  return (
    <div
      {...props}
      className={classNames('ss-loading', `ss-loading-${variant}`, className)}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="ss-loading-orbit" aria-hidden="true">
        <span className="ss-loading-orbit-dot dot-a" />
        <span className="ss-loading-orbit-dot dot-b" />
        <span className="ss-loading-orbit-dot dot-c" />
      </span>
      <span className="ss-loading-label">{label}</span>
    </div>
  )
}
