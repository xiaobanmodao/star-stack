import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAppContext } from '../context/AppContext'
import type { DiscussionListResponse, DiscussionPost } from '../types'
import { fetchJson, formatTime, htmlToPlainText } from '../utils'
import { Badge, Button, EmptyState, PageHeader, Panel } from '../components/ui'
import './DiscussionPages.css'

const getPostExcerpt = (post: DiscussionPost) => {
  const text = htmlToPlainText(post.content)
  if (!text) return post.problemTitle ? `围绕 P${post.problemId} ${post.problemTitle} 的讨论。` : '打开帖子查看完整讨论内容。'
  return text.length > 92 ? `${text.slice(0, 92)}...` : text
}

const getPostTypeMeta = (post: DiscussionPost) => {
  const title = post.title.toLowerCase()
  if (post.problemId && /题解|solution|做法|思路/.test(post.title)) {
    return { label: '题解', tone: 'success' as const }
  }
  if (/求助|求调|wa|tle|re|ce|为什么|错/.test(title) || /求助|求调|为什么|错/.test(post.title)) {
    return { label: '求助', tone: 'danger' as const }
  }
  if (post.problemId) return { label: '题目讨论', tone: 'info' as const }
  if (/公告|更新|规则/.test(post.title)) return { label: '公告', tone: 'warning' as const }
  return { label: '讨论', tone: 'neutral' as const }
}

