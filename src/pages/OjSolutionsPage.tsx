import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAppContext } from '../context/AppContext'
import RichTextEditor from '../components/RichTextEditor'
import { Badge, Button, EmptyState, PageHeader, Panel } from '../components/ui'
import { fetchJson, openInNewTab } from '../utils'
import type { ProblemResponse, SolutionsResponse } from '../types'
import './OjSolutionsPage.css'

export default function OjSolutionsPage() {
  const navigate = useNavigate()
  const { id = '' } = useParams<{ id: string }>()
  const { currentUser, openAuth } = useAppContext()
  const [problemTitle, setProblemTitle] = useState('')
  const [solutions, setSolutions] = useState<SolutionsResponse['solutions']>([])
  const [canWrite, setCanWrite] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  const loadSolutions = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const [problemRes, solutionRes] = await Promise.all([
      fetchJson<ProblemResponse>(`/api/oj/problems/${id}`),
      fetchJson<SolutionsResponse>(`/api/oj/problems/${id}/solutions`),
    ])
    if (problemRes.response.ok && problemRes.data?.problem) {
      setProblemTitle(problemRes.data.problem.title)
    }
    if (solutionRes.response.ok && solutionRes.data) {
      setSolutions(solutionRes.data.solutions || [])
      setCanWrite(solutionRes.data.canWrite)
    }
    setLoading(false)
  }, [id])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    ;(async () => {
      const [problemRes, solutionRes] = await Promise.all([
        fetchJson<ProblemResponse>(`/api/oj/problems/${id}`),
        fetchJson<SolutionsResponse>(`/api/oj/problems/${id}/solutions`),
      ])
      if (cancelled) return
      if (problemRes.response.ok && problemRes.data?.problem) {
        setProblemTitle(problemRes.data.problem.title)
      }
      if (solutionRes.response.ok && solutionRes.data) {
        setSolutions(solutionRes.data.solutions || [])
        setCanWrite(solutionRes.data.canWrite)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  const handleWriteClick = () => {
    if (!currentUser) {
      openAuth('login')
      return
    }
    if (!canWrite) {
      setFormError('通过该题后才能发布题解')
      return
    }
    setFormError('')
    setShowForm(true)
  }

  const handleSubmit = async () => {
    if (!title.trim()) {
      setFormError('请填写题解标题')
      return
    }
    if (!content.trim()) {
      setFormError('请填写题解内容')
      return
    }
    setSubmitting(true)
    setFormError('')
    const { response, data } = await fetchJson<{ postId?: number; message?: string }>(
      `/api/oj/problems/${id}/solutions`,
      {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), content }),
      }
    )
    setSubmitting(false)
    if (response.ok && data?.postId) {
      setShowForm(false)
      setTitle('')
      setContent('')
      await loadSolutions()
      openInNewTab(`/chat/p/${data.postId}`)
    } else {
      setFormError(data?.message || '发布题解失败')
    }
  }

  return (
    <div className="oj-page oj-solutions-page">
      <PageHeader
        kicker="Solutions"
        title={problemTitle ? `P${id} · ${problemTitle}` : '题解区'}
        description="查看大家的解题思路，也可以分享你的做法。"
        actions={
          <Button variant="ghost" onClick={() => navigate(`/oj/p${id}`)}>
            返回题目
          </Button>
        }
      />

      <div className="oj-solutions-toolbar">
        <Badge tone="info">{solutions.length} 篇题解</Badge>
        <Button variant="primary" onClick={handleWriteClick}>
          {canWrite ? '发题解' : '写题解'}
        </Button>
      </div>

      {formError && <div className="auth-error oj-solutions-form-error">{formError}</div>}

      {showForm && canWrite && (
        <Panel className="oj-solution-editor-card">
          <div className="oj-solution-editor-title">
            <input
              className="auth-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="题解标题"
              maxLength={200}
            />
          </div>
          <RichTextEditor value={content} onChange={setContent} placeholder="分享你的思路、代码与踩坑点..." />
          <div className="oj-solution-editor-actions">
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)} disabled={submitting}>
              取消
            </Button>
            <Button variant="primary" size="sm" onClick={() => void handleSubmit()} loading={submitting}>
              发布题解
            </Button>
          </div>
        </Panel>
      )}

      {loading ? (
        <div className="oj-solutions-loading">
          {Array.from({ length: 3 }, (_, index) => <div key={index} className="skeleton skeleton-card" />)}
        </div>
      ) : solutions.length === 0 ? (
        <EmptyState
          title="还没有题解"
          description="通过本题后，点击右上角“发题解”分享你的思路。"
        />
      ) : (
        <div className="oj-solutions-list">
          {solutions.map((solution) => (
            <button
              key={solution.id}
              type="button"
              className="oj-solution-card"
              onClick={() => openInNewTab(`/chat/p/${solution.id}`)}
            >
              <div className="oj-solution-card-main">
                <strong>{solution.title}</strong>
                <span>{solution.userName} · {new Date(solution.createdAt).toLocaleDateString('zh-CN')}</span>
              </div>
              <div className="oj-solution-card-meta">
                <em>👍 {solution.likeCount}</em>
                <em>💬 {solution.commentCount}</em>
                <em>👁 {solution.viewCount}</em>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
