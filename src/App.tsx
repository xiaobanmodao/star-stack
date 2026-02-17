import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import Editor from '@monaco-editor/react'
import katex from 'katex'
import './App.css'
import 'katex/dist/katex.min.css'

type UserRecord = {
  id: string
  name: string
  avatar?: string
  isAdmin?: boolean
  isBanned?: boolean
  createdAt?: string
}

type OjProblemSummary = {
  id: number
  slug?: string
  title: string
  difficulty: string
  tags: string[]
  createdAt?: string
}

type OjProblemDetail = OjProblemSummary & {
  statement: string
  input: string
  output: string
  dataRange?: string
  samples: { input: string; output: string }[]
  creatorId?: string
  creatorName?: string
  maxScore?: number | null
}

type OjSubmission = {
  id: number
  problemId: number
  problemTitle?: string
  userId?: string
  userName?: string
  language: string
  status: string
  timeMs?: number
  memoryKb?: number
  message?: string
  code?: string | null
  canViewCode?: boolean
  results?: { index: number; status: string; message?: string; timeMs?: number }[]
  score?: number
  createdAt?: string
}

type DifficultyStats = {
  solved: number
  tried: number
}

type ProfileStats = {
  stats: {
    totalSolved?: number
    totalTried?: number
    totalSubmissions?: number
    rank?: number
    acceptedCount?: number
    solvedProblems?: number
    acceptanceRate?: number
    currentStreak?: number
    maxStreak?: number
  }
  difficultyStats: Record<string, DifficultyStats>
}

type HeatmapData = {
  date: string
  count: number
  accepted?: number
}

type Achievement = {
  id: string
  name: string
  description: string
  icon: string
  unlockedAt?: string
}

type ProblemPlan = {
  id: number
  problemId: number
  problem_id: number
  title: string
  difficulty: string
  addedAt: string
  completed?: boolean
}

type LeaderboardEntry = {
  userId: string
  userName: string
  avatar?: string
  rating?: number
  solvedCount?: number
  solvedProblems?: number
  totalSubmissions?: number
  acceptanceRate?: number
  rank: number
  value: number
  rankChange: number | null
  previousRank?: number | null
}

// API Response Types
type ApiResponse<T = unknown> = {
  message?: string
  [key: string]: unknown
} & T

type AuthResponse = {
  token: string
  user: UserRecord
  message?: string
}

type UserResponse = {
  user: UserRecord
  message?: string
}

type ProblemsResponse = {
  problems: OjProblemSummary[]
  total: number
  message?: string
}

type ProblemResponse = {
  problem: OjProblemDetail
  message?: string
}

type SubmissionsResponse = {
  submissions: OjSubmission[]
  total: number
  message?: string
}

type SubmissionResponse = {
  submission: OjSubmission
  message?: string
}

type StatsResponse = {
  problemCount: number
  userCount: number
  todaySubmissions: number
  message?: string
}

type ProfileStatsResponse = ProfileStats & {
  message?: string
}

type HeatmapResponse = HeatmapData[]

type AchievementsResponse = Achievement[]

type LeaderboardResponse = LeaderboardEntry[]

type DiscussionPost = {
  id: number; userId: string; userName: string; userAvatar?: string
  title: string; content?: string
  problemId?: number; problemTitle?: string
  viewCount: number; likeCount: number; commentCount: number
  liked?: boolean; createdAt: string; updatedAt: string
}

type DiscussionComment = {
  id: number; postId: number; userId: string; userName: string; userAvatar?: string
  content: string; parentId?: number; likeCount: number; liked?: boolean
  createdAt: string; replies?: DiscussionComment[]; replyToName?: string
}

type DiscussionListResponse = {
  posts: DiscussionPost[]; total: number; page: number; pageSize: number
}

type DiscussionDetailResponse = {
  post: DiscussionPost; comments: DiscussionComment[]
}

type Message = {
  id: number
  senderId: string
  senderName: string
  senderAvatar?: string
  content: string
  isRead: boolean
  createdAt: string
}

type Conversation = {
  conversationId: number
  otherUser: {
    id: string
    name: string
    avatar?: string
  }
  lastMessage: {
    id: number
    senderId: string
    content: string
    createdAt: string
  } | null
  unreadCount: number
  lastMessageAt: string
}

type ConversationsResponse = {
  conversations: Conversation[]
}

