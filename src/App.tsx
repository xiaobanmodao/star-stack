import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import './App.css'
import 'katex/dist/katex.min.css'
import { AutoTranslateScope, type UiLanguage } from './components/AutoTranslateScope'
import { StarBotGettingStartedView, StarBotPageView } from './components/StarBotPages'
import { AppContext } from './context/AppContext'
import { TOKEN_KEY, UI_LANGUAGE_KEY, TRANSLATION_WARMUP_TEXTS } from './constants'
import { fetchJson, preloadOjIdeAssets } from './utils'
import type {
  UserRecord, ProblemPlan, AuthMode, AuthPageProps,
  UserResponse, AuthResponse, UnreadCountResponse, ApiResponse,
} from './types'

// Lazy page imports
const HomePage = lazy(() => import('./pages/HomePage'))
const MyProblemsPage = lazy(() => import('./pages/MyProblemsPage'))
const CreateProblemPage = lazy(() => import('./pages/CreateProblemPage'))
const EditProblemPage = lazy(() => import('./pages/EditProblemPage'))
const AccountPage = lazy(() => import('./pages/AccountPage'))
const LeaderboardPage = lazy(() => import('./pages/LeaderboardPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const OjHomePage = lazy(() => import('./pages/OjHomePage'))
const OjProblemListPage = lazy(() => import('./pages/OjProblemListPage'))
const OjDetailPage = lazy(() => import('./pages/OjDetailPage'))
const OjJudgePage = lazy(() => import('./pages/OjJudgePage'))
const OjProblemRecordsPage = lazy(() => import('./pages/OjProblemRecordsPage'))
const OjSubmissionsPage = lazy(() => import('./pages/OjSubmissionsPage'))
const MessageListPage = lazy(() => import('./pages/MessageListPage'))
const ChatPage = lazy(() => import('./pages/ChatPage'))
const DiscussionListPage = lazy(() => import('./pages/DiscussionListPage'))
const DiscussionDetailPage = lazy(() => import('./pages/DiscussionDetailPage'))
const DiscussionCreatePage = lazy(() => import('./pages/DiscussionCreatePage'))
const DiscussionEditPage = lazy(() => import('./pages/DiscussionEditPage'))

const isPollingPageVisible = () =>
  typeof document === 'undefined' || document.visibilityState === 'visible'

const AuthPage = ({
  mode,
  onModeChange,
  onBack,
  onSubmit,
  formId,
  formName,
  formPassword,
  formConfirm,
  onFormIdChange,
  onFormNameChange,
  onFormPasswordChange,
  onFormConfirmChange,
  error,
  success,
}: AuthPageProps) => (
  <section className="auth-page">
    <div className="auth-panel">
      <div className="auth-header">
        <div>
          <div className="auth-title">星栈账号</div>
          <div className="auth-subtitle">登录后解锁完整功能</div>
        </div>
        <button className="ghost small" type="button" onClick={onBack}>
          返回
        </button>
      </div>
      <div className="auth-tabs">
        <button className={mode === 'login' ? 'active' : ''} type="button" onClick={() => onModeChange('login')}>
          登录
        </button>
        <button
          className={mode === 'register' ? 'active' : ''}
          type="button"
          onClick={() => onModeChange('register')}
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
            确认密码
            <input
              className="auth-input"
              type="password"
              value={formConfirm}
              onChange={(event) => onFormConfirmChange(event.target.value)}
            />
          </label>
        )}
        {error && <div className="auth-error">{error}</div>}
        {success && <div className="auth-success">{success}</div>}
        <div className="auth-actions">
          <button className="primary" type="submit">
            {mode === 'login' ? '登录' : '注册'}
          </button>
        </div>
      </form>
    </div>
  </section>
)

