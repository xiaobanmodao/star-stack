import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Conversation, ConversationsResponse } from '../types'
import { fetchJson, isPollingPageVisible } from '../utils'

export default function MessageListPage() {
  const navigate = useNavigate()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewChat, setShowNewChat] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ id: string; name: string; avatar?: string }[]>([])
  const [searching, setSearching] = useState(false)

  const loadConversations = useCallback(async () => {
    try {
      const { response, data } = await fetchJson<ConversationsResponse>('/api/messages/conversations')
      if (response.ok && data) {
        setConversations(data.conversations || [])
      }
    } catch (error) {
      console.error('Failed to load conversations:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    void loadConversations()
  }, [loadConversations])

  useEffect(() => {
    const interval = setInterval(() => {
      if (!isPollingPageVisible()) return
      void loadConversations()
    }, 15000)
    const handleVisibilityChange = () => {
      if (!isPollingPageVisible()) return
      void loadConversations()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [loadConversations])

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      return
    }
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const { response, data } = await fetchJson<{ users: { id: string; name: string; avatar?: string }[] }>(
          `/api/users/search?q=${encodeURIComponent(searchQuery.trim())}`
        )
        if (response.ok && data) {
          setSearchResults(data.users || [])
        }
      } catch {
        // ignore
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const formatTime = (isoString: string) => {
    const date = new Date(isoString)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (minutes < 1) return '刚刚'
    if (minutes < 60) return `${minutes} 分钟前`
    if (hours < 24) return `${hours} 小时前`
    if (days < 7) return `${days} 天前`
    return date.toLocaleDateString('zh-CN')
  }

  const stripHtml = (html: string) => {
    const div = document.createElement('div')
    div.innerHTML = html
    return div.textContent || div.innerText || ''
  }

  return (
    <section className="message-list-page">
      <div className="message-list-header">
        <h1>私信</h1>
        <button className="primary new-chat-btn" onClick={() => { setShowNewChat(true); setSearchQuery(''); setSearchResults([]) }}>
          <svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 5v14M5 12h14" /></svg>
          发起聊天
        </button>
      </div>

      {loading ? (
        <div className="loading-state">加载中...</div>
      ) : conversations.length === 0 ? (
        <div className="empty-state">
          <svg viewBox="0 0 24 24" width="48" height="48" className="empty-icon">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
          </svg>
          <p>还没有聊天记录。</p>
          <p className="empty-hint">点击右上角发起聊天，搜索用户后即可开始对话。</p>
        </div>
      ) : (
        <div className="conversation-list">
          {conversations.map((conversation) => (
            <div
              key={conversation.conversationId}
              className="conversation-card"
              onClick={() => navigate(`/messages/${conversation.otherUser.id}`)}
            >
              <div className="conversation-avatar">
                {conversation.otherUser.avatar ? (
                  <img src={conversation.otherUser.avatar} alt={conversation.otherUser.name} loading="lazy" />
                ) : (
                  <span>{conversation.otherUser.name.charAt(0).toUpperCase()}</span>
                )}
              </div>
              <div className="conversation-content">
                <div className="conversation-header">
                  <span className="conversation-name">{conversation.otherUser.name}</span>
                  <span className="conversation-time">{formatTime(conversation.lastMessageAt)}</span>
                </div>
                {conversation.lastMessage && (
                  <div className="conversation-preview">
                    {stripHtml(conversation.lastMessage.content).substring(0, 50)}
                    {stripHtml(conversation.lastMessage.content).length > 50 ? '...' : ''}
                  </div>
                )}
              </div>
              {conversation.unreadCount > 0 && (
                <div className="conversation-unread">{conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {showNewChat && (
        <div className="confirm-backdrop" role="dialog" aria-modal="true" onClick={() => setShowNewChat(false)}>
          <div className="confirm-panel new-chat-modal" onClick={(event) => event.stopPropagation()}>
            <div className="confirm-title">发起聊天</div>
            <input
              className="new-chat-search"
              type="text"
              placeholder="搜索用户名或 ID"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              autoFocus
            />
            <div className="new-chat-results">
              {searching ? (
                <div className="new-chat-hint">搜索中...</div>
              ) : searchQuery.trim() && searchResults.length === 0 ? (
                <div className="new-chat-hint">没有找到匹配的用户。</div>
              ) : (
                searchResults.map((user) => (
                  <div key={user.id} className="new-chat-user" onClick={() => { setShowNewChat(false); navigate(`/messages/${user.id}`) }}>
                    <div className="conversation-avatar" style={{ width: 36, height: 36, fontSize: 16 }}>
                      {user.avatar ? <img src={user.avatar} alt={user.name} loading="lazy" /> : <span>{user.name.charAt(0).toUpperCase()}</span>}
                    </div>
                    <div>
                      <div className="new-chat-user-name">{user.name}</div>
                      <div className="new-chat-user-id">{user.id}</div>
                    </div>
                  </div>
                ))
              )}
              {!searchQuery.trim() && <div className="new-chat-hint">输入用户名或 ID 开始搜索。</div>}
            </div>
            <div className="confirm-actions">
              <button className="ghost" type="button" onClick={() => setShowNewChat(false)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