export default function DiscussionListPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { currentUser } = useAppContext()
  const [posts, setPosts] = useState<DiscussionPost[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<'latest' | 'hot'>('latest')
  const [search, setSearch] = useState(() => searchParams.get('search') || '')
  const [searchInput, setSearchInput] = useState(() => searchParams.get('search') || '')
  const [loading, setLoading] = useState(true)
  const problemIdFilter = searchParams.get('problemId')
  const pageSize = 20
  const fromProblemId = (location.state as { fromProblemId?: number } | null)?.fromProblemId

  const loadPosts = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sort })
      if (search) params.set('search', search)
      if (problemIdFilter) params.set('problemId', problemIdFilter)
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
  }, [page, problemIdFilter, search, sort])

  useEffect(() => {
    void loadPosts()
  }, [loadPosts])

  const totalPages = Math.ceil(total / pageSize)
  const featuredPost = posts[0]
  const relatedCount = posts.filter((post) => post.problemId).length
  const hotPost = posts.reduce<DiscussionPost | null>((current, post) => {
    if (!current) return post
    const postScore = post.likeCount * 3 + post.commentCount * 2 + post.viewCount
    const currentScore = current.likeCount * 3 + current.commentCount * 2 + current.viewCount
    return postScore > currentScore ? post : current
  }, null)

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
    <section className="discussion-list-page discussion-hall-v2">
      <PageHeader
        kicker="Discussion Hall"
        title={problemIdFilter ? `P${problemIdFilter} 的题目讨论` : '讨论大厅'}
        description={problemIdFilter
          ? '这里聚合了这道题相关的提问、题解和经验，读完可以自然回到题目继续做。'
          : '把题解、求助和日常讨论收束到一个轻量社区，让刷题主线和交流形成闭环。'}
        actions={(
          <>
            {problemIdFilter && (
              <Button variant="ghost" onClick={() => {
                if (fromProblemId) {
                  navigate(`/oj/p${fromProblemId}`)
                  return
                }
                navigate(`/oj/p${problemIdFilter}`)
              }}>
                返回题目
              </Button>
            )}
            {currentUser ? (
              <Button variant="primary" onClick={() => navigate(problemIdFilter ? `/discussions/create?problemId=${problemIdFilter}` : '/discussions/create')}>
                发布讨论
              </Button>
            ) : (
              <Button variant="primary" onClick={() => navigate('/auth')}>
                登录参与
              </Button>
            )}
          </>
        )}
      />

      {problemIdFilter && (
        <Panel className="discussion-problem-banner">
          <div>
            <strong>当前仅显示 P{problemIdFilter} 的讨论</strong>
            <p>你现在看到的是和这道题直接相关的帖子、提问和经验分享。</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => {
            if (fromProblemId) {
              navigate(`/oj/p${fromProblemId}`)
              return
            }
            navigate('/discussions')
          }}>
            {fromProblemId ? '返回题目' : '查看全部讨论'}
          </Button>
        </Panel>
      )}

      <Panel className="discussion-toolbar discussion-toolbar-v2">
        <div className="discussion-search">
          <input
            type="text"
            placeholder="搜索标题、关键词或题目"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && handleSearch()}
          />
          <Button variant="ghost" size="sm" onClick={handleSearch}>
            搜索
          </Button>
        </div>
        <div className="discussion-sort">
          <button className={`sort-btn ${sort === 'latest' ? 'active' : ''}`} onClick={() => { setSort('latest'); setPage(1) }}>
            最新发布
          </button>
          <button className={`sort-btn ${sort === 'hot' ? 'active' : ''}`} onClick={() => { setSort('hot'); setPage(1) }}>
            热门讨论
          </button>
        </div>
      </Panel>

      <div className="discussion-hall-grid">
        <div className="discussion-hall-main">
          {loading ? (
            <div className="discussion-loading">
              {Array.from({ length: 5 }, (_, index) => <div key={index} className="skeleton skeleton-card" />)}
            </div>
          ) : posts.length === 0 ? (
            <EmptyState
              className="discussion-empty"
              title="这里还没有内容"
              description={problemIdFilter ? '这道题还没有讨论，发起第一条提问或题解吧。' : '来发起第一条讨论，让这里亮起第一颗星。'}
            >
              {currentUser && (
                <Button variant="primary" onClick={() => navigate(problemIdFilter ? `/discussions/create?problemId=${problemIdFilter}` : '/discussions/create')}>
                  发布讨论
                </Button>
              )}
            </EmptyState>
          ) : (
            <div className="discussion-post-list">
              {posts.map((post) => {
                const typeMeta = getPostTypeMeta(post)
                return (
                  <Panel
                    key={post.id}
                    className="discussion-card discussion-card-v2"
                    onClick={() => navigate(`/discussions/${post.id}`, (fromProblemId || post.problemId) ? { state: { fromProblemId: fromProblemId || post.problemId } } : undefined)}
                  >
                    <div className="discussion-card-main">
                      <div className="discussion-card-topline">
                        <Badge tone={typeMeta.tone}>{typeMeta.label}</Badge>
                        {post.problemTitle && (
                          <button
                            className="discussion-card-problem"
                            onClick={(event) => {
                              event.stopPropagation()
                              navigate(`/oj/p${post.problemId}`)
                            }}
                          >
                            P{post.problemId} {post.problemTitle}
                          </button>
                        )}
                      </div>
                      <div className="discussion-card-title">{post.title}</div>
                      <p className="discussion-card-excerpt">{getPostExcerpt(post)}</p>
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
                  </Panel>
                )
              })}
            </div>
          )}
        </div>

        <aside className="discussion-hall-aside">
          <Panel className="discussion-side-card">
            <div className="discussion-side-kicker">Snapshot</div>
            <h3>{problemIdFilter ? '题目讨论概览' : '大厅概览'}</h3>
            <div className="discussion-side-stats">
              <div><strong>{total}</strong><span>总帖数</span></div>
              <div><strong>{posts.length}</strong><span>当前页</span></div>
              <div><strong>{relatedCount}</strong><span>关联题目</span></div>
            </div>
          </Panel>
          {featuredPost && (
            <Panel className="discussion-side-card">
              <div className="discussion-side-kicker">Focus</div>
              <h3>{hotPost?.title || featuredPost.title}</h3>
              <p>{hotPost ? getPostExcerpt(hotPost) : getPostExcerpt(featuredPost)}</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const target = hotPost || featuredPost
                  navigate(`/discussions/${target.id}`, target.problemId ? { state: { fromProblemId: target.problemId } } : undefined)
                }}
              >
                查看讨论
              </Button>
            </Panel>
          )}
          <Panel className="discussion-side-card">
            <div className="discussion-side-kicker">Guide</div>
            <h3>更容易获得回复的方式</h3>
            <p>贴出题号、错误状态、关键代码片段和你已经尝试过的思路，比单纯说“求调”更容易得到有效帮助。</p>
          </Panel>
        </aside>
      </div>

      {totalPages > 1 && (
        <div className="discussion-pagination">
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((prev) => prev - 1)}>
            上一页
          </Button>
          <span>{page} / {totalPages}</span>
          <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => setPage((prev) => prev + 1)}>
            下一页
          </Button>
        </div>
      )}
    </section>
  )
}
