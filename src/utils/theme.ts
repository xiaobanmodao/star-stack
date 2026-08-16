export type ThemeMode = 'dark' | 'light' | 'system'

export const THEME_KEY = 'starstack_theme'
export const ACCENT_KEY = 'starstack_accent'

export const ACCENT_PRESETS: { name: string; value: string }[] = [
  { name: '星蓝', value: '#8bd3ff' },
  { name: '星紫', value: '#b78bff' },
  { name: '星绿', value: '#5ee6a8' },
  { name: '星金', value: '#ffd166' },
  { name: '星粉', value: '#ff9ecb' },
]

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches

/** 应用强调色到 <html> 内联变量（优先级高于样式表中的默认值） */
export const applyAccent = (accent: string | null) => {
  const root = document.documentElement
  if (accent && ACCENT_PRESETS.some((p) => p.value === accent)) {
    root.style.setProperty('--ss-color-accent', accent)
  } else {
    root.style.removeProperty('--ss-color-accent')
  }
}

/** 应用主题到 <html data-theme>（main.tsx 渲染前调用，避免闪烁） */
export const applyTheme = (mode: ThemeMode) => {
  const effective = mode === 'system' ? (systemDark() ? 'dark' : 'light') : mode
  document.documentElement.dataset.theme = effective
  try {
    localStorage.setItem(THEME_KEY, mode)
  } catch {
    // 忽略
  }
}

export const readSavedTheme = (): ThemeMode => {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'dark' || saved === 'light' || saved === 'system') return saved
  } catch {
    // 忽略
  }
  return 'system'
}

export const readSavedAccent = (): string | null => {
  try {
    const saved = localStorage.getItem(ACCENT_KEY)
    if (saved && ACCENT_PRESETS.some((p) => p.value === saved)) return saved
  } catch {
    // 忽略
  }
  return null
}
