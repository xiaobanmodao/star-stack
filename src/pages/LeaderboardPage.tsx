import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Button, EmptyState, PageHeader, Panel } from '../components/ui'
import type { LeaderboardEntry, LeaderboardResponse } from '../types'
import { fetchJson } from '../utils'
import './OpsPages.css'

const leaderboardTabs: { value: 'total' | 'weekly' | 'monthly'; label: string; hint: string }[] = [
  { value: 'total', label: '总榜', hint: '长期实力' },
  { value: 'weekly', label: '周榜', hint: '本周冲刺' },
  { value: 'monthly', label: '月榜', hint: '月度节奏' },
]

export default function LeaderboardPage() {
  const navigate = useNavigate()
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [currentUserRank, setCurrentUserRank] = useState<LeaderboardEntry | null>(null)
  const [loading, setLoading] = useState(true)
  const [leaderboardPage, setLeaderboardPage] = useState(1)
  const [leaderboardPageInput, setLeaderboardPageInput] = useState('1')
  const [leaderboardType, setLeaderboardType] = useState<'total' | 'weekly' | 'monthly'>('total')
  const [leaderboardTotalPages, setLeaderboardTotalPages] = useState(1)
  const [leaderboardTotal, setLeaderboardTotal] = useState(0)
  const [periodStart, setPeriodStart] = useState<string | null>(null)
  const [periodEnd, setPeriodEnd] = useState<string | null>(null)
  const leaderboardPerPage = 20

  const loadLeaderboard = useCallback(async () => {
    setLoading(true)
    try {
      const { response, data } = await fetchJson<{
        leaderboard: LeaderboardResponse
        currentUser?: LeaderboardEntry | null
        type: string
        totalPages?: number
        total?: number
        periodStart?: string
        periodEnd?: string
      }>(`/api/leaderboard?page=${leaderboardPage}&perPage=${leaderboardPerPage}&type=${leaderboardType}`)
      if (response.ok && data) {
        setLeaderboard(data.leaderboard || [])
        setCurrentUserRank(data.currentUser ?? null)
        setLeaderboardTotalPages(data.totalPages || 1)
        setLeaderboardTotal(data.total || 0)
        setPeriodStart(data.periodStart || null)
        setPeriodEnd(data.periodEnd || null)
      }
    } catch (error) {
      console.error('Failed to load leaderboard:', error)
    } finally {
      setLoading(false)
    }
  }, [leaderboardPage, leaderboardType])

  useEffect(() => {
    void loadLeaderboard()
  }, [loadLeaderboard])

  const getRankLabel = (rank: number) => {
    if (rank <= 3) return `TOP ${rank}`
    return `#${rank}`
  }

  const getRankChange = (rankChange: number | null) => {
    if (rankChange === null) return <span className="rank-change new">NEW</span>
    if (rankChange === 0) return <span className="rank-change stable">-</span>
    if (rankChange > 0) return <span className="rank-change down">↓{Math.abs(rankChange)}</span>
    return <span className="rank-change up">↑{Math.abs(rankChange)}</span>
  }

  const formatPeriodLabel = () => {
    if (leaderboardType === 'total') return null
    if (!periodStart || !periodEnd) return null
    const start = new Date(periodStart)
    const end = new Date(periodEnd)
    end.setDate(end.getDate() - 1)

    if (leaderboardType === 'weekly') {
      const format = (date: Date) => `${date.getMonth() + 1}.${date.getDate()}`
      return `${format(start)} - ${format(end)}`
    }

    if (leaderboardType === 'monthly') {
      return `${start.getFullYear()} 年 ${start.getMonth() + 1} 月`
    }

    return null
  }

  const getEmptyMessage = () => {
    if (leaderboardType === 'weekly') return '本周还没有人完成题目，快来拿下第一名。'
    if (leaderboardType === 'monthly') return '本月还没有人进入榜单，去刷新你的排名吧。'
    return '当前还没有可展示的数据。'
  }

  const handleLeaderboardPageChange = (page: number) => {
    if (page >= 1 && page <= leaderboardTotalPages) {
      setLeaderboardPage(page)
      setLeaderboardPageInput(String(page))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const handleLeaderboardPageInputSubmit = () => {
    const page = parseInt(leaderboardPageInput, 10)
    if (!Number.isNaN(page) && page >= 1 && page <= leaderboardTotalPages) {
      setLeaderboardPage(page)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      setLeaderboardPageInput(String(leaderboardPage))
    }
  }

  const renderLeaderboardPageNumbers = () => {
    const pages: (number | string)[] = []
    if (leaderboardTotalPages <= 7) {
      for (let i = 1; i <= leaderboardTotalPages; i += 1) {
        pages.push(i)
      }
    } else {
      pages.push(1)
      if (leaderboardPage <= 3) {
        pages.push(2, 3, 4, 5, '...', leaderboardTotalPages)
      } else if (leaderboardPage >= leaderboardTotalPages - 2) {
        pages.push('...', leaderboardTotalPages - 4, leaderboardTotalPages - 3, leaderboardTotalPages - 2, leaderboardTotalPages - 1, leaderboardTotalPages)
      } else {
        pages.push('...', leaderboardPage - 1, leaderboardPage, leaderboardPage + 1, '...', leaderboardTotalPages)
      }
    }
    return pages
  }

  const periodLabel = formatPeriodLabel()
  const topUser = leaderboard[0]
  const currentRankLabel = currentUserRank ? `#${currentUserRank.rank}` : '--'
  const typeLabel = leaderboardTabs.find((tab) => tab.value === leaderboardType)?.label ?? '总榜'

  return (
    <section className="ops-page-v2 leaderboard-v2">
      <PageHeader
        kicker="Rank Observatory"
        title="排行榜"
        description="把长期实力、周榜冲刺和月度节奏放在同一个观测台里，用户能更快看到自己和头部选手的距离。"
      />

      <div className="leaderboard-hero-grid">
        <Panel className="leaderboard-focus-card">
          <Badge tone="info">{typeLabel}</Badge>
          <h2>{topUser ? topUser.userName : '等待第一位上榜者'}</h2>
          <p>
            {topUser
              ? `${topUser.userName} 当前位于 ${typeLabel} 第一，继续追赶可以把刷题节奏拉起来。`
              : getEmptyMessage()}
          </p>
          <div className="leaderboard-focus-stats">
            <div>
              <strong>{leaderboardTotal}</strong>
              <span>参与排行</span>
            </div>
            <div>
              <strong>{currentRankLabel}</strong>
              <span>我的排名</span>
            </div>
            <div>
              <strong>{periodLabel || '全周期'}</strong>
              <span>统计区间</span>
            </div>
          </div>
        </Panel>

        <Panel className="leaderboard-switch-card">
          <span className="ops-section-label">榜单切换</span>
          <div className="leaderboard-tabs-v2">
            {leaderboardTabs.map((tab) => (
              <button
                key={tab.value}
                type="button"
                className={leaderboardType === tab.value ? 'active' : ''}
                onClick={() => {
                  setLeaderboardType(tab.value)
                  setLeaderboardPage(1)
                  setLeaderboardPageInput('1')
                }}
              >
                <strong>{tab.label}</strong>
                <span>{tab.hint}</span>
              </button>
            ))}
          </div>
        </Panel>
      </div>

      <Panel className="leaderboard-list-panel">
        <div className="ops-panel-head">
          <div>
            <Badge tone="info">Leaderboard</Badge>
            <h2>{typeLabel}</h2>
          </div>
          <span>
            {periodLabel ? `${periodLabel} · ` : ''}
            共 {leaderboardTotal} 位用户
          </span>
        </div>

        {loading ? (
          <div className="ops-skeleton-list">
            {Array.from({ length: 8 }, (_, index) => <div key={index} className="skeleton skeleton-row" />)}
          </div>
        ) : leaderboard.length === 0 ? (
          <EmptyState title="暂无排行数据" description={getEmptyMessage()} />
        ) : (
          <div className="leaderboard-list-v2">
            <div className="leaderboard-row-v2 head">
              <span>排名</span>
              <span>用户</span>
              <span>{leaderboardType === 'total' ? '等级分' : '通过题目'}</span>
              <span>{leaderboardType === 'total' ? '解题数' : '周期'}</span>
              <span>变化</span>
            </div>
            {leaderboard.map((user) => (
              <button
                key={user.userId}
                type="button"
                className={`leaderboard-row-v2 ${currentUserRank?.userId === user.userId ? 'current-user' : ''} ${user.rank <= 3 ? `top-${user.rank}` : ''}`}
                onClick={() => navigate(`/user/${user.userId}`)}
              >
                <span className="rank-token">{getRankLabel(user.rank)}</span>
                <span className="leaderboard-user-cell">
                  <span className="leaderboard-avatar">
                    {user.avatar ? (
                      <img src={user.avatar} alt="" loading="lazy" />
                    ) : (
                      user.userName.charAt(0).toUpperCase()
                    )}
                  </span>
                  <span>
                    <strong className="leaderboard-user-name" data-user-name>{user.userName}</strong>
                    <em className="leaderboard-user-id" data-user-id>@{user.userId}</em>
                  </span>
                </span>
                <span className="leaderboard-value">
                  {leaderboardType === 'total' ? user.value?.toFixed(1) : user.value}
                </span>
                <span className="leaderboard-muted-value">
                  {leaderboardType === 'total' ? (user.solvedCount ?? '-') : (periodLabel || typeLabel)}
                </span>
                <span>{getRankChange(user.rankChange)}</span>
              </button>
            ))}
          </div>
        )}
      </Panel>

      {!loading && leaderboardTotalPages > 1 && (
        <div className="pagination">
          <Button variant="secondary" size="sm" onClick={() => handleLeaderboardPageChange(leaderboardPage - 1)} disabled={leaderboardPage === 1}>
            上一页
          </Button>

          <div className="pagination-numbers">
            {renderLeaderboardPageNumbers().map((page, index) => (
              page === '...' ? (
                <span key={`ellipsis-${index}`} className="pagination-ellipsis">...</span>
              ) : (
                <button
                  key={page}
                  className={`pagination-number ${leaderboardPage === page ? 'active' : ''}`}
                  onClick={() => handleLeaderboardPageChange(page as number)}
                >
                  {page}
                </button>
              )
            ))}
          </div>

          <Button variant="secondary" size="sm" onClick={() => handleLeaderboardPageChange(leaderboardPage + 1)} disabled={leaderboardPage === leaderboardTotalPages}>
            下一页
          </Button>

          <div className="pagination-jump">
            <span>跳转到</span>
            <input
              type="text"
              className="pagination-input"
              value={leaderboardPageInput}
              onChange={(event) => setLeaderboardPageInput(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && handleLeaderboardPageInputSubmit()}
            />
            <Button variant="ghost" size="sm" onClick={handleLeaderboardPageInputSubmit}>前往</Button>
          </div>
        </div>
      )}
    </section>
  )
}
