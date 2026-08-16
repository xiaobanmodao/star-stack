import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAppContext } from '../context/AppContext'
import { fetchJson } from '../utils'
import type {
  Achievement, AchievementsResponse, ChatAchievement, ChatAchievementsResponse,
  DiscussionListResponse, DiscussionPost,
  FollowRelations, ProfileStatsResponse, UserProfileResponse,
} from '../types'
import { Badge, Button, EmptyState, PageHeader, Panel } from '../components/ui'
import ReportModal from '../components/ReportModal'
import './AccountPage.css'
import './UserProfile.css'

export default function UserProfilePage() {
  const navigate = useNavigate()
  const { currentUser } = useAppContext()
  const { userId = '' } = useParams<{ userId: string }>()
  const [profile, setProfile] = useState<UserProfileResponse | null>(null)
  const [stats, setStats] = useState<ProfileStatsResponse | null>(null)
  const [posts, setPosts] = useState<DiscussionPost[]>([])
  const [achievements, setAchievements] = useState<Achievement[]>([])
  const [chatAchievements, setChatAchievements] = useState<ChatAchievement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toggling, setToggling] = useState(false)
  const [blocking, setBlocking] = useState(false)
  const [bioEdit, setBioEdit] = useState(false)
  const [bioDraft, setBioDraft] = useState('')
  const [bioSaving, setBioSaving] = useState(false)
  const [showReport, setShowReport] = useState(false)

  const loadProfile = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [{ response, data }, statsRes, postsRes, achievementsRes, chatAchievementsRes] = await Promise.all([
        fetchJson<UserProfileResponse>(`/api/users/${userId}/profile`),
        fetchJson<ProfileStatsResponse>(`/api/user/profile/${userId}`).catch(() => null),
        fetchJson<DiscussionListResponse>(`/api/discussions?userId=${encodeURIComponent(userId)}&pageSize=5`).catch(() => null),
        fetchJson<{ achievements: AchievementsResponse }>(`/api/user/achievements/${userId}`).catch(() => null),
        fetchJson<ChatAchievementsResponse>(`/api/chat/achievements/${userId}`).catch(() => null),
      ])
      if (!response.ok || !data) {
        setError(data?.message || '用户不存在')
        return
      }
      setProfile(data)
      if (statsRes?.response.ok && statsRes.data) setStats(statsRes.data)
      if (postsRes?.response.ok && postsRes.data) setPosts(postsRes.data.posts || [])
      if (achievementsRes?.response.ok && achievementsRes.data) {
        setAchievements(achievementsRes.data.achievements || [])
      }
      if (chatAchievementsRes?.response.ok && chatAchievementsRes.data) {
        setChatAchievements(chatAchievementsRes.data.achievements || [])
      }
    } catch {
      setError('加载失败，请重试')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void loadProfile()
  }, [loadProfile])

  const handleToggleFollow = async () => {
    if (!currentUser) {
      navigate('/auth')
      return
    }
    if (!profile || toggling) return
    setToggling(true)
    try {
      const method = profile.relations.following ? 'DELETE' : 'POST'
      const { response, data } = await fetchJson<{ relations: FollowRelations }>(`/api/users/${userId}/follow`, {
        method,
      })
      if (response.ok && data?.relations) {
        setProfile((prev) => (prev ? { ...prev, relations: data.relations! } : prev))
      }
    } catch {
      // 忽略
    } finally {
      setToggling(false)
    }
  }

  const handleToggleBlock = async () => {
    if (!currentUser || !profile) return
    setBlocking(true)
    try {
      const method = profile.blocked ? 'DELETE' : 'POST'
      const { response, data } = await fetchJson<{ blocked?: boolean; message?: string }>(
        `/api/users/${userId}/block`,
        { method }
      )
      if (response.ok && data) {
        setProfile((prev) => (prev ? { ...prev, blocked: Boolean(data.blocked) } : prev))
      }
    } catch {
      // 忽略
    } finally {
      setBlocking(false)
    }
  }

  const handleSaveBio = async () => {
    setBioSaving(true)
    try {
      const { response, data } = await fetchJson<{ bio?: string }>('/api/me/bio', {
        method: 'PUT',
        body: JSON.stringify({ bio: bioDraft }),
      })
      if (response.ok && data) {
        setProfile((prev) => (prev ? { ...prev, user: { ...prev.user, bio: data.bio! } } : prev))
        setBioEdit(false)
      }
    } catch {
      // 忽略
    } finally {
      setBioSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="user-profile-page">
        <div className="profile-container profile-v2">
          <div className="profile-left">
            <Panel className="profile-card">
              <div className="skeleton skeleton-avatar" style={{ width: 80, height: 80, margin: '0 auto 12px' }} />
              <div className="skeleton skeleton-title" style={{ margin: '0 auto 8px' }} />
              <div className="skeleton skeleton-line" style={{ width: '40%', margin: '0 auto' }} />
            </Panel>
          </div>
        </div>
      </div>
    )
  }

  if (error || !profile) {
    return (
      <section className="section profile-v2">
        <PageHeader kicker="Star Profile" title="用户档案" description="查看其他用户的公开信息。" />
        <EmptyState title={error || '用户不存在'} description="链接可能已失效。" />
      </section>
    )
  }

  const { user, relations } = profile
  const isSelf = currentUser?.id === user.id
  const followLabel = relations.following
    ? relations.isFriend ? '互相关注' : '已关注'
    : '关注'

  return (
    <div className="user-profile-page">
      <div className="profile-container profile-v2">
        <aside className="profile-left">
          <Panel className="profile-card profile-identity-card">
            <div className="profile-avatar-shell">
              <div className="profile-avatar-large">
                {user.avatar ? (
                  <img src={user.avatar} alt="头像" loading="lazy" />
                ) : (
                  <span>{user.name.charAt(0).toUpperCase()}</span>
                )}
              </div>
            </div>
            <div className="profile-user-copy">
              <div className="account-name" data-user-name>{user.name}</div>
              <div className="account-id" data-user-id>@{user.id}</div>
              {user.level && (
                <Badge tone="info" className="profile-level-badge">
                  {user.icon || '✦'} Lv.{user.level} {user.title || '星尘'}
                </Badge>
              )}
            </div>
            {isSelf ? (
              bioEdit ? (
                <div className="user-bio-editor">
                  <input
                    type="text"
                    value={bioDraft}
                    onChange={(event) => setBioDraft(event.target.value)}
                    placeholder="一句话介绍自己（200 字内）"
                    maxLength={200}
                    autoFocus
                  />
                  <div className="user-bio-actions">
                    <Button variant="ghost" size="sm" onClick={() => setBioEdit(false)}>取消</Button>
                    <Button variant="primary" size="sm" loading={bioSaving} onClick={() => void handleSaveBio()}>
                      保存
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="user-bio">
                  {user.bio || '还没有简介'}
                  <button type="button" className="user-bio-edit-btn" onClick={() => { setBioDraft(user.bio || ''); setBioEdit(true) }} title="编辑简介">
                    ✎
                  </button>
                </div>
              )
            ) : (
              <div className="user-bio">{user.bio || '这个人很神秘，还没有写简介'}</div>
            )}
            {user.isAdmin && <Badge tone="warning">管理员</Badge>}
            <div className="profile-joined-at">
              加入于 {new Date(user.createdAt).toLocaleDateString('zh-CN')}
            </div>
            <div className="user-profile-actions">
              {isSelf ? (
                <Button variant="ghost" size="sm" onClick={() => navigate('/account')}>
                  编辑我的资料
                </Button>
              ) : (
                <>
                  <Button
                    variant={relations.following ? 'ghost' : 'primary'}
                    size="sm"
                    loading={toggling}
                    onClick={() => void handleToggleFollow()}
                  >
                    {followLabel}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => navigate(`/chat/dm/${user.id}`)}>
                    发私信
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={blocking}
                    onClick={() => void handleToggleBlock()}
                    className={profile.blocked ? 'user-block-btn active' : ''}
                  >
                    {profile.blocked ? '已屏蔽 ✓' : '屏蔽'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowReport(true)} title="举报用户">
                    ⚑
                  </Button>
                </>
              )}
            </div>
            <Panel className="profile-side-note user-profile-relations">
              <div className="user-profile-relation-row">
                <strong>{relations.followingCount}</strong>
                <span>关注</span>
              </div>
              <div className="user-profile-relation-row">
                <strong>{relations.followerCount}</strong>
                <span>粉丝</span>
              </div>
              <div className="user-profile-relation-row friend">
                <strong>{relations.isFriend ? '✓' : '—'}</strong>
                <span>好友关系</span>
              </div>
            </Panel>
          </Panel>
        </aside>

        <main className="profile-right">
          <Panel className="profile-command-panel" elevated>
            <div className="profile-command-copy">
              <div className="profile-kicker">Star Profile</div>
              <h1>{user.name}</h1>
              <p>
                {relations.isFriend
                  ? `你和 @${user.id} 是好友，可以随时发私信交流。`
                  : relations.following
                    ? `你已关注 @${user.id}，对方关注你后你们会成为好友。`
                    : `关注 @${user.id}，不错过对方的动态。`}
              </p>
            </div>
          </Panel>

          <div className="stats-grid profile-stats-grid">
            <Panel className="stat-card">
              <div className="stat-value">{stats?.stats?.solvedProblems ?? stats?.stats?.totalSolved ?? '-'}</div>
              <div className="stat-label">已解决题目</div>
            </Panel>
            <Panel className="stat-card">
              <div className="stat-value">{stats?.stats?.totalTried ?? '-'}</div>
              <div className="stat-label">尝试题目</div>
            </Panel>
            <Panel className="stat-card">
              <div className="stat-value">{stats?.stats?.acceptanceRate?.toFixed?.(1) ?? (stats?.stats?.acceptanceRate ?? '-')}%</div>
              <div className="stat-label">通过率</div>
            </Panel>
            <Panel className="stat-card">
              <div className="stat-value">{stats?.stats?.currentStreak ?? 0}</div>
              <div className="stat-label">连续天数</div>
            </Panel>
          </div>

          {achievements.length > 0 && (
            <Panel className="user-achievements">
              <div className="user-section-head">
                <div>
                  <div className="profile-kicker">Achievements</div>
                  <h2>成就徽章</h2>
                </div>
                <span>{achievements.length} 个</span>
              </div>
              <div className="user-achievements-grid">
                {achievements.slice(0, 12).map((achievement) => (
                  <div key={achievement.id} className="user-achievement" title={achievement.description}>
                    <span className="user-achievement-icon" aria-hidden="true">{achievement.icon || '★'}</span>
                    <em>{achievement.name}</em>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {chatAchievements.length > 0 && (
            <Panel className="user-achievements">
              <div className="user-section-head">
                <div>
                  <div className="profile-kicker">Chat Badges</div>
                  <h2>聊天徽章</h2>
                </div>
                <span>{chatAchievements.length} 个</span>
              </div>
              <div className="user-achievements-grid">
                {chatAchievements.map((achievement) => (
                  <div key={achievement.type} className="user-achievement" title={achievement.desc}>
                    <span className="user-achievement-icon" aria-hidden="true">{achievement.icon || '🏅'}</span>
                    <em>{achievement.name}</em>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {posts.length > 0 && (
            <Panel className="user-recent-posts">
              <div className="user-section-head">
                <div>
                  <div className="profile-kicker">Recent Threads</div>
                  <h2>最近发帖</h2>
                </div>
              </div>
              <div className="user-recent-posts-list">
                {posts.map((post) => (
                  <button key={post.id} type="button" onClick={() => navigate(`/chat/p/${post.id}`)}>
                    <span className="user-recent-post-title">{post.title}</span>
                    <span className="user-recent-post-meta">
                      💬 {post.commentCount} · 👍 {post.likeCount} · {new Date(post.createdAt).toLocaleDateString('zh-CN')}
                    </span>
                  </button>
                ))}
              </div>
            </Panel>
          )}
        </main>
      </div>
      {showReport && (
        <ReportModal
          targetType="user"
          targetId={userId}
          onClose={() => setShowReport(false)}
          onDone={(message) => window.alert(message)}
        />
      )}
    </div>
  )
}
