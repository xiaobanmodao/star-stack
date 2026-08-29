import { useEffect, useRef, useState } from 'react'
import {
  ACCENT_KEY, ACCENT_PRESETS, applyAccent, applyTheme, readSavedAccent, readSavedTheme, type ThemeMode,
} from '../utils/theme'
import { IconButton } from './ui'
import { Monitor, Moon, Sun } from 'lucide-react'
import { useModalFocus } from '../hooks/useModalFocus'

const ORDER: ThemeMode[] = ['dark', 'light', 'system']

const MODE_META: Record<ThemeMode, { icon: typeof Moon; label: string }> = {
  dark: { icon: Moon, label: '深色' },
  light: { icon: Sun, label: '浅色' },
  system: { icon: Monitor, label: '跟随系统' },
}

export default function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>(readSavedTheme)
  const [accent, setAccent] = useState<string | null>(readSavedAccent)
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const dialogRef = useModalFocus(open, () => setOpen(false))

  useEffect(() => {
    applyTheme(mode)
    applyAccent(accent)
    if (mode !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handle = () => applyTheme('system')
    media.addEventListener?.('change', handle)
    return () => media.removeEventListener?.('change', handle)
  }, [mode, accent])

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    const handleClick = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => {
      document.removeEventListener('mousedown', handleClick)
    }
  }, [open])

  const pickAccent = (value: string) => {
    const next = accent === value ? null : value
    setAccent(next)
    try {
      if (next) localStorage.setItem(ACCENT_KEY, next)
      else localStorage.removeItem(ACCENT_KEY)
    } catch {
      // 忽略
    }
  }

  return (
    <div className="theme-toggle" ref={panelRef}>
      <IconButton
        className="topbar-message-btn theme-toggle-btn"
        icon={(() => { const Icon = MODE_META[mode].icon; return <Icon size={18} strokeWidth={1.8} /> })()}
        label="主题设置"
        tooltip={`主题：${MODE_META[mode].label}（点击展开设置）`}
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="theme-panel"
      />
      {open && (
        <div ref={dialogRef} id="theme-panel" className="theme-panel" role="dialog" aria-modal="false" aria-label="主题设置" tabIndex={-1}>
          <div className="theme-panel-section">
            <span className="theme-panel-title">外观</span>
            <div className="theme-mode-row">
              {ORDER.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={mode === m ? 'active' : ''}
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                >
                  {(() => { const Icon = MODE_META[m].icon; return <Icon size={16} strokeWidth={1.8} aria-hidden="true" /> })()} {MODE_META[m].label}
                </button>
              ))}
            </div>
          </div>
          <div className="theme-panel-section">
            <span className="theme-panel-title">强调色</span>
            <div className="theme-accent-row">
              {ACCENT_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  className={`theme-accent-swatch ${accent === preset.value ? 'active' : ''}`}
                  style={{ background: preset.value }}
                  onClick={() => pickAccent(preset.value)}
                  title={preset.name}
                  aria-label={preset.name}
                  aria-pressed={accent === preset.value}
                />
              ))}
              <span className="theme-accent-hint">点选切换，再点取消</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
