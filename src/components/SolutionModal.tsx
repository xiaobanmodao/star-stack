import { useState } from 'react'
import RichTextEditor from './RichTextEditor'
import { fetchJson } from '../utils'
import './SolutionModal.css'

export default function SolutionModal({
  problemId,
  onClose,
  onCreated,
}: {
  problemId: number
  onClose: () => void
  onCreated: (postId: number) => void
}) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError('请填写题解标题')
      return
    }
    if (!content.trim()) {
      setError('请填写题解内容')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const { response, data } = await fetchJson<{ postId?: number; message?: string }>(
        `/api/oj/problems/${problemId}/solutions`,
        {
          method: 'POST',
          body: JSON.stringify({ title: title.trim(), content }),
        }
      )
      if (response.ok && data?.postId) {
        onCreated(data.postId)
      } else {
        setError(data?.message || '发布题解失败')
      }
    } catch {
      setError('发布题解失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="confirm-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="confirm-panel solution-modal" onClick={(event) => event.stopPropagation()}>
        <div className="confirm-title">写题解</div>
        <label className="solution-modal-field">
          <span>标题</span>
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="一句话概括你的思路"
            maxLength={200}
            autoFocus
          />
        </label>
        <label className="solution-modal-field">
          <span>内容（支持粗体、代码块、数学公式）</span>
          <RichTextEditor value={content} onChange={setContent} placeholder="分享你的思路、代码与踩坑点..." />
        </label>
        {error && <div className="auth-error">{error}</div>}
        <div className="confirm-actions">
          <button className="ghost" type="button" onClick={onClose} disabled={submitting}>
            取消
          </button>
          <button className="primary" type="button" onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? '发布中...' : '发布题解'}
          </button>
        </div>
      </div>
    </div>
  )
}
