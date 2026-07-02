import { useState, useEffect, useCallback } from 'react'
import { useAppContext } from '../context/AppContext'
import { Badge, Button, EmptyState, PageHeader, Panel } from '../components/ui'
import { fetchJson } from '../utils'
import type { UserRecord, ApiResponse } from '../types'
import './CreatorAdminPages.css'

export default function AdminPage() {
  const { currentUser, openAuth } = useAppContext()
  const [adminUsers, setAdminUsers] = useState<UserRecord[]>([])
  const [adminLoading, setAdminLoading] = useState(false)
  const [adminError, setAdminError] = useState('')
  const [adminActionError, setAdminActionError] = useState('')
  const [adminActionMessage, setAdminActionMessage] = useState('')
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
    const { response, data } = await fetchJson<{ users: UserRecord[]; message?: string }>('/api/admin/users')
    if (!response.ok) {
      setAdminError(data?.message || '无法加载用户')
      setAdminLoading(false)
      return
    }
    setAdminUsers(data?.users || [])
    setAdminLoading(false)
  }, [])

  useEffect(() => {
    if (currentUser?.isAdmin) {
      loadAdminUsers()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.isAdmin])

  const handleCreateUser = async () => {
    setAdminActionError('')
    setAdminActionMessage('')
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
    loadAdminUsers()
  }

  const handleUserAction = async (url: string, body?: Record<string, unknown>) => {
    setAdminActionError('')
    setAdminActionMessage('')
    const { response, data } = await fetchJson<ApiResponse>(url, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!response.ok) {
      setAdminActionError(data?.message || '操作失败')
      return
    }
    setAdminActionMessage('操作已完成')
    loadAdminUsers()
  }

  const handleDeleteUser = async (id: string) => {
    if (!window.confirm(`确认删除用户 ${id} ?`)) return
    setAdminActionError('')
    setAdminActionMessage('')
    const { response, data } = await fetchJson<ApiResponse>(`/api/admin/users/${id}`, {
      method: 'DELETE',
    })
    if (!response.ok) {
      setAdminActionError(data?.message || '删除失败')
      return
    }
    setAdminActionMessage('用户已删除')
    loadAdminUsers()
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
        {adminError && <div className="auth-error">{adminError}</div>}
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
          <Button variant="primary" onClick={handleCreateUser}>
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
          {currentAdminUsers.map((user) => (
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
                    onClick={() => handleUserAction(`/api/admin/users/${user.id}/promote`)}
                  >
                    提升管理员
                  </Button>
                )}
                {user.isAdmin && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleUserAction(`/api/admin/users/${user.id}/demote`)}
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
                    handleUserAction(`/api/admin/users/${user.id}/reset-password`, {
                      password,
                    })
                  }}
                >
                  重置密码
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    handleUserAction(`/api/admin/users/${user.id}/ban`, {
                      banned: !user.isBanned,
                    })
                  }
                >
                  {user.isBanned ? '解除封禁' : '封禁'}
                </Button>
                <Button variant="danger" size="sm" onClick={() => handleDeleteUser(user.id)}>
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

    </div>
  )
}
