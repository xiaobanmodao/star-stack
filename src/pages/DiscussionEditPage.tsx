import { useState, useEffect, useCallback } from 'react'
import { useLocation, useNavigate, useParams, Navigate } from 'react-router-dom'
import { useAppContext } from '../context/AppContext'
import RichTextEditor from '../components/RichTextEditor'
import { fetchJson } from '../utils'
import type { ApiResponse, DiscussionDetailResponse, OjProblemSummary, ProblemsResponse } from '../types'

export default function DiscussionEditPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { currentUser } = useAppContext()
  const { id } = useParams<{ id: string }>()
  // 透传来源（聊天中心板块等）：保存/取消后回到详情页，再返回时仍能回到原列表
  const fromPath = (location.state as { from?: string } | null)?.from
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [problemId, setProblemId] = useState<number | null>(null)
  const [problemSearch, setProblemSearch] = useState('')
  const [problemResults, setProblemResults] = useState<OjProblemSummary[]>([])
  const [showProblemDropdown, setShowProblemDropdown] = useState(false)
  const [selectedProblemTitle, setSelectedProblemTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    const load = async () => {
      const { response, data } = await fetchJson<DiscussionDetailResponse>(`/api/discussions/${id}`)
      if (response.ok && data?.post) {
        setTitle(data.post.title)
        setContent(data.post.content || '')
        if (data.post.problemId) {
          setProblemId(data.post.problemId)
          setSelectedProblemTitle(data.post.problemTitle || '')
        }
      }
      setLoading(false)
    }
    load()
  }, [id])

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
    if (!title.trim()) { setError('请输入标题'); return }
    if (!content.trim()) { setError('请输入内容'); return }
    setSubmitting(true)
    setError('')
    try {
      const { response, data } = await fetchJson<ApiResponse>(`/api/discussions/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ title: title.trim(), content, problemId })
      })
      if (response.ok) {
        navigate(`/discussions/${id}`, fromPath ? { state: { from: fromPath } } : undefined)
      } else {
        setError(data?.message || '编辑失败')
      }
    } catch { setError('编辑失败') }
    finally { setSubmitting(false) }
  }

  if (!currentUser) return <Navigate to="/auth" replace />
  if (loading) return <section className="discussion-create-page"><div className="discussion-loading">加载中...</div></section>

  return (
    <section className="discussion-create-page">
      <h2>编辑帖子</h2>
      {error && <div className="discussion-error">{error}</div>}

      <div className="form-group">
        <label>标题</label>
        <input type="text" maxLength={200} value={title} onChange={e => setTitle(e.target.value)} />
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
        <RichTextEditor value={content} onChange={setContent} />
      </div>

      <div className="form-actions">
        <button className="ghost" onClick={() => navigate(`/discussions/${id}`, fromPath ? { state: { from: fromPath } } : undefined)}>取消</button>
        <button className="primary" disabled={submitting} onClick={handleSubmit}>
          {submitting ? '保存中...' : '保存'}
        </button>
      </div>
    </section>
  )
}
