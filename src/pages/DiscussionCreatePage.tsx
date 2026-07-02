import { useState, useEffect, useCallback } from 'react'
import { useNavigate, Navigate, useSearchParams } from 'react-router-dom'
import { useAppContext } from '../context/AppContext'
import RichTextEditor from '../components/RichTextEditor'
import { fetchJson } from '../utils'
import type { ApiResponse, OjProblemSummary, ProblemResponse, ProblemsResponse } from '../types'
import { Badge, Button, PageHeader, Panel } from '../components/ui'
import './DiscussionPages.css'

export default function DiscussionCreatePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
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
  const initialProblemId = searchParams.get('problemId')

  const searchProblems = useCallback(async (q: string) => {
    if (!q.trim()) { setProblemResults([]); return }
    const { response, data } = await fetchJson<ProblemsResponse>(`/api/oj/problems?search=${encodeURIComponent(q)}&pageSize=5`)
    if (response.ok && data) setProblemResults(data.problems || [])
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => searchProblems(problemSearch), 300)
    return () => clearTimeout(timer)
  }, [problemSearch, searchProblems])

  useEffect(() => {
    if (!initialProblemId || problemId) return
    let cancelled = false
    ;(async () => {
      const { response, data } = await fetchJson<ProblemResponse>(`/api/oj/problems/${initialProblemId}`)
      if (cancelled || !response.ok || !data?.problem) return
      setProblemId(data.problem.id)
      setSelectedProblemTitle(data.problem.title)
    })()
    return () => {
      cancelled = true
    }
  }, [initialProblemId, problemId])

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
        navigate(`/discussions/${data.postId}`, problemId ? { state: { fromProblemId: problemId } } : undefined)
      } else {
        setError(data?.message || '发帖失败')
      }
    } catch { setError('发帖失败') }
    finally { setSubmitting(false) }
  }

  if (!currentUser) return <Navigate to="/auth" replace />

  return (
    <section className="discussion-create-page discussion-create-v2">
      <PageHeader
        kicker="New Thread"
        title="发起讨论"
        description={problemId
          ? '这条讨论会绑定到题目页，其他同学能从题目详情直接看到它。'
          : '发布提问、题解或经验分享。关联题目后，讨论会进入题目的讨论入口。'}
        actions={selectedProblemTitle ? <Badge tone="info">P{problemId} {selectedProblemTitle}</Badge> : undefined}
      />
      {error && <div className="discussion-error">{error}</div>}

      <Panel className="discussion-create-shell">
        <div className="discussion-create-main">
          <div className="form-group">
            <label>
              标题
              <span>{title.length}/200</span>
            </label>
            <input type="text" maxLength={200} placeholder="例如：P1001 这题为什么 WA？" value={title} onChange={e => setTitle(e.target.value)} />
          </div>

          <div className="form-group">
            <label>
              关联题目
              <span>可选，但推荐</span>
            </label>
            <div className="problem-selector discussion-problem-selector">
              {selectedProblemTitle ? (
                <div className="selected-problem">
                  <span>P{problemId} {selectedProblemTitle}</span>
                  <button type="button" onClick={() => { setProblemId(null); setSelectedProblemTitle(''); setProblemSearch('') }}>x</button>
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
            <label>
              内容
              <span>支持富文本</span>
            </label>
            <RichTextEditor value={content} onChange={setContent} placeholder="描述你的思路、问题、代码片段或题解..." />
          </div>
        </div>

        <aside className="discussion-create-aside">
          <div className="discussion-side-kicker">Checklist</div>
          <h3>更容易得到有效回复</h3>
          <p>如果是求助帖，建议写清楚错误状态、样例结果、关键代码和你已经尝试过的方向。</p>
          <div className="discussion-create-checks">
            <span>关联题目</span>
            <span>说明错误状态</span>
            <span>贴出核心代码</span>
            <span>写出已尝试思路</span>
          </div>
        </aside>
      </Panel>

      <div className="form-actions discussion-create-actions">
        <Button variant="ghost" onClick={() => {
          if (problemId || initialProblemId) {
            navigate(`/oj/p${problemId || initialProblemId}`)
            return
          }
          navigate('/discussions')
        }}>
          取消
        </Button>
        <Button variant="primary" loading={submitting} disabled={submitting} onClick={handleSubmit}>
          {submitting ? '发布中...' : '发布'}
        </Button>
      </div>
    </section>
  )
}

// === Discussion Edit Page ===
