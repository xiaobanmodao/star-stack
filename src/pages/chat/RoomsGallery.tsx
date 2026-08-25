import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchJson } from '../../utils'
import { floatRoom } from '../../utils/floatRoom'
import { MessageCircle } from 'lucide-react'
import type { ChatRoom, ChatRoomsResponse } from '../../types'
import CreateRoomModal from './CreateRoomModal'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui'
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
  const [loadError, setLoadError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [pagination, setPagination] = useState<ChatRoomsResponse['pagination']>()
  const pageRef = useRef(1)
  const requestAbortRef = useRef<AbortController | null>(null)

  const loadRooms = useCallback(async (requestedPage = pageRef.current) => {
    requestAbortRef.current?.abort()
    const controller = new AbortController()
    requestAbortRef.current = controller
    pageRef.current = requestedPage
    setLoading(true)
    try {
      const { response, data } = await fetchJson<ChatRoomsResponse>(
        `/api/chat/rooms?page=${requestedPage}&pageSize=50`,
        { signal: controller.signal },
      )
      if (controller.signal.aborted) return
      if (response.ok && data) {
        setRooms(data.rooms)
        setPagination(data.pagination)
        setLoadError('')
      } else {
        setLoadError('聊天室列表加载失败，请重试。')
      }
    } catch {
      if (!controller.signal.aborted) setLoadError('网络异常，聊天室列表暂时不可用。')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
      if (requestAbortRef.current === controller) requestAbortRef.current = null
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
      requestAbortRef.current?.abort()
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
        {loading && rooms.length === 0 ? (
          <LoadingState variant="list" label="正在加载聊天室…" />
        ) : loadError && rooms.length === 0 ? (
          <ErrorState description={loadError} onRetry={() => void loadRooms(pageRef.current)} />
        ) : rooms.length === 0 ? (
          <EmptyState title="还没有聊天室" description="创建第一个聊天室吧 ✨" />
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

      {pagination && pagination.totalPages > 1 && (
        <div className="pagination" aria-label="聊天室分页">
          <button
            type="button"
            className="pagination-btn"
            disabled={pagination.page <= 1 || loading}
            onClick={() => void loadRooms(pagination.page - 1)}
          >上一页</button>
          <span aria-live="polite">第 {pagination.page} / {pagination.totalPages} 页</span>
          <button
            type="button"
            className="pagination-btn"
            disabled={pagination.page >= pagination.totalPages || loading}
            onClick={() => void loadRooms(pagination.page + 1)}
          >下一页</button>
        </div>
      )}

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
