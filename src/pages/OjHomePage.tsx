import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppContext } from '../context/AppContext'
import type { OjProblemSummary } from '../types'
import { fetchJson } from '../utils'

export default function OjHomePage() {
  const navigate = useNavigate()
  const { currentUser, problemPlan, removeFromPlan, togglePlanComplete } = useAppContext()
  const [quickJumpId, setQuickJumpId] = useState('')
  const [recommendations, setRecommendations] = useState<OjProblemSummary[]>([])
  const [hotProblems, setHotProblems] = useState<Array<{
    id: number
    slug?: string
    title: string
    difficulty: string
    submission_count: number
  }>>([])
  const [recentAC, setRecentAC] = useState<Array<{
    created_at: string
    user_name: string
    avatar?: string
    problem_id: number
    problem_title: string
  }>>([])
  const [weeklyStats, setWeeklyStats] = useState<Array<{
    date: string
    submissions: number
    accepted: number
  }>>([])
  const [chartTooltip, setChartTooltip] = useState<{
    visible: boolean
    x: number
    y: number
    date: string
    submissions: number
    accepted: number
  } | null>(null)
  const [randomDifficulty] = useState('')
  const [loading, setLoading] = useState(true)

  const loadWeeklyStats = useCallback(async () => {
    if (!currentUser?.id) {
      setWeeklyStats([])
      return
    }

    const { data } = await fetchJson<{
      weeklyStats: Array<{
        date: string
        submissions: number
        accepted: number
      }>
    }>(`/api/user/weekly-stats/${currentUser.id}`)

    if (data?.weeklyStats) {
      setWeeklyStats(data.weeklyStats)
    }
  }, [currentUser])

  const loadRecommendations = useCallback(async () => {
    const { data } = await fetchJson<{ recommendations: OjProblemSummary[] }>('/api/oj/recommendations')
    if (data?.recommendations) {
      setRecommendations(data.recommendations)
    }
  }, [])

  const loadHotProblems = useCallback(async () => {
    const { data } = await fetchJson<{
      hotProblems: Array<{
        id: number
        slug?: string
        title: string
        difficulty: string
        submission_count: number
      }>
    }>('/api/oj/hot-problems')

    if (data?.hotProblems) {
      setHotProblems(data.hotProblems)
    }
  }, [])

  const loadRecentAC = useCallback(async () => {
    const { data } = await fetchJson<{
      recentAC: Array<{
        created_at: string
        user_name: string
        avatar?: string
        problem_id: number
        problem_title: string
      }>
    }>('/api/oj/recent-ac')

    if (data?.recentAC) {
      setRecentAC(data.recentAC)
    }
  }, [])

  const loadAllData = useCallback(async () => {
    setLoading(true)
    await Promise.all([
      loadRecommendations(),
      loadHotProblems(),
      loadRecentAC(),
      loadWeeklyStats()
    ])
    setLoading(false)
  }, [loadHotProblems, loadRecentAC, loadRecommendations, loadWeeklyStats])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAllData()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadAllData])

  const handleQuickJump = useCallback(() => {
    const value = quickJumpId.trim().toLowerCase()
    if (!value) return

    const match = value.match(/\d+/)
    if (!match) return

    navigate(`/oj/p${match[0]}`)
  }, [navigate, quickJumpId])

  const handleRandomProblem = async () => {
    const params = randomDifficulty ? `?difficulty=${randomDifficulty}` : ''
    const { data } = await fetchJson<{ problem: OjProblemSummary }>(`/api/oj/random-problem${params}`)
    if (data?.problem) {
      navigate(`/oj/p${data.problem.id}`)
    }
  }

  const formatTimeAgo = (dateString: string) => {
    const now = new Date()
    const date = new Date(dateString)
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)

    if (seconds < 60) return '刚刚'
    if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`
    return `${Math.floor(seconds / 86400)} 天前`
  }

  const pendingPlanCount = problemPlan.filter((plan) => !plan.completed).length
  const weeklySubmissionTotal = weeklyStats.reduce((sum, item) => sum + item.submissions, 0)
  const weeklyAcceptedTotal = weeklyStats.reduce((sum, item) => sum + item.accepted, 0)
  const hotTrafficTotal = hotProblems.reduce((sum, item) => sum + item.submission_count, 0)

  return (
    <div className="oj-page">
      <div className="oj-hero oj-hero-premium">
        <div className="oj-hero-copy">
          <span className="oj-hero-kicker">OJ Command Deck</span>
          <h2>更沉浸、更清晰的训练入口。</h2>
          <p className="oj-hero-desc">
            用更强的首屏聚焦、数据概览和内容分区，把题库、推荐、计划和动态整合成一块真正可用的训练面板。
          </p>
          <div className="hero-actions">
            <button className="primary" onClick={() => navigate('/oj/list')}>
              进入题库
            </button>
            <button className="ghost" onClick={handleRandomProblem}>
              随机一题
            </button>
          </div>
        </div>
        <div className="oj-hero-aside">
          <div className="oj-hero-badge">Live Training</div>
          <div className="oj-hero-note">
            更安静的界面，更专注的训练节奏。
          </div>
        </div>
      </div>

      {loading ? (
        <div className="oj-loading">加载中...</div>
      ) : (
        <>
          <div className="oj-summary-grid">
            <div className="oj-summary-card">
              <span className="oj-summary-label">7 Day Runs</span>
              <strong>{weeklySubmissionTotal}</strong>
              <p>最近一周提交总量</p>
            </div>
            <div className="oj-summary-card">
              <span className="oj-summary-label">Accepted</span>
              <strong>{weeklyAcceptedTotal}</strong>
              <p>最近一周通过情况</p>
            </div>
            <div className="oj-summary-card">
              <span className="oj-summary-label">Plan Queue</span>
              <strong>{pendingPlanCount}</strong>
              <p>当前待完成计划</p>
            </div>
            <div className="oj-summary-card">
              <span className="oj-summary-label">Hot Traffic</span>
              <strong>{hotTrafficTotal}</strong>
              <p>热门题总提交次数</p>
            </div>
          </div>

          <div className="oj-home-content">
            <div className="oj-home-main">
              <div className="oj-home-toolbar">
                <div className="oj-quick-jump">
                  <div className="oj-quick-jump-title">快速跳题</div>
                  <div className="oj-quick-jump-subtitle">输入题号，直接进入详情页或开始训练。</div>
                  <input
                    className="auth-input small"
                    placeholder="例如 1001"
                    value={quickJumpId}
                    onChange={(e) => setQuickJumpId(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleQuickJump()
                      }
                    }}
                  />
                  <div className="oj-quick-jump-buttons">
                    <button className="primary small" onClick={handleQuickJump}>
                      跳转
                    </button>
                    <button className="ghost small" onClick={handleRandomProblem}>
                      随机一题
                    </button>
                  </div>
                </div>

                <div className="oj-weekly-chart">
                  <div className="oj-weekly-chart-title">最近 7 天训练走势</div>
                  <div className="oj-weekly-chart-container">
                    <svg
                      width="100%"
                      height="90"
                      viewBox="0 0 600 90"
                      preserveAspectRatio="xMidYMid meet"
                      onMouseMove={(e) => {
                        if (weeklyStats.length === 0) return

                        const svgRect = e.currentTarget.getBoundingClientRect()
                        const mouseX = e.clientX - svgRect.left
                        const svgX = (mouseX / svgRect.width) * 600

                        const barWidth = 22
                        const spacing = 52
                        const startX = 50
                        let closestIndex = 0
                        let minDistance = Infinity

                        weeklyStats.forEach((_stat, index) => {
                          const barCenterX = startX + index * spacing + barWidth / 2
                          const distance = Math.abs(svgX - barCenterX)
                          if (distance < minDistance) {
                            minDistance = distance
                            closestIndex = index
                          }
                        })

                        const stat = weeklyStats[closestIndex]
                        const date = new Date(stat.date)
                        const dateLabel = `${date.getMonth() + 1}/${date.getDate()}`

                        setChartTooltip({
                          visible: true,
                          x: e.clientX,
                          y: e.clientY - 10,
                          date: dateLabel,
                          submissions: stat.submissions,
                          accepted: stat.accepted
                        })
                      }}
                      onMouseLeave={() => setChartTooltip(null)}
                    >
                      <line x1="50" y1="10" x2="50" y2="57" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
                      <line x1="50" y1="57" x2="570" y2="57" stroke="rgba(255,255,255,0.15)" strokeWidth="2" />
                      <line x1="50" y1="10" x2="570" y2="10" stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="3,3" />
                      <line x1="50" y1="22" x2="570" y2="22" stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="3,3" />
                      <line x1="50" y1="34" x2="570" y2="34" stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="3,3" />
                      <line x1="50" y1="46" x2="570" y2="46" stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="3,3" />

                      {weeklyStats.length > 0 ? (
                        <>
                          {(() => {
                            const maxSubmissions = Math.max(...weeklyStats.map((item) => item.submissions), 1)
                            const maxAccepted = Math.max(...weeklyStats.map((item) => item.accepted), 1)
                            const maxValue = Math.max(maxSubmissions, maxAccepted, 3)
                            const barWidth = 22
                            const spacing = 52

                            const linePoints = weeklyStats.map((stat, index) => {
                              const x = 61 + index * spacing
                              const y = 57 - (stat.accepted / maxValue) * 45
                              return { x, y, index }
                            })

                            const linePath = linePoints
                              .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
                              .join(' ')

                            return (
                              <>
                                {weeklyStats.map((stat, index) => {
                                  const height = (stat.submissions / maxValue) * 45
                                  const x = 50 + index * spacing
                                  const y = 57 - height

                                  return (
                                    <g key={`bar-${index}`}>
                                      <rect
                                        x={x}
                                        y={y}
                                        width={barWidth}
                                        height={Math.max(height, 2)}
                                        fill="rgba(79, 195, 247, 0.85)"
                                        rx="3"
                                        style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
                                        className="chart-bar"
                                      />
                                    </g>
                                  )
                                })}

                                {linePoints.length > 1 && (
                                  <path
                                    d={linePath}
                                    fill="none"
                                    stroke="rgba(125, 211, 252, 1)"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                )}

                                {linePoints.map(({ x, y, index }) => (
                                  <g key={`point-${index}`}>
                                    <circle
                                      cx={x}
                                      cy={y}
                                      r="3.5"
                                      fill="rgba(125, 211, 252, 1)"
                                      stroke="rgba(255, 255, 255, 1)"
                                      strokeWidth="1.5"
                                      className="chart-point"
                                    />
                                    <circle
                                      cx={x}
                                      cy={y}
                                      r="10"
                                      fill="transparent"
                                      style={{ cursor: 'pointer' }}
                                    />
                                  </g>
                                ))}

                                {weeklyStats.map((stat, index) => {
                                  const x = 61 + index * spacing
                                  const date = new Date(stat.date)
                                  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
                                  const weekday = weekdays[date.getDay()]
                                  const label = `${date.getMonth() + 1}/${date.getDate()}`

                                  return (
                                    <g key={`label-${index}`}>
                                      <text
                                        x={x}
                                        y="66"
                                        fill="rgba(255, 255, 255, 0.6)"
                                        fontSize="9"
                                        fontWeight="500"
                                        textAnchor="middle"
                                      >
                                        {label}
                                      </text>
                                      <text
                                        x={x}
                                        y="73"
                                        fill="rgba(255, 255, 255, 0.4)"
                                        fontSize="7"
                                        textAnchor="middle"
                                      >
                                        {weekday}
                                      </text>
                                    </g>
                                  )
                                })}

                                <text x="42" y="12" fill="rgba(255, 255, 255, 0.4)" fontSize="8" textAnchor="end">{maxValue}</text>
                                <text x="42" y="35" fill="rgba(255, 255, 255, 0.4)" fontSize="8" textAnchor="end">{Math.ceil(maxValue / 2)}</text>
                                <text x="42" y="59" fill="rgba(255, 255, 255, 0.4)" fontSize="8" textAnchor="end">0</text>
                              </>
                            )
                          })()}
                        </>
                      ) : (
                        <text x="300" y="40" fill="rgba(255, 255, 255, 0.3)" fontSize="11" textAnchor="middle">
                          {currentUser ? '暂无数据' : '登录后查看'}
                        </text>
                      )}

                      <g transform="translate(220, 81)">
                        <rect x="0" y="-3" width="10" height="7" fill="rgba(79, 195, 247, 0.85)" rx="1.5" />
                        <text x="13" y="2" fill="rgba(255, 255, 255, 0.7)" fontSize="9">提交</text>

                        <line x1="52" y1="0.5" x2="66" y2="0.5" stroke="rgba(125, 211, 252, 1)" strokeWidth="2" strokeLinecap="round" />
                        <circle cx="59" cy="0.5" r="3" fill="rgba(125, 211, 252, 1)" stroke="rgba(255, 255, 255, 1)" strokeWidth="1.5" />
                        <text x="70" y="2" fill="rgba(255, 255, 255, 0.7)" fontSize="9">通过</text>
                      </g>
                    </svg>
                  </div>

                  {chartTooltip && (
                    <div
                      className="chart-tooltip"
                      style={{
                        left: `${chartTooltip.x}px`,
                        top: `${chartTooltip.y}px`,
                        position: 'fixed'
                      }}
                    >
                      <div className="chart-tooltip-date">{chartTooltip.date}</div>
                      <div className="chart-tooltip-item">
                        <span className="chart-tooltip-dot submissions"></span>
                        <span className="chart-tooltip-label">提交</span>
                        <span className="chart-tooltip-value">{chartTooltip.submissions}</span>
                      </div>
                      <div className="chart-tooltip-item">
                        <span className="chart-tooltip-dot accepted"></span>
                        <span className="chart-tooltip-label">通过</span>
                        <span className="chart-tooltip-value">{chartTooltip.accepted}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <section className="oj-home-section oj-home-section-premium">
                <div className="oj-home-section-header">
                  <h3>为你推荐</h3>
                  <button className="ghost small" onClick={loadRecommendations}>
                    换一批
                  </button>
                </div>
                {recommendations.length > 0 ? (
                  <>
                    <div className="oj-recommendations">
                      {recommendations.map((problem) => (
                        <div
                          key={problem.id}
                          className="oj-recommendation-card"
                          onClick={() => navigate(`/oj/p${problem.id}`)}
                        >
                          <div className="oj-recommendation-header">
                            <span className="oj-code-label">P{problem.id}</span>
                            <span className={`oj-badge ${problem.difficulty}`}>
                              {problem.difficulty}
                            </span>
                          </div>
                          <div className="oj-recommendation-title">{problem.title}</div>
                          <div className="oj-recommendation-tags">
                            {problem.tags.slice(0, 3).map((tag) => (
                              <span key={tag} className="oj-tag-small">
                                {tag}
                              </span>
                            ))}
                          </div>
                          <div className="oj-recommendation-footer">
                            <span className="oj-pass-rate">通过率 {(problem as { passRate?: number }).passRate || 0}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="oj-recommendation-hint">
                      基于近期做题标签和常见训练路径生成。
                    </div>
                  </>
                ) : (
                  <div className="oj-empty-state">暂无推荐，先去做几道题吧。</div>
                )}
              </section>

              <section className="oj-home-section oj-home-section-premium">
                <h3>实时动态</h3>
                {recentAC.length > 0 ? (
                  <div className="oj-recent-ac-list">
                    {recentAC.map((ac, index) => (
                      <div key={index} className="oj-recent-ac-item">
                        <div className="oj-recent-ac-avatar">
                          {ac.avatar ? (
                            <img src={ac.avatar} alt={ac.user_name} loading="lazy" />
                          ) : (
                            <div className="oj-recent-ac-avatar-placeholder">
                              {ac.user_name.charAt(0).toUpperCase()}
                            </div>
                          )}
                        </div>
                        <div className="oj-recent-ac-content">
                          <span className="oj-recent-ac-user">{ac.user_name}</span>
                          <span className="oj-recent-ac-text">通过了</span>
                          <span
                            className="oj-recent-ac-problem"
                            onClick={() => navigate(`/oj/p${ac.problem_id}`)}
                          >
                            {ac.problem_title}
                          </span>
                        </div>
                        <div className="oj-recent-ac-time">
                          {formatTimeAgo(ac.created_at)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="oj-empty-state">暂无动态</div>
                )}
              </section>
            </div>

            <div className="oj-home-sidebar">
              <section className="oj-home-section oj-home-section-premium">
                <h3>做题计划 ({pendingPlanCount})</h3>
                {problemPlan.length === 0 ? (
                  <div className="problem-plan-empty">暂无计划，去题库添加几道题开始吧。</div>
                ) : (
                  <div className="problem-plan-list">
                    {problemPlan.map((plan) => (
                      <div key={plan.id} className={`problem-plan-item ${plan.completed ? 'completed' : ''}`}>
                        <div className="problem-plan-item-header">
                          <input
                            type="checkbox"
                            checked={!!plan.completed}
                            onChange={(e) => togglePlanComplete(plan.id, e.target.checked)}
                          />
                          <span
                            className="problem-plan-item-title"
                            onClick={() => navigate(`/oj/p${plan.problem_id}`)}
                            style={{ cursor: 'pointer' }}
                          >
                            {plan.title}
                          </span>
                        </div>
                        <div className="problem-plan-item-meta">
                          <span className={`difficulty-tag ${plan.difficulty}`}>{plan.difficulty}</span>
                          <button
                            className="problem-plan-remove"
                            onClick={() => removeFromPlan(plan.id)}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="oj-home-section oj-home-section-premium">
                <h3>热门题目</h3>
                {hotProblems.length > 0 ? (
                  <div className="oj-hot-problems">
                    {hotProblems.map((problem, index) => (
                      <div
                        key={problem.id}
                        className="oj-hot-problem-item"
                        onClick={() => navigate(`/oj/p${problem.id}`)}
                      >
                        <div className="oj-hot-problem-rank">{index + 1}</div>
                        <div className="oj-hot-problem-content">
                          <div className="oj-hot-problem-title">{problem.title}</div>
                          <div className="oj-hot-problem-meta">
                            <span className={`oj-badge ${problem.difficulty}`}>
                              {problem.difficulty}
                            </span>
                            <span className="oj-hot-problem-count">
                              {problem.submission_count} 次提交
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="oj-empty-state">暂无数据</div>
                )}
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
