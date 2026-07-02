import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { classNames } from './classNames'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
  loading?: boolean
}

export default function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      className={classNames('ui-button', variant, size !== 'md' && size, className)}
      aria-busy={loading || undefined}
    >
      {loading ? <span className="ui-button-spinner" aria-hidden="true" /> : icon && (
        <span className="ui-button-icon" aria-hidden="true">{icon}</span>
      )}
      {children}
    </button>
  )
}
