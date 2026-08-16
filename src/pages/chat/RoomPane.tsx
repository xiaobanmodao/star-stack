import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ChatThread from '../../components/chat/ChatThread'
import { floatRoom } from '../../utils/floatRoom'
import type { ChatRoomDetail, ChatRoomResponse, ChatRoomMember, ChatStreamEvent, FollowUser, FriendsResponse } from '../../types'
import { fetchJson } from '../../utils'
import './ChatHub.css'

export default function RoomPane() {
  const navigate = useNavigate()
  const { id = '' } = useParams<{ id: string }>()
  const [room, setRoom] = useState<(ChatRoomDetail & { closed?: boolean }) | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showMembers, setShowMembers] = useState(false)
  const [inviteId, setInviteId] = useState('')
  const [inviteError, setInviteError] = useState('')
  const [confirmDisband, setConfirmDisband] = useState(false)
  const [friends, setFriends] = useState<FollowUser[]>([])
  const [inviteLink, setInviteLink] = useState('')
  const [inviteLinkCopied, setInviteLinkCopied] = useState(false)
  const roomRef = useRef<(ChatRoomDetail & { closed?: boolean }) | null>(null)
  roomRef.current = room

  // 房主可见：好友列表（快捷邀请）
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchJson<FriendsResponse>('/api/me/friends').then(({ response, data }) => {
        if (response.ok && data) setFriends(data.friends)
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const loadRoom = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { response, data } = await fetchJson<ChatRoomResponse>(`/api/chat/rooms/${id}`)
      if (!response.ok) {
        setRoom(null)
        setError(data?.message || '无法进入房间')
        return
      }
      if (data?.room) setRoom(data.room)
    } catch {
      setError('加载失败，请重试')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void loadRoom()
  }, [loadRoom])

  const handleStreamEvent = useCallback((event: ChatStreamEvent) => {
    if (event.type === 'members' && roomRef.current) {
      setRoom((prev) => (prev ? { ...prev, members: event.members, memberCount: event.members.length } : prev))
    } else if (event.type === 'closed') {
      setRoom((prev) => (prev ? { ...prev, closed: true } : prev))
    }
  }, [])

  const handleJoin = async () => {
    const { response } = await fetchJson(`/api/chat/rooms/${id}/join`, { method: 'POST' })
    if (response.ok) {
      void loadRoom()
      floatRoom(parseInt(id, 10))
    }
  }

  const handleLeave = async () => {
    const { response } = await fetchJson(`/api/chat/rooms/${id}/leave`, { method: 'POST' })
    if (response.ok) {
      void loadRoom()
      navigate('/chat/plaza')
    }
  }

  const handleDisband = async () => {
    const { response } = await fetchJson(`/api/chat/rooms/${id}`, { method: 'DELETE' })
    if (response.ok) navigate('/chat/plaza')
  }

  const handleInvite = async () => {
    const userId = inviteId.trim()
    if (!userId) return
    setInviteError('')
    const { response, data } = await fetchJson<{ message?: string; members?: ChatRoomMember[] }>(
      `/api/chat/rooms/${id}/members`,
      { method: 'POST', body: JSON.stringify({ userId }) }
    )
    if (response.ok && data?.members) {
      setRoom((prev) => (prev ? { ...prev, members: data.members!, memberCount: data.members!.length } : prev))
      setInviteId('')
    } else {
      setInviteError(data?.message || '邀请失败')
    }
  }

  const handleRemoveMember = async (userId: string) => {
    const { response, data } = await fetchJson<{ members?: ChatRoomMember[] }>(
      `/api/chat/rooms/${id}/members/${userId}`,
      { method: 'DELETE' }
    )
    if (response.ok && data?.members) {
      setRoom((prev) => (prev ? { ...prev, members: data.members!, memberCount: data.members!.length } : prev))
    }
  }

  const handleCreateInviteLink = async () => {
    const { response, data } = await fetchJson<{ token?: string; message?: string }>(
      `/api/chat/rooms/${id}/invite-link`,
      { method: 'POST', body: JSON.stringify({ expiresInHours: 24, maxUses: 10 }) }
    )
    if (response.ok && data?.token) {
      setInviteLink(`${window.location.origin}/chat/join/${data.token}`)
    } else {
      setInviteError(data?.message || '生成失败')
    }
  }

  const handleCopyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink)
      setInviteLinkCopied(true)
      window.setTimeout(() => setInviteLinkCopied(false), 1500)
    } catch {
      // 忽略
    }
  }

  if (loading) {
    return <section className="chat-scope-pane"><div className="chat-loading">加载中...</div></section>
  }

  if (!room || error) {
    return (
      <section className="chat-scope-pane">
        <div className="chat-room-locked">
          <span className="chat-room-locked-icon">🔒</span>
          <h2>无法进入房间</h2>
          <p>{error || '房间不存在'}</p>
          <button type="button" className="primary" onClick={() => navigate('/chat/plaza')}>
            返回聊天中心
          </button>
        </div>
      </section>
    )
  }

  const isOwner = room.myRole === 'owner'
  const joined = room.myRole != null
  const canChat = room.type === 'public' || joined
  const showClosed = Boolean(room.closed)

  return (
    <section className="chat-scope-pane">
      <header className="chat-pane-header">
        <div className="chat-pane-title">
          <span className="chat-pane-icon" aria-hidden="true">{room.type === 'invite' ? '🔒' : '💬'}</span>
          <div>
            <h2>{room.name}</h2>
            <p>{room.description || (room.type === 'invite' ? '邀请制房间' : '公开房间')}</p>
          </div>
        </div>
        <div className="chat-pane-actions">
          <button
            type="button"
            className="ghost small"
            onClick={() => floatRoom(room.id)}
            title="弹出浮窗，随时聊天"
          >
            ⧉ 浮窗
          </button>
          <button
            type="button"
            className="ghost small"
            onClick={() => setShowMembers((prev) => !prev)}
          >
            成员 {room.memberCount}
          </button>
          {!joined && room.type === 'public' && (
            <button type="button" className="primary small" onClick={() => void handleJoin()}>
              加入房间
            </button>
          )}
          {joined && !isOwner && (
            <button type="button" className="ghost small" onClick={() => void handleLeave()}>
              离开
            </button>
          )}
          {isOwner && (
            <>
              <button type="button" className="ghost small" onClick={() => setConfirmDisband(true)}>
                解散
              </button>
              {confirmDisband && (
                <span className="chat-disband-confirm">
                  确定解散？
                  <button type="button" className="primary small" onClick={() => void handleDisband()}>确认</button>
                  <button type="button" className="ghost small" onClick={() => setConfirmDisband(false)}>取消</button>
                </span>
              )}
            </>
          )}
        </div>
      </header>

      {showMembers && (
        <aside className="chat-members-panel">
          <div className="chat-members-head">成员 · {room.memberCount}</div>
          {isOwner && (
            <>
              <div className="chat-invite-row">
                <input
                  type="text"
                  value={inviteId}
                  onChange={(event) => setInviteId(event.target.value)}
                  placeholder="输入用户 ID 邀请加入"
                  onKeyDown={(event) => event.key === 'Enter' && void handleInvite()}
                />
                <button type="button" className="primary small" onClick={() => void handleInvite()}>
                  邀请
                </button>
              </div>
              <div className="chat-invite-link-row">
                {inviteLink ? (
                  <>
                    <input type="text" readOnly value={inviteLink} onFocus={(event) => event.target.select()} />
                    <button type="button" className="primary small" onClick={() => void handleCopyInviteLink()}>
                      {inviteLinkCopied ? '已复制 ✓' : '复制'}
                    </button>
                  </>
                ) : (
                  <button type="button" className="ghost small" onClick={() => void handleCreateInviteLink()}>
                    🔗 生成邀请链接（24 小时 · 10 次）
                  </button>
                )}
              </div>
              {friends.length > 0 && (
                <div className="chat-invite-friends">
                  <span>好友：</span>
                  {friends.filter((friend) => !room?.members.some((m) => m.userId === friend.id)).slice(0, 12).map((friend) => (
                    <button
                      key={friend.id}
                      type="button"
                      className="chat-invite-friend"
                      title={`邀请 ${friend.name}`}
                      onClick={() => {
                        void fetchJson<{ members?: ChatRoomMember[] }>(`/api/chat/rooms/${id}/members`, {
                          method: 'POST',
                          body: JSON.stringify({ userId: friend.id }),
                        }).then(({ response, data }) => {
                          if (response.ok && data?.members) {
                            setRoom((prev) => (prev ? { ...prev, members: data.members!, memberCount: data.members!.length } : prev))
                          }
                        })
                      }}
                    >
                      {friend.avatar ? (
                        <img src={friend.avatar} alt="" loading="lazy" />
                      ) : (
                        <span>{friend.name.charAt(0).toUpperCase()}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {inviteError && <div className="chat-invite-error">{inviteError}</div>}
          <ul className="chat-members-list">
            {room.members.map((member) => (
              <li key={member.userId} className={`chat-member ${member.role === 'owner' ? 'owner' : ''}`}>
                <span className={`chat-presence-dot ${member.online ? 'online' : ''}`} aria-label={member.online ? '在线' : '离线'} />
                <button type="button" className="chat-member-profile" onClick={() => navigate(`/user/${member.userId}`)}>
                  <span className="chat-member-avatar">
                    {member.userAvatar ? (
                      <img src={member.userAvatar} alt="" loading="lazy" />
                    ) : (
                      <span>{member.userName.charAt(0).toUpperCase()}</span>
                    )}
                  </span>
                  <span className="chat-member-name">
                    {member.userName}
                    <em>@{member.userId}</em>
                  </span>
                </button>
                {member.role === 'owner' && <span className="chat-member-role">房主</span>}
                {isOwner && member.role !== 'owner' && (
                  <button type="button" className="chat-member-remove" onClick={() => void handleRemoveMember(member.userId)} title="移除成员">
                    移除
                  </button>
                )}
              </li>
            ))}
          </ul>
        </aside>
      )}

      {showClosed ? (
        <div className="chat-room-locked">
          <span className="chat-room-locked-icon">🚪</span>
          <h2>房间已解散</h2>
          <button type="button" className="primary" onClick={() => navigate('/chat/plaza')}>
            返回聊天中心
          </button>
        </div>
      ) : (
        <ChatThread
          key={`room:${id}`}
          scopeType="room"
          scopeId={id}
          disabledReason={canChat ? null : '这是邀请制房间，需要房主邀请才能发言'}
          onStreamEvent={handleStreamEvent}
        />
      )}
    </section>
  )
}
