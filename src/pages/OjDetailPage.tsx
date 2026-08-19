import 'katex/dist/katex.min.css'
import { lazy, Suspense, useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { useAppContext } from '../context/AppContext'
import LoadingState from '../components/ui/LoadingState'
import { Badge, ErrorState } from '../components/ui'
import { fetchJson, openInNewTab, preloadOjIdeAssets } from '../utils'
import { renderLatex } from '../latex'
import { LANGUAGE_OPTIONS, getLanguageConfig } from '../constants'
import type { DiscussionListResponse, DiscussionPost, OjProblemDetail, ProblemResponse, OjSubmission, SubmissionResponse } from '../types'
import './OjJudgePage.css'
import './OjDetailPage.css'

const LazyOjIdePanel = lazy(() => import('../components/OjIdePanel'))

const IDE_DRAFT_STORAGE_KEY = 'starstack:oj-ide-drafts'
const IDE_OPEN_STORAGE_PREFIX = 'starstack:oj-ide-open:'

type IdeDraftCache = Record<number, {
  language: string
  code: string
  runInput: string
  runExpected: string
}>

const readIdeDraftCache = (): IdeDraftCache => {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(IDE_DRAFT_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

const writeIdeDraftCache = (drafts: IdeDraftCache) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(IDE_DRAFT_STORAGE_KEY, JSON.stringify(drafts))
  } catch {
    // localStorage may be unavailable in restricted browser modes.
  }
}

export default function OjDetailPage() {
  const navigate = useNavigate()
  const { currentUser, addToPlan, problemPlan, removeFromPlan, openAuth } = useAppContext()
  const params = useParams()
  const location = useLocation()
  const { pathname } = location
  const id =
    params.id ??
    params.rawId ??
    (pathname.match(/\/oj\/p\/?(\d+)/)?.[1] ?? '')
  const [problem, setProblem] = useState<OjProblemDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [ideOpen, setIdeOpen] = useState(false)
  const [pendingSampleRunIndex, setPendingSampleRunIndex] = useState<number | null>(null)
  const [ideDraftCache, setIdeDraftCache] = useState<IdeDraftCache>(() => readIdeDraftCache())
  const [relatedPosts, setRelatedPosts] = useState<DiscussionPost[]>([])
  const [discussionTotal, setDiscussionTotal] = useState(0)
  const [discussionLoading, setDiscussionLoading] = useState(false)
  const [bookmarked, setBookmarked] = useState(false)
  const [bookmarkBusy, setBookmarkBusy] = useState(false)
  const latestIdeSubmissionCacheRef = useRef<{ problemId: number; submission: OjSubmission | null } | null>(null)
  const restoredSubmissionKeyRef = useRef('')

  const preloadOjIde = useCallback(() => {
    void preloadOjIdeAssets().catch(() => undefined)
  }, [])

  const loadLatestSubmissionForIde = useCallback(async (problemId: number) => {
    if (!currentUser) return null
    const cached = latestIdeSubmissionCacheRef.current
    if (cached && cached.problemId === problemId) {
      return cached.submission
    }
    const { response, data } = await fetchJson<SubmissionResponse>(`/api/oj/submissions/latest?problemId=${problemId}`)
    const submission = response.ok ? (data?.submission ?? null) : null
    latestIdeSubmissionCacheRef.current = { problemId, submission }
    return submission
  }, [currentUser])

  const openIde = useCallback(async () => {
    if (!problem) return
    preloadOjIde()
    setIdeOpen(true)
    try {
      window.localStorage.setItem(`${IDE_OPEN_STORAGE_PREFIX}${problem.id}`, '1')
    } catch {
      // Ignore persistence failures.
    }
  }, [preloadOjIde, problem])

  const loadProblem = useCallback(async () => {
    if (!id) {
      setError('题目地址无效')
      setLoading(false)
      return
    }
    setLoading(true)
    setDiscussionLoading(true)
    setError('')
    try {
      const { response, data } = await fetchJson<ProblemResponse>(`/api/oj/problems/${id}`)
      if (!response.ok) {
        setError(data?.message || '无法加载题目')
        setLoading(false)
        setDiscussionLoading(false)
        return
      }
      if (data?.problem) {
        setProblem(data.problem)
      } else {
        setError('题目数据为空，请稍后重试')
      }
    } catch {
      setError('网络异常，暂时无法加载题目')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadProblem()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadProblem])

  useEffect(() => {
    let cancelled = false
    if (!currentUser || !id) {
      setBookmarked(false)
      return () => { cancelled = true }
    }
    void fetchJson<{ bookmarked: boolean }>(`/api/bookmarks/status?targetType=problem&targetId=${id}`).then(({ response, data }) => {
      if (!cancelled && response.ok) setBookmarked(Boolean(data?.bookmarked))
    })
    return () => { cancelled = true }
  }, [currentUser, id])

  const toggleProblemBookmark = async () => {
    if (!currentUser) {
      openAuth('login')
      return
    }
    if (bookmarkBusy || !problem) return
    setBookmarkBusy(true)
    try {
      const { response, data } = await fetchJson<{ bookmarked?: boolean }>('/api/bookmarks', {
        method: 'POST',
        body: JSON.stringify({ targetType: 'problem', targetId: problem.id }),
      })
      if (response.ok) setBookmarked(Boolean(data?.bookmarked))
    } finally {
      setBookmarkBusy(false)
    }
  }

  useEffect(() => {
    if (!problem) return
    const timer = window.setTimeout(() => {
      preloadOjIde()
      if (currentUser) {
        void loadLatestSubmissionForIde(problem.id)
      }
    }, 600)
    return () => window.clearTimeout(timer)
  }, [currentUser, loadLatestSubmissionForIde, preloadOjIde, problem])

  useEffect(() => {
    if (!problem?.id) return
    let shouldOpen = false
    try {
      shouldOpen = window.localStorage.getItem(`${IDE_OPEN_STORAGE_PREFIX}${problem.id}`) === '1'
    } catch {
      // Ignore persistence failures.
    }
    if (!shouldOpen) return
    const timer = window.setTimeout(() => {
      setIdeOpen(true)
      preloadOjIde()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [preloadOjIde, problem?.id])

  useEffect(() => {
    if (!problem?.id) return
    let cancelled = false
    ;(async () => {
      const params = new URLSearchParams({
        problemId: String(problem.id),
        pageSize: '3',
        sort: 'hot',
      })
      const { response, data } = await fetchJson<DiscussionListResponse>(`/api/discussions?${params}`)
      if (cancelled) return
      if (response.ok && data) {
        setRelatedPosts(data.posts || [])
        setDiscussionTotal(data.total || 0)
      } else {
        setRelatedPosts([])
        setDiscussionTotal(0)
      }
      setDiscussionLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [problem?.id])

  const handleSubmitJudge = useCallback((payload: {
    problemId: number
    problemTitle: string
    language: string
    code: string
  }) => {
    navigate('/oj/judge', { state: payload })
  }, [navigate])

  const handleRunSample = (index: number) => {
    if (!problem) return
    const sample = problem.samples?.[index]
    if (!sample) return
    preloadOjIde()
    setIdeOpen(true)
    try {
      window.localStorage.setItem(`${IDE_OPEN_STORAGE_PREFIX}${problem.id}`, '1')
    } catch {
      // Ignore persistence failures.
    }
    setPendingSampleRunIndex(index)
  }

  const handleIdeDraftChange = useCallback((problemId: number, draft: IdeDraftCache[number]) => {
    const persistedDrafts = { ...readIdeDraftCache(), [problemId]: draft }
    writeIdeDraftCache(persistedDrafts)
    setIdeDraftCache((prev) => ({ ...prev, [problemId]: draft }))
  }, [])

  const handlePendingSampleRunHandled = useCallback(() => {
    setPendingSampleRunIndex(null)
  }, [])

  useEffect(() => {
    const restoreSubmission = (location.state as {
      restoreSubmission?: {
        problemId?: number
        problemTitle?: string
        language?: string
        code?: string
      }
    } | null)?.restoreSubmission
    if (!problem || !restoreSubmission?.problemId || restoreSubmission.problemId !== problem.id) return
    if (!restoreSubmission.language || !restoreSubmission.code) return

    const restoreKey = `${restoreSubmission.problemId}:${restoreSubmission.language}:${restoreSubmission.code}`
    if (restoredSubmissionKeyRef.current === restoreKey) return
    restoredSubmissionKeyRef.current = restoreKey
    handleIdeDraftChange(problem.id, {
      language: restoreSubmission.language,
      code: restoreSubmission.code,
      runInput: '',
      runExpected: '',
    })
    setIdeOpen(true)
    preloadOjIde()
    try {
      window.localStorage.setItem(`${IDE_OPEN_STORAGE_PREFIX}${problem.id}`, '1')
    } catch {
      // Ignore persistence failures.
    }
    navigate(pathname, { replace: true, state: null })
  }, [handleIdeDraftChange, navigate, pathname, preloadOjIde, problem, location.state])

  if (loading) {
    return <LoadingState label="正在载入题目…" />
  }

  if (error) {
    return (
      <div className="oj-detail-state">
        <ErrorState description={error} onRetry={() => void loadProblem()} />
      </div>
    )
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
          {problem.solved && <Badge tone="success">已通过</Badge>}
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
                <button className={`ghost small ${bookmarked ? 'active' : ''}`} onClick={() => void toggleProblemBookmark()} disabled={bookmarkBusy}>
                  {bookmarked ? '已收藏' : '收藏题目'}
                </button>
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
                <button
                  className="ghost small"
                  onMouseEnter={preloadOjIde}
                  onFocus={preloadOjIde}
                  onClick={ideOpen ? () => {
                    setIdeOpen(false)
                    try {
                      window.localStorage.removeItem(`${IDE_OPEN_STORAGE_PREFIX}${problem.id}`)
                    } catch {
                      // Ignore persistence failures.
                    }
                  } : openIde}
                >
                  {ideOpen ? '关闭提交' : '提交'}
                </button>
              </div>
            </div>
            <div className="oj-problem-richtext" dangerouslySetInnerHTML={{ __html: renderLatex(problem.statement) }} />
          </section>

          {/* 输入说明 */}
          <section className="oj-section">
            <h3>输入格式</h3>
            <div className="oj-problem-richtext" dangerouslySetInnerHTML={{ __html: renderLatex(problem.input) }} />
          </section>

          {/* 输出说明 */}
          <section className="oj-section">
            <h3>输出格式</h3>
            <div className="oj-problem-richtext" dangerouslySetInnerHTML={{ __html: renderLatex(problem.output) }} />
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
                      <button
                        className="ghost small"
                        onMouseEnter={preloadOjIde}
                        onFocus={preloadOjIde}
                        onClick={() => handleRunSample(index)}
                      >
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
              <div className="oj-problem-richtext" dangerouslySetInnerHTML={{ __html: renderLatex(problem.dataRange) }} />
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
              <div className="oj-sidebar-item">
                <div className="oj-sidebar-label">通过率</div>
                <div className="oj-sidebar-value">
                  {problem.totalCount ? `${problem.passRate ?? 0}%` : '暂无提交'}
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

            <div className="oj-sidebar-section oj-sidebar-solutions-section">
              <div className="oj-sidebar-discussion-header">
                <div className="oj-sidebar-label">题解</div>
              </div>
              <div className="oj-sidebar-discussion-empty">
                <div className="oj-discussion-empty-copy">查看大家的解题思路，或分享你的做法。</div>
              </div>
              <div className="oj-sidebar-discussion-actions">
                <button
                  className="oj-sidebar-button"
                  onClick={() => navigate(`/oj/solutions/${problem.id}`)}
                >
                  进入题解区 →
                </button>
              </div>
            </div>

            <div className="oj-sidebar-section oj-sidebar-discussion-section">
              <div className="oj-sidebar-discussion-header">
                <div className="oj-sidebar-label">题目讨论</div>
                <div className="oj-sidebar-discussion-count">{discussionTotal} 条</div>
              </div>
              {discussionLoading ? (
                <div className="discussion-loading">
                  {Array.from({ length: 2 }, (_, index) => <div key={index} className="skeleton skeleton-card" />)}
                </div>
              ) : relatedPosts.length === 0 ? (
                <div className="oj-sidebar-discussion-empty">
                  <div className="oj-discussion-empty-title">还没有讨论</div>
                  <div className="oj-discussion-empty-copy">这道题的题解、提问和坑点会显示在这里。</div>
                </div>
              ) : (
                <div className="oj-sidebar-discussion-list">
                  {relatedPosts.map((post) => (
                    <button
                      key={post.id}
                      type="button"
                      className="oj-sidebar-discussion-item"
                      onClick={() => openInNewTab(`/chat/p/${post.id}`)}
                    >
                      <span className="oj-sidebar-discussion-title">{post.title}</span>
                      <span className="oj-sidebar-discussion-meta">
                        {post.commentCount} 评论 · {post.likeCount} 赞
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <div className="oj-sidebar-discussion-actions">
                <button
                  className="oj-sidebar-button"
                  onClick={() => openInNewTab(`/chat/plaza?problemId=${problem.id}`)}
                >
                  查看全部讨论
                </button>
                {currentUser && (
                  <button
                    className="ghost small"
                    onClick={() => openInNewTab(`/chat/plaza?create=1&problemId=${problem.id}`)}
                  >
                    发起讨论
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {ideOpen && (
        <Suspense fallback={<LoadingState variant="ide" label="正在加载开发环境…" />}>
          <LazyOjIdePanel
            problem={problem}
            currentUser={currentUser}
            languageOptions={LANGUAGE_OPTIONS}
            getLanguageConfig={getLanguageConfig}
            fetchJson={fetchJson}
            openAuth={openAuth}
            loadLatestSubmissionForIde={loadLatestSubmissionForIde}
            key={problem.id}
            initialDraft={ideDraftCache[problem.id] ?? null}
            onDraftChange={handleIdeDraftChange}
            onSubmitJudge={handleSubmitJudge}
            pendingSampleRunIndex={pendingSampleRunIndex}
            onPendingSampleRunHandled={handlePendingSampleRunHandled}
          />
        </Suspense>
      )}
    </div>
  )
}
