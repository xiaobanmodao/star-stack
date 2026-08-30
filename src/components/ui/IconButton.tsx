import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { classNames } from './classNames'

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  icon: ReactNode
  label: string
  tooltip?: string
  badge?: ReactNode
  size?: 'sm' | 'md'
}

export default function IconButton({
  icon,
  label,
  tooltip,
  badge,
  size = 'md',
  className,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={classNames('ui-icon-button', size === 'sm' && 'ui-icon-button-sm', className)}
      aria-label={label}
      title={tooltip || label}
    >
      <span aria-hidden="true">{icon}</span>
      {badge !== undefined && badge !== null && <span className="ui-icon-button-badge">{badge}</span>}
    </button>
  )
}
