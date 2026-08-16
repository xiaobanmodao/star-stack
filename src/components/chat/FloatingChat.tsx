import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppContext } from '../../context/AppContext'
import { fetchJson } from '../../utils'
import { FLOAT_ROOM_EVENT } from '../../utils/floatRoom'
import { Lock, MessageCircle } from 'lucide-react'
import type { ChatRoomsResponse } from '../../types'
import ChatThread from './ChatThread'
import './FloatingChat.css'

const STORAGE_KEY = 'starstack_float_windows'
const WINDOW_WIDTH = 340
const WINDOW_HEIGHT = 460

type FloatWindow = {
  roomId: number
  minimized: boolean
  x: number
  y: number
}

const loadStored = (): FloatWindow[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export default function FloatingChat() {
  const navigate = useNavigate()
  const { currentUser } = useAppContext()
  const [windows, setWindows] = useState<FloatWindow[]>([])
  const [rooms, setRooms] = useState<ChatRoomsResponse['rooms']>([])
  const dragRef = useRef<{ id: number; dx: number; dy: number } | null>(null)
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const [confirmLeaveId, setConfirmLeaveId] = useState<number | null>(null)

  // 登录后恢复浮窗，登出清空
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!currentUser) {
        setWindows([])
        return
      }
      setWindows(loadStored())
    }, 0)
    return () => window.clearTimeout(timer)
  }, [currentUser])

  // 持久化浮窗状态
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(windows))
    } catch {
      // 忽略
    }
  }, [windows])

  // 轮询房间列表（未读数 + 校验房间是否还存在）
  useEffect(() => {
    if (!currentUser) return
    const load = () => {
      void fetchJson<ChatRoomsResponse>('/api/chat/rooms').then(({ response, data }) => {
        if (response.ok && data) setRooms(data.rooms)
      })
    }
    const timer = window.setTimeout(load, 0)
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, 15000)
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(interval)
    }
  }, [currentUser])

  // 监听"弹出浮窗"事件（加入/创建聊天室时触发）
  useEffect(() => {
    const handler = (event: Event) => {
      const roomId = (event as CustomEvent<{ roomId?: number }>).detail?.roomId
      if (!roomId) return
      setWindows((prev) => {
        if (prev.some((w) => w.roomId === roomId)) return prev
        const expandedCount = prev.filter((w) => !w.minimized).length
        return [
          ...prev,
          {
            roomId,
            minimized: true,
            x: Math.max(0, window.innerWidth - WINDOW_WIDTH - 16 - expandedCount * 28),
            y: Math.max(0, window.innerHeight - WINDOW_HEIGHT - 16 - expandedCount * 28),
          },
        ]
      })
    }
    window.addEventListener(FLOAT_ROOM_EVENT, handler)
    return () => window.removeEventListener(FLOAT_ROOM_EVENT, handler)
  }, [])

  // 已不存在的房间自动移除浮窗
  useEffect(() => {
    if (rooms.length === 0 || windows.length === 0) return
    const timer = window.setTimeout(() => {
      const validIds = new Set(rooms.map((r) => r.id))
      setWindows((prev) => {
        const next = prev.filter((w) => validIds.has(w.roomId))
        return next.length === prev.length ? prev : next
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [rooms, windows.length])

  if (!currentUser || windows.length === 0) return null

  const roomOf = (roomId: number) => rooms.find((r) => r.id === roomId)
  const unreadOf = (roomId: number) => roomOf(roomId)?.unread || 0

  const toggleWindow = (roomId: number) => {
    setWindows((prev) => prev.map((w) => (w.roomId === roomId ? { ...w, minimized: !w.minimized } : w)))
  }

  const closeWindow = (roomId: number) => {
    setWindows((prev) => prev.filter((w) => w.roomId !== roomId))
  }

  // 退出房间 / 解散房间（房主）
  const handleLeave = async (roomId: number, disband: boolean) => {
    const { response } = await fetchJson(
      disband ? `/api/chat/rooms/${roomId}` : `/api/chat/rooms/${roomId}/leave`,
      { method: disband ? 'DELETE' : 'POST' }
    )
    setConfirmLeaveId(null)
    if (response.ok) closeWindow(roomId)
  }

  const startDrag = (event: React.PointerEvent, roomId: number) => {
    // 标题栏内的按钮（最小化等）不启动拖拽，否则会吞掉点击
    if ((event.target as HTMLElement).closest('button')) return
    const win = windows.find((w) => w.roomId === roomId)
    if (!win) return
    dragRef.current = { id: roomId, dx: event.clientX - win.x, dy: event.clientY - win.y }
    setDraggingId(roomId)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const moveDrag = (event: React.PointerEvent) => {
    if (!dragRef.current) return
    const { id, dx, dy } = dragRef.current
    const x = Math.min(Math.max(event.clientX - dx, -WINDOW_WIDTH + 90), window.innerWidth - 90)
    const y = Math.min(Math.max(event.clientY - dy, 0), window.innerHeight - 48)
    setWindows((prev) => prev.map((w) => (w.roomId === id ? { ...w, x, y } : w)))
  }

  const endDrag = () => {
    dragRef.current = null
    setDraggingId(null)
  }

  const expanded = windows.filter((w) => !w.minimized)
  const minimized = windows.filter((w) => w.minimized)

  return (
    <>
      {expanded.map((win) => {
        const room = roomOf(win.roomId)
        return (
          <div
            key={win.roomId}
            className={`chat-float-window ${draggingId === win.roomId ? 'dragging' : ''}`}
            style={{ transform: `translate(${win.x}px, ${win.y}px)` }}
          >
            <div
              className="chat-float-head"
              onPointerDown={(event) => startDrag(event, win.roomId)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <button
                type="button"
                className="chat-float-title"
                onClick={() => navigate(`/chat/room/${win.roomId}`)}
                title="在聊天中心打开"
              >
                <span className="chat-float-icon" aria-hidden="true">{room?.type === 'invite' ? <Lock size={14} aria-hidden="true" /> : <MessageCircle size={14} aria-hidden="true" />}</span>
                <strong>{room?.name || `房间 ${win.roomId}`}</strong>
              </button>
              <div className="chat-float-actions">
                <button type="button" onClick={() => toggleWindow(win.roomId)} title="最小化">—</button>
              </div>
            </div>
            <div className="chat-float-body">
              <ChatThread key={`float-room:${win.roomId}`} scopeType="room" scopeId={String(win.roomId)} />
            </div>
            <div className="chat-float-foot">
              {room?.ownerId === currentUser.id ? (
                <button
                  type="button"
                  className="chat-float-leave danger"
                  onClick={() => {
                    if (confirmLeaveId === win.roomId) {
                      void handleLeave(win.roomId, true)
                    } else {
                      setConfirmLeaveId(win.roomId)
                      window.setTimeout(() => setConfirmLeaveId((prev) => (prev === win.roomId ? null : prev)), 3000)
                    }
                  }}
                >
                  {confirmLeaveId === win.roomId ? '确认解散房间？' : '解散房间'}
                </button>
              ) : (
                <button
                  type="button"
                  className="chat-float-leave danger"
                  onClick={() => {
                    if (confirmLeaveId === win.roomId) {
                      void handleLeave(win.roomId, false)
                    } else {
                      setConfirmLeaveId(win.roomId)
                      window.setTimeout(() => setConfirmLeaveId((prev) => (prev === win.roomId ? null : prev)), 3000)
                    }
                  }}
                >
                  {confirmLeaveId === win.roomId ? '确认退出？' : '退出房间'}
                </button>
              )}
            </div>
          </div>
        )
      })}
      {minimized.length > 0 && (
        <div className="chat-float-bubbles" aria-label="聊天浮窗">
          {minimized.map((win) => {
            const room = roomOf(win.roomId)
            const unread = unreadOf(win.roomId)
            return (
              <button
                key={win.roomId}
                type="button"
                className="chat-float-bubble"
                onClick={() => toggleWindow(win.roomId)}
                title={`${room?.name || '聊天室'}${unread > 0 ? `（${unread} 条未读）` : ''}`}
              >
                <span className="chat-float-icon" aria-hidden="true">{room?.type === 'invite' ? <Lock size={14} aria-hidden="true" /> : <MessageCircle size={14} aria-hidden="true" />}</span>
                <span className="chat-float-bubble-name">{room?.name || '聊天室'}</span>
                {unread > 0 && <span className="chat-float-unread">{unread > 99 ? '99+' : unread}</span>}
              </button>
            )
          })}
        </div>
      )}
    </>
  )
}
