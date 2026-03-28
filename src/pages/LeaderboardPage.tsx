import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LeaderboardEntry, LeaderboardResponse } from '../types'
import { fetchJson } from '../utils'

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

  const getRankMedal = (rank: number) => {
    if (rank === 1) return '🥇'
    if (rank === 2) return '🥈'
    if (rank === 3) return '🥉'
    return rank
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

  return (
    <section className="section">
      <div className="section-header">
        <h2>排行榜</h2>
      </div>

      <div className="leaderboard-filters">
        <button
          className={`filter-tab ${leaderboardType === 'total' ? 'active' : ''}`}
          onClick={() => {
            setLeaderboardType('total')
            setLeaderboardPage(1)
            setLeaderboardPageInput('1')
          }}
        >
          <span className="filter-icon">🏆</span>
          <span>总榜</span>
        </button>
        <button
          className={`filter-tab ${leaderboardType === 'weekly' ? 'active' : ''}`}
          onClick={() => {
            setLeaderboardType('weekly')
            setLeaderboardPage(1)
            setLeaderboardPageInput('1')
          }}
        >
          <span className="filter-icon">📅</span>
          <span>周榜</span>
        </button>
        <button
          className={`filter-tab ${leaderboardType === 'monthly' ? 'active' : ''}`}
          onClick={() => {
            setLeaderboardType('monthly')
            setLeaderboardPage(1)
            setLeaderboardPageInput('1')
          }}
        >
          <span className="filter-icon">🗓</span>
          <span>月榜</span>
        </button>
      </div>

      {periodLabel && <div className="leaderboard-period">{periodLabel}</div>}

      {loading ? (
        <div>{Array.from({ length: 10 }, (_, index) => <div key={index} className="skeleton skeleton-row" />)}</div>
      ) : leaderboard.length === 0 ? (
        <div className="leaderboard-empty">
          <div className="leaderboard-empty-icon">{leaderboardType === 'total' ? '🏆' : leaderboardType === 'weekly' ? '📅' : '🗓'}</div>
          <p>{getEmptyMessage()}</p>
        </div>
      ) : (
        <>
          <div className="leaderboard-meta">
            共有 {leaderboardTotal} 位用户参与{leaderboardType === 'weekly' ? '本周' : leaderboardType === 'monthly' ? '本月' : ''}排行
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th style={{ width: '80px' }}>排名</th>
                  <th>用户</th>
                  {leaderboardType === 'total' ? (
                    <>
                      <th style={{ textAlign: 'right' }}>等级分</th>
                      <th style={{ textAlign: 'right' }}>解题数</th>
                    </>
                  ) : (
                    <th style={{ textAlign: 'right' }}>通过题目</th>
                  )}
                  <th style={{ textAlign: 'center', width: '100px' }}>变化</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((user) => (
                  <tr
                    key={user.userId}
                    className={`leaderboard-row ${currentUserRank?.userId === user.userId ? 'current-user' : ''} ${user.rank <= 3 ? `top-${user.rank}` : ''}`}
                  >
                    <td>
                      <span className="rank-medal">{getRankMedal(user.rank)}</span>
                    </td>
                    <td>
                      <div
                        className="leaderboard-user-cell"
                        style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}
                        onClick={() => navigate(`/account?user=${user.userId}`)}
                      >
                        <div
                          style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            background: user.avatar ? 'transparent' : 'rgba(79, 195, 247, 0.25)',
                            display: 'grid',
                            placeItems: 'center',
                            fontSize: '14px',
                            fontWeight: 600,
                            color: '#d8f2ff',
                            overflow: 'hidden',
                            flexShrink: 0
                          }}
                        >
                          {user.avatar ? (
                            <img src={user.avatar} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            user.userName.charAt(0).toUpperCase()
                          )}
                        </div>
                        <div>
                          <div className="leaderboard-user-name" data-user-name style={{ fontWeight: 500 }}>{user.userName}</div>
                          <div className="leaderboard-user-id" data-user-id style={{ fontSize: '12px', color: 'var(--muted)' }}>@{user.userId}</div>
                        </div>
                      </div>
                    </td>
                    {leaderboardType === 'total' ? (
                      <>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: '#4fc3f7' }}>
                          {user.value?.toFixed(1)}
                        </td>
                        <td style={{ textAlign: 'right', color: 'var(--muted)' }}>
                          {(user as LeaderboardEntry & { solvedCount?: number }).solvedCount ?? '-'}
                        </td>
                      </>
                    ) : (
                      <td style={{ textAlign: 'right', fontWeight: 600, color: '#4fc3f7' }}>
                        {user.value}
                      </td>
                    )}
                    <td style={{ textAlign: 'center' }}>
                      {getRankChange(user.rankChange)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!loading && leaderboardTotalPages > 1 && (
        <div className="pagination">
          <button className="pagination-btn" onClick={() => handleLeaderboardPageChange(leaderboardPage - 1)} disabled={leaderboardPage === 1}>
            上一页
          </button>

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

          <button className="pagination-btn" onClick={() => handleLeaderboardPageChange(leaderboardPage + 1)} disabled={leaderboardPage === leaderboardTotalPages}>
            下一页
          </button>

          <div className="pagination-jump">
            <span>跳转到</span>
            <input
              type="text"
              className="pagination-input"
              value={leaderboardPageInput}
              onChange={(event) => setLeaderboardPageInput(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && handleLeaderboardPageInputSubmit()}
            />
            <button className="pagination-go" onClick={handleLeaderboardPageInputSubmit}>前往</button>
          </div>
        </div>
      )}
    </section>
  )
}
