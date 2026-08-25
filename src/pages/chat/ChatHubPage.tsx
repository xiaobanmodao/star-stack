import { useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { LayoutGrid, Mail, MessageCircle, Trophy, Users } from 'lucide-react'
import { fetchJson } from '../../utils'
import type {
  ChatChannel, ChatChannelsResponse, ChatRoomsResponse, ConversationsResponse,
} from '../../types'
import './ChatHub.css'

function UnreadDot({ count }: { count: number }) {
  if (!count) return null
  return <span className="chat-nav-unread">{count > 99 ? '99+' : count}</span>
}

export default function ChatHubPage() {
  const [channels, setChannels] = useState<ChatChannel[]>([])
  const [roomsUnread, setRoomsUnread] = useState(0)
  const [dmUnread, setDmUnread] = useState(0)
  const heartbeatTimerRef = useRef<number | null>(null)
  const loadAbortRef = useRef<AbortController | null>(null)
  const heartbeatAbortRef = useRef<AbortController | null>(null)

  const loadAll = useCallback(async () => {
    loadAbortRef.current?.abort()
    const controller = new AbortController()
    loadAbortRef.current = controller
    try {
      const [{ response: channelRes, data: channelData }, { response: roomRes, data: roomData }, { response: conversationRes, data: conversationData }] = await Promise.all([
        fetchJson<ChatChannelsResponse>('/api/chat/channels', { signal: controller.signal }),
        fetchJson<ChatRoomsResponse>('/api/chat/rooms', { signal: controller.signal }),
        fetchJson<ConversationsResponse>('/api/messages/conversations', { signal: controller.signal }),
      ])
      if (controller.signal.aborted) return
      if (channelRes.ok && channelData) setChannels(channelData.channels)
      if (roomRes.ok && roomData) {
        setRoomsUnread(roomData.unreadCount ?? roomData.rooms.reduce((sum, room) => sum + room.unread, 0))
      }
      if (conversationRes.ok && conversationData) {
        setDmUnread(conversationData.unreadCount ?? conversationData.conversations.reduce((sum, conversation) => sum + conversation.unreadCount, 0))
      }
    } catch {
      // 忽略
    } finally {
      if (loadAbortRef.current === controller) loadAbortRef.current = null
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
      loadAbortRef.current?.abort()
    }
  }, [loadAll])

  // 在线心跳：30 秒
  useEffect(() => {
    const beat = async () => {
      heartbeatAbortRef.current?.abort()
      const controller = new AbortController()
      heartbeatAbortRef.current = controller
      try {
        await fetchJson('/api/chat/presence', { method: 'POST', signal: controller.signal })
      } catch {
        // 忽略
      } finally {
        if (heartbeatAbortRef.current === controller) heartbeatAbortRef.current = null
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
      heartbeatAbortRef.current?.abort()
    }
  }, [])

  const plazaUnread = channels.reduce((sum, channel) => sum + channel.unread, 0)
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
