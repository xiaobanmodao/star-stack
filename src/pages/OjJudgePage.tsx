import { useState, useEffect, useCallback, useRef, useMemo, type CSSProperties } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { fetchJson } from '../utils'
import { TOKEN_KEY } from '../constants'
import type { OjSubmission, SubmissionResponse } from '../types'

export default function OjJudgePage() {
  const navigate = useNavigate()
  const params = useParams()
  const location = useLocation()
  const locationState = (location.state || {}) as {
    problemId?: number
    problemTitle?: string
    language?: string
    code?: string
  }
  const submissionId = params.id ? Number(params.id) : null
  const [submission, setSubmission] = useState<OjSubmission | null>(null)
  const [error, setError] = useState('')
  const [stage, setStage] = useState<'idle' | 'running' | 'success' | 'fail'>('idle')
  const [showResults, setShowResults] = useState(false)
  const submitRef = useRef(false)
  const [streamResults, setStreamResults] = useState<{ index: number; status: string; message: string; timeMs: number }[]>([])
  const [totalCases, setTotalCases] = useState(0)

  const loadSubmission = useCallback(async (idValue: number) => {
    const { response, data } = await fetchJson<SubmissionResponse>(`/api/oj/submissions/${idValue}`)
    if (!response.ok) {
      setError(data?.message || '无法加载提交记录')
      return
    }
    if (data?.submission) {
      setSubmission(data.submission)
      setStage(data.submission?.status === 'Accepted' ? 'success' : 'fail')
      setShowResults(true)
    }
  }, [])

  const submitJudge = useCallback(async () => {
    if (submitRef.current) return
    submitRef.current = true
    if (!locationState.problemId || !locationState.language || !locationState.code) {
      return
    }
    setStage('running')
    setError('')
    setShowResults(false)
    setStreamResults([])
    setTotalCases(0)

    try {
      const token = localStorage.getItem(TOKEN_KEY)
      const resp = await fetch('/api/oj/submissions/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          problemId: locationState.problemId,
          language: locationState.language,
          code: locationState.code,
        }),
      })

      if (!resp.ok) {
        const errData = await resp.json().catch(() => null)
        setError((errData as { message?: string } | null)?.message || '评测失败')
        setStage('fail')
        setShowResults(true)
        return
      }

      const reader = resp.body?.getReader()
      if (!reader) {
        setError('浏览器不支持流式读取')
        setStage('fail')
        setShowResults(true)
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''
      let doneSubmission: OjSubmission | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        let eventType = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            try {
              const payload = JSON.parse(line.slice(6))
              if (eventType === 'start') {
                setTotalCases(payload.totalCases)
              } else if (eventType === 'testcase') {
                setStreamResults(prev => [...prev, payload])
              } else if (eventType === 'done') {
                doneSubmission = payload.submission
              }
            } catch {
              return undefined
            }
            eventType = ''
          }
        }
      }

      if (doneSubmission) {
        setSubmission(doneSubmission)
        const accepted = (doneSubmission as OjSubmission).status === 'Accepted'
        setStage(accepted ? 'success' : 'fail')
        navigate(`/oj/judge/${(doneSubmission as OjSubmission).id}`, { replace: true })
        setTimeout(() => { setShowResults(true) }, 1100)
      }
    } catch {
      setError('评测请求失败')
      setStage('fail')
      setShowResults(true)
    }
  }, [locationState.code, locationState.language, locationState.problemId, navigate])

  useEffect(() => {
    // 如果有 submissionId，说明是查看已有提交，直接加载
    if (submissionId) {
      const timer = window.setTimeout(() => {
        void loadSubmission(submissionId)
      }, 0)
      return () => window.clearTimeout(timer)
    }
    // 如果有 state 数据且没有 submissionId，说明是新提交
    if (locationState.problemId && locationState.language && locationState.code) {
      const timer = window.setTimeout(() => {
        void submitJudge()
      }, 0)
      return () => window.clearTimeout(timer)
    }
  }, [
    loadSubmission,
    locationState.code,
    locationState.language,
    locationState.problemId,
    submissionId,
    submitJudge,
  ])

  const results = submission?.results || []
  const animClass =
    stage === 'running' ? 'launch' : stage === 'success' ? 'success' : stage === 'fail' ? 'fail' : ''
  const fireworkParticles = useMemo(
    (): Array<{ dx: number; dy: number; size: number; delay: number; hue: number }> =>
      Array.from({ length: 28 }, (_, index) => {
        const angle = (index / 28) * Math.PI * 2
        const radius = 46 + (index % 4) * 14
        return {
          dx: Math.cos(angle) * radius,
          dy: Math.sin(angle) * radius,
          size: index % 5 === 0 ? 7 : index % 3 === 0 ? 5 : 4,
          delay: (index % 7) * 0.04,
          hue: 190 + (index * 17) % 130,
        }
      }),
    []
  )

  return (
    <section className="section">
      <div className="section-header">
        <h2>评测结果</h2>
        {submission?.problemId && (
          <button
            className="primary"
            onClick={() => navigate(`/oj/p${submission.problemId}`)}
          >
            返回题目
          </button>
        )}
      </div>
      {error && <div className="auth-error">{error}</div>}
      <div className="judge-hero">
        <div className={`submit-anim ${animClass}`}>
          <div className="rocket">
            <div className="rocket-body">
              <div className="rocket-window" />
              <div className="rocket-fin left" />
              <div className="rocket-fin right" />
            </div>
            <div className="rocket-flame" />
            <div className="rocket-trail" />
          </div>
          <div className="fireworks">
            <div className="firework-core" />
            <div className="firework-ring ring-a" />
            <div className="firework-ring ring-b" />
            <div className="firework-halo" />
            {fireworkParticles.map((particle: { dx: number; dy: number; size: number; delay: number; hue: number }, index: number) => (
              <span
                key={index}
                style={
                  {
                    '--dx': `${particle.dx}px`,
                    '--dy': `${particle.dy}px`,
                    '--size': `${particle.size}px`,
                    '--delay': `${particle.delay}s`,
                    '--hue': particle.hue,
                  } as CSSProperties
                }
              />
            ))}
          </div>
          <div className="crash-smoke">
            <span />
            <span />
            <span />
          </div>
          {stage === 'success' && showResults && (
            <div className="judge-result-text accepted">ACCEPTED</div>
          )}
          {stage === 'fail' && showResults && (
            <div className="judge-result-text wrong">WRONG</div>
          )}
        </div>
        <div className="judge-status">
          <div className="judge-status-title">状态</div>
          <div className="judge-status-main">
            {submission?.status || (stage === 'running' ? '评测中' : '等待提交')}
          </div>
          {submission?.message && <div className="judge-status-message">{submission.message}</div>}
          {submission?.score !== undefined && (
            <div className={`judge-status-score ${submission.score === 100 ? 'score-perfect' : 'score-partial'}`}>
              得分: {submission.score}
            </div>
          )}
          {!submission && stage === 'running' && <div className="judge-status-wait">正在判题</div>}
        </div>
      </div>

      {stage === 'running' && totalCases > 0 && (
        <div className="sse-progress">
          <div className="sse-progress-bar">
            <div className="sse-progress-fill" style={{ width: `${(streamResults.length / totalCases) * 100}%` }} />
          </div>
          <div className="sse-progress-text">{streamResults.length} / {totalCases}</div>
          <div className="sse-testcase-grid">
            {streamResults.map((tc) => (
              <span key={tc.index} className={`sse-tc-dot ${tc.status === 'Accepted' ? 'ac' : tc.status === 'Time Limit Exceeded' ? 'tle' : 'err'}`} title={`#${tc.index + 1}: ${tc.status}`} />
            ))}
            {Array.from({ length: totalCases - streamResults.length }, (_, i) => (
              <span key={`pending-${i}`} className="sse-tc-dot pending" />
            ))}
          </div>
        </div>
      )}

      {showResults && (
        <div className="submit-results">
          <div className="submit-results-title">测试点结果</div>
          <div className="submit-results-grid">
            {results.length === 0 && <div className="admin-empty">暂无测试点结果</div>}
            {results.map((item) => (
              <div
                key={`${item.index}-${item.status}`}
                className={`submit-result ${item.status === 'Accepted' ? 'ok' : 'bad'}`}
              >
                <div>测试点 {item.index + 1}</div>
                <div>{item.status}</div>
                {item.timeMs !== undefined && <div>{item.timeMs}ms</div>}
                {item.message && <div className="submit-result-message">{item.message}</div>}
              </div>
            ))}
          </div>
          {submission?.canViewCode && submission?.code && (
            <>
              <div className="submit-results-title" style={{ marginTop: '20px' }}>
                源代码
              </div>
              <pre className="submission-code">{submission.code}</pre>
            </>
          )}
        </div>
      )}
    </section>
  )
}

