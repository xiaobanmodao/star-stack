import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import './App.css'
import './styles/theme-light.css'
import './styles/topbar.css'
import './styles/shared.css'
import { AppContext } from './context/AppContext'
import { OJ_ENABLED, TOKEN_KEY } from './constants'
import FloatingChat from './components/chat/FloatingChat'
import NotificationBell from './components/NotificationBell'
import OnboardingModal from './components/OnboardingModal'
import SearchOverlay from './components/SearchOverlay'
import ThemeToggle from './components/ThemeToggle'
import UserMenu from './components/UserMenu'
import LoadingState from './components/ui/LoadingState'
import { useToast } from './components/ui/ToastContext'
import AuthPage from './pages/AuthPage'
import { useStarfield } from './hooks/useStarfield'
import { useModalFocus } from './hooks/useModalFocus'
import { fetchJson, isPollingPageVisible } from './utils'
import type {
  UserRecord, ProblemPlan, AuthMode,
  UserResponse, AuthResponse, UnreadCountResponse, ApiResponse,
} from './types'

// Lazy page imports
const HomePage = lazy(() => import('./pages/HomePage'))
const MyProblemsPage = lazy(() => import('./pages/MyProblemsPage'))
const CreateProblemPage = lazy(() => import('./pages/CreateProblemPage'))
const EditProblemPage = lazy(() => import('./pages/EditProblemPage'))
const AccountPage = lazy(() => import('./pages/AccountPage'))
const ProfileEditPage = lazy(() => import('./pages/ProfileEditPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const OjHomePage = lazy(() => import('./pages/OjHomePage'))
const OjProblemListPage = lazy(() => import('./pages/OjProblemListPage'))
const OjDetailPage = lazy(() => import('./pages/OjDetailPage'))
const OjSolutionsPage = lazy(() => import('./pages/OjSolutionsPage'))
const OjSolutionEditPage = lazy(() => import('./pages/OjSolutionEditPage'))
const OjJudgePage = lazy(() => import('./pages/OjJudgePage'))
const OjProblemRecordsPage = lazy(() => import('./pages/OjProblemRecordsPage'))
const OjSubmissionsPage = lazy(() => import('./pages/OjSubmissionsPage'))
const OjLayout = lazy(() => import('./components/OjLayout'))
const MessageListPage = lazy(() => import('./pages/MessageListPage'))
const ChatPage = lazy(() => import('./pages/ChatPage'))
const ChatHubPage = lazy(() => import('./pages/chat/ChatHubPage'))
const ChannelPane = lazy(() => import('./pages/chat/ChannelPane'))
const RoomPane = lazy(() => import('./pages/chat/RoomPane'))
const PlazaPane = lazy(() => import('./pages/chat/PlazaPane'))
const FriendsPane = lazy(() => import('./pages/chat/FriendsPane'))
const RoomsGallery = lazy(() => import('./pages/chat/RoomsGallery'))
const JoinRoomPane = lazy(() => import('./pages/chat/JoinRoomPane'))
const ActivityPane = lazy(() => import('./pages/chat/ActivityPane'))
const UserProfilePage = lazy(() => import('./pages/UserProfilePage'))
const DiscussionDetailPage = lazy(() => import('./pages/DiscussionDetailPage'))
const DiscussionEditPage = lazy(() => import('./pages/DiscussionEditPage'))

/** 旧讨论地址（/discussions/:id[ /edit]）→ 聊天中心帖子面板 */
const LegacyDiscussionRedirect = ({ to }: { to: string }) => {
  const { id } = useParams()
  return <Navigate to={`/chat/${to.replace(':id', id || '')}`} replace />
}

function App() {
  const appRef = useRef<HTMLDivElement | null>(null)
  const topbarRef = useRef<HTMLElement | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const { showToast } = useToast()
  const isAuthPage = location.pathname === '/auth'
  const isOjDetailOrJudgePage = location.pathname.match(/^\/oj\/(p\d+|judge)/)
  const [homeEnter, setHomeEnter] = useState(false)
  const homeEnteredRef = useRef(false)
  const [lowPerformanceMode, setLowPerformanceMode] = useState(false)
  const routeSignature = `${location.pathname}${location.search}${location.hash}`
  const previousRouteSignatureRef = useRef(routeSignature)
  const [routeSwitching, setRouteSwitching] = useState(false)

  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [authSubmitting, setAuthSubmitting] = useState(false)
  const [authError, setAuthError] = useState('')
  const [authSuccess, setAuthSuccess] = useState('')
  const [authCaptchaRequired, setAuthCaptchaRequired] = useState(false)
  const [authCaptchaToken, setAuthCaptchaToken] = useState('')
  const [authCaptchaResetKey, setAuthCaptchaResetKey] = useState(0)
  const [authEmailSending, setAuthEmailSending] = useState(false)
  const [authEmailCooldown, setAuthEmailCooldown] = useState(0)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [currentUser, setCurrentUser] = useState<UserRecord | null>(null)
  const [authFrom, setAuthFrom] = useState('/')
  const authExpiredFromRef = useRef('')

  const [problemPlan, setProblemPlan] = useState<ProblemPlan[]>([])
  const [unreadMessageCount, setUnreadMessageCount] = useState(0)

  const [formId, setFormId] = useState('')
  const [formName, setFormName] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formEmailCode, setFormEmailCode] = useState('')
  const [formPassword, setFormPassword] = useState('')
  const [formConfirm, setFormConfirm] = useState('')

  useEffect(() => {
    document.documentElement.lang = 'zh-CN'
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const runtimeNavigator = navigator as Navigator & {
      connection?: { saveData?: boolean }
      deviceMemory?: number
    }
    const connection = runtimeNavigator.connection
    const evaluate = () => {
      const lowMemory = typeof runtimeNavigator.deviceMemory === 'number' && runtimeNavigator.deviceMemory <= 4
      const lowCpu = typeof runtimeNavigator.hardwareConcurrency === 'number' && runtimeNavigator.hardwareConcurrency <= 4
      const saveData = Boolean(connection?.saveData)
      setLowPerformanceMode(media.matches || lowMemory || lowCpu || saveData)
    }

    evaluate()
    media.addEventListener?.('change', evaluate)
    return () => {
      media.removeEventListener?.('change', evaluate)
    }
  }, [])

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

  useEffect(() => {
    if (previousRouteSignatureRef.current === routeSignature) return
    previousRouteSignatureRef.current = routeSignature
    setRouteSwitching(true)
    const timer = window.setTimeout(() => setRouteSwitching(false), 360)
    return () => window.clearTimeout(timer)
  }, [routeSignature])

  useEffect(() => {
    if (authEmailCooldown <= 0) return
    const timer = window.setInterval(() => {
      setAuthEmailCooldown((value) => Math.max(0, value - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [authEmailCooldown])

  const setAuthModeSafe = useCallback((mode: AuthMode) => {
    setAuthMode(mode)
    setAuthError('')
    setAuthSuccess('')
    setAuthCaptchaRequired(false)
    setAuthCaptchaToken('')
    setAuthCaptchaResetKey((value) => value + 1)
    setAuthEmailSending(false)
    setAuthEmailCooldown(0)
    setFormEmailCode('')
  }, [])

  const openAuth = useCallback(
    (mode: AuthMode) => {
      setAuthModeSafe(mode)
      setAuthFrom(`${location.pathname}${location.search}${location.hash}` || '/')
      navigate('/auth')
    },
    [location.hash, location.pathname, location.search, navigate, setAuthModeSafe]
  )

  const loadCurrentUser = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) return
    try {
      const { response, data } = await fetchJson<UserResponse>('/api/me')
      if (!response.ok) {
        localStorage.removeItem(TOKEN_KEY)
        return
      }
      if (data?.user) {
        setCurrentUser(data.user)
      }
    } catch {
      // 启动阶段的网络异常不应造成未处理 Promise；用户进入页面后可再次触发请求。
      return
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCurrentUser()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadCurrentUser])

  useEffect(() => {
    const handleAuthExpired = (event: Event) => {
      const detail = (event as CustomEvent<{ from?: string }>).detail
      const currentPath = `${location.pathname}${location.search}${location.hash}` || '/'
      const requestedFrom = detail?.from || currentPath
      const from = requestedFrom === '/auth' ? '/' : requestedFrom
      if (authExpiredFromRef.current === from && location.pathname === '/auth') return
      authExpiredFromRef.current = from
      setCurrentUser(null)
      setProblemPlan([])
      setAuthModeSafe('login')
      setAuthFrom(from)
      showToast('登录状态已失效，请重新登录', 'warning')
      if (location.pathname !== '/auth') navigate('/auth', { replace: true })
    }
    window.addEventListener('starstack:auth-expired', handleAuthExpired)
    return () => window.removeEventListener('starstack:auth-expired', handleAuthExpired)
  }, [location.hash, location.pathname, location.search, navigate, setAuthModeSafe, showToast])

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

    const pollingKickoffTimer = window.setTimeout(() => {
      void fetchUnreadCount()
    }, 0)
    const pollingInterval = setInterval(() => {
      if (!isPollingPageVisible()) return
      void fetchUnreadCount()
    }, 20000)

    return () => {
      clearTimeout(pollingKickoffTimer)
      clearInterval(pollingInterval)
    }
  }, [currentUser, fetchUnreadCount])

  // 新手引导：首次登录后弹出
  useEffect(() => {
    if (!currentUser || currentUser.onboarded) return
    const timer = window.setTimeout(() => setShowOnboarding(true), 800)
    return () => window.clearTimeout(timer)
  }, [currentUser])

  const handleOnboardingClose = useCallback(async () => {
    setShowOnboarding(false)
    if (!currentUser || currentUser.onboarded) return
    const { response } = await fetchJson('/api/me/onboarded', { method: 'POST' })
    if (response.ok) {
      setCurrentUser({ ...currentUser, onboarded: true })
    }
  }, [currentUser, setCurrentUser])

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Topbar offset CSS variable
  useEffect(() => {
    const topbar = topbarRef.current
    if (!topbar) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
        const offset = `${height}px`
        document.documentElement.style.setProperty('--topbar-offset', offset)
        appRef.current?.style.setProperty('--topbar-offset', offset)
      }
    })
    observer.observe(topbar)
    return () => observer.disconnect()
  }, [])

  const handleAuthSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      if (authSubmitting) return
      setAuthError('')
      setAuthSuccess('')
      if (!formId.trim() || formPassword.length < 6) {
        setAuthError('密码至少 6 位')
        return
      }
      if (authMode === 'register') {
        if (!formEmail.trim()) {
          setAuthError('请填写邮箱')
          return
        }
        if (!formEmailCode.trim()) {
          setAuthError('请填写邮箱验证码')
          return
        }
        if (!formName.trim()) {
          setAuthError('请填写名称')
          return
        }
        if (formPassword !== formConfirm) {
          setAuthError('两次密码不一致')
          return
        }
      }
      if (authCaptchaRequired && !authCaptchaToken) {
        setAuthError('请先完成安全验证')
        return
      }
      const payload: Record<string, string> = {
        id: formId.trim(),
        password: formPassword,
      }
      if (authMode === 'register') {
        payload.name = formName.trim()
        payload.email = formEmail.trim()
        payload.emailCode = formEmailCode.trim()
      }
      if (authCaptchaToken) payload.turnstileToken = authCaptchaToken
      setAuthSubmitting(true)
      try {
        const { response, data } = await fetchJson<AuthResponse>(`/api/${authMode}`, {
          method: 'POST',
          body: JSON.stringify(payload),
          skipAuthExpiry: true,
        })
        if (!response.ok || !data?.token || !data?.user) {
          if (authCaptchaToken) {
            setAuthCaptchaToken('')
            setAuthCaptchaResetKey((value) => value + 1)
          }
          setAuthCaptchaRequired(Boolean(data?.captchaRequired))
          setAuthError(data?.message || (authMode === 'register' ? '注册失败' : '登录失败'))
          return
        }
        localStorage.setItem(TOKEN_KEY, data.token)
        setCurrentUser(data.user)
        setAuthSuccess(authMode === 'register' ? '注册成功' : '登录成功')
        showToast(authMode === 'register' ? '账号创建成功' : '欢迎回来', 'success')
        navigate(authFrom || '/')
      } catch {
        setAuthError('网络连接失败，请稍后重试')
        showToast('网络连接失败，请稍后重试', 'error')
      } finally {
        setAuthSubmitting(false)
      }
    },
    [authCaptchaRequired, authCaptchaToken, authFrom, authMode, authSubmitting, formConfirm, formEmail, formEmailCode, formId, formName, formPassword, navigate, showToast]
  )

  const handleSendEmailCode = useCallback(async () => {
    if (authEmailSending || authEmailCooldown > 0) return
    setAuthError('')
    setAuthSuccess('')
    const email = formEmail.trim()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAuthError('请输入有效的邮箱地址')
      return
    }
    setAuthEmailSending(true)
    try {
      const { response, data } = await fetchJson<ApiResponse<{ retryAfter?: number }>>('/api/register/email-code', {
        method: 'POST',
        body: JSON.stringify({ email }),
        skipAuthExpiry: true,
      })
      if (!response.ok) {
        setAuthError(data?.message || '验证码发送失败')
        if (response.status === 429 && data?.retryAfter) setAuthEmailCooldown(data.retryAfter)
        return
      }
      setAuthEmailCooldown(60)
      setAuthSuccess('验证码已发送，请检查邮箱')
      showToast('验证码已发送，请检查邮箱', 'success')
    } catch {
      setAuthError('网络连接失败，请稍后重试')
      showToast('网络连接失败，请稍后重试', 'error')
    } finally {
      setAuthEmailSending(false)
    }
  }, [authEmailCooldown, authEmailSending, formEmail, showToast])

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

  const logoutDialogRef = useModalFocus(showLogoutConfirm, closeLogoutConfirm)

  const confirmLogout = useCallback(async () => {
    setShowLogoutConfirm(false)
    await handleLogout()
    showToast('您已退出登录', 'success')
  }, [handleLogout, showToast])

  const handleAuthBack = useCallback(() => {
    navigate(authFrom || '/')
  }, [authFrom, navigate])

  const canvasRef = useStarfield(lowPerformanceMode)

  const appClassName = [
    'app',
    lowPerformanceMode ? 'low-performance-mode' : '',
    isOjDetailOrJudgePage ? 'sidebar-overlay' : '',
  ].filter(Boolean).join(' ')

  const initial = currentUser?.name?.trim()?.[0] || currentUser?.id?.[0] || '★'

  const contextValue = {
    currentUser,
    setCurrentUser,
    problemPlan,
    openAuth,
    addToPlan,
    removeFromPlan,
    togglePlanComplete,
    loadProblemPlan,
    fetchUnreadCount,
  }

  return (
    <>
      <canvas ref={canvasRef} className={`starfield ${isAuthPage ? 'auth-starfield' : ''}`} aria-hidden="true" />
      {!isAuthPage && (
        <div
          className={`route-loading-bar ${routeSwitching ? 'active' : ''}`}
          role={routeSwitching ? 'progressbar' : undefined}
          aria-label={routeSwitching ? '页面加载中' : undefined}
          aria-hidden={!routeSwitching}
        />
      )}
      {isAuthPage ? (
        <div className="auth-shell quiet-auth">
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
                    formEmail={formEmail}
                    formEmailCode={formEmailCode}
                    formPassword={formPassword}
                    formConfirm={formConfirm}
                    onFormIdChange={setFormId}
                    onFormNameChange={setFormName}
                    onFormEmailChange={setFormEmail}
                    onFormEmailCodeChange={setFormEmailCode}
                    onFormPasswordChange={setFormPassword}
                    onFormConfirmChange={setFormConfirm}
                    onSendEmailCode={handleSendEmailCode}
                    error={authError}
                    success={authSuccess}
                    submitting={authSubmitting}
                    emailSending={authEmailSending}
                    emailCooldown={authEmailCooldown}
                    captchaRequired={authCaptchaRequired}
                    captchaResetKey={authCaptchaResetKey}
                    onCaptchaTokenChange={setAuthCaptchaToken}
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
            <div className="topbar-left">
              <div className="topbar-title">
                {location.pathname.startsWith('/oj') ? (
                  <span className="topbar-title-art" aria-label="星栈在线评测">
                    <span className="tt-accent">星栈</span>
                    <span className="tt-rest">在线评测</span>
                  </span>
                ) : (
                  '星栈'
                )}
              </div>
              <div className="topbar-badge">STARSTACK</div>
            </div>
            <div className="topbar-actions">
              <button
                className="topbar-message-btn"
                onClick={() => navigate('/chat/plaza')}
                title="聊天广场"
                aria-label="聊天广场"
              >
                <svg viewBox="0 0 24 24" width="20" height="20">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
              </button>
              <button
                className="topbar-message-btn"
                onClick={() => setSearchOpen(true)}
                title="搜索 (Ctrl+K)"
                aria-label="搜索"
              >
                <svg viewBox="0 0 24 24" width="20" height="20">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
              </button>
              <ThemeToggle />
              {currentUser ? (
                <>
                  <NotificationBell />
                  <button
                    className="topbar-message-btn"
                    onClick={() => navigate('/messages')}
                    title={unreadMessageCount > 0 ? `${unreadMessageCount} 条未读消息` : '私信'}
                    aria-label={unreadMessageCount > 0 ? `私信，${unreadMessageCount} 条未读消息` : '私信'}
                  >
                    <svg viewBox="0 0 24 24" width="20" height="20">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                      <polyline points="22,6 12,13 2,6" />
                    </svg>
                    {unreadMessageCount > 0 && <span className="topbar-message-dot" />}
                  </button>
                  <UserMenu currentUser={currentUser} initial={initial} openLogoutConfirm={openLogoutConfirm} />
                </>
              ) : (
                <button className="primary" onClick={() => openAuth('login')}>登录</button>
              )}
            </div>
          </header>

          <div className="app-body">
            <div className="content">
              <main
                className={`main ${location.pathname === '/' ? 'home' : ''} ${homeEnter ? 'home-enter' : ''} ${routeSwitching ? 'route-switching' : ''}`}
                aria-busy={routeSwitching || undefined}
              >
                <Suspense fallback={<LoadingState label="正在打开页面…" />}>
                <Routes>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/account" element={<AccountPage />} />
                  <Route path="/account/edit" element={<ProfileEditPage />} />
                  <Route path="/user/:userId" element={<UserProfilePage />} />
                  {/* 排行榜功能已屏蔽 */}
                  <Route path="/leaderboard" element={<Navigate to="/" replace />} />
                  {/* 旧讨论页已合并进聊天中心，旧地址重定向 */}
                  <Route path="/discussions" element={<Navigate to="/chat/plaza" replace />} />
                  <Route path="/discussions/create" element={<Navigate to="/chat/plaza?create=1" replace />} />
                  <Route
                    path="/discussions/:id"
                    element={<LegacyDiscussionRedirect to="p" />}
                  />
                  <Route
                    path="/discussions/:id/edit"
                    element={<LegacyDiscussionRedirect to="p/:id/edit" />}
                  />
                  <Route path="/messages" element={<MessageListPage />} />
                  <Route path="/messages/:userId" element={<ChatPage />} />
                  <Route path="/chat" element={<ChatHubPage />}>
                    <Route index element={<Navigate to="/chat/plaza" replace />} />
                    <Route path="plaza" element={<PlazaPane />} />
                    <Route path="c/:key" element={<ChannelPane />} />
                    <Route path="room/:id" element={<RoomPane />} />
                    <Route path="join/:token" element={<JoinRoomPane />} />
                    <Route path="rooms" element={<RoomsGallery />} />
                    <Route path="p/:id/edit" element={<DiscussionEditPage />} />
                    <Route path="p/:id" element={<DiscussionDetailPage />} />
                    <Route path="friends" element={<FriendsPane />} />
                    <Route path="activity" element={<ActivityPane />} />
                    <Route path="dm" element={<MessageListPage basePath="/chat/dm" />} />
                    <Route path="dm/:userId" element={<ChatPage basePath="/chat/dm" />} />
                  </Route>
                  <Route path="/my-problems" element={<MyProblemsPage />} />
                  <Route path="/create-problem" element={<CreateProblemPage />} />
                  <Route path="/edit-problem/:id" element={<EditProblemPage />} />
                  <Route path="/admin" element={<AdminPage />} />
                  {OJ_ENABLED && (
                    <>
                      <Route path="/oj" element={<OjLayout />}>
                        <Route index element={<OjHomePage />} />
                        <Route path="list" element={<OjProblemListPage />} />
                        <Route path="judge" element={<OjJudgePage />} />
                        <Route path="judge/:id" element={<OjJudgePage />} />
                        <Route path="records/:id" element={<OjProblemRecordsPage />} />
                        <Route path="submissions" element={<OjSubmissionsPage />} />
                        <Route path="solutions/:id/new" element={<OjSolutionEditPage />} />
                        <Route path="solutions/:id" element={<OjSolutionsPage />} />
                        <Route path="*" element={<OjDetailPage />} />
                      </Route>
                    </>
                  )}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
                </Suspense>
              </main>
            </div>
          </div>
          <nav className="mobile-tabbar" aria-label="移动端导航">
            <button className={location.pathname === '/' ? 'active' : ''} type="button" aria-current={location.pathname === '/' ? 'page' : undefined} onClick={() => navigate('/')}>
              <span className="mobile-tabbar-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10.8V20h5v-5h3v5h5v-9.2" /></svg>
              </span>
              首页
            </button>
            {OJ_ENABLED && (
              <button className={location.pathname.startsWith('/oj') ? 'active' : ''} type="button" aria-current={location.pathname.startsWith('/oj') ? 'page' : undefined} onClick={() => navigate('/oj/list')}>
                <span className="mobile-tabbar-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M7.5 7 3.5 12l4 5" /><path d="M16.5 7 20.5 12l-4 5" /><path d="M10 17l4-10" /></svg>
                </span>
                题库
              </button>
            )}
            <button className={location.pathname.startsWith('/chat') ? 'active' : ''} type="button" aria-current={location.pathname.startsWith('/chat') ? 'page' : undefined} onClick={() => navigate('/chat')}>
              <span className="mobile-tabbar-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
              </span>
              聊天
            </button>
          </nav>
          {showLogoutConfirm && (
            <div className="confirm-backdrop" role="dialog" aria-modal="true" aria-labelledby="logout-dialog-title" onClick={closeLogoutConfirm}>
              <div ref={logoutDialogRef} className="confirm-panel" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
                <div id="logout-dialog-title" className="confirm-title">确认退出账号？</div>
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
        <FloatingChat />
        <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
        {showOnboarding && currentUser && !currentUser.onboarded && (
          <OnboardingModal onClose={() => void handleOnboardingClose()} />
        )}
        </AppContext.Provider>
      )}
    </>
  )
}

export default App
