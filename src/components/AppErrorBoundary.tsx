import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { hasError: boolean }

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    window.dispatchEvent(new CustomEvent('starstack:app-error', {
      detail: { error, componentStack: info.componentStack },
    }))
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <main className="app-fatal-error" role="alert" aria-live="assertive">
        <div className="app-fatal-error-panel">
          <span className="app-fatal-error-icon" aria-hidden="true">!</span>
          <p className="app-fatal-error-kicker">STARSTACK SYSTEM</p>
          <h1>页面暂时无法显示</h1>
          <p>刚才的页面遇到了一点异常，重新加载通常就能恢复。</p>
          <div className="app-fatal-error-actions">
            <button type="button" className="primary" onClick={() => window.location.reload()}>
              重新加载页面
            </button>
            <button type="button" className="ghost" onClick={() => { window.location.href = '/' }}>
              返回首页
            </button>
          </div>
        </div>
      </main>
    )
  }
}
