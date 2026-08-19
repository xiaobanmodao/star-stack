import { useState, useEffect, useCallback, useRef, useMemo, type CSSProperties } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { useAppContext } from '../context/AppContext'
import { fetchJson } from '../utils'
import { TOKEN_KEY } from '../constants'
import type { Achievement, OjSubmission, ProfileStatsResponse, SubmissionResponse } from '../types'
import { Badge, Button, PageHeader, Panel } from '../components/ui'
import './OjJudgePage.css'

type JudgeCelebrationStats = {
  acceptedCount?: number
  solvedProblems?: number
  currentStreak?: number
  rank?: number
  acceptanceRate?: number
}

type JudgeStage = 'idle' | 'running' | 'success' | 'fail'

type SubmissionPayload = {
  problemId: number
  problemTitle?: string
  language: string
  code: string
}

type JudgeStatusMeta = {
  label: string
  shortLabel: string
  tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info'
  kind: 'idle' | 'running' | 'accepted' | 'wrong' | 'tle' | 'runtime' | 'compile'
  title: string
  description: string
}

const getAchievementDescription = (achievement: Achievement) =>
  achievement.description || achievement.desc || ''

const getJudgeStatusMeta = (status: string | undefined, stage: JudgeStage): JudgeStatusMeta => {
  if (stage === 'running' || status === 'Queued' || status === 'Judging') {
    return {
      label: status === 'Queued' ? '排队中' : '评测中',
      shortLabel: 'RUN',
      tone: 'info',
      kind: 'running',
      title: status === 'Queued' ? '已进入评测队列' : '正在运行测试点',
      description: status === 'Queued' ? '服务器会按顺序处理提交，页面会自动刷新状态。' : '系统正在逐个执行测试点，结果会实时出现在下方。',
    }
  }

  if (!status) {
    return {
      label: '等待提交',
      shortLabel: 'WAIT',
      tone: 'neutral',
      kind: 'idle',
      title: '等待提交数据',
      description: '请从题目页发起提交，或打开已有提交记录查看结果。',
    }
  }

  if (status === 'Accepted') {
    return {
      label: 'Accepted',
      shortLabel: 'AC',
      tone: 'success',
      kind: 'accepted',
      title: '通过了，解题航线稳定入轨',
      description: '这次提交已经通过当前题目的测试点，可以回到题目复盘，也可以查看成长记录。',
    }
  }

  if (status === 'Cancelled') {
    return {
      label: '已取消',
      shortLabel: 'STOP',
      tone: 'neutral',
      kind: 'idle',
      title: '评测请求已取消',
      description: '这次提交没有继续消耗评测资源，你可以修改代码后重新提交。',
    }
  }

  if (status === 'Time Limit Exceeded') {
    return {
      label: 'Time Limit Exceeded',
      shortLabel: 'TLE',
      tone: 'warning',
      kind: 'tle',
      title: '运行超时，先检查复杂度',
      description: '优先确认循环边界、递归状态和数据结构复杂度，必要时用极限数据压测。',
    }
  }

  if (status === 'Runtime Error') {
    return {
      label: 'Runtime Error',
      shortLabel: 'RE',
      tone: 'danger',
      kind: 'runtime',
      title: '运行时错误，先排查边界数据',
      description: '重点检查数组越界、空指针、除零、递归爆栈和输入读取是否匹配。',
    }
  }

  if (status === 'Compile Error') {
    return {
      label: 'Compile Error',
      shortLabel: 'CE',
      tone: 'danger',
      kind: 'compile',
      title: '编译失败，先看第一条错误',
      description: '编译器通常从第一处错误开始连锁报错，先修第一条最有效。',
    }
  }

  return {
    label: status === 'Wrong Answer' ? 'Wrong Answer' : status,
    shortLabel: status === 'Wrong Answer' ? 'WA' : 'ERR',
    tone: 'danger',
    kind: 'wrong',
    title: '答案不匹配，先定位第一个失败点',
    description: '建议从样例、边界值和输出格式开始排查，再对照第一个失败测试点的信息。',
  }
}

