import './AuthPage.css'
import { useEffect, useRef } from 'react'
import type { AuthPageProps } from '../types'

type TurnstileOptions = {
  sitekey: string
  action: string
  theme: 'auto'
  callback: (token: string) => void
  'error-callback': () => void
  'expired-callback': () => void
}

type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileOptions) => string
  remove?: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined

const TurnstileWidget = ({
  action,
  resetKey,
  onToken,
}: {
  action: string
  resetKey: number
  onToken: (token: string) => void
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    onToken('')
    if (!TURNSTILE_SITE_KEY || !containerRef.current) return

    let widgetId: string | undefined
    let attempts = 0
    let timer: number | undefined
    const renderWidget = () => {
      if (!containerRef.current || !window.turnstile) {
        attempts += 1
        if (attempts < 100) timer = window.setTimeout(renderWidget, 100)
        return
      }
      widgetId = window.turnstile.render(containerRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        action,
        theme: 'auto',
        callback: onToken,
        'error-callback': () => onToken(''),
        'expired-callback': () => onToken(''),
      })
    }

    renderWidget()
    return () => {
      if (timer) window.clearTimeout(timer)
      if (widgetId && window.turnstile?.remove) window.turnstile.remove(widgetId)
    }
  }, [action, onToken, resetKey])

  if (!TURNSTILE_SITE_KEY) {
    return <div className="auth-captcha-missing">安全验证暂未配置</div>
  }
  return <div ref={containerRef} className="auth-turnstile" aria-label="安全验证" />
}

const AuthPage = ({
  mode,
  onModeChange,
  onBack,
  onSubmit,
  formId,
  formName,
  formEmail,
  formEmailCode,
  formPassword,
  formConfirm,
  onFormIdChange,
  onFormNameChange,
  onFormEmailChange,
  onFormEmailCodeChange,
  onFormPasswordChange,
  onFormConfirmChange,
  onSendEmailCode,
  error,
  success,
  submitting,
  emailSending,
  emailCooldown,
  captchaRequired,
  captchaResetKey,
  onCaptchaTokenChange,
}: AuthPageProps) => (
  <section className="auth-page">
    <div className="auth-panel">
      <div className="auth-header">
        <div>
          <div className="auth-title">星栈账号</div>
          <div className="auth-subtitle">登录后解锁完整功能</div>
        </div>
        <button className="ghost small" type="button" onClick={onBack} disabled={submitting}>
          返回
        </button>
      </div>
      <div className="auth-tabs">
        <button className={mode === 'login' ? 'active' : ''} type="button" onClick={() => onModeChange('login')} disabled={submitting}>
          登录
        </button>
        <button
          className={mode === 'register' ? 'active' : ''}
          type="button"
          onClick={() => onModeChange('register')}
          disabled={submitting}
        >
          注册
        </button>
      </div>
      <form className="auth-form" onSubmit={onSubmit}>
        <label>
          ID
          <input
            className="auth-input"
            type="text"
            value={formId}
            onChange={(event) => onFormIdChange(event.target.value)}
          />
        </label>
        {mode === 'register' && (
          <label>
            名称
            <input
              className="auth-input"
              type="text"
              value={formName}
              onChange={(event) => onFormNameChange(event.target.value)}
            />
          </label>
        )}
        <label>
          密码
          <input
            className="auth-input"
            type="password"
            value={formPassword}
            onChange={(event) => onFormPasswordChange(event.target.value)}
          />
        </label>
        {mode === 'register' && (
          <label>
            邮箱验证码
            <div className="auth-code-row">
              <input
                className="auth-input"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={formEmailCode}
                onChange={(event) => onFormEmailCodeChange(event.target.value.replace(/\D/g, ''))}
                placeholder="6 位验证码"
                autoComplete="one-time-code"
              />
              <button
                className="ghost auth-code-button"
                type="button"
                onClick={onSendEmailCode}
                disabled={submitting || emailSending || emailCooldown > 0}
              >
                {emailSending ? '发送中…' : emailCooldown > 0 ? `${emailCooldown}s 后重发` : '发送验证码'}
              </button>
            </div>
          </label>
        )}
        {mode === 'register' && (
          <label>
            邮箱
            <input
              className="auth-input"
              type="email"
              value={formEmail}
              onChange={(event) => onFormEmailChange(event.target.value)}
              autoComplete="email"
              placeholder="用于接收注册验证码"
            />
          </label>
        )}
        {mode === 'register' && (
          <label>
            确认密码
            <input
              className="auth-input"
              type="password"
              value={formConfirm}
              onChange={(event) => onFormConfirmChange(event.target.value)}
            />
          </label>
        )}
        {captchaRequired && (
          <TurnstileWidget
            action={mode}
            resetKey={captchaResetKey}
            onToken={onCaptchaTokenChange}
          />
        )}
        {error && <div className="auth-error">{error}</div>}
        {success && <div className="auth-success">{success}</div>}
        <div className="auth-actions">
          <button className="primary auth-submit-button" type="submit" disabled={submitting} aria-busy={submitting || undefined}>
            {submitting && <span className="loading-button-icon" aria-hidden="true" />}
            {submitting ? (mode === 'login' ? '登录中…' : '注册中…') : (mode === 'login' ? '登录' : '注册')}
          </button>
        </div>
      </form>
    </div>
  </section>
)

export default AuthPage
