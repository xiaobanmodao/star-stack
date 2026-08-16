import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAppContext } from '../../context/AppContext'
import { fetchJson } from '../../utils'
import { floatRoom } from '../../utils/floatRoom'
import type { ChatRoom } from '../../types'
import './ChatHub.css'

export default function JoinRoomPane() {
  const navigate = useNavigate()
  const { currentUser } = useAppContext()
  const { token = '' } = useParams<{ token: string }>()
  const [room, setRoom] = useState<ChatRoom | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'joining'>('loading')
  const [message, setMessage] = useState('')

  const loadLink = useCallback(async () => {
    setStatus('loading')
    try {
      const { response, data } = await fetchJson<{ room?: ChatRoom; message?: string }>(
        `/api/chat/rooms/invite/${token}`
      )
      if (response.ok && data?.room) {
        setRoom(data.room)
        setStatus('ready')
      } else {
        setMessage(data?.message || '链接无效')
        setStatus('error')
      }
    } catch {
      setMessage('链接无效或已失效')
      setStatus('error')
    }
  }, [token])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadLink()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadLink])

  const handleJoin = async () => {
    if (!currentUser) {
      navigate('/auth')
      return
    }
    setStatus('joining')
    try {
      const { response, data } = await fetchJson<{ message?: string; roomId?: number }>(
        `/api/chat/rooms/invite/${token}/join`,
        { method: 'POST' }
      )
      if (response.ok && data?.roomId) {
        floatRoom(data.roomId)
        navigate(`/chat/room/${data.roomId}`, { replace: true })
      } else {
        setMessage(data?.message || '加入失败')
        setStatus('error')
      }
    } catch {
      setMessage('加入失败，请重试')
      setStatus('error')
    }
  }

  return (
    <section className="chat-scope-pane">
      <div className="chat-room-locked">
        {status === 'loading' ? (
          <div className="chat-loading">链接验证中...</div>
        ) : status === 'error' ? (
          <>
            <span className="chat-room-locked-icon">🔗</span>
            <h2>邀请链接不可用</h2>
            <p>{message}</p>
            <button type="button" className="primary" onClick={() => navigate('/chat/rooms')}>
              返回聊天室大厅
            </button>
          </>
        ) : (
          <>
            <span className="chat-room-locked-icon">💬</span>
            <h2>加入《{room?.name}》</h2>
            <p>
              {room?.type === 'invite' ? '🔒 邀请制房间' : '🔓 公开房间'} · 房主 {room?.ownerName}
              <br />
              通过邀请链接加入后即可开始聊天
            </p>
            <div className="join-room-actions">
              <button type="button" className="primary" onClick={() => void handleJoin()} disabled={status === 'joining'}>
                {status === 'joining' ? '加入中...' : '加入房间'}
              </button>
              <button type="button" className="ghost" onClick={() => navigate('/chat/rooms')}>
                取消
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
