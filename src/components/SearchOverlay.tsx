import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { OJ_ENABLED } from '../constants'
import type { DiscussionListResponse, OjProblemSummary } from '../types'
import { fetchJson } from '../utils'
import { useModalFocus } from '../hooks/useModalFocus'
import './SearchOverlay.css'

type SearchResults = {
  problems: OjProblemSummary[]
  posts: DiscussionListResponse['posts']
  users: { id: string; name: string; avatar?: string }[]
  messages: {
    id: number
    channelKey?: string | null
    roomId?: number | null
    roomName?: string | null
    senderId: string
    senderName: string
    senderAvatar?: string | null
    content: string
    createdAt: string
  }[]
}

const EMPTY_RESULTS: SearchResults = { problems: [], posts: [], users: [], messages: [] }

const formatSearchTime = (iso: string) => {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour} 小时前`
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 30) return `${diffDay} 天前`
  return date.toLocaleDateString('zh-CN')
}

const stripHtml = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

export default function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS)
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<number | null>(null)
  const requestAbortRef = useRef<AbortController | null>(null)
  const dialogRef = useModalFocus(open, onClose)

  useEffect(() => {
    if (open) {
      setQuery('')
      setResults(EMPTY_RESULTS)
      window.setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  useEffect(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    requestAbortRef.current?.abort()
    const q = query.trim()
    if (!q) {
      setResults(EMPTY_RESULTS)
      setSearching(false)
      return
    }
    setSearching(true)
    const controller = new AbortController()
    requestAbortRef.current = controller
    timerRef.current = window.setTimeout(async () => {
      try {
        const [problemsRes, postsRes, usersRes, messagesRes] = await Promise.all([
          OJ_ENABLED
            ? fetchJson<{ problems: OjProblemSummary[] }>(`/api/oj/problems?search=${encodeURIComponent(q)}&pageSize=5`, { signal: controller.signal })
            : Promise.resolve({ response: { ok: false } as Response, data: null }),
          fetchJson<DiscussionListResponse>(`/api/discussions?search=${encodeURIComponent(q)}&pageSize=5`, { signal: controller.signal }),
          fetchJson<{ users: { id: string; name: string; avatar?: string }[] }>(`/api/users/search?q=${encodeURIComponent(q)}`, { signal: controller.signal }),
          fetchJson<{ messages: SearchResults['messages'] }>(`/api/chat/search?q=${encodeURIComponent(q)}&limit=5`, { signal: controller.signal }),
        ])
        if (controller.signal.aborted) return
        setResults({
          problems: problemsRes.response.ok && problemsRes.data ? problemsRes.data.problems : [],
          posts: postsRes.response.ok && postsRes.data ? postsRes.data.posts : [],
          users: usersRes.response.ok && usersRes.data ? usersRes.data.users : [],
          messages: messagesRes.response.ok && messagesRes.data ? messagesRes.data.messages : [],
        })
      } catch {
        if (!controller.signal.aborted) setResults(EMPTY_RESULTS)
      } finally {
        if (!controller.signal.aborted) setSearching(false)
      }
    }, 300)
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      controller.abort()
      if (requestAbortRef.current === controller) requestAbortRef.current = null
    }
  }, [query])

  useEffect(() => {
    if (!open) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  const go = (path: string) => {
    onClose()
    navigate(path)
  }

  const total = results.problems.length + results.posts.length + results.users.length + results.messages.length

  return (
    <div className="search-backdrop" role="dialog" aria-modal="true" aria-labelledby="search-dialog-title" onClick={onClose}>
      <div ref={dialogRef} className="search-panel" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <h2 id="search-dialog-title" className="sr-only">全局搜索</h2>
        <div className="search-input-row">
          <span className="search-icon" aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索题目、帖子、用户、聊天消息…（Ctrl+K 随时唤起）"
          />
          <button type="button" className="search-close" onClick={onClose} title="关闭 (Esc)">
            Esc
          </button>
        </div>

        <div className="search-results">
          {!query.trim() ? (
            <div className="search-hint">输入关键词开始搜索，覆盖题目 / 帖子 / 用户 / 聊天消息</div>
          ) : searching ? (
            <div className="search-hint">搜索中...</div>
          ) : total === 0 ? (
            <div className="search-hint">没有找到与「{query.trim()}」相关的内容</div>
          ) : (
            <>
              {OJ_ENABLED && results.problems.length > 0 && (
                <div className="search-group">
                  <div className="search-group-title">题目</div>
                  {results.problems.map((problem) => (
                    <button key={problem.id} type="button" className="search-item" onClick={() => go(`/oj/p${problem.id}`)}>
                      <span className="search-item-title">P{problem.id} {problem.title}</span>
                      <span className="search-item-meta">{problem.difficulty} · {problem.passRate}%</span>
                    </button>
                  ))}
                </div>
              )}
              {results.posts.length > 0 && (
                <div className="search-group">
                  <div className="search-group-title">帖子</div>
                  {results.posts.map((post) => (
                    <button key={post.id} type="button" className="search-item" onClick={() => go(`/chat/p/${post.id}`)}>
                      <span className="search-item-title">{post.title}</span>
                      <span className="search-item-meta">
                        {post.userName} · 💬 {post.commentCount} · {formatSearchTime(post.createdAt)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {results.users.length > 0 && (
                <div className="search-group">
                  <div className="search-group-title">用户</div>
                  {results.users.map((user) => (
                    <button key={user.id} type="button" className="search-item" onClick={() => go(`/user/${user.id}`)}>
                      <span className="search-item-avatar">
                        {user.avatar ? <img src={user.avatar} alt="" loading="lazy" /> : <span>{user.name.charAt(0).toUpperCase()}</span>}
                      </span>
                      <span className="search-item-title">{user.name}</span>
                      <span className="search-item-meta">@{user.id}</span>
                    </button>
                  ))}
                </div>
              )}
              {results.messages.length > 0 && (
                <div className="search-group">
                  <div className="search-group-title">聊天消息</div>
                  {results.messages.map((message) => (
                    <button
                      key={message.id}
                      type="button"
                      className="search-item"
                      onClick={() => go(message.channelKey ? `/chat/c/${message.channelKey}` : `/chat/room/${message.roomId}`)}
                    >
                      <span className="search-item-title">{stripHtml(message.content).slice(0, 50) || '（图片/表情）'}</span>
                      <span className="search-item-meta">
                        {message.channelKey ? `#${message.channelKey}` : message.roomName || '聊天室'} · {message.senderName} · {formatSearchTime(message.createdAt)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
