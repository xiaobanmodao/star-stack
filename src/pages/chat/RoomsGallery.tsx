import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchJson } from '../../utils'
import { floatRoom } from '../../utils/floatRoom'
import { MessageCircle } from 'lucide-react'
import type { ChatRoom, ChatRoomsResponse } from '../../types'
import CreateRoomModal from './CreateRoomModal'
import './ChatHub.css'

const formatRoomTime = (iso: string) => {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDay = Math.floor(diffMs / 86400000)
  if (diffDay < 1) return '今天'
  if (diffDay < 7) return `${diffDay} 天前`
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

export default function RoomsGallery() {
  const navigate = useNavigate()
  const [rooms, setRooms] = useState<ChatRoom[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  const loadRooms = useCallback(async () => {
    setLoading(true)
    try {
      const { response, data } = await fetchJson<ChatRoomsResponse>('/api/chat/rooms')
      if (response.ok && data) setRooms(data.rooms)
    } catch {
      // 忽略
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadRooms()
    }, 0)
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadRooms()
    }, 15000)
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(interval)
    }
  }, [loadRooms])

  const totalUnread = rooms.reduce((sum, room) => sum + room.unread, 0)

  return (
    <section className="chat-scope-pane rooms-gallery-pane">
      <header className="chat-pane-header">
        <div className="chat-pane-title">
          <span className="chat-pane-icon" aria-hidden="true">💬</span>
          <div>
            <h2>聊天室大厅</h2>
            <p>共 {rooms.length} 个房间{totalUnread > 0 ? ` · ${totalUnread} 条未读` : ''}</p>
          </div>
        </div>
        <div className="chat-pane-actions">
          <button type="button" className="primary small" onClick={() => setShowCreate(true)}>
            ＋ 创建聊天室
          </button>
        </div>
      </header>

      <div className="rooms-gallery">
        {loading ? (
          <div className="chat-loading">加载中...</div>
        ) : rooms.length === 0 ? (
          <div className="chat-empty">还没有聊天室，创建第一个吧 ✨</div>
        ) : (
          rooms.map((room) => (
            <button
              key={room.id}
              type="button"
              className="room-square-card"
              onClick={() => navigate(`/chat/room/${room.id}`)}
            >
              <span className={`room-square-badge ${room.type === 'invite' ? 'invite' : ''}`}>
                {room.type === 'invite' ? '🔒 邀请制' : '🔓 公开'}
              </span>
              {room.unread > 0 && <span className="room-square-unread">{room.unread > 99 ? '99+' : room.unread}</span>}
              <MessageCircle className="room-square-icon" size={34} aria-hidden="true" />
              <strong className="room-square-name">{room.name}</strong>
              <span className="room-square-desc">{room.description || (room.type === 'invite' ? '邀请制房间' : '公开房间')}</span>
              <span className="room-square-foot">
                <em>👥 {room.memberCount}</em>
                <em>{room.joined ? '已加入' : '未加入'}</em>
                <em>{formatRoomTime(room.createdAt)}</em>
              </span>
            </button>
          ))
        )}
      </div>

      {showCreate && (
        <CreateRoomModal
          onClose={() => setShowCreate(false)}
          onCreated={(roomId) => {
            setShowCreate(false)
            void loadRooms()
            floatRoom(roomId)
            navigate(`/chat/room/${roomId}`)
          }}
        />
      )}
    </section>
  )
}
