import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppContext } from '../context/AppContext'
import { useToast } from '../components/ui/ToastContext'
import { Badge, Button, EmptyState, ErrorState, LoadingState, PageHeader, Panel } from '../components/ui'
import { fetchJson } from '../utils'
import type { AdminAuditLog, AdminMetricsResponse, AdminProblem, AdminReport, AdminStatsResponse, UserRecord, ApiResponse } from '../types'
import './CreatorAdminPages.css'

export default function AdminPage() {
  const { currentUser, openAuth } = useAppContext()
  const { showToast } = useToast()
  const navigate = useNavigate()
  const [adminUsers, setAdminUsers] = useState<UserRecord[]>([])
  const [adminLoading, setAdminLoading] = useState(false)
  const [adminError, setAdminError] = useState('')
  const [adminActionError, setAdminActionError] = useState('')
  const [adminActionMessage, setAdminActionMessage] = useState('')
  const [adminActionBusyKey, setAdminActionBusyKey] = useState('')
  const [adminCreating, setAdminCreating] = useState(false)
  const [adminTab, setAdminTab] = useState<'users' | 'problems' | 'reports' | 'logs' | 'stats'>('users')
  const [adminUsersPage, setAdminUsersPage] = useState(1)
  const [adminUsersPageInput, setAdminUsersPageInput] = useState('1')
  const [adminUserQuery, setAdminUserQuery] = useState('')
  const [adminUserStatus, setAdminUserStatus] = useState<'all' | 'normal' | 'banned'>('all')
  const [adminUserRole, setAdminUserRole] = useState<'all' | 'user' | 'admin'>('all')
  const adminUsersPerPage = 20

  const [newUserId, setNewUserId] = useState('')
  const [newUserName, setNewUserName] = useState('')
  const [newUserPassword, setNewUserPassword] = useState('')
  const [newUserIsAdmin, setNewUserIsAdmin] = useState(false)


  const loadAdminUsers = useCallback(async () => {
    setAdminLoading(true)
    setAdminError('')
    try {
      const { response, data } = await fetchJson<{ users: UserRecord[]; message?: string }>('/api/admin/users')
      if (!response.ok) {
        setAdminError(data?.message || '无法加载用户')
        return
      }
      const users = data?.users || []
      setAdminUsers(users)
      setAdminUsersPage((page) => Math.min(page, Math.max(1, Math.ceil(users.length / adminUsersPerPage))))
      setAdminUsersPageInput((page) => String(Math.min(Number(page) || 1, Math.max(1, Math.ceil(users.length / adminUsersPerPage)))))
    } catch {
      setAdminError('网络异常，暂时无法加载用户')
    } finally {
      setAdminLoading(false)
    }
  }, [])

  useEffect(() => {
    if (currentUser?.isAdmin) {
      loadAdminUsers()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.isAdmin])

  const handleCreateUser = async () => {
    if (!newUserId.trim() || !newUserName.trim() || newUserPassword.length < 6) {
      setAdminActionError('请填写完整信息，密码至少 6 位')
      return
    }
    setAdminActionError('')
    setAdminActionMessage('')
    setAdminCreating(true)
    try {
      const { response, data } = await fetchJson<ApiResponse>('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          id: newUserId.trim(),
          name: newUserName.trim(),
          password: newUserPassword,
          isAdmin: newUserIsAdmin,
        }),
      })
      if (!response.ok) {
        setAdminActionError(data?.message || '创建失败')
        return
      }
      setNewUserId('')
      setNewUserName('')
      setNewUserPassword('')
      setNewUserIsAdmin(false)
      setAdminActionMessage('用户已创建')
      showToast('用户已创建', 'success')
      await loadAdminUsers()
    } catch {
      setAdminActionError('网络异常，用户创建未完成')
    } finally {
      setAdminCreating(false)
    }
  }

  const handleUserAction = async (url: string, body?: Record<string, unknown>) => {
    if (adminActionBusyKey) return
    setAdminActionError('')
    setAdminActionMessage('')
    setAdminActionBusyKey(url)
    try {
      const { response, data } = await fetchJson<ApiResponse>(url, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!response.ok) {
        setAdminActionError(data?.message || '操作失败')
        return
      }
      setAdminActionMessage('操作已完成')
      showToast('管理员操作已完成', 'success')
      await loadAdminUsers()
    } catch {
      setAdminActionError('网络异常，操作未完成')
    } finally {
      setAdminActionBusyKey('')
    }
  }

  const handleDeleteUser = async (id: string) => {
    const busyKey = `delete:${id}`
    if (adminActionBusyKey) return
    if (!window.confirm(`确认删除用户 ${id} ?`)) return
    setAdminActionError('')
    setAdminActionMessage('')
    setAdminActionBusyKey(busyKey)
    try {
      const { response, data } = await fetchJson<ApiResponse>(`/api/admin/users/${id}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        setAdminActionError(data?.message || '删除失败')
        return
      }
      setAdminActionMessage('用户已删除')
      showToast('用户已删除', 'success')
      await loadAdminUsers()
    } catch {
      setAdminActionError('网络异常，删除未完成')
    } finally {
      setAdminActionBusyKey('')
    }
  }

  const filteredAdminUsers = useMemo(() => {
    const query = adminUserQuery.trim().toLowerCase()
    return adminUsers.filter((user) => {
      const matchesQuery = !query || [user.id, user.name, user.email || ''].some((value) => value.toLowerCase().includes(query))
      const matchesStatus = adminUserStatus === 'all'
        || (adminUserStatus === 'banned' ? user.isBanned : !user.isBanned)
      const matchesRole = adminUserRole === 'all'
        || (adminUserRole === 'admin' ? user.isAdmin : !user.isAdmin)
      return matchesQuery && matchesStatus && matchesRole
    })
  }, [adminUserQuery, adminUserRole, adminUserStatus, adminUsers])

  const adminUsersTotalPages = Math.ceil(filteredAdminUsers.length / adminUsersPerPage)
  const adminUsersStartIndex = (adminUsersPage - 1) * adminUsersPerPage
  const adminUsersEndIndex = adminUsersStartIndex + adminUsersPerPage
  const currentAdminUsers = filteredAdminUsers.slice(adminUsersStartIndex, adminUsersEndIndex)

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(filteredAdminUsers.length / adminUsersPerPage))
    setAdminUsersPage((page) => Math.min(page, totalPages))
    setAdminUsersPageInput((value) => String(Math.min(Number(value) || 1, totalPages)))
  }, [filteredAdminUsers.length])

  const handleAdminUsersPageChange = (page: number) => {
    if (page >= 1 && page <= adminUsersTotalPages) {
      setAdminUsersPage(page)
      setAdminUsersPageInput(String(page))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const handleAdminUsersPageInputChange = (value: string) => {
    setAdminUsersPageInput(value)
  }

  const handleAdminUsersPageInputSubmit = () => {
    const page = parseInt(adminUsersPageInput)
    if (!isNaN(page) && page >= 1 && page <= adminUsersTotalPages) {
      setAdminUsersPage(page)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      setAdminUsersPageInput(String(adminUsersPage))
    }
  }

  const renderAdminUsersPageNumbers = () => {
    const pages: (number | string)[] = []
    if (adminUsersTotalPages <= 7) {
      for (let i = 1; i <= adminUsersTotalPages; i++) {
        pages.push(i)
      }
    } else {
      pages.push(1)
      if (adminUsersPage <= 3) {
        pages.push(2, 3, 4, 5, '...', adminUsersTotalPages)
      } else if (adminUsersPage >= adminUsersTotalPages - 2) {
        pages.push('...', adminUsersTotalPages - 4, adminUsersTotalPages - 3, adminUsersTotalPages - 2, adminUsersTotalPages - 1, adminUsersTotalPages)
      } else {
        pages.push('...', adminUsersPage - 1, adminUsersPage, adminUsersPage + 1, '...', adminUsersTotalPages)
      }
    }
    return pages
  }


  if (!currentUser) {
    return (
      <div className="admin-page admin-console-v2">
        <PageHeader
          kicker="Admin Console"
          title="后台管理"
          description="请先登录并确保拥有管理员权限。"
        />
        <Panel>
          <EmptyState title="需要登录" description="后台操作需要管理员身份。">
            <Button variant="primary" onClick={() => openAuth('login')}>
              登录
            </Button>
          </EmptyState>
        </Panel>
      </div>
    )
  }

  if (!currentUser.isAdmin) {
    return (
      <div className="admin-page admin-console-v2">
        <PageHeader
          kicker="Admin Console"
          title="后台管理"
          description="当前账号没有管理员权限。"
        />
        <Panel>
          <EmptyState title="无权访问" description="请联系站点管理员开通权限。" />
        </Panel>
      </div>
    )
  }

  const adminCount = adminUsers.filter((user) => user.isAdmin).length
  const bannedCount = adminUsers.filter((user) => user.isBanned).length

  return (
    <div className="admin-page admin-console-v2">
      <PageHeader
        kicker="Admin Console"
        title="星栈后台管理"
        description="用户、题库与测试用例配置集中在一个轻量控制台里，优先保证可扫读和低性能设备流畅度。"
        actions={
          <Button variant="ghost" onClick={loadAdminUsers} loading={adminLoading}>
            刷新用户
          </Button>
        }
      />

      <div className="admin-tabs" role="tablist" aria-label="后台功能模块">
        <button type="button" role="tab" aria-selected={adminTab === 'users'} className={adminTab === 'users' ? 'active' : ''} onClick={() => setAdminTab('users')}>
          用户管理
        </button>
        <button type="button" role="tab" aria-selected={adminTab === 'problems'} className={adminTab === 'problems' ? 'active' : ''} onClick={() => setAdminTab('problems')}>
          题目管理
        </button>
        <button type="button" role="tab" aria-selected={adminTab === 'reports'} className={adminTab === 'reports' ? 'active' : ''} onClick={() => setAdminTab('reports')}>
          举报处理
        </button>
        <button type="button" role="tab" aria-selected={adminTab === 'logs'} className={adminTab === 'logs' ? 'active' : ''} onClick={() => setAdminTab('logs')}>
          操作日志
        </button>
        <button type="button" role="tab" aria-selected={adminTab === 'stats'} className={adminTab === 'stats' ? 'active' : ''} onClick={() => setAdminTab('stats')}>
          站点看板
        </button>
      </div>

      {adminTab === 'users' && (
      <>
      <div className="admin-summary admin-summary-v2">
        <Panel className="summary-card admin-metric-card">
          <div className="summary-label">Users</div>
          <div className="summary-value">{adminUsers.length}</div>
        </Panel>
        <Panel className="summary-card admin-metric-card">
          <div className="summary-label">Admins</div>
          <div className="summary-value">{adminCount}</div>
        </Panel>
        <Panel className="summary-card admin-metric-card">
          <div className="summary-label">Banned</div>
          <div className="summary-value">{bannedCount}</div>
        </Panel>
      </div>

      <section className="admin-section admin-users-panel">
        <div className="admin-list-header">
          <div>
            <Badge tone="info">Users</Badge>
            <strong>用户管理</strong>
          </div>
          <span>{filteredAdminUsers.length} / {adminUsers.length} 个账号</span>
        </div>
        {adminError && <ErrorState description={adminError} onRetry={() => void loadAdminUsers()} />}
        {adminActionError && <div className="auth-error">{adminActionError}</div>}
        {adminActionMessage && <div className="auth-success">{adminActionMessage}</div>}
        <div className="admin-filter-row" aria-label="用户筛选">
          <input
            className="auth-input"
            value={adminUserQuery}
            onChange={(event) => setAdminUserQuery(event.target.value)}
            placeholder="搜索 ID、昵称或邮箱"
            aria-label="搜索用户"
          />
          <select
            className="auth-input"
            value={adminUserStatus}
            onChange={(event) => setAdminUserStatus(event.target.value as typeof adminUserStatus)}
            aria-label="用户状态"
          >
            <option value="all">全部状态</option>
            <option value="normal">正常</option>
            <option value="banned">已封禁</option>
          </select>
          <select
            className="auth-input"
            value={adminUserRole}
            onChange={(event) => setAdminUserRole(event.target.value as typeof adminUserRole)}
            aria-label="用户角色"
          >
            <option value="all">全部角色</option>
            <option value="user">普通用户</option>
            <option value="admin">管理员</option>
          </select>
          {(adminUserQuery || adminUserStatus !== 'all' || adminUserRole !== 'all') && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAdminUserQuery('')
                setAdminUserStatus('all')
                setAdminUserRole('all')
              }}
            >
              清除筛选
            </Button>
          )}
        </div>
        <div className="admin-form admin-form-v2">
          <label>
            新用户 ID
            <input
              className="auth-input"
              value={newUserId}
              onChange={(event) => setNewUserId(event.target.value)}
            />
          </label>
          <label>
            名称
            <input
              className="auth-input"
              value={newUserName}
              onChange={(event) => setNewUserName(event.target.value)}
            />
          </label>
          <label>
            初始密码
            <input
              className="auth-input"
              type="password"
              value={newUserPassword}
              onChange={(event) => setNewUserPassword(event.target.value)}
            />
          </label>
          <label className="admin-checkbox">
            <input
              type="checkbox"
              checked={newUserIsAdmin}
              onChange={(event) => setNewUserIsAdmin(event.target.checked)}
            />
            设为管理员
          </label>
          <Button variant="primary" onClick={() => void handleCreateUser()} loading={adminCreating}>
            创建用户
          </Button>
        </div>

        <div className="admin-table admin-table-v2">
          <div className="admin-row admin-row-head">
            <div>ID</div>
            <div>名称</div>
            <div>角色</div>
            <div>状态</div>
            <div>创建时间</div>
            <div>操作</div>
          </div>
          {adminLoading ? (
            <div className="ops-skeleton-list admin-table-loading">
              {Array.from({ length: 5 }, (_, index) => <div key={index} className="skeleton skeleton-row" />)}
            </div>
          ) : currentAdminUsers.map((user) => (
            <div key={user.id} className="admin-row">
              <div data-user-id>{user.id}</div>
              <div className="admin-user-name" data-user-name>{user.name}</div>
              <div>
                <Badge tone={user.isAdmin ? 'warning' : 'neutral'}>
                  {user.isAdmin ? '管理员' : '用户'}
                </Badge>
              </div>
              <div className={user.isBanned ? 'status-banned' : 'status-normal'}>
                <Badge tone={user.isBanned ? 'danger' : 'success'}>
                {user.isBanned ? '封禁' : '正常'}
                </Badge>
              </div>
              <div>{user.createdAt ? new Date(user.createdAt).toLocaleString() : '-'}</div>
              <div className="admin-row-actions">
                {!user.isAdmin && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (window.confirm(`确认将 ${user.id} 提升为管理员？`)) {
                        void handleUserAction(`/api/admin/users/${user.id}/promote`)
                      }
                    }}
                    loading={adminActionBusyKey === `/api/admin/users/${user.id}/promote`}
                  >
                    提升管理员
                  </Button>
                )}
                {user.isAdmin && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (window.confirm(`确认取消 ${user.id} 的管理员权限？`)) {
                        void handleUserAction(`/api/admin/users/${user.id}/demote`)
                      }
                    }}
                    loading={adminActionBusyKey === `/api/admin/users/${user.id}/demote`}
                  >
                    降为普通
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const password = window.prompt('新密码（至少 6 位）')
                    if (!password) return
                    if (window.confirm(`确认重置 ${user.id} 的登录密码？`)) {
                      void handleUserAction(`/api/admin/users/${user.id}/reset-password`, {
                        password,
                      })
                    }
                  }}
                  loading={adminActionBusyKey === `/api/admin/users/${user.id}/reset-password`}
                >
                  重置密码
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const action = user.isBanned ? '解除封禁' : '封禁'
                    if (window.confirm(`确认${action}用户 ${user.id}？`)) {
                      void handleUserAction(`/api/admin/users/${user.id}/ban`, {
                        banned: !user.isBanned,
                      })
                    }
                  }}
                  loading={adminActionBusyKey === `/api/admin/users/${user.id}/ban`}
                >
                  {user.isBanned ? '解除封禁' : '封禁'}
                </Button>
                <Button variant="danger" size="sm" onClick={() => void handleDeleteUser(user.id)} loading={adminActionBusyKey === `delete:${user.id}`}>
                  删除
                </Button>
              </div>
            </div>
          ))}
          {filteredAdminUsers.length === 0 && !adminLoading && (
            <EmptyState
              title={adminUsers.length === 0 ? '暂无用户数据' : '没有匹配用户'}
              description={adminUsers.length === 0 ? '刷新后仍为空时，请检查后端管理接口和数据库初始化状态。' : '请调整搜索条件或筛选器。'}
            />
          )}
        </div>

        {adminUsersTotalPages > 1 && (
          <div className="pagination">
            <button
              className="pagination-btn"
              onClick={() => handleAdminUsersPageChange(adminUsersPage - 1)}
              disabled={adminUsersPage === 1}
            >
              上一页
            </button>

            <div className="pagination-numbers">
              {renderAdminUsersPageNumbers().map((page, index) => (
                page === '...' ? (
                  <span key={`ellipsis-${index}`} className="pagination-ellipsis">
                    ...
                  </span>
                ) : (
                  <button
                    key={page}
                    className={`pagination-number ${adminUsersPage === page ? 'active' : ''}`}
                    onClick={() => handleAdminUsersPageChange(page as number)}
                  >
                    {page}
                  </button>
                )
              ))}
            </div>

            <button
              className="pagination-btn"
              onClick={() => handleAdminUsersPageChange(adminUsersPage + 1)}
              disabled={adminUsersPage === adminUsersTotalPages}
            >
              下一页
            </button>

            <div className="pagination-jump">
              <span>跳转到</span>
              <input
                type="text"
                className="pagination-input"
                value={adminUsersPageInput}
                onChange={(e) => handleAdminUsersPageInputChange(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdminUsersPageInputSubmit()}
              />
              <button className="pagination-go" onClick={handleAdminUsersPageInputSubmit}>
                GO
              </button>
            </div>
          </div>
        )}
      </section>
      </>
      )}

      {adminTab === 'problems' && <AdminProblemsSection onEdit={(id) => navigate(`/edit-problem/${id}`)} />}
      {adminTab === 'reports' && <AdminReportsSection />}
      {adminTab === 'logs' && <AdminAuditLogsSection />}
      {adminTab === 'stats' && <AdminStatsSection />}
    </div>
  )
}

// === 题目审核 ===

type AdminProblemReview = {
  problem: {
    id: number
    title: string
    difficulty: string
    tags: string[]
    statement: string
    inputDesc: string
    outputDesc: string
    dataRange?: string
    status: string
    creatorName?: string
    createdAt?: string
  }
  testcases: { id: number; isSample: boolean; input: string; output: string; timeLimitMs: number }[]
  revisions: { id: number; version: number; status: string; note?: string; changedByName?: string; createdAt: string; statementLength: number; testcaseCount: number }[]
}

function AdminProblemsSection({ onEdit }: { onEdit: (id: number) => void }) {
  const [status, setStatus] = useState<'all' | 'draft' | 'pending_review' | 'published' | 'hidden'>('all')
  const [query, setQuery] = useState('')
  const [problems, setProblems] = useState<AdminProblem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [review, setReview] = useState<AdminProblemReview | null>(null)
  const [reviewLoading, setReviewLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (status !== 'all') params.set('status', status)
      if (query.trim()) params.set('q', query.trim())
      const { response, data } = await fetchJson<{ problems: AdminProblem[]; message?: string }>(
        `/api/admin/problems?${params.toString()}`
      )
      if (!response.ok) {
        setError(data?.message || '题目列表加载失败')
        return
      }
      setProblems(data?.problems || [])
    } catch {
      setError('网络异常，暂时无法加载题目')
    } finally {
      setLoading(false)
    }
  }, [query, status])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), query.trim() ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [load, query])

  const updateStatus = async (problem: AdminProblem, nextStatus: string) => {
    const statusText = nextStatus === 'published' ? '发布' : nextStatus === 'hidden' ? '隐藏' : nextStatus === 'pending_review' ? '标记为审核中' : '转为草稿'
    if (!window.confirm(`确认将题目「${problem.title}」${statusText}？`)) return
    const note = window.prompt('审核备注（可选，最多 500 字）', '')
    if (note === null) return
    setBusyId(problem.id)
    setError('')
    try {
      const { response, data } = await fetchJson<{ message?: string }>(`/api/admin/problems/${problem.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: nextStatus, note: note.slice(0, 500) }),
      })
      if (!response.ok) {
        setError(data?.message || '更新题目状态失败')
        return
      }
      await load()
    } catch {
      setError('网络异常，题目状态未更新')
    } finally {
      setBusyId(null)
    }
  }

  const deleteProblem = async (problem: AdminProblem) => {
    if (!window.confirm(`确认删除题目「${problem.title}」？该操作不可恢复。`)) return
    setBusyId(problem.id)
    setError('')
    try {
      const { response, data } = await fetchJson<{ message?: string }>(`/api/admin/problems/${problem.id}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        setError(data?.message || '删除题目失败')
        return
      }
      await load()
    } catch {
      setError('网络异常，题目未删除')
    } finally {
      setBusyId(null)
    }
  }

  const openReview = async (problem: AdminProblem) => {
    setReviewLoading(true)
    setError('')
    try {
      const { response, data } = await fetchJson<{ review?: AdminProblemReview; message?: string }>(`/api/admin/problems/${problem.id}/review`)
      if (!response.ok || !data?.review) {
        setError(data?.message || '审核详情加载失败')
        return
      }
      setReview(data.review)
    } catch {
      setError('网络异常，审核详情加载失败')
    } finally {
      setReviewLoading(false)
    }
  }

  const statusLabel = (value: string) => value === 'draft' ? '草稿' : value === 'pending_review' ? '待审核' : value === 'hidden' ? '隐藏' : '已发布'

  return (
    <section className="admin-section admin-users-panel">
      <div className="admin-list-header">
        <div>
          <Badge tone="info">Problems</Badge>
          <strong>题目审核</strong>
        </div>
        <span>{problems.length} 道题目</span>
      </div>
      <div className="admin-filter-row" aria-label="题目筛选">
        <input
          className="auth-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索题号、标题、别名或标签"
          aria-label="搜索题目"
        />
        <select className="auth-input" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} aria-label="题目状态">
          <option value="all">全部状态</option>
          <option value="draft">草稿</option>
          <option value="pending_review">待审核</option>
          <option value="published">已发布</option>
          <option value="hidden">已隐藏</option>
        </select>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>刷新</Button>
      </div>
      {error && <ErrorState description={error} onRetry={() => void load()} />}
      {review && (
        <Panel className="admin-review-panel">
          <div className="admin-list-header">
            <div>
              <Badge tone="info">Review Detail</Badge>
              <strong>P{review.problem.id} · {review.problem.title}</strong>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setReview(null)}>关闭详情</Button>
          </div>
          <div className="admin-review-meta">
            <span>创建者：{review.problem.creatorName || '-'}</span>
            <span>难度：{review.problem.difficulty}</span>
            <span>测试点：{review.testcases.length}</span>
            <span>版本：{review.revisions.length}</span>
          </div>
          <div className="admin-review-content">
            <div><strong>题目描述</strong><p>{review.problem.statement || '暂无描述'}</p></div>
            <div><strong>输入 / 输出</strong><p>{review.problem.inputDesc || '-'}<br />{review.problem.outputDesc || '-'}</p></div>
          </div>
          <div className="admin-review-testcases">
            <strong>测试点预览</strong>
            {review.testcases.map((testcase) => (
              <div key={testcase.id} className="admin-review-testcase">
                <span>{testcase.isSample ? '样例' : '测试点'} · {testcase.timeLimitMs}ms</span>
                <code>输入：{testcase.input || '(空)'}\n输出：{testcase.output || '(空)'}</code>
              </div>
            ))}
          </div>
          <div className="admin-review-history">
            <strong>版本摘要</strong>
            {review.revisions.map((revision) => (
              <span key={revision.id}>v{revision.version} · {revision.note || '更新'} · {revision.changedByName || '系统'} · {revision.testcaseCount} 个测试点</span>
            ))}
          </div>
        </Panel>
      )}
      {loading ? (
        <LoadingState variant="list" label="正在加载题目…" />
      ) : problems.length === 0 ? (
        <EmptyState title="没有匹配题目" description="调整筛选条件后再试。" />
      ) : (
        <div className="admin-table admin-table-v2 admin-problem-table">
          <div className="admin-row admin-row-head">
            <div>题目</div>
            <div>难度</div>
            <div>状态</div>
            <div>测试点</div>
            <div>创建者</div>
            <div>操作</div>
          </div>
          {problems.map((problem) => (
            <div className="admin-row" key={problem.id}>
              <div>
                <strong>{problem.title}</strong>
                <span className="admin-problem-slug">P{problem.id} · {problem.slug || '-'}</span>
              </div>
              <div>{problem.difficulty}</div>
              <div><Badge tone={problem.status === 'published' ? 'success' : problem.status === 'hidden' ? 'danger' : problem.status === 'pending_review' ? 'info' : 'warning'}>{statusLabel(problem.status)}</Badge></div>
              <div>{problem.testcaseCount || 0}</div>
              <div>{problem.creatorName || problem.creatorId || '-'}</div>
              <div className="admin-row-actions">
                <Button variant="ghost" size="sm" loading={reviewLoading} onClick={() => void openReview(problem)}>审核详情</Button>
                <Button variant="ghost" size="sm" onClick={() => onEdit(problem.id)}>编辑</Button>
                {problem.status !== 'published' && <Button variant="ghost" size="sm" loading={busyId === problem.id} onClick={() => void updateStatus(problem, 'published')}>发布</Button>}
                {problem.status === 'published' && <Button variant="ghost" size="sm" loading={busyId === problem.id} onClick={() => void updateStatus(problem, 'hidden')}>隐藏</Button>}
                {problem.status !== 'draft' && <Button variant="ghost" size="sm" loading={busyId === problem.id} onClick={() => void updateStatus(problem, 'draft')}>转草稿</Button>}
                <Button variant="danger" size="sm" loading={busyId === problem.id} onClick={() => void deleteProblem(problem)}>删除</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// === 管理员操作日志 ===

function AdminAuditLogsSection() {
  const [logs, setLogs] = useState<AdminAuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { response, data } = await fetchJson<{ logs: AdminAuditLog[]; message?: string }>('/api/admin/audit-logs?limit=100')
      if (!response.ok) {
        setError(data?.message || '操作日志加载失败')
        return
      }
      setLogs(data?.logs || [])
    } catch {
      setError('网络异常，暂时无法加载操作日志')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  return (
    <section className="admin-section admin-users-panel">
      <div className="admin-list-header">
        <div>
          <Badge tone="info">Audit</Badge>
          <strong>管理员操作日志</strong>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>刷新</Button>
      </div>
      {error && <ErrorState description={error} onRetry={() => void load()} />}
      {loading ? (
        <LoadingState variant="list" label="正在加载操作日志…" />
      ) : logs.length === 0 ? (
        <EmptyState title="暂无操作记录" description="管理员执行敏感操作后会在这里留下记录。" />
      ) : (
        <div className="admin-audit-list">
          {logs.map((log) => (
            <div className="admin-audit-item" key={log.id}>
              <div>
                <strong>{log.adminName}</strong>
                <span className="admin-audit-action">{log.action}</span>
                <span>目标：{log.targetType}{log.targetId ? ` #${log.targetId}` : ''}</span>
              </div>
              <time dateTime={log.createdAt}>{new Date(log.createdAt).toLocaleString('zh-CN')}</time>
              {log.detail && <code>{log.detail}</code>}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// === 举报处理 ===

function AdminReportsSection() {
  const [status, setStatus] = useState<'open' | 'resolved'>('open')
  const [reports, setReports] = useState<AdminReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reportNotes, setReportNotes] = useState<Record<number, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const { response, data } = await fetchJson<{ reports: AdminReport[]; message?: string }>(
      `/api/admin/reports?status=${status}`
    )
    if (response.ok && data) {
      setReports(data.reports || [])
    } else {
      setError(data?.message || '加载失败')
    }
    setLoading(false)
  }, [status])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const handleDeleteAndResolve = async (report: AdminReport) => {
    if (!window.confirm(`确认删除举报目标并将举报 #${report.id} 标记为已处理？`)) return
    setBusy(true)
    setError('')
    try {
      let ok = false
      if (report.targetType === 'post') {
        const r = await fetchJson(`/api/admin/discussions/posts/${report.targetId}`, { method: 'DELETE' })
        ok = r.response.ok
      } else if (report.targetType === 'comment') {
        const r = await fetchJson(`/api/admin/discussions/comments/${report.targetId}`, { method: 'DELETE' })
        ok = r.response.ok
      } else if (report.targetType === 'message') {
        const r = await fetchJson(`/api/admin/messages/${report.targetId}`, { method: 'DELETE' })
        ok = r.response.ok
      } else {
        const r = await fetchJson(`/api/admin/users/${report.targetId}/ban`, {
          method: 'POST',
          body: JSON.stringify({ banned: true }),
        })
        ok = r.response.ok
      }
      if (!ok) {
        setError('删除目标失败，请检查目标是否仍存在')
        return
      }
      const resolved = await fetchJson<{ message?: string }>(`/api/admin/reports/${report.id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ note: reportNotes[report.id] || '' }),
      })
      if (!resolved.response.ok) {
        setError(resolved.data?.message || '目标已处理，但举报状态更新失败')
        return
      }
      await load()
    } catch {
      setError('网络异常，举报处理未完成')
    } finally {
      setBusy(false)
    }
  }

  const handleResolveOnly = async (report: AdminReport) => {
    setBusy(true)
    setError('')
    try {
      const { response, data } = await fetchJson<{ message?: string }>(`/api/admin/reports/${report.id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ note: reportNotes[report.id] || '' }),
      })
      if (!response.ok) {
        setError(data?.message || '标记举报失败')
        return
      }
      await load()
    } catch {
      setError('网络异常，举报处理未完成')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="admin-section admin-users-panel">
      <div className="admin-list-header">
        <div>
          <Badge tone={status === 'open' ? 'danger' : 'neutral'}>
            {status === 'open' ? '待处理' : '已处理'}
          </Badge>
          <strong>举报处理</strong>
        </div>
        <div className="admin-tabs small">
          <button type="button" className={status === 'open' ? 'active' : ''} onClick={() => setStatus('open')}>
            待处理
          </button>
          <button type="button" className={status === 'resolved' ? 'active' : ''} onClick={() => setStatus('resolved')}>
            已处理
          </button>
        </div>
      </div>
      {error && <ErrorState description={error} onRetry={() => void load()} />}
      {loading ? (
        <LoadingState variant="list" label="正在加载举报…" />
      ) : reports.length === 0 ? (
        <EmptyState title="没有举报" description={status === 'open' ? '当前没有待处理的举报。' : '还没有已处理的举报。'} />
      ) : (
        <div className="admin-report-list">
          {reports.map((report) => (
            <div key={report.id} className="admin-report-item">
              <div className="admin-report-head">
                <span className={`admin-report-type ${report.targetType}`}>
                  {report.targetType === 'post' ? '帖子' : report.targetType === 'comment' ? '评论' : report.targetType === 'message' ? '消息' : '用户'}
                </span>
                <span className="admin-report-by">{report.reporterName} 举报</span>
                <span className="admin-report-time">{new Date(report.createdAt).toLocaleString('zh-CN')}</span>
              </div>
              <div className="admin-report-summary">{report.summary}</div>
              <div className="admin-report-reason">原因：{report.reason}</div>
              {status === 'resolved' && report.resolutionNote && (
                <div className="admin-report-note-readonly">处理备注：{report.resolutionNote}</div>
              )}
              {status === 'open' && (
                <div className="admin-report-actions admin-report-actions-v2">
                  <textarea
                    className="admin-report-note"
                    value={reportNotes[report.id] || ''}
                    onChange={(event) => setReportNotes((current) => ({ ...current, [report.id]: event.target.value }))}
                    placeholder="处理备注（可选）"
                    maxLength={1000}
                    rows={2}
                  />
                  <div className="admin-report-buttons">
                    <Button variant="danger" size="sm" loading={busy} onClick={() => void handleDeleteAndResolve(report)}>
                      删除目标并处理
                    </Button>
                    <Button variant="ghost" size="sm" loading={busy} onClick={() => void handleResolveOnly(report)}>
                      仅标记已处理
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// === 站点看板 ===

function AdminStatsSection() {
  const [stats, setStats] = useState<AdminStatsResponse['stats'] | null>(null)
  const [metrics, setMetrics] = useState<AdminMetricsResponse['metrics'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [statsResult, metricsResult] = await Promise.all([
        fetchJson<AdminStatsResponse & { message?: string }>('/api/admin/stats'),
        fetchJson<AdminMetricsResponse & { message?: string }>('/api/admin/metrics'),
      ])
      if (statsResult.response.ok && statsResult.data) setStats(statsResult.data.stats)
      else setError(statsResult.data?.message || '看板数据加载失败')
      if (metricsResult.response.ok && metricsResult.data) setMetrics(metricsResult.data.metrics)
      else if (statsResult.response.ok) setError(metricsResult.data?.message || '系统监控加载失败')
    } catch {
      setError('网络异常，暂时无法加载看板')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const cards = stats
    ? [
        { label: '用户', value: stats.users },
        { label: '帖子', value: stats.posts },
        { label: '评论', value: stats.comments },
        { label: '聊天消息', value: stats.chatMessages },
        { label: '聊天室', value: stats.rooms },
        { label: '今日活跃', value: stats.todayActive },
        { label: '待处理举报', value: stats.openReports },
        { label: '待审核题目', value: stats.pendingProblems },
      ]
    : []

  return (
    <section className="admin-section">
      <div className="admin-list-header">
        <div>
          <Badge tone="info">Overview</Badge>
          <strong>站点看板</strong>
        </div>
      </div>
      {loading ? (
        <LoadingState variant="list" label="正在加载数据看板…" />
      ) : error ? (
        <ErrorState description={error} onRetry={() => void load()} />
      ) : (
        <>
          <div className="admin-summary admin-summary-v2">
            {cards.map((card) => (
              <Panel key={card.label} className="summary-card admin-metric-card">
                <div className="summary-label">{card.label}</div>
                <div className="summary-value">{card.value}</div>
              </Panel>
            ))}
          </div>
          {metrics && (
            <div className="admin-system-metrics">
              <Panel className="admin-system-metric-card">
                <span>评测队列</span>
                <strong>{metrics.judge.activeJudges}/{metrics.judge.maxActiveJudges}</strong>
                <small>排队 {metrics.judge.queuedJudges}/{metrics.judge.maxQueuedJudges}</small>
              </Panel>
              <Panel className="admin-system-metric-card">
                <span>测试运行</span>
                <strong>{metrics.judge.activeRuns}/{metrics.judge.maxActiveRuns}</strong>
                <small>排队 {metrics.judge.queuedRuns}/{metrics.judge.maxQueuedRuns}</small>
              </Panel>
              <Panel className="admin-system-metric-card">
                <span>进程内存</span>
                <strong>{metrics.process.rss}</strong>
                <small>堆内存 {metrics.process.heapUsed}</small>
              </Panel>
              <Panel className="admin-system-metric-card">
                <span>数据库</span>
                <strong>{metrics.database.submissions.Accepted || 0} AC</strong>
                <small>{metrics.database.users} 用户 · {metrics.database.problems} 题目</small>
              </Panel>
              <Panel className={`admin-system-metric-card ${metrics.backup.healthy ? 'healthy' : 'unhealthy'}`}>
                <span>数据库备份</span>
                <strong>{metrics.backup.healthy ? '正常' : '需检查'}</strong>
                <small>{metrics.backup.latest ? `${metrics.backup.latest.size} · ${metrics.backup.retentionCount} 份` : '暂无备份记录'}</small>
              </Panel>
            </div>
          )}
        </>
      )}
    </section>
  )
}