const UserMenu = ({ currentUser, initial, navigate, location, openLogoutConfirm }: {
  currentUser: UserRecord
  initial: string
  navigate: ReturnType<typeof useNavigate>
  location: ReturnType<typeof useLocation>
  openLogoutConfirm: () => void
}) => {
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const closeTimerRef = useRef<number | null>(null)

  const handleMouseEnter = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    setUserMenuOpen(true)
  }

  const handleMouseLeave = () => {
    closeTimerRef.current = window.setTimeout(() => {
      setUserMenuOpen(false)
    }, 300)
  }

  const handleAvatarClick = () => {
    if (location.pathname !== '/account') {
      navigate('/account')
    }
  }

  return (
    <div
      className="user-menu"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="user-avatar-btn" onClick={handleAvatarClick} style={{ cursor: 'pointer' }}>
        {currentUser.avatar ? (
          <img src={currentUser.avatar} alt="头像" />
        ) : (
          <span>{initial}</span>
        )}
      </div>
      <div className={`user-menu-panel ${userMenuOpen ? 'open' : ''}`} role="menu" aria-label="用户菜单">
        <button className="user-menu-item" type="button" onClick={() => {
          if (location.pathname !== '/account') navigate('/account');
          setUserMenuOpen(false);
        }}>
          个人中心
        </button>
        <button className="user-menu-item" type="button" onClick={() => {
          if (location.pathname !== '/my-problems') navigate('/my-problems');
          setUserMenuOpen(false);
        }}>
          我的题目
        </button>
        <button className="user-menu-item" type="button" onClick={() => {
          if (location.pathname !== '/oj/submissions') navigate('/oj/submissions');
          setUserMenuOpen(false);
        }}>
          我的提交
        </button>
        <div className="user-menu-divider" aria-hidden="true" />
        <button className="user-menu-item danger" type="button" onClick={() => { openLogoutConfirm(); setUserMenuOpen(false); }}>
          退出账号
        </button>
      </div>
    </div>
  )
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const translateRootRef = useRef<HTMLDivElement | null>(null)
  const appRef = useRef<HTMLDivElement | null>(null)
  const topbarRef = useRef<HTMLElement | null>(null)
  const langSwitchRef = useRef<HTMLDivElement | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const isAuthPage = location.pathname === '/auth'
  const isOjDetailOrJudgePage = location.pathname.match(/^\/oj\/(p\d+|judge)/)
  const isOjProblemDetailPage = /^\/oj\/p\/?\d+$/.test(location.pathname)
  const [homeEnter, setHomeEnter] = useState(false)
  const homeEnteredRef = useRef(false)
  const translateBusyRef = useRef(false)
  const translationWarmupDoneRef = useRef<Set<UiLanguage>>(new Set(['zh']))
  const translationRevealWindowUntilRef = useRef(0)

  useEffect(() => {
    if (!location.pathname.startsWith('/oj')) return
    void preloadOjIdeAssets().catch(() => undefined)
  }, [location.pathname])

  const [uiLanguage, setUiLanguage] = useState<UiLanguage>(() => {
    const saved = localStorage.getItem(UI_LANGUAGE_KEY)
    return saved === 'en' ? 'en' : 'zh'
  })
  const [langMenuOpen, setLangMenuOpen] = useState(false)
  const [pendingLanguageSwitchTarget, setPendingLanguageSwitchTarget] = useState<UiLanguage | null>(null)
  const [pageLanguageSwitchBlocking, setPageLanguageSwitchBlocking] = useState(false)
  const [problemLanguageSwitchBlocking, setProblemLanguageSwitchBlocking] = useState(false)

  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [authError, setAuthError] = useState('')
  const [authSuccess, setAuthSuccess] = useState('')
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [logoutNotice, setLogoutNotice] = useState('')
  const [currentUser, setCurrentUser] = useState<UserRecord | null>(null)
  const [authFrom, setAuthFrom] = useState('/')

  const [problemPlan, setProblemPlan] = useState<ProblemPlan[]>([])
  const [unreadMessageCount, setUnreadMessageCount] = useState(0)

  const [formId, setFormId] = useState('')
  const [formName, setFormName] = useState('')
  const [formPassword, setFormPassword] = useState('')
  const [formConfirm, setFormConfirm] = useState('')

  useEffect(() => {
    localStorage.setItem(UI_LANGUAGE_KEY, uiLanguage)
    document.documentElement.lang = uiLanguage === 'en' ? 'en' : 'zh-CN'
  }, [uiLanguage])

  const prefetchLanguageWarmup = useCallback(async (target: UiLanguage) => {
    if (target !== 'en') return
    if (translationWarmupDoneRef.current.has(target)) return
    translationWarmupDoneRef.current.add(target)
    try {
      await fetch('/api/translate/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceLang: 'auto',
          targetLang: 'en',
          texts: [...TRANSLATION_WARMUP_TEXTS],
        }),
      })
    } catch {
      // Ignore warmup failures
    }
  }, [])

  const beginTranslationRevealBlock = useCallback((target: UiLanguage) => {
    if (target !== 'en') {
      translationRevealWindowUntilRef.current = 0
      setPageLanguageSwitchBlocking(false)
      return
    }
    translationRevealWindowUntilRef.current = Date.now() + 1800
    setPageLanguageSwitchBlocking(true)
  }, [])

  const changeUiLanguage = useCallback((next: UiLanguage) => {
    if (next === uiLanguage) {
      setLangMenuOpen(false)
      return
    }
    if (next === 'en') {
      void prefetchLanguageWarmup('en')
    }
    beginTranslationRevealBlock(next)
    setPendingLanguageSwitchTarget(next)
    setProblemLanguageSwitchBlocking(isOjProblemDetailPage && next === 'en')
    setUiLanguage(next)
    setLangMenuOpen(false)
  }, [beginTranslationRevealBlock, isOjProblemDetailPage, prefetchLanguageWarmup, uiLanguage])

  const handleTranslateBusyChange = useCallback((busy: boolean) => {
    translateBusyRef.current = busy
    if (busy && Date.now() < translationRevealWindowUntilRef.current) {
      setPageLanguageSwitchBlocking(true)
      if (isOjProblemDetailPage) {
        setProblemLanguageSwitchBlocking(true)
      }
    }
  }, [isOjProblemDetailPage])

  const handleTranslateSettled = useCallback((language: UiLanguage) => {
    setPendingLanguageSwitchTarget((prev) => (prev === language ? null : prev))
    if (language === 'en') {
      setPageLanguageSwitchBlocking(false)
      setProblemLanguageSwitchBlocking(false)
      return
    }
    setPageLanguageSwitchBlocking(false)
    setProblemLanguageSwitchBlocking(false)
  }, [])

  useEffect(() => {
    if (uiLanguage === 'en') {
      void prefetchLanguageWarmup('en')
    }
  }, [prefetchLanguageWarmup, uiLanguage])

  useEffect(() => {
    if (!langMenuOpen) return
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (langSwitchRef.current?.contains(target)) return
      setLangMenuOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLangMenuOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown, { passive: true })
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [langMenuOpen])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLangMenuOpen(false)
      if (uiLanguage !== 'en') {
        setPageLanguageSwitchBlocking(false)
        return
      }
      beginTranslationRevealBlock('en')
      if (isOjProblemDetailPage) {
        setProblemLanguageSwitchBlocking(true)
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [beginTranslationRevealBlock, isOjProblemDetailPage, location.pathname, uiLanguage])

  useEffect(() => {
    if (!isOjProblemDetailPage) {
      const timer = window.setTimeout(() => setProblemLanguageSwitchBlocking(false), 0)
      return () => window.clearTimeout(timer)
    }
  }, [isOjProblemDetailPage])

  useEffect(() => {
    if (location.pathname !== '/') {
      const timer = window.setTimeout(() => setHomeEnter(false), 0)
      return () => window.clearTimeout(timer)
    }
    if (homeEnteredRef.current) return
    homeEnteredRef.current = true
    window.setTimeout(() => setHomeEnter(true), 0)
    const timer = window.setTimeout(() => {
      setHomeEnter(false)
    }, 900)
    return () => window.clearTimeout(timer)
  }, [location.pathname])

  const setAuthModeSafe = useCallback((mode: AuthMode) => {
    setAuthMode(mode)
    setAuthError('')
    setAuthSuccess('')
  }, [])

  const openAuth = useCallback(
    (mode: AuthMode) => {
      setAuthModeSafe(mode)
      setAuthFrom(location.pathname || '/')
      navigate('/auth')
    },
    [location.pathname, navigate, setAuthModeSafe]
  )

  const loadCurrentUser = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) return
    const { response, data } = await fetchJson<UserResponse>('/api/me')
    if (!response.ok) {
      localStorage.removeItem(TOKEN_KEY)
      return
    }
    if (data?.user) {
      setCurrentUser(data.user)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCurrentUser()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadCurrentUser])

  useEffect(() => {
    let handled = false
    const handleAuthExpired = () => {
      if (handled) return
      handled = true
      setCurrentUser(null)
      navigate('/auth')
    }
    window.addEventListener('starstack:auth-expired', handleAuthExpired)
    return () => window.removeEventListener('starstack:auth-expired', handleAuthExpired)
  }, [navigate])

  // Poll unread message count via SSE with polling fallback
  const fetchUnreadCount = useCallback(async () => {
    if (!currentUser) return
    try {
      const { response, data } = await fetchJson<UnreadCountResponse>('/api/messages/unread-count')
      if (response.ok && data) {
        setUnreadMessageCount(data.unreadCount)
      }
    } catch {
      // Silently ignore fetch errors
    }
  }, [currentUser])

  useEffect(() => {
    if (!currentUser) {
      const timer = window.setTimeout(() => setUnreadMessageCount(0), 0)
      return () => window.clearTimeout(timer)
    }

    const token = localStorage.getItem(TOKEN_KEY)
    let es: EventSource | null = null
    let fallbackInterval: ReturnType<typeof setInterval> | null = null
    let pollingKickoffTimer: ReturnType<typeof setTimeout> | null = null
    const startSSE = () => {
      try {
        es = new EventSource(`/api/messages/unread-stream?token=${encodeURIComponent(token || '')}`)
        es.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data)
            if (typeof payload.unreadCount === 'number') {
              setUnreadMessageCount(payload.unreadCount)
            }
          } catch {
            return undefined
          }
        }
        es.onerror = () => {
          es?.close()
          es = null
          startPolling()
        }
      } catch {
        startPolling()
      }
    }

    const startPolling = () => {
      if (fallbackInterval) return
      pollingKickoffTimer = window.setTimeout(() => {
        void fetchUnreadCount()
      }, 0)
      fallbackInterval = setInterval(() => {
        if (!isPollingPageVisible()) return
        void fetchUnreadCount()
      }, 20000)
    }

    startSSE()

    return () => {
      if (pollingKickoffTimer) {
        clearTimeout(pollingKickoffTimer)
        pollingKickoffTimer = null
      }
      if (es) { es.close(); es = null }
      if (fallbackInterval) { clearInterval(fallbackInterval); fallbackInterval = null }
    }
  }, [currentUser, fetchUnreadCount])

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
        event.preventDefault()
        navigate('/oj/list')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [navigate])

  // Topbar offset CSS variable
  useEffect(() => {
    const topbar = topbarRef.current
    if (!topbar) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
        document.documentElement.style.setProperty('--topbar-offset', `${height}px`)
      }
    })
    observer.observe(topbar)
    return () => observer.disconnect()
  }, [])

  const handleAuthSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      setAuthError('')
      setAuthSuccess('')
      if (!formId.trim() || formPassword.length < 6) {
        setAuthError('密码至少 6 位')
        return
      }
      if (authMode === 'register') {
        if (!formName.trim()) {
          setAuthError('请填写名称')
          return
        }
        if (formPassword !== formConfirm) {
          setAuthError('两次密码不一致')
          return
        }
      }
      const payload: Record<string, string> = {
        id: formId.trim(),
        password: formPassword,
      }
      if (authMode === 'register') {
        payload.name = formName.trim()
      }
      const { response, data } = await fetchJson<AuthResponse>(`/api/${authMode}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      if (!response.ok || !data?.token || !data?.user) {
        setAuthError(data?.message || '登录失败')
        return
      }
      localStorage.setItem(TOKEN_KEY, data.token)
      setCurrentUser(data.user)
      setAuthSuccess('登录成功')
      navigate(authFrom || '/')
    },
    [authFrom, authMode, formConfirm, formId, formName, formPassword, navigate]
  )

  const handleLogout = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (token) {
      await fetchJson('/api/logout', { method: 'POST' }).catch(() => undefined)
    }
    localStorage.removeItem(TOKEN_KEY)
    setCurrentUser(null)
    setProblemPlan([])
    navigate('/')
  }, [navigate])

  const loadProblemPlan = useCallback(async () => {
    if (!currentUser) return
    const { response, data } = await fetchJson<{ plans: ProblemPlan[] }>('/api/problem-plan')
    if (response.ok) {
      setProblemPlan(data?.plans || [])
    }
  }, [currentUser])

  const addToPlan = useCallback(async (problemId: number) => {
    const { response, data } = await fetchJson<ApiResponse>('/api/problem-plan', {
      method: 'POST',
      body: JSON.stringify({ problemId })
    })
    if (response.ok) {
      await loadProblemPlan()
      return { success: true, message: data?.message }
    }
    return { success: false, message: data?.message || '添加失败' }
  }, [loadProblemPlan])

  const removeFromPlan = useCallback(async (planId: number) => {
    const { response, data } = await fetchJson<ApiResponse>(`/api/problem-plan/${planId}`, {
      method: 'DELETE'
    })
    if (response.ok) {
      await loadProblemPlan()
      return { success: true, message: data?.message }
    }
    return { success: false, message: data?.message || '移除失败' }
  }, [loadProblemPlan])

  const togglePlanComplete = useCallback(async (planId: number, completed: boolean) => {
    const { response, data } = await fetchJson<ApiResponse>(`/api/problem-plan/${planId}/complete`, {
      method: 'PUT',
      body: JSON.stringify({ completed })
    })
    if (response.ok) {
      await loadProblemPlan()
      return { success: true, message: data?.message }
    }
    return { success: false, message: data?.message || '更新失败' }
  }, [loadProblemPlan])

  useEffect(() => {
    if (currentUser) {
      const timer = window.setTimeout(() => {
        void loadProblemPlan()
      }, 0)
      return () => window.clearTimeout(timer)
    }
  }, [currentUser, loadProblemPlan])

  const openLogoutConfirm = useCallback(() => {
    setShowLogoutConfirm(true)
  }, [])

  const closeLogoutConfirm = useCallback(() => {
    setShowLogoutConfirm(false)
  }, [])

  const confirmLogout = useCallback(async () => {
    setShowLogoutConfirm(false)
    await handleLogout()
    setLogoutNotice('您已退出')
  }, [handleLogout])

  useEffect(() => {
    if (!logoutNotice) return
    const timer = window.setTimeout(() => setLogoutNotice(''), 2400)
    return () => window.clearTimeout(timer)
  }, [logoutNotice])

  const handleAuthBack = useCallback(() => {
    navigate(authFrom || '/')
  }, [authFrom, navigate])

  // Starfield canvas animation
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let animationId = 0
    let stars: { x: number; y: number; r: number; alpha: number; twinkle: number; vx: number; vy: number; color: string }[] = []
    let microStars: { x: number; y: number; r: number; alpha: number; twinkle: number }[] = []
    let nebulae: Array<{ x: number; y: number; r: number; color: string; alpha: number }> = []
    let bodies: Array<{ x: number; y: number; r: number; hue: number; alpha: number; ring: boolean }> = []
    let meteors: Array<{
      x: number
      y: number
      vx: number
      vy: number
      life: number
      maxLife: number
      size: number
    }> = []
    let width = 0
    let height = 0

    const createStars = () => {
      const density = 1800
      const count = Math.max(240, Math.floor((width * height) / density))
      const palette = ['255, 255, 255', '196, 220, 255', '255, 236, 210', '180, 255, 240', '255, 210, 240']
      stars = Array.from({ length: count }, () => {
        const bright = Math.random() > 0.9
        const color = palette[Math.floor(Math.random() * palette.length)]
        return {
          x: Math.random() * width, y: Math.random() * height,
          r: bright ? Math.random() * 2.1 + 0.9 : Math.random() * 1.35 + 0.3,
          alpha: bright ? Math.random() * 0.82 + 0.48 : Math.random() * 0.52 + 0.16,
          twinkle: (Math.random() * 0.02 + 0.004) * (Math.random() > 0.5 ? 1 : -1),
          vx: (Math.random() - 0.5) * 0.08, vy: (Math.random() - 0.5) * 0.06,
          color: bright ? color : '255, 255, 255',
        }
      })
      const microDensity = 560
      const microCount = Math.max(360, Math.floor((width * height) / microDensity))
      microStars = Array.from({ length: microCount }, () => ({
        x: Math.random() * width, y: Math.random() * height,
        r: Math.random() * 0.95 + 0.15, alpha: Math.random() * 0.45 + 0.14,
        twinkle: (Math.random() * 0.013 + 0.002) * (Math.random() > 0.5 ? 1 : -1),
      }))
      nebulae = Array.from({ length: 4 }, () => ({
        x: Math.random() * width,
        y: Math.random() * height * 0.72,
        r: Math.min(width, height) * (0.16 + Math.random() * 0.12),
        color: ['88, 160, 255', '170, 132, 255', '112, 228, 255', '255, 204, 128'][Math.floor(Math.random() * 4)],
        alpha: 0.09 + Math.random() * 0.07,
      }))
      bodies = Array.from({ length: 4 }, (_, index) => ({
        x: width * (0.18 + index * 0.32) + (Math.random() - 0.5) * width * 0.08,
        y: height * (0.18 + Math.random() * 0.28),
        r: Math.min(width, height) * (0.022 + Math.random() * 0.04),
        hue: [210, 28, 168, 46][index % 4],
        alpha: 0.22 + Math.random() * 0.14,
        ring: Math.random() > 0.5,
      }))
    }

    const resize = () => {
      const dpr = Math.max(window.devicePixelRatio || 1, 1)
      width = window.innerWidth; height = window.innerHeight
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`
      canvas.width = Math.floor(width * dpr); canvas.height = Math.floor(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      createStars()
    }

    const draw = () => {
      ctx.clearRect(0, 0, width, height)
      for (const nebula of nebulae) {
        const gradient = ctx.createRadialGradient(nebula.x, nebula.y, 0, nebula.x, nebula.y, nebula.r)
        gradient.addColorStop(0, `rgba(${nebula.color}, ${nebula.alpha})`)
        gradient.addColorStop(0.38, `rgba(${nebula.color}, ${nebula.alpha * 0.48})`)
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
        ctx.beginPath()
        ctx.fillStyle = gradient
        ctx.arc(nebula.x, nebula.y, nebula.r, 0, Math.PI * 2)
        ctx.fill()
      }
      for (const body of bodies) {
        const planet = ctx.createRadialGradient(
          body.x - body.r * 0.28,
          body.y - body.r * 0.28,
          body.r * 0.16,
          body.x,
          body.y,
          body.r
        )
        planet.addColorStop(0, `hsla(${body.hue} 90% 90% / ${body.alpha + 0.12})`)
        planet.addColorStop(0.42, `hsla(${body.hue} 72% 62% / ${body.alpha + 0.04})`)
        planet.addColorStop(1, 'rgba(0, 0, 0, 0)')
        ctx.beginPath()
        ctx.fillStyle = planet
        ctx.arc(body.x, body.y, body.r, 0, Math.PI * 2)
        ctx.fill()

        if (body.ring) {
          ctx.save()
          ctx.translate(body.x, body.y)
          ctx.rotate(-0.35)
          ctx.beginPath()
          ctx.strokeStyle = `hsla(${body.hue} 92% 84% / ${body.alpha * 0.78})`
          ctx.lineWidth = Math.max(1.4, body.r * 0.08)
          ctx.ellipse(0, 0, body.r * 1.52, body.r * 0.46, 0, 0, Math.PI * 2)
          ctx.stroke()
          ctx.restore()
        }
      }
      for (const star of microStars) {
        star.alpha += star.twinkle
        if (star.alpha <= 0.07 || star.alpha >= 0.62) star.twinkle *= -1
        ctx.beginPath()
        ctx.fillStyle = `rgba(255, 255, 255, ${star.alpha})`
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2)
        ctx.fill()
      }
      for (const star of stars) {
        star.alpha += star.twinkle
        if (star.alpha <= 0.14 || star.alpha >= 1) star.twinkle *= -1
        star.x += star.vx; star.y += star.vy
        if (star.x < 0) star.x = width; if (star.x > width) star.x = 0
        if (star.y < 0) star.y = height; if (star.y > height) star.y = 0
        ctx.beginPath()
        ctx.fillStyle = `rgba(${star.color}, ${star.alpha})`
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2)
        ctx.fill()
      }
      const spawnChance = prefersReduced ? 0.006 : 0.07
      const maxMeteors = prefersReduced ? 1 : 4
      if (meteors.length < maxMeteors && Math.random() < spawnChance) {
        const startX = Math.random() * width * 0.9 + width * 0.05
        const startY = Math.random() * height * 0.26
        meteors.push({
          x: startX,
          y: startY,
          vx: 10 + Math.random() * 8,
          vy: 4 + Math.random() * 4,
          life: 0,
          maxLife: 38 + Math.random() * 36,
          size: 1.2 + Math.random() * 1.8,
        })
      }

      meteors = meteors.filter((meteor) => {
        meteor.life += 1
        meteor.x += meteor.vx
        meteor.y += meteor.vy

        if (meteor.life > meteor.maxLife || meteor.x > width + 140 || meteor.y > height + 140) {
          return false
        }

        const tailX = meteor.x - meteor.vx * 4.8
        const tailY = meteor.y - meteor.vy * 4.8
        const opacity = Math.max(0.18, 1 - meteor.life / meteor.maxLife)
        const gradient = ctx.createLinearGradient(meteor.x, meteor.y, tailX, tailY)
        gradient.addColorStop(0, `rgba(255, 255, 255, ${0.95 * opacity})`)
        gradient.addColorStop(0.35, `rgba(180, 225, 255, ${0.6 * opacity})`)
        gradient.addColorStop(1, 'rgba(180, 225, 255, 0)')

        ctx.beginPath()
        ctx.strokeStyle = gradient
        ctx.lineWidth = meteor.size
        ctx.lineCap = 'round'
        ctx.moveTo(meteor.x, meteor.y)
        ctx.lineTo(tailX, tailY)
        ctx.stroke()

        ctx.beginPath()
        ctx.fillStyle = `rgba(255, 255, 255, ${0.9 * opacity})`
        ctx.arc(meteor.x, meteor.y, meteor.size * 0.9, 0, Math.PI * 2)
        ctx.fill()
        return true
      })
      animationId = requestAnimationFrame(draw)
    }

    resize()
    draw()

    if (prefersReduced) {
      cancelAnimationFrame(animationId)
      return undefined
    }

    window.addEventListener('resize', resize)
    return () => {
      cancelAnimationFrame(animationId)
      window.removeEventListener('resize', resize)
    }
  }, [])

  const appClassName = [
    'app',
    isOjDetailOrJudgePage ? 'sidebar-overlay' : '',
  ].filter(Boolean).join(' ')

  const initial = currentUser?.name?.trim()?.[0] || currentUser?.id?.[0] || '★'

  const uiLanguageEntries: Array<{ value: UiLanguage; label: string; menuLabel: string; flag: string }> = [
    { value: 'zh', label: '中文', menuLabel: '中文（简体）', flag: '🇨🇳' },
    { value: 'en', label: 'English', menuLabel: 'English', flag: '🇺🇸' },
  ]
  const currentUiLanguageEntry = uiLanguageEntries.find((item) => item.value === uiLanguage) ?? uiLanguageEntries[0]
  const showLanguageSwitchOverlay =
    uiLanguage === 'en' &&
    pageLanguageSwitchBlocking &&
    pendingLanguageSwitchTarget !== 'zh'

  const contextValue = {
    currentUser,
    setCurrentUser,
    uiLanguage,
    problemPlan,
    problemLanguageSwitchBlocking,
    openAuth,
    addToPlan,
    removeFromPlan,
    togglePlanComplete,
    loadProblemPlan,
    fetchUnreadCount,
  }

  return (
    <>
      <canvas ref={canvasRef} className="starfield" />
      <div ref={translateRootRef}>
        <AutoTranslateScope
          rootRef={translateRootRef}
          language={uiLanguage}
          onBusyChange={handleTranslateBusyChange}
          onSettled={handleTranslateSettled}
        />
      {isAuthPage ? (
        <div className="auth-shell">
          <main className="auth-main">
            <Routes>
              <Route
                path="/auth"
                element={
                  <AuthPage
                    mode={authMode}
                    onModeChange={setAuthModeSafe}
                    onBack={handleAuthBack}
                    onSubmit={handleAuthSubmit}
                    formId={formId}
                    formName={formName}
                    formPassword={formPassword}
                    formConfirm={formConfirm}
                    onFormIdChange={setFormId}
                    onFormNameChange={setFormName}
                    onFormPasswordChange={setFormPassword}
                    onFormConfirmChange={setFormConfirm}
                    error={authError}
                    success={authSuccess}
                  />
                }
              />
              <Route path="*" element={<Navigate to="/auth" replace />} />
            </Routes>
          </main>
        </div>
      ) : (
        <AppContext.Provider value={contextValue}>
        <div className={appClassName} ref={appRef}>
          <header className="topbar" ref={topbarRef}>
            <div className="topbar-left" data-no-auto-translate>
              <div className="topbar-title">星栈</div>
              <div className="topbar-badge">STARSTACK</div>
            </div>
            <div className="topbar-actions">
              <div className={`lang-switch ${langMenuOpen ? 'open' : ''}`} ref={langSwitchRef} data-no-auto-translate>
                <button
                  type="button"
                  className="lang-switch-trigger"
                  aria-haspopup="menu"
                  aria-expanded={langMenuOpen}
                  title="切换语言 / Switch language"
                  onClick={() => setLangMenuOpen((prev) => !prev)}
                >
                  <span className="lang-switch-flag" aria-hidden="true">{currentUiLanguageEntry.flag}</span>
                  <span className="lang-switch-current">{currentUiLanguageEntry.label}</span>
                  <svg className="lang-switch-chevron" viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M5.5 7.5 10 12l4.5-4.5" />
                  </svg>
                </button>
                {langMenuOpen && (
                  <div className="lang-switch-menu" role="menu" aria-label="Language menu">
                    {uiLanguageEntries.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        role="menuitemradio"
                        aria-checked={uiLanguage === item.value}
                        className={`lang-switch-item ${uiLanguage === item.value ? 'active' : ''}`}
                        onClick={() => changeUiLanguage(item.value)}
                      >
                        <span className="lang-switch-flag" aria-hidden="true">{item.flag}</span>
                        <span className="lang-switch-item-label">{item.menuLabel}</span>
                        {uiLanguage === item.value && <span className="lang-switch-check" aria-hidden="true">{item.flag}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {logoutNotice && (
                <div className="logout-notice" role="status">{logoutNotice}</div>
              )}
              {currentUser ? (
                <>
                  <button
                    className="topbar-message-btn"
                    onClick={() => navigate('/messages')}
                    title={unreadMessageCount > 0 ? `${unreadMessageCount} 条未读消息` : '私信'}
                  >
                    <svg viewBox="0 0 24 24" width="20" height="20">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                      <polyline points="22,6 12,13 2,6" />
                    </svg>
                    {unreadMessageCount > 0 && <span className="topbar-message-dot" />}
                  </button>
                  <UserMenu currentUser={currentUser} initial={initial} navigate={navigate} location={location} openLogoutConfirm={openLogoutConfirm} />
                </>
              ) : (
                <button className="primary" onClick={() => openAuth('login')}>登录</button>
              )}
            </div>
          </header>

          <div className="app-body">
            <aside className="sidebar">
              <nav className="nav">
                <button className={`nav-link ${location.pathname === '/' ? 'active' : ''}`} onClick={() => navigate('/')}>
                  <span className="nav-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10.8V20h5v-5h3v5h5v-9.2" /></svg>
                  </span>
                  <span className="nav-label">首页</span>
                </button>
                <button className={`nav-link ${location.pathname.startsWith('/oj') ? 'active' : ''}`} onClick={() => navigate('/oj')}>
                  <span className="nav-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M7.5 7 3.5 12l4 5" /><path d="M16.5 7 20.5 12l-4 5" /><path d="M10 17l4-10" /></svg>
                  </span>
                  <span className="nav-label">算法测评</span>
                </button>
                <button className={`nav-link ${location.pathname.startsWith('/leaderboard') ? 'active' : ''}`} onClick={() => navigate('/leaderboard')}>
                  <span className="nav-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M8 20V10h3v10H8Z" /><path d="M14.5 20V4h3v16h-3Z" /><path d="M2 20v-6h3v6H2Z" /></svg>
                  </span>
                  <span className="nav-label">排行榜</span>
                </button>
                <button className={`nav-link ${location.pathname.startsWith('/discussions') ? 'active' : ''}`} onClick={() => navigate('/discussions')}>
                  <span className="nav-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
                  </span>
                  <span className="nav-label">讨论</span>
                </button>
                <button className={`nav-link ${location.pathname.startsWith('/starbot') ? 'active' : ''}`} onClick={() => navigate('/starbot')}>
                  <span className="nav-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><rect x="6" y="8" width="12" height="9" rx="2" /><circle cx="10" cy="12.5" r="1" /><circle cx="14" cy="12.5" r="1" /><path d="M12 8V5" /><path d="M9 5h6" /></svg>
                  </span>
                  <span className="nav-label">StarBot</span>
                </button>
                {currentUser?.isAdmin && (
                  <button className={`nav-link ${location.pathname.startsWith('/admin') ? 'active' : ''}`} onClick={() => navigate('/admin')}>
                    <span className="nav-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24"><path d="M12 3 20 7v6c0 4.4-3.2 7.8-8 8-4.8-.2-8-3.6-8-8V7l8-4Z" /><path d="M8.5 15.5c.7-1.6 2.1-2.5 3.5-2.5s2.8.9 3.5 2.5" /><circle cx="12" cy="10" r="2.4" /></svg>
                    </span>
                    <span className="nav-label">后台</span>
                  </button>
                )}
              </nav>
              <div className="sidebar-footer">
                <span className="status-dot" />
                <span className="sidebar-footer-text">深空网络已连接</span>
              </div>
            </aside>

            <div className="content">
              <main className={`main ${location.pathname === '/' ? 'home' : ''} ${homeEnter ? 'home-enter' : ''}`}>
                {showLanguageSwitchOverlay && (
                  <div className="language-switch-overlay" role="status" aria-live="polite" data-no-auto-translate>
                    <div className="language-switch-overlay-card">
                      <span className="language-switch-spinner" aria-hidden="true" />
                      <span>{isOjProblemDetailPage && problemLanguageSwitchBlocking ? '正在切换语言并预加载题目内容...' : '正在切换语言并预加载页面内容...'}</span>
                    </div>
                  </div>
                )}
                <Suspense fallback={<div className="oj-loading">加载中...</div>}>
                <Routes>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/starbot" element={<StarBotPageView />} />
                  <Route path="/starbot/get-started" element={<StarBotGettingStartedView />} />
                  <Route path="/account" element={<AccountPage />} />
                  <Route path="/leaderboard" element={<LeaderboardPage />} />
                  <Route path="/discussions" element={<DiscussionListPage />} />
                  <Route path="/discussions/create" element={<DiscussionCreatePage />} />
                  <Route path="/discussions/:id/edit" element={<DiscussionEditPage />} />
                  <Route path="/discussions/:id" element={<DiscussionDetailPage />} />
                  <Route path="/messages" element={<MessageListPage />} />
                  <Route path="/messages/:userId" element={<ChatPage />} />
                  <Route path="/my-problems" element={<MyProblemsPage />} />
                  <Route path="/create-problem" element={<CreateProblemPage />} />
                  <Route path="/edit-problem/:id" element={<EditProblemPage />} />
                  <Route path="/admin" element={<AdminPage />} />
                  <Route path="/oj" element={<OjHomePage />} />
                  <Route path="/oj/list" element={<OjProblemListPage />} />
                  <Route path="/oj/judge" element={<OjJudgePage />} />
                  <Route path="/oj/judge/:id" element={<OjJudgePage />} />
                  <Route path="/oj/records/:id" element={<OjProblemRecordsPage />} />
                  <Route path="/oj/submissions" element={<OjSubmissionsPage />} />
                  <Route path="/oj/*" element={<OjDetailPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
                </Suspense>
              </main>
            </div>
          </div>
          {showLogoutConfirm && (
            <div className="confirm-backdrop" role="dialog" aria-modal="true" onClick={closeLogoutConfirm}>
              <div className="confirm-panel" onClick={(event) => event.stopPropagation()}>
                <div className="confirm-title">确认退出账号？</div>
                <div className="confirm-desc">退出后需要重新登录才能继续使用。</div>
                <div className="confirm-actions">
                  <button className="ghost" type="button" onClick={closeLogoutConfirm}>
                    取消
                  </button>
                  <button className="primary" type="button" onClick={confirmLogout}>
                    确认退出
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        </AppContext.Provider>
      )}
      </div>
    </>
  )
}

export default App
