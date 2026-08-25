import { useState, useEffect, useCallback } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAppContext } from '../context/AppContext'
import { fetchJson, formatTime, htmlToPlainText } from '../utils'
import { renderRichText } from '../utils/richText'
import type { DiscussionPost, DiscussionComment, DiscussionDetailResponse } from '../types'
import { Badge, Button, EmptyState, PageHeader, Panel } from '../components/ui'
import DecoratedAvatar from '../components/profile/DecoratedAvatar'
import RichTextEditor from '../components/RichTextEditor'
import ReportModal from '../components/ReportModal'
import './DiscussionPages.css'

const getPostTypeMeta = (post: DiscussionPost) => {
  const title = post.title.toLowerCase()
  if (post.isSolution || (post.problemId && /题解|solution|做法|思路/.test(post.title))) {
    return { label: '题解', tone: 'success' as const }
  }
  if (/求助|求调|wa|tle|re|ce|为什么|错/.test(title) || /求助|求调|为什么|错/.test(post.title)) {
    return { label: '求助', tone: 'danger' as const }
  }
  if (post.problemId) return { label: '题目讨论', tone: 'info' as const }
  if (/公告|更新|规则/.test(post.title)) return { label: '公告', tone: 'warning' as const }
  return { label: '讨论', tone: 'neutral' as const }
}

