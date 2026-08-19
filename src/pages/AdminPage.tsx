import { useState, useEffect, useCallback } from 'react'
import { useAppContext } from '../context/AppContext'
import { Badge, Button, EmptyState, ErrorState, PageHeader, Panel } from '../components/ui'
import { fetchJson } from '../utils'
import type { AdminReport, AdminStatsResponse, UserRecord, ApiResponse } from '../types'
import './CreatorAdminPages.css'

export default function AdminPage() {
  const { currentUser, openAuth } = useAppContext()
  const [adminUsers, setAdminUsers] = useState<UserRecord[]>([])
  const [adminLoading, setAdminLoading] = useState(false)
  const [adminError, setAdminError] = useState('')
  const [adminActionError, setAdminActionError] = useState('')
  const [adminActionMessage, setAdminActionMessage] = useState('')
  const [adminActionBusy, setAdminActionBusy] = useState(false)
  const [adminCreating, setAdminCreating] = useState(false)
  const [adminTab, setAdminTab] = useState<'users' | 'reports' | 'stats'>('users')
  const [adminUsersPage, setAdminUsersPage] = useState(1)
  const [adminUsersPageInput, setAdminUsersPageInput] = useState('1')
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
      await loadAdminUsers()
    } catch {
      setAdminActionError('网络异常，用户创建未完成')
    } finally {
      setAdminCreating(false)
    }
  }

  const handleUserAction = async (url: string, body?: Record<string, unknown>) => {
    setAdminActionError('')
    setAdminActionMessage('')
    setAdminActionBusy(true)
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
      await loadAdminUsers()
    } catch {
      setAdminActionError('网络异常，操作未完成')
    } finally {
      setAdminActionBusy(false)
    }
  }

  const handleDeleteUser = async (id: string) => {
    if (!window.confirm(`确认删除用户 ${id} ?`)) return
    setAdminActionError('')
    setAdminActionMessage('')
    setAdminActionBusy(true)
    try {
      const { response, data } = await fetchJson<ApiResponse>(`/api/admin/users/${id}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        setAdminActionError(data?.message || '删除失败')
        return
      }
      setAdminActionMessage('用户已删除')
      await loadAdminUsers()
    } catch {
      setAdminActionError('网络异常，删除未完成')
    } finally {
      setAdminActionBusy(false)
    }
  }

  const adminUsersTotalPages = Math.ceil(adminUsers.length / adminUsersPerPage)
  const adminUsersStartIndex = (adminUsersPage - 1) * adminUsersPerPage
  const adminUsersEndIndex = adminUsersStartIndex + adminUsersPerPage
  const currentAdminUsers = adminUsers.slice(adminUsersStartIndex, adminUsersEndIndex)

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
          <Button variant="ghost" onClick={loadAdminUsers} disabled={adminLoading}>
            刷新用户
          </Button>
        }
      />

      <div className="admin-tabs" role="tablist">
        <button type="button" className={adminTab === 'users' ? 'active' : ''} onClick={() => setAdminTab('users')}>
          用户管理
        </button>
        <button type="button" className={adminTab === 'reports' ? 'active' : ''} onClick={() => setAdminTab('reports')}>
          举报处理
        </button>
        <button type="button" className={adminTab === 'stats' ? 'active' : ''} onClick={() => setAdminTab('stats')}>
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
          <span>{adminUsers.length} 个账号</span>
        </div>
        {adminError && <ErrorState description={adminError} onRetry={() => void loadAdminUsers()} />}
        {adminActionError && <div className="auth-error">{adminActionError}</div>}
        {adminActionMessage && <div className="auth-success">{adminActionMessage}</div>}
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
                    onClick={() => void handleUserAction(`/api/admin/users/${user.id}/promote`)}
                    loading={adminActionBusy}
                  >
                    提升管理员
                  </Button>
                )}
                {user.isAdmin && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleUserAction(`/api/admin/users/${user.id}/demote`)}
                    loading={adminActionBusy}
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
                    void handleUserAction(`/api/admin/users/${user.id}/reset-password`, {
                      password,
                    })
                  }}
                  loading={adminActionBusy}
                >
                  重置密码
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void handleUserAction(`/api/admin/users/${user.id}/ban`, {
                      banned: !user.isBanned,
                    })
                  }
                  loading={adminActionBusy}
                >
                  {user.isBanned ? '解除封禁' : '封禁'}
                </Button>
                <Button variant="danger" size="sm" onClick={() => void handleDeleteUser(user.id)} loading={adminActionBusy}>
                  删除
                </Button>
              </div>
            </div>
          ))}
          {adminUsers.length === 0 && !adminLoading && (
            <EmptyState title="暂无用户数据" description="刷新后仍为空时，请检查后端管理接口和数据库初始化状态。" />
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

      {adminTab === 'reports' && <AdminReportsSection />}
      {adminTab === 'stats' && <AdminStatsSection />}
    </div>
  )
}

// === 举报处理 ===

function AdminReportsSection() {
  const [status, setStatus] = useState<'open' | 'resolved'>('open')
  const [reports, setReports] = useState<AdminReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

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
    setBusy(true)
    setError('')
    try {
      let ok = false
      if (report.targetType === 'post') {
        const r = await fetchJson(`/api/discussions/${report.targetId}`, { method: 'DELETE' })
        ok = r.response.ok
      } else if (report.targetType === 'comment') {
        const r = await fetchJson(`/api/discussions/comments/${report.targetId}`, { method: 'DELETE' })
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
      await fetchJson(`/api/admin/reports/${report.id}/resolve`, { method: 'POST' })
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
      const { response, data } = await fetchJson<{ message?: string }>(`/api/admin/reports/${report.id}/resolve`, { method: 'POST' })
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
        <div className="oj-loading">加载中...</div>
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
              {status === 'open' && (
                <div className="admin-report-actions">
                  <Button variant="danger" size="sm" loading={busy} onClick={() => void handleDeleteAndResolve(report)}>
                    删除目标并处理
                  </Button>
                  <Button variant="ghost" size="sm" loading={busy} onClick={() => void handleResolveOnly(report)}>
                    仅标记已处理
                  </Button>
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { response, data } = await fetchJson<AdminStatsResponse & { message?: string }>('/api/admin/stats')
      if (response.ok && data) setStats(data.stats)
      else setError(data?.message || '看板数据加载失败')
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
        <div className="oj-loading">加载中...</div>
      ) : error ? (
        <ErrorState description={error} onRetry={() => void load()} />
      ) : (
        <div className="admin-summary admin-summary-v2">
          {cards.map((card) => (
            <Panel key={card.label} className="summary-card admin-metric-card">
              <div className="summary-label">{card.label}</div>
              <div className="summary-value">{card.value}</div>
            </Panel>
          ))}
        </div>
      )}
    </section>
  )
}
