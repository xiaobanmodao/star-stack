import type { HTMLAttributes } from 'react'
import { classNames } from './classNames'

type PanelProps = HTMLAttributes<HTMLDivElement> & {
  padded?: boolean
  elevated?: boolean
}

export default function Panel({
  padded = true,
  elevated = false,
  className,
  ...props
}: PanelProps) {
  return (
    <div
      {...props}
      className={classNames('ui-panel', padded && 'padded', elevated && 'elevated', className)}
    />
  )
}
