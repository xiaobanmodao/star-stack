import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarCheck, Flame, Pencil, Trophy } from 'lucide-react'
import { useAppContext } from '../context/AppContext'
import { useToast } from '../components/ui/ToastContext'
import type {
  Achievement,
  CheckinResponse,
  DifficultyStats,
  HeatmapData,
  HeatmapResponse,
  ProfileStats,
  ProfileStatsResponse,
  UserAchievementsResponse,
} from '../types'
import { fetchJson } from '../utils'
import { OJ_ENABLED } from '../constants'
import type { FollowRelations, UserProfileResponse } from '../types'
import { Badge, Button, EmptyState, ErrorState, PageHeader, Panel } from '../components/ui'
import HonorGrid from '../components/profile/HonorGrid'
import DecoratedAvatar from '../components/profile/DecoratedAvatar'
import './AccountPage.css'
import './UserProfile.css'

const getDifficultySolved = (value: DifficultyStats) => value.solved ?? 0
const getDifficultyTried = (value: DifficultyStats) => value.tried ?? value.solved ?? 0

const getHeatmapLevel = (count: number) => {
  if (count === 0) return 0
  if (count <= 2) return 1
  if (count <= 5) return 2
  if (count <= 10) return 3
  return 4
}

const getRecentActiveDays = (heatmap: HeatmapData[]) =>
  heatmap.slice(-30).filter((day) => day.count > 0).length

const getRatingDelta = (history: { date: string; rating: number }[]) => {
  if (history.length < 2) return 0
  return history[history.length - 1].rating - history[0].rating
}

