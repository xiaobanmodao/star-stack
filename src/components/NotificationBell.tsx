import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { NotificationItem, NotificationType, NotificationsResponse } from '../types'
import { fetchJson } from '../utils'
import { disablePush, enablePush, isPushEnabled } from '../utils/push'
import './NotificationBell.css'

const TYPE_ICONS: Record<NotificationType, string> = {
  follow: '❤️',
  comment: '💬',
  reply: '↩️',
  mention: '@',
  invite: '🔔',
  'achievement.unlocked': '🏆',
  'problem.review_requested': '📝',
  'problem.status_changed': '📣',
}

const formatNotifTime = (iso: string) => {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour} 小时前`
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 7) return `${diffDay} 天前`
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

type NotificationFilter = 'all' | 'social' | 'oj' | 'system'

const getNotificationFilter = (item: NotificationItem): Exclude<NotificationFilter, 'all'> => {
  if (item.type.startsWith('problem.') || item.type === 'achievement.unlocked') return 'oj'
  if (item.type === 'follow' || item.type === 'comment' || item.type === 'reply' || item.type === 'mention') return 'social'
  return 'system'
}

/** 根据通知目标跳转 */
const targetOf = (item: NotificationItem, navigate: ReturnType<typeof useNavigate>) => {
  if (item.targetType === 'post' && item.targetId) {
    navigate(`/chat/p/${item.targetId}`)
  } else if (item.targetType === 'room' && item.targetId) {
    navigate(`/chat/room/${item.targetId}`)
  } else if (item.targetType === 'channel' && item.targetId) {
    navigate(`/chat/c/${item.targetId}`)
  } else if (item.targetType === 'problem' && item.targetId) {
    navigate(`/oj/p${item.targetId}`)
  } else {
    navigate(`/user/${item.actor.id}`)
  }
}

export default function NotificationBell() {
  const navigate = useNavigate()
  const [unreadCount, setUnreadCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(false)
  const [pushEnabled, setPushEnabled] = useState(isPushEnabled)
  const [pushBusy, setPushBusy] = useState(false)
  const [activeFilter, setActiveFilter] = useState<NotificationFilter>('all')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [readBusy, setReadBusy] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const loadUnread = useCallback(async () => {
    try {
      const { response, data } = await fetchJson<{ unreadCount: number }>('/api/notifications/unread-count')
      if (response.ok && data) setUnreadCount(data.unreadCount)
    } catch {
      // 忽略
    }
  }, [])

  // 打开时拉取列表，并轮询未读数
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadUnread()
    }, 0)
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadUnread()
    }, 20000)
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(interval)
    }
  }, [loadUnread])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => {
      setLoading(true)
      void fetchJson<NotificationsResponse>('/api/notifications?page=1&pageSize=20').then(({ response, data }) => {
        if (response.ok && data) {
          setItems(data.notifications || [])
          setUnreadCount(data.unreadCount)
        }
        setLoading(false)
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [open])

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    const handleClick = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const handleItemClick = async (item: NotificationItem) => {
    setOpen(false)
    if (!item.isRead) {
      await fetchJson('/api/notifications/read', { method: 'POST', body: JSON.stringify({ id: item.id }) })
      setUnreadCount((prev) => Math.max(0, prev - 1))
    }
    targetOf(item, navigate)
  }

  const handleReadAll = async () => {
    if (readBusy) return
    setReadBusy(true)
    try {
      const { response, data } = await fetchJson<{ unreadCount: number }>('/api/notifications/read', {
        method: 'POST',
        body: JSON.stringify({ all: true }),
      })
      if (response.ok) {
        setUnreadCount(data?.unreadCount ?? 0)
        setItems((prev) => prev.map((item) => ({ ...item, isRead: true })))
      }
    } finally {
      setReadBusy(false)
    }
  }

  const handleTogglePush = async () => {
    if (pushBusy) return
    setPushBusy(true)
    try {
      if (pushEnabled) {
        await disablePush()
        setPushEnabled(false)
      } else {
        const result = await enablePush()
        if (result.ok) {
          setPushEnabled(true)
        } else if (result.message) {
          window.alert(result.message)
        }
      }
    } finally {
      setPushBusy(false)
    }
  }

  const filteredItems = useMemo(() => items.filter((item) => {
    const matchesFilter = activeFilter === 'all' || getNotificationFilter(item) === activeFilter
    return matchesFilter && (!unreadOnly || !item.isRead)
  }), [activeFilter, items, unreadOnly])

  return (
    <div className="notification-bell" ref={panelRef}>
      <button
        type="button"
        className="topbar-message-btn"
        onClick={() => setOpen((prev) => !prev)}
        title={unreadCount > 0 ? `${unreadCount} 条新通知` : '通知'}
        aria-label="通知"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unreadCount > 0 && <span className="topbar-message-dot">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-panel-head">
            <span>通知</span>
            {unreadCount > 0 && <button type="button" onClick={() => void handleReadAll()} disabled={readBusy}>{readBusy ? '处理中…' : '全部已读'}</button>}
          </div>
          <div className="notif-filters" role="tablist" aria-label="通知筛选">
            {([
              ['all', '全部'],
              ['social', '互动'],
              ['oj', '题库'],
              ['system', '其他'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={activeFilter === value}
                className={activeFilter === value ? 'active' : ''}
                onClick={() => setActiveFilter(value)}
              >
                {label}
              </button>
            ))}
            <button type="button" className={`notif-unread-toggle ${unreadOnly ? 'active' : ''}`} onClick={() => setUnreadOnly((value) => !value)}>
              仅未读
            </button>
          </div>
          <div className="notif-list">
            {loading ? (
              <div className="notif-empty">加载中...</div>
            ) : filteredItems.length === 0 ? (
              <div className="notif-empty">还没有通知</div>
            ) : (
              filteredItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`notif-item ${item.isRead ? '' : 'unread'}`}
                  onClick={() => void handleItemClick(item)}
                >
                  <span className="notif-avatar">
                    {item.actor.avatar ? (
                      <img src={item.actor.avatar} alt="" loading="lazy" />
                    ) : (
                      <span>{item.actor.name.charAt(0).toUpperCase()}</span>
                    )}
                  </span>
                  <span className="notif-body">
                    <span className="notif-text">
                      <strong>{item.actor.name}</strong> {item.message}
                    </span>
                    <span className="notif-time">
                      {TYPE_ICONS[item.type]} {formatNotifTime(item.createdAt)}
                    </span>
                  </span>
                  {!item.isRead && <span className="notif-dot" aria-hidden="true" />}
                </button>
              ))
            )}
          </div>
          <div className="notif-panel-foot">
            <button
              type="button"
              className={`notif-push-toggle ${pushEnabled ? 'on' : ''}`}
              onClick={() => void handleTogglePush()}
              disabled={pushBusy}
              title={pushEnabled ? '关闭浏览器推送' : '开启浏览器推送（关注/评论/@提及/邀请时通知你）'}
            >
              {pushBusy ? '处理中...' : pushEnabled ? '🔔 浏览器推送已开启' : '🔕 开启浏览器推送'}
            </button>
            <span>{items.length} 条最近通知</span>
          </div>
        </div>
      )}
    </div>
  )
}
