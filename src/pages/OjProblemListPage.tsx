import { useState, useEffect, useCallback, useRef, type KeyboardEvent, type MouseEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAppContext } from '../context/AppContext'
import { useToast } from '../components/ui/ToastContext'
import CustomSelect from '../components/CustomSelect'
import TagSelector from '../components/TagSelector'
import { Badge, Button, DataList, DataListHead, DataListRow, EmptyState, ErrorState, LoadingState, PageHeader, Panel } from '../components/ui'
import { ApiRequestError, fetchJson, openInNewTab } from '../utils'
import { getDifficultyClassName, getDifficultyLabel, getDifficultyOptions, getDifficultyMeta } from '../utils/difficulty'
import type { OjProblemSummary, ProblemsResponse } from '../types'
import './OjProblemListPage.css'

interface DailyQuest {
  problem: {
    id: number
    slug: string
    title: string
    difficulty: string
    tags: string[]
    solved: boolean
  } | null
  solvedToday: boolean
  streak: number
  maxStreak: number
}

const LIST_COLUMNS = 'minmax(260px, 1fr) 96px minmax(180px, 0.72fr) 150px 94px'

export default function OjProblemListPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { currentUser, addToPlan, problemPlan, removeFromPlan } = useAppContext()
  const { showToast } = useToast()
  const [search, setSearch] = useState(() => searchParams.get('search') || '')
  const [difficulty, setDifficulty] = useState(() => {
    const value = searchParams.get('difficulty')
    return value ? getDifficultyMeta(value).key : ''
  })
  const [solvedFilter, setSolvedFilter] = useState(() => searchParams.get('solved') || '')
  const [tag, setTag] = useState<string[]>(() => {
    const tagParam = searchParams.get('tag')
    return tagParam ? tagParam.split(',').map((item) => item.trim()).filter(Boolean) : []
  })
  const [problemList, setProblemList] = useState<OjProblemSummary[]>([])
  const [totalProblems, setTotalProblems] = useState(0)
  const [problemLoading, setProblemLoading] = useState(false)
  const [problemError, setProblemError] = useState('')
  const [daily, setDaily] = useState<DailyQuest | null>(null)
  const [dailyLoading, setDailyLoading] = useState(true)
  const [planBusyId, setPlanBusyId] = useState<number | null>(null)
  const initialPage = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1)
  const [currentPage, setCurrentPage] = useState(initialPage)
  const [pageInput, setPageInput] = useState(String(initialPage))
  const itemsPerPage = 20
  const requestControllerRef = useRef<AbortController | null>(null)
  const filterInitializedRef = useRef(false)

  const buildQueryParams = useCallback((page: number) => {
    const params = new URLSearchParams()
    if (search.trim()) params.set('search', search.trim())
    if (difficulty) params.set('difficulty', difficulty)
    if (tag.length > 0) params.set('tag', tag.join(','))
    if (currentUser && solvedFilter) params.set('solved', solvedFilter)
    params.set('page', String(page))
    params.set('pageSize', String(itemsPerPage))
    return params
  }, [currentUser, difficulty, search, solvedFilter, tag])

  const loadProblems = useCallback(async (page = currentPage, signal?: AbortSignal) => {
    setProblemLoading(true)
    setProblemError('')
    const params = buildQueryParams(page)
    setSearchParams(params, { replace: true })
    try {
      const { response, data } = await fetchJson<ProblemsResponse>(`/api/oj/problems?${params.toString()}`, { signal })
      if (!response.ok) {
        setProblemError(data?.message || '无法加载题目')
        return
      }
      setProblemList(data?.problems || [])
      setTotalProblems(data?.total || 0)
      setCurrentPage(data?.page || page)
      setPageInput(String(data?.page || page))
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'ABORTED') return
      setProblemError('网络异常，暂时无法加载题库')
    } finally {
      if (!signal?.aborted) setProblemLoading(false)
    }
  }, [buildQueryParams, currentPage, setSearchParams])

  useEffect(() => {
    const controller = new AbortController()
    requestControllerRef.current?.abort()
    requestControllerRef.current = controller
    const timer = window.setTimeout(() => {
      void loadProblems(currentPage, controller.signal)
    }, 220)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [currentPage, difficulty, loadProblems, search, solvedFilter, tag])

  useEffect(() => {
    if (!filterInitializedRef.current) {
      filterInitializedRef.current = true
      return
    }
    setCurrentPage(1)
    setPageInput('1')
  }, [difficulty, search, solvedFilter, tag])

  // 每日一题 + AC 连击
  useEffect(() => {
    const controller = new AbortController()
    void fetchJson<DailyQuest>('/api/problems/daily', { signal: controller.signal }).then(({ response, data }) => {
      if (!controller.signal.aborted && response.ok && data) setDaily(data)
    }).catch(() => undefined).finally(() => {
      if (!controller.signal.aborted) setDailyLoading(false)
    })
    return () => controller.abort()
  }, [])

  const togglePlan = async (event: MouseEvent, problem: OjProblemSummary) => {
    event.stopPropagation()
    if (planBusyId !== null) return
    const plan = problemPlan.find((item) => item.problem_id === problem.id)
    setPlanBusyId(problem.id)
    try {
      const result = plan
        ? await removeFromPlan(plan.id)
        : await addToPlan(problem.id)
      if (result.success) {
        showToast(result.message || (plan ? '已从刷题计划移除' : '已加入刷题计划'), 'success')
      } else {
        showToast(result.message || '刷题计划更新失败', 'error')
      }
    } catch {
      showToast('网络异常，刷题计划未更新', 'error')
    } finally {
      setPlanBusyId(null)
    }
  }

  const totalPages = Math.ceil(totalProblems / itemsPerPage)
  const currentProblems = problemList

  const clearFilters = () => {
    setSearch('')
    setDifficulty('')
    setSolvedFilter('')
    setTag([])
  }

  const handleProblemKeyDown = (event: KeyboardEvent<HTMLDivElement>, problemId: number) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openInNewTab(`/oj/p${problemId}`)
    }
  }

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
    <div className="oj-page oj-problem-library problem-library-v2">
      <PageHeader
        kicker="Problem Library"
        title="题库"
        description="按题号、标题、难度和标签找到下一道训练题。列表保持高密度展示，方便长时间刷题和快速比较。"
        actions={
          <Button variant="ghost" onClick={() => navigate('/oj')}>
            返回评测首页
          </Button>
        }
      />

      {/* 每日一题 + AC 连击（留存激励） */}
      <Panel className="daily-quest-card">
        <div className="daily-quest-main">
          <span className="daily-quest-kicker">Daily Quest · 今日推荐</span>
          {dailyLoading ? (
            <LoadingState className="daily-quest-loading" variant="compact" label="正在生成今日推荐…" />
          ) : daily?.problem ? (
            <>
              <div className="daily-quest-title-row">
                <span className={`oj-badge ${getDifficultyClassName(daily.problem.difficulty)}`}>
                  {getDifficultyLabel(daily.problem.difficulty)}
                </span>
                <strong className="daily-quest-title">{daily.problem.title}</strong>
                {daily.problem.solved && <Badge tone="success">已完成</Badge>}
              </div>
              {daily.problem.tags.length > 0 && (
                <div className="daily-quest-tags">
                  {daily.problem.tags.map((tag) => (
                    <span key={tag} className="oj-tag">{tag}</span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="daily-quest-empty">
              {currentUser ? '题库为空，暂无今日推荐' : '登录后获取今日推荐题目，连续 AC 打卡养成习惯'}
            </div>
          )}
        </div>
        <div className="daily-quest-side">
          {currentUser && daily && (
            <div className="daily-quest-meta">
              <span className="daily-quest-streak" title={`最长连击 ${daily.maxStreak} 天`}>
                🔥 连续 {daily.streak} 天
              </span>
              {!daily.solvedToday && daily.streak > 0 && (
                <span className="daily-quest-warn">今日未打卡，连击明天将中断</span>
              )}
              {daily.solvedToday && <span className="daily-quest-done">今日已打卡 ✓</span>}
            </div>
          )}
          <Button
            variant={daily?.problem?.solved ? 'secondary' : 'primary'}
            onClick={() => daily?.problem && openInNewTab(`/oj/p${daily.problem.id}`)}
            disabled={!daily?.problem}
          >
            {daily?.problem?.solved ? '再刷一遍' : '去挑战 →'}
          </Button>
        </div>
      </Panel>

      <Panel className="problem-library-toolbar">
        <input
          className="auth-input"
          type="search"
          aria-label="搜索题目"
          placeholder="搜索题号、标题或标签"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void loadProblems()
            }
          }}
        />
        <CustomSelect
          className="oj-filter-select"
          value={difficulty}
          onChange={setDifficulty}
          options={[
            { value: '', label: '全部难度' },
            ...getDifficultyOptions(),
          ]}
          placeholder="全部难度"
        />
        <div className="problem-library-status-filter" role="group" aria-label="完成状态">
          {[
            { value: '', label: '全部' },
            { value: 'unsolved', label: '未解决' },
            { value: 'solved', label: '已解决' },
          ].map((option) => (
            <button
              key={option.value || 'all'}
              type="button"
              className={solvedFilter === option.value ? 'active' : ''}
              disabled={!currentUser && option.value !== ''}
              onClick={() => setSolvedFilter(option.value)}
              title={!currentUser && option.value !== '' ? '登录后使用完成状态筛选' : undefined}
            >
              {option.label}
            </button>
          ))}
        </div>
        <Button variant="primary" onClick={() => void loadProblems()} loading={problemLoading}>
          搜索
        </Button>
        <Button variant="ghost" onClick={clearFilters}>
          重置
        </Button>
      </Panel>

      <Panel className="problem-library-tagbar">
        <label className="filter-label">标签过滤</label>
        <TagSelector selectedTags={tag} onTagsChange={setTag} />
      </Panel>

      {problemError && (
        <ErrorState
          description={problemError}
          onRetry={() => void loadProblems()}
        />
      )}

      <div className="problem-library-result-meta" aria-live="polite">
        <span>{problemLoading ? '正在更新题目…' : `筛选后 ${totalProblems} 道题`}</span>
        {(search || difficulty || tag.length > 0 || solvedFilter) && (
          <button type="button" onClick={clearFilters}>清除当前筛选</button>
        )}
      </div>

      <DataList className="oj-library-list problem-library-table">
        <DataListHead columns={LIST_COLUMNS} className="oj-library-head" aria-hidden="true">
          <span>题目</span>
          <span>难度</span>
          <span>标签</span>
          <span>通过率</span>
          <span>计划</span>
        </DataListHead>
        {currentProblems.map((problem) => (
          <DataListRow
            key={problem.id}
            columns={LIST_COLUMNS}
            className="oj-library-row"
            role="button"
            tabIndex={0}
            onClick={() => openInNewTab(`/oj/p${problem.id}`)}
            onKeyDown={(event) => handleProblemKeyDown(event, problem.id)}
          >
            <div className="oj-library-title">
              <span className="oj-code-label">P{problem.id}</span>
              <span>{problem.title}</span>
              {problem.solved && <Badge tone="success">已通过</Badge>}
            </div>
            <span className={`oj-badge ${getDifficultyClassName(problem.difficulty)}`}>
              {getDifficultyLabel(problem.difficulty)}
            </span>
            <div className="oj-tags">
              {problem.tags.length > 0 ? problem.tags.slice(0, 4).map((tagItem) => (
                <span key={tagItem} className="oj-tag">
                  {tagItem}
                </span>
              )) : (
                <span className="oj-tag muted">未分类</span>
              )}
            </div>
            {(problem.totalCount ?? 0) > 0 ? (
              <div className="oj-pass-rate">
                <div className="oj-pass-rate-bar">
                  <div className="oj-pass-rate-fill" style={{ width: `${problem.passRate ?? 0}%` }} />
                </div>
                <span>{problem.passRate}%</span>
                <em>{problem.acCount ?? 0}/{problem.totalCount ?? 0}</em>
              </div>
            ) : (
              <div className="oj-pass-rate oj-pass-rate-empty">
                <span>暂无提交</span>
              </div>
            )}
            <div className="problem-library-plan-cell">
              {currentUser ? (
                <Button
                  variant={problemPlan.some(p => p.problem_id === problem.id) ? 'secondary' : 'ghost'}
                  size="sm"
                  className="problem-library-plan-btn"
                  onClick={(event) => void togglePlan(event, problem)}
                  loading={planBusyId === problem.id}
                  title={problemPlan.some(p => p.problem_id === problem.id) ? "从计划中移除" : "加入做题计划"}
                >
                  {problemPlan.some(p => p.problem_id === problem.id) ? '已加入' : '加入'}
                </Button>
              ) : (
                <span className="problem-library-plan-guest">登录后加入</span>
              )}
            </div>
          </DataListRow>
        ))}
        {problemLoading && currentProblems.length === 0 && (
          <div className="problem-library-loading">
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton skeleton-row" />)}
          </div>
        )}
        {!problemLoading && problemList.length === 0 && (
          <EmptyState
            title="暂无题目"
            description="换一个关键词或清空筛选条件试试。"
          >
            <Button variant="ghost" onClick={clearFilters}>清空筛选</Button>
          </EmptyState>
        )}
      </DataList>

      {!problemLoading && totalPages > 1 && (
        <div className="pagination problem-library-pagination">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage === 1}
          >
            上一页
          </Button>

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

          <Button
            variant="secondary"
            size="sm"
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
          >
            下一页
          </Button>

          <div className="pagination-jump">
            <span>跳转到</span>
            <input
              type="text"
              className="pagination-input"
              value={pageInput}
              onChange={(e) => handlePageInputChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePageInputSubmit()}
            />
            <Button variant="ghost" size="sm" onClick={handlePageInputSubmit}>
              GO
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
