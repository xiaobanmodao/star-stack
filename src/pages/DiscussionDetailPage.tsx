import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAppContext } from '../context/AppContext'
import { fetchJson, formatTime } from '../utils'
import type { DiscussionPost, DiscussionComment, DiscussionDetailResponse } from '../types'

export default function DiscussionDetailPage() {
  const navigate = useNavigate()
  const { currentUser } = useAppContext()
  const { id } = useParams<{ id: string }>()
  const [post, setPost] = useState<DiscussionPost | null>(null)
  const [comments, setComments] = useState<DiscussionComment[]>([])
  const [loading, setLoading] = useState(true)
  const [commentText, setCommentText] = useState('')
  const [replyTo, setReplyTo] = useState<{ id: number; name: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const loadDetail = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const { response, data } = await fetchJson<DiscussionDetailResponse>(`/api/discussions/${id}`)
      if (response.ok && data) {
        setPost(data.post)
        setComments(data.comments || [])
      }
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [id])

  useEffect(() => { loadDetail() }, [loadDetail])

  const handleLikePost = async () => {
    if (!currentUser || !post) { navigate('/auth'); return }
    const { response, data } = await fetchJson<{ liked: boolean; likeCount: number }>('/api/discussions/like', {
      method: 'POST', body: JSON.stringify({ targetType: 'post', targetId: post.id })
    })
    if (response.ok && data) {
      setPost(prev => prev ? { ...prev, liked: data.liked, likeCount: data.likeCount } : prev)
    }
  }

  const handleLikeComment = async (commentId: number) => {
    if (!currentUser) { navigate('/auth'); return }
    const { response, data } = await fetchJson<{ liked: boolean; likeCount: number }>('/api/discussions/like', {
      method: 'POST', body: JSON.stringify({ targetType: 'comment', targetId: commentId })
    })
    if (response.ok && data) {
      const updateLike = (list: DiscussionComment[]): DiscussionComment[] =>
        list.map(c => ({
          ...c,
          liked: c.id === commentId ? data.liked : c.liked,
          likeCount: c.id === commentId ? data.likeCount : c.likeCount,
          replies: c.replies ? updateLike(c.replies) : c.replies,
        }))
      setComments(prev => updateLike(prev))
    }
  }

  const handleSubmitComment = async () => {
    if (!currentUser) { navigate('/auth'); return }
    if (!commentText.trim()) return
    setSubmitting(true)
    try {
      const { response, data } = await fetchJson<{ comment: DiscussionComment }>(`/api/discussions/${id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content: commentText, parentId: replyTo?.id || null })
      })
      if (response.ok && data?.comment) {
        if (replyTo) {
          const addReply = (list: DiscussionComment[]): DiscussionComment[] =>
            list.map(c => c.id === replyTo.id
              ? { ...c, replies: [...(c.replies || []), { ...data.comment, replyToName: replyTo.name }] }
              : { ...c, replies: c.replies ? addReply(c.replies) : c.replies })
          setComments(prev => addReply(prev))
        } else {
          setComments(prev => [...prev, data.comment])
        }
        setCommentText('')
        setReplyTo(null)
        if (post) setPost({ ...post, commentCount: post.commentCount + 1 })
      }
    } catch (e) { console.error(e) }
    finally { setSubmitting(false) }
  }

  const handleDeletePost = async () => {
    if (!post || !confirm('确定要删除这篇帖子吗？')) return
    const { response } = await fetchJson(`/api/discussions/${post.id}`, { method: 'DELETE' })
    if (response.ok) navigate('/discussions')
  }

  const handleDeleteComment = async (commentId: number) => {
    if (!confirm('确定要删除这条评论吗？')) return
    const { response } = await fetchJson(`/api/discussions/comments/${commentId}`, { method: 'DELETE' })
    if (response.ok) loadDetail()
  }

  // Render a single comment with nested replies
  const renderComment = (comment: DiscussionComment, depth: number = 0) => (
    <div key={comment.id} className={`discussion-comment ${depth > 0 ? 'nested' : ''}`}>
      <div className="comment-header">
        <span className="comment-author">
          {comment.userAvatar ? (
            <img className="discussion-avatar small" src={comment.userAvatar} alt="" loading="lazy" />
          ) : (
            <span className="discussion-avatar fallback small">{comment.userName?.charAt(0) || '?'}</span>
          )}
          {comment.userName}
        </span>
        {currentUser && currentUser.id !== comment.userId && (
          <button
            className="send-message-btn small"
            onClick={() => navigate(`/messages/${comment.userId}`)}
            title="发送私信"
          >
            <svg viewBox="0 0 24 24" width="12" height="12">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
          </button>
        )}
        {comment.replyToName && (
          <span className="comment-reply-to">
            回复 <span className="comment-reply-to-name" data-user-name>{comment.replyToName}</span>
          </span>
        )}
        <span className="comment-time">{formatTime(comment.createdAt)}</span>
      </div>
      <div className="comment-body" dangerouslySetInnerHTML={{ __html: comment.content }} />
      <div className="comment-actions">
        <button className={`like-btn ${comment.liked ? 'liked' : ''}`} onClick={() => handleLikeComment(comment.id)}>
          <svg viewBox="0 0 24 24"><path d="M12 21C12 21 3 13.5 3 8.5C3 5.42 5.42 3 8.5 3C10.24 3 11.91 3.81 12 5C12.09 3.81 13.76 3 15.5 3C18.58 3 21 5.42 21 8.5C21 13.5 12 21 12 21Z" /></svg>
          {comment.likeCount}
        </button>
        <button className="reply-btn" onClick={() => setReplyTo({ id: comment.id, name: comment.userName })}>回复</button>
        {currentUser && (currentUser.id === comment.userId || currentUser.isAdmin) && (
          <button className="delete-btn" onClick={() => handleDeleteComment(comment.id)}>删除</button>
        )}
      </div>
      {comment.replies && comment.replies.length > 0 && (
        <div className="comment-replies">
          {comment.replies.map(r => renderComment(r, depth + 1))}
        </div>
      )}
    </div>
  )

  if (loading) return <section className="discussion-detail-page"><div className="discussion-loading">加载中...</div></section>
  if (!post) return <section className="discussion-detail-page"><div className="discussion-empty">帖子不存在</div></section>

  return (
    <section className="discussion-detail-page">
      <button className="ghost small back-btn" onClick={() => navigate('/discussions')}>← 返回列表</button>

      <article className="discussion-post-detail">
        <h1 className="post-title">{post.title}</h1>
        <div className="post-meta">
          <span className="post-author">
            {post.userAvatar ? (
              <img className="discussion-avatar" src={post.userAvatar} alt="" loading="lazy" />
            ) : (
              <span className="discussion-avatar fallback">{post.userName?.charAt(0) || '?'}</span>
            )}
            {post.userName}
          </span>
          {currentUser && currentUser.id !== post.userId && (
            <button
              className="send-message-btn"
              onClick={() => navigate(`/messages/${post.userId}`)}
              title="发送私信"
            >
              <svg viewBox="0 0 24 24" width="14" height="14">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
            </button>
          )}
          <span className="post-time">{formatTime(post.createdAt)}</span>
          {post.problemTitle && (
            <span className="post-problem" onClick={() => navigate(`/oj/p${post.problemId}`)}>
              P{post.problemId} {post.problemTitle}
            </span>
          )}
          <span className="post-views">浏览 {post.viewCount}</span>
        </div>
        <div className="post-content" dangerouslySetInnerHTML={{ __html: post.content || '' }} />
        <div className="post-actions">
          <button className={`like-btn ${post.liked ? 'liked' : ''}`} onClick={handleLikePost}>
            <svg viewBox="0 0 24 24"><path d="M12 21C12 21 3 13.5 3 8.5C3 5.42 5.42 3 8.5 3C10.24 3 11.91 3.81 12 5C12.09 3.81 13.76 3 15.5 3C18.58 3 21 5.42 21 8.5C21 13.5 12 21 12 21Z" /></svg>
            {post.likeCount}
          </button>
          {currentUser && (currentUser.id === post.userId || currentUser.isAdmin) && (
            <>
              <button className="ghost small" onClick={() => navigate(`/discussions/${post.id}/edit`)}>编辑</button>
              <button className="ghost small danger" onClick={handleDeletePost}>删除</button>
            </>
          )}
        </div>
      </article>

      <div className="discussion-comments-section">
        <h3>评论 ({post.commentCount})</h3>
        {comments.length === 0 ? (
          <div className="discussion-empty">暂无评论，来发表第一条评论吧</div>
        ) : (
          <div className="comments-list">
            {comments.map(c => renderComment(c))}
          </div>
        )}

        {currentUser && (
          <div className="comment-input-area">
            {replyTo && (
              <div className="reply-hint">
                回复 {replyTo.name}
                <button onClick={() => setReplyTo(null)}>✕</button>
              </div>
            )}
            <textarea
              placeholder={replyTo ? `回复 ${replyTo.name}...` : '写下你的评论...'}
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              rows={3}
            />
            <button className="primary small" disabled={submitting || !commentText.trim()} onClick={handleSubmitComment}>
              {submitting ? '提交中...' : '发表评论'}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

// === Discussion Create Page ===
