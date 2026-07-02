import type { ReactNode } from 'react'

type PageHeaderProps = {
  kicker?: string
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}

export default function PageHeader({ kicker, title, description, actions }: PageHeaderProps) {
  return (
    <header className="ui-page-header">
      <div className="ui-page-header-main">
        {kicker && <div className="ui-page-kicker">{kicker}</div>}
        <h1 className="ui-page-title">{title}</h1>
        {description && <p className="ui-page-description">{description}</p>}
      </div>
      {actions && <div className="ui-page-actions">{actions}</div>}
    </header>
  )
}
