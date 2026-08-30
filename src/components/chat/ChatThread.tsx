import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppContext } from '../../context/AppContext'
import { fetchJson } from '../../utils'
import { subscribeChatStream } from '../../utils/chat'
import type { ChatMessage, ChatMessageListResponse, ChatStreamEvent } from '../../types'
import MessageItem from './MessageItem'
import { EmptyState, LoadingState } from '../ui'
import '../../pages/chat/ChatHub.css' // 聊天线程样式：全局可用（浮窗在非聊天页也需加载）
import { PRESET_EMOJIS } from './chatMeta'
import DecoratedAvatar from '../profile/DecoratedAvatar'

type MentionUser = {
  id: string
  name: string
  avatar?: string | null
  avatarFrame?: import('../../types').AvatarFrameId
  avatarOverlay?: import('../../types').AvatarOverlayId
}

export default function ChatThread({
  scopeType,
  scopeId,
  disabledReason,
  onStreamEvent,
}: {
  scopeType: 'channel' | 'room'
  scopeId: string
  /** 非空时输入框禁用（如未加入邀请制房间） */
  disabledReason?: string | null
  /** 透传流事件给父组件（如房间成员列表更新） */
  onStreamEvent?: (event: ChatStreamEvent) => void
}) {
  const { currentUser } = useAppContext()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [content, setContent] = useState('')
  const [showEmojiBar, setShowEmojiBar] = useState(false)
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({})
  const typingTimersRef = useRef<Map<string, number>>(new Map())
  const typingLastSentRef = useRef(0)
  const [threadOpenId, setThreadOpenId] = useState<number | null>(null)
  const [threadReplies, setThreadReplies] = useState<Record<number, ChatMessage[]>>({})
  const [threadLoading, setThreadLoading] = useState<Record<number, boolean>>({})
  const containerRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const onStreamEventRef = useRef(onStreamEvent)
  onStreamEventRef.current = onStreamEvent

  const scopePath = scopeType === 'channel' ? `channels/${scopeId}` : `rooms/${scopeId}`
  const scopeKey = `${scopeType}:${scopeId}`

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const container = containerRef.current
    if (!container) return
    container.scrollTo({ top: container.scrollHeight, behavior })
  }, [])

  const markRead = useCallback(async () => {
    const token = localStorage.getItem('starstack_token')
    if (!token) return
    try {
      await fetch('/api/chat/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ scopeType, scopeId }),
      })
    } catch {
      // 忽略
    }
  }, [scopeType, scopeId])

  const markReadRef = useRef(markRead)
  markReadRef.current = markRead
  const markReadDebounced = useRef<number | null>(null)
  const threadOpenIdRef = useRef<number | null>(null)
  threadOpenIdRef.current = threadOpenId

  // 断线重连后补拉最新消息（按 id 合并去重），避免错过断线期间的消息
  const refreshLatest = useCallback(async () => {
    const { response, data } = await fetchJson<ChatMessageListResponse>(
      `/api/chat/${scopePath}/messages?limit=50`
    )
    if (response.ok && data) {
      setMessages((prev) => {
        const map = new Map(prev.map((m) => [m.id, m]))
        for (const m of data.messages || []) if (!map.has(m.id)) map.set(m.id, m)
        return Array.from(map.values()).sort((a, b) => a.id - b.id)
      })
    }
  }, [scopePath])

  const loadHistory = useCallback(async (before?: number) => {
    setLoading(true)
    try {
      const query = before ? `?before=${before}&limit=50` : '?limit=50'
      const { response, data } = await fetchJson<ChatMessageListResponse>(
        `/api/chat/${scopePath}/messages${query}`
      )
      if (response.ok && data) {
        if (before) {
          setMessages((prev) => [...(data.messages || []), ...prev])
        } else {
          setMessages(data.messages || [])
        }
        setHasMore(data.hasMore)
        if (!before) {
          window.requestAnimationFrame(() => scrollToBottom())
        }
      }
    } catch {
      // 忽略
    } finally {
      setLoading(false)
    }
  }, [scopePath, scrollToBottom])

  useEffect(() => {
    setMessages([])
    setHasMore(false)
    void loadHistory()
    void markRead()

    const unsubscribe = subscribeChatStream(scopePath, (event) => {
      if (event.type === 'connected') {
        // 重连后补拉（仅当已有历史消息时）
        setMessages((prev) => {
          if (prev.length > 0) void refreshLatest()
          return prev
        })
      } else if (event.type === 'message') {
        setMessages((prev) => (prev.some((m) => m.id === event.message.id) ? prev : [...prev, event.message]))
        window.requestAnimationFrame(() => scrollToBottom())
        // 防抖标记已读
        if (markReadDebounced.current !== null) window.clearTimeout(markReadDebounced.current)
        markReadDebounced.current = window.setTimeout(() => markReadRef.current(), 800)
      } else if (event.type === 'reaction') {
        setMessages((prev) =>
          prev.map((m) => (m.id === event.messageId ? { ...m, reactions: event.reactions } : m))
        )
        // 同步更新打开中的线程回复
        setThreadReplies((prev) => {
          let changed = false
          const next: Record<number, ChatMessage[]> = {}
          for (const [key, list] of Object.entries(prev)) {
            const updated = list.map((m) => (m.id === event.messageId ? { ...m, reactions: event.reactions } : m))
            if (updated.some((m, index) => m !== list[index])) changed = true
            next[Number(key)] = updated
          }
          return changed ? next : prev
        })
      } else if (event.type === 'message_deleted') {
        setMessages((prev) => prev.filter((m) => m.id !== event.messageId))
        setThreadReplies((prev) => {
          const next: Record<number, ChatMessage[]> = {}
          for (const [key, list] of Object.entries(prev)) {
            next[Number(key)] = list.filter((m) => m.id !== event.messageId)
          }
          return next
        })
      } else if (event.type === 'closed') {
        setMessages((prev) => prev)
      } else if (event.type === 'typing') {
        if (event.userId === currentUser?.id) return
        // 3.5 秒后自动消失
        const existing = typingTimersRef.current.get(event.userId)
        if (existing !== undefined) window.clearTimeout(existing)
        const timer = window.setTimeout(() => {
          setTypingUsers((prev) => {
            const next = { ...prev }
            delete next[event.userId]
            return next
          })
          typingTimersRef.current.delete(event.userId)
        }, 3500)
        typingTimersRef.current.set(event.userId, timer)
        setTypingUsers((prev) => ({ ...prev, [event.userId]: event.userName }))
      } else if (event.type === 'thread_reply') {
        const parentId = event.message.threadParentId
        if (!parentId) return
        const reply = event.message
        if (threadOpenIdRef.current === parentId) {
          // 面板开着：按 id 去重后追加（本端发送也会收到自己的广播）
          setThreadReplies((prev) => {
            const list = prev[parentId] || []
            if (list.some((m) => m.id === reply.id)) return prev
            return { ...prev, [parentId]: [...list, reply] }
          })
        } else {
          // 面板未开：递增计数（本端已加过的同样会收到广播，需检查）
          setThreadReplies((prev) => {
            if (prev[parentId]?.some((m) => m.id === reply.id)) return prev
            setMessages((msgs) =>
              msgs.map((m) => (m.id === parentId ? { ...m, threadReplyCount: m.threadReplyCount + 1 } : m))
            )
            return prev
          })
        }
      }
      onStreamEventRef.current?.(event)
    })

    return () => {
      unsubscribe()
      if (markReadDebounced.current !== null) window.clearTimeout(markReadDebounced.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey])

  const handleSend = async () => {
    const text = content.trim()
    if (!text || sending || disabledReason) return
    setSending(true)
    try {
      const { response, data } = await fetchJson<{ message?: ChatMessage }>(
        `/api/chat/${scopePath}/messages`,
        { method: 'POST', body: JSON.stringify({ content: text }) }
      )
      if (response.ok && data?.message) {
        setMessages((prev) => (prev.some((m) => m.id === data.message!.id) ? prev : [...prev, data.message!]))
        setContent('')
        window.requestAnimationFrame(() => scrollToBottom())
      }
    } catch {
      // 忽略
    } finally {
      setSending(false)
    }
  }

  // ---------- 话题线程 ----------

  const toggleThread = (messageId: number) => {
    if (threadOpenId === messageId) {
      setThreadOpenId(null)
      return
    }
    setThreadOpenId(messageId)
    if (!threadReplies[messageId]) {
      setThreadLoading((prev) => ({ ...prev, [messageId]: true }))
      void fetchJson<{ replies?: ChatMessage[] }>(`/api/chat/messages/${messageId}/replies`).then(({ response, data }) => {
        setThreadLoading((prev) => ({ ...prev, [messageId]: false }))
        if (response.ok && data?.replies) {
          setThreadReplies((prev) => ({ ...prev, [messageId]: data.replies! }))
        }
      })
    }
  }

  const sendThreadReply = async (parentId: number, replyContent: string) => {
    const { response, data } = await fetchJson<{ reply?: ChatMessage }>(
      `/api/chat/messages/${parentId}/replies`,
      { method: 'POST', body: JSON.stringify({ content: replyContent }) }
    )
    if (response.ok && data?.reply) {
      const reply = data.reply
      // 本端发送成功后 SSE 会广播同一条回复回来，按 id 去重避免重复
      setThreadReplies((prev) => {
        const list = prev[parentId] || []
        if (list.some((m) => m.id === reply!.id)) return prev
        return { ...prev, [parentId]: [...list, reply!] }
      })
      setMessages((prev) =>
        prev.map((m) =>
          m.id === parentId && !(prev.some(() => false))
            ? { ...m, threadReplyCount: m.threadReplyCount + 1 }
            : m
        )
      )
      window.requestAnimationFrame(() => scrollToBottom())
    }
  }

  const toggleReplyReaction = (replyId: number, emoji: string) => {
    void fetchJson(`/api/chat/messages/${replyId}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    })
  }

  const insertCodeFence = () => {
    const snippet = '```cpp\n// 在这里粘贴代码\n```'
    setContent((prev) => (prev ? `${prev}\n${snippet}` : snippet))
  }

  const insertEmoji = (emoji: string) => {
    setContent((prev) => (prev ? `${prev} ${emoji}` : emoji))
  }

  // ---------- @ 提及自动补全 ----------
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null)
  const [mentionResults, setMentionResults] = useState<MentionUser[]>([])
  const [mentionIndex, setMentionIndex] = useState(0)
  const mentionTimerRef = useRef<number | null>(null)
  const mentionAbortRef = useRef<AbortController | null>(null)

  const updateMention = (value: string, cursor: number) => {
    mentionAbortRef.current?.abort()
    const before = value.slice(0, cursor)
    const at = before.lastIndexOf('@')
    if (at < 0) {
      setMention(null)
      return
    }
    const prefix = before.slice(0, at)
    if (prefix && !/\s$/.test(prefix)) {
      setMention(null)
      return
    }
    const query = before.slice(at + 1)
    if (!/^[a-zA-Z0-9_-]{0,32}$/.test(query)) {
      setMention(null)
      return
    }
    setMention({ query, start: at })
    if (mentionTimerRef.current !== null) window.clearTimeout(mentionTimerRef.current)
    mentionTimerRef.current = window.setTimeout(() => {
      const controller = new AbortController()
      mentionAbortRef.current = controller
      if (query) {
        void fetchJson<{ users: MentionUser[] }>(
          `/api/users/search?q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        ).then(({ response, data }) => {
          if (!controller.signal.aborted && response.ok && data) {
            setMentionResults(data.users)
            setMentionIndex(0)
          }
        })
      } else {
        // 未输入关键字时展示好友
        void fetchJson<{ friends: MentionUser[] }>('/api/me/friends', { signal: controller.signal }).then(({ response, data }) => {
          if (!controller.signal.aborted && response.ok && data) {
            setMentionResults(data.friends)
            setMentionIndex(0)
          }
        })
      }
    }, 150)
  }

  // 输入中指示器：防抖发送 typing 事件（1.2 秒最多一次）
  const broadcastTyping = () => {
    if (disabledReason) return
    const now = Date.now()
    if (now - typingLastSentRef.current < 1200) return
    typingLastSentRef.current = now
    void fetchJson('/api/chat/typing', {
      method: 'POST',
      body: JSON.stringify({ scopeType, scopeId }),
    })
  }

  const applyMention = (user: { id: string; name: string }) => {
    if (!mention) return
    const next = content.slice(0, mention.start) + `@${user.id} ` + content.slice(mention.start + 1 + mention.query.length)
    setContent(next)
    setMention(null)
    setMentionResults([])
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus()
    })
  }

  useEffect(() => {
    return () => {
      if (mentionTimerRef.current !== null) window.clearTimeout(mentionTimerRef.current)
      mentionAbortRef.current?.abort()
    }
  }, [])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && mentionResults.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setMentionIndex((prev) => (prev + 1) % mentionResults.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setMentionIndex((prev) => (prev - 1 + mentionResults.length) % mentionResults.length)
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        applyMention(mentionResults[mentionIndex])
        return
      }
      if (event.key === 'Escape') {
        setMention(null)
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void handleSend()
    }
  }

  return (
    <div className="chat-thread">
      <div className="chat-messages" ref={containerRef}>
        {loading && messages.length === 0 ? (
          <LoadingState variant="list" label="正在加载消息…" />
        ) : messages.length === 0 ? (
          <EmptyState title="还没有消息" description="来说点什么吧 ✨" />
        ) : (
          <>
            {hasMore && (
              <button type="button" className="chat-load-more" onClick={() => void loadHistory(messages[0].id)}>
                加载更早的消息
              </button>
            )}
            {messages.map((message) => (
              <MessageItem
                key={message.id}
                message={message}
                mine={message.senderId === currentUser?.id}
                onToggleReaction={(emoji) => {
                  void fetchJson(`/api/chat/messages/${message.id}/reactions`, {
                    method: 'POST',
                    body: JSON.stringify({ emoji }),
                  })
                }}
                threadOpen={threadOpenId === message.id}
                threadReplies={threadReplies[message.id]}
                threadLoading={Boolean(threadLoading[message.id])}
                onToggleThread={() => toggleThread(message.id)}
                onSendReply={(replyContent) => void sendThreadReply(message.id, replyContent)}
                onToggleReplyReaction={toggleReplyReaction}
              />
            ))}
          </>
        )}
        {Object.keys(typingUsers).length > 0 && (
          <div className="chat-typing-indicator" aria-live="polite">
            <span className="chat-typing-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {Object.values(typingUsers).slice(0, 2).join('、')}
            {Object.keys(typingUsers).length > 2 ? ` 等 ${Object.keys(typingUsers).length} 人` : ''} 正在输入…
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="chat-composer">
        {disabledReason ? (
          <div className="chat-composer-disabled">{disabledReason}</div>
        ) : (
          <>
            <div className="chat-composer-toolbar">
              <button type="button" className="chat-tool-btn" onClick={insertCodeFence} title="插入代码块">
                {'</>'}
              </button>
              <button
                type="button"
                className={`chat-tool-btn ${showEmojiBar ? 'active' : ''}`}
                onClick={() => setShowEmojiBar((prev) => !prev)}
                title="表情"
              >
                🙂
              </button>
              {showEmojiBar && (
                <div className="chat-emoji-bar composer">
                  {PRESET_EMOJIS.map((emoji) => (
                    <button key={emoji} type="button" onClick={() => insertEmoji(emoji)}>
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="chat-composer-input-row">
              <div className="chat-composer-input-wrap">
                {mention && mentionResults.length > 0 && (
                  <div className="chat-mention-dropdown">
                    <div className="chat-mention-hint">@ 提及用户</div>
                    {mentionResults.map((user, index) => (
                      <button
                        key={user.id}
                        type="button"
                        className={`chat-mention-item ${index === mentionIndex ? 'active' : ''}`}
                        onMouseDown={(event) => {
                          event.preventDefault()
                          applyMention(user)
                        }}
                        onMouseEnter={() => setMentionIndex(index)}
                      >
                          <DecoratedAvatar
                            avatar={user.avatar}
                            fallback={user.name.charAt(0).toUpperCase()}
                            frame={user.avatarFrame}
                            overlay={user.avatarOverlay}
                            size="discussion-small"
                            alt=""
                            className="chat-mention-avatar"
                          />
                        <span className="chat-mention-info">
                          <strong>{user.name}</strong>
                          <em>@{user.id}</em>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <textarea
                  ref={textareaRef}
                  className="chat-composer-input"
                  value={content}
                  onChange={(event) => {
                    setContent(event.target.value)
                    updateMention(event.target.value, event.target.selectionStart)
                    broadcastTyping()
                  }}
                  onKeyDown={handleKeyDown}
                  onBlur={() => {
                    window.setTimeout(() => {
                      setMention(null)
                      setMentionResults([])
                    }, 200)
                  }}
                  placeholder="输入消息，Enter 发送，Shift+Enter 换行；@ 提及用户；``` 开头可粘贴代码块"
                  rows={2}
                />
              </div>
              <button
                type="button"
                className="chat-send-btn"
                onClick={() => void handleSend()}
                disabled={!content.trim() || sending}
              >
                {sending ? '发送中' : '发送'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
