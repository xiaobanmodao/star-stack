import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { fetchJson, formatTime } from '../utils'
import type { OjSubmission, SubmissionsResponse } from '../types'

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

  return (
    <section className="section">
      <div className="section-header">
        <h2>提交记录</h2>
        <span className="tag">Records</span>
      </div>
      <div className="oj-record-filters">
        <input
          className="auth-input"
          placeholder="输入用户 ID 过滤"
          value={userFilter}
          onChange={(event) => setUserFilter(event.target.value)}
        />
        <button className="ghost" onClick={loadRecords}>
          搜索
        </button>
        <button className="ghost" onClick={() => navigate(`/oj/p${id}`)}>
          返回题目
        </button>
      </div>
      {error && <div className="auth-error">{error}</div>}
      <div className="oj-submissions full">
        <div className="oj-submission head">
          <div>时间</div>
          <div>用户</div>
          <div>语言</div>
          <div>状态</div>
          <div>分数</div>
          <div>耗时</div>
        </div>
        {currentRecords.map((record) => (
          <div
            key={record.id}
            className="oj-submission clickable"
            onClick={() => handleRecordClick(record.id)}
          >
            <div>{formatTime(record.createdAt)}</div>
            <div>
              <span className="submission-user-name" data-user-name>{record.userName}</span>{' '}
              (<span className="submission-user-id" data-user-id>{record.userId}</span>)
            </div>
            <div>{record.language}</div>
            <div>{record.status}</div>
            <div className={record.score === 100 ? 'score-perfect' : 'score-partial'}>{record.score ?? 0}</div>
            <div>{record.timeMs ? `${record.timeMs}ms` : '-'}</div>
          </div>
        ))}
        {loading && <div className="admin-empty">加载中...</div>}
        {!loading && records.length === 0 && <div className="admin-empty">暂无提交记录</div>}
      </div>

      {recordsTotalPages > 1 && (
        <div className="pagination">
          <button
            className="pagination-btn"
            onClick={() => handleRecordsPageChange(recordsPage - 1)}
            disabled={recordsPage === 1}
          >
            上一页
          </button>

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

          <button
            className="pagination-btn"
            onClick={() => handleRecordsPageChange(recordsPage + 1)}
            disabled={recordsPage === recordsTotalPages}
          >
            下一页
          </button>

          <div className="pagination-jump">
            <span>跳转到</span>
            <input
              type="text"
              className="pagination-input"
              value={recordsPageInput}
              onChange={(e) => handleRecordsPageInputChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRecordsPageInputSubmit()}
            />
            <button className="pagination-go" onClick={handleRecordsPageInputSubmit}>
              GO
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