export default function AccountPage() {
  const navigate = useNavigate()
  const { currentUser, openAuth } = useAppContext()
  const { showToast } = useToast()
  const [profileStats, setProfileStats] = useState<ProfileStats | null>(null)
  const [heatmapData, setHeatmapData] = useState<HeatmapData[]>([])
  const [heatmapTip, setHeatmapTip] = useState<{
    text: string
    x: number
    y: number
  } | null>(null)
  const [achievements, setAchievements] = useState<Achievement[]>([])
  const [achievementTotal, setAchievementTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState('')
  const [profileReloadKey, setProfileReloadKey] = useState(0)
  const [ratingHistory, setRatingHistory] = useState<{ date: string; rating: number }[]>([])
  const [relations, setRelations] = useState<FollowRelations | null>(null)
  const [bookmarks, setBookmarks] = useState<{ id: number; title: string; userName: string; commentCount: number; createdAt: string }[]>([])
  const [problemBookmarks, setProblemBookmarks] = useState<{ id: number; title: string; difficulty?: string; createdAt: string }[]>([])
  const [checkin, setCheckin] = useState<CheckinResponse | null>(null)
  const [checkingIn, setCheckingIn] = useState(false)
  const [checkinError, setCheckinError] = useState('')
  const loadedUserIdRef = useRef<string | null>(null)
  const initial = currentUser?.name?.trim()?.[0] || currentUser?.id?.[0] || '★'

  const retryProfile = () => {
    loadedUserIdRef.current = null
    setProfileError('')
    setProfileReloadKey((value) => value + 1)
  }

  const showHeatmapTip = (event: { currentTarget: HTMLElement }, text: string) => {
    const panel = event.currentTarget.closest('.profile-activity-panel') as HTMLElement | null
    if (!panel) return
    const panelRect = panel.getBoundingClientRect()
    const rect = event.currentTarget.getBoundingClientRect()
    setHeatmapTip({
      text,
      x: rect.left - panelRect.left + rect.width / 2,
      y: rect.top - panelRect.top - 6,
    })
  }

  const clearHeatmapTip = () => setHeatmapTip(null)

  useEffect(() => {
    if (!heatmapTip) return undefined
    const closeTip = () => setHeatmapTip(null)
    window.addEventListener('scroll', closeTip, true)
    window.addEventListener('resize', closeTip)
    return () => {
      window.removeEventListener('scroll', closeTip, true)
      window.removeEventListener('resize', closeTip)
    }
  }, [heatmapTip])

  const handleCheckin = async () => {
    if (!currentUser || checkingIn || checkin?.checkedToday) return
    setCheckingIn(true)
    setCheckinError('')
    try {
      const { response, data } = await fetchJson<CheckinResponse>('/api/me/checkin', {
        method: 'POST',
      })
      if (!response.ok || !data) {
        const message = data?.message || '签到失败，请重试。'
        setCheckinError(message)
        showToast(message, 'error')
        return
      }
      setCheckin(data)
      showToast(data.message || '今日签到成功', 'success')
    } catch {
      setCheckinError('网络异常，签到未完成。')
      showToast('网络异常，签到未完成', 'error')
    } finally {
      setCheckingIn(false)
    }
  }

  useEffect(() => {
    if (!currentUser?.id) return
    if (!OJ_ENABLED) {
      setLoading(false)
      setProfileError('')
      return
    }
    if (loadedUserIdRef.current === currentUser.id) return

    let mounted = true

    const loadProfileData = async () => {
      setLoading(true)
      setProfileError('')
      try {
        const [statsRes, heatmapRes, achievementsRes, ratingRes] = await Promise.all([
          fetchJson<ProfileStatsResponse>(`/api/user/profile/${currentUser.id}`),
          fetchJson<{ heatmap: HeatmapResponse }>(`/api/user/heatmap/${currentUser.id}`),
          fetchJson<UserAchievementsResponse>(`/api/user/achievements/${currentUser.id}`),
          fetchJson<{ history: { date: string; rating: number }[] }>(`/api/user/rating-history/${currentUser.id}`),
        ])

        if (!mounted) return

        const failed = [statsRes, heatmapRes, achievementsRes, ratingRes].some((item) => !item.response.ok)

        if (statsRes.response.ok && statsRes.data) setProfileStats(statsRes.data)
        if (heatmapRes.response.ok && heatmapRes.data) setHeatmapData(heatmapRes.data.heatmap || [])
        if (achievementsRes.response.ok && achievementsRes.data) {
          setAchievements(achievementsRes.data.achievements || [])
          setAchievementTotal(achievementsRes.data.total || achievementsRes.data.achievements?.length || 0)
        }
        if (ratingRes.response.ok && ratingRes.data) setRatingHistory(ratingRes.data.history || [])

        if (failed) {
          setProfileError('部分成长数据加载失败，其他内容仍可正常使用。')
        } else {
          loadedUserIdRef.current = currentUser.id
        }
      } catch (error) {
        console.error('Failed to load profile data:', error)
        setProfileError('网络异常，暂时无法加载成长数据。')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    void loadProfileData()

    return () => {
      mounted = false
    }
  }, [currentUser, profileReloadKey])

  // 加载自己的关注/粉丝数据（与做题功能无关，始终显示）
  useEffect(() => {
    if (!currentUser?.id) return
    const timer = window.setTimeout(() => {
      void fetchJson<UserProfileResponse>(`/api/users/${currentUser.id}/profile`).then(({ response, data }) => {
        if (response.ok && data) setRelations(data.relations)
      }).catch(() => {
        setProfileError('关注关系加载失败，其他内容仍可正常使用。')
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [currentUser])

  useEffect(() => {
    if (!currentUser?.id) return
    const timer = window.setTimeout(() => {
      void fetchJson<{ problems: { id: number; title: string; difficulty?: string; createdAt: string }[] }>('/api/bookmarks?targetType=problem')
        .then(({ response, data }) => {
          if (response.ok && data) setProblemBookmarks(data.problems || [])
        })
        .catch(() => {
          setProfileError('题目收藏加载失败，其他内容仍可正常使用。')
        })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [currentUser])

  // 加载我的收藏
  useEffect(() => {
    if (!currentUser?.id) return
    const timer = window.setTimeout(() => {
      void fetchJson<{ posts: { id: number; title: string; userName: string; commentCount: number; createdAt: string }[] }>(
        '/api/bookmarks?targetType=post'
      ).then(({ response, data }) => {
        if (response.ok && data) setBookmarks(data.posts || [])
      }).catch(() => {
        setProfileError('帖子收藏加载失败，其他内容仍可正常使用。')
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [currentUser])

  // 加载每日签到状态（独立于做题数据，始终显示）
  useEffect(() => {
    if (!currentUser?.id) return
    let mounted = true
    void fetchJson<CheckinResponse>('/api/me/checkin').then(({ response, data }) => {
      if (mounted && response.ok && data) setCheckin(data)
      else if (mounted) setCheckinError(data?.message || '签到状态加载失败，请重试。')
    }).catch(() => {
      if (mounted) setCheckinError('网络异常，签到状态暂时无法加载，请重试。')
    })
    return () => {
      mounted = false
    }
  }, [currentUser])

  if (!currentUser) {
    return (
      <section className="section profile-v2 profile-guest">
        <PageHeader
          kicker="Star Profile"
          title="个人中心"
          description={OJ_ENABLED ? '登录后可以查看做题数据、成长轨迹和个人成就。' : '登录后可以查看个人资料、头像与账号设置。'}
          actions={<Button variant="primary" onClick={() => openAuth('login')}>去登录</Button>}
        />
        <EmptyState
          title="还没有连接到你的星栈账号"
          description={OJ_ENABLED ? '登录后，这里会展示你的刷题航线、连续天数、成就和 Rating 变化。' : '登录后，这里会展示你的个人资料与账号设置。'}
        />
      </section>
    )
  }

  if (loading) {
    return (
      <div className="profile-container profile-v2">
        <div className="profile-left">
          <Panel className="profile-card">
            <div className="skeleton skeleton-avatar" style={{ width: 80, height: 80, margin: '0 auto 12px' }} />
            <div className="skeleton skeleton-title" style={{ margin: '0 auto 8px' }} />
            <div className="skeleton skeleton-line" style={{ width: '40%', margin: '0 auto' }} />
          </Panel>
        </div>
        {OJ_ENABLED && (
          <div className="profile-right">
            <div className="stats-grid">
              {[1, 2, 3, 4, 5, 6].map((item) => (
                <Panel key={item} className="stat-card">
                  <div className="skeleton skeleton-line" style={{ width: '50%', height: 20 }} />
                  <div className="skeleton skeleton-line" style={{ width: '70%', height: 14 }} />
                </Panel>
              ))}
            </div>
            <Panel className="heatmap-container" style={{ minHeight: '200px' }}>
              <div className="heatmap-title">做题热力图</div>
              <div className="skeleton" style={{ height: 120, marginTop: 12 }} />
            </Panel>
          </div>
        )}
      </div>
    )
  }

  const stats = profileStats?.stats || {}
  const difficultyStats = profileStats?.difficultyStats || {}
  const solvedProblems = stats.solvedProblems ?? stats.totalSolved ?? 0
  const acceptedCount = stats.acceptedCount ?? 0
  const totalSubmissions = stats.totalSubmissions ?? 0
  const acceptanceRate = stats.acceptanceRate ?? 0
  const recentActiveDays = getRecentActiveDays(heatmapData)
  const ratingDelta = getRatingDelta(ratingHistory)
  const difficultyEntries = Object.entries(difficultyStats)
  const maxDifficultySolved = Math.max(...difficultyEntries.map(([, item]) => getDifficultySolved(item)), 1)

  return (
    <div className="profile-container profile-v2">
      <aside className="profile-left">
        <Panel className="profile-card profile-identity-card">
          <div className="profile-avatar-shell">
            <DecoratedAvatar
              className="profile-avatar-large"
              avatar={currentUser.avatar}
              fallback={initial}
              frame={currentUser.avatarFrame}
              overlay={currentUser.avatarOverlay}
              size="profile"
              alt="头像"
            />
          </div>
          <div className="profile-user-copy">
            <div className="profile-name-row">
              <button
                className="profile-edit-trigger"
                type="button"
                onClick={() => navigate('/account/edit')}
                aria-label="编辑个人资料"
                title="编辑个人资料"
              >
                <Pencil size={13} strokeWidth={2.2} aria-hidden="true" />
              </button>
              <div className="account-name" data-user-name>{currentUser.name}</div>
            </div>
            <div className="account-id" data-user-id>@{currentUser.id}</div>
            <div className="account-email" data-user-email>{currentUser.email || '邮箱未绑定'}</div>
            {currentUser.level && (
              <Badge tone="info" className="profile-level-badge">
                {currentUser.displayTitleIcon || currentUser.icon || '✦'} Lv.{currentUser.level} {currentUser.displayTitle || currentUser.title || '星尘'}
              </Badge>
            )}
          </div>
          {OJ_ENABLED && stats.rank && stats.rank > 0 && (
            <Badge tone="info" className="profile-rank-badge">全站排名 #{stats.rank}</Badge>
          )}
          {OJ_ENABLED && (
            <div className="profile-identity-metrics">
              <div>
                <span>连续</span>
                <strong>{stats.currentStreak || 0} 天</strong>
              </div>
              <div>
                <span>最长</span>
                <strong>{stats.maxStreak || 0} 天</strong>
              </div>
            </div>
          )}
          <div className="profile-follow-row">
            <button type="button" onClick={() => navigate('/chat/friends')}>
              <strong>{relations?.followingCount ?? '-'}</strong>
              <span>关注</span>
            </button>
            <button type="button" onClick={() => navigate('/chat/friends')}>
              <strong>{relations?.followerCount ?? '-'}</strong>
              <span>粉丝</span>
            </button>
            <button type="button" onClick={() => navigate('/chat/friends')}>
              <strong>{relations?.friendCount ?? '-'}</strong>
              <span>好友</span>
            </button>
          </div>
          {OJ_ENABLED && (
            <Panel className="profile-side-note">
              <div className="profile-side-note-title">本月活动</div>
              <strong>{recentActiveDays}</strong>
              <span>近 30 天有提交记录的天数</span>
            </Panel>
          )}
        </Panel>
      </aside>

      <main className="profile-right">
        {profileError && (
          <ErrorState description={profileError} onRetry={retryProfile} />
        )}
        {OJ_ENABLED ? (
          <>
            <div className="stats-grid profile-stats-grid">
          <Panel className="stat-card">
            <div className="stat-value">{totalSubmissions}</div>
            <div className="stat-label">总提交</div>
          </Panel>
          <Panel className="stat-card">
            <div className="stat-value">{acceptedCount}</div>
            <div className="stat-label">通过次数</div>
          </Panel>
          <Panel className="stat-card">
            <div className="stat-value">{solvedProblems}</div>
            <div className="stat-label">已解决题目</div>
          </Panel>
          <Panel className="stat-card">
            <div className="stat-value">{acceptanceRate.toFixed(1)}%</div>
            <div className="stat-label">通过率</div>
          </Panel>
        </div>

        <Panel className="heatmap-container profile-activity-panel">
          <div className="profile-panel-head">
            <div>
              <div className="profile-kicker">Activity</div>
              <h2>做题热力图</h2>
            </div>
            <span>最近 {heatmapData.length || 0} 天</span>
          </div>
          <div className="heatmap-scroll" onScroll={clearHeatmapTip}>
            <div className="heatmap-grid">
              {heatmapData.map((day, index) => {
                const tip = `${day.date}：提交 ${day.count} 次，AC ${day.accepted ?? 0} 次`
                return (
                  <button
                    key={`${day.date}-${index}`}
                    type="button"
                    className="heatmap-cell"
                    data-level={getHeatmapLevel(day.count)}
                    aria-label={tip}
                    onMouseEnter={(event) => showHeatmapTip(event, tip)}
                    onMouseLeave={clearHeatmapTip}
                    onFocus={(event) => showHeatmapTip(event, tip)}
                    onBlur={clearHeatmapTip}
                  />
                )
              })}
            </div>
          </div>
          {heatmapTip && (
            <div
              className="heatmap-tooltip"
              role="tooltip"
              style={{ left: heatmapTip.x, top: heatmapTip.y }}
            >
              {heatmapTip.text}
            </div>
          )}
        </Panel>

        {difficultyEntries.length > 0 && (
          <Panel className="difficulty-section profile-difficulty-panel">
            <div className="profile-panel-head">
              <div>
                <div className="profile-kicker">Difficulty</div>
                <h2>难度分布</h2>
              </div>
            </div>
            <div className="difficulty-grid profile-difficulty-grid">
              {difficultyEntries.map(([difficulty, count]) => {
                const solved = getDifficultySolved(count)
                const tried = getDifficultyTried(count)
                const ratio = Math.min(100, (solved / Math.max(maxDifficultySolved, 1)) * 100)
                return (
                  <div key={difficulty} className="difficulty-card profile-difficulty-card">
                    <div className="difficulty-header">
                      <span className={`difficulty-tag ${difficulty}`}>{difficulty}</span>
                      <strong>{solved}</strong>
                    </div>
                    <div className="profile-difficulty-track">
                      <span style={{ width: `${ratio}%` }} />
                    </div>
                    <em>尝试 {tried} 题</em>
                  </div>
                )
              })}
            </div>
          </Panel>
        )}

        {OJ_ENABLED && achievementTotal > 0 && (
          <Panel className="achievements-section profile-achievements-panel">
            <div className="profile-panel-head">
              <div>
                <div className="profile-kicker">Honors</div>
                <h2>荣誉墙</h2>
              </div>
              <span>{achievements.length}/{achievementTotal} 个已解锁</span>
            </div>
            <HonorGrid
              achievements={achievements}
              emptyText="完成题目和连续签到后，新的荣誉会显示在这里。"
            />
          </Panel>
        )}

        {ratingHistory.length > 0 && (
          <Panel className="rating-chart profile-rating-panel">
            <div className="profile-panel-head">
              <div>
                <div className="profile-kicker">Rating</div>
                <h2>等级分走势</h2>
              </div>
              <span>{ratingDelta >= 0 ? '+' : ''}{ratingDelta}</span>
            </div>
            <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
              {(() => {
                const values = ratingHistory.map((item) => item.rating)
                const min = Math.min(...values)
                const max = Math.max(...values)
                const range = Math.max(max - min, 1)
                const points = ratingHistory.map((item, index) => {
                  const x = (index / Math.max(ratingHistory.length - 1, 1)) * 100
                  const y = 36 - ((item.rating - min) / range) * 30
                  return `${x},${y}`
                }).join(' ')
                return <polyline fill="none" stroke="currentColor" strokeWidth="1.8" points={points} />
              })()}
            </svg>
          </Panel>
          )}

        </>
        ) : (
          <Panel className="profile-oj-paused">
            <EmptyState
              title="做题数据暂时停用"
              description="相关功能恢复后，这里会重新展示你的成长航线、做题热力图、成就与 Rating。"
            />
          </Panel>
        )}

        <Panel className={`profile-checkin ${!checkin ? 'is-loading' : ''} ${checkingIn ? 'is-submitting' : ''}`}>
          <div className="profile-panel-head">
            <div>
              <div className="profile-kicker">Check-in</div>
              <h2>每日签到</h2>
            </div>
            {checkin?.checkedToday && (
              <span className="profile-checkin-done">今日已签到</span>
            )}
          </div>
          <div className="profile-checkin-body">
            <div className="profile-checkin-metrics">
              <div className="profile-checkin-metric">
                <CalendarCheck size={16} aria-hidden="true" />
                <div>
                  <strong>{checkin ? checkin.currentStreak : <span className="checkin-value-loading" aria-label="加载中" />}</strong>
                  <span>当前连续</span>
                </div>
              </div>
              <div className="profile-checkin-metric">
                <Trophy size={16} aria-hidden="true" />
                <div>
                  <strong>{checkin ? checkin.maxStreak : <span className="checkin-value-loading" aria-label="加载中" />}</strong>
                  <span>最长连续</span>
                </div>
              </div>
              <div className="profile-checkin-metric">
                <Flame size={16} aria-hidden="true" />
                <div>
                  <strong>{checkin ? checkin.totalDays : <span className="checkin-value-loading" aria-label="加载中" />}</strong>
                  <span>累计签到</span>
                </div>
              </div>
            </div>
            <Button
              variant={checkin?.checkedToday ? 'ghost' : 'primary'}
              size="sm"
              onClick={handleCheckin}
              disabled={!checkin || checkin.checkedToday || checkingIn}
              loading={!checkin || checkingIn}
            >
              {checkin?.checkedToday ? '今日已签到' : checkin ? '立即签到' : '加载中…'}
            </Button>
          </div>
          {checkinError && <div className="profile-checkin-error">{checkinError}</div>}
        </Panel>

        {bookmarks.length > 0 && (
          <Panel className="profile-bookmarks">
            <div className="profile-panel-head">
              <div>
                <div className="profile-kicker">Bookmarks</div>
                <h2>我的收藏</h2>
              </div>
              <span>{bookmarks.length} 篇</span>
            </div>
            <div className="profile-bookmarks-list">
              {bookmarks.map((bookmark) => (
                <button key={bookmark.id} type="button" onClick={() => navigate(`/chat/p/${bookmark.id}`)}>
                  <span className="profile-bookmark-title">{bookmark.title}</span>
                  <span className="profile-bookmark-meta">
                    {bookmark.userName} · 💬 {bookmark.commentCount} · {new Date(bookmark.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                </button>
              ))}
            </div>
          </Panel>
        )}

        {problemBookmarks.length > 0 && (
          <Panel className="profile-bookmarks">
            <div className="profile-panel-head">
              <div>
                <div className="profile-kicker">OJ Bookmarks</div>
                <h2>收藏题目</h2>
              </div>
              <span>{problemBookmarks.length} 道</span>
            </div>
            <div className="profile-bookmarks-list">
              {problemBookmarks.map((bookmark) => (
                <button key={bookmark.id} type="button" onClick={() => navigate(`/oj/p${bookmark.id}`)}>
                  <span className="profile-bookmark-title">P{bookmark.id} · {bookmark.title}</span>
                  <span className="profile-bookmark-meta">
                    {bookmark.difficulty || '未分类'} · {new Date(bookmark.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                </button>
              ))}
            </div>
          </Panel>
        )}
      </main>
    </div>
  )
}
