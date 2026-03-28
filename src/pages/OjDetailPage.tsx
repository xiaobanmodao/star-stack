import { lazy, Suspense, useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { useAppContext } from '../context/AppContext'
import { fetchJson, renderLatex, preloadOjIdeAssets } from '../utils'
import { LANGUAGE_OPTIONS, getLanguageConfig } from '../constants'
import type { OjProblemDetail, ProblemResponse, OjSubmission, SubmissionResponse } from '../types'

const LazyOjIdePanel = lazy(() => import('../components/OjIdePanel'))

export default function OjDetailPage() {
  const navigate = useNavigate()
  const { currentUser, addToPlan, problemPlan, removeFromPlan, openAuth } = useAppContext()
  const params = useParams()
  const { pathname } = useLocation()
  const id =
    params.id ??
    params.rawId ??
    (pathname.match(/\/oj\/p\/?(\d+)/)?.[1] ?? '')
  const [problem, setProblem] = useState<OjProblemDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [ideOpen, setIdeOpen] = useState(false)
  const [pendingSampleRunIndex, setPendingSampleRunIndex] = useState<number | null>(null)
  const [ideDraftCache, setIdeDraftCache] = useState<Record<number, {
    language: string
    code: string
    runInput: string
    runExpected: string
  }>>({})
  const latestIdeSubmissionCacheRef = useRef<{ problemId: number; submission: OjSubmission | null } | null>(null)

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
  }, [preloadOjIde, problem])

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
    const timer = window.setTimeout(() => {
      void loadProblem()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadProblem])

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
    setPendingSampleRunIndex(index)
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
                <button
                  className="ghost small"
                  onMouseEnter={preloadOjIde}
                  onFocus={preloadOjIde}
                  onClick={ideOpen ? () => setIdeOpen(false) : openIde}
                >
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
        <Suspense fallback={<div className="oj-loading">IDE 加载中...</div>}>
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
            onDraftChange={(problemId, draft) => {
              setIdeDraftCache((prev) => ({ ...prev, [problemId]: draft }))
            }}
            onSubmitJudge={handleSubmitJudge}
            pendingSampleRunIndex={pendingSampleRunIndex}
            onPendingSampleRunHandled={() => setPendingSampleRunIndex(null)}
          />
        </Suspense>
      )}
    </div>
  )
}

