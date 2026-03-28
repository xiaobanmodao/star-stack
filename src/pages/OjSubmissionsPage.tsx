import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchJson, formatTime } from '../utils'
import type { OjSubmission, SubmissionsResponse } from '../types'

export default function OjSubmissionsPage() {
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
    const timer = window.setTimeout(() => {
      void loadSubmissions()
    }, 0)
    return () => window.clearTimeout(timer)
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
