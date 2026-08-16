import { useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { LayoutGrid, Mail, MessageCircle, Trophy, Users } from 'lucide-react'
import { fetchJson } from '../../utils'
import type {
  ChatChannel, ChatChannelsResponse, ChatRoom, ChatRoomsResponse,
  Conversation, ConversationsResponse,
} from '../../types'
import './ChatHub.css'

function UnreadDot({ count }: { count: number }) {
  if (!count) return null
  return <span className="chat-nav-unread">{count > 99 ? '99+' : count}</span>
}

export default function ChatHubPage() {
  const [channels, setChannels] = useState<ChatChannel[]>([])
  const [rooms, setRooms] = useState<ChatRoom[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const heartbeatTimerRef = useRef<number | null>(null)

  const loadAll = useCallback(async () => {
    const [{ response: channelRes, data: channelData }, { response: roomRes, data: roomData }] = await Promise.all([
      fetchJson<ChatChannelsResponse>('/api/chat/channels'),
      fetchJson<ChatRoomsResponse>('/api/chat/rooms'),
    ])
    if (channelRes.ok && channelData) setChannels(channelData.channels)
    if (roomRes.ok && roomData) setRooms(roomData.rooms)
    try {
      const { response, data } = await fetchJson<ConversationsResponse>('/api/messages/conversations')
      if (response.ok && data) setConversations(data.conversations)
    } catch {
      // 忽略
    }
  }, [])

  // 初始加载 + 15 秒轮询未读
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAll()
    }, 0)
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadAll()
    }, 15000)
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(interval)
    }
  }, [loadAll])

  // 在线心跳：30 秒
  useEffect(() => {
    const beat = async () => {
      try {
        await fetchJson('/api/chat/presence', { method: 'POST' })
      } catch {
        // 忽略
      }
    }
    const timer = window.setTimeout(() => {
      void beat()
    }, 0)
    heartbeatTimerRef.current = window.setInterval(() => {
      if (document.visibilityState === 'visible') void beat()
    }, 30000)
    return () => {
      window.clearTimeout(timer)
      if (heartbeatTimerRef.current !== null) window.clearInterval(heartbeatTimerRef.current)
    }
  }, [])

  const plazaUnread = channels.reduce((sum, channel) => sum + channel.unread, 0)
  const roomsUnread = rooms.reduce((sum, room) => sum + room.unread, 0)
  const dmUnread = conversations.reduce((sum, conversation) => sum + conversation.unreadCount, 0)

  return (
    <div className="chat-hub">
      <nav className="chat-topnav" aria-label="聊天导航">
        <NavLink to="/chat/plaza" className={({ isActive }) => `chat-nav-item ${isActive ? 'active' : ''}`}>
          <LayoutGrid size={15} aria-hidden="true" />
          公共广场
          <UnreadDot count={plazaUnread} />
        </NavLink>
        <span className="chat-nav-sep" aria-hidden="true" />
        {channels.map((channel) => (
          <NavLink
            key={channel.key}
            to={`/chat/c/${channel.key}`}
            className={({ isActive }) => `chat-nav-item ${isActive ? 'active' : ''}`}
          >
            <span aria-hidden="true">{channel.icon || '#'}</span>
            {channel.name}
            <UnreadDot count={channel.unread} />
          </NavLink>
        ))}
        <span className="chat-nav-sep" aria-hidden="true" />
        <NavLink to="/chat/friends" className={({ isActive }) => `chat-nav-item ${isActive ? 'active' : ''}`}>
          <Users size={15} aria-hidden="true" />
          好友
        </NavLink>
        <NavLink to="/chat/rooms" className={({ isActive }) => `chat-nav-item ${isActive ? 'active' : ''}`}>
          <MessageCircle size={15} aria-hidden="true" />
          聊天室
          <UnreadDot count={roomsUnread} />
        </NavLink>
        <NavLink to="/chat/dm" className={({ isActive }) => `chat-nav-item ${isActive ? 'active' : ''}`}>
          <Mail size={15} aria-hidden="true" />
          私信
          <UnreadDot count={dmUnread} />
        </NavLink>
        <NavLink to="/chat/activity" className={({ isActive }) => `chat-nav-item ${isActive ? 'active' : ''}`}>
          <Trophy size={15} aria-hidden="true" />
          活跃榜
        </NavLink>
      </nav>

      <div className="chat-pane">
        <Outlet />
      </div>
    </div>
  )
}