export default function OjJudgePage() {
  const navigate = useNavigate()
  const { currentUser } = useAppContext()
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
  const [stage, setStage] = useState<JudgeStage>('idle')
  const [showResults, setShowResults] = useState(false)
  const [retryPayload, setRetryPayload] = useState<SubmissionPayload | null>(null)
  const submitRef = useRef(false)
  const streamCompletedRef = useRef(false)
  const streamCompletedSubmissionIdRef = useRef<number | null>(null)
  const streamAbortRef = useRef<AbortController | null>(null)
  const persistedSubmissionIdRef = useRef<number | null>(null)
  const lastPayloadKeyRef = useRef('')
  const previousSubmissionIdRef = useRef(submissionId)
  const [streamResults, setStreamResults] = useState<{
    index: number
    status: string
    message: string
    timeMs: number
    timeLimitMs?: number
  }[]>([])
  const [totalCases, setTotalCases] = useState(0)
  const [queuePosition, setQueuePosition] = useState<number | null>(null)
  const [activeSubmissionId, setActiveSubmissionId] = useState<number | null>(null)
  const [celebrationStats, setCelebrationStats] = useState<JudgeCelebrationStats | null>(null)
  const [recentAchievements, setRecentAchievements] = useState<Achievement[]>([])
  const [cancelling, setCancelling] = useState(false)

  const loadSubmission = useCallback(async (idValue: number) => {
    setError('')
    try {
      const { response, data } = await fetchJson<SubmissionResponse>(`/api/oj/submissions/${idValue}`)
      if (!response.ok) {
        setError(data?.message || '无法加载提交记录')
        setStage('fail')
        setShowResults(true)
        return
      }
      if (data?.submission) {
        streamCompletedRef.current = true
        setActiveSubmissionId(data.submission.id)
        setSubmission(data.submission)
        const pending = data.submission.status === 'Queued' || data.submission.status === 'Judging'
        const failed = data.submission.status !== 'Accepted'
        if (failed && data.submission.code && data.submission.language) {
          setRetryPayload({
            problemId: data.submission.problemId,
            problemTitle: data.submission.problemTitle,
            language: data.submission.language,
            code: data.submission.code,
          })
        } else if (!pending) {
          setRetryPayload(null)
        }
        if (pending) {
          setQueuePosition(data.submission.queuePosition && data.submission.queuePosition > 0 ? data.submission.queuePosition : null)
          setStage('running')
          setShowResults(false)
          setError('')
          return
        }
        setStage(data.submission.status === 'Accepted' ? 'success' : 'fail')
        setShowResults(true)
        return
      }
      setError('提交记录不存在')
      setStage('fail')
      setShowResults(true)
    } catch {
      setError('提交记录加载失败，请稍后重试')
      setStage('fail')
      setShowResults(true)
    }
  }, [])

  const submitJudge = useCallback(async () => {
    const hasLocationPayload = Boolean(locationState.problemId || locationState.language || locationState.code)
    const locationPayload = locationState.problemId && locationState.language && locationState.code
      ? {
          problemId: locationState.problemId,
          problemTitle: locationState.problemTitle,
          language: locationState.language,
          code: locationState.code,
        }
      : null
    const payload = locationPayload || (!hasLocationPayload ? retryPayload : null)
    if (!payload) {
      if (!hasLocationPayload) return
      setError('提交数据不完整，请返回题目页重新提交')
      setStage('fail')
      setShowResults(true)
      return
    }
    if (submitRef.current) return
    submitRef.current = true
    setRetryPayload(payload)
    setStage('running')
    setError('')
    setShowResults(false)
    streamCompletedRef.current = false
    const abortController = new AbortController()
    streamAbortRef.current = abortController
    setStreamResults([])
    setTotalCases(0)
    setQueuePosition(null)
    setCelebrationStats(null)
    setRecentAchievements([])

    try {
      const token = localStorage.getItem(TOKEN_KEY)
      const resp = await fetch('/api/oj/submissions/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          problemId: payload.problemId,
          language: payload.language,
          code: payload.code,
        }),
        signal: abortController.signal,
      })

      if (!resp.ok) {
        const errData = await resp.json().catch(() => null)
        const typedError = errData as {
          message?: string
          activeJudges?: number
          queuedJudges?: number
          maxActiveJudges?: number
          maxQueuedJudges?: number
        } | null
        const queueHint = resp.status === 503 && typedError?.activeJudges !== undefined && typedError.maxActiveJudges !== undefined
          ? `（运行中 ${typedError.activeJudges}/${typedError.maxActiveJudges}，排队中 ${typedError.queuedJudges ?? 0}/${typedError.maxQueuedJudges ?? '--'}）`
          : ''
        const retryAfter = resp.headers.get('Retry-After')
        const retryHint = retryAfter ? `，约 ${retryAfter} 秒后可重试` : ''
        setError(`${typedError?.message || '评测失败'}${queueHint}${retryHint}`)
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
      let streamError = false

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
              if (eventType === 'queued') {
                if (Number(payload.submissionId) > 0) {
                  persistedSubmissionIdRef.current = Number(payload.submissionId)
                  setActiveSubmissionId(Number(payload.submissionId))
                }
                setQueuePosition(Number(payload.position) > 0 ? Number(payload.position) : null)
                if (payload.totalCases) setTotalCases(payload.totalCases)
              } else if (eventType === 'heartbeat') {
                const position = Number(payload.queuePosition) || 0
                setQueuePosition(position > 0 ? position : null)
              } else if (eventType === 'start') {
                if (Number(payload.submissionId) > 0) {
                  persistedSubmissionIdRef.current = Number(payload.submissionId)
                  setActiveSubmissionId(Number(payload.submissionId))
                }
                setQueuePosition(null)
                setTotalCases(payload.totalCases)
              } else if (eventType === 'testcase') {
                setStreamResults(prev => [...prev, payload])
              } else if (eventType === 'done') {
                setQueuePosition(null)
                persistedSubmissionIdRef.current = null
                doneSubmission = payload.submission
                if (Number(payload.submission?.id) > 0) setActiveSubmissionId(Number(payload.submission.id))
              } else if (eventType === 'error') {
                setQueuePosition(null)
                setError(payload.message || '评测失败，请稍后重试')
                setStage('fail')
                setShowResults(true)
                streamError = true
              }
            } catch {
              setError('评测返回数据异常，请稍后重试')
              setStage('fail')
              setShowResults(true)
              streamError = true
            }
            eventType = ''
          }
        }
        if (streamError) break
      }

      if (streamError) return
      if (!doneSubmission) {
        if (persistedSubmissionIdRef.current) {
          const pendingId = persistedSubmissionIdRef.current
          submitRef.current = false
          navigate(`/oj/judge/${pendingId}`, { replace: true })
          setError('评测连接已中断，正在通过提交记录继续跟踪状态')
          return
        }
        setError('评测连接已中断，请重新提交')
        setStage('fail')
        setShowResults(true)
        return
      }
      setSubmission(doneSubmission)
      streamCompletedRef.current = true
      streamCompletedSubmissionIdRef.current = doneSubmission.id
      const accepted = (doneSubmission as OjSubmission).status === 'Accepted'
      setStage(accepted ? 'success' : 'fail')
      navigate(`/oj/judge/${doneSubmission.id}`, { replace: true, state: payload })
      setTimeout(() => { setShowResults(true) }, 1100)
    } catch {
      if (abortController.signal.aborted) return
      setError('评测请求失败')
      setStage('fail')
      setShowResults(true)
    } finally {
      if (streamAbortRef.current === abortController) {
        streamAbortRef.current = null
      }
    }
  }, [locationState.code, locationState.language, locationState.problemId, locationState.problemTitle, navigate, retryPayload])

  const retrySubmission = useCallback(() => {
    if (!retryPayload) return
    submitRef.current = false
    streamCompletedRef.current = false
    streamCompletedSubmissionIdRef.current = null
    setSubmission(null)
    setError('')
    setStage('idle')
    setShowResults(false)
    setStreamResults([])
    setTotalCases(0)
    setQueuePosition(null)
    setActiveSubmissionId(null)
    void submitJudge()
  }, [retryPayload, submitJudge])

  const cancelQueuedSubmission = useCallback(async () => {
    const targetSubmissionId = submissionId || activeSubmissionId
    if (!targetSubmissionId || cancelling) return
    setCancelling(true)
    try {
      const { response, data } = await fetchJson<{ message?: string }>(`/api/oj/submissions/${targetSubmissionId}/cancel`, {
        method: 'POST',
      })
      if (!response.ok) {
        setError(data?.message || '取消失败，请刷新后重试')
        return
      }
      streamAbortRef.current?.abort()
      setQueuePosition(null)
      setActiveSubmissionId(targetSubmissionId)
      setSubmission((current) => current ? { ...current, status: 'Cancelled', message: data?.message || '评测请求已取消' } : current)
      setStage('fail')
      setShowResults(true)
      setError('评测请求已取消')
    } catch {
      setError('网络异常，取消请求未完成')
    } finally {
      setCancelling(false)
    }
  }, [activeSubmissionId, cancelling, submissionId])

  // 卸载时中止评测流连接
  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort()
      streamAbortRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!locationState.problemId || !locationState.language || !locationState.code) return
    const payloadKey = `${locationState.problemId}:${locationState.language}:${locationState.code}`
    if (lastPayloadKeyRef.current && lastPayloadKeyRef.current !== payloadKey) {
      streamAbortRef.current?.abort()
      submitRef.current = false
      streamCompletedRef.current = false
      streamCompletedSubmissionIdRef.current = null
      setRetryPayload(null)
      setSubmission(null)
      setError('')
      setStage('idle')
      setShowResults(false)
      setStreamResults([])
      setTotalCases(0)
      setQueuePosition(null)
      setActiveSubmissionId(null)
    }
    lastPayloadKeyRef.current = payloadKey
  }, [locationState.code, locationState.language, locationState.problemId])

  useEffect(() => {
    if (previousSubmissionIdRef.current === submissionId) return
    const preservingStreamResult = streamCompletedSubmissionIdRef.current === submissionId
    previousSubmissionIdRef.current = submissionId
    if (preservingStreamResult) return

    streamCompletedRef.current = false
    submitRef.current = false
    setSubmission(null)
    setRetryPayload(null)
    setError('')
    setStage('idle')
    setShowResults(false)
    setStreamResults([])
    setTotalCases(0)
    setQueuePosition(null)
    setActiveSubmissionId(null)
  }, [submissionId])

  useEffect(() => {
    // 如果有 submissionId，说明是查看已有提交，直接加载（流式评测完成跳转过来的跳过，避免重复拉取）
    if (submissionId && !streamCompletedRef.current && !submitRef.current) {
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

  useEffect(() => {
    if (!submissionId || !submission || !['Queued', 'Judging'].includes(submission.status)) return
    const timer = window.setInterval(() => {
      void loadSubmission(submissionId)
    }, 3000)
    return () => window.clearInterval(timer)
  }, [loadSubmission, submission, submissionId])

  useEffect(() => {
    if (stage !== 'success' || !submission || !currentUser?.id) return

    let cancelled = false
    ;(async () => {
      const [profileRes, achievementsRes] = await Promise.all([
        fetchJson<ProfileStatsResponse>(`/api/user/profile/${currentUser.id}`),
        fetchJson<{ achievements: Achievement[] }>(`/api/user/achievements/${currentUser.id}`),
      ])

      if (cancelled) return

      if (profileRes.response.ok && profileRes.data?.stats) {
        setCelebrationStats({
          acceptedCount: profileRes.data.stats.acceptedCount,
          solvedProblems: profileRes.data.stats.solvedProblems,
          currentStreak: profileRes.data.stats.currentStreak,
          rank: profileRes.data.stats.rank,
          acceptanceRate: profileRes.data.stats.acceptanceRate,
        })
      }

      if (achievementsRes.response.ok && achievementsRes.data?.achievements) {
        const baseTime = submission.createdAt ? new Date(submission.createdAt).getTime() : Date.now()
        const unlocked = achievementsRes.data.achievements.filter((achievement) => {
          if (!achievement.unlockedAt) return false
          const unlockedTime = new Date(achievement.unlockedAt).getTime()
          return Math.abs(unlockedTime - baseTime) <= 2 * 60 * 1000
        })
        setRecentAchievements(unlocked.slice(0, 3))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [currentUser?.id, stage, submission])

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

  const problemId = submission?.problemId || locationState.problemId || retryPayload?.problemId
  const problemTitle = submission?.problemTitle || locationState.problemTitle || retryPayload?.problemTitle || (problemId ? `P${problemId}` : '提交结果')
  const statusMeta = getJudgeStatusMeta(submission?.status, stage)
  const canRetrySubmission = stage === 'fail' && Boolean(retryPayload)
  const visibleResults = stage === 'running' ? streamResults : results
  const passedCases = visibleResults.filter((item) => item.status === 'Accepted').length
  const firstFailedCase = visibleResults.find((item) => item.status !== 'Accepted')
  const resultCaseCount = stage === 'running' ? (totalCases || streamResults.length) : results.length
  const visibleProgress = resultCaseCount > 0
    ? Math.round(((stage === 'running' ? streamResults.length : passedCases) / resultCaseCount) * 100)
    : 0
  const resultSummary = [
    {
      label: '得分',
      value: submission?.score !== undefined ? `${submission.score} / 100` : stage === 'running' ? '计算中' : '--',
    },
    {
      label: '测试点',
      value: resultCaseCount > 0 ? `${stage === 'running' ? streamResults.length : passedCases} / ${resultCaseCount}` : '--',
    },
    {
      label: '算法耗时',
      value: submission?.timeMs !== undefined && submission.timeMs !== null ? `${submission.timeMs} ms` : '--',
    },
    {
      label: '语言',
      value: submission?.language || locationState.language || retryPayload?.language || '--',
    },
  ]

  return (
    <section className={`section judge-page-v2 judge-page-${statusMeta.kind}`}>
      <PageHeader
        kicker="Judge Result"
        title={problemTitle}
        description="提交后的状态、测试点和源代码集中在这里，方便你快速决定下一步。"
        actions={(
          <>
            {submissionId && error && (
              <Button variant="ghost" onClick={() => void loadSubmission(submissionId)}>
                重新加载
              </Button>
            )}
            {submission?.canViewCode && submission.code && problemId && (
              <Button
                variant="ghost"
                onClick={() => navigate(`/oj/p${problemId}`, {
                  state: {
                    restoreSubmission: {
                      problemId,
                      problemTitle,
                      language: submission.language,
                      code: submission.code,
                    },
                  },
                })}
              >
                恢复到 IDE
              </Button>
            )}
            {canRetrySubmission && (
              <Button variant="primary" onClick={retrySubmission}>
                重新提交
              </Button>
            )}
            {(submission?.status === 'Queued' || (stage === 'running' && queuePosition && activeSubmissionId)) && (
              <Button variant="ghost" onClick={() => void cancelQueuedSubmission()} loading={cancelling}>
                取消排队
              </Button>
            )}
            {problemId && (
              <Button variant={canRetrySubmission ? 'ghost' : 'primary'} onClick={() => navigate(`/oj/p${problemId}`)}>
                {stage === 'fail' ? '返回修改' : '返回题目'}
              </Button>
            )}
            <Button variant="ghost" onClick={() => navigate('/oj/submissions')}>
              提交记录
            </Button>
          </>
        )}
      />
      {error && <div className="auth-error">{error}</div>}

      <Panel className="judge-overview" elevated>
        <div className={`judge-visual ${statusMeta.kind}`}>
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
              <div className="judge-result-text wrong">{statusMeta.shortLabel}</div>
            )}
          </div>
          <div className="judge-orbit-label">{statusMeta.shortLabel}</div>
        </div>

        <div className="judge-overview-main">
          <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
          <h2>{statusMeta.title}</h2>
          <p>{statusMeta.description}</p>
          {submission?.message && <div className="judge-status-message">{submission.message}</div>}
          <div className="judge-progress-line" aria-label={`评测进度 ${visibleProgress}%`}>
            <span style={{ width: `${visibleProgress}%` }} />
          </div>
          <div className="judge-summary-grid">
            {resultSummary.map((item) => (
              <div key={item.label} className="judge-summary-card">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
          {!submission && stage === 'running' && (
            <div className="judge-status-wait">
              {queuePosition
                ? `评测资源繁忙，已进入队列，当前排位约为第 ${queuePosition} 位。`
                : '正在判题，测试点会陆续点亮。'}
            </div>
          )}
        </div>
      </Panel>

      {showResults && stage !== 'success' && firstFailedCase && (
        <Panel className="judge-first-fail-panel">
          <div className="judge-first-fail">
            <span>第一个失败点</span>
            <strong>#{firstFailedCase.index + 1} · {firstFailedCase.status}</strong>
            {firstFailedCase.timeMs !== undefined && (
              <em>
                {firstFailedCase.timeMs}ms
                {firstFailedCase.timeLimitMs !== undefined && ` / 限时 ${firstFailedCase.timeLimitMs}ms`}
              </em>
            )}
            {firstFailedCase.message && <p>{firstFailedCase.message}</p>}
          </div>
        </Panel>
      )}

      {stage === 'success' && submission && (
        <div className="judge-celebration-panel">
          <div className="judge-celebration-copy">
            <div className="judge-celebration-kicker">本次通过</div>
            <h3>{submission.score === 100 ? '这次提交非常干净，已经稳稳拿下。' : '这次提交通过了，继续保持这个节奏。'}</h3>
            <p>
              {submission.timeMs !== undefined && submission.timeMs !== null
                ? `本次算法用时 ${submission.timeMs}ms。`
                : '这次提交已经成功进入通过记录。'}
              {celebrationStats?.currentStreak ? ` 你当前已经连续做题 ${celebrationStats.currentStreak} 天。` : ''}
            </p>
          </div>
          <div className="judge-celebration-stats">
            <div className="judge-celebration-stat">
              <span>通过次数</span>
              <strong>{celebrationStats?.acceptedCount ?? '--'}</strong>
            </div>
            <div className="judge-celebration-stat">
              <span>已解题目</span>
              <strong>{celebrationStats?.solvedProblems ?? '--'}</strong>
            </div>
            <div className="judge-celebration-stat">
              <span>当前连续天数</span>
              <strong>{celebrationStats?.currentStreak ?? '--'}</strong>
            </div>
            <div className="judge-celebration-stat">
              <span>当前通过率</span>
              <strong>{celebrationStats?.acceptanceRate !== undefined ? `${celebrationStats.acceptanceRate.toFixed(1)}%` : '--'}</strong>
            </div>
          </div>
          <div className="judge-celebration-actions">
            {submission.problemId && (
              <Button variant="ghost" onClick={() => navigate(`/oj/p${submission.problemId}`)}>
                返回题目
              </Button>
            )}
            <Button variant="ghost" onClick={() => navigate('/oj/submissions')}>
              查看我的提交
            </Button>
            <Button variant="primary" onClick={() => navigate('/account')}>
              查看成长记录
            </Button>
          </div>
          {recentAchievements.length > 0 && (
            <div className="judge-achievement-strip">
              <div className="judge-achievement-strip-title">刚刚解锁的成就</div>
              <div className="judge-achievement-list">
                {recentAchievements.map((achievement) => (
                  <div key={`${achievement.id}-${achievement.unlockedAt}`} className="judge-achievement-card">
                    <div className="judge-achievement-icon" aria-hidden="true">{achievement.icon || '🏅'}</div>
                    <div>
                      <div className="judge-achievement-name">{achievement.name}</div>
                      <div className="judge-achievement-desc">{getAchievementDescription(achievement)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {stage === 'running' && (totalCases > 0 || streamResults.length > 0) && (
        <Panel className="sse-progress judge-live-progress">
          <div className="sse-progress-bar">
            <div className="sse-progress-fill" style={{ width: `${totalCases > 0 ? (streamResults.length / totalCases) * 100 : 0}%` }} />
          </div>
          <div className="sse-progress-text">已完成 {streamResults.length}{totalCases > 0 ? ` / ${totalCases}` : ' 个测试点'}</div>
          <div className="sse-testcase-grid">
            {streamResults.map((tc) => (
              <span key={tc.index} className={`sse-tc-dot ${tc.status === 'Accepted' ? 'ac' : tc.status === 'Time Limit Exceeded' ? 'tle' : 'err'}`} title={`#${tc.index + 1}: ${tc.status}`} />
            ))}
            {Array.from({ length: totalCases - streamResults.length }, (_, i) => (
              <span key={`pending-${i}`} className="sse-tc-dot pending" />
            ))}
          </div>
        </Panel>
      )}

      {(showResults || stage === 'running') && (
        <Panel className="submit-results judge-results-panel">
          <div className="judge-panel-head">
            <div>
              <div className="judge-panel-kicker">Test Cases</div>
            <h3>{stage === 'running' ? '实时测试点结果' : '测试点结果'}</h3>
          </div>
            <span>{passedCases} / {resultCaseCount || 0} Accepted{stage === 'running' ? ' · 实时更新' : ''}</span>
          </div>
          <div className="submit-results-grid">
            {visibleResults.length === 0 && <div className="admin-empty">等待第一个测试点返回结果…</div>}
            {visibleResults.map((item) => (
              <div
                key={`${item.index}-${item.status}`}
                className={`submit-result ${item.status === 'Accepted' ? 'ok' : 'bad'}`}
              >
                <div className="submit-result-index">#{item.index + 1}</div>
                <div className="submit-result-status">{item.status}</div>
                {item.timeMs !== undefined && (
                  <div className="submit-result-time">
                    {item.timeMs}ms
                    {item.timeLimitMs !== undefined && ` / 限时 ${item.timeLimitMs}ms`}
                  </div>
                )}
                {item.message && <div className="submit-result-message">{item.message}</div>}
              </div>
            ))}
          </div>
          {submission?.canViewCode && submission?.code && (
            <div className="judge-code-panel">
              <div className="judge-panel-head">
                <div>
                  <div className="judge-panel-kicker">Source</div>
                  <h3>源代码</h3>
                </div>
              </div>
              <pre className="submission-code">{submission.code}</pre>
            </div>
          )}
        </Panel>
      )}
    </section>
  )
}
