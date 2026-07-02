import type { HTMLAttributes } from 'react'
import { classNames } from './classNames'

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone
}

export default function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      {...props}
      className={classNames('ui-badge', tone !== 'neutral' && tone, className)}
    />
  )
}
