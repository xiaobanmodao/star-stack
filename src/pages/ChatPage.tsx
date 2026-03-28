import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAppContext } from '../context/AppContext'
import RichTextEditor from '../components/RichTextEditor'
import { fetchJson, isPollingPageVisible } from '../utils'
import type { Message, MessagesResponse } from '../types'

type ChatSendResponse = {
  message?: Message
  error?: string
}

type ChatTimelineItem =
  | { type: 'date'; label: string; key: string }
  | { type: 'msg'; message: Message; key: string }

export default function ChatPage() {
  const navigate = useNavigate()
  const { currentUser, fetchUnreadCount } = useAppContext()
  const { userId: otherUserId } = useParams<{ userId: string }>()
  const [messages, setMessages] = useState<Message[]>([])
  const [otherUser, setOtherUser] = useState<{ id: string; name: string; avatar?: string; isBanned: boolean } | null>(null)
  const [messageContent, setMessageContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const pageSize = 30

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

  // Poll for new messages (paused when tab is hidden)
  useEffect(() => {
    if (!otherUserId) return
    let polling = false
    const poll = async () => {
      if (!isPollingPageVisible() || polling) return
      polling = true
      try {
        const { response, data } = await fetchJson<MessagesResponse>(
          `/api/messages/conversations/${otherUserId}?page=1&pageSize=${pageSize}`
        )
        if (response.ok && data) {
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
    }
  }, [otherUserId, fetchUnreadCount])

  useEffect(() => {
    if (page === 1) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
    }
  }, [messages, page])

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
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
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
  }, [messageContent, otherUser, otherUserId, sending])

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
    return <div className="loading-state">加载中...</div>
  }

  if (!otherUser) {
    return <div className="empty-state">用户不存在</div>
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

  return (
    <section className="chat-page">
      <div className="chat-header">
        <button className="back-button" onClick={() => navigate('/messages')}>
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="chat-header-user">
          <div className="chat-avatar">
            {otherUser.avatar ? (
              <img src={otherUser.avatar} alt={otherUser.name} loading="lazy" />
            ) : (
              <span>{otherUser.name.charAt(0).toUpperCase()}</span>
            )}
          </div>
          <span className="chat-user-name">{otherUser.name}</span>
        </div>
      </div>

      <div className="chat-messages">
        {hasMore && (
          <button className="load-more-button" onClick={handleLoadMore} disabled={loading}>
            {loading ? '加载中...' : '加载更多'}
          </button>
        )}
        {messagesWithDates.map((item) => {
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
                  <div className="message-text" dangerouslySetInnerHTML={{ __html: message.content }} />
                </div>
                <div className="message-meta">
                  <span className="message-time">{formatTime(message.createdAt)}</span>
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
        })}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        <RichTextEditor
          value={messageContent}
          onChange={setMessageContent}
          placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
        />
        <button
          className="send-button primary"
          onClick={handleSendMessage}
          disabled={sending || !messageContent.trim() || otherUser.isBanned}
        >
          {sending ? '发送中...' : '发送'}
        </button>
      </div>

      {deleteTarget !== null && (
        <div className="confirm-backdrop" role="dialog" aria-modal="true" onClick={() => setDeleteTarget(null)}>
          <div className="confirm-panel" onClick={e => e.stopPropagation()}>
            <div className="confirm-title">撤回消息</div>
            <div className="confirm-desc">确定要撤回这条消息吗？2 分钟内发送的消息将对双方删除。</div>
            <div className="confirm-actions">
              <button className="ghost" type="button" onClick={() => setDeleteTarget(null)}>取消</button>
              <button className="primary" type="button" onClick={confirmDeleteMessage}>确认撤回</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

// === Discussion List Page ===
