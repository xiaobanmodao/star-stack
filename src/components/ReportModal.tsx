import { useState } from 'react'
import { fetchJson } from '../utils'
import '../pages/chat/ChatHub.css' // 复用 chips / 弹窗面板样式

const REASONS = ['广告/垃圾信息', '人身攻击', '色情低俗', '政治敏感', '侵权内容', '其他']

export default function ReportModal({
  targetType,
  targetId,
  onClose,
  onDone,
}: {
  targetType: 'post' | 'comment' | 'message' | 'user'
  targetId: number | string
  onClose: () => void
  onDone?: (message: string) => void
}) {
  const [reason, setReason] = useState('')
  const [custom, setCustom] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    const finalReason = reason === '其他' ? custom.trim() : reason
    if (!finalReason) {
      setError('请选择或填写举报原因')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const { response, data } = await fetchJson<{ message?: string }>('/api/reports', {
        method: 'POST',
        body: JSON.stringify({
          targetType,
          targetId: targetType === 'user' ? String(targetId) : Number(targetId),
          reason: finalReason,
        }),
      })
      if (response.ok) {
        onDone?.(data?.message || '举报已提交')
        onClose()
      } else {
        setError(data?.message || '举报失败')
      }
    } catch {
      setError('举报失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="confirm-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="confirm-panel chat-post-modal" onClick={(event) => event.stopPropagation()}>
        <div className="confirm-title">举报</div>
        <div className="chat-modal-field">
          <span>举报原因</span>
          <div className="chat-module-chips">
            {REASONS.map((item) => (
              <button
                key={item}
                type="button"
                className={reason === item ? 'active' : ''}
                onClick={() => setReason(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        {reason === '其他' && (
          <label className="chat-modal-field">
            <span>补充说明（选填）</span>
            <textarea
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              placeholder="描述问题详情"
              rows={3}
              maxLength={200}
            />
          </label>
        )}
        {error && <div className="auth-error">{error}</div>}
        <div className="confirm-actions">
          <button className="ghost" type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" type="button" onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? '提交中...' : '提交举报'}
          </button>
        </div>
      </div>
    </div>
  )
}
