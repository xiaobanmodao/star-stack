import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Button, EmptyState, ErrorState, LoadingState, PageHeader, Panel } from '../components/ui'
import DecoratedAvatar from '../components/profile/DecoratedAvatar'
import type { Conversation, ConversationsResponse } from '../types'
import { ApiRequestError, fetchJson, htmlToPlainText, isPollingPageVisible } from '../utils'
import { useModalFocus } from '../hooks/useModalFocus'
import './OpsPages.css'
import './ChatPage.css'

export default function MessageListPage({ basePath = '/messages' }: { basePath?: string }) {
  const navigate = useNavigate()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewChat, setShowNewChat] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ id: string; name: string; avatar?: string; avatarFrame?: Conversation['otherUser']['avatarFrame']; avatarOverlay?: Conversation['otherUser']['avatarOverlay']; displayTitle?: string; displayTitleIcon?: string }[]>([])
  const [searching, setSearching] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [unreadTotal, setUnreadTotal] = useState(0)
  const [pagination, setPagination] = useState<ConversationsResponse['pagination']>()
  const pageRef = useRef(1)
  const hasConversationDataRef = useRef(false)
  const conversationControllerRef = useRef<AbortController | null>(null)
  const searchControllerRef = useRef<AbortController | null>(null)
  const newChatDialogRef = useModalFocus(showNewChat, () => setShowNewChat(false))

  const loadConversations = useCallback(async (requestedPage = pageRef.current) => {
    conversationControllerRef.current?.abort()
    const controller = new AbortController()
    conversationControllerRef.current = controller
    pageRef.current = requestedPage
    try {
      const { response, data } = await fetchJson<ConversationsResponse>(
        `/api/messages/conversations?page=${requestedPage}&pageSize=30`,
        { signal: controller.signal },
      )
      if (response.ok && data) {
        setConversations(data.conversations || [])
        setPagination(data.pagination)
        setUnreadTotal(data.unreadCount ?? data.conversations.reduce((total, conversation) => total + conversation.unreadCount, 0))
        hasConversationDataRef.current = true
        setLoadError('')
      } else {
        if (!hasConversationDataRef.current) setLoadError('会话列表加载失败，请重试。')
      }
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'ABORTED') return
      if (!hasConversationDataRef.current) setLoadError('网络异常，会话列表暂时不可用。')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    void loadConversations(1)
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
      conversationControllerRef.current?.abort()
    }
  }, [loadConversations])

  useEffect(() => {
    searchControllerRef.current?.abort()
    if (!searchQuery.trim()) {
      setSearchResults([])
      return
    }
    const timer = setTimeout(async () => {
      searchControllerRef.current?.abort()
      const controller = new AbortController()
      searchControllerRef.current = controller
      setSearching(true)
      try {
        const { response, data } = await fetchJson<{ users: typeof searchResults }>(
          `/api/users/search?q=${encodeURIComponent(searchQuery.trim())}`,
          { signal: controller.signal },
        )
        if (response.ok && data) {
          setSearchResults(data.users || [])
        }
      } catch (error) {
        if (!(error instanceof ApiRequestError && error.code === 'ABORTED')) {
          setSearchResults([])
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false)
      }
    }, 300)
    return () => {
      clearTimeout(timer)
      searchControllerRef.current?.abort()
    }
  }, [searchQuery])

  useEffect(() => {
    if (!showNewChat) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowNewChat(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showNewChat])

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

  const latestConversation = conversations[0]

  return (
    <section className="message-list-page ops-page-v2 messages-v2">
      <PageHeader
        kicker="Message Relay"
        title="私信"
        description="把题解讨论之外的一对一沟通收进同一个轻量收件箱，未读和最近会话一眼可见。"
        actions={
          <Button variant="primary" onClick={() => { setShowNewChat(true); setSearchQuery(''); setSearchResults([]) }}>
            发起聊天
          </Button>
        }
      />

      <div className="ops-summary-grid message-summary-grid">
        <Panel>
          <span>会话数</span>
          <strong>{pagination?.total ?? conversations.length}</strong>
        </Panel>
        <Panel>
          <span>未读消息</span>
          <strong>{unreadTotal}</strong>
        </Panel>
        <Panel>
          <span>最近会话</span>
          <strong>{latestConversation ? latestConversation.otherUser.name : '--'}</strong>
        </Panel>
      </div>

      {loading ? (
        <Panel>
          <LoadingState variant="list" label="正在加载会话…" />
        </Panel>
      ) : loadError ? (
        <ErrorState description={loadError} onRetry={() => { setLoading(true); void loadConversations() }} />
      ) : conversations.length === 0 ? (
        <Panel>
          <EmptyState
            title="还没有聊天记录"
            description="点击右上角发起聊天，搜索用户后即可开始对话。"
          />
        </Panel>
      ) : (
        <Panel className="message-inbox-panel">
          <div className="ops-panel-head">
            <div>
              <Badge tone="info">Inbox</Badge>
              <h2>会话列表</h2>
            </div>
            <span>每 15 秒自动刷新一次未读状态</span>
          </div>
          <div className="conversation-list">
            {conversations.map((conversation) => (
              <div
                key={conversation.conversationId}
                className={`conversation-card ${conversation.unreadCount > 0 ? 'unread' : ''}`}
              >
                <button
                  type="button"
                  className="conversation-avatar conversation-avatar-link"
                  title="查看个人主页"
                  aria-label={`查看 ${conversation.otherUser.name} 的个人主页`}
                  onClick={() => navigate(`/user/${conversation.otherUser.id}`)}
                >
                  <DecoratedAvatar
                    avatar={conversation.otherUser.avatar}
                    fallback={conversation.otherUser.name.charAt(0).toUpperCase()}
                    frame={conversation.otherUser.avatarFrame}
                    overlay={conversation.otherUser.avatarOverlay}
                    size="conversation"
                    alt={conversation.otherUser.name}
                    loading="lazy"
                  />
                </button>
                <button
                  type="button"
                  className="conversation-card-main"
                  aria-label={`打开与 ${conversation.otherUser.name} 的聊天`}
                  onClick={() => navigate(`${basePath}/${conversation.otherUser.id}`)}
                >
                  <span className="conversation-content">
                    <span className="conversation-header">
                      <strong className="conversation-name">{conversation.otherUser.name}</strong>
                      {conversation.otherUser.displayTitle && (
                        <span className="conversation-user-title">{conversation.otherUser.displayTitleIcon || '✦'} {conversation.otherUser.displayTitle}</span>
                      )}
                      <span className="conversation-time">{formatTime(conversation.lastMessageAt)}</span>
                    </span>
                    {conversation.lastMessage ? (
                      <span className="conversation-preview">
                        {htmlToPlainText(conversation.lastMessage.content).substring(0, 70)}
                        {htmlToPlainText(conversation.lastMessage.content).length > 70 ? '...' : ''}
                      </span>
                    ) : (
                      <span className="conversation-preview">暂无消息内容</span>
                    )}
                  </span>
                </button>
                {conversation.unreadCount > 0 && (
                  <span className="conversation-unread">{conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}</span>
                )}
              </div>
            ))}
          </div>
          {pagination && pagination.totalPages > 1 && (
            <div className="pagination" aria-label="私信分页">
              <button
                type="button"
                className="pagination-btn"
                disabled={pagination.page <= 1 || loading}
                onClick={() => { setLoading(true); void loadConversations(pagination.page - 1) }}
              >上一页</button>
              <span aria-live="polite">第 {pagination.page} / {pagination.totalPages} 页</span>
              <button
                type="button"
                className="pagination-btn"
                disabled={pagination.page >= pagination.totalPages || loading}
                onClick={() => { setLoading(true); void loadConversations(pagination.page + 1) }}
              >下一页</button>
            </div>
          )}
        </Panel>
      )}

      {showNewChat && (
        <div className="confirm-backdrop" role="dialog" aria-modal="true" aria-labelledby="new-chat-dialog-title" onClick={() => setShowNewChat(false)}>
          <div ref={newChatDialogRef} className="confirm-panel new-chat-modal" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
            <div id="new-chat-dialog-title" className="confirm-title">发起聊天</div>
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
                  <button key={user.id} type="button" className="new-chat-user" onClick={() => { setShowNewChat(false); navigate(`${basePath}/${user.id}`) }}>
                    <DecoratedAvatar
                      avatar={user.avatar}
                      fallback={user.name.charAt(0).toUpperCase()}
                      frame={user.avatarFrame}
                      overlay={user.avatarOverlay}
                      size="discussion"
                      alt={user.name}
                      loading="lazy"
                    />
                    <div>
                      <div className="new-chat-user-name">{user.name}</div>
                      {user.displayTitle && <div className="new-chat-user-title">{user.displayTitleIcon || '✦'} {user.displayTitle}</div>}
                      <div className="new-chat-user-id">{user.id}</div>
                    </div>
                  </button>
                ))
              )}
              {!searchQuery.trim() && <div className="new-chat-hint">输入用户名或 ID 开始搜索。</div>}
            </div>
            <div className="confirm-actions">
              <Button variant="ghost" type="button" onClick={() => setShowNewChat(false)}>取消</Button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
