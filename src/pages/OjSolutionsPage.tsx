import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAppContext } from '../context/AppContext'
import { Badge, Button, EmptyState, PageHeader } from '../components/ui'
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
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    const controller = new AbortController()
    ;(async () => {
      try {
        const [problemRes, solutionRes] = await Promise.all([
          fetchJson<ProblemResponse>(`/api/oj/problems/${id}`, { signal: controller.signal }),
          fetchJson<SolutionsResponse>(`/api/oj/problems/${id}/solutions`, { signal: controller.signal }),
        ])
        if (controller.signal.aborted) return
        if (problemRes.response.ok && problemRes.data?.problem) {
          setProblemTitle(problemRes.data.problem.title)
        }
        if (solutionRes.response.ok && solutionRes.data) {
          setSolutions(solutionRes.data.solutions || [])
          setCanWrite(solutionRes.data.canWrite)
        }
      } catch {
        if (!controller.signal.aborted) setError('题解暂时无法加载，请重试')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [id])

  const handleWriteClick = () => {
    if (!currentUser) {
      openAuth('login')
      return
    }
    if (!canWrite) {
      setError('通过该题后才能发布题解')
      return
    }
    setError('')
    navigate(`/oj/solutions/${id}/new`)
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

      {error && <div className="auth-error oj-solutions-form-error">{error}</div>}

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
