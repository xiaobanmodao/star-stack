import { useState, useEffect, useCallback } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { useAppContext } from '../context/AppContext'
import RichTextEditor from '../components/RichTextEditor'
import { fetchJson } from '../utils'
import type { ApiResponse, OjProblemSummary, ProblemsResponse } from '../types'

export default function DiscussionCreatePage() {
  const navigate = useNavigate()
  const { currentUser } = useAppContext()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [problemId, setProblemId] = useState<number | null>(null)
  const [problemSearch, setProblemSearch] = useState('')
  const [problemResults, setProblemResults] = useState<OjProblemSummary[]>([])
  const [showProblemDropdown, setShowProblemDropdown] = useState(false)
  const [selectedProblemTitle, setSelectedProblemTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const searchProblems = useCallback(async (q: string) => {
    if (!q.trim()) { setProblemResults([]); return }
    const { response, data } = await fetchJson<ProblemsResponse>(`/api/oj/problems?search=${encodeURIComponent(q)}&pageSize=5`)
    if (response.ok && data) setProblemResults(data.problems || [])
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => searchProblems(problemSearch), 300)
    return () => clearTimeout(timer)
  }, [problemSearch, searchProblems])

  const handleSubmit = async () => {
    if (!currentUser) { navigate('/auth'); return }
    if (!title.trim()) { setError('请输入标题'); return }
    if (!content.trim()) { setError('请输入内容'); return }
    setSubmitting(true)
    setError('')
    try {
      const { response, data } = await fetchJson<{ postId: number } & ApiResponse>('/api/discussions', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), content, problemId })
      })
      if (response.ok && data?.postId) {
        navigate(`/discussions/${data.postId}`)
      } else {
        setError(data?.message || '发帖失败')
      }
    } catch { setError('发帖失败') }
    finally { setSubmitting(false) }
  }

  if (!currentUser) return <Navigate to="/auth" replace />

  return (
    <section className="discussion-create-page">
      <h2>发起讨论</h2>
      {error && <div className="discussion-error">{error}</div>}

      <div className="form-group">
        <label>标题</label>
        <input type="text" maxLength={200} placeholder="输入帖子标题..." value={title} onChange={e => setTitle(e.target.value)} />
      </div>

      <div className="form-group">
        <label>关联题目（可选）</label>
        <div className="problem-selector">
          {selectedProblemTitle ? (
            <div className="selected-problem">
              <span>P{problemId} {selectedProblemTitle}</span>
              <button type="button" onClick={() => { setProblemId(null); setSelectedProblemTitle(''); setProblemSearch('') }}>✕</button>
            </div>
          ) : (
            <input
              type="text" placeholder="搜索题目编号或标题..."
              value={problemSearch}
              onChange={e => { setProblemSearch(e.target.value); setShowProblemDropdown(true) }}
              onFocus={() => setShowProblemDropdown(true)}
              onBlur={() => setTimeout(() => setShowProblemDropdown(false), 200)}
            />
          )}
          {showProblemDropdown && problemResults.length > 0 && (
            <div className="problem-dropdown">
              {problemResults.map(p => (
                <div key={p.id} className="problem-option" onMouseDown={() => {
                  setProblemId(p.id); setSelectedProblemTitle(p.title)
                  setProblemSearch(''); setShowProblemDropdown(false)
                }}>
                  P{p.id} {p.title}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="form-group">
        <label>内容</label>
        <RichTextEditor value={content} onChange={setContent} placeholder="输入帖子内容..." />
      </div>

      <div className="form-actions">
        <button className="ghost" onClick={() => navigate('/discussions')}>取消</button>
        <button className="primary" disabled={submitting} onClick={handleSubmit}>
          {submitting ? '发布中...' : '发布'}
        </button>
      </div>
    </section>
  )
}

// === Discussion Edit Page ===
