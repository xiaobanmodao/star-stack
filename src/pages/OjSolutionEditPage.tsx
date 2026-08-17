import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAppContext } from '../context/AppContext'
import RichTextEditor from '../components/RichTextEditor'
import { Button, PageHeader, Panel } from '../components/ui'
import { fetchJson } from '../utils'
import type { ProblemResponse, SolutionsResponse } from '../types'
import './OjSolutionEditPage.css'

export default function OjSolutionEditPage() {
  const navigate = useNavigate()
  const { id = '' } = useParams<{ id: string }>()
  const { currentUser, openAuth } = useAppContext()
  const [problemTitle, setProblemTitle] = useState('')
  const [canWrite, setCanWrite] = useState(false)
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

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
        setCanWrite(solutionRes.data.canWrite)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  const handleSubmit = async () => {
    if (!currentUser) {
      openAuth('login')
      return
    }
    if (!canWrite) {
      setError('通过该题后才能发布题解')
      return
    }
    if (!title.trim()) {
      setError('请填写题解标题')
      return
    }
    if (!content.trim()) {
      setError('请填写题解内容')
      return
    }
    setSubmitting(true)
    setError('')
    const { response, data } = await fetchJson<{ postId?: number; message?: string }>(
      `/api/oj/problems/${id}/solutions`,
      {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), content }),
      }
    )
    setSubmitting(false)
    if (response.ok && data?.postId) {
      navigate(`/oj/solutions/${id}`)
    } else {
      setError(data?.message || '发布题解失败')
    }
  }

  if (loading) {
    return (
      <div className="oj-page oj-solution-edit-page">
        <div className="skeleton skeleton-title" style={{ width: 280, height: 28 }} />
        <div className="skeleton skeleton-card" style={{ height: 320, marginTop: 16 }} />
      </div>
    )
  }

  return (
    <div className="oj-page oj-solution-edit-page">
      <PageHeader
        kicker="Write Solution"
        title={problemTitle ? `P${id} · ${problemTitle}` : '写题解'}
        description="用完整页面认真写好每一篇题解。"
        actions={
          <Button variant="ghost" onClick={() => navigate(`/oj/solutions/${id}`)}>
            返回题解区
          </Button>
        }
      />

      <Panel className="oj-solution-edit-card">
        <label className="oj-solution-edit-field">
          <span>题解标题</span>
          <input
            className="auth-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="一句话概括你的思路"
            maxLength={200}
          />
        </label>

        <label className="oj-solution-edit-field">
          <span>题解内容</span>
          <RichTextEditor value={content} onChange={setContent} placeholder="分享你的思路、代码与踩坑点..." />
        </label>

        {error && <div className="auth-error">{error}</div>}

        <div className="oj-solution-edit-actions">
          <Button variant="ghost" onClick={() => navigate(`/oj/solutions/${id}`)} disabled={submitting}>
            取消
          </Button>
          <Button variant="primary" onClick={() => void handleSubmit()} loading={submitting}>
            发布题解
          </Button>
        </div>
      </Panel>
    </div>
  )
}