export default function DiscussionDetailPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { currentUser } = useAppContext()
  const { id } = useParams<{ id: string }>()
  const [post, setPost] = useState<DiscussionPost | null>(null)
  const [comments, setComments] = useState<DiscussionComment[]>([])
  const [loading, setLoading] = useState(true)
  const [commentText, setCommentText] = useState('')
  const [replyTo, setReplyTo] = useState<{ id: number; name: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [bookmarked, setBookmarked] = useState(false)
  const [bookmarkToggling, setBookmarkToggling] = useState(false)
  const [reportTarget, setReportTarget] = useState<{ type: 'post' | 'comment'; id: number } | null>(null)
  const fromProblemId = (location.state as { fromProblemId?: number } | null)?.fromProblemId
  const fromPath = (location.state as { from?: string } | null)?.from

  const navigateBack = useCallback(() => {
    if (fromProblemId) {
      navigate(`/oj/p${fromProblemId}`)
      return
    }
    // 优先回到进入帖子前的列表（如聊天中心的模块板块）
    if (fromPath && fromPath !== location.pathname) {
      navigate(fromPath)
      return
    }
    navigate('/chat/plaza')
  }, [fromProblemId, fromPath, location.pathname, navigate])

  const loadDetail = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const { response, data } = await fetchJson<DiscussionDetailResponse>(`/api/discussions/${id}`)
      if (response.ok && data) {
        setPost(data.post)
        setComments(data.comments || [])
      }
      // 收藏状态
      const token = localStorage.getItem('starstack_token')
      if (token) {
        const bm = await fetchJson<{ bookmarked: boolean }>(`/api/bookmarks/status?targetType=post&targetId=${id}`).catch(() => null)
        if (bm?.response.ok && bm.data) setBookmarked(bm.data.bookmarked)
      }
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [id])

  useEffect(() => { loadDetail() }, [loadDetail])

  const handleToggleBookmark = async () => {
    if (!currentUser || !post) { navigate('/auth'); return }
    if (bookmarkToggling) return
    setBookmarkToggling(true)
    try {
      const { response, data } = await fetchJson<{ bookmarked?: boolean }>('/api/bookmarks', {
        method: 'POST',
        body: JSON.stringify({ targetType: 'post', targetId: post.id }),
      })
      if (response.ok && data) setBookmarked(Boolean(data.bookmarked))
    } catch { /* 忽略 */ }
    finally { setBookmarkToggling(false) }
  }

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
    if (response.ok) navigateBack()
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
        <span
          className="comment-author"
          onClick={() => navigate(`/user/${comment.userId}`)}
          title="查看个人主页"
          style={{ cursor: 'pointer' }}
        >
          <DecoratedAvatar
            avatar={comment.userAvatar}
            fallback={comment.userName?.charAt(0) || '?'}
            frame={comment.userAvatarFrame}
            overlay={comment.userAvatarOverlay}
            size="discussion-small"
            alt=""
            loading="lazy"
          />
          <span className="discussion-author-name">{comment.userName}</span>
          {comment.userDisplayTitle && <span className="discussion-author-title">{comment.userDisplayTitleIcon || '✦'} {comment.userDisplayTitle}</span>}
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
      <div className="comment-body" dangerouslySetInnerHTML={{ __html: renderRichText(comment.content) }} />
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

  if (loading) return (
    <section className="discussion-detail-page discussion-detail-v2">
      <div className="discussion-loading">
        {Array.from({ length: 3 }, (_, index) => <div key={index} className="skeleton skeleton-card" />)}
      </div>
    </section>
  )
  if (!post) return (
    <section className="discussion-detail-page discussion-detail-v2">
      <EmptyState title="帖子不存在" description="这条讨论可能已经被删除，或链接地址不正确。" />
    </section>
  )

  const typeMeta = getPostTypeMeta(post)
  const plainContent = htmlToPlainText(post.content)
  const problemTargetId = fromProblemId || post.problemId

  return (
    <section className="discussion-detail-page discussion-detail-v2">
      <PageHeader
        kicker="Discussion Thread"
        title={post.title}
        description={plainContent ? `${plainContent.slice(0, 96)}${plainContent.length > 96 ? '...' : ''}` : '阅读讨论、补充思路，然后回到题目继续推进。'}
        actions={(
          <>
            <Button variant="ghost" onClick={navigateBack}>
              {fromProblemId ? '返回题目' : '返回列表'}
            </Button>
            {post.problemId && (
              <Button variant="primary" onClick={() => navigate(`/oj/p${post.problemId}`)}>
                打开题目
              </Button>
            )}
          </>
        )}
      />

      <div className="discussion-detail-grid">
        <main className="discussion-detail-main">
          <Panel className="discussion-post-detail discussion-post-detail-v2">
            <div className="discussion-thread-meta-row">
              <Badge tone={typeMeta.tone}>{typeMeta.label}</Badge>
              {post.problemTitle && (
                <button className="post-problem" onClick={() => navigate(`/oj/p${post.problemId}`)}>
                  P{post.problemId} {post.problemTitle}
                </button>
              )}
            </div>
            <div className="post-meta">
              <span
                className="post-author"
                onClick={() => navigate(`/user/${post.userId}`)}
                title="查看个人主页"
                style={{ cursor: 'pointer' }}
              >
                <DecoratedAvatar
                  avatar={post.userAvatar}
                  fallback={post.userName?.charAt(0) || '?'}
                  frame={post.userAvatarFrame}
                  overlay={post.userAvatarOverlay}
                  size="discussion"
                  alt=""
                  loading="lazy"
                />
                <span className="discussion-author-name">{post.userName}</span>
                {post.userDisplayTitle && <span className="discussion-author-title">{post.userDisplayTitleIcon || '✦'} {post.userDisplayTitle}</span>}
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
              <span className="post-views">浏览 {post.viewCount}</span>
            </div>
            <div className="post-content" dangerouslySetInnerHTML={{ __html: renderRichText(post.content || '') }} />
             <div className="post-actions">
               <button className={`like-btn ${post.liked ? 'liked' : ''}`} onClick={handleLikePost}>
                 <svg viewBox="0 0 24 24"><path d="M12 21C12 21 3 13.5 3 8.5C3 5.42 5.42 3 8.5 3C10.24 3 11.91 3.81 12 5C12.09 3.81 13.76 3 15.5 3C18.58 3 21 5.42 21 8.5C21 13.5 12 21 12 21Z" /></svg>
                 {post.likeCount}
               </button>
               {currentUser && (
                 <button
                   className={`bookmark-btn ${bookmarked ? 'active' : ''}`}
                   onClick={() => void handleToggleBookmark()}
                   title={bookmarked ? '取消收藏' : '收藏帖子'}
                 >
                   <svg viewBox="0 0 24 24">
                     <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                   </svg>
                   收藏
                 </button>
               )}
               {currentUser && post.userId !== currentUser.id && (
                 <button
                   className="bookmark-btn report-btn"
                   onClick={() => setReportTarget({ type: 'post', id: post.id })}
                   title="举报帖子"
                 >
                   ⚑ 举报
                 </button>
               )}
               {currentUser && (currentUser.id === post.userId || currentUser.isAdmin) && (
                 <>
                   <Button variant="ghost" size="sm" onClick={() => navigate(`/chat/p/${post.id}/edit`, fromPath ? { state: { from: fromPath } } : undefined)}>编辑</Button>
                   <Button variant="danger" size="sm" onClick={handleDeletePost}>删除</Button>
                 </>
               )}
             </div>
          </Panel>

          <Panel className="discussion-comments-section discussion-comments-v2">
            <div className="discussion-comments-head">
              <div>
                <div className="discussion-side-kicker">Replies</div>
                <h3>评论 ({post.commentCount})</h3>
              </div>
              {currentUser && <Badge tone="info">可参与</Badge>}
            </div>
            {comments.length === 0 ? (
              <EmptyState title="暂无评论" description="来发表第一条评论，给后来者留一盏灯。" />
            ) : (
              <div className="comments-list">
                {comments.map(c => renderComment(c))}
              </div>
            )}

            {currentUser ? (
              <div className="comment-input-area">
                {replyTo && (
                  <div className="reply-hint">
                    回复 {replyTo.name}
                    <button onClick={() => setReplyTo(null)}>x</button>
                  </div>
                )}
                <RichTextEditor
                  value={commentText}
                  onChange={setCommentText}
                  placeholder={replyTo ? `回复 ${replyTo.name}...` : '写下你的评论（支持代码、公式、大小字）...'}
                />
                <Button variant="primary" size="sm" disabled={submitting || !commentText.trim()} onClick={handleSubmitComment}>
                  {submitting ? '提交中...' : '发表评论'}
                </Button>
              </div>
            ) : (
              <EmptyState title="登录后参与讨论" description="登录后可以点赞、回复和向作者提问。" />
            )}
          </Panel>
        </main>

        <aside className="discussion-detail-aside">
          <Panel className="discussion-side-card">
            <div className="discussion-side-kicker">Thread</div>
            <h3>讨论状态</h3>
            <div className="discussion-side-stats vertical">
              <div><strong>{post.likeCount}</strong><span>点赞</span></div>
              <div><strong>{post.commentCount}</strong><span>评论</span></div>
              <div><strong>{post.viewCount}</strong><span>浏览</span></div>
            </div>
          </Panel>
          {post.problemId && (
            <Panel className="discussion-side-card discussion-problem-card">
              <div className="discussion-side-kicker">Problem Link</div>
              <h3>P{post.problemId} {post.problemTitle}</h3>
              <p>这条讨论和题目绑定。看完后可以回到题面、继续调试，或查看同题更多讨论。</p>
              <div className="discussion-side-actions">
                <Button variant="primary" size="sm" onClick={() => navigate(`/oj/p${problemTargetId}`)}>
                  返回题目
                </Button>
                <Button variant="ghost" size="sm" onClick={() => navigate(`/chat/plaza?problemId=${post.problemId}`)}>
                  同题讨论
                </Button>
              </div>
            </Panel>
          )}
          <Panel className="discussion-side-card">
            <div className="discussion-side-kicker">Tip</div>
            <h3>讨论礼仪</h3>
            <p>如果你在求助，补充错误状态、测试点信息、核心代码和已尝试的思路，会让别人更容易帮你定位问题。</p>
          </Panel>
        </aside>
      </div>
      {reportTarget && (
        <ReportModal
          targetType={reportTarget.type}
          targetId={reportTarget.id}
          onClose={() => setReportTarget(null)}
          onDone={(message) => window.alert(message)}
        />
      )}

    </section>
  )
}

// === Discussion Create Page ===
