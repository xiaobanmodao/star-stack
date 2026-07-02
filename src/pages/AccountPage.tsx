import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useAppContext } from '../context/AppContext'
import type {
  Achievement,
  AchievementsResponse,
  DifficultyStats,
  HeatmapData,
  HeatmapResponse,
  ProfileStats,
  ProfileStatsResponse,
  UserResponse,
} from '../types'
import { fetchJson } from '../utils'
import { Badge, Button, EmptyState, PageHeader, Panel } from '../components/ui'
import './AccountPage.css'

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
  const { currentUser, setCurrentUser, openAuth } = useAppContext()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [profileStats, setProfileStats] = useState<ProfileStats | null>(null)
  const [heatmapData, setHeatmapData] = useState<HeatmapData[]>([])
  const [achievements, setAchievements] = useState<Achievement[]>([])
  const [loading, setLoading] = useState(true)
  const [ratingHistory, setRatingHistory] = useState<{ date: string; rating: number }[]>([])
  const loadedUserIdRef = useRef<string | null>(null)
  const initial = currentUser?.name?.trim()?.[0] || currentUser?.id?.[0] || '★'

  const handleAvatarClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setUploadError('请选择图片文件。')
      return
    }

    if (file.size > 2 * 1024 * 1024) {
      setUploadError('图片大小不能超过 2MB。')
      return
    }

    setUploadError('')
    setUploading(true)

    const reader = new FileReader()
    reader.onload = async (loadEvent) => {
      const base64 = loadEvent.target?.result as string
      const { response, data } = await fetchJson<UserResponse>('/api/me/avatar', {
        method: 'POST',
        body: JSON.stringify({ avatar: base64 }),
      })

      setUploading(false)

      if (!response.ok) {
        setUploadError(data?.message || '头像上传失败。')
        return
      }

      if (data?.user) {
        setCurrentUser(data.user)
      }
    }

    reader.onerror = () => {
      setUploading(false)
      setUploadError('读取图片失败，请重试。')
    }

    reader.readAsDataURL(file)
  }

  useEffect(() => {
    if (!currentUser?.id) return
    if (loadedUserIdRef.current === currentUser.id) return

    let mounted = true

    const loadProfileData = async () => {
      setLoading(true)
      try {
        const [statsRes, heatmapRes, achievementsRes, ratingRes] = await Promise.all([
          fetchJson<ProfileStatsResponse>(`/api/user/profile/${currentUser.id}`),
          fetchJson<{ heatmap: HeatmapResponse }>(`/api/user/heatmap/${currentUser.id}`),
          fetchJson<{ achievements: AchievementsResponse }>(`/api/user/achievements/${currentUser.id}`),
          fetchJson<{ history: { date: string; rating: number }[] }>(`/api/user/rating-history/${currentUser.id}`)
        ])

        if (!mounted) return

        if (statsRes.response.ok && statsRes.data) setProfileStats(statsRes.data)
        if (heatmapRes.response.ok && heatmapRes.data) setHeatmapData(heatmapRes.data.heatmap || [])
        if (achievementsRes.response.ok && achievementsRes.data) setAchievements(achievementsRes.data.achievements || [])
        if (ratingRes.response.ok && ratingRes.data) setRatingHistory(ratingRes.data.history || [])

        loadedUserIdRef.current = currentUser.id
      } catch (error) {
        console.error('Failed to load profile data:', error)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    void loadProfileData()

    return () => {
      mounted = false
    }
  }, [currentUser, setCurrentUser])

  if (!currentUser) {
    return (
      <section className="section profile-v2 profile-guest">
        <PageHeader
          kicker="Star Profile"
          title="个人中心"
          description="登录后可以查看做题数据、成长轨迹和个人成就。"
          actions={<Button variant="primary" onClick={() => openAuth('login')}>去登录</Button>}
        />
        <EmptyState
          title="还没有连接到你的星栈账号"
          description="登录后，这里会展示你的刷题航线、连续天数、成就和 Rating 变化。"
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
      </div>
    )
  }

  const stats = profileStats?.stats || {}
  const difficultyStats = profileStats?.difficultyStats || {}
  const solvedProblems = stats.solvedProblems ?? stats.totalSolved ?? 0
  const totalTried = stats.totalTried ?? solvedProblems
  const acceptedCount = stats.acceptedCount ?? 0
  const totalSubmissions = stats.totalSubmissions ?? 0
  const acceptanceRate = stats.acceptanceRate ?? 0
  const recentActiveDays = getRecentActiveDays(heatmapData)
  const latestRating = ratingHistory.at(-1)?.rating
  const ratingDelta = getRatingDelta(ratingHistory)
  const difficultyEntries = Object.entries(difficultyStats)
  const maxDifficultySolved = Math.max(...difficultyEntries.map(([, item]) => getDifficultySolved(item)), 1)
  const starNodes = [
    ...difficultyEntries.slice(0, 7).map(([difficulty, item], index) => ({
      id: `difficulty-${difficulty}`,
      label: difficulty,
      value: getDifficultySolved(item),
      x: 14 + ((index * 23) % 72),
      y: 20 + ((index * 31) % 58),
      level: Math.min(4, Math.max(1, Math.ceil((getDifficultySolved(item) / maxDifficultySolved) * 4))),
    })),
    ...achievements.slice(0, 4).map((achievement, index) => ({
      id: `achievement-${achievement.id}`,
      label: achievement.name,
      value: 1,
      x: 18 + ((index * 29 + 12) % 68),
      y: 24 + ((index * 19 + 8) % 52),
      level: 4,
    })),
  ].slice(0, 10)
  const visibleStarNodes = starNodes.length > 0
    ? starNodes
    : [{ id: 'empty-course', label: '等待启航', value: 0, x: 50, y: 48, level: 1 }]

  return (
    <div className="profile-container profile-v2">
      <aside className="profile-left">
        <Panel className="profile-card profile-identity-card">
          <div className="profile-avatar-shell">
            <div
              className={`profile-avatar-large ${uploading ? 'uploading' : ''}`}
              onClick={handleAvatarClick}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') handleAvatarClick()
              }}
              style={{ cursor: 'pointer' }}
              title="点击更换头像"
            >
              {currentUser.avatar ? (
                <img src={currentUser.avatar} alt="头像" loading="lazy" />
              ) : (
                initial
              )}
            </div>
          </div>
          <div className="profile-user-copy">
            <div className="account-name" data-user-name>{currentUser.name}</div>
            <div className="account-id" data-user-id>@{currentUser.id}</div>
          </div>
          {stats.rank && stats.rank > 0 && (
            <Badge tone="info" className="profile-rank-badge">全站排名 #{stats.rank}</Badge>
          )}
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
          <Button variant="ghost" size="sm" onClick={handleAvatarClick} loading={uploading}>
            更换头像
          </Button>
          {uploadError && <div className="auth-error profile-upload-error">{uploadError}</div>}
          {uploading && <div className="profile-upload-hint">正在上传头像...</div>}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </Panel>

        <Panel className="profile-side-note">
          <div className="profile-side-note-title">本月活动</div>
          <strong>{recentActiveDays}</strong>
          <span>近 30 天有提交记录的天数</span>
        </Panel>
      </aside>

      <main className="profile-right">
        <Panel className="profile-command-panel" elevated>
          <div className="profile-command-copy">
            <div className="profile-kicker">Growth Route</div>
            <h1>成长航线</h1>
            <p>
              把提交、通过、难度和成就收束成一张轻量星图。这里应该让用户一眼看到自己正在变强，而不是只看到一组数字。
            </p>
            <div className="profile-command-actions">
              <Badge tone="success">已解决 {solvedProblems} 题</Badge>
              <Badge tone="info">尝试 {totalTried} 题</Badge>
              {latestRating !== undefined && <Badge tone="warning">Rating {latestRating}</Badge>}
            </div>
          </div>

          <div className="profile-star-map" aria-label="成长星图">
            <div className="profile-star-path" />
            {visibleStarNodes.map((node) => (
              <span
                key={node.id}
                className={`profile-star-node level-${node.level}`}
                style={{ '--x': `${node.x}%`, '--y': `${node.y}%` } as CSSProperties}
                title={`${node.label}：${node.value}`}
              >
                <span>{node.value > 0 ? node.value : '·'}</span>
              </span>
            ))}
          </div>
        </Panel>

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
          <div className="heatmap-grid">
            {heatmapData.map((day, index) => (
              <div
                key={`${day.date}-${index}`}
                className="heatmap-cell"
                data-level={getHeatmapLevel(day.count)}
                data-tip={`${day.date}：提交 ${day.count} 次，AC ${day.accepted ?? 0} 次`}
              />
            ))}
          </div>
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

        {achievements.length > 0 && (
          <Panel className="achievements-section profile-achievements-panel">
            <div className="profile-panel-head">
              <div>
                <div className="profile-kicker">Achievements</div>
                <h2>成就轨道</h2>
              </div>
              <span>{achievements.length} 个已解锁</span>
            </div>
            <div className="achievements-grid profile-achievements-grid">
              {achievements.map((achievement) => (
                <div key={achievement.id} className="achievement-card profile-achievement-card">
                  <div className="profile-achievement-icon" aria-hidden="true">{achievement.icon || '★'}</div>
                  <div>
                    <div className="achievement-name">{achievement.name}</div>
                    <div className="achievement-desc">{achievement.description}</div>
                  </div>
                </div>
              ))}
            </div>
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
      </main>
    </div>
  )
}
