import { useEffect, useRef, useState } from 'react'
import { useAppContext } from '../context/AppContext'
import type {
  Achievement,
  AchievementsResponse,
  HeatmapData,
  HeatmapResponse,
  ProfileStats,
  ProfileStatsResponse,
  UserResponse,
} from '../types'
import { fetchJson } from '../utils'

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
      <section className="section">
        <div className="section-header">
          <h2>个人中心</h2>
        </div>
        <p>登录后可以查看做题数据、成长轨迹和个人成就。</p>
        <button className="primary" onClick={() => openAuth('login')}>
          去登录
        </button>
      </section>
    )
  }

  if (loading) {
    return (
      <div className="profile-container">
        <div className="profile-left">
          <div className="profile-card">
            <div className="skeleton skeleton-avatar" style={{ width: 80, height: 80, margin: '0 auto 12px' }} />
            <div className="skeleton skeleton-title" style={{ margin: '0 auto 8px' }} />
            <div className="skeleton skeleton-line" style={{ width: '40%', margin: '0 auto' }} />
          </div>
        </div>
        <div className="profile-right">
          <div className="stats-grid">
            {[1, 2, 3, 4, 5, 6].map((item) => (
              <div key={item} className="stat-card">
                <div className="skeleton skeleton-line" style={{ width: '50%', height: 20 }} />
                <div className="skeleton skeleton-line" style={{ width: '70%', height: 14 }} />
              </div>
            ))}
          </div>
          <div className="heatmap-container" style={{ minHeight: '200px' }}>
            <div className="heatmap-title">做题热力图</div>
            <div className="skeleton" style={{ height: 120, marginTop: 12 }} />
          </div>
        </div>
      </div>
    )
  }

  const stats = profileStats?.stats || {}
  const difficultyStats = profileStats?.difficultyStats || {}

  return (
    <div className="profile-container">
      <div className="profile-left">
        <div className="profile-card">
          <div
            className={`profile-avatar-large ${uploading ? 'uploading' : ''}`}
            onClick={handleAvatarClick}
            style={{ cursor: 'pointer' }}
            title="点击更换头像"
          >
            {currentUser.avatar ? (
              <img src={currentUser.avatar} alt="头像" loading="lazy" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
            ) : (
              initial
            )}
          </div>
          <div className="account-name" data-user-name style={{ fontSize: '20px', fontWeight: 600 }}>{currentUser.name}</div>
          <div className="account-id" data-user-id style={{ color: 'var(--muted)' }}>@{currentUser.id}</div>
          {stats.rank && stats.rank > 0 && (
            <div className="profile-rank-badge">全站排名 #{stats.rank}</div>
          )}
          {uploadError && <div className="auth-error" style={{ marginTop: '8px', fontSize: '12px' }}>{uploadError}</div>}
          {uploading && <div style={{ color: 'var(--muted)', marginTop: '8px', fontSize: '12px' }}>正在上传头像...</div>}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>
      </div>

      <div className="profile-right">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{stats.totalSubmissions || 0}</div>
            <div className="stat-label">总提交</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.acceptedCount || 0}</div>
            <div className="stat-label">通过次数</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.solvedProblems || 0}</div>
            <div className="stat-label">已解决题目</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.acceptanceRate?.toFixed(1) || 0}%</div>
            <div className="stat-label">通过率</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.currentStreak || 0}</div>
            <div className="stat-label">当前连续天数</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.maxStreak || 0}</div>
            <div className="stat-label">最长连续天数</div>
          </div>
        </div>

        <div className="heatmap-container">
          <div className="heatmap-title">做题热力图</div>
          <div className="heatmap-grid">
            {heatmapData.map((day, index) => {
              const level = day.count === 0 ? 0 : day.count <= 2 ? 1 : day.count <= 5 ? 2 : day.count <= 10 ? 3 : 4
              return (
                <div
                  key={index}
                  className="heatmap-cell"
                  data-level={level}
                  data-tip={`${day.date}：提交 ${day.count} 次，AC ${day.accepted} 次`}
                />
              )
            })}
          </div>
        </div>

        {Object.keys(difficultyStats).length > 0 && (
          <div className="difficulty-section">
            <div className="heatmap-title">难度分布</div>
            <div className="difficulty-grid">
              {Object.entries(difficultyStats).map(([difficulty, count]) => (
                <div key={difficulty} className="difficulty-card">
                  <div className="difficulty-header">
                    <span className={`difficulty-tag ${difficulty}`}>{difficulty}</span>
                    <strong>{typeof count === 'number' ? count : Object.keys(count || {}).length}</strong>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {achievements.length > 0 && (
          <div className="achievements-section">
            <div className="heatmap-title">成就</div>
            <div className="achievements-grid">
              {achievements.map((achievement) => (
                <div key={achievement.id} className="achievement-card">
                  <div className="achievement-name">{achievement.name}</div>
                  <div className="achievement-desc">{achievement.description}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {ratingHistory.length > 0 && (
          <div className="rating-chart">
            <div className="rating-chart-title">等级分走势</div>
            <svg viewBox="0 0 100 40" preserveAspectRatio="none">
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
                return <polyline fill="none" stroke="#7dd3fc" strokeWidth="1.8" points={points} />
              })()}
            </svg>
          </div>
        )}
      </div>
    </div>
  )
}
