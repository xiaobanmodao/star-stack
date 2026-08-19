import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Button, EmptyState, ErrorState, PageHeader, Panel } from '../components/ui'
import CustomSelect from '../components/CustomSelect'
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

const SUBMISSION_STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'Accepted', label: 'Accepted' },
  { value: 'Wrong Answer', label: 'Wrong Answer' },
  { value: 'Compile Error', label: 'Compile Error' },
  { value: 'Time Limit Exceeded', label: 'Time Limit Exceeded' },
  { value: 'Runtime Error', label: 'Runtime Error' },
]

const LANGUAGE_OPTIONS = [
  { value: '', label: '全部语言' },
  { value: 'C++', label: 'C++17' },
  { value: 'Python', label: 'Python 3' },
  { value: 'Java', label: 'Java 17' },
]

const getPassedCases = (submission: OjSubmission) => {
  const results = submission.results || []
  if (results.length === 0) return '-'
  const passed = results.filter((item) => item.status === 'Accepted').length
  return `${passed}/${results.length}`
}

export default function OjSubmissionsPage() {
  const navigate = useNavigate()
  const [submissions, setSubmissions] = useState<OjSubmission[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [submissionsPage, setSubmissionsPage] = useState(1)
  const [submissionsPageInput, setSubmissionsPageInput] = useState('1')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [languageFilter, setLanguageFilter] = useState('')
  const submissionsPerPage = 20

  const loadSubmissions = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { response, data } = await fetchJson<SubmissionsResponse>('/api/oj/submissions')
      if (!response.ok) {
        setError(data?.message || '无法加载提交记录')
        return
      }
      setSubmissions(data?.submissions || [])
      setSubmissionsPage(1)
      setSubmissionsPageInput('1')
    } catch {
      setError('网络异常，暂时无法加载提交记录')
    } finally {
      setLoading(false)
    }
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

  const resetSubmissionPagination = () => {
    setSubmissionsPage(1)
    setSubmissionsPageInput('1')
  }

  const filteredSubmissions = useMemo(() => {
    const query = search.trim().toLowerCase()
    return submissions.filter((record) => {
      const matchesSearch = !query || [record.problemTitle, `P${record.problemId}`, String(record.problemId)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
      const matchesStatus = !statusFilter || record.status === statusFilter
      const matchesLanguage = !languageFilter || record.language === languageFilter
      return matchesSearch && matchesStatus && matchesLanguage
    })
  }, [languageFilter, search, statusFilter, submissions])

  const submissionsTotalPages = Math.ceil(filteredSubmissions.length / submissionsPerPage)
  const submissionsStartIndex = (submissionsPage - 1) * submissionsPerPage
  const submissionsEndIndex = submissionsStartIndex + submissionsPerPage
  const currentSubmissions = filteredSubmissions.slice(submissionsStartIndex, submissionsEndIndex)

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

  const acceptedCount = filteredSubmissions.filter((record) => record.status === 'Accepted' || record.status === 'AC').length
  const bestScore = filteredSubmissions.reduce((best, record) => Math.max(best, record.score ?? 0), 0)
  const latestSubmission = filteredSubmissions[0]

  return (
    <section className="ops-page-v2 submissions-v2">
      <PageHeader
        kicker="Submission Log"
        title="我的提交"
        description="把每次提交当成一次可复盘的飞行记录，快速回看状态、分数、语言和耗时。"
        actions={
          <>
            <Button variant="ghost" onClick={() => void loadSubmissions()} disabled={loading}>
              {loading ? '刷新中...' : '刷新'}
            </Button>
            <Button variant="ghost" onClick={() => navigate('/oj')}>
              返回训练台
            </Button>
          </>
        }
      />

      <div className="ops-summary-grid">
        <Panel>
          <span>当前结果</span>
          <strong>{filteredSubmissions.length}</strong>
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

      {error && <ErrorState description={error} onRetry={() => void loadSubmissions()} />}

      <Panel className="ops-list-panel">
        <div className="ops-panel-head">
          <div>
            <Badge tone="info">Submissions</Badge>
            <h2>提交记录</h2>
          </div>
          <span>点击任意记录查看判题详情 · 当前 {filteredSubmissions.length} 条</span>
        </div>

        <div className="submission-filter-panel">
          <input
            className="auth-input"
            placeholder="搜索题目名称或题号"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              resetSubmissionPagination()
            }}
          />
          <CustomSelect
            className="submission-filter-select"
            value={statusFilter}
            onChange={(value) => {
              setStatusFilter(value)
              resetSubmissionPagination()
            }}
            options={SUBMISSION_STATUS_OPTIONS}
          />
          <CustomSelect
            className="submission-filter-select"
            value={languageFilter}
            onChange={(value) => {
              setLanguageFilter(value)
              resetSubmissionPagination()
            }}
            options={LANGUAGE_OPTIONS}
          />
          <Button
            variant="ghost"
            onClick={() => {
              setSearch('')
              setStatusFilter('')
              setLanguageFilter('')
              resetSubmissionPagination()
            }}
            disabled={!search && !statusFilter && !languageFilter}
          >
            清空筛选
          </Button>
        </div>

        {loading ? (
          <div className="ops-skeleton-list">
            {Array.from({ length: 8 }, (_, index) => <div key={index} className="skeleton skeleton-row" />)}
          </div>
        ) : filteredSubmissions.length === 0 ? (
          <EmptyState
            title="暂无提交记录"
            description={submissions.length === 0 ? '完成一次提交后，这里会出现可复盘的判题记录。' : '当前筛选条件没有匹配的提交记录。'}
          />
        ) : (
          <div className="submission-list-v2">
            <div className="submission-row-v2 head">
              <span>时间</span>
              <span>题目</span>
              <span>语言</span>
              <span>状态</span>
              <span>测试点</span>
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
                <span>{getPassedCases(record)}</span>
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
