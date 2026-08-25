import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAppContext } from '../../context/AppContext'
import RichTextEditor from '../../components/RichTextEditor'
import type { DiscussionListResponse, DiscussionPost, ChatModuleKey } from '../../types'
import { fetchJson, openInNewTab } from '../../utils'
import { MODULE_KEYS, MODULE_META } from '../../components/chat/chatMeta'
import { useModalFocus } from '../../hooks/useModalFocus'
import { EmptyState, LoadingState } from '../../components/ui'
import './ChatHub.css'

const formatPostTime = (iso: string) => {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour} 小时前`
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 7) return `${diffDay} 天前`
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function CreatePostModal({ defaultModule, initialProblemId, onClose, onCreated }: {
  defaultModule: ChatModuleKey
  initialProblemId?: number
  onClose: () => void
  onCreated: (postId: number) => void
}) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [module, setModule] = useState<ChatModuleKey>(defaultModule)
  const [problemId, setProblemId] = useState<number | null>(initialProblemId ?? null)
  const [problemTitle, setProblemTitle] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const dialogRef = useModalFocus(true, onClose)

  // 绑定题目时拉取题目标题
  useEffect(() => {
    if (!initialProblemId) return
    const timer = window.setTimeout(() => {
      void fetchJson<{ problem?: { id: number; title: string } }>(`/api/oj/problems/${initialProblemId}`).then(({ response, data }) => {
        if (response.ok && data?.problem) {
          setProblemId(data.problem.id)
          setProblemTitle(data.problem.title)
        }
      }).catch(() => setProblemTitle(''))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [initialProblemId])

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError('请填写标题')
      return
    }
    if (!content.trim()) {
      setError('请填写内容')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const { response, data } = await fetchJson<{ postId?: number; message?: string }>('/api/discussions', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), content, moduleKey: module, problemId: problemId ?? undefined }),
      })
      if (response.ok && data?.postId) {
        onCreated(data.postId)
      } else {
        setError(data?.message || '发帖失败')
      }
    } catch {
      setError('发帖失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="confirm-backdrop" role="dialog" aria-modal="true" aria-labelledby="create-post-dialog-title" onClick={onClose}>
      <div ref={dialogRef} className="confirm-panel chat-post-modal" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <div id="create-post-dialog-title" className="confirm-title">发布帖子</div>
        <label className="chat-modal-field">
          <span>标题</span>
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="一句话说清楚你的主题"
            maxLength={200}
            autoFocus
          />
        </label>
        {problemId && (
          <div className="chat-modal-field">
            <span>关联题目</span>
            <div className="chat-bound-problem">
              P{problemId} {problemTitle || '...'}
              <button
                type="button"
                onClick={() => {
                  setProblemId(null)
                  setProblemTitle('')
                }}
                title="取消关联"
              >
                x
              </button>
            </div>
          </div>
        )}
        <label className="chat-modal-field">
          <span>内容（支持粗体、代码块、数学公式、大小字）</span>
          <RichTextEditor value={content} onChange={setContent} placeholder="描述你的思路、问题、代码片段或题解..." />
        </label>
        <div className="chat-modal-field">
          <span>所属模块</span>
          <div className="chat-module-chips">
            {MODULE_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className={module === key ? 'active' : ''}
                onClick={() => setModule(key)}
              >
                {MODULE_META[key].icon} {MODULE_META[key].label}
              </button>
            ))}
          </div>
        </div>
        {error && <div className="auth-error">{error}</div>}
        <div className="confirm-actions">
          <button className="ghost" type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" type="button" onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? '发布中...' : '发布'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function PostBoard({ module = 'all' }: { module?: ChatModuleKey | 'all' }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { currentUser } = useAppContext()
  const [posts, setPosts] = useState<DiscussionPost[]>([])
  const [loading, setLoading] = useState(true)
  const [activeModule, setActiveModule] = useState<ChatModuleKey | 'all'>(module)
  const [sort, setSort] = useState<'latest' | 'hot'>('latest')
  const [feed, setFeed] = useState<'all' | 'following'>('all')
  const [showCreate, setShowCreate] = useState(false)
  const [createInitRef, setCreateInitRef] = useState(false)

  // 查询参数：?problemId= 题目筛选、?create=1 自动打开发帖
  const problemIdParam = (() => {
    const raw = new URLSearchParams(location.search).get('problemId')
    return raw ? parseInt(raw, 10) || null : null
  })()
  const createParam = new URLSearchParams(location.search).get('create') === '1'
  const [problemTitle, setProblemTitle] = useState('')

  useEffect(() => {
    if (!problemIdParam) {
      setProblemTitle('')
      return
    }
    const timer = window.setTimeout(() => {
      void fetchJson<{ problem?: { id: number; title: string } }>(`/api/oj/problems/${problemIdParam}`).then(({ response, data }) => {
        if (response.ok && data?.problem) setProblemTitle(data.problem.title)
      }).catch(() => setProblemTitle(''))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [problemIdParam])

  // create=1 → 自动打开发帖弹窗（每个参数组合只触发一次）
  useEffect(() => {
    if (createParam && !createInitRef) {
      setCreateInitRef(true)
      setShowCreate(true)
    }
  }, [createParam, createInitRef])

  // 路由参数变化（如 #oj → #jieya）时同步当前模块
  useEffect(() => {
    setActiveModule(module)
  }, [module])

  const clearQueryParam = (param: string) => {
    const params = new URLSearchParams(location.search)
    params.delete(param)
    const query = params.toString()
    navigate(`${location.pathname}${query ? `?${query}` : ''}`, { replace: true })
  }

  const loadPosts = useCallback(async () => {
    setLoading(true)
    try {
      const query = new URLSearchParams({ page: '1', pageSize: '20', sort })
      if (activeModule !== 'all') query.set('module', activeModule)
      if (problemIdParam) query.set('problemId', String(problemIdParam))
      if (feed === 'following') query.set('feed', 'following')
      const { response, data } = await fetchJson<DiscussionListResponse>(`/api/discussions?${query.toString()}`)
      if (response.ok && data) setPosts(data.posts || [])
    } catch {
      // 忽略
    } finally {
      setLoading(false)
    }
  }, [activeModule, sort, problemIdParam, feed])

  useEffect(() => {
    void loadPosts()
  }, [loadPosts])

  // 进入板块时标记已读（帖子维度）
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const keys: ChatModuleKey[] = activeModule === 'all' ? MODULE_KEYS : [activeModule]
      keys.forEach((key) => {
        void fetchJson('/api/chat/read', {
          method: 'POST',
          body: JSON.stringify({ scopeType: 'channel', scopeId: key }),
        })
      })
    }, 500)
    return () => window.clearTimeout(timer)
  }, [activeModule])

  const handleTogglePin = async (post: DiscussionPost) => {
    const { response } = await fetchJson(`/api/discussions/${post.id}/pin`, {
      method: post.isPinned ? 'DELETE' : 'POST',
    })
    if (response.ok) {
      setPosts((prev) => prev.map((item) => item.id === post.id ? { ...item, isPinned: !item.isPinned } : item))
    }
  }

  const boardTitle = activeModule === 'all'
    ? { icon: '📌', title: '公共广场', desc: '发布帖子，和大家讨论各个模块的内容' }
    : { icon: MODULE_META[activeModule].icon, title: `#${MODULE_META[activeModule].label}`, desc: MODULE_META[activeModule].label }

  return (
    <section className="chat-scope-pane plaza-pane">
      <header className="chat-pane-header">
        <div className="chat-pane-title">
          <span className="chat-pane-icon" aria-hidden="true">{boardTitle.icon}</span>
          <div>
            <h2>{boardTitle.title}</h2>
            <p>{boardTitle.desc} · 发帖制板块，可在帖子下回复讨论</p>
          </div>
        </div>
        <div className="chat-pane-actions">
          <button type="button" className="primary small" onClick={() => setShowCreate(true)}>
            ＋ 发帖
          </button>
        </div>
      </header>

      <div className="plaza-toolbar">
        <div className="plaza-module-chips">
          <button type="button" className={activeModule === 'all' ? 'active' : ''} onClick={() => setActiveModule('all')}>
            全部
          </button>
          {MODULE_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className={activeModule === key ? 'active' : ''}
              onClick={() => setActiveModule(key)}
            >
              {MODULE_META[key].icon} {MODULE_META[key].label}
            </button>
          ))}
          <button
            type="button"
            className={`plaza-feed-chip ${feed === 'following' ? 'active' : ''}`}
            onClick={() => setFeed((prev) => (prev === 'following' ? 'all' : 'following'))}
            title="只看你关注的人（含自己）的新帖"
          >
            ⭐ 关注动态
          </button>
        </div>
        <div className="plaza-sort">
          {problemIdParam && (
            <button
              type="button"
              className="plaza-problem-filter"
              onClick={() => clearQueryParam('problemId')}
              title="取消题目筛选"
            >
              P{problemIdParam} {problemTitle || ''} ✕
            </button>
          )}
          <button type="button" className={sort === 'latest' ? 'active' : ''} onClick={() => setSort('latest')}>
            最新
          </button>
          <button type="button" className={sort === 'hot' ? 'active' : ''} onClick={() => setSort('hot')}>
            热门
          </button>
        </div>
      </div>

      <div className="plaza-feed">
        {loading ? (
          <LoadingState variant="list" label="正在加载帖子…" />
        ) : posts.length === 0 ? (
          <EmptyState title="这个区域还没有帖子" description="来发第一帖吧 ✨" />
        ) : (
          posts.map((post) => (
            <div
              key={post.id}
              role="button"
              tabIndex={0}
              className="plaza-post"
              onClick={() => openInNewTab(`/chat/p/${post.id}`)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  openInNewTab(`/chat/p/${post.id}`)
                }
              }}
            >
              <div className="plaza-post-head">
                <span className={`plaza-module-badge ${post.moduleKey || 'general'}`}>
                  {MODULE_META[(post.moduleKey as ChatModuleKey) || 'general']?.icon}{' '}
                  {MODULE_META[(post.moduleKey as ChatModuleKey) || 'general']?.label || '杂谈'}
                </span>
                <span className="plaza-post-head-right">
                  {post.isPinned && <span className="plaza-pin-badge">置顶</span>}
                  <span className="plaza-post-time">{formatPostTime(post.createdAt)}</span>
                </span>
              </div>
              <strong className="plaza-post-title">{post.title}</strong>
              {post.problemTitle && <span className="plaza-post-problem">题：{post.problemTitle}</span>}
              <div className="plaza-post-foot">
                <span
                  className="plaza-post-author"
                  role="button"
                  title="查看个人主页"
                  onClick={(event) => {
                    event.stopPropagation()
                    navigate(`/user/${post.userId}`)
                  }}
                >
                  {post.userAvatar ? (
                    <img src={post.userAvatar} alt="" loading="lazy" />
                  ) : (
                    <span>{post.userName.charAt(0).toUpperCase()}</span>
                  )}
                  {post.userName}
                </span>
                <span className="plaza-post-foot-right">
                  {currentUser?.isAdmin && (
                    <button
                      type="button"
                      className="plaza-pin-btn"
                      onClick={(event) => {
                        event.stopPropagation()
                        void handleTogglePin(post)
                      }}
                    >
                      {post.isPinned ? '取消置顶' : '置顶'}
                    </button>
                  )}
                  <span className="plaza-post-metrics">
                    <em>👍 {post.likeCount}</em>
                    <em>💬 {post.commentCount}</em>
                    <em>👁 {post.viewCount}</em>
                  </span>
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {showCreate && (
        <CreatePostModal
          defaultModule={activeModule === 'all' ? 'general' : activeModule}
          initialProblemId={problemIdParam ?? undefined}
          onClose={() => {
            setShowCreate(false)
            clearQueryParam('create')
          }}
          onCreated={(postId) => {
            setShowCreate(false)
            navigate(`/chat/p/${postId}`, { state: { from: location.pathname } })
          }}
        />
      )}
    </section>
  )
}
