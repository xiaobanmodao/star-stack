import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppContext } from '../context/AppContext'
import type { DiscussionListResponse, DiscussionPost } from '../types'
import { fetchJson, formatTime } from '../utils'

export default function DiscussionListPage() {
  const navigate = useNavigate()
  const { currentUser } = useAppContext()
  const [posts, setPosts] = useState<DiscussionPost[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<'latest' | 'hot'>('latest')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [loading, setLoading] = useState(true)
  const pageSize = 20

  const loadPosts = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sort })
      if (search) params.set('search', search)
      const { response, data } = await fetchJson<DiscussionListResponse>(`/api/discussions?${params}`)
      if (response.ok && data) {
        setPosts(data.posts || [])
        setTotal(data.total || 0)
      }
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }, [page, search, sort])

  useEffect(() => {
    void loadPosts()
  }, [loadPosts])

  const totalPages = Math.ceil(total / pageSize)

  const handleSearch = () => {
    setSearch(searchInput.trim())
    setPage(1)
  }

  const handleLike = async (postId: number) => {
    if (!currentUser) {
      navigate('/auth')
      return
    }
    const { response, data } = await fetchJson<{ liked: boolean; likeCount: number }>('/api/discussions/like', {
      method: 'POST',
      body: JSON.stringify({ targetType: 'post', targetId: postId })
    })
    if (response.ok && data) {
      setPosts((prev) => prev.map((post) => (
        post.id === postId ? { ...post, liked: data.liked, likeCount: data.likeCount } : post
      )))
    }
  }

  return (
    <section className="discussion-list-page">
      <div className="discussion-header">
        <h2>讨论区</h2>
        {currentUser && (
          <button className="primary" onClick={() => navigate('/discussions/create')}>
            发布讨论
          </button>
        )}
      </div>

      <div className="discussion-toolbar">
        <div className="discussion-search">
          <input
            type="text"
            placeholder="搜索标题、关键词或题目"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && handleSearch()}
          />
          <button className="ghost small" onClick={handleSearch}>
            搜索
          </button>
        </div>
        <div className="discussion-sort">
          <button className={`sort-btn ${sort === 'latest' ? 'active' : ''}`} onClick={() => { setSort('latest'); setPage(1) }}>
            最新发布
          </button>
          <button className={`sort-btn ${sort === 'hot' ? 'active' : ''}`} onClick={() => { setSort('hot'); setPage(1) }}>
            热门讨论
          </button>
        </div>
      </div>

      {loading ? (
        <div className="discussion-loading">
          {Array.from({ length: 5 }, (_, index) => <div key={index} className="skeleton skeleton-card" />)}
        </div>
      ) : posts.length === 0 ? (
        <div className="discussion-empty">这里还没有内容，来发起第一条讨论吧。</div>
      ) : (
        <div className="discussion-post-list">
          {posts.map((post) => (
            <div key={post.id} className="discussion-card" onClick={() => navigate(`/discussions/${post.id}`)}>
              <div className="discussion-card-main">
                <div className="discussion-card-title">{post.title}</div>
                <div className="discussion-card-meta">
                  <span className="discussion-card-author">
                    {post.userAvatar ? (
                      <img className="discussion-avatar" src={post.userAvatar} alt="" loading="lazy" />
                    ) : (
                      <span className="discussion-avatar fallback">{post.userName?.charAt(0) || '?'}</span>
                    )}
                    {post.userName}
                  </span>
                  <span className="discussion-card-time">{formatTime(post.createdAt)}</span>
                  {post.problemTitle && (
                    <span
                      className="discussion-card-problem"
                      onClick={(event) => {
                        event.stopPropagation()
                        navigate(`/oj/p${post.problemId}`)
                      }}
                    >
                      P{post.problemId} {post.problemTitle}
                    </span>
                  )}
                </div>
              </div>
              <div className="discussion-card-stats">
                <span className="stat-item" onClick={(event) => { event.stopPropagation(); void handleLike(post.id) }}>
                  <svg viewBox="0 0 24 24" className={post.liked ? 'liked' : ''}><path d="M12 21C12 21 3 13.5 3 8.5C3 5.42 5.42 3 8.5 3C10.24 3 11.91 3.81 12 5C12.09 3.81 13.76 3 15.5 3C18.58 3 21 5.42 21 8.5C21 13.5 12 21 12 21Z" /></svg>
                  {post.likeCount}
                </span>
                <span className="stat-item">
                  <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                  {post.commentCount}
                </span>
                <span className="stat-item">
                  <svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                  {post.viewCount}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="discussion-pagination">
          <button disabled={page <= 1} onClick={() => setPage((prev) => prev - 1)}>
            上一页
          </button>
          <span>{page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage((prev) => prev + 1)}>
            下一页
          </button>
        </div>
      )}
    </section>
  )
}
