import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Button, EmptyState, PageHeader, Panel } from '../components/ui'
import { fetchJson, formatTime } from '../utils'
import type { OjSubmission, SubmissionsResponse } from '../types'
import './OpsPages.css'

const getSubmissionTone = (status: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' => {
  if (status === 'Accepted' || status === 'AC') return 'success'
  if (status === 'Compile Error' || status === 'CE') return 'warning'
  if (status === 'Time Limit Exceeded' || status === 'TLE') return 'warning'
  if (status === 'Wrong Answer' || status === 'Runtime Error' || status === 'WA' || status === 'RE') return 'danger'
  return 'info'
}

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

  const acceptedCount = submissions.filter((record) => record.status === 'Accepted' || record.status === 'AC').length
  const bestScore = submissions.reduce((best, record) => Math.max(best, record.score ?? 0), 0)
  const latestSubmission = submissions[0]

  return (
    <section className="ops-page-v2 submissions-v2">
      <PageHeader
        kicker="Submission Log"
        title="我的提交"
        description="把每次提交当成一次可复盘的飞行记录，快速回看状态、分数、语言和耗时。"
        actions={
          <Button variant="ghost" onClick={() => navigate('/oj')}>
            返回训练台
          </Button>
        }
      />

      <div className="ops-summary-grid">
        <Panel>
          <span>提交总数</span>
          <strong>{submissions.length}</strong>
        </Panel>
        <Panel>
          <span>Accepted</span>
          <strong>{acceptedCount}</strong>
        </Panel>
        <Panel>
          <span>最高得分</span>
          <strong>{bestScore}</strong>
        </Panel>
        <Panel>
          <span>最近提交</span>
          <strong>{latestSubmission ? formatTime(latestSubmission.createdAt) : '--'}</strong>
        </Panel>
      </div>

      {error && <div className="auth-error">{error}</div>}

      <Panel className="ops-list-panel">
        <div className="ops-panel-head">
          <div>
            <Badge tone="info">Submissions</Badge>
            <h2>提交记录</h2>
          </div>
          <span>点击任意记录查看判题详情</span>
        </div>

        {loading ? (
          <div className="ops-skeleton-list">
            {Array.from({ length: 8 }, (_, index) => <div key={index} className="skeleton skeleton-row" />)}
          </div>
        ) : submissions.length === 0 ? (
          <EmptyState title="暂无提交记录" description="完成一次提交后，这里会出现可复盘的判题记录。" />
        ) : (
          <div className="submission-list-v2">
            <div className="submission-row-v2 head">
              <span>时间</span>
              <span>题目</span>
              <span>语言</span>
              <span>状态</span>
              <span>分数</span>
              <span>耗时</span>
            </div>
            {currentSubmissions.map((record) => (
              <button
                key={record.id}
                type="button"
                className="submission-row-v2"
                onClick={() => handleSubmissionClick(record.id)}
              >
                <span>{formatTime(record.createdAt)}</span>
                <strong>{record.problemTitle || `P${record.problemId}`}</strong>
                <span>{record.language}</span>
                <Badge tone={getSubmissionTone(record.status)}>{record.status}</Badge>
                <span className={record.score === 100 ? 'score-perfect' : 'score-partial'}>{record.score ?? 0} 分</span>
                <span>{record.timeMs ? `${record.timeMs}ms` : '-'}</span>
              </button>
            ))}
          </div>
        )}
      </Panel>

      {submissionsTotalPages > 1 && (
        <div className="pagination">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleSubmissionsPageChange(submissionsPage - 1)}
            disabled={submissionsPage === 1}
          >
            上一页
          </Button>

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

          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleSubmissionsPageChange(submissionsPage + 1)}
            disabled={submissionsPage === submissionsTotalPages}
          >
            下一页
          </Button>

          <div className="pagination-jump">
            <span>跳转到</span>
            <input
              type="text"
              className="pagination-input"
              value={submissionsPageInput}
              onChange={(e) => handleSubmissionsPageInputChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmissionsPageInputSubmit()}
            />
            <Button variant="ghost" size="sm" onClick={handleSubmissionsPageInputSubmit}>
              GO
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

// === Message List Page ===
