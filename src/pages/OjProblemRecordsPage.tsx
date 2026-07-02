import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
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

export default function OjProblemRecordsPage() {
  const navigate = useNavigate()
  const { id } = useParams()
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
    const timer = window.setTimeout(() => {
      void loadRecords()
    }, 0)
    return () => window.clearTimeout(timer)
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

  const acceptedCount = records.filter((record) => record.status === 'Accepted' || record.status === 'AC').length
  const bestScore = records.reduce((best, record) => Math.max(best, record.score ?? 0), 0)
  const participantCount = new Set(records.map((record) => record.userId).filter(Boolean)).size

  return (
    <section className="ops-page-v2 submissions-v2">
      <PageHeader
        kicker="Problem Records"
        title="提交记录"
        description={`查看 P${id} 的提交轨迹，可按用户 ID 过滤，快速定位同题调试记录。`}
        actions={
          <Button variant="ghost" onClick={() => navigate(`/oj/p${id}`)}>
            返回题目
          </Button>
        }
      />

      <div className="ops-summary-grid">
        <Panel>
          <span>提交总数</span>
          <strong>{records.length}</strong>
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
          <span>参与用户</span>
          <strong>{participantCount}</strong>
        </Panel>
      </div>

      <Panel className="record-filter-panel">
        <label>
          <span>用户过滤</span>
          <input
            className="auth-input"
            placeholder="输入用户 ID 过滤"
            value={userFilter}
            onChange={(event) => setUserFilter(event.target.value)}
          />
        </label>
        <Button variant="secondary" onClick={loadRecords}>
          搜索
        </Button>
        <Button variant="ghost" onClick={() => {
          setUserFilter('')
          setRecordsPage(1)
          setRecordsPageInput('1')
        }}>
          清空
        </Button>
      </Panel>

      {error && <div className="auth-error">{error}</div>}

      <Panel className="ops-list-panel">
        <div className="ops-panel-head">
          <div>
            <Badge tone="info">Records</Badge>
            <h2>题目提交</h2>
          </div>
          <span>点击任意记录查看判题详情</span>
        </div>

        {loading ? (
          <div className="ops-skeleton-list">
            {Array.from({ length: 8 }, (_, index) => <div key={index} className="skeleton skeleton-row" />)}
          </div>
        ) : records.length === 0 ? (
          <EmptyState title="暂无提交记录" description="这个题目还没有产生提交，或当前用户过滤没有匹配结果。" />
        ) : (
          <div className="submission-list-v2">
            <div className="submission-row-v2 problem-record head">
              <span>时间</span>
              <span>用户</span>
              <span>语言</span>
              <span>状态</span>
              <span>分数</span>
              <span>耗时</span>
            </div>
            {currentRecords.map((record) => (
              <button
                key={record.id}
                type="button"
                className="submission-row-v2 problem-record"
                onClick={() => handleRecordClick(record.id)}
              >
                <span>{formatTime(record.createdAt)}</span>
                <strong>
                  <span className="submission-user-name" data-user-name>{record.userName || record.userId}</span>
                  <em className="submission-user-id" data-user-id>@{record.userId}</em>
                </strong>
                <span>{record.language}</span>
                <Badge tone={getSubmissionTone(record.status)}>{record.status}</Badge>
                <span className={record.score === 100 ? 'score-perfect' : 'score-partial'}>{record.score ?? 0}</span>
                <span>{record.timeMs ? `${record.timeMs}ms` : '-'}</span>
              </button>
            ))}
          </div>
        )}
      </Panel>

      {recordsTotalPages > 1 && (
        <div className="pagination">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleRecordsPageChange(recordsPage - 1)}
            disabled={recordsPage === 1}
          >
            上一页
          </Button>

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

          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleRecordsPageChange(recordsPage + 1)}
            disabled={recordsPage === recordsTotalPages}
          >
            下一页
          </Button>

          <div className="pagination-jump">
            <span>跳转到</span>
            <input
              type="text"
              className="pagination-input"
              value={recordsPageInput}
              onChange={(e) => handleRecordsPageInputChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRecordsPageInputSubmit()}
            />
            <Button variant="ghost" size="sm" onClick={handleRecordsPageInputSubmit}>
              GO
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
