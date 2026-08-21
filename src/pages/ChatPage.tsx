import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAppContext } from '../context/AppContext'
import { Badge, Button, EmptyState, LoadingState, PageHeader, Panel } from '../components/ui'
import RichTextEditor from '../components/RichTextEditor'
import { fetchJson, isPollingPageVisible } from '../utils'
import { renderRichText } from '../utils/richText'
import { useModalFocus } from '../hooks/useModalFocus'
import type { FollowRelations, Message, MessagesResponse, UserProfileResponse } from '../types'
import './OpsPages.css'
import './ChatPage.css'

type ChatSendResponse = {
  message?: Message
  error?: string
}

type ChatTimelineItem =
  | { type: 'date'; label: string; key: string }
  | { type: 'msg'; message: Message; key: string }

export default function ChatPage({ basePath = '/messages' }: { basePath?: string }) {
  const navigate = useNavigate()
  const { currentUser, fetchUnreadCount } = useAppContext()
  const { userId: otherUserId } = useParams<{ userId: string }>()
  const [messages, setMessages] = useState<Message[]>([])
  const [otherUser, setOtherUser] = useState<{ id: string; name: string; avatar?: string; isBanned: boolean } | null>(null)
  const [relations, setRelations] = useState<FollowRelations | null>(null)
  const [blockHint, setBlockHint] = useState<string | null>(null)
  const [messageContent, setMessageContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null)
  const deleteDialogRef = useModalFocus(deleteTarget !== null, () => setDeleteTarget(null))
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const pollAbortRef = useRef<AbortController | null>(null)
  const pageSize = 30

  const scrollMessagesToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const container = messagesContainerRef.current
    if (!container) return
    container.scrollTo({ top: container.scrollHeight, behavior })
  }, [])

  const loadMessages = useCallback(async (pageNum: number) => {
    if (!otherUserId) return
    setLoading(true)
    try {
      const { response, data } = await fetchJson<MessagesResponse>(
        `/api/messages/conversations/${otherUserId}?page=${pageNum}&pageSize=${pageSize}`
      )
      if (response.ok && data) {
        if (pageNum === 1) {
          setMessages(data.messages || [])
        } else {
          setMessages((prev) => [...(data.messages || []), ...prev])
        }
        setOtherUser(data.otherUser)
        setHasMore(data.pagination.page < data.pagination.totalPages)
        // Backend marks messages as read on fetch, refresh topbar badge
        fetchUnreadCount()
      }
    } catch (error) {
      console.error('Failed to load messages:', error)
    } finally {
      setLoading(false)
    }
  }, [otherUserId, fetchUnreadCount])

  useEffect(() => {
    loadMessages(1)
  }, [loadMessages])

  // 加载与对方的关注关系（好友状态 + 屏蔽状态）
  useEffect(() => {
    if (!otherUserId) return
    const timer = window.setTimeout(() => {
      void fetchJson<UserProfileResponse>(`/api/users/${otherUserId}/profile`).then(({ response, data }) => {
        if (response.ok && data) {
          setRelations(data.relations)
          setBlockHint(data.blocked ? '你已屏蔽对方，无法发送消息' : null)
        } else if (response.status === 403) {
          setBlockHint(data?.message || '对方已屏蔽你，无法发送消息')
        }
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [otherUserId])

  const handleToggleFollow = async () => {
    if (!otherUserId || !relations) return
    const { response, data } = await fetchJson<{ relations?: FollowRelations }>(
      `/api/users/${otherUserId}/follow`,
      { method: relations.following ? 'DELETE' : 'POST' }
    )
    if (response.ok && data?.relations) setRelations(data.relations)
  }

  // Poll for new messages (paused when tab is hidden)
  useEffect(() => {
    if (!otherUserId) return
    let polling = false
    const poll = async () => {
      if (!isPollingPageVisible() || polling) return
      polling = true
      pollAbortRef.current?.abort()
      const controller = new AbortController()
      pollAbortRef.current = controller
      try {
        const { response, data } = await fetchJson<MessagesResponse>(
          `/api/messages/conversations/${otherUserId}?page=1&pageSize=${pageSize}`,
          { signal: controller.signal },
        )
        if (!controller.signal.aborted && response.ok && data) {
          setMessages(prev => {
            const newMsgs = data.messages || []
            if (newMsgs.length === 0) return prev
            const lastOldId = prev.length > 0 ? prev[prev.length - 1].id : 0
            const lastNewId = newMsgs[newMsgs.length - 1].id
            if (lastNewId > lastOldId) {
              const newOnly = newMsgs.filter(m => m.id > lastOldId)
              return [...prev, ...newOnly]
            }
            return prev
          })
          // Backend marks as read on fetch, refresh topbar badge
          fetchUnreadCount()
        }
      } catch {
        // Silently ignore polling errors
      } finally {
        polling = false
        if (pollAbortRef.current === controller) pollAbortRef.current = null
      }
    }
    const interval = setInterval(poll, 7000)
    const handleVisibilityChange = () => {
      if (!isPollingPageVisible()) return
      void poll()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleVisibilityChange)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleVisibilityChange)
      pollAbortRef.current?.abort()
    }
  }, [otherUserId, fetchUnreadCount])

  useEffect(() => {
    if (page === 1) {
      scrollMessagesToBottom('auto')
    }
  }, [messages, page, scrollMessagesToBottom])

  const handleSendMessage = useCallback(async () => {
    if (!messageContent.trim() || sending || !otherUserId) return
    if (otherUser?.isBanned) {
      alert('无法向被封禁用户发送消息')
      return
    }

    setSending(true)
    try {
      const { response, data } = await fetchJson<ChatSendResponse>(`/api/messages/conversations/${otherUserId}`, {
        method: 'POST',
        body: JSON.stringify({ content: messageContent }),
      })

      if (response.ok && data?.message) {
        const sentMessage = data.message
        setMessages((prev) => [...prev, sentMessage])
        setMessageContent('')
        setTimeout(() => {
          scrollMessagesToBottom('smooth')
        }, 100)
      } else {
        alert(data?.error || '发送失败')
      }
    } catch (error) {
      console.error('Failed to send message:', error)
      alert('发送失败')
    } finally {
      setSending(false)
    }
  }, [messageContent, otherUser, otherUserId, scrollMessagesToBottom, sending])

  const confirmDeleteMessage = async () => {
    if (deleteTarget === null) return
    try {
      const { response } = await fetchJson(`/api/messages/${deleteTarget}`, { method: 'DELETE' })
      if (response.ok) {
        setMessages((prev) => prev.filter((m) => m.id !== deleteTarget))
      }
    } catch (error) {
      console.error('Failed to delete message:', error)
    }
    setDeleteTarget(null)
  }

  const handleLoadMore = () => {
    if (!hasMore || loading) return
    setPage((prev) => prev + 1)
    loadMessages(page + 1)
  }

  const formatTime = (isoString: string) => {
    const date = new Date(isoString)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()

    if (isToday) {
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }
    return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  const getDateLabel = (isoString: string) => {
    const date = new Date(isoString)
    const now = new Date()
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)

    if (date.toDateString() === now.toDateString()) return '今天'
    if (date.toDateString() === yesterday.toDateString()) return '昨天'
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
  }

  const canDelete = (message: Message) => {
    const messageTime = new Date(message.createdAt).getTime()
    const now = Date.now()
    const twoMinutes = 2 * 60 * 1000
    return message.senderId === currentUser?.id && (now - messageTime <= twoMinutes)
  }

  // Handle Enter key to send in chat input
  const handleChatKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      const el = (e.target as HTMLElement)
      if (el.classList.contains('rich-editor-content') || el.closest('.chat-input-area')) {
        e.preventDefault()
        handleSendMessage()
      }
    }
  }, [handleSendMessage])

  useEffect(() => {
    const inputArea = document.querySelector('.chat-input-area')
    if (!inputArea) return
    const handler = (e: Event) => handleChatKeyDown(e as KeyboardEvent)
    inputArea.addEventListener('keydown', handler)
    return () => inputArea.removeEventListener('keydown', handler)
  }, [handleChatKeyDown])

  if (loading && page === 1) {
    return (
      <section className="ops-page-v2 chat-workspace-v2">
        <Panel>
          <LoadingState variant="list" label="正在加载会话…" />
        </Panel>
      </section>
    )
  }

  if (!otherUser) {
    return (
      <section className="ops-page-v2 chat-workspace-v2">
        <Panel>
          <EmptyState title="用户不存在" description="请返回私信列表重新选择会话。" />
        </Panel>
      </section>
    )
  }

  // Build messages with date separators
  let lastDateLabel = ''
  const messagesWithDates: ChatTimelineItem[] = []
  for (const msg of messages) {
    const label = getDateLabel(msg.createdAt)
    if (label !== lastDateLabel) {
      messagesWithDates.push({ type: 'date', label, key: `date-${msg.id}` })
      lastDateLabel = label
    }
    messagesWithDates.push({ type: 'msg', message: msg, key: `msg-${msg.id}` })
  }

  const ownMessageCount = messages.filter((message) => message.senderId === currentUser?.id).length
  const otherMessageCount = messages.length - ownMessageCount
  const lastMessage = messages[messages.length - 1]

  return (
    <section className="chat-page ops-page-v2 chat-workspace-v2">
      <PageHeader
        kicker="Direct Channel"
        title={`与 ${otherUser.name} 的私信`}
        description="对话内容会自动轮询刷新；Enter 发送，Shift+Enter 换行。"
        actions={
          <Button variant="ghost" onClick={() => navigate(basePath)}>
            返回私信
          </Button>
        }
      />

      <div className="chat-workspace-grid">
        <Panel className="chat-profile-card">
          <button
            type="button"
            className="chat-header-user"
            onClick={() => navigate(`/user/${otherUser.id}`)}
            title="查看个人主页"
          >
            <div className="chat-avatar">
              {otherUser.avatar ? (
                <img src={otherUser.avatar} alt={otherUser.name} loading="lazy" />
              ) : (
                <span>{otherUser.name.charAt(0).toUpperCase()}</span>
              )}
            </div>
            <div>
              <span className="chat-user-name">{otherUser.name}</span>
              <span className="chat-user-id">@{otherUser.id}</span>
            </div>
          </button>
          <div className="chat-profile-status">
            <Badge tone={otherUser.isBanned ? 'danger' : 'success'}>
              {otherUser.isBanned ? '已封禁' : '可发送'}
            </Badge>
            {relations && !relations.isFriend && (
              <Badge tone={relations.following ? 'neutral' : 'info'}>
                {relations.following ? '已关注' : '未关注'}
              </Badge>
            )}
            {relations?.isFriend && <Badge tone="success">好友</Badge>}
            <span>7 秒自动检查新消息</span>
          </div>
          {relations && !otherUser.isBanned && (
            <Button
              variant={relations.following ? 'ghost' : 'primary'}
              size="sm"
              onClick={() => void handleToggleFollow()}
            >
              {relations.following ? (relations.isFriend ? '互相关注' : '取消关注') : '关注'}
            </Button>
          )}
          <div className="chat-profile-metrics">
            <div>
              <strong>{messages.length}</strong>
              <span>总消息</span>
            </div>
            <div>
              <strong>{ownMessageCount}</strong>
              <span>我发送</span>
            </div>
            <div>
              <strong>{otherMessageCount}</strong>
              <span>对方发送</span>
            </div>
          </div>
          <p>
            最近消息：{lastMessage ? formatTime(lastMessage.createdAt) : '暂无'}
          </p>
        </Panel>

        <div className="chat-main-column">
          <Panel className="chat-timeline-panel">
            <div className="ops-panel-head">
              <div>
                <Badge tone="info">Timeline</Badge>
                <h2>消息时间线</h2>
              </div>
              <span>{hasMore ? '上方可加载更早消息' : '已显示当前会话消息'}</span>
            </div>

            <div className="chat-messages" ref={messagesContainerRef}>
              {hasMore && (
                <Button variant="secondary" size="sm" className="load-more-button" onClick={handleLoadMore} disabled={loading}>
                  加载更多
                </Button>
              )}
              {messagesWithDates.length === 0 ? (
                <EmptyState title="还没有消息" description="从下方输入框发送第一条消息，建立这条通信链路。" />
              ) : (
                messagesWithDates.map((item) => {
                  if (item.type === 'date') {
                    return (
                      <div key={item.key} className="chat-date-separator">
                        <span>{item.label}</span>
                      </div>
                    )
                  }
                  const message = item.message
                  return (
                    <div
                      key={message.id}
                      className={`chat-message ${message.senderId === currentUser?.id ? 'own' : 'other'}`}
                    >
                      <div className="message-avatar">
                        {message.senderAvatar ? (
                          <img src={message.senderAvatar} alt={message.senderName} loading="lazy" />
                        ) : (
                          <span>{(message.senderName || '?').charAt(0).toUpperCase()}</span>
                        )}
                      </div>
                      <div className="message-content-wrap">
                        <div className="message-bubble">
                          <div className="message-text" dangerouslySetInnerHTML={{ __html: renderRichText(message.content) }} />
                        </div>
                        <div className="message-meta">
                          <span className="message-time">{formatTime(message.createdAt)}</span>
                          {message.senderId === currentUser?.id && (
                            <span className={`message-read-state ${message.isRead ? 'read' : ''}`}>
                              {message.isRead ? '已读' : '未读'}
                            </span>
                          )}
                          {canDelete(message) && (
                            <button
                              className="message-delete"
                              onClick={() => setDeleteTarget(message.id)}
                              title="删除消息"
                            >
                              撤回
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* 输入区：与消息列表同一面板（聊天框风格） */}
            <div className="chat-input-area">
              {blockHint ? (
                <div className="chat-block-hint">{blockHint}</div>
              ) : (
                <>
                  <RichTextEditor
                    value={messageContent}
                    onChange={setMessageContent}
                    placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
                  />
                  <Button
                    className="send-button"
                    variant="primary"
                    onClick={handleSendMessage}
                    loading={sending}
                    disabled={!messageContent.trim() || otherUser.isBanned}
                  >
                    {sending ? '发送中...' : '发送'}
                  </Button>
                </>
              )}
              {otherUser.isBanned && (
                <div className="form-error">无法向被封禁用户发送消息。</div>
              )}
            </div>
          </Panel>
        </div>
      </div>

      {deleteTarget !== null && (
        <div className="confirm-backdrop" role="dialog" aria-modal="true" aria-labelledby="delete-message-dialog-title" onClick={() => setDeleteTarget(null)}>
          <div ref={deleteDialogRef} className="confirm-panel" tabIndex={-1} onClick={e => e.stopPropagation()}>
            <div id="delete-message-dialog-title" className="confirm-title">撤回消息</div>
            <div className="confirm-desc">确定要撤回这条消息吗？2 分钟内发送的消息将对双方删除。</div>
            <div className="confirm-actions">
              <Button variant="ghost" type="button" onClick={() => setDeleteTarget(null)}>取消</Button>
              <Button variant="primary" type="button" onClick={confirmDeleteMessage}>确认撤回</Button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

// === Discussion List Page ===
