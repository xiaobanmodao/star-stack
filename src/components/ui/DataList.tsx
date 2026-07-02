import type { HTMLAttributes, ReactNode } from 'react'
import { classNames } from './classNames'

type DataListSectionProps = HTMLAttributes<HTMLDivElement> & {
  columns?: string
}

export function DataList({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={classNames('ui-data-list', className)} />
}

export function DataListHead({ columns, className, style, ...props }: DataListSectionProps) {
  return (
    <div
      {...props}
      className={classNames('ui-data-list-head', className)}
      style={{ ...style, ...(columns ? { gridTemplateColumns: columns } : {}) }}
    />
  )
}

export function DataListRow({ columns, className, style, ...props }: DataListSectionProps) {
  return (
    <div
      {...props}
      className={classNames('ui-data-list-row', className)}
      style={{ ...style, ...(columns ? { gridTemplateColumns: columns } : {}) }}
    />
  )
}

type EmptyStateProps = HTMLAttributes<HTMLDivElement> & {
  title?: ReactNode
  description?: ReactNode
}

export function EmptyState({ title, description, children, className, ...props }: EmptyStateProps) {
  return (
    <div {...props} className={classNames('ui-empty-state', className)}>
      {title && <strong>{title}</strong>}
      {description && <span>{description}</span>}
      {children}
    </div>
  )
}
