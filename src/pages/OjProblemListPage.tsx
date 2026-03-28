import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppContext } from '../context/AppContext'
import TagSelector from '../components/TagSelector'
import { fetchJson } from '../utils'
import { DIFFICULTY_OPTIONS } from '../constants'
import type { OjProblemSummary, ProblemsResponse } from '../types'

export default function OjProblemListPage() {
  const navigate = useNavigate()
  const { currentUser, addToPlan, problemPlan, removeFromPlan } = useAppContext()
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
    const timer = window.setTimeout(() => {
      void loadProblems()
    }, 0)
    return () => window.clearTimeout(timer)
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
                {(problem.totalCount ?? 0) > 0 && (
                  <div className="oj-pass-rate">
                    <div className="oj-pass-rate-bar">
                      <div className="oj-pass-rate-fill" style={{ width: `${problem.passRate ?? 0}%` }} />
                    </div>
                    <span>{problem.passRate}%</span>
                  </div>
                )}
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
        {problemLoading && <div className="admin-empty">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton skeleton-card" />)}</div>}
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

