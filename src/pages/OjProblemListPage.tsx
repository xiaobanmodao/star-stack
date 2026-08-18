import { useState, useEffect, useCallback, type KeyboardEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAppContext } from '../context/AppContext'
import CustomSelect from '../components/CustomSelect'
import TagSelector from '../components/TagSelector'
import { Badge, Button, DataList, DataListHead, DataListRow, EmptyState, PageHeader, Panel } from '../components/ui'
import { fetchJson, openInNewTab } from '../utils'
import { DIFFICULTY_OPTIONS } from '../constants'
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
  const [search, setSearch] = useState(() => searchParams.get('search') || '')
  const [difficulty, setDifficulty] = useState(() => searchParams.get('difficulty') || '')
  const [tag, setTag] = useState<string[]>(() => {
    const tagParam = searchParams.get('tag')
    return tagParam ? tagParam.split(',').map((item) => item.trim()).filter(Boolean) : []
  })
  const [problemList, setProblemList] = useState<OjProblemSummary[]>([])
  const [problemLoading, setProblemLoading] = useState(false)
  const [problemError, setProblemError] = useState('')
  const [daily, setDaily] = useState<DailyQuest | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const itemsPerPage = 20

  const buildQueryParams = useCallback(() => {
    const params = new URLSearchParams()
    if (search.trim()) params.set('search', search.trim())
    if (difficulty) params.set('difficulty', difficulty)
    if (tag.length > 0) params.set('tag', tag.join(','))
    return params
  }, [difficulty, search, tag])

  const loadProblems = useCallback(async () => {
    setProblemLoading(true)
    setProblemError('')
    const params = buildQueryParams()
    setSearchParams(params, { replace: true })
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
  }, [buildQueryParams, setSearchParams])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadProblems()
    }, 220)
    return () => window.clearTimeout(timer)
  }, [loadProblems])

  // 每日一题 + AC 连击
  useEffect(() => {
    let cancelled = false
    void fetchJson<DailyQuest>('/api/problems/daily').then(({ response, data }) => {
      if (!cancelled && response.ok && data) setDaily(data)
    })
    return () => { cancelled = true }
  }, [loadProblems])

  // 计算分页
  const totalPages = Math.ceil(problemList.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const currentProblems = problemList.slice(startIndex, endIndex)

  const clearFilters = () => {
    setSearch('')
    setDifficulty('')
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
          {daily?.problem ? (
            <>
              <div className="daily-quest-title-row">
                <span className={`oj-badge ${daily.problem.difficulty}`}>{daily.problem.difficulty}</span>
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
            ...DIFFICULTY_OPTIONS.map((item) => ({ value: item, label: item })),
          ]}
          placeholder="全部难度"
        />
        <Button variant="primary" onClick={loadProblems} loading={problemLoading}>
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

      {problemError && <div className="auth-error">{problemError}</div>}

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
            </div>
            <span className={`oj-badge ${problem.difficulty}`}>{problem.difficulty}</span>
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