type MessagesResponse = {
  messages: Message[]
  otherUser: {
    id: string
    name: string
    avatar?: string
    isBanned: boolean
  }
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

type UnreadCountResponse = {
  unreadCount: number
}

const TOKEN_KEY = 'starstack_token'

const LANGUAGE_OPTIONS = [
  {
    label: 'C++17',
    value: 'C++',
    monaco: 'cpp',
    template:
      '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n  ios::sync_with_stdio(false);\n  cin.tie(nullptr);\n\n  return 0;\n}\n',
  },
  {
    label: 'Python 3',
    value: 'Python',
    monaco: 'python',
    template: 'def main():\n    pass\n\n\nif __name__ == "__main__":\n    main()\n',
  },
  {
    label: 'Java 17',
    value: 'Java',
    monaco: 'java',
    template:
      'import java.io.*;\nimport java.util.*;\n\npublic class Main {\n    public static void main(String[] args) throws Exception {\n        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));\n    }\n}\n',
  },
]

const DIFFICULTY_OPTIONS = ['入门', '普及-', '普及', '提高-', '提高', '省选', 'noi']

// 预设标签列表（参考洛谷）
const PRESET_TAGS = [
  '动态规划',
  '贪心',
  '搜索',
  '深度优先搜索',
  '广度优先搜索',
  '图论',
  '最短路',
  '最小生成树',
  '树',
  '二叉树',
  '线段树',
  '树状数组',
  '并查集',
  '字符串',
  '字符串匹配',
  '前缀和',
  '差分',
  '数学',
  '数论',
  '组合数学',
  '概率论',
  '计算几何',
  '模拟',
  '枚举',
  '递推',
  '分治',
  '二分',
  '排序',
  '哈希',
  '栈',
  '队列',
  '链表',
  '堆',
  '位运算',
  '高精度',
  '矩阵',
  '博弈论',
  '网络流',
  '二分图',
  '拓扑排序',
  '强连通分量',
  '欧拉回路',
  '哈密尔顿回路',
  '最近公共祖先',
  '树链剖分',
  '莫队算法',
  '单调栈',
  '单调队列',
  '滑动窗口',
  '双指针',
  '快速幂',
  '矩阵快速幂',
  '线性代数',
  '容斥原理',
  '逆元',
  '中国剩余定理',
  '扩展欧几里得',
  '筛法',
  '质数',
  '因数分解',
  '最大公约数',
  '最小公倍数',
  '斐波那契',
  '卡特兰数',
  '斯特林数',
  '莫比乌斯反演',
  '生成函数',
  '多项式',
  'FFT',
  'NTT',
  '后缀数组',
  '后缀自动机',
  'AC自动机',
  'KMP',
  '马拉车算法',
  '回文树',
  '字典树',
  '平衡树',
  'Treap',
  '伸展树',
  '红黑树',
  '跳表',
  '可持久化数据结构',
  '主席树',
  '分块',
  '根号分治',
  '点分治',
  '边分治',
  '虚树',
  '动态树',
  'LCT',
  '线性规划',
  '网络流24题',
  '费用流',
  '上下界网络流',
  '2-SAT',
  '构造',
  '交互题',
  '提答题',
  'Special Judge',
]

const getLanguageConfig = (value: string) =>
  LANGUAGE_OPTIONS.find((item) => item.value === value) ?? LANGUAGE_OPTIONS[0]

// 格式化时间显示为确切时间
const formatTime = (dateString?: string): string => {
  if (!dateString) return '-'
  const date = new Date(dateString)
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}`
}

// 渲染LaTeX公式的函数
const renderLatex = (text: string): string => {
  if (!text) return ''

  // 先处理块级公式 $$...$$
  let result = text.replace(/\$\$([^$]+)\$\$/g, (match, formula) => {
    try {
      return katex.renderToString(formula.trim(), {
        displayMode: true,
        throwOnError: false
      })
    } catch {
      return match
    }
  })

  // 再处理行内公式 $...$
  result = result.replace(/\$([^$]+)\$/g, (match, formula) => {
    try {
      return katex.renderToString(formula.trim(), {
        displayMode: false,
        throwOnError: false
      })
    } catch {
      return match
    }
  })

  return result
}

const fetchJson = async <T = unknown>(url: string, options: RequestInit = {}) => {
  const headers = new Headers(options.headers || {})
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const token = localStorage.getItem(TOKEN_KEY)
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  const response = await fetch(url, { ...options, headers })
  let data: T | null = null
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    data = await response.json().catch(() => null)
  }
  return { response, data }
}

type AuthMode = 'login' | 'register'

type AuthPageProps = {
  mode: AuthMode
  onModeChange: (mode: AuthMode) => void
  onBack: () => void
  onSubmit: (event: React.FormEvent) => void
  formId: string
  formName: string
  formPassword: string
  formConfirm: string
  onFormIdChange: (value: string) => void
  onFormNameChange: (value: string) => void
  onFormPasswordChange: (value: string) => void
  onFormConfirmChange: (value: string) => void
  error: string
  success: string
}

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
  const appRef = useRef<HTMLDivElement | null>(null)
  const topbarRef = useRef<HTMLElement | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const isAuthPage = location.pathname === '/auth'
  const isOjDetailOrJudgePage = location.pathname.match(/^\/oj\/(p\d+|judge)/)
  const [homeEnter, setHomeEnter] = useState(false)
  const homeEnteredRef = useRef(false)

  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [authError, setAuthError] = useState('')
  const [authSuccess, setAuthSuccess] = useState('')
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [logoutNotice, setLogoutNotice] = useState('')
  const [currentUser, setCurrentUser] = useState<UserRecord | null>(null)
  const [authFrom, setAuthFrom] = useState('/')

  const [problemPlan, setProblemPlan] = useState<ProblemPlan[]>([])
  const [planOpen, setPlanOpen] = useState(false)

  const [unreadMessageCount, setUnreadMessageCount] = useState(0)

  const [formId, setFormId] = useState('')
  const [formName, setFormName] = useState('')
  const [formPassword, setFormPassword] = useState('')
  const [formConfirm, setFormConfirm] = useState('')

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
    loadCurrentUser()
  }, [loadCurrentUser])

  // Poll unread message count every 15 seconds
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
      setUnreadMessageCount(0)
      return
    }

    fetchUnreadCount()
    const interval = setInterval(fetchUnreadCount, 15000)

    return () => clearInterval(interval)
  }, [currentUser, fetchUnreadCount])

  useEffect(() => {
    if (isAuthPage) return
    const appEl = appRef.current
    const topbarEl = topbarRef.current
    if (!appEl || !topbarEl) return
    const update = () => {
      const next = Math.round(topbarEl.getBoundingClientRect().height)
      appEl.style.setProperty('--topbar-offset', `${next}px`)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(topbarEl)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [isAuthPage])

  useEffect(() => {
    if (location.pathname !== '/') {
      homeEnteredRef.current = false
      setHomeEnter(false)
      return
    }
    if (homeEnteredRef.current) return
    homeEnteredRef.current = true
    setHomeEnter(true)
    const timer = window.setTimeout(() => {
      setHomeEnter(false)
    }, 900)
    return () => window.clearTimeout(timer)
  }, [location.pathname])

  const handleAuthSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      setAuthError('')
      setAuthSuccess('')
      if (!formId.trim()) {
        setAuthError('请填写 ID')
        return
      }
      if (!formPassword.trim() || formPassword.length < 6) {
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
      loadProblemPlan()
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

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let animationId = 0
    let stars: {
      x: number
      y: number
      r: number
      alpha: number
      twinkle: number
      vx: number
      vy: number
      color: string
    }[] = []
    let microStars: {
      x: number
      y: number
      r: number
      alpha: number
      twinkle: number
    }[] = []
    let meteor: {
      x: number
      y: number
      vx: number
      vy: number
      life: number
      maxLife: number
    } | null = null
    let width = 0
    let height = 0

    const createStars = () => {
      const density = 2200
      const count = Math.max(180, Math.floor((width * height) / density))
      const palette = [
        '255, 255, 255',
        '196, 220, 255',
        '255, 236, 210',
        '180, 255, 240',
        '255, 210, 240',
      ]
      stars = Array.from({ length: count }, () => {
        const bright = Math.random() > 0.9
        const color = palette[Math.floor(Math.random() * palette.length)]
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          r: bright ? Math.random() * 1.9 + 0.7 : Math.random() * 1.2 + 0.25,
          alpha: bright ? Math.random() * 0.7 + 0.35 : Math.random() * 0.45 + 0.12,
          twinkle: (Math.random() * 0.02 + 0.004) * (Math.random() > 0.5 ? 1 : -1),
          vx: (Math.random() - 0.5) * 0.08,
          vy: (Math.random() - 0.5) * 0.06,
          color: bright ? color : '255, 255, 255',
        }
      })
      const microDensity = 700
      const microCount = Math.max(260, Math.floor((width * height) / microDensity))
      microStars = Array.from({ length: microCount }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: Math.random() * 0.8 + 0.12,
        alpha: Math.random() * 0.4 + 0.1,
        twinkle: (Math.random() * 0.013 + 0.002) * (Math.random() > 0.5 ? 1 : -1),
      }))
    }

    const resize = () => {
      const dpr = Math.max(window.devicePixelRatio || 1, 1)
      width = window.innerWidth
      height = window.innerHeight
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      createStars()
    }

    const draw = () => {
      ctx.clearRect(0, 0, width, height)
      for (const star of microStars) {
        star.alpha += star.twinkle
        if (star.alpha <= 0.05 || star.alpha >= 0.55) {
          star.twinkle *= -1
        }
        ctx.beginPath()
        ctx.fillStyle = `rgba(255, 255, 255, ${star.alpha})`
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2)
        ctx.fill()
      }
      for (const star of stars) {
        star.alpha += star.twinkle
        if (star.alpha <= 0.1 || star.alpha >= 1) {
          star.twinkle *= -1
        }
        star.x += star.vx
        star.y += star.vy
        if (star.x < 0) star.x = width
        if (star.x > width) star.x = 0
        if (star.y < 0) star.y = height
        if (star.y > height) star.y = 0
        ctx.beginPath()
        ctx.fillStyle = `rgba(${star.color}, ${star.alpha})`
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2)
        ctx.fill()
      }
      if (!meteor && Math.random() < 0.045) {
        const startX = Math.random() * width * 0.8 + width * 0.1
        const startY = Math.random() * height * 0.3 + height * 0.05
        meteor = {
          x: startX,
          y: startY,
          vx: 12 + Math.random() * 6,
          vy: 5 + Math.random() * 3,
          life: 0,
          maxLife: 60 + Math.random() * 40,
        }
      }
      if (meteor) {
        meteor.life += 1
        meteor.x += meteor.vx
        meteor.y += meteor.vy

        // 检查流星是否超出画布边界或生命周期结束
        if (meteor.life > meteor.maxLife || meteor.x > width + 100 || meteor.y > height + 100) {
          meteor = null
        } else {
          // 只在流星还在画布内时绘制
          ctx.beginPath()
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)'
          ctx.lineWidth = 2
          ctx.moveTo(meteor.x, meteor.y)
          ctx.lineTo(meteor.x - meteor.vx * 3, meteor.y - meteor.vy * 3)
          ctx.stroke()
        }
      }
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

  const appClassName = useMemo(() => {
    const classes = ['app']
    if (isOjDetailOrJudgePage) classes.push('sidebar-overlay')
    return classes.join(' ')
  }, [isOjDetailOrJudgePage])

  const initial = useMemo(
    () => currentUser?.name?.trim()?.[0] || currentUser?.id?.[0] || '★',
    [currentUser]
  )

  const HomePage = () => {
    const [stats, setStats] = useState<{
      problemCount: number
      userCount: number
      todaySubmissions: number
    } | null>(null)

    useEffect(() => {
      const loadStats = async () => {
        const { response, data } = await fetchJson<StatsResponse>('/api/stats')
        if (response.ok && data) {
          setStats(data)
        }
      }
      loadStats()
    }, [])

    return (
    <>
      <section className="hero">
        <div className="hero-left">
          <div className="eyebrow">StarStack Mission</div>
          <h1>星栈 · 以星海为幕的科技栈</h1>
          <p>
            星栈聚合评测、游戏与协作模块，构建面向未来的科技空间。这里是你的训练营、
            你的宇宙实验室，也是你的灵感中继站。
          </p>
          <div className="hero-actions">
            <button className="primary" onClick={() => navigate('/oj')}>
              进入评测系统
            </button>
            <button className="ghost" onClick={() => navigate('/games')}>
              浏览游戏
            </button>
          </div>
        </div>
        <div className="hero-right">
          <div className="stat-card">
            <div className="stat-label">题库规模</div>
            <div className="stat-value">{stats?.problemCount ?? '-'}</div>
            <div className="stat-desc">覆盖算法、系统与工程能力</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">评测吞吐</div>
            <div className="stat-value">{stats?.todaySubmissions ?? '-'}</div>
            <div className="stat-desc">每日提交与运行的总量</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">活跃星友</div>
            <div className="stat-value">{stats?.userCount ?? '-'}</div>
            <div className="stat-desc">专注技术成长的探索者</div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-header">
          <h2>核心模块</h2>
          <span className="tag">Modules</span>
        </div>
        <div className="section-body">
          <div className="info-panel">
            <h3>星栈算法测评</h3>
            <p>
              拥有真实判题、在线 IDE 与提交回放能力，支持多语言评测与测试点可视化。
              持续升级的题库，让每一次训练都有清晰的成长轨迹。
            </p>
            <ul className="feature-list">
              <li>多语言判题与结果明细</li>
              <li>在线 IDE + 样例测试</li>
              <li>提交记录与数据回溯</li>
            </ul>
          </div>
          <div className="card-grid">
            <div className="module-card">
              <div className="module-title">星栈游戏</div>
              <p>沉浸式科技风关卡，支持多人协作与竞技挑战。</p>
            </div>
            <div className="module-card">
              <div className="module-title">星栈数据中枢</div>
              <p>记录你的学习路径、题目画像与成长报告。</p>
            </div>
            <div className="module-card">
              <div className="module-title">星栈创作工坊</div>
              <p>未来模块：项目发布、协作与成果展示。</p>
            </div>
          </div>
        </div>
      </section>
    </>
  )
  }

  const GamesPage = () => (
    <section className="section">
      <div className="section-header">
        <h2>星栈游戏</h2>
        <span className="tag">Games</span>
      </div>
      <p>游戏模块正在建设中，将提供科技感关卡与协作玩法。</p>
    </section>
  )

  const MyProblemsPage = () => {
    const [problems, setProblems] = useState<OjProblemSummary[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [currentPage, setCurrentPage] = useState(1)
    const [pageInput, setPageInput] = useState('1')
    const itemsPerPage = 20

    useEffect(() => {
      if (!currentUser) {
        openAuth('login')
        return
      }
      loadMyProblems()
    }, [])

    const loadMyProblems = async () => {
      setLoading(true)
      setError('')
      const { response, data } = await fetchJson<ProblemsResponse>('/api/my-problems')
      if (!response.ok) {
        setError(data?.message || '无法加载题目')
        setLoading(false)
        return
      }
      setProblems(data?.problems || [])
      setLoading(false)
    }

    const handleDelete = async (problemId: number, event: React.MouseEvent) => {
      event.stopPropagation()
      if (!confirm('确定要删除这个题目吗？删除后无法恢复。')) {
        return
      }

      const { response, data } = await fetchJson<ApiResponse>(`/api/problems/${problemId}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        alert(data?.message || '删除失败')
        return
      }

      alert('删除成功')
      loadMyProblems()
    }

    const handleEdit = (problemId: number, event: React.MouseEvent) => {
      event.stopPropagation()
      navigate(`/edit-problem/${problemId}`)
    }

    const totalPages = Math.ceil(problems.length / itemsPerPage)
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    const currentProblems = problems.slice(startIndex, endIndex)

    const handlePageChange = (page: number) => {
      if (page >= 1 && page <= totalPages) {
        setCurrentPage(page)
        setPageInput(String(page))
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    }

    const handlePageInputChange = (value: string) => {
      setPageInput(value)
    }

    const handlePageInputSubmit = () => {
      const page = parseInt(pageInput)
      if (!isNaN(page) && page >= 1 && page <= totalPages) {
        setCurrentPage(page)
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } else {
        setPageInput(String(currentPage))
      }
    }

    const renderPageNumbers = () => {
      const pages: (number | string)[] = []
      if (totalPages <= 7) {
        for (let i = 1; i <= totalPages; i++) {
          pages.push(i)
        }
      } else {
        pages.push(1)
        if (currentPage <= 3) {
          pages.push(2, 3, 4, 5, '...', totalPages)
        } else if (currentPage >= totalPages - 2) {
          pages.push('...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages)
        } else {
          pages.push('...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages)
        }
      }
      return pages
    }

    if (!currentUser) {
      return null
    }

    return (
      <div className="oj-page">
        <div className="oj-header">
          <h2>我的题目</h2>
          <button className="primary" onClick={() => navigate('/create-problem')}>
            创建题目
          </button>
        </div>
        {loading && <div className="oj-loading">加载中...</div>}
        {error && <div className="oj-error">{error}</div>}
        {!loading && !error && problems.length === 0 && (
          <div className="oj-empty">
            <p>还没有创建题目</p>
            <button className="primary" onClick={() => navigate('/create-problem')}>
              创建第一个题目
            </button>
          </div>
        )}
        {!loading && !error && problems.length > 0 && (
          <>
            <div className="oj-problem-grid">
              {currentProblems.map((problem) => (
              <div
                key={problem.id}
                className="oj-card my-problem-card"
                onClick={() => navigate(`/oj/p${problem.id}`)}
              >
                <div className="oj-card-title">
                  <span className="oj-code-label">p{problem.id}</span>
                  {problem.title}
                </div>
                <div className="oj-card-meta">
                  <span className={`oj-badge ${problem.difficulty}`}>{problem.difficulty}</span>
                  <div className="oj-tags">
                    {problem.tags.map((tag) => (
                      <span key={tag} className="oj-tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="problem-actions">
                  <button
                    className="ghost small"
                    onClick={(e) => handleEdit(problem.id, e)}
                  >
                    编辑
                  </button>
                  <button
                    className="ghost small danger"
                    onClick={(e) => handleDelete(problem.id, e)}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button
                className="pagination-btn"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
              >
                上一页
              </button>

              <div className="pagination-numbers">
                {renderPageNumbers().map((page, index) => (
                  page === '...' ? (
                    <span key={`ellipsis-${index}`} className="pagination-ellipsis">
                      ...
                    </span>
                  ) : (
                    <button
                      key={page}
                      className={`pagination-number ${currentPage === page ? 'active' : ''}`}
                      onClick={() => handlePageChange(page as number)}
                    >
                      {page}
                    </button>
                  )
                ))}
              </div>

              <button
                className="pagination-btn"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
              >
                下一页
              </button>

              <div className="pagination-jump">
                <span>跳转到</span>
                <input
                  type="text"
                  className="pagination-input"
                  value={pageInput}
                  onChange={(e) => handlePageInputChange(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handlePageInputSubmit()}
                />
                <button className="pagination-go" onClick={handlePageInputSubmit}>
                  GO
                </button>
              </div>
            </div>
          )}
          </>
        )}
      </div>
    )
  }

  // 标签选择器组件
  const TagSelector = ({
    selectedTags,
    onTagsChange
  }: {
    selectedTags: string[]
    onTagsChange: (tags: string[]) => void
  }) => {
    const [isOpen, setIsOpen] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')

    const filteredTags = useMemo(() => {
      if (!searchQuery.trim()) {
        return PRESET_TAGS
      }
      const query = searchQuery.toLowerCase()
      return PRESET_TAGS.filter(tag => tag.toLowerCase().includes(query))
    }, [searchQuery])

    const handleTagClick = (tag: string) => {
      if (selectedTags.includes(tag)) {
        onTagsChange(selectedTags.filter(t => t !== tag))
      } else {
        onTagsChange([...selectedTags, tag])
      }
    }

    const handleRemoveTag = (tag: string, event: React.MouseEvent) => {
      event.stopPropagation()
      onTagsChange(selectedTags.filter(t => t !== tag))
    }

    return (
      <div className="tag-selector">
        <div className="tag-selector-input" onClick={() => setIsOpen(true)}>
          <div className="selected-tags">
            {selectedTags.length === 0 ? (
              <span className="tag-placeholder">点击选择标签</span>
            ) : (
              selectedTags.map(tag => (
                <span key={tag} className="selected-tag">
                  {tag}
                  <button
                    className="remove-tag-btn"
                    onClick={(e) => handleRemoveTag(tag, e)}
                    type="button"
                  >
                    ×
                  </button>
                </span>
              ))
            )}
          </div>
          <button type="button" className="tag-selector-btn">
            选择标签
          </button>
        </div>

        {isOpen && (
          <div className="tag-selector-modal" onClick={() => setIsOpen(false)}>
            <div className="tag-selector-content" onClick={(e) => e.stopPropagation()}>
              <div className="tag-selector-header">
                <h3>选择标签</h3>
                <button
                  className="tag-selector-close"
                  onClick={() => setIsOpen(false)}
                  type="button"
                >
                  ×
                </button>
              </div>

              <div className="tag-selector-search">
                <input
                  type="text"
                  className="auth-input"
                  placeholder="搜索标签..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="tag-selector-body">
                {filteredTags.length === 0 ? (
                  <div className="tag-selector-empty">未找到匹配的标签</div>
                ) : (
                  <div className="tag-selector-grid">
                    {filteredTags.map(tag => (
                      <button
                        key={tag}
                        type="button"
                        className={`tag-selector-item ${selectedTags.includes(tag) ? 'selected' : ''}`}
                        onClick={() => handleTagClick(tag)}
                      >
                        {tag}
                        {selectedTags.includes(tag) && <span className="tag-check">✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="tag-selector-footer">
                <div className="tag-selector-count">
                  已选择 {selectedTags.length} 个标签
                </div>
                <button
                  className="primary"
                  onClick={() => setIsOpen(false)}
                  type="button"
                >
                  完成
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  const CreateProblemPage = () => {
    const [title, setTitle] = useState('')
    const [difficulty, setDifficulty] = useState('入门')
    const [tags, setTags] = useState<string[]>([])
    const [statement, setStatement] = useState('')
    const [inputDesc, setInputDesc] = useState('')
    const [outputDesc, setOutputDesc] = useState('')
    const [dataRange, setDataRange] = useState('')
    const [samples, setSamples] = useState<{ input: string; output: string }[]>([
      { input: '', output: '' }
    ])
    const [testFiles, setTestFiles] = useState<{ name: string; type: 'in' | 'out'; content: string }[]>([])
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')
    const [submitting, setSubmitting] = useState(false)

    useEffect(() => {
      if (!currentUser) {
        openAuth('login')
      }
    }, [])

    const addSample = () => {
      setSamples([...samples, { input: '', output: '' }])
    }

    const removeSample = (index: number) => {
      setSamples(samples.filter((_, i) => i !== index))
    }

    const updateSample = (index: number, field: 'input' | 'output', value: string) => {
      const newSamples = [...samples]
      newSamples[index][field] = value
      setSamples(newSamples)
    }

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files
      if (!files) return

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const fileName = file.name
        const ext = fileName.split('.').pop()?.toLowerCase()

        if (ext !== 'in' && ext !== 'out') {
          setError(`文件 ${fileName} 格式不正确，只支持 .in 和 .out 文件`)
          continue
        }

        const content = await file.text()
        setTestFiles(prev => [...prev, {
          name: fileName,
          type: ext as 'in' | 'out',
          content
        }])
      }
    }

    const removeTestFile = (index: number) => {
      setTestFiles(testFiles.filter((_, i) => i !== index))
    }

    const handleSubmit = async (event: React.FormEvent) => {
      event.preventDefault()
      setError('')
      setSuccess('')

      if (!currentUser) {
        openAuth('login')
        return
      }

      if (!title.trim()) {
        setError('请填写题目标题')
        return
      }

      if (!statement.trim()) {
        setError('请填写题目描述')
        return
      }

      const validSamples = samples.filter(s => s.input.trim() && s.output.trim())
      if (validSamples.length === 0) {
        setError('请至少添加一个样例')
        return
      }

      setSubmitting(true)

      const payload = {
        title: title.trim(),
        difficulty,
        tags: tags,
        statement: statement.trim(),
        inputDesc: inputDesc.trim(),
        outputDesc: outputDesc.trim(),
        dataRange: dataRange.trim(),
        samples: validSamples,
        testFiles
      }

      const { response, data } = await fetchJson<ApiResponse>('/api/problems', {
        method: 'POST',
        body: JSON.stringify(payload)
      })

      setSubmitting(false)

      if (!response.ok) {
        setError(data?.message || '创建题目失败')
        return
      }

      setSuccess('题目创建成功！')
      setTimeout(() => {
        navigate('/my-problems')
      }, 1500)
    }

    if (!currentUser) {
      return null
    }

    return (
      <div className="oj-page">
        <div className="oj-header">
          <h2>创建题目</h2>
          <button className="ghost" onClick={() => navigate('/my-problems')}>
            返回
          </button>
        </div>

        <form className="problem-form" onSubmit={handleSubmit}>
          {error && <div className="form-error">{error}</div>}
          {success && <div className="form-success">{success}</div>}

          <div className="form-section">
            <label className="form-label">题目标题 *</label>
            <input
              type="text"
              className="auth-input"
              placeholder="例如：A+B Problem"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div className="form-row">
            <div className="form-section">
              <label className="form-label">难度 *</label>
              <select
                className="auth-input"
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
              >
                {DIFFICULTY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-section">
              <label className="form-label">标签</label>
              <TagSelector selectedTags={tags} onTagsChange={setTags} />
            </div>
          </div>

          <div className="form-section">
            <label className="form-label">题目描述 *</label>
            <div className="form-hint">
              支持 Markdown 和 LaTeX 数学公式。行内公式用 $...$ ，块级公式用 $$...$$
              <br />
              例如：$x^2$、$$\sum_&#123;i=1&#125;^&#123;n&#125; i$$
            </div>
            <textarea
              className="auth-input problem-textarea"
              placeholder="输入题目描述..."
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              rows={8}
              required
            />
          </div>

          <div className="form-section">
            <label className="form-label">输入格式</label>
            <textarea
              className="auth-input"
              placeholder="描述输入数据的格式..."
              value={inputDesc}
              onChange={(e) => setInputDesc(e.target.value)}
              rows={3}
            />
          </div>

          <div className="form-section">
            <label className="form-label">输出格式</label>
            <textarea
              className="auth-input"
              placeholder="描述输出数据的格式..."
              value={outputDesc}
              onChange={(e) => setOutputDesc(e.target.value)}
              rows={3}
            />
          </div>

          <div className="form-section">
            <label className="form-label">数据范围</label>
            <div className="form-hint">
              支持 LaTeX 公式，例如：$1 \leq n \leq 10^6$
            </div>
            <textarea
              className="auth-input"
              placeholder="例如：对于 100% 的数据，$1 \leq n \leq 10^6$"
              value={dataRange}
              onChange={(e) => setDataRange(e.target.value)}
              rows={3}
            />
          </div>

          <div className="form-section">
            <div className="form-label-row">
              <label className="form-label">样例数据 *</label>
              <button type="button" className="ghost small" onClick={addSample}>
                添加样例
              </button>
            </div>
            {samples.map((sample, index) => (
              <div key={index} className="sample-group">
                <div className="sample-header">
                  <span>样例 {index + 1}</span>
                  {samples.length > 1 && (
                    <button
                      type="button"
                      className="ghost small danger"
                      onClick={() => removeSample(index)}
                    >
                      删除
                    </button>
                  )}
                </div>
                <div className="sample-row">
                  <div className="sample-col">
                    <label className="sample-label">输入</label>
                    <textarea
                      className="auth-input"
                      placeholder="样例输入..."
                      value={sample.input}
                      onChange={(e) => updateSample(index, 'input', e.target.value)}
                      rows={4}
                    />
                  </div>
                  <div className="sample-col">
                    <label className="sample-label">输出</label>
                    <textarea
                      className="auth-input"
                      placeholder="样例输出..."
                      value={sample.output}
                      onChange={(e) => updateSample(index, 'output', e.target.value)}
                      rows={4}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="form-section">
            <label className="form-label">测试数据</label>
            <div className="form-hint">
              上传 .in 和 .out 文件作为测试数据。文件名应成对，例如：1.in 和 1.out
            </div>
            <input
              type="file"
              accept=".in,.out"
              multiple
              onChange={handleFileUpload}
              className="file-input"
            />
            {testFiles.length > 0 && (
              <div className="test-files-list">
                {testFiles.map((file, index) => (
                  <div key={index} className="test-file-item">
                    <span className={`file-badge ${file.type}`}>{file.type}</span>
                    <span className="file-name">{file.name}</span>
                    <button
                      type="button"
                      className="ghost small danger"
                      onClick={() => removeTestFile(index)}
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="form-actions">
            <button type="button" className="ghost" onClick={() => navigate('/my-problems')}>
              取消
            </button>
            <button type="submit" className="primary" disabled={submitting}>
              {submitting ? '创建中...' : '创建题目'}
            </button>
          </div>
        </form>
      </div>
    )
  }

  const EditProblemPage = () => {
    const { id } = useParams()
    const [loading, setLoading] = useState(true)
    const [title, setTitle] = useState('')
    const [difficulty, setDifficulty] = useState('入门')
    const [tags, setTags] = useState<string[]>([])
    const [statement, setStatement] = useState('')
    const [inputDesc, setInputDesc] = useState('')
    const [outputDesc, setOutputDesc] = useState('')
    const [dataRange, setDataRange] = useState('')
    const [samples, setSamples] = useState<{ input: string; output: string }[]>([
      { input: '', output: '' }
    ])
    const [testFiles, setTestFiles] = useState<{ name: string; type: 'in' | 'out'; content: string }[]>([])
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')
    const [submitting, setSubmitting] = useState(false)

    useEffect(() => {
      if (!currentUser) {
        openAuth('login')
        return
      }
      loadProblem()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id])

    const loadProblem = async () => {
      if (!id) return
      setLoading(true)
      setError('')
      const { response, data } = await fetchJson<{ problem: any; message?: string }>(`/api/problems/${id}/edit`)
      if (!response.ok) {
        setError(data?.message || '无法加载题目')
        setLoading(false)
        return
      }
      const problem = data?.problem
      setTitle(problem.title)
      setDifficulty(problem.difficulty)
      setTags(problem.tags || [])
      setStatement(problem.statement)
      setInputDesc(problem.inputDesc || '')
      setOutputDesc(problem.outputDesc || '')
      setDataRange(problem.dataRange || '')
      setSamples(problem.samples.length > 0 ? problem.samples : [{ input: '', output: '' }])
      setLoading(false)
    }

    const addSample = () => {
      setSamples([...samples, { input: '', output: '' }])
    }

    const removeSample = (index: number) => {
      setSamples(samples.filter((_, i) => i !== index))
    }

    const updateSample = (index: number, field: 'input' | 'output', value: string) => {
      const newSamples = [...samples]
      newSamples[index][field] = value
      setSamples(newSamples)
    }

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files
      if (!files) return

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const fileName = file.name
        const ext = fileName.split('.').pop()?.toLowerCase()

        if (ext !== 'in' && ext !== 'out') {
          setError(`文件 ${fileName} 格式不正确，只支持 .in 和 .out 文件`)
          continue
        }

        const content = await file.text()
        setTestFiles(prev => [...prev, {
          name: fileName,
          type: ext as 'in' | 'out',
          content
        }])
      }
    }

    const removeTestFile = (index: number) => {
      setTestFiles(testFiles.filter((_, i) => i !== index))
    }

    const handleSubmit = async (event: React.FormEvent) => {
      event.preventDefault()
      setError('')
      setSuccess('')

      if (!currentUser) {
        openAuth('login')
        return
      }

      if (!title.trim()) {
        setError('请填写题目标题')
        return
      }

      if (!statement.trim()) {
        setError('请填写题目描述')
        return
      }

      const validSamples = samples.filter(s => s.input.trim() && s.output.trim())
      if (validSamples.length === 0) {
        setError('请至少添加一个样例')
        return
      }

      setSubmitting(true)

      const payload = {
        title: title.trim(),
        difficulty,
        tags: tags,
        statement: statement.trim(),
        inputDesc: inputDesc.trim(),
        outputDesc: outputDesc.trim(),
        dataRange: dataRange.trim(),
        samples: validSamples,
        testFiles,
        status: 'published'
      }

      const { response, data } = await fetchJson<ApiResponse>(`/api/problems/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      })

      setSubmitting(false)

      if (!response.ok) {
        setError(data?.message || '更新题目失败')
        return
      }

      setSuccess('题目更新成功！')
      setTimeout(() => {
        navigate('/my-problems')
      }, 1500)
    }

    if (!currentUser) {
      return null
    }

    if (loading) {
      return (
        <div className="oj-page">
          <div className="oj-loading">加载中...</div>
        </div>
      )
    }

    return (
      <div className="oj-page">
        <div className="oj-header">
          <h2>编辑题目</h2>
          <button className="ghost" onClick={() => navigate('/my-problems')}>
            返回
          </button>
        </div>

        <form className="problem-form" onSubmit={handleSubmit}>
          {error && <div className="form-error">{error}</div>}
          {success && <div className="form-success">{success}</div>}

          <div className="form-section">
            <label className="form-label">题目标题 *</label>
            <input
              type="text"
              className="auth-input"
              placeholder="例如：A+B Problem"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div className="form-row">
            <div className="form-section">
              <label className="form-label">难度 *</label>
              <select
                className="auth-input"
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
              >
                {DIFFICULTY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-section">
              <label className="form-label">标签</label>
              <TagSelector selectedTags={tags} onTagsChange={setTags} />
            </div>
          </div>

          <div className="form-section">
            <label className="form-label">题目描述 *</label>
            <div className="form-hint">
              支持 Markdown 和 LaTeX 数学公式。行内公式用 $...$ ，块级公式用 $$...$$
              <br />
              例如：$x^2$、$$\sum_&#123;i=1&#125;^&#123;n&#125; i$$
            </div>
            <textarea
              className="auth-input problem-textarea"
              placeholder="输入题目描述..."
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              rows={8}
              required
            />
          </div>

          <div className="form-section">
            <label className="form-label">输入格式</label>
            <textarea
              className="auth-input"
              placeholder="描述输入数据的格式..."
              value={inputDesc}
              onChange={(e) => setInputDesc(e.target.value)}
              rows={3}
            />
          </div>

          <div className="form-section">
            <label className="form-label">输出格式</label>
            <textarea
              className="auth-input"
              placeholder="描述输出数据的格式..."
              value={outputDesc}
              onChange={(e) => setOutputDesc(e.target.value)}
              rows={3}
            />
          </div>

          <div className="form-section">
            <label className="form-label">数据范围</label>
            <div className="form-hint">
              支持 LaTeX 公式，例如：$1 \leq n \leq 10^6$
            </div>
            <textarea
              className="auth-input"
              placeholder="例如：对于 100% 的数据，$1 \leq n \leq 10^6$"
              value={dataRange}
              onChange={(e) => setDataRange(e.target.value)}
              rows={3}
            />
          </div>

          <div className="form-section">
            <div className="form-label-row">
              <label className="form-label">样例数据 *</label>
              <button type="button" className="ghost small" onClick={addSample}>
                添加样例
              </button>
            </div>
            {samples.map((sample, index) => (
              <div key={index} className="sample-group">
                <div className="sample-header">
                  <span>样例 {index + 1}</span>
                  {samples.length > 1 && (
                    <button
                      type="button"
                      className="ghost small danger"
                      onClick={() => removeSample(index)}
                    >
                      删除
                    </button>
                  )}
                </div>
                <div className="sample-row">
                  <div className="sample-col">
                    <label className="sample-label">输入</label>
                    <textarea
                      className="auth-input"
                      placeholder="样例输入..."
                      value={sample.input}
                      onChange={(e) => updateSample(index, 'input', e.target.value)}
                      rows={4}
                    />
                  </div>
                  <div className="sample-col">
                    <label className="sample-label">输出</label>
                    <textarea
                      className="auth-input"
                      placeholder="样例输出..."
                      value={sample.output}
                      onChange={(e) => updateSample(index, 'output', e.target.value)}
                      rows={4}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="form-section">
            <label className="form-label">测试数据</label>
            <div className="form-hint">
              上传 .in 和 .out 文件作为测试数据。文件名应成对，例如：1.in 和 1.out
              <br />
              注意：上传新文件将替换所有现有测试数据
            </div>
            <input
              type="file"
              accept=".in,.out"
              multiple
              onChange={handleFileUpload}
              className="file-input"
            />
            {testFiles.length > 0 && (
              <div className="test-files-list">
                {testFiles.map((file, index) => (
                  <div key={index} className="test-file-item">
                    <span className={`file-badge ${file.type}`}>{file.type}</span>
                    <span className="file-name">{file.name}</span>
                    <button
                      type="button"
                      className="ghost small danger"
                      onClick={() => removeTestFile(index)}
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="form-actions">
            <button type="button" className="ghost" onClick={() => navigate('/my-problems')}>
              取消
            </button>
            <button type="submit" className="primary" disabled={submitting}>
              {submitting ? '更新中...' : '更新题目'}
            </button>
          </div>
        </form>
      </div>
    )
  }

  const AccountPage = () => {
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [uploading, setUploading] = useState(false)
    const [uploadError, setUploadError] = useState('')
    const [profileStats, setProfileStats] = useState<ProfileStats | null>(null)
    const [heatmapData, setHeatmapData] = useState<HeatmapData[]>([])
    const [achievements, setAchievements] = useState<Achievement[]>([])
    const [loading, setLoading] = useState(true)
    const loadedUserIdRef = useRef<string | null>(null)

    const handleAvatarClick = () => {
      fileInputRef.current?.click()
    }

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

      // 验证文件类型
      if (!file.type.startsWith('image/')) {
        setUploadError('请选择图片文件')
        return
      }

      // 验证文件大小（2MB）
      if (file.size > 2 * 1024 * 1024) {
        setUploadError('图片大小不能超过 2MB')
        return
      }

      setUploadError('')
      setUploading(true)

      // 读取文件为 base64
      const reader = new FileReader()
      reader.onload = async (e) => {
        const base64 = e.target?.result as string

        // 上传头像
        const { response, data } = await fetchJson<UserResponse>('/api/me/avatar', {
          method: 'POST',
          body: JSON.stringify({ avatar: base64 }),
        })

        setUploading(false)

        if (!response.ok) {
          setUploadError(data?.message || '上传失败')
          return
        }

        // 更新用户信息
        if (data?.user) {
          setCurrentUser(data.user)
        }
      }

      reader.onerror = () => {
        setUploading(false)
        setUploadError('读取文件失败')
      }

      reader.readAsDataURL(file)
    }

    useEffect(() => {
      if (!currentUser?.id) return

      // 如果已经加载过这个用户的数据，不要重新加载
      if (loadedUserIdRef.current === currentUser.id) return

      let isMounted = true

      const loadProfileData = async () => {
        setLoading(true)
        try {
          const [statsRes, heatmapRes, achievementsRes] = await Promise.all([
            fetchJson<ProfileStatsResponse>(`/api/user/profile/${currentUser.id}`),
            fetchJson<{ heatmap: HeatmapResponse }>(`/api/user/heatmap/${currentUser.id}`),
            fetchJson<{ achievements: AchievementsResponse }>(`/api/user/achievements/${currentUser.id}`)
          ])

          if (!isMounted) return

          if (statsRes.response.ok && statsRes.data) {
            setProfileStats(statsRes.data)
          }
          if (heatmapRes.response.ok && heatmapRes.data) {
            setHeatmapData(heatmapRes.data.heatmap || [])
          }
          if (achievementsRes.response.ok && achievementsRes.data) {
            setAchievements(achievementsRes.data.achievements || [])
          }

          // 标记已加载
          loadedUserIdRef.current = currentUser.id
        } catch (error) {
          console.error('Failed to load profile data:', error)
        } finally {
          if (isMounted) {
            setLoading(false)
          }
        }
      }

      loadProfileData()

      return () => {
        isMounted = false
      }
    }, [])

    if (!currentUser) {
      return (
        <section className="section">
          <div className="section-header">
            <h2>个人中心</h2>
          </div>
          <p>请先登录以访问个人中心。</p>
          <button className="primary" onClick={() => openAuth('login')}>
            登录
          </button>
        </section>
      )
    }

    if (loading) {
      return (
        <div className="profile-container">
          <div className="profile-left">
            <div className="profile-card skeleton-loading">
              <div className="profile-avatar-large">
                {initial}
              </div>
              <div style={{ width: '100%', textAlign: 'center' }}>
                <div style={{ height: '24px', background: 'rgba(79, 195, 247, 0.1)', borderRadius: '4px', marginBottom: '8px' }}></div>
                <div style={{ height: '16px', background: 'rgba(79, 195, 247, 0.1)', borderRadius: '4px', width: '60%', margin: '0 auto' }}></div>
              </div>
            </div>
          </div>
          <div className="profile-right">
            <div className="stats-grid">
              {[1, 2, 3, 4, 5, 6].map(i => (
                <div key={i} className="stat-card skeleton-loading">
                  <div className="stat-value">-</div>
                  <div className="stat-label">加载中</div>
                </div>
              ))}
            </div>
            <div className="heatmap-container skeleton-loading" style={{ minHeight: '200px' }}>
              <div className="heatmap-title">做题热力图</div>
              <p style={{ color: 'var(--muted)', fontSize: '14px' }}>加载中...</p>
            </div>
          </div>
        </div>
      )
    }

    const stats = profileStats?.stats || {}
    const difficultyStats = profileStats?.difficultyStats || {}

    return (
      <div className="profile-container">
        <div className="profile-left">
          {/* Profile Card */}
          <div className="profile-card">
            <div
              className={`profile-avatar-large ${uploading ? 'uploading' : ''}`}
              onClick={handleAvatarClick}
              style={{ cursor: 'pointer' }}
              title="点击更换头像"
            >
              {currentUser.avatar ? (
                <img src={currentUser.avatar} alt="头像" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
              ) : (
                initial
              )}
            </div>
            <div className="account-name" style={{ fontSize: '20px', fontWeight: 600 }}>{currentUser.name}</div>
            <div className="account-id" style={{ color: 'var(--muted)' }}>@{currentUser.id}</div>
            {stats.rank && stats.rank > 0 && (
              <div className="profile-rank-badge">
                全站排名 #{stats.rank}
              </div>
            )}
            {uploadError && <div className="auth-error" style={{ marginTop: '8px', fontSize: '12px' }}>{uploadError}</div>}
            {uploading && <div style={{ color: 'var(--muted)', marginTop: '8px', fontSize: '12px' }}>上传中...</div>}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </div>
        </div>

        <div className="profile-right">
          {/* Stats Panel */}
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value">{stats.totalSubmissions || 0}</div>
              <div className="stat-label">总提交</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.acceptedCount || 0}</div>
              <div className="stat-label">通过数</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.solvedProblems || 0}</div>
              <div className="stat-label">解决题目</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.acceptanceRate?.toFixed(1) || 0}%</div>
              <div className="stat-label">通过率</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.currentStreak || 0}</div>
              <div className="stat-label">当前连续</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.maxStreak || 0}</div>
              <div className="stat-label">最长连续</div>
            </div>
          </div>

          {/* Heatmap */}
          <div className="heatmap-container">
            <div className="heatmap-title">做题热力图</div>
            <div className="heatmap-grid">
              {heatmapData.map((day, idx) => {
                const level = day.count === 0 ? 0 : day.count <= 2 ? 1 : day.count <= 5 ? 2 : day.count <= 10 ? 3 : 4
                return (
                  <div
                    key={idx}
                    className="heatmap-cell"
                    data-level={level}
                    title={`${day.date}: ${day.count} 次提交, ${day.accepted} 次通过`}
                  />
                )
              })}
            </div>
          </div>

          {/* Difficulty Progress */}
          <div className="difficulty-progress-container">
            <div className="heatmap-title">题目完成情况</div>
            {Object.keys(difficultyStats).length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: '14px' }}>暂无数据</p>
            ) : (
              (() => {
                const difficultyOrder = ['入门', '普及-', '普及', '提高-', '提高', '省选', 'noi']
                const sortedEntries = Object.entries(difficultyStats).sort((a, b) => {
                  const indexA = difficultyOrder.indexOf(a[0])
                  const indexB = difficultyOrder.indexOf(b[0])
                  return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB)
                })
                return sortedEntries.map(([difficulty, stats]) => {
                  const difficultyClass = difficulty === '入门' ? 'entry'
                    : difficulty === '普及-' ? 'popular-minus'
                    : difficulty === '普及' ? 'popular'
                    : difficulty === '普及+' ? 'popular-plus'
                    : difficulty === '提高-' ? 'improve'
                    : difficulty === '提高' ? 'improve'
                    : difficulty === '提高+' ? 'improve-plus'
                    : difficulty === '省选' ? 'provincial'
                    : difficulty === 'noi' ? 'noi'
                    : 'default'

                  return (
                    <div key={difficulty} className="difficulty-item">
                      <div className="difficulty-header">
                        <div className={`difficulty-label ${difficultyClass}`}>{difficulty}</div>
                        <div className="difficulty-stats">
                          {stats.solved || 0} / {stats.tried || 0}
                        </div>
                      </div>
                      <div className="progress-bar">
                        <div
                          className={`progress-fill ${difficultyClass}`}
                          style={{
                            width: stats.tried > 0
                              ? `${(stats.solved / stats.tried) * 100}%`
                              : '0%'
                          }}
                        />
                      </div>
                    </div>
                  )
                })
              })()
            )}
          </div>

          {/* Achievements */}
          <div className="achievements-container">
            <div className="heatmap-title">成就徽章</div>
            {achievements.length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: '14px' }}>暂无成就，继续努力吧！</p>
            ) : (
              <div className="achievements-grid">
                {achievements.map((achievement, idx) => (
                  <div key={idx} className="achievement-badge">
                    <div className="achievement-icon">{achievement.icon}</div>
                    <div className="achievement-name">{achievement.name}</div>
                    <div className="achievement-date">
                      {achievement.unlockedAt ? new Date(achievement.unlockedAt).toLocaleDateString() : '未解锁'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  const LeaderboardPage = () => {
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
    const [currentUserRank, setCurrentUserRank] = useState<LeaderboardEntry | null>(null)
    const [loading, setLoading] = useState(true)
    const [leaderboardPage, setLeaderboardPage] = useState(1)
    const [leaderboardPageInput, setLeaderboardPageInput] = useState('1')
    const [leaderboardType, setLeaderboardType] = useState<'total' | 'weekly' | 'monthly'>('total')
    const [leaderboardTotalPages, setLeaderboardTotalPages] = useState(1)
    const [leaderboardTotal, setLeaderboardTotal] = useState(0)
    const [periodStart, setPeriodStart] = useState<string | null>(null)
    const [periodEnd, setPeriodEnd] = useState<string | null>(null)
    const leaderboardPerPage = 20

    const loadLeaderboard = useCallback(async () => {
      setLoading(true)
      try {
        const { response, data } = await fetchJson<{ leaderboard: LeaderboardResponse; currentUser?: any; type: string; totalPages?: number; total?: number; periodStart?: string; periodEnd?: string }>(`/api/leaderboard?page=${leaderboardPage}&perPage=${leaderboardPerPage}&type=${leaderboardType}`)
        if (response.ok && data) {
          setLeaderboard(data.leaderboard || [])
          setCurrentUserRank(data.currentUser)
          setLeaderboardTotalPages(data.totalPages || 1)
          setLeaderboardTotal(data.total || 0)
          setPeriodStart(data.periodStart || null)
          setPeriodEnd(data.periodEnd || null)
        }
      } catch (error) {
        console.error('Failed to load leaderboard:', error)
      } finally {
        setLoading(false)
      }
    }, [leaderboardType, leaderboardPage])

    useEffect(() => {
      loadLeaderboard()
    }, [loadLeaderboard])

    const getRankMedal = (rank: number) => {
      if (rank === 1) return '🥇'
      if (rank === 2) return '🥈'
      if (rank === 3) return '🥉'
      return rank
    }

    const getRankChange = (rankChange: number | null) => {
      if (rankChange === null) return <span className="rank-change new">NEW</span>
      if (rankChange === 0) return <span className="rank-change stable">-</span>
      if (rankChange > 0) return <span className="rank-change down">↓{Math.abs(rankChange)}</span>
      return <span className="rank-change up">↑{Math.abs(rankChange)}</span>
    }

    const formatPeriodLabel = () => {
      if (leaderboardType === 'total') return null
      if (!periodStart || !periodEnd) return null
      const start = new Date(periodStart)
      const end = new Date(periodEnd)
      end.setDate(end.getDate() - 1) // endDate 是开区间，显示时减一天
      if (leaderboardType === 'weekly') {
        const fmt = (d: Date) => `${d.getMonth() + 1}.${d.getDate()}`
        return `${fmt(start)} — ${fmt(end)}`
      }
      if (leaderboardType === 'monthly') {
        return `${start.getFullYear()} 年 ${start.getMonth() + 1} 月`
      }
      return null
    }

    const getEmptyMessage = () => {
      if (leaderboardType === 'weekly') return '本周还没有人做题，快来争第一吧'
      if (leaderboardType === 'monthly') return '本月还没有人做题，快来争第一吧'
      return '暂无数据'
    }

    const handleLeaderboardPageChange = (page: number) => {
      if (page >= 1 && page <= leaderboardTotalPages) {
        setLeaderboardPage(page)
        setLeaderboardPageInput(String(page))
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    }

    const handleLeaderboardPageInputChange = (value: string) => {
      setLeaderboardPageInput(value)
    }

    const handleLeaderboardPageInputSubmit = () => {
      const page = parseInt(leaderboardPageInput)
      if (!isNaN(page) && page >= 1 && page <= leaderboardTotalPages) {
        setLeaderboardPage(page)
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } else {
        setLeaderboardPageInput(String(leaderboardPage))
      }
    }

    const renderLeaderboardPageNumbers = () => {
      const pages: (number | string)[] = []
      if (leaderboardTotalPages <= 7) {
        for (let i = 1; i <= leaderboardTotalPages; i++) {
          pages.push(i)
        }
      } else {
        pages.push(1)
        if (leaderboardPage <= 3) {
          pages.push(2, 3, 4, 5, '...', leaderboardTotalPages)
        } else if (leaderboardPage >= leaderboardTotalPages - 2) {
          pages.push('...', leaderboardTotalPages - 4, leaderboardTotalPages - 3, leaderboardTotalPages - 2, leaderboardTotalPages - 1, leaderboardTotalPages)
        } else {
          pages.push('...', leaderboardPage - 1, leaderboardPage, leaderboardPage + 1, '...', leaderboardTotalPages)
        }
      }
      return pages
    }

    const periodLabel = formatPeriodLabel()

    return (
      <section className="section">
        <div className="section-header">
          <h2>排行榜</h2>
        </div>

        <div className="leaderboard-filters">
          <button
            className={`filter-tab ${leaderboardType === 'total' ? 'active' : ''}`}
            onClick={() => {
              setLeaderboardType('total')
              setLeaderboardPage(1)
              setLeaderboardPageInput('1')
            }}
          >
            <span className="filter-icon">🏆</span>
            <span>总榜</span>
          </button>
          <button
            className={`filter-tab ${leaderboardType === 'weekly' ? 'active' : ''}`}
            onClick={() => {
              setLeaderboardType('weekly')
              setLeaderboardPage(1)
              setLeaderboardPageInput('1')
            }}
          >
            <span className="filter-icon">📈</span>
            <span>周榜</span>
          </button>
          <button
            className={`filter-tab ${leaderboardType === 'monthly' ? 'active' : ''}`}
            onClick={() => {
              setLeaderboardType('monthly')
              setLeaderboardPage(1)
              setLeaderboardPageInput('1')
            }}
          >
            <span className="filter-icon">📊</span>
            <span>月榜</span>
          </button>
        </div>

        {periodLabel && (
          <div className="leaderboard-period">
            {periodLabel}
          </div>
        )}

        {loading ? (
          <p>加载中...</p>
        ) : leaderboard.length === 0 ? (
          <div className="leaderboard-empty">
            <div className="leaderboard-empty-icon">{leaderboardType === 'total' ? '🏆' : leaderboardType === 'weekly' ? '📈' : '📊'}</div>
            <p>{getEmptyMessage()}</p>
          </div>
        ) : (
          <>
            <div className="leaderboard-meta">
              共 {leaderboardTotal} 人参与{leaderboardType === 'weekly' ? '本周' : leaderboardType === 'monthly' ? '本月' : ''}排名
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="leaderboard-table">
                <thead>
                  <tr>
                    <th style={{ width: '80px' }}>排名</th>
                    <th>用户</th>
                    {leaderboardType === 'total' ? (
                      <>
                        <th style={{ textAlign: 'right' }}>等级分</th>
                        <th style={{ textAlign: 'right' }}>解题数</th>
                      </>
                    ) : (
                      <th style={{ textAlign: 'right' }}>通过题目</th>
                    )}
                    <th style={{ textAlign: 'center', width: '100px' }}>变化</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((user) => (
                    <tr
                      key={user.userId}
                      className={`leaderboard-row ${currentUserRank?.userId === user.userId ? 'current-user' : ''} ${user.rank <= 3 ? `top-${user.rank}` : ''}`}
                    >
                      <td>
                        <span className="rank-medal">{getRankMedal(user.rank)}</span>
                      </td>
                      <td>
                        <div
                          className="leaderboard-user-cell"
                          style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}
                          onClick={() => navigate(`/account?user=${user.userId}`)}
                        >
                          <div
                            style={{
                              width: '32px',
                              height: '32px',
                              borderRadius: '50%',
                              background: user.avatar ? 'transparent' : 'rgba(79, 195, 247, 0.25)',
                              display: 'grid',
                              placeItems: 'center',
                              fontSize: '14px',
                              fontWeight: 600,
                              color: '#d8f2ff',
                              overflow: 'hidden',
                              flexShrink: 0
                            }}
                          >
                            {user.avatar ? (
                              <img src={user.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            ) : (
                              user.userName.charAt(0).toUpperCase()
                            )}
                          </div>
                          <div>
                            <div style={{ fontWeight: 500 }}>{user.userName}</div>
                            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>@{user.userId}</div>
                          </div>
                        </div>
                      </td>
                      {leaderboardType === 'total' ? (
                        <>
                          <td style={{ textAlign: 'right', fontWeight: 600, color: '#4fc3f7' }}>
                            {user.value?.toFixed(1)}
                          </td>
                          <td style={{ textAlign: 'right', color: 'var(--muted)' }}>
                            {(user as any).solvedCount ?? '-'}
                          </td>
                        </>
                      ) : (
                        <td style={{ textAlign: 'right', fontWeight: 600, color: '#4fc3f7' }}>
                          {user.value}
                        </td>
                      )}
                      <td style={{ textAlign: 'center' }}>
                        {getRankChange(user.rankChange)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {leaderboardTotalPages > 1 && (
          <div className="pagination">
            <button
              className="pagination-btn"
              onClick={() => handleLeaderboardPageChange(leaderboardPage - 1)}
              disabled={leaderboardPage === 1}
            >
              上一页
            </button>

            <div className="pagination-numbers">
              {renderLeaderboardPageNumbers().map((page, index) => (
                page === '...' ? (
                  <span key={`ellipsis-${index}`} className="pagination-ellipsis">
                    ...
                  </span>
                ) : (
                  <button
                    key={page}
                    className={`pagination-number ${leaderboardPage === page ? 'active' : ''}`}
                    onClick={() => handleLeaderboardPageChange(page as number)}
                  >
                    {page}
                  </button>
                )
              ))}
            </div>

            <button
              className="pagination-btn"
              onClick={() => handleLeaderboardPageChange(leaderboardPage + 1)}
              disabled={leaderboardPage === leaderboardTotalPages}
            >
              下一页
            </button>

            <div className="pagination-jump">
              <span>跳转到</span>
              <input
                type="text"
                className="pagination-input"
                value={leaderboardPageInput}
                onChange={(e) => handleLeaderboardPageInputChange(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLeaderboardPageInputSubmit()}
              />
              <button className="pagination-go" onClick={handleLeaderboardPageInputSubmit}>
                GO
              </button>
            </div>
          </div>
        )}

        {currentUserRank && (
          <div className="leaderboard-my-rank">
            <div style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '8px' }}>你的排名</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ fontSize: '24px', fontWeight: 700 }}>#{currentUserRank.rank}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px' }}>
                  {leaderboardType === 'total' ? `等级分 ${currentUserRank.value.toFixed(1)}` : `解决 ${currentUserRank.value} 题`}
                  {currentUserRank.rankChange !== null && (
                    <span style={{ marginLeft: '8px', color: currentUserRank.rankChange < 0 ? '#4caf50' : currentUserRank.rankChange > 0 ? '#f44336' : '#999' }}>
                      {currentUserRank.rankChange < 0 ? `↑${Math.abs(currentUserRank.rankChange)}` : currentUserRank.rankChange > 0 ? `↓${currentUserRank.rankChange}` : '—'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    )
  }

  const AdminPage = () => {
    const [adminUsers, setAdminUsers] = useState<UserRecord[]>([])
    const [adminLoading, setAdminLoading] = useState(false)
    const [adminError, setAdminError] = useState('')
    const [adminActionError, setAdminActionError] = useState('')
    const [adminActionMessage, setAdminActionMessage] = useState('')
    const [adminUsersPage, setAdminUsersPage] = useState(1)
    const [adminUsersPageInput, setAdminUsersPageInput] = useState('1')
    const adminUsersPerPage = 20

    const [newUserId, setNewUserId] = useState('')
    const [newUserName, setNewUserName] = useState('')
    const [newUserPassword, setNewUserPassword] = useState('')
    const [newUserIsAdmin, setNewUserIsAdmin] = useState(false)


    const loadAdminUsers = useCallback(async () => {
      setAdminLoading(true)
      setAdminError('')
      const { response, data } = await fetchJson<{ users: UserRecord[]; message?: string }>('/api/admin/users')
      if (!response.ok) {
        setAdminError(data?.message || '无法加载用户')
        setAdminLoading(false)
        return
      }
      setAdminUsers(data?.users || [])
      setAdminLoading(false)
    }, [])

    useEffect(() => {
      if (currentUser?.isAdmin) {
        loadAdminUsers()
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentUser?.isAdmin])

    const handleCreateUser = async () => {
      setAdminActionError('')
      setAdminActionMessage('')
      const { response, data } = await fetchJson<ApiResponse>('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          id: newUserId.trim(),
          name: newUserName.trim(),
          password: newUserPassword,
          isAdmin: newUserIsAdmin,
        }),
      })
      if (!response.ok) {
        setAdminActionError(data?.message || '创建失败')
        return
      }
      setNewUserId('')
      setNewUserName('')
      setNewUserPassword('')
      setNewUserIsAdmin(false)
      setAdminActionMessage('用户已创建')
      loadAdminUsers()
    }

    const handleUserAction = async (url: string, body?: Record<string, unknown>) => {
      setAdminActionError('')
      setAdminActionMessage('')
      const { response, data } = await fetchJson<ApiResponse>(url, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!response.ok) {
        setAdminActionError(data?.message || '操作失败')
        return
      }
      setAdminActionMessage('操作已完成')
      loadAdminUsers()
    }

    const handleDeleteUser = async (id: string) => {
      if (!window.confirm(`确认删除用户 ${id} ?`)) return
      setAdminActionError('')
      setAdminActionMessage('')
      const { response, data } = await fetchJson<ApiResponse>(`/api/admin/users/${id}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        setAdminActionError(data?.message || '删除失败')
        return
      }
      setAdminActionMessage('用户已删除')
      loadAdminUsers()
    }

    const adminUsersTotalPages = Math.ceil(adminUsers.length / adminUsersPerPage)
    const adminUsersStartIndex = (adminUsersPage - 1) * adminUsersPerPage
    const adminUsersEndIndex = adminUsersStartIndex + adminUsersPerPage
    const currentAdminUsers = adminUsers.slice(adminUsersStartIndex, adminUsersEndIndex)

    const handleAdminUsersPageChange = (page: number) => {
      if (page >= 1 && page <= adminUsersTotalPages) {
        setAdminUsersPage(page)
        setAdminUsersPageInput(String(page))
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    }

    const handleAdminUsersPageInputChange = (value: string) => {
      setAdminUsersPageInput(value)
    }

    const handleAdminUsersPageInputSubmit = () => {
      const page = parseInt(adminUsersPageInput)
      if (!isNaN(page) && page >= 1 && page <= adminUsersTotalPages) {
        setAdminUsersPage(page)
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } else {
        setAdminUsersPageInput(String(adminUsersPage))
      }
    }

    const renderAdminUsersPageNumbers = () => {
      const pages: (number | string)[] = []
      if (adminUsersTotalPages <= 7) {
        for (let i = 1; i <= adminUsersTotalPages; i++) {
          pages.push(i)
        }
      } else {
        pages.push(1)
        if (adminUsersPage <= 3) {
          pages.push(2, 3, 4, 5, '...', adminUsersTotalPages)
        } else if (adminUsersPage >= adminUsersTotalPages - 2) {
          pages.push('...', adminUsersTotalPages - 4, adminUsersTotalPages - 3, adminUsersTotalPages - 2, adminUsersTotalPages - 1, adminUsersTotalPages)
        } else {
          pages.push('...', adminUsersPage - 1, adminUsersPage, adminUsersPage + 1, '...', adminUsersTotalPages)
        }
      }
      return pages
    }


    if (!currentUser) {
      return (
        <section className="section">
          <div className="section-header">
            <h2>后台管理</h2>
          </div>
          <p>请先登录并确保拥有管理员权限。</p>
          <button className="primary" onClick={() => openAuth('login')}>
            登录
          </button>
        </section>
      )
    }

    if (!currentUser.isAdmin) {
      return (
        <section className="section">
          <div className="section-header">
            <h2>后台管理</h2>
          </div>
          <p>你没有管理员权限。</p>
        </section>
      )
    }

    const adminCount = adminUsers.filter((user) => user.isAdmin).length
    const bannedCount = adminUsers.filter((user) => user.isBanned).length

    return (
      <div className="admin-page">
        <div className="admin-hero">
          <div>
            <div className="admin-title">星栈后台管理</div>
            <div className="admin-subtitle">用户、题库与测试用例配置</div>
          </div>
          <div className="admin-actions">
            <button className="ghost" onClick={loadAdminUsers} disabled={adminLoading}>
              刷新用户
            </button>
          </div>
        </div>

        <div className="admin-summary">
          <div className="summary-card">
            <div className="summary-label">Users</div>
            <div className="summary-value">{adminUsers.length}</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">Admins</div>
            <div className="summary-value">{adminCount}</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">Banned</div>
            <div className="summary-value">{bannedCount}</div>
          </div>
        </div>

        <section className="admin-section">
          <div className="admin-list-header">
            <div>用户管理</div>
          </div>
          {adminError && <div className="auth-error">{adminError}</div>}
          {adminActionError && <div className="auth-error">{adminActionError}</div>}
          {adminActionMessage && <div className="auth-success">{adminActionMessage}</div>}
          <div className="admin-form">
            <label>
              新用户 ID
              <input
                className="auth-input"
                value={newUserId}
                onChange={(event) => setNewUserId(event.target.value)}
              />
            </label>
            <label>
              名称
              <input
                className="auth-input"
                value={newUserName}
                onChange={(event) => setNewUserName(event.target.value)}
              />
            </label>
            <label>
              初始密码
              <input
                className="auth-input"
                type="password"
                value={newUserPassword}
                onChange={(event) => setNewUserPassword(event.target.value)}
              />
            </label>
            <label className="admin-checkbox">
              <input
                type="checkbox"
                checked={newUserIsAdmin}
                onChange={(event) => setNewUserIsAdmin(event.target.checked)}
              />
              设为管理员
            </label>
            <button className="primary" onClick={handleCreateUser}>
              创建用户
            </button>
          </div>

          <div className="admin-table">
            <div className="admin-row admin-row-head">
              <div>ID</div>
              <div>名称</div>
              <div>角色</div>
              <div>状态</div>
              <div>创建时间</div>
              <div>操作</div>
            </div>
            {currentAdminUsers.map((user) => (
              <div key={user.id} className="admin-row">
                <div>{user.id}</div>
                <div>{user.name}</div>
                <div>{user.isAdmin ? '管理员' : '用户'}</div>
                <div className={user.isBanned ? 'status-banned' : 'status-normal'}>
                  {user.isBanned ? '封禁' : '正常'}
                </div>
                <div>{user.createdAt ? new Date(user.createdAt).toLocaleString() : '-'}</div>
                <div className="admin-row-actions">
                  {!user.isAdmin && (
                    <button
                      className="ghost small"
                      onClick={() => handleUserAction(`/api/admin/users/${user.id}/promote`)}
                    >
                      提升管理员
                    </button>
                  )}
                  {user.isAdmin && (
                    <button
                      className="ghost small"
                      onClick={() => handleUserAction(`/api/admin/users/${user.id}/demote`)}
                    >
                      降为普通
                    </button>
                  )}
                  <button
                    className="ghost small"
                    onClick={() => {
                      const password = window.prompt('新密码（至少 6 位）')
                      if (!password) return
                      handleUserAction(`/api/admin/users/${user.id}/reset-password`, {
                        password,
                      })
                    }}
                  >
                    重置密码
                  </button>
                  <button
                    className="ghost small"
                    onClick={() =>
                      handleUserAction(`/api/admin/users/${user.id}/ban`, {
                        banned: !user.isBanned,
                      })
                    }
                  >
                    {user.isBanned ? '解除封禁' : '封禁'}
                  </button>
                  <button className="danger small" onClick={() => handleDeleteUser(user.id)}>
                    删除
                  </button>
                </div>
              </div>
            ))}
            {adminUsers.length === 0 && !adminLoading && (
              <div className="admin-empty">暂无用户数据</div>
            )}
          </div>

          {adminUsersTotalPages > 1 && (
            <div className="pagination">
              <button
                className="pagination-btn"
                onClick={() => handleAdminUsersPageChange(adminUsersPage - 1)}
                disabled={adminUsersPage === 1}
              >
                上一页
              </button>

              <div className="pagination-numbers">
                {renderAdminUsersPageNumbers().map((page, index) => (
                  page === '...' ? (
                    <span key={`ellipsis-${index}`} className="pagination-ellipsis">
                      ...
                    </span>
                  ) : (
                    <button
                      key={page}
                      className={`pagination-number ${adminUsersPage === page ? 'active' : ''}`}
                      onClick={() => handleAdminUsersPageChange(page as number)}
                    >
                      {page}
                    </button>
                  )
                ))}
              </div>

              <button
                className="pagination-btn"
                onClick={() => handleAdminUsersPageChange(adminUsersPage + 1)}
                disabled={adminUsersPage === adminUsersTotalPages}
              >
                下一页
              </button>

              <div className="pagination-jump">
                <span>跳转到</span>
                <input
                  type="text"
                  className="pagination-input"
                  value={adminUsersPageInput}
                  onChange={(e) => handleAdminUsersPageInputChange(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdminUsersPageInputSubmit()}
                />
                <button className="pagination-go" onClick={handleAdminUsersPageInputSubmit}>
                  GO
                </button>
              </div>
            </div>
          )}
        </section>

      </div>
    )
  }

  const OjHomePage = () => {
    const [quickJumpId, setQuickJumpId] = useState('')
    const [recommendations, setRecommendations] = useState<OjProblemSummary[]>([])
    const [hotProblems, setHotProblems] = useState<Array<{
      id: number
      slug?: string
      title: string
      difficulty: string
      submission_count: number
    }>>([])
    const [recentAC, setRecentAC] = useState<Array<{
      created_at: string
      user_name: string
      avatar?: string
      problem_id: number
      problem_title: string
    }>>([])
    const [weeklyStats, setWeeklyStats] = useState<Array<{
      date: string
      submissions: number
      accepted: number
    }>>([])
    const [chartTooltip, setChartTooltip] = useState<{
      visible: boolean
      x: number
      y: number
      date: string
      submissions: number
      accepted: number
    } | null>(null)
    const [randomDifficulty, setRandomDifficulty] = useState('')
    const [loading, setLoading] = useState(true)

    // 加载所有数据
    useEffect(() => {
      loadAllData()
    }, [])

    const loadAllData = async () => {
      setLoading(true)
      await Promise.all([
        loadRecommendations(),
        loadHotProblems(),
        loadRecentAC(),
        loadWeeklyStats()
      ])
      setLoading(false)
    }

    const loadWeeklyStats = async () => {
      if (!currentUser?.id) {
        // 未登录用户显示空数据
        setWeeklyStats([])
        return
      }
      const { data } = await fetchJson<{
        weeklyStats: Array<{
          date: string
          submissions: number
          accepted: number
        }>
      }>(`/api/user/weekly-stats/${currentUser.id}`)
      if (data?.weeklyStats) {
        setWeeklyStats(data.weeklyStats)
      }
    }

    const loadRecommendations = async () => {
      const { data } = await fetchJson<{ recommendations: OjProblemSummary[] }>('/api/oj/recommendations')
      if (data?.recommendations) {
        setRecommendations(data.recommendations)
      }
    }

    const loadHotProblems = async () => {
      const { data } = await fetchJson<{
        hotProblems: Array<{
          id: number
          slug?: string
          title: string
          difficulty: string
          submission_count: number
        }>
      }>('/api/oj/hot-problems')
      if (data?.hotProblems) {
        setHotProblems(data.hotProblems)
      }
    }

    const loadRecentAC = async () => {
      const { data } = await fetchJson<{
        recentAC: Array<{
          created_at: string
          user_name: string
          avatar?: string
          problem_id: number
          problem_title: string
        }>
      }>('/api/oj/recent-ac')
      if (data?.recentAC) {
        setRecentAC(data.recentAC)
      }
    }

    const handleQuickJump = useCallback(() => {
      const value = quickJumpId.trim().toLowerCase()
      if (!value) return
      const match = value.match(/\d+/)
      if (!match) return
      const numericId = match[0]
      navigate(`/oj/p${numericId}`)
    }, [quickJumpId])

    const handleRandomProblem = async () => {
      const params = randomDifficulty ? `?difficulty=${randomDifficulty}` : ''
      const { data } = await fetchJson<{ problem: OjProblemSummary }>(`/api/oj/random-problem${params}`)
      if (data?.problem) {
        navigate(`/oj/p${data.problem.id}`)
      }
    }

    const formatTimeAgo = (dateString: string) => {
      const now = new Date()
      const date = new Date(dateString)
      const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)

      if (seconds < 60) return '刚刚'
      if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟前`
      if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时前`
      return `${Math.floor(seconds / 86400)}天前`
    }

    return (
      <div className="oj-page">
        <div className="oj-hero">
          <div>
            <h2>星栈算法测评</h2>
            <p className="oj-hero-desc">
              面向算法训练与竞赛评测的专业平台，题库覆盖多难度梯度与稳定判题环境，
              支持多语言提交与结果回放，助力高强度训练与持续优化。
            </p>
          </div>
          <div className="hero-actions">
            <button className="primary" onClick={() => navigate('/oj/list')}>
              进入题库
            </button>
          </div>
        </div>

        {loading ? (
          <div className="oj-loading">加载中...</div>
        ) : (
          <div className="oj-home-content">
            <div className="oj-home-main">
              {/* 顶部工具栏 */}
              <div className="oj-home-toolbar">
                {/* 题目跳转 */}
                <div className="oj-quick-jump">
                  <div className="oj-quick-jump-title">题目跳转</div>
                  <input
                    className="auth-input small"
                    placeholder="输入题号，例如 1001"
                    value={quickJumpId}
                    onChange={(e) => setQuickJumpId(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleQuickJump()
                      }
                    }}
                  />
                  <div className="oj-quick-jump-buttons">
                    <button className="primary small" onClick={handleQuickJump}>
                      跳转
                    </button>
                    <button className="ghost small" onClick={handleRandomProblem}>
                      随机一题
                    </button>
                  </div>
                </div>

                {/* 7天统计图表 */}
                <div className="oj-weekly-chart">
                  <div className="oj-weekly-chart-title">近10天做题统计</div>
                  <div className="oj-weekly-chart-container">
                    <svg
                      width="100%"
                      height="90"
                      viewBox="0 0 600 90"
                      preserveAspectRatio="xMidYMid meet"
                      onMouseMove={(e) => {
                        if (weeklyStats.length === 0) return

                        const svgRect = e.currentTarget.getBoundingClientRect()
                        const mouseX = e.clientX - svgRect.left

                        // 转换为SVG坐标
                        const svgX = (mouseX / svgRect.width) * 600

                        // 计算参数
                        const barWidth = 22
                        const spacing = 52
                        const startX = 50

                        // 找到最近的日期索引
                        let closestIndex = 0
                        let minDistance = Infinity

                        weeklyStats.forEach((stat, index) => {
                          const barCenterX = startX + index * spacing + barWidth / 2
                          const distance = Math.abs(svgX - barCenterX)
                          if (distance < minDistance) {
                            minDistance = distance
                            closestIndex = index
                          }
                        })

                        const stat = weeklyStats[closestIndex]
                        const date = new Date(stat.date)
                        const dateLabel = `${date.getMonth() + 1}月${date.getDate()}日`

                        setChartTooltip({
                          visible: true,
                          x: e.clientX,
                          y: e.clientY - 10,
                          date: dateLabel,
                          submissions: stat.submissions,
                          accepted: stat.accepted
                        })
                      }}
                      onMouseLeave={() => setChartTooltip(null)}
                    >
                      {/* 网格线 */}
                      <line x1="50" y1="10" x2="50" y2="57" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
                      <line x1="50" y1="57" x2="570" y2="57" stroke="rgba(255,255,255,0.15)" strokeWidth="2" />

                      {/* Y轴刻度线 */}
                      <line x1="50" y1="10" x2="570" y2="10" stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="3,3" />
                      <line x1="50" y1="22" x2="570" y2="22" stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="3,3" />
                      <line x1="50" y1="34" x2="570" y2="34" stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="3,3" />
                      <line x1="50" y1="46" x2="570" y2="46" stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="3,3" />

                      {weeklyStats.length > 0 ? (
                        <>
                          {/* 计算最大值用于缩放 */}
                          {(() => {
                            const maxSubmissions = Math.max(...weeklyStats.map(d => d.submissions), 1)
                            const maxAccepted = Math.max(...weeklyStats.map(d => d.accepted), 1)
                            const maxValue = Math.max(maxSubmissions, maxAccepted, 3)
                            const barWidth = 22
                            const spacing = 52

                            // 生成折线图路径
                            const linePoints = weeklyStats.map((stat, index) => {
                              const x = 61 + index * spacing
                              const y = 57 - (stat.accepted / maxValue) * 45
                              return { x, y, stat, index }
                            })

                            const linePath = linePoints.map((p, i) =>
                              `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`
                            ).join(' ')

                            return (
                              <>
                                {/* 柱形图 - 提交数 */}
                                {weeklyStats.map((stat, index) => {
                                  const height = (stat.submissions / maxValue) * 45
                                  const x = 50 + index * spacing
                                  const y = 57 - height
                                  const date = new Date(stat.date)
                                  const dateLabel = `${date.getMonth() + 1}月${date.getDate()}日`

                                  return (
                                    <g key={`bar-${index}`}>
                                      <rect
                                        x={x}
                                        y={y}
                                        width={barWidth}
                                        height={Math.max(height, 2)}
                                        fill="rgba(79, 195, 247, 0.85)"
                                        rx="3"
                                        style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
                                        className="chart-bar"
                                      />
                                    </g>
                                  )
                                })}

                                {/* 折线图 - 通过数 */}
                                {linePoints.length > 1 && (
                                  <path
                                    d={linePath}
                                    fill="none"
                                    stroke="rgba(76, 209, 55, 1)"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                )}

                                {/* 折线图的点 */}
                                {linePoints.map(({ x, y, stat, index }) => {
                                  const date = new Date(stat.date)
                                  const dateLabel = `${date.getMonth() + 1}月${date.getDate()}日`

                                  return (
                                    <g key={`point-${index}`}>
                                      {/* 主圆点 */}
                                      <circle
                                        cx={x}
                                        cy={y}
                                        r="3.5"
                                        fill="rgba(76, 209, 55, 1)"
                                        stroke="rgba(255, 255, 255, 1)"
                                        strokeWidth="1.5"
                                        className="chart-point"
                                      />
                                      {/* 外圈光晕 - 用于扩大交互区域 */}
                                      <circle
                                        cx={x}
                                        cy={y}
                                        r="10"
                                        fill="transparent"
                                        style={{ cursor: 'pointer' }}
                                      />
                                    </g>
                                  )
                                })}

                                {/* X轴标签（日期） */}
                                {weeklyStats.map((stat, index) => {
                                  const x = 61 + index * spacing
                                  const date = new Date(stat.date)
                                  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
                                  const weekday = weekdays[date.getDay()]
                                  const label = `${date.getMonth() + 1}/${date.getDate()}`

                                  return (
                                    <g key={`label-${index}`}>
                                      <text
                                        x={x}
                                        y="66"
                                        fill="rgba(255, 255, 255, 0.6)"
                                        fontSize="9"
                                        fontWeight="500"
                                        textAnchor="middle"
                                      >
                                        {label}
                                      </text>
                                      <text
                                        x={x}
                                        y="73"
                                        fill="rgba(255, 255, 255, 0.4)"
                                        fontSize="7"
                                        textAnchor="middle"
                                      >
                                        {weekday}
                                      </text>
                                    </g>
                                  )
                                })}

                                {/* Y轴刻度标签 */}
                                <text x="42" y="12" fill="rgba(255, 255, 255, 0.4)" fontSize="8" textAnchor="end">{maxValue}</text>
                                <text x="42" y="35" fill="rgba(255, 255, 255, 0.4)" fontSize="8" textAnchor="end">{Math.ceil(maxValue / 2)}</text>
                                <text x="42" y="59" fill="rgba(255, 255, 255, 0.4)" fontSize="8" textAnchor="end">0</text>
                              </>
                            )
                          })()}
                        </>
                      ) : (
                        <text x="300" y="40" fill="rgba(255, 255, 255, 0.3)" fontSize="11" textAnchor="middle">
                          {currentUser ? '暂无数据' : '登录后查看'}
                        </text>
                      )}

                      {/* 图例 */}
                      <g transform="translate(220, 81)">
                        <rect x="0" y="-3" width="10" height="7" fill="rgba(79, 195, 247, 0.85)" rx="1.5" />
                        <text x="13" y="2" fill="rgba(255, 255, 255, 0.7)" fontSize="9">提交数</text>

                        <line x1="68" y1="0.5" x2="82" y2="0.5" stroke="rgba(76, 209, 55, 1)" strokeWidth="2" strokeLinecap="round" />
                        <circle cx="75" cy="0.5" r="3" fill="rgba(76, 209, 55, 1)" stroke="rgba(255, 255, 255, 1)" strokeWidth="1.5" />
                        <text x="85" y="2" fill="rgba(255, 255, 255, 0.7)" fontSize="9">通过数</text>
                      </g>
                    </svg>
                  </div>

                  {/* Tooltip - 渲染在外层 */}
                  {chartTooltip && (
                    <div
                      className="chart-tooltip"
                      style={{
                        left: `${chartTooltip.x}px`,
                        top: `${chartTooltip.y}px`,
                        position: 'fixed'
                      }}
                    >
                      <div className="chart-tooltip-date">{chartTooltip.date}</div>
                      <div className="chart-tooltip-item">
                        <span className="chart-tooltip-dot submissions"></span>
                        <span className="chart-tooltip-label">提交</span>
                        <span className="chart-tooltip-value">{chartTooltip.submissions}</span>
                      </div>
                      <div className="chart-tooltip-item">
                        <span className="chart-tooltip-dot accepted"></span>
                        <span className="chart-tooltip-label">通过</span>
                        <span className="chart-tooltip-value">{chartTooltip.accepted}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 每日推荐 */}
              <section className="oj-home-section">
                <div className="oj-home-section-header">
                  <h3>🎯 为你推荐</h3>
                  <button className="ghost small" onClick={loadRecommendations}>
                    换一批
                  </button>
                </div>
                {recommendations.length > 0 ? (
                  <>
                    <div className="oj-recommendations">
                      {recommendations.map((problem) => (
                        <div
                          key={problem.id}
                          className="oj-recommendation-card"
                          onClick={() => navigate(`/oj/p${problem.id}`)}
                        >
                          <div className="oj-recommendation-header">
                            <span className="oj-code-label">P{problem.id}</span>
                            <span className={`oj-badge ${problem.difficulty}`}>
                              {problem.difficulty}
                            </span>
                          </div>
                          <div className="oj-recommendation-title">{problem.title}</div>
                          <div className="oj-recommendation-tags">
                            {problem.tags.slice(0, 3).map((tag) => (
                              <span key={tag} className="oj-tag-small">
                                {tag}
                              </span>
                            ))}
                          </div>
                          <div className="oj-recommendation-footer">
                            <span className="oj-pass-rate">
                              通过率 {(problem as any).passRate || 0}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="oj-recommendation-hint">
                      基于你最近做过的标签推荐
                    </div>
                  </>
                ) : (
                  <div className="oj-empty-state">暂无推荐，去做几道题吧！</div>
                )}
              </section>

              {/* 实时动态 */}
              <section className="oj-home-section">
                <h3>🌊 实时动态</h3>
                {recentAC.length > 0 ? (
                  <div className="oj-recent-ac-list">
                    {recentAC.map((ac, index) => (
                      <div key={index} className="oj-recent-ac-item">
                        <div className="oj-recent-ac-avatar">
                          {ac.avatar ? (
                            <img src={ac.avatar} alt={ac.user_name} />
                          ) : (
                            <div className="oj-recent-ac-avatar-placeholder">
                              {ac.user_name.charAt(0).toUpperCase()}
                            </div>
                          )}
                        </div>
                        <div className="oj-recent-ac-content">
                          <span className="oj-recent-ac-user">{ac.user_name}</span>
                          <span className="oj-recent-ac-text">通过了</span>
                          <span
                            className="oj-recent-ac-problem"
                            onClick={() => navigate(`/oj/p${ac.problem_id}`)}
                          >
                            {ac.problem_title}
                          </span>
                        </div>
                        <div className="oj-recent-ac-time">
                          {formatTimeAgo(ac.created_at)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="oj-empty-state">暂无动态</div>
                )}
              </section>
            </div>

            <div className="oj-home-sidebar">
              {/* 做题计划 */}
              <section className="oj-home-section">
                <h3>📝 做题计划 ({problemPlan.filter(p => !p.completed).length})</h3>
                {problemPlan.length === 0 ? (
                  <div className="problem-plan-empty">暂无计划，去题库添加吧！</div>
                ) : (
                  <div className="problem-plan-list">
                    {problemPlan.map(plan => (
                      <div key={plan.id} className={`problem-plan-item ${plan.completed ? 'completed' : ''}`}>
                        <div className="problem-plan-item-header">
                          <input
                            type="checkbox"
                            checked={!!plan.completed}
                            onChange={(e) => togglePlanComplete(plan.id, e.target.checked)}
                          />
                          <span
                            className="problem-plan-item-title"
                            onClick={() => navigate(`/oj/p${plan.problem_id}`)}
                            style={{ cursor: 'pointer' }}
                          >
                            {plan.title}
                          </span>
                        </div>
                        <div className="problem-plan-item-meta">
                          <span className={`difficulty-tag ${plan.difficulty}`}>{plan.difficulty}</span>
                          <button
                            className="problem-plan-remove"
                            onClick={() => removeFromPlan(plan.id)}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* 热门题目 */}
              <section className="oj-home-section">
                <h3>🔥 热门题目</h3>
                {hotProblems.length > 0 ? (
                  <div className="oj-hot-problems">
                    {hotProblems.map((problem, index) => (
                      <div
                        key={problem.id}
                        className="oj-hot-problem-item"
                        onClick={() => navigate(`/oj/p${problem.id}`)}
                      >
                        <div className="oj-hot-problem-rank">{index + 1}</div>
                        <div className="oj-hot-problem-content">
                          <div className="oj-hot-problem-title">{problem.title}</div>
                          <div className="oj-hot-problem-meta">
                            <span className={`oj-badge ${problem.difficulty}`}>
                              {problem.difficulty}
                            </span>
                            <span className="oj-hot-problem-count">
                              {problem.submission_count} 次提交
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="oj-empty-state">暂无数据</div>
                )}
              </section>
            </div>
          </div>
        )}
      </div>
    )
  }

  const OjProblemListPage = () => {
    const [search, setSearch] = useState('')
    const [difficulty, setDifficulty] = useState('')
    const [tag, setTag] = useState<string[]>([])
    const [problemList, setProblemList] = useState<OjProblemSummary[]>([])
    const [problemLoading, setProblemLoading] = useState(false)
    const [problemError, setProblemError] = useState('')
    const [currentPage, setCurrentPage] = useState(1)
    const [pageInput, setPageInput] = useState('1')
    const itemsPerPage = 20

    const loadProblems = useCallback(async () => {
      setProblemLoading(true)
      setProblemError('')
      const params = new URLSearchParams()
      if (search.trim()) params.set('search', search.trim())
      if (difficulty) params.set('difficulty', difficulty)
      if (tag.length > 0) params.set('tag', tag.join(','))
      const { response, data } = await fetchJson<ProblemsResponse>(`/api/oj/problems?${params.toString()}`)
      if (!response.ok) {
        setProblemError(data?.message || '无法加载题目')
        setProblemLoading(false)
        return
      }
      setProblemList(data?.problems || [])
      setProblemLoading(false)
      setCurrentPage(1)
      setPageInput('1')
    }, [difficulty, search, tag])

    useEffect(() => {
      loadProblems()
    }, [loadProblems])

    // 计算分页
    const totalPages = Math.ceil(problemList.length / itemsPerPage)
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    const currentProblems = problemList.slice(startIndex, endIndex)

    const handlePageChange = (page: number) => {
      if (page >= 1 && page <= totalPages) {
        setCurrentPage(page)
        setPageInput(String(page))
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    }

    const handlePageInputChange = (value: string) => {
      setPageInput(value)
    }

    const handlePageInputSubmit = () => {
      const page = parseInt(pageInput)
      if (!isNaN(page) && page >= 1 && page <= totalPages) {
        setCurrentPage(page)
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } else {
        setPageInput(String(currentPage))
      }
    }

    const renderPageNumbers = () => {
      const pages: (number | string)[] = []

      if (totalPages <= 7) {
        // 总页数少于等于7页，全部显示
        for (let i = 1; i <= totalPages; i++) {
          pages.push(i)
        }
      } else {
        // 总页数大于7页，显示省略号
        pages.push(1)

        if (currentPage <= 3) {
          // 当前页在前面
          pages.push(2, 3, 4, 5, '...', totalPages)
        } else if (currentPage >= totalPages - 2) {
          // 当前页在后面
          pages.push('...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages)
        } else {
          // 当前页在中间
          pages.push('...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages)
        }
      }

      return pages
    }

    return (
      <div className="oj-page">
        <div className="oj-filters">
          <input
            className="auth-input"
            placeholder="搜索题目"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            className="auth-input"
            value={difficulty}
            onChange={(event) => setDifficulty(event.target.value)}
          >
            <option value="">全部难度</option>
            {DIFFICULTY_OPTIONS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <button className="primary" onClick={loadProblems}>
            搜索
          </button>
        </div>
        <div className="oj-tag-filter">
          <label className="filter-label">标签过滤</label>
          <TagSelector selectedTags={tag} onTagsChange={setTag} />
        </div>

        {problemError && <div className="auth-error">{problemError}</div>}

        <div className="oj-list">
          {currentProblems.map((problem) => (
            <div
              key={problem.id}
              className="oj-card"
            >
              <div
                className="oj-card-content"
                onClick={() => navigate(`/oj/p${problem.id}`)}
              >
                <div className="oj-card-title">
                  <span className="oj-code-label">p{problem.id}</span>
                  {problem.title}
                </div>
                <div className="oj-card-meta">
                  <span className={`oj-badge ${problem.difficulty}`}>{problem.difficulty}</span>
                  <div className="oj-tags">
                    {problem.tags.map((tagItem) => (
                      <span key={tagItem} className="oj-tag">
                        {tagItem}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              {currentUser && (
                <button
                  className="add-to-plan-btn"
                  onClick={async (e) => {
                    e.stopPropagation()
                    const inPlan = problemPlan.some(p => p.problem_id === problem.id)
                    if (inPlan) {
                      const plan = problemPlan.find(p => p.problem_id === problem.id)
                      if (plan) await removeFromPlan(plan.id)
                    } else {
                      await addToPlan(problem.id)
                    }
                  }}
                  title={problemPlan.some(p => p.problem_id === problem.id) ? "从计划中移除" : "加入做题计划"}
                >
                  {problemPlan.some(p => p.problem_id === problem.id) ? '✓' : '+'}
                </button>
              )}
            </div>
          ))}
          {problemLoading && <div className="admin-empty">加载中...</div>}
          {!problemLoading && problemList.length === 0 && (
            <div className="admin-empty">暂无题目</div>
          )}
        </div>

        {!problemLoading && totalPages > 1 && (
          <div className="pagination">
            <button
              className="pagination-btn"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
            >
              上一页
            </button>

            <div className="pagination-numbers">
              {renderPageNumbers().map((page, index) => (
                page === '...' ? (
                  <span key={`ellipsis-${index}`} className="pagination-ellipsis">
                    ...
                  </span>
                ) : (
                  <button
                    key={page}
                    className={`pagination-number ${currentPage === page ? 'active' : ''}`}
                    onClick={() => handlePageChange(page as number)}
                  >
                    {page}
                  </button>
                )
              ))}
            </div>

            <button
              className="pagination-btn"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
            >
              下一页
            </button>

            <div className="pagination-jump">
              <span>跳转到</span>
              <input
                type="text"
                className="pagination-input"
                value={pageInput}
                onChange={(e) => handlePageInputChange(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handlePageInputSubmit()}
              />
              <button className="pagination-go" onClick={handlePageInputSubmit}>
                GO
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  const OjDetailPage = () => {
    const params = useParams()
    const { pathname } = useLocation()
    const id =
      params.id ??
      params.rawId ??
      (pathname.match(/\/oj\/p\/?(\d+)/)?.[1] ?? '')
    const [problem, setProblem] = useState<OjProblemDetail | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [language, setLanguage] = useState(LANGUAGE_OPTIONS[0].value)
    const [code, setCode] = useState(getLanguageConfig(LANGUAGE_OPTIONS[0].value).template)
    const [submitError, setSubmitError] = useState('')
    const [ideOpen, setIdeOpen] = useState(false)
    const [runBusy, setRunBusy] = useState(false)
    const [runStatus, setRunStatus] = useState('')
    const [runMessage, setRunMessage] = useState('')
    const [runTime, setRunTime] = useState<number | null>(null)
    const [runInput, setRunInput] = useState('')
    const [runOutput, setRunOutput] = useState('')
    const [runExpected, setRunExpected] = useState('')
    const openIde = useCallback(async () => {
      if (!problem) return
      setSubmitError('')
      setIdeOpen(true)
      if (!currentUser) {
        setCode('')
        return
      }
      const { response, data } = await fetchJson<SubmissionResponse>(`/api/oj/submissions/latest?problemId=${problem.id}`)
      if (!response.ok) {
        setCode('')
        return
      }
      const submission = data?.submission
      if (submission?.code) {
        setLanguage(submission.language || language)
        setCode(submission.code)
      } else {
        setCode('')
      }
    }, [language, problem])

    const loadProblem = useCallback(async () => {
      if (!id) return
      setLoading(true)
      setError('')
      const { response, data } = await fetchJson<ProblemResponse>(`/api/oj/problems/${id}`)
      if (!response.ok) {
        setError(data?.message || '无法加载题目')
        setLoading(false)
        return
      }
      if (data?.problem) {
        setProblem(data.problem)
      }
      setLoading(false)
    }, [id])

    useEffect(() => {
      loadProblem()
    }, [loadProblem])

    const updateLanguage = (next: string) => {
      setCode((prev) => {
        const prevTemplate = getLanguageConfig(language).template.trim()
        if (!prev.trim() || prev.trim() === prevTemplate) {
          return getLanguageConfig(next).template
        }
        return prev
      })
      setLanguage(next)
    }

    const handleSubmit = () => {
      if (!problem) return
      if (!currentUser) {
        openAuth('login')
        return
      }
      if (!code.trim()) {
        setSubmitError('请填写代码')
        return
      }
      setSubmitError('')
      navigate('/oj/judge', {
        state: {
          problemId: problem.id,
          problemTitle: problem.title,
          language,
          code,
        },
      })
    }

    const handleRunCustom = async (input: string, expected = '') => {
      if (!problem) return
      if (!currentUser) {
        openAuth('login')
        return
      }
      setRunBusy(true)
      setRunStatus('运行中')
      setRunMessage('')
      setRunTime(null)
      setRunOutput('')
      const { response, data } = await fetchJson<{ status?: string; message?: string; output?: string; timeMs?: number }>('/api/oj/run-custom', {
        method: 'POST',
        body: JSON.stringify({
          problemId: problem.id,
          language,
          code,
          input,
          expected,
        }),
      })
      if (!response.ok) {
        setRunStatus('失败')
        setRunMessage(data?.message || '运行失败')
        setRunBusy(false)
        return
      }
      setRunStatus(data?.status || '完成')
      setRunMessage(data?.message || '')
      setRunOutput(data?.output || '')
      setRunTime(data?.timeMs ?? null)
      setRunBusy(false)
    }

    const handleRunSample = async (index: number) => {
      if (!problem) return
      const sample = problem.samples?.[index]
      if (!sample) return
      if (!ideOpen) {
        await openIde()
      }
      setRunInput(sample.input)
      setRunExpected(sample.output)
      await handleRunCustom(sample.input, sample.output)
    }

    if (loading) {
      return <div className="admin-empty">加载中...</div>
    }

    if (error) {
      return <div className="auth-error">{error}</div>
    }

    if (!problem) {
      return <div className="admin-empty">题目不存在</div>
    }

    return (
      <div className={`oj-detail ${ideOpen ? 'split' : ''}`}>
        {/* 标题区域 - 在最外层 */}
        <div className="oj-detail-title-wrapper">
          <div className="oj-detail-title">
            <span className="oj-code-label">p{problem.id}</span>
            {problem.title}
          </div>
          <div className="oj-detail-meta">
            {problem.tags.map((tagItem) => (
              <span key={tagItem} className="oj-tag">
                {tagItem}
              </span>
            ))}
          </div>
        </div>

        <div className="oj-detail-main">
          <div className="oj-detail-content">
            {/* 题目描述 */}
            <section className="oj-section oj-section-with-actions">
              <div className="oj-section-header-row">
                <h3>题目描述</h3>
                <div className="hero-actions">
                  {currentUser && (
                    <button
                      className="ghost small"
                      onClick={async () => {
                        const inPlan = problemPlan.some(p => p.problem_id === problem.id)
                        if (inPlan) {
                          const plan = problemPlan.find(p => p.problem_id === problem.id)
                          if (plan) await removeFromPlan(plan.id)
                        } else {
                          await addToPlan(problem.id)
                        }
                      }}
                    >
                      {problemPlan.some(p => p.problem_id === problem.id) ? '从计划移除' : '加入计划'}
                    </button>
                  )}
                  <button className="ghost small" onClick={ideOpen ? () => setIdeOpen(false) : openIde}>
                    {ideOpen ? '关闭提交' : '提交'}
                  </button>
                </div>
              </div>
              <div dangerouslySetInnerHTML={{ __html: renderLatex(problem.statement) }} />
            </section>

            {/* 输入说明 */}
            <section className="oj-section">
              <h3>输入格式</h3>
              <div dangerouslySetInnerHTML={{ __html: renderLatex(problem.input) }} />
            </section>

            {/* 输出说明 */}
            <section className="oj-section">
              <h3>输出格式</h3>
              <div dangerouslySetInnerHTML={{ __html: renderLatex(problem.output) }} />
            </section>

            {/* 样例 */}
            <section className="oj-section">
              <h3>输入输出样例</h3>
              <div className="oj-samples">
                {problem.samples.map((item, index) => (
                  <div key={index} className="oj-sample">
                    <div>
                      <div className="oj-sample-title">
                        <span>输入 #{index + 1}</span>
                        <button className="ghost small" onClick={() => handleRunSample(index)}>
                          运行此样例
                        </button>
                      </div>
                      <pre>{item.input}</pre>
                    </div>
                    <div>
                      <div className="oj-sample-title">输出 #{index + 1}</div>
                      <pre>{item.output}</pre>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* 数据范围 */}
            {problem.dataRange && (
              <section className="oj-section">
                <h3>数据范围</h3>
                <div dangerouslySetInnerHTML={{ __html: renderLatex(problem.dataRange) }} />
              </section>
            )}
          </div>

          {/* 右侧边栏 */}
          {!ideOpen && (
            <div className="oj-detail-sidebar">
              <div className="oj-sidebar-section">
                <div className="oj-sidebar-item">
                  <div className="oj-sidebar-label">题号</div>
                  <div className="oj-sidebar-value">P{problem.id}</div>
                </div>
                {problem.creatorName && (
                  <div className="oj-sidebar-item">
                    <div className="oj-sidebar-label">出题人</div>
                    <div className="oj-sidebar-value">{problem.creatorName}</div>
                  </div>
                )}
                <div className="oj-sidebar-item">
                  <div className="oj-sidebar-label">难度</div>
                  <div className="oj-sidebar-value">
                    <span className={`oj-badge ${problem.difficulty}`}>{problem.difficulty}</span>
                  </div>
                </div>
                {problem.maxScore !== null && problem.maxScore !== undefined && (
                  <div className="oj-sidebar-item">
                    <div className="oj-sidebar-label">历史最高分</div>
                    <div className="oj-sidebar-value">{problem.maxScore}</div>
                  </div>
                )}
                <button
                  className="oj-sidebar-button"
                  onClick={() => navigate(`/oj/records/${problem.id}`)}
                >
                  提交记录
                </button>
              </div>
            </div>
          )}
        </div>

        {ideOpen && (
          <div
            className="oj-detail-ide"
            onWheel={(event) => {
              const target = event.target as HTMLElement | null
              if (target && target.closest('.monaco-editor')) return
              event.preventDefault()
              event.stopPropagation()
            }}
          >
            <div className="ide-panel side">
              <div className="ide-header">
                <div className="ide-header-left">
                  <select
                    className="ide-lang-select"
                    value={language}
                    onChange={(event) => updateLanguage(event.target.value)}
                  >
                    {LANGUAGE_OPTIONS.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="ide-header-right">
                  <button className="ide-btn ide-btn-primary" onClick={handleSubmit}>
                    提交
                  </button>
                </div>
              </div>
              <div className="ide-main">
                <div className="ide-editor">
                  <Editor
                    height="100%"
                    language={getLanguageConfig(language).monaco}
                    value={code}
                    onChange={(value) => setCode(value ?? '')}
                    theme="vs-dark"
                    options={{
                      minimap: { enabled: false },
                      fontSize: 14,
                      fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
                      tabSize: 4,
                      insertSpaces: true,
                      detectIndentation: false,
                      automaticLayout: true,
                      scrollBeyondLastLine: false,
                      lineNumbers: 'on',
                      glyphMargin: false,
                      folding: true,
                      lineDecorationsWidth: 0,
                      lineNumbersMinChars: 3,
                      renderLineHighlight: 'line',
                      scrollbar: {
                        verticalScrollbarSize: 8,
                        horizontalScrollbarSize: 8,
                      },
                      // 禁用代码提示
                      quickSuggestions: false,
                      suggestOnTriggerCharacters: false,
                      acceptSuggestionOnCommitCharacter: false,
                      acceptSuggestionOnEnter: 'off',
                      wordBasedSuggestions: 'off',
                    }}
                  />
                </div>
              </div>
              <div className="ide-lab">
                <div className="ide-run">
                  <div className="ide-run-header">
                    <span className="ide-run-title">测试运行</span>
                    <button
                      className="ide-btn ide-btn-secondary"
                      onClick={() => handleRunCustom(runInput, runExpected)}
                      disabled={runBusy}
                    >
                      {runBusy ? '运行中...' : '运行'}
                    </button>
                  </div>
                  <div className="ide-run-grid">
                    <div className="ide-run-pane">
                      <div className="ide-run-pane-title">输入</div>
                      <textarea
                        className="ide-run-input"
                        value={runInput}
                        placeholder="在此输入测试数据"
                        onChange={(event) => {
                          setRunInput(event.target.value)
                          setRunExpected('')
                        }}
                      />
                    </div>
                    <div className="ide-run-pane">
                      <div className="ide-run-pane-title">
                        <span>输出</span>
                        {runExpected && (runStatus || runMessage) && (
                          <span
                            className={`ide-run-status ${
                              runStatus === 'Accepted'
                                ? 'ok'
                                : runStatus === 'Wrong Answer'
                                  ? 'bad'
                                  : runStatus === 'Compile Error'
                                    ? 'warn'
                                    : runStatus === 'Runtime Error'
                                      ? 'runtime'
                                      : ''
                            }`}
                          >
                            {[runStatus, runMessage].filter(Boolean).join(' ')}
                          </span>
                        )}
                      </div>
                      <pre className="ide-run-output">{runOutput || '暂无输出'}</pre>
                    </div>
                  </div>
                  {(runTime !== null || runExpected) && (
                    <div className="ide-run-meta">
                      {runTime !== null && <span>用时: {runTime}ms</span>}
                      {runExpected && <span>期望输出: {runExpected}</span>}
                    </div>
                  )}
                </div>
              </div>
              {submitError && (
                <div className="ide-footer">
                  <div className="ide-error">{submitError}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  const OjJudgePage = () => {
    const params = useParams()
    const navigate = useNavigate()
    const locationState = (location.state || {}) as {
      problemId?: number
      problemTitle?: string
      language?: string
      code?: string
    }
    const submissionId = params.id ? Number(params.id) : null
    const [submission, setSubmission] = useState<OjSubmission | null>(null)
    const [error, setError] = useState('')
    const [stage, setStage] = useState<'idle' | 'running' | 'success' | 'fail'>('idle')
    const [showResults, setShowResults] = useState(false)
    const submitRef = useRef(false)

    const loadSubmission = useCallback(async (idValue: number) => {
      const { response, data } = await fetchJson<SubmissionResponse>(`/api/oj/submissions/${idValue}`)
      if (!response.ok) {
        setError(data?.message || '无法加载提交记录')
        return
      }
      if (data?.submission) {
        setSubmission(data.submission)
        setStage(data.submission?.status === 'Accepted' ? 'success' : 'fail')
        setShowResults(true)
      }
    }, [])

    const submitJudge = useCallback(async () => {
      if (submitRef.current) return
      submitRef.current = true
      if (!locationState.problemId || !locationState.language || !locationState.code) {
        return
      }
      setStage('running')
      setError('')
      setShowResults(false)
      const { response, data } = await fetchJson<SubmissionResponse>('/api/oj/submissions', {
        method: 'POST',
        body: JSON.stringify({
          problemId: locationState.problemId,
          language: locationState.language,
          code: locationState.code,
        }),
      })
      if (!response.ok) {
        setError(data?.message || '评测失败')
        setStage('fail')
        setShowResults(true)
        return
      }
      if (data?.submission) {
        setSubmission(data.submission)
        const accepted = data.submission?.status === 'Accepted'
        setStage(accepted ? 'success' : 'fail')

        // 提交成功后立即跳转到独立的提交记录页面，防止刷新重复评测
        navigate(`/oj/judge/${data.submission.id}`, { replace: true })

        setTimeout(() => {
          setShowResults(true)
        }, 1100)
      }
    }, [locationState.code, locationState.language, locationState.problemId, navigate])

    useEffect(() => {
      // 如果有 submissionId，说明是查看已有提交，直接加载
      if (submissionId) {
        loadSubmission(submissionId)
        return
      }
      // 如果有 state 数据且没有 submissionId，说明是新提交
      if (locationState.problemId && locationState.language && locationState.code) {
        submitJudge()
        return
      }
    }, [
      loadSubmission,
      locationState.code,
      locationState.language,
      locationState.problemId,
      submissionId,
      submitJudge,
    ])

    const results = submission?.results || []
    const animClass =
      stage === 'running' ? 'launch' : stage === 'success' ? 'success' : stage === 'fail' ? 'fail' : ''
    const fireworkParticles = useMemo(
      () =>
        Array.from({ length: 28 }, (_, index) => {
          const angle = (index / 28) * Math.PI * 2
          const radius = 46 + (index % 4) * 14
          return {
            dx: Math.cos(angle) * radius,
            dy: Math.sin(angle) * radius,
            size: index % 5 === 0 ? 7 : index % 3 === 0 ? 5 : 4,
            delay: (index % 7) * 0.04,
            hue: 190 + (index * 17) % 130,
          }
        }),
      []
    )

    return (
      <section className="section">
        <div className="section-header">
          <h2>评测结果</h2>
          {submission?.problemId && (
            <button
              className="primary"
              onClick={() => navigate(`/oj/p${submission.problemId}`)}
            >
              返回题目
            </button>
          )}
        </div>
        {error && <div className="auth-error">{error}</div>}
        <div className="judge-hero">
          <div className={`submit-anim ${animClass}`}>
            <div className="rocket">
              <div className="rocket-body">
                <div className="rocket-window" />
                <div className="rocket-fin left" />
                <div className="rocket-fin right" />
              </div>
              <div className="rocket-flame" />
              <div className="rocket-trail" />
            </div>
            <div className="fireworks">
              <div className="firework-core" />
              <div className="firework-ring ring-a" />
              <div className="firework-ring ring-b" />
              <div className="firework-halo" />
              {fireworkParticles.map((particle, index) => (
                <span
                  key={index}
                  style={
                    {
                      '--dx': `${particle.dx}px`,
                      '--dy': `${particle.dy}px`,
                      '--size': `${particle.size}px`,
                      '--delay': `${particle.delay}s`,
                      '--hue': particle.hue,
                    } as CSSProperties
                  }
                />
              ))}
            </div>
            <div className="crash-smoke">
              <span />
              <span />
              <span />
            </div>
            {stage === 'success' && showResults && (
              <div className="judge-result-text accepted">ACCEPTED</div>
            )}
            {stage === 'fail' && showResults && (
              <div className="judge-result-text wrong">WRONG</div>
            )}
          </div>
          <div className="judge-status">
            <div className="judge-status-title">状态</div>
            <div className="judge-status-main">
              {submission?.status || (stage === 'running' ? '评测中' : '等待提交')}
            </div>
            {submission?.message && <div className="judge-status-message">{submission.message}</div>}
            {submission?.score !== undefined && (
              <div className={`judge-status-score ${submission.score === 100 ? 'score-perfect' : 'score-partial'}`}>
                得分: {submission.score}
              </div>
            )}
            {!submission && stage === 'running' && <div className="judge-status-wait">正在判题</div>}
          </div>
        </div>

        {showResults && (
          <div className="submit-results">
            <div className="submit-results-title">测试点结果</div>
            <div className="submit-results-grid">
              {results.length === 0 && <div className="admin-empty">暂无测试点结果</div>}
              {results.map((item) => (
                <div
                  key={`${item.index}-${item.status}`}
                  className={`submit-result ${item.status === 'Accepted' ? 'ok' : 'bad'}`}
                >
                  <div>测试点 {item.index + 1}</div>
                  <div>{item.status}</div>
                  {item.timeMs !== undefined && <div>{item.timeMs}ms</div>}
                  {item.message && <div className="submit-result-message">{item.message}</div>}
                </div>
              ))}
            </div>
            {submission?.canViewCode && submission?.code && (
              <>
                <div className="submit-results-title" style={{ marginTop: '20px' }}>
                  源代码
                </div>
                <pre className="submission-code">{submission.code}</pre>
              </>
            )}
          </div>
        )}
      </section>
    )
  }

  const OjProblemRecordsPage = () => {
    const { id } = useParams()
    const navigate = useNavigate()
    const [userFilter, setUserFilter] = useState('')
    const [records, setRecords] = useState<OjSubmission[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [recordsPage, setRecordsPage] = useState(1)
    const [recordsPageInput, setRecordsPageInput] = useState('1')
    const recordsPerPage = 20

    const loadRecords = useCallback(async () => {
      if (!id) return
      setLoading(true)
      setError('')
      const params = new URLSearchParams({ problemId: id })
      if (userFilter.trim()) {
        params.set('userId', userFilter.trim())
      }
      const { response, data } = await fetchJson<SubmissionsResponse>(`/api/oj/submissions/all?${params.toString()}`)
      if (!response.ok) {
        setError(data?.message || '无法加载记录')
        setLoading(false)
        return
      }
      setRecords(data?.submissions || [])
      setLoading(false)
    }, [id, userFilter])

    useEffect(() => {
      loadRecords()
    }, [loadRecords])

    const handleRecordClick = (recordId: number) => {
      navigate(`/oj/judge/${recordId}`)
    }

    const recordsTotalPages = Math.ceil(records.length / recordsPerPage)
    const recordsStartIndex = (recordsPage - 1) * recordsPerPage
    const recordsEndIndex = recordsStartIndex + recordsPerPage
    const currentRecords = records.slice(recordsStartIndex, recordsEndIndex)

    const handleRecordsPageChange = (page: number) => {
      if (page >= 1 && page <= recordsTotalPages) {
        setRecordsPage(page)
        setRecordsPageInput(String(page))
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    }

    const handleRecordsPageInputChange = (value: string) => {
      setRecordsPageInput(value)
    }

    const handleRecordsPageInputSubmit = () => {
      const page = parseInt(recordsPageInput)
      if (!isNaN(page) && page >= 1 && page <= recordsTotalPages) {
        setRecordsPage(page)
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } else {
        setRecordsPageInput(String(recordsPage))
      }
    }

    const renderRecordsPageNumbers = () => {
      const pages: (number | string)[] = []
      if (recordsTotalPages <= 7) {
        for (let i = 1; i <= recordsTotalPages; i++) {
          pages.push(i)
        }
      } else {
        pages.push(1)
        if (recordsPage <= 3) {
          pages.push(2, 3, 4, 5, '...', recordsTotalPages)
        } else if (recordsPage >= recordsTotalPages - 2) {
          pages.push('...', recordsTotalPages - 4, recordsTotalPages - 3, recordsTotalPages - 2, recordsTotalPages - 1, recordsTotalPages)
        } else {
          pages.push('...', recordsPage - 1, recordsPage, recordsPage + 1, '...', recordsTotalPages)
        }
      }
      return pages
    }

    return (
      <section className="section">
        <div className="section-header">
          <h2>提交记录</h2>
          <span className="tag">Records</span>
        </div>
        <div className="oj-record-filters">
          <input
            className="auth-input"
            placeholder="输入用户 ID 过滤"
            value={userFilter}
            onChange={(event) => setUserFilter(event.target.value)}
          />
          <button className="ghost" onClick={loadRecords}>
            搜索
          </button>
          <button className="ghost" onClick={() => navigate(`/oj/p${id}`)}>
            返回题目
          </button>
        </div>
        {error && <div className="auth-error">{error}</div>}
        <div className="oj-submissions full">
          <div className="oj-submission head">
            <div>时间</div>
            <div>用户</div>
            <div>语言</div>
            <div>状态</div>
            <div>分数</div>
            <div>耗时</div>
          </div>
          {currentRecords.map((record) => (
            <div
              key={record.id}
              className="oj-submission clickable"
              onClick={() => handleRecordClick(record.id)}
            >
              <div>{formatTime(record.createdAt)}</div>
              <div>
                {record.userName} ({record.userId})
              </div>
              <div>{record.language}</div>
              <div>{record.status}</div>
              <div className={record.score === 100 ? 'score-perfect' : 'score-partial'}>{record.score ?? 0}</div>
              <div>{record.timeMs ? `${record.timeMs}ms` : '-'}</div>
            </div>
          ))}
          {loading && <div className="admin-empty">加载中...</div>}
          {!loading && records.length === 0 && <div className="admin-empty">暂无提交记录</div>}
        </div>

        {recordsTotalPages > 1 && (
          <div className="pagination">
            <button
              className="pagination-btn"
              onClick={() => handleRecordsPageChange(recordsPage - 1)}
              disabled={recordsPage === 1}
            >
              上一页
            </button>

            <div className="pagination-numbers">
              {renderRecordsPageNumbers().map((page, index) => (
                page === '...' ? (
                  <span key={`ellipsis-${index}`} className="pagination-ellipsis">
                    ...
                  </span>
                ) : (
                  <button
                    key={page}
                    className={`pagination-number ${recordsPage === page ? 'active' : ''}`}
                    onClick={() => handleRecordsPageChange(page as number)}
                  >
                    {page}
                  </button>
                )
              ))}
            </div>

            <button
              className="pagination-btn"
              onClick={() => handleRecordsPageChange(recordsPage + 1)}
              disabled={recordsPage === recordsTotalPages}
            >
              下一页
            </button>

            <div className="pagination-jump">
              <span>跳转到</span>
              <input
                type="text"
                className="pagination-input"
                value={recordsPageInput}
                onChange={(e) => handleRecordsPageInputChange(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRecordsPageInputSubmit()}
              />
              <button className="pagination-go" onClick={handleRecordsPageInputSubmit}>
                GO
              </button>
            </div>
          </div>
        )}
      </section>
    )
  }

  const OjSubmissionsPage = () => {
    const navigate = useNavigate()
    const [submissions, setSubmissions] = useState<OjSubmission[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [submissionsPage, setSubmissionsPage] = useState(1)
    const [submissionsPageInput, setSubmissionsPageInput] = useState('1')
    const submissionsPerPage = 20

    const loadSubmissions = useCallback(async () => {
      setLoading(true)
      setError('')
      const { response, data } = await fetchJson<SubmissionsResponse>('/api/oj/submissions')
      if (!response.ok) {
        setError(data?.message || '无法加载提交记录')
        setLoading(false)
        return
      }
      setSubmissions(data?.submissions || [])
      setLoading(false)
    }, [])

    useEffect(() => {
      loadSubmissions()
    }, [loadSubmissions])

    const handleSubmissionClick = (submissionId: number) => {
      navigate(`/oj/judge/${submissionId}`)
    }

    const submissionsTotalPages = Math.ceil(submissions.length / submissionsPerPage)
    const submissionsStartIndex = (submissionsPage - 1) * submissionsPerPage
    const submissionsEndIndex = submissionsStartIndex + submissionsPerPage
    const currentSubmissions = submissions.slice(submissionsStartIndex, submissionsEndIndex)

    const handleSubmissionsPageChange = (page: number) => {
      if (page >= 1 && page <= submissionsTotalPages) {
        setSubmissionsPage(page)
        setSubmissionsPageInput(String(page))
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    }

    const handleSubmissionsPageInputChange = (value: string) => {
      setSubmissionsPageInput(value)
    }

    const handleSubmissionsPageInputSubmit = () => {
      const page = parseInt(submissionsPageInput)
      if (!isNaN(page) && page >= 1 && page <= submissionsTotalPages) {
        setSubmissionsPage(page)
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } else {
        setSubmissionsPageInput(String(submissionsPage))
      }
    }

    const renderSubmissionsPageNumbers = () => {
      const pages: (number | string)[] = []
      if (submissionsTotalPages <= 7) {
        for (let i = 1; i <= submissionsTotalPages; i++) {
          pages.push(i)
        }
      } else {
        pages.push(1)
        if (submissionsPage <= 3) {
          pages.push(2, 3, 4, 5, '...', submissionsTotalPages)
        } else if (submissionsPage >= submissionsTotalPages - 2) {
          pages.push('...', submissionsTotalPages - 4, submissionsTotalPages - 3, submissionsTotalPages - 2, submissionsTotalPages - 1, submissionsTotalPages)
        } else {
          pages.push('...', submissionsPage - 1, submissionsPage, submissionsPage + 1, '...', submissionsTotalPages)
        }
      }
      return pages
    }

    return (
      <section className="section">
        <div className="section-header">
          <h2>我的提交</h2>
          <span className="tag">Submissions</span>
        </div>
        {error && <div className="auth-error">{error}</div>}
        <div className="oj-submissions">
          {currentSubmissions.map((record) => (
            <div
              key={record.id}
              className="oj-submission clickable"
              onClick={() => handleSubmissionClick(record.id)}
            >
              <div>{formatTime(record.createdAt)}</div>
              <div>{record.problemTitle}</div>
              <div>{record.language}</div>
              <div>{record.status}</div>
              <div className={record.score === 100 ? 'score-perfect' : 'score-partial'}>{record.score ?? 0}分</div>
              <div>{record.timeMs ? `${record.timeMs}ms` : '-'}</div>
            </div>
          ))}
          {loading && <div className="admin-empty">加载中...</div>}
          {!loading && submissions.length === 0 && <div className="admin-empty">暂无提交记录</div>}
        </div>

        {submissionsTotalPages > 1 && (
          <div className="pagination">
            <button
              className="pagination-btn"
              onClick={() => handleSubmissionsPageChange(submissionsPage - 1)}
              disabled={submissionsPage === 1}
            >
              上一页
            </button>

            <div className="pagination-numbers">
              {renderSubmissionsPageNumbers().map((page, index) => (
                page === '...' ? (
                  <span key={`ellipsis-${index}`} className="pagination-ellipsis">
                    ...
                  </span>
                ) : (
                  <button
                    key={page}
                    className={`pagination-number ${submissionsPage === page ? 'active' : ''}`}
                    onClick={() => handleSubmissionsPageChange(page as number)}
                  >
                    {page}
                  </button>
                )
              ))}
            </div>

            <button
              className="pagination-btn"
              onClick={() => handleSubmissionsPageChange(submissionsPage + 1)}
              disabled={submissionsPage === submissionsTotalPages}
            >
              下一页
            </button>

            <div className="pagination-jump">
              <span>跳转到</span>
              <input
                type="text"
                className="pagination-input"
                value={submissionsPageInput}
                onChange={(e) => handleSubmissionsPageInputChange(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmissionsPageInputSubmit()}
              />
              <button className="pagination-go" onClick={handleSubmissionsPageInputSubmit}>
                GO
              </button>
            </div>
          </div>
        )}
      </section>
    )
  }

  // === Message List Page ===
  const MessageListPage = () => {
    const [conversations, setConversations] = useState<Conversation[]>([])
    const [loading, setLoading] = useState(true)
    const [showNewChat, setShowNewChat] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [searchResults, setSearchResults] = useState<{ id: string; name: string; avatar?: string }[]>([])
    const [searching, setSearching] = useState(false)

    const loadConversations = useCallback(async () => {
      try {
        const { response, data } = await fetchJson<ConversationsResponse>('/api/messages/conversations')
        if (response.ok && data) {
          setConversations(data.conversations || [])
        }
      } catch (error) {
        console.error('Failed to load conversations:', error)
      } finally {
        setLoading(false)
      }
    }, [])

    useEffect(() => {
      setLoading(true)
      loadConversations()
    }, [loadConversations])

    // Poll conversation list every 10 seconds
    useEffect(() => {
      const interval = setInterval(loadConversations, 10000)
      return () => clearInterval(interval)
    }, [loadConversations])

    // Search users for new conversation
    useEffect(() => {
      if (!searchQuery.trim()) {
        setSearchResults([])
        return
      }
      const timer = setTimeout(async () => {
        setSearching(true)
        try {
          const { response, data } = await fetchJson<{ users: { id: string; name: string; avatar?: string }[] }>(
            `/api/users/search?q=${encodeURIComponent(searchQuery.trim())}`
          )
          if (response.ok && data) {
            setSearchResults(data.users || [])
          }
        } catch {
          // ignore
        } finally {
          setSearching(false)
        }
      }, 300)
      return () => clearTimeout(timer)
    }, [searchQuery])

    const formatTime = (isoString: string) => {
      const date = new Date(isoString)
      const now = new Date()
      const diff = now.getTime() - date.getTime()
      const minutes = Math.floor(diff / 60000)
      const hours = Math.floor(diff / 3600000)
      const days = Math.floor(diff / 86400000)

      if (minutes < 1) return '刚刚'
      if (minutes < 60) return `${minutes}分钟前`
      if (hours < 24) return `${hours}小时前`
      if (days < 7) return `${days}天前`
      return date.toLocaleDateString('zh-CN')
    }

    const stripHtml = (html: string) => {
      const div = document.createElement('div')
      div.innerHTML = html
      return div.textContent || div.innerText || ''
    }

    return (
      <section className="message-list-page">
        <div className="message-list-header">
          <h1>私信</h1>
          <button className="primary new-chat-btn" onClick={() => { setShowNewChat(true); setSearchQuery(''); setSearchResults([]) }}>
            <svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 5v14M5 12h14" /></svg>
            发起私信
          </button>
        </div>

        {loading ? (
          <div className="loading-state">加载中...</div>
        ) : conversations.length === 0 ? (
          <div className="empty-state">
            <svg viewBox="0 0 24 24" width="48" height="48" className="empty-icon">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
            <p>还没有私信记录</p>
            <p className="empty-hint">点击上方「发起私信」搜索用户开始聊天，或在讨论区点击用户头像旁的私信按钮。</p>
          </div>
        ) : (
          <div className="conversation-list">
            {conversations.map((conv) => (
              <div
                key={conv.conversationId}
                className="conversation-card"
                onClick={() => navigate(`/messages/${conv.otherUser.id}`)}
              >
                <div className="conversation-avatar">
                  {conv.otherUser.avatar ? (
                    <img src={conv.otherUser.avatar} alt={conv.otherUser.name} />
                  ) : (
                    <span>{conv.otherUser.name.charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div className="conversation-content">
                  <div className="conversation-header">
                    <span className="conversation-name">{conv.otherUser.name}</span>
                    <span className="conversation-time">{formatTime(conv.lastMessageAt)}</span>
                  </div>
                  {conv.lastMessage && (
                    <div className="conversation-preview">
                      {stripHtml(conv.lastMessage.content).substring(0, 50)}
                      {stripHtml(conv.lastMessage.content).length > 50 ? '...' : ''}
                    </div>
                  )}
                </div>
                {conv.unreadCount > 0 && (
                  <div className="conversation-unread">{conv.unreadCount > 99 ? '99+' : conv.unreadCount}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {showNewChat && (
          <div className="confirm-backdrop" role="dialog" aria-modal="true" onClick={() => setShowNewChat(false)}>
            <div className="confirm-panel new-chat-modal" onClick={e => e.stopPropagation()}>
              <div className="confirm-title">发起私信</div>
              <input
                className="new-chat-search"
                type="text"
                placeholder="搜索用户名或 ID..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                autoFocus
              />
              <div className="new-chat-results">
                {searching ? (
                  <div className="new-chat-hint">搜索中...</div>
                ) : searchQuery.trim() && searchResults.length === 0 ? (
                  <div className="new-chat-hint">未找到用户</div>
                ) : (
                  searchResults.map(u => (
                    <div key={u.id} className="new-chat-user" onClick={() => { setShowNewChat(false); navigate(`/messages/${u.id}`) }}>
                      <div className="conversation-avatar" style={{ width: 36, height: 36, fontSize: 16 }}>
                        {u.avatar ? <img src={u.avatar} alt={u.name} /> : <span>{u.name.charAt(0).toUpperCase()}</span>}
                      </div>
                      <div>
                        <div className="new-chat-user-name">{u.name}</div>
                        <div className="new-chat-user-id">{u.id}</div>
                      </div>
                    </div>
                  ))
                )}
                {!searchQuery.trim() && <div className="new-chat-hint">输入用户名或 ID 开始搜索</div>}
              </div>
              <div className="confirm-actions">
                <button className="ghost" type="button" onClick={() => setShowNewChat(false)}>取消</button>
              </div>
            </div>
          </div>
        )}
      </section>
    )
  }

  // === Chat Page ===
  const ChatPage = () => {
    const { userId: otherUserId } = useParams<{ userId: string }>()
    const [messages, setMessages] = useState<Message[]>([])
    const [otherUser, setOtherUser] = useState<{ id: string; name: string; avatar?: string; isBanned: boolean } | null>(null)
    const [messageContent, setMessageContent] = useState('')
    const [loading, setLoading] = useState(true)
    const [sending, setSending] = useState(false)
    const [page, setPage] = useState(1)
    const [hasMore, setHasMore] = useState(false)
    const [deleteTarget, setDeleteTarget] = useState<number | null>(null)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const pageSize = 30

    const loadMessages = useCallback(async (pageNum: number) => {
      if (!otherUserId) return
      setLoading(true)
      try {
        const { response, data } = await fetchJson<MessagesResponse>(
          `/api/messages/conversations/${otherUserId}?page=${pageNum}&pageSize=${pageSize}`
        )
        if (response.ok && data) {
          if (pageNum === 1) {
            setMessages(data.messages || [])
          } else {
            setMessages((prev) => [...(data.messages || []), ...prev])
          }
          setOtherUser(data.otherUser)
          setHasMore(data.pagination.page < data.pagination.totalPages)
          // Backend marks messages as read on fetch, refresh topbar badge
          fetchUnreadCount()
        }
      } catch (error) {
        console.error('Failed to load messages:', error)
      } finally {
        setLoading(false)
      }
    }, [otherUserId, fetchUnreadCount])

    useEffect(() => {
      loadMessages(1)
    }, [loadMessages])

    // Poll for new messages every 5 seconds
    useEffect(() => {
      if (!otherUserId) return
      const poll = async () => {
        try {
          const { response, data } = await fetchJson<MessagesResponse>(
            `/api/messages/conversations/${otherUserId}?page=1&pageSize=${pageSize}`
          )
          if (response.ok && data) {
            setMessages(prev => {
              const newMsgs = data.messages || []
              if (newMsgs.length === 0) return prev
              const lastOldId = prev.length > 0 ? prev[prev.length - 1].id : 0
              const lastNewId = newMsgs[newMsgs.length - 1].id
              if (lastNewId > lastOldId) {
                const newOnly = newMsgs.filter(m => m.id > lastOldId)
                return [...prev, ...newOnly]
              }
              return prev
            })
            // Backend marks as read on fetch, refresh topbar badge
            fetchUnreadCount()
          }
        } catch {
          // Silently ignore polling errors
        }
      }
      const interval = setInterval(poll, 5000)
      return () => clearInterval(interval)
    }, [otherUserId, fetchUnreadCount])

    useEffect(() => {
      if (page === 1) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
      }
    }, [messages, page])

    const handleSendMessage = async () => {
      if (!messageContent.trim() || sending || !otherUserId) return
      if (otherUser?.isBanned) {
        alert('无法向被封禁用户发送消息')
        return
      }

      setSending(true)
      try {
        const { response, data } = await fetchJson<{ message: Message }>(`/api/messages/conversations/${otherUserId}`, {
          method: 'POST',
          body: JSON.stringify({ content: messageContent }),
        })

        if (response.ok && data?.message) {
          setMessages((prev) => [...prev, data.message])
          setMessageContent('')
          setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
          }, 100)
        } else {
          const errorData = data as any
          alert(errorData?.message || '发送失败')
        }
      } catch (error) {
        console.error('Failed to send message:', error)
        alert('发送失败')
      } finally {
        setSending(false)
      }
    }

    const confirmDeleteMessage = async () => {
      if (deleteTarget === null) return
      try {
        const { response } = await fetchJson(`/api/messages/${deleteTarget}`, { method: 'DELETE' })
        if (response.ok) {
          setMessages((prev) => prev.filter((m) => m.id !== deleteTarget))
        }
      } catch (error) {
        console.error('Failed to delete message:', error)
      }
      setDeleteTarget(null)
    }

    const handleLoadMore = () => {
      if (!hasMore || loading) return
      setPage((prev) => prev + 1)
      loadMessages(page + 1)
    }

    const formatTime = (isoString: string) => {
      const date = new Date(isoString)
      const now = new Date()
      const isToday = date.toDateString() === now.toDateString()

      if (isToday) {
        return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      }
      return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    }

    const getDateLabel = (isoString: string) => {
      const date = new Date(isoString)
      const now = new Date()
      const yesterday = new Date(now)
      yesterday.setDate(yesterday.getDate() - 1)

      if (date.toDateString() === now.toDateString()) return '今天'
      if (date.toDateString() === yesterday.toDateString()) return '昨天'
      return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
    }

    const canDelete = (message: Message) => {
      const messageTime = new Date(message.createdAt).getTime()
      const now = Date.now()
      const twoMinutes = 2 * 60 * 1000
      return message.senderId === currentUser?.id && (now - messageTime <= twoMinutes)
    }

    // Handle Enter key to send in chat input
    const handleChatKeyDown = useCallback((e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        const el = (e.target as HTMLElement)
        if (el.classList.contains('rich-editor-content') || el.closest('.chat-input-area')) {
          e.preventDefault()
          handleSendMessage()
        }
      }
    }, [messageContent, sending, otherUserId, otherUser])

    useEffect(() => {
      const inputArea = document.querySelector('.chat-input-area')
      if (!inputArea) return
      const handler = (e: Event) => handleChatKeyDown(e as KeyboardEvent)
      inputArea.addEventListener('keydown', handler)
      return () => inputArea.removeEventListener('keydown', handler)
    }, [handleChatKeyDown])

    if (loading && page === 1) {
      return <div className="loading-state">加载中...</div>
    }

    if (!otherUser) {
      return <div className="empty-state">用户不存在</div>
    }

    // Build messages with date separators
    let lastDateLabel = ''
    const messagesWithDates: { type: 'date'; label: string; key: string }[] | { type: 'msg'; message: Message }[] = []
    for (const msg of messages) {
      const label = getDateLabel(msg.createdAt)
      if (label !== lastDateLabel) {
        (messagesWithDates as any[]).push({ type: 'date', label, key: `date-${msg.id}` })
        lastDateLabel = label
      }
      (messagesWithDates as any[]).push({ type: 'msg', message: msg })
    }

    return (
      <section className="chat-page">
        <div className="chat-header">
          <button className="back-button" onClick={() => navigate('/messages')}>
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="chat-header-user">
            <div className="chat-avatar">
              {otherUser.avatar ? (
                <img src={otherUser.avatar} alt={otherUser.name} />
              ) : (
                <span>{otherUser.name.charAt(0).toUpperCase()}</span>
              )}
            </div>
            <span className="chat-user-name">{otherUser.name}</span>
          </div>
        </div>

        <div className="chat-messages">
          {hasMore && (
            <button className="load-more-button" onClick={handleLoadMore} disabled={loading}>
              {loading ? '加载中...' : '加载更多'}
            </button>
          )}
          {(messagesWithDates as any[]).map((item: any) => {
            if (item.type === 'date') {
              return (
                <div key={item.key} className="chat-date-separator">
                  <span>{item.label}</span>
                </div>
              )
            }
            const message = item.message as Message
            return (
              <div
                key={message.id}
                className={`chat-message ${message.senderId === currentUser?.id ? 'own' : 'other'}`}
              >
                <div className="message-avatar">
                  {message.senderAvatar ? (
                    <img src={message.senderAvatar} alt={message.senderName} />
                  ) : (
                    <span>{(message.senderName || '?').charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div className="message-content-wrap">
                  <div className="message-bubble">
                    <div className="message-text" dangerouslySetInnerHTML={{ __html: message.content }} />
                  </div>
                  <div className="message-meta">
                    <span className="message-time">{formatTime(message.createdAt)}</span>
                    {canDelete(message) && (
                      <button
                        className="message-delete"
                        onClick={() => setDeleteTarget(message.id)}
                        title="删除消息"
                      >
                        撤回
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={messagesEndRef} />
        </div>

        <div className="chat-input-area">
          <RichTextEditor
            value={messageContent}
            onChange={setMessageContent}
            placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
          />
          <button
            className="send-button primary"
            onClick={handleSendMessage}
            disabled={sending || !messageContent.trim() || otherUser.isBanned}
          >
            {sending ? '发送中...' : '发送'}
          </button>
        </div>

        {deleteTarget !== null && (
          <div className="confirm-backdrop" role="dialog" aria-modal="true" onClick={() => setDeleteTarget(null)}>
            <div className="confirm-panel" onClick={e => e.stopPropagation()}>
              <div className="confirm-title">撤回消息</div>
              <div className="confirm-desc">确定要撤回这条消息吗？2 分钟内发送的消息将对双方删除。</div>
              <div className="confirm-actions">
                <button className="ghost" type="button" onClick={() => setDeleteTarget(null)}>取消</button>
                <button className="primary" type="button" onClick={confirmDeleteMessage}>确认撤回</button>
              </div>
            </div>
          </div>
        )}
      </section>
    )
  }

  // === Discussion List Page ===
  const DiscussionListPage = () => {
    const [posts, setPosts] = useState<DiscussionPost[]>([])
    const [total, setTotal] = useState(0)
    const [page, setPage] = useState(1)
    const [sort, setSort] = useState<'latest' | 'hot'>('latest')
    const [search, setSearch] = useState('')
    const [searchInput, setSearchInput] = useState('')
    const [loading, setLoading] = useState(true)
    const pageSize = 20

    const loadPosts = useCallback(async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sort })
        if (search) params.set('search', search)
        const { response, data } = await fetchJson<DiscussionListResponse>(`/api/discussions?${params}`)
        if (response.ok && data) {
          setPosts(data.posts || [])
          setTotal(data.total || 0)
        }
      } catch (e) { console.error(e) }
      finally { setLoading(false) }
    }, [page, sort, search])

    useEffect(() => { loadPosts() }, [loadPosts])

    const totalPages = Math.ceil(total / pageSize)

    const handleSearch = () => {
      setSearch(searchInput.trim())
      setPage(1)
    }

    const handleLike = async (postId: number) => {
      if (!currentUser) { navigate('/auth'); return }
      const { response, data } = await fetchJson<{ liked: boolean; likeCount: number }>('/api/discussions/like', {
        method: 'POST', body: JSON.stringify({ targetType: 'post', targetId: postId })
      })
      if (response.ok && data) {
        setPosts(prev => prev.map(p => p.id === postId ? { ...p, liked: data.liked, likeCount: data.likeCount } : p))
      }
    }

    return (
      <section className="discussion-list-page">
        <div className="discussion-header">
          <h2>讨论大厅</h2>
          {currentUser && (
            <button className="primary" onClick={() => navigate('/discussions/create')}>发起讨论</button>
          )}
        </div>

        <div className="discussion-toolbar">
          <div className="discussion-search">
            <input
              type="text" placeholder="搜索帖子标题..."
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
            <button className="ghost small" onClick={handleSearch}>搜索</button>
          </div>
          <div className="discussion-sort">
            <button className={`sort-btn ${sort === 'latest' ? 'active' : ''}`} onClick={() => { setSort('latest'); setPage(1) }}>最新</button>
            <button className={`sort-btn ${sort === 'hot' ? 'active' : ''}`} onClick={() => { setSort('hot'); setPage(1) }}>最热</button>
          </div>
        </div>

        {loading ? (
          <div className="discussion-loading">加载中...</div>
        ) : posts.length === 0 ? (
          <div className="discussion-empty">暂无讨论帖子</div>
        ) : (
          <div className="discussion-post-list">
            {posts.map(post => (
              <div key={post.id} className="discussion-card" onClick={() => navigate(`/discussions/${post.id}`)}>
                <div className="discussion-card-main">
                  <div className="discussion-card-title">{post.title}</div>
                  <div className="discussion-card-meta">
                    <span className="discussion-card-author">
                      {post.userAvatar ? (
                        <img className="discussion-avatar" src={post.userAvatar} alt="" />
                      ) : (
                        <span className="discussion-avatar fallback">{post.userName?.charAt(0) || '?'}</span>
                      )}
                      {post.userName}
                    </span>
                    <span className="discussion-card-time">{formatTime(post.createdAt)}</span>
                    {post.problemTitle && (
                      <span className="discussion-card-problem" onClick={e => { e.stopPropagation(); navigate(`/oj/p${post.problemId}`) }}>
                        P{post.problemId} {post.problemTitle}
                      </span>
                    )}
                  </div>
                </div>
                <div className="discussion-card-stats">
                  <span className="stat-item" onClick={e => { e.stopPropagation(); handleLike(post.id) }}>
                    <svg viewBox="0 0 24 24" className={post.liked ? 'liked' : ''}><path d="M12 21C12 21 3 13.5 3 8.5C3 5.42 5.42 3 8.5 3C10.24 3 11.91 3.81 12 5C12.09 3.81 13.76 3 15.5 3C18.58 3 21 5.42 21 8.5C21 13.5 12 21 12 21Z" /></svg>
                    {post.likeCount}
                  </span>
                  <span className="stat-item">
                    <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                    {post.commentCount}
                  </span>
                  <span className="stat-item">
                    <svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                    {post.viewCount}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="discussion-pagination">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</button>
            <span>{page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页</button>
          </div>
        )}
      </section>
    )
  }

  // === Discussion Detail Page ===
  const DiscussionDetailPage = () => {
    const { id } = useParams<{ id: string }>()
    const [post, setPost] = useState<DiscussionPost | null>(null)
    const [comments, setComments] = useState<DiscussionComment[]>([])
    const [loading, setLoading] = useState(true)
    const [commentText, setCommentText] = useState('')
    const [replyTo, setReplyTo] = useState<{ id: number; name: string } | null>(null)
    const [submitting, setSubmitting] = useState(false)

    const loadDetail = useCallback(async () => {
      if (!id) return
      setLoading(true)
      try {
        const { response, data } = await fetchJson<DiscussionDetailResponse>(`/api/discussions/${id}`)
        if (response.ok && data) {
          setPost(data.post)
          setComments(data.comments || [])
        }
      } catch (e) { console.error(e) }
      finally { setLoading(false) }
    }, [id])

    useEffect(() => { loadDetail() }, [loadDetail])

    const handleLikePost = async () => {
      if (!currentUser || !post) { navigate('/auth'); return }
      const { response, data } = await fetchJson<{ liked: boolean; likeCount: number }>('/api/discussions/like', {
        method: 'POST', body: JSON.stringify({ targetType: 'post', targetId: post.id })
      })
      if (response.ok && data) {
        setPost(prev => prev ? { ...prev, liked: data.liked, likeCount: data.likeCount } : prev)
      }
    }

    const handleLikeComment = async (commentId: number) => {
      if (!currentUser) { navigate('/auth'); return }
      const { response, data } = await fetchJson<{ liked: boolean; likeCount: number }>('/api/discussions/like', {
        method: 'POST', body: JSON.stringify({ targetType: 'comment', targetId: commentId })
      })
      if (response.ok && data) {
        const updateLike = (list: DiscussionComment[]): DiscussionComment[] =>
          list.map(c => ({
            ...c,
            liked: c.id === commentId ? data.liked : c.liked,
            likeCount: c.id === commentId ? data.likeCount : c.likeCount,
            replies: c.replies ? updateLike(c.replies) : c.replies,
          }))
        setComments(prev => updateLike(prev))
      }
    }

    const handleSubmitComment = async () => {
      if (!currentUser) { navigate('/auth'); return }
      if (!commentText.trim()) return
      setSubmitting(true)
      try {
        const { response, data } = await fetchJson<{ comment: DiscussionComment }>(`/api/discussions/${id}/comments`, {
          method: 'POST',
          body: JSON.stringify({ content: commentText, parentId: replyTo?.id || null })
        })
        if (response.ok && data?.comment) {
          if (replyTo) {
            const addReply = (list: DiscussionComment[]): DiscussionComment[] =>
              list.map(c => c.id === replyTo.id
                ? { ...c, replies: [...(c.replies || []), { ...data.comment, replyToName: replyTo.name }] }
                : { ...c, replies: c.replies ? addReply(c.replies) : c.replies })
            setComments(prev => addReply(prev))
          } else {
            setComments(prev => [...prev, data.comment])
          }
          setCommentText('')
          setReplyTo(null)
          if (post) setPost({ ...post, commentCount: post.commentCount + 1 })
        }
      } catch (e) { console.error(e) }
      finally { setSubmitting(false) }
    }

    const handleDeletePost = async () => {
      if (!post || !confirm('确定要删除这篇帖子吗？')) return
      const { response } = await fetchJson(`/api/discussions/${post.id}`, { method: 'DELETE' })
      if (response.ok) navigate('/discussions')
    }

    const handleDeleteComment = async (commentId: number) => {
      if (!confirm('确定要删除这条评论吗？')) return
      const { response } = await fetchJson(`/api/discussions/comments/${commentId}`, { method: 'DELETE' })
      if (response.ok) loadDetail()
    }

    // Render a single comment with nested replies
    const renderComment = (comment: DiscussionComment, depth: number = 0) => (
      <div key={comment.id} className={`discussion-comment ${depth > 0 ? 'nested' : ''}`}>
        <div className="comment-header">
          <span className="comment-author">
            {comment.userAvatar ? (
              <img className="discussion-avatar small" src={comment.userAvatar} alt="" />
            ) : (
              <span className="discussion-avatar fallback small">{comment.userName?.charAt(0) || '?'}</span>
            )}
            {comment.userName}
          </span>
          {currentUser && currentUser.id !== comment.userId && (
            <button
              className="send-message-btn small"
              onClick={() => navigate(`/messages/${comment.userId}`)}
              title="发送私信"
            >
              <svg viewBox="0 0 24 24" width="12" height="12">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
            </button>
          )}
          {comment.replyToName && <span className="comment-reply-to">回复 {comment.replyToName}</span>}
          <span className="comment-time">{formatTime(comment.createdAt)}</span>
        </div>
        <div className="comment-body" dangerouslySetInnerHTML={{ __html: comment.content }} />
        <div className="comment-actions">
          <button className={`like-btn ${comment.liked ? 'liked' : ''}`} onClick={() => handleLikeComment(comment.id)}>
            <svg viewBox="0 0 24 24"><path d="M12 21C12 21 3 13.5 3 8.5C3 5.42 5.42 3 8.5 3C10.24 3 11.91 3.81 12 5C12.09 3.81 13.76 3 15.5 3C18.58 3 21 5.42 21 8.5C21 13.5 12 21 12 21Z" /></svg>
            {comment.likeCount}
          </button>
          <button className="reply-btn" onClick={() => setReplyTo({ id: comment.id, name: comment.userName })}>回复</button>
          {currentUser && (currentUser.id === comment.userId || currentUser.isAdmin) && (
            <button className="delete-btn" onClick={() => handleDeleteComment(comment.id)}>删除</button>
          )}
        </div>
        {comment.replies && comment.replies.length > 0 && (
          <div className="comment-replies">
            {comment.replies.map(r => renderComment(r, depth + 1))}
          </div>
        )}
      </div>
    )

    if (loading) return <section className="discussion-detail-page"><div className="discussion-loading">加载中...</div></section>
    if (!post) return <section className="discussion-detail-page"><div className="discussion-empty">帖子不存在</div></section>

    return (
      <section className="discussion-detail-page">
        <button className="ghost small back-btn" onClick={() => navigate('/discussions')}>← 返回列表</button>

        <article className="discussion-post-detail">
          <h1 className="post-title">{post.title}</h1>
          <div className="post-meta">
            <span className="post-author">
              {post.userAvatar ? (
                <img className="discussion-avatar" src={post.userAvatar} alt="" />
              ) : (
                <span className="discussion-avatar fallback">{post.userName?.charAt(0) || '?'}</span>
              )}
              {post.userName}
            </span>
            {currentUser && currentUser.id !== post.userId && (
              <button
                className="send-message-btn"
                onClick={() => navigate(`/messages/${post.userId}`)}
                title="发送私信"
              >
                <svg viewBox="0 0 24 24" width="14" height="14">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
              </button>
            )}
            <span className="post-time">{formatTime(post.createdAt)}</span>
            {post.problemTitle && (
              <span className="post-problem" onClick={() => navigate(`/oj/p${post.problemId}`)}>
                P{post.problemId} {post.problemTitle}
              </span>
            )}
            <span className="post-views">浏览 {post.viewCount}</span>
          </div>
          <div className="post-content" dangerouslySetInnerHTML={{ __html: post.content || '' }} />
          <div className="post-actions">
            <button className={`like-btn ${post.liked ? 'liked' : ''}`} onClick={handleLikePost}>
              <svg viewBox="0 0 24 24"><path d="M12 21C12 21 3 13.5 3 8.5C3 5.42 5.42 3 8.5 3C10.24 3 11.91 3.81 12 5C12.09 3.81 13.76 3 15.5 3C18.58 3 21 5.42 21 8.5C21 13.5 12 21 12 21Z" /></svg>
              {post.likeCount}
            </button>
            {currentUser && (currentUser.id === post.userId || currentUser.isAdmin) && (
              <>
                <button className="ghost small" onClick={() => navigate(`/discussions/${post.id}/edit`)}>编辑</button>
                <button className="ghost small danger" onClick={handleDeletePost}>删除</button>
              </>
            )}
          </div>
        </article>

        <div className="discussion-comments-section">
          <h3>评论 ({post.commentCount})</h3>
          {comments.length === 0 ? (
            <div className="discussion-empty">暂无评论，来发表第一条评论吧</div>
          ) : (
            <div className="comments-list">
              {comments.map(c => renderComment(c))}
            </div>
          )}

          {currentUser && (
            <div className="comment-input-area">
              {replyTo && (
                <div className="reply-hint">
                  回复 {replyTo.name}
                  <button onClick={() => setReplyTo(null)}>✕</button>
                </div>
              )}
              <textarea
                placeholder={replyTo ? `回复 ${replyTo.name}...` : '写下你的评论...'}
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                rows={3}
              />
              <button className="primary small" disabled={submitting || !commentText.trim()} onClick={handleSubmitComment}>
                {submitting ? '提交中...' : '发表评论'}
              </button>
            </div>
          )}
        </div>
      </section>
    )
  }

  // === Discussion Create Page ===
  const DiscussionCreatePage = () => {
    const [title, setTitle] = useState('')
    const [content, setContent] = useState('')
    const [problemId, setProblemId] = useState<number | null>(null)
    const [problemSearch, setProblemSearch] = useState('')
    const [problemResults, setProblemResults] = useState<OjProblemSummary[]>([])
    const [showProblemDropdown, setShowProblemDropdown] = useState(false)
    const [selectedProblemTitle, setSelectedProblemTitle] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState('')

    const searchProblems = useCallback(async (q: string) => {
      if (!q.trim()) { setProblemResults([]); return }
      const { response, data } = await fetchJson<ProblemsResponse>(`/api/oj/problems?search=${encodeURIComponent(q)}&pageSize=5`)
      if (response.ok && data) setProblemResults(data.problems || [])
    }, [])

    useEffect(() => {
      const timer = setTimeout(() => searchProblems(problemSearch), 300)
      return () => clearTimeout(timer)
    }, [problemSearch, searchProblems])

    const handleSubmit = async () => {
      if (!currentUser) { navigate('/auth'); return }
      if (!title.trim()) { setError('请输入标题'); return }
      if (!content.trim()) { setError('请输入内容'); return }
      setSubmitting(true)
      setError('')
      try {
        const { response, data } = await fetchJson<{ postId: number }>('/api/discussions', {
          method: 'POST',
          body: JSON.stringify({ title: title.trim(), content, problemId })
        })
        if (response.ok && data?.postId) {
          navigate(`/discussions/${data.postId}`)
        } else {
          setError((data as any)?.message || '发帖失败')
        }
      } catch (e) { setError('发帖失败') }
      finally { setSubmitting(false) }
    }

    if (!currentUser) return <Navigate to="/auth" replace />

    return (
      <section className="discussion-create-page">
        <h2>发起讨论</h2>
        {error && <div className="discussion-error">{error}</div>}

        <div className="form-group">
          <label>标题</label>
          <input type="text" maxLength={200} placeholder="输入帖子标题..." value={title} onChange={e => setTitle(e.target.value)} />
        </div>

        <div className="form-group">
          <label>关联题目（可选）</label>
          <div className="problem-selector">
            {selectedProblemTitle ? (
              <div className="selected-problem">
                <span>P{problemId} {selectedProblemTitle}</span>
                <button type="button" onClick={() => { setProblemId(null); setSelectedProblemTitle(''); setProblemSearch('') }}>✕</button>
              </div>
            ) : (
              <input
                type="text" placeholder="搜索题目编号或标题..."
                value={problemSearch}
                onChange={e => { setProblemSearch(e.target.value); setShowProblemDropdown(true) }}
                onFocus={() => setShowProblemDropdown(true)}
                onBlur={() => setTimeout(() => setShowProblemDropdown(false), 200)}
              />
            )}
            {showProblemDropdown && problemResults.length > 0 && (
              <div className="problem-dropdown">
                {problemResults.map(p => (
                  <div key={p.id} className="problem-option" onMouseDown={() => {
                    setProblemId(p.id); setSelectedProblemTitle(p.title)
                    setProblemSearch(''); setShowProblemDropdown(false)
                  }}>
                    P{p.id} {p.title}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="form-group">
          <label>内容</label>
          <RichTextEditor value={content} onChange={setContent} placeholder="输入帖子内容..." />
        </div>

        <div className="form-actions">
          <button className="ghost" onClick={() => navigate('/discussions')}>取消</button>
          <button className="primary" disabled={submitting} onClick={handleSubmit}>
            {submitting ? '发布中...' : '发布'}
          </button>
        </div>
      </section>
    )
  }

  // === Discussion Edit Page ===
  const DiscussionEditPage = () => {
    const { id } = useParams<{ id: string }>()
    const [title, setTitle] = useState('')
    const [content, setContent] = useState('')
    const [problemId, setProblemId] = useState<number | null>(null)
    const [problemSearch, setProblemSearch] = useState('')
    const [problemResults, setProblemResults] = useState<OjProblemSummary[]>([])
    const [showProblemDropdown, setShowProblemDropdown] = useState(false)
    const [selectedProblemTitle, setSelectedProblemTitle] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(true)

    useEffect(() => {
      if (!id) return
      const load = async () => {
        const { response, data } = await fetchJson<DiscussionDetailResponse>(`/api/discussions/${id}`)
        if (response.ok && data?.post) {
          setTitle(data.post.title)
          setContent(data.post.content || '')
          if (data.post.problemId) {
            setProblemId(data.post.problemId)
            setSelectedProblemTitle(data.post.problemTitle || '')
          }
        }
        setLoading(false)
      }
      load()
    }, [id])

    const searchProblems = useCallback(async (q: string) => {
      if (!q.trim()) { setProblemResults([]); return }
      const { response, data } = await fetchJson<ProblemsResponse>(`/api/oj/problems?search=${encodeURIComponent(q)}&pageSize=5`)
      if (response.ok && data) setProblemResults(data.problems || [])
    }, [])

    useEffect(() => {
      const timer = setTimeout(() => searchProblems(problemSearch), 300)
      return () => clearTimeout(timer)
    }, [problemSearch, searchProblems])

    const handleSubmit = async () => {
      if (!title.trim()) { setError('请输入标题'); return }
      if (!content.trim()) { setError('请输入内容'); return }
      setSubmitting(true)
      setError('')
      try {
        const { response, data } = await fetchJson<{ message: string }>(`/api/discussions/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ title: title.trim(), content, problemId })
        })
        if (response.ok) {
          navigate(`/discussions/${id}`)
        } else {
          setError((data as any)?.message || '编辑失败')
        }
      } catch (e) { setError('编辑失败') }
      finally { setSubmitting(false) }
    }

    if (!currentUser) return <Navigate to="/auth" replace />
    if (loading) return <section className="discussion-create-page"><div className="discussion-loading">加载中...</div></section>

    return (
      <section className="discussion-create-page">
        <h2>编辑帖子</h2>
        {error && <div className="discussion-error">{error}</div>}

        <div className="form-group">
          <label>标题</label>
          <input type="text" maxLength={200} value={title} onChange={e => setTitle(e.target.value)} />
        </div>

        <div className="form-group">
          <label>关联题目（可选）</label>
          <div className="problem-selector">
            {selectedProblemTitle ? (
              <div className="selected-problem">
                <span>P{problemId} {selectedProblemTitle}</span>
                <button type="button" onClick={() => { setProblemId(null); setSelectedProblemTitle(''); setProblemSearch('') }}>✕</button>
              </div>
            ) : (
              <input
                type="text" placeholder="搜索题目编号或标题..."
                value={problemSearch}
                onChange={e => { setProblemSearch(e.target.value); setShowProblemDropdown(true) }}
                onFocus={() => setShowProblemDropdown(true)}
                onBlur={() => setTimeout(() => setShowProblemDropdown(false), 200)}
              />
            )}
            {showProblemDropdown && problemResults.length > 0 && (
              <div className="problem-dropdown">
                {problemResults.map(p => (
                  <div key={p.id} className="problem-option" onMouseDown={() => {
                    setProblemId(p.id); setSelectedProblemTitle(p.title)
                    setProblemSearch(''); setShowProblemDropdown(false)
                  }}>
                    P{p.id} {p.title}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="form-group">
          <label>内容</label>
          <RichTextEditor value={content} onChange={setContent} />
        </div>

        <div className="form-actions">
          <button className="ghost" onClick={() => navigate(`/discussions/${id}`)}>取消</button>
          <button className="primary" disabled={submitting} onClick={handleSubmit}>
            {submitting ? '保存中...' : '保存'}
          </button>
        </div>
      </section>
    )
  }

  // === Rich Text Editor Component ===
  const RichTextEditor = ({ value, onChange, placeholder }: { value: string; onChange: (html: string) => void; placeholder?: string }) => {
    const editorRef = useRef<HTMLDivElement>(null)
    const isInternalChange = useRef(false)

    useEffect(() => {
      if (editorRef.current && !isInternalChange.current) {
        if (editorRef.current.innerHTML !== value) {
          editorRef.current.innerHTML = value
        }
      }
      isInternalChange.current = false
    }, [value])

    const execCmd = (cmd: string, val?: string) => {
      editorRef.current?.focus()
      document.execCommand(cmd, false, val)
      isInternalChange.current = true
      onChange(editorRef.current?.innerHTML || '')
    }

    const handleInput = () => {
      isInternalChange.current = true
      onChange(editorRef.current?.innerHTML || '')
    }

    const insertCodeBlock = () => {
      editorRef.current?.focus()
      document.execCommand('insertHTML', false, '<pre><code>code here</code></pre><p><br></p>')
      isInternalChange.current = true
      onChange(editorRef.current?.innerHTML || '')
    }

    const insertLink = () => {
      const url = prompt('输入链接地址：', 'https://')
      if (url) execCmd('createLink', url)
    }

    return (
      <div className="rich-editor-wrap">
        <div className="rich-editor-toolbar">
          <button type="button" title="粗体" onMouseDown={e => { e.preventDefault(); execCmd('bold') }}><strong>B</strong></button>
          <button type="button" title="斜体" onMouseDown={e => { e.preventDefault(); execCmd('italic') }}><em>I</em></button>
          <button type="button" title="行内代码" onMouseDown={e => { e.preventDefault(); execCmd('insertHTML', '<code>code</code>') }}>&lt;/&gt;</button>
          <button type="button" title="代码块" onMouseDown={e => { e.preventDefault(); insertCodeBlock() }}>{'{ }'}</button>
          <button type="button" title="链接" onMouseDown={e => { e.preventDefault(); insertLink() }}>🔗</button>
          <button type="button" title="无序列表" onMouseDown={e => { e.preventDefault(); execCmd('insertUnorderedList') }}>• list</button>
          <button type="button" title="有序列表" onMouseDown={e => { e.preventDefault(); execCmd('insertOrderedList') }}>1. list</button>
        </div>
        <div
          ref={editorRef}
          className="rich-editor-content"
          contentEditable
          onInput={handleInput}
          data-placeholder={placeholder || '输入内容...'}
          suppressContentEditableWarning
        />
      </div>
    )
  }

  return (
    <>
      <canvas ref={canvasRef} className="starfield" />
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
        <div className={appClassName} ref={appRef}>
          <header className="topbar" ref={topbarRef}>
            <div className="topbar-left">
              <div className="topbar-title">星栈</div>
              <div className="topbar-badge">STARSTACK</div>
            </div>
            <div className="topbar-actions">
              {logoutNotice && (
                <div className="logout-notice" role="status">
                  {logoutNotice}
                </div>
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
                  <UserMenu
                    currentUser={currentUser}
                    initial={initial}
                    navigate={navigate}
                    location={location}
                    openLogoutConfirm={openLogoutConfirm}
                  />
                </>
              ) : (
                <button className="primary" onClick={() => openAuth('login')}>
                  登录
                </button>
              )}
            </div>
          </header>

          <div className="app-body">
            <aside className="sidebar">
              <nav className="nav">
                <button className={`nav-link ${location.pathname === '/' ? 'active' : ''}`} onClick={() => navigate('/')}>
                  <span className="nav-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M3 11.5 12 4l9 7.5" />
                      <path d="M5.5 10.8V20h5v-5h3v5h5v-9.2" />
                    </svg>
                  </span>
                  <span className="nav-label">首页</span>
                </button>
                <button
                  className={`nav-link ${location.pathname.startsWith('/oj') ? 'active' : ''}`}
                  onClick={() => navigate('/oj')}
                >
                  <span className="nav-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M7.5 7 3.5 12l4 5" />
                      <path d="M16.5 7 20.5 12l-4 5" />
                      <path d="M10 17l4-10" />
                    </svg>
                  </span>
                  <span className="nav-label">算法测评</span>
                </button>
                <button
                  className={`nav-link ${location.pathname.startsWith('/leaderboard') ? 'active' : ''}`}
                  onClick={() => navigate('/leaderboard')}
                >
                  <span className="nav-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M8 20V10h3v10H8Z" />
                      <path d="M14.5 20V4h3v16h-3Z" />
                      <path d="M2 20v-6h3v6H2Z" />
                    </svg>
                  </span>
                  <span className="nav-label">排行榜</span>
                </button>
                <button
                  className={`nav-link ${location.pathname.startsWith('/discussions') ? 'active' : ''}`}
                  onClick={() => navigate('/discussions')}
                >
                  <span className="nav-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                    </svg>
                  </span>
                  <span className="nav-label">讨论</span>
                </button>
                <button
                  className={`nav-link ${location.pathname.startsWith('/games') ? 'active' : ''}`}
                  onClick={() => navigate('/games')}
                >
                  <span className="nav-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M7.5 9h9a4.5 4.5 0 0 1 4.5 4.5v1a4 4 0 0 1-4 4h-2l-2.2 2-2.2-2H7a4 4 0 0 1-4-4v-1A4.5 4.5 0 0 1 7.5 9Z" />
                      <path d="M7.8 12.2h3.2" />
                      <path d="M9.4 10.6v3.2" />
                      <circle cx="16.2" cy="12.2" r="1.1" />
                      <circle cx="18.6" cy="13.6" r="1.1" />
                    </svg>
                  </span>
                  <span className="nav-label">游戏</span>
                </button>
                {currentUser?.isAdmin && (
                  <button
                    className={`nav-link ${location.pathname.startsWith('/admin') ? 'active' : ''}`}
                    onClick={() => navigate('/admin')}
                  >
                    <span className="nav-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24">
                        <path d="M12 3 20 7v6c0 4.4-3.2 7.8-8 8-4.8-.2-8-3.6-8-8V7l8-4Z" />
                        <path d="M8.5 15.5c.7-1.6 2.1-2.5 3.5-2.5s2.8.9 3.5 2.5" />
                        <circle cx="12" cy="10" r="2.4" />
                      </svg>
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
                <Routes>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/games" element={<GamesPage />} />
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
      )}
    </>
  )
}

export default App
