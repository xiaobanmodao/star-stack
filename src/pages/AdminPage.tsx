import { useState, useEffect, useCallback } from 'react'
import { useAppContext } from '../context/AppContext'
import { fetchJson } from '../utils'
import type { UserRecord, ApiResponse } from '../types'

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
      <section className="section">
        <div className="section-header">
          <h2>后台管理</h2>
        </div>
        <p>请先登录并确保拥有管理员权限。</p>
        <button className="primary" onClick={() => openAuth('login')}>
          登录
        </button>
      </section>
    )
  }

  if (!currentUser.isAdmin) {
    return (
      <section className="section">
        <div className="section-header">
          <h2>后台管理</h2>
        </div>
        <p>你没有管理员权限。</p>
      </section>
    )
  }

  const adminCount = adminUsers.filter((user) => user.isAdmin).length
  const bannedCount = adminUsers.filter((user) => user.isBanned).length

  return (
    <div className="admin-page">
      <div className="admin-hero">
        <div>
          <div className="admin-title">星栈后台管理</div>
          <div className="admin-subtitle">用户、题库与测试用例配置</div>
        </div>
        <div className="admin-actions">
          <button className="ghost" onClick={loadAdminUsers} disabled={adminLoading}>
            刷新用户
          </button>
        </div>
      </div>

      <div className="admin-summary">
        <div className="summary-card">
          <div className="summary-label">Users</div>
          <div className="summary-value">{adminUsers.length}</div>
        </div>
        <div className="summary-card">
          <div className="summary-label">Admins</div>
          <div className="summary-value">{adminCount}</div>
        </div>
        <div className="summary-card">
          <div className="summary-label">Banned</div>
          <div className="summary-value">{bannedCount}</div>
        </div>
      </div>

      <section className="admin-section">
        <div className="admin-list-header">
          <div>用户管理</div>
        </div>
        {adminError && <div className="auth-error">{adminError}</div>}
        {adminActionError && <div className="auth-error">{adminActionError}</div>}
        {adminActionMessage && <div className="auth-success">{adminActionMessage}</div>}
        <div className="admin-form">
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
          <button className="primary" onClick={handleCreateUser}>
            创建用户
          </button>
        </div>

        <div className="admin-table">
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
              <div>{user.isAdmin ? '管理员' : '用户'}</div>
              <div className={user.isBanned ? 'status-banned' : 'status-normal'}>
                {user.isBanned ? '封禁' : '正常'}
              </div>
              <div>{user.createdAt ? new Date(user.createdAt).toLocaleString() : '-'}</div>
              <div className="admin-row-actions">
                {!user.isAdmin && (
                  <button
                    className="ghost small"
                    onClick={() => handleUserAction(`/api/admin/users/${user.id}/promote`)}
                  >
                    提升管理员
                  </button>
                )}
                {user.isAdmin && (
                  <button
                    className="ghost small"
                    onClick={() => handleUserAction(`/api/admin/users/${user.id}/demote`)}
                  >
                    降为普通
                  </button>
                )}
                <button
                  className="ghost small"
                  onClick={() => {
                    const password = window.prompt('新密码（至少 6 位）')
                    if (!password) return
                    handleUserAction(`/api/admin/users/${user.id}/reset-password`, {
                      password,
                    })
                  }}
                >
                  重置密码
                </button>
                <button
                  className="ghost small"
                  onClick={() =>
                    handleUserAction(`/api/admin/users/${user.id}/ban`, {
                      banned: !user.isBanned,
                    })
                  }
                >
                  {user.isBanned ? '解除封禁' : '封禁'}
                </button>
                <button className="danger small" onClick={() => handleDeleteUser(user.id)}>
                  删除
                </button>
              </div>
            </div>
          ))}
          {adminUsers.length === 0 && !adminLoading && (
            <div className="admin-empty">暂无用户数据</div>
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

