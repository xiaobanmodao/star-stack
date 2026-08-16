import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppContext } from '../../context/AppContext'
import type { FollowListResponse, FollowUser, FriendsResponse } from '../../types'
import { fetchJson } from '../../utils'
import './ChatHub.css'

type Tab = 'friends' | 'following' | 'followers'

const TAB_LABELS: Record<Tab, string> = {
  friends: '好友',
  following: '关注中',
  followers: '粉丝',
}

export default function FriendsPane() {
  const navigate = useNavigate()
  const { currentUser } = useAppContext()
  const [tab, setTab] = useState<Tab>('friends')
  const [users, setUsers] = useState<FollowUser[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<FollowUser[]>([])
  const [searching, setSearching] = useState(false)

  const loadList = useCallback(async () => {
    setLoading(true)
    try {
      const path = tab === 'friends' ? '/api/me/friends' : tab === 'following' ? '/api/me/following' : '/api/me/followers'
      const { response, data } = await fetchJson<FriendsResponse | FollowListResponse>(path)
      if (response.ok && data) {
        const list = 'friends' in data ? data.friends : data.users
        setUsers(list || [])
      } else {
        setUsers([])
      }
    } catch {
      setUsers([])
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => {
    void loadList()
  }, [loadList])

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      return
    }
    setSearching(true)
    const timer = window.setTimeout(async () => {
      try {
        const { response, data } = await fetchJson<{ users: { id: string; name: string; avatar?: string }[] }>(
          `/api/users/search?q=${encodeURIComponent(searchQuery.trim())}`
        )
        if (response.ok && data) {
          setSearchResults(data.users.map((u) => ({ ...u, online: false, isFriend: false })))
        }
      } catch {
        // 忽略
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchQuery])

  const handleToggleFollow = async (targetId: string) => {
    if (!currentUser) {
      navigate('/auth')
      return
    }
    // 关注/好友列表里 → 取消关注；粉丝列表里 → 关注对方
    const currentlyFollowing = tab === 'following' || tab === 'friends'
    const { response } = await fetchJson(
      `/api/users/${targetId}/follow`,
      { method: currentlyFollowing ? 'DELETE' : 'POST' }
    )
    if (response.ok) void loadList()
  }

  const renderUserRow = (user: FollowUser) => (
    <div key={user.id} className="friend-row">
      <button type="button" className="friend-row-main" onClick={() => navigate(`/user/${user.id}`)}>
        <span className="friend-avatar">
          {user.avatar ? <img src={user.avatar} alt="" loading="lazy" /> : <span>{user.name.charAt(0).toUpperCase()}</span>}
        </span>
        <span className="friend-info">
          <strong>
            {user.name}
            {user.isFriend && <em className="friend-badge">好友</em>}
          </strong>
          <span>@{user.id} · {user.online ? '在线' : '离线'}</span>
        </span>
      </button>
      <div className="friend-actions">
        <button type="button" className="ghost small" onClick={() => navigate(`/chat/dm/${user.id}`)}>
          私信
        </button>
        {tab === 'following' || tab === 'friends' ? (
          <button type="button" className="ghost small danger-text" onClick={() => void handleToggleFollow(user.id)}>
            取消关注
          </button>
        ) : (
          <button type="button" className="primary small" onClick={() => void handleToggleFollow(user.id)}>
            关注
          </button>
        )}
      </div>
    </div>
  )

  return (
    <section className="chat-scope-pane friends-pane">
      <header className="chat-pane-header">
        <div className="chat-pane-title">
          <span className="chat-pane-icon" aria-hidden="true">🤝</span>
          <div>
            <h2>好友</h2>
            <p>互相关注的好友、关注中的人和粉丝</p>
          </div>
        </div>
      </header>

      <div className="friends-toolbar">
        <div className="friends-tabs">
          {(['friends', 'following', 'followers'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              className={tab === t ? 'active' : ''}
              onClick={() => setTab(t)}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
        <div className="friends-search">
          <input
            type="text"
            placeholder="搜索用户 ID 或名称..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>
      </div>

      {searchQuery.trim() ? (
        <div className="friends-list">
          <div className="friends-list-title">搜索结果</div>
          {searching ? (
            <div className="chat-loading">搜索中...</div>
          ) : searchResults.length === 0 ? (
            <div className="chat-empty">没有找到匹配的用户</div>
          ) : (
            searchResults.map((user) => (
              <div key={user.id} className="friend-row">
                <button type="button" className="friend-row-main" onClick={() => navigate(`/user/${user.id}`)}>
                  <span className="friend-avatar">
                    {user.avatar ? <img src={user.avatar} alt="" loading="lazy" /> : <span>{user.name.charAt(0).toUpperCase()}</span>}
                  </span>
                  <span className="friend-info">
                    <strong>{user.name}</strong>
                    <span>@{user.id}</span>
                  </span>
                </button>
                <div className="friend-actions">
                  <button type="button" className="ghost small" onClick={() => navigate(`/chat/dm/${user.id}`)}>
                    私信
                  </button>
                  <button
                    type="button"
                    className="primary small"
                    onClick={() => {
                      void fetchJson(`/api/users/${user.id}/follow`, { method: 'POST' }).then(() => {
                        setSearchQuery('')
                        void loadList()
                      })
                    }}
                  >
                    关注
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="friends-list">
          {loading ? (
            <div className="chat-loading">加载中...</div>
          ) : users.length === 0 ? (
            <div className="chat-empty">
              {tab === 'friends'
                ? '还没有好友：互相关注后你们会成为好友'
                : tab === 'following'
                  ? '你还没有关注任何人'
                  : '还没有粉丝，去广场发帖让大家认识你吧'}
            </div>
          ) : (
            users.map(renderUserRow)
          )}
        </div>
      )}
    </section>
  )
}
