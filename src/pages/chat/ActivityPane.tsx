import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchJson } from '../../utils'
import type { ActivityLeaderboardResponse, ChatStatsResponse } from '../../types'
import { EmptyState, LoadingState } from '../../components/ui'
import DecoratedAvatar from '../../components/profile/DecoratedAvatar'
import './ChatHub.css'

const SCORE_RULES = [
  { action: '发布帖子', points: '+10' },
  { action: '发表评论', points: '+5' },
  { action: '聊天消息', points: '+1' },
  { action: '线程回复', points: '+2' },
  { action: '收到表情回应', points: '+2' },
]

export default function ActivityPane() {
  const navigate = useNavigate()
  const [days, setDays] = useState<7 | 30>(7)
  const [data, setData] = useState<ActivityLeaderboardResponse | null>(null)
  const [stats, setStats] = useState<ChatStatsResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    try {
      const [{ response, data: lb }, statsRes] = await Promise.all([
        fetchJson<ActivityLeaderboardResponse>(`/api/chat/activity/leaderboard?days=${days}`, { signal }),
        fetchJson<ChatStatsResponse>('/api/chat/stats/me', { signal }).catch(() => null),
      ])
      if (signal?.aborted) return
      if (response.ok && lb) setData(lb)
      if (statsRes?.response.ok && statsRes.data) setStats(statsRes.data)
    } catch {
      // 忽略
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [days])

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void load(controller.signal)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [load])

  return (
    <section className="chat-scope-pane activity-pane">
      <header className="chat-pane-header">
        <div className="chat-pane-title">
          <span className="chat-pane-icon" aria-hidden="true">🏆</span>
          <div>
            <h2>社区活跃榜</h2>
            <p>发言、发帖、回复、收到回应都能积累活跃分</p>
          </div>
        </div>
        <div className="chat-pane-actions">
          <button type="button" className={days === 7 ? 'primary small' : 'ghost small'} onClick={() => setDays(7)}>
            近 7 天
          </button>
          <button type="button" className={days === 30 ? 'primary small' : 'ghost small'} onClick={() => setDays(30)}>
            近 30 天
          </button>
        </div>
      </header>

      {data?.me?.rank && (
        <div className="activity-my-rank">
          🏆 我的排名 <strong>#{data.me.rank}</strong> · 活跃分 <strong>{data.me.score}</strong>
        </div>
      )}

      <div className="activity-body">
        <div className="activity-leaderboard">
          {loading ? (
            <LoadingState variant="list" label="正在加载活跃榜…" />
          ) : !data || data.leaderboard.length === 0 ? (
            <EmptyState title="暂时没有活跃榜数据" description="去发条消息，成为第一个上榜的人吧 ✨" />
          ) : (
            data.leaderboard.map((entry) => (
              <button
                key={entry.userId}
                type="button"
                className={`activity-row ${entry.userId === data.me.userId ? 'me' : ''} ${entry.rank <= 3 ? `top-${entry.rank}` : ''}`}
                onClick={() => navigate(`/user/${entry.userId}`)}
              >
                <span className={`activity-rank ${entry.rank <= 3 ? `top-${entry.rank}` : ''}`}>
                  {entry.rank <= 3 ? ['🥇', '🥈', '🥉'][entry.rank - 1] : `#${entry.rank}`}
                </span>
                <span className="activity-avatar">
                  <DecoratedAvatar
                    avatar={entry.userAvatar}
                    fallback={entry.userName.charAt(0).toUpperCase()}
                    frame={entry.avatarFrame}
                    overlay={entry.avatarOverlay}
                    size="discussion"
                    loading="lazy"
                  />
                </span>
                <span className="activity-name">
                  {entry.userName}
                  {entry.userId === data.me.userId && <em>（我）</em>}
                </span>
                {entry.displayTitle && <span className="activity-user-title">{entry.displayTitleIcon || '✦'} {entry.displayTitle}</span>}
                <span className="activity-score">{entry.score} 分</span>
              </button>
            ))
          )}
        </div>

        <aside className="activity-side">
          <div className="activity-stats">
            <div className="activity-stats-title">我的活跃档案</div>
            <div className="activity-stat-row">
              <span>活跃分</span>
              <strong>{stats?.stats.activityScore ?? '-'}</strong>
            </div>
            <div className="activity-stat-row">
              <span>活跃天数</span>
              <strong>{stats?.stats.activeDays ?? '-'}</strong>
            </div>
            <div className="activity-stat-row">
              <span>消息</span>
              <strong>{stats?.stats.messageCount ?? '-'}</strong>
            </div>
            <div className="activity-stat-row">
              <span>线程回复</span>
              <strong>{stats?.stats.replyCount ?? '-'}</strong>
            </div>
            <div className="activity-stat-row">
              <span>帖子 / 评论</span>
              <strong>{stats ? `${stats.stats.postCount} / ${stats.stats.commentCount}` : '-'}</strong>
            </div>
            <div className="activity-stat-row">
              <span>收到回应</span>
              <strong>{stats?.stats.reactionReceived ?? '-'}</strong>
            </div>
            {stats && stats.achievements.length > 0 && (
              <div className="activity-achieve-row">
                <span>聊天徽章</span>
                <span className="activity-achieve-icons">
                  {stats.achievements.slice(0, 8).map((a) => (
                    <span key={a.type} title={`${a.name}：${a.desc}`}>{a.icon}</span>
                  ))}
                </span>
              </div>
            )}
          </div>
          <div className="activity-rules">
            <div className="activity-stats-title">得分规则</div>
            {SCORE_RULES.map((rule) => (
              <div key={rule.action} className="activity-rule-row">
                <span>{rule.action}</span>
                <em>{rule.points}</em>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </section>
  )
}
