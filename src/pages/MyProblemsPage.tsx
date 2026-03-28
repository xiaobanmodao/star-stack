import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppContext } from '../context/AppContext'
import { fetchJson } from '../utils'
import type { OjProblemSummary, ProblemsResponse, ApiResponse } from '../types'

export default function MyProblemsPage() {
  const navigate = useNavigate()
  const { currentUser, openAuth } = useAppContext()
  const [problems, setProblems] = useState<OjProblemSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const itemsPerPage = 20

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

  useEffect(() => {
    if (!currentUser) {
      openAuth('login')
      return
    }
    const timer = window.setTimeout(() => {
      void loadMyProblems()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [currentUser, openAuth])

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

