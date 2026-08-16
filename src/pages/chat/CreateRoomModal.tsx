import { useState } from 'react'
import { fetchJson } from '../../utils'

export default function CreateRoomModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (id: number) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<'public' | 'invite'>('public')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError('请填写房间名')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const { response, data } = await fetchJson<{ roomId?: number; message?: string }>('/api/chat/rooms', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), description: description.trim(), type }),
      })
      if (response.ok && data?.roomId) {
        onCreated(data.roomId)
      } else {
        setError(data?.message || '创建失败')
      }
    } catch {
      setError('创建失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="confirm-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="confirm-panel chat-room-modal" onClick={(event) => event.stopPropagation()}>
        <div className="confirm-title">创建聊天室</div>
        <label className="chat-modal-field">
          <span>房间名</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：今晚的算法讨论"
            maxLength={60}
            autoFocus
          />
        </label>
        <label className="chat-modal-field">
          <span>简介（可选）</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="这个房间聊什么？"
            rows={2}
            maxLength={300}
          />
        </label>
        <div className="chat-modal-field">
          <span>加入方式</span>
          <div className="chat-room-type-tabs">
            <button type="button" className={type === 'public' ? 'active' : ''} onClick={() => setType('public')}>
              公开房间
              <em>所有人可加入</em>
            </button>
            <button type="button" className={type === 'invite' ? 'active' : ''} onClick={() => setType('invite')}>
              邀请制
              <em>仅房主邀请的成员可加入</em>
            </button>
          </div>
        </div>
        {error && <div className="auth-error">{error}</div>}
        <div className="confirm-actions">
          <button className="ghost" type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" type="button" onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? '创建中...' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}
