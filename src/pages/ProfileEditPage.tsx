import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ExternalLink, Sprout, Unlink } from 'lucide-react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAppContext } from '../context/AppContext'
import DecoratedAvatar from '../components/profile/DecoratedAvatar'
import type {
  ApiResponse,
  AuthSession,
  AvatarFrameId,
  AvatarOverlayId,
  DecorationOptionsResponse,
  ConnectedApplication,
  ConnectedApplicationsResponse,
  EquippedTitleId,
  UserResponse,
} from '../types'
import { fetchJson, openInNewTab } from '../utils'
import { Badge, Button, LoadingState, PageHeader, Panel } from '../components/ui'
import { useToast } from '../components/ui/ToastContext'
import './ProfileEditPage.css'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const CONNECTED_APP_STATUS = {
  not_connected: { label: '未连接', tone: 'neutral' as const },
  connected: { label: '已连接', tone: 'success' as const },
  revocation_pending: { label: '撤销处理中', tone: 'warning' as const },
}

const getRequestErrorMessage = (error: unknown, fallback: string) => (
  error instanceof Error && error.message ? error.message : fallback
)

export default function ProfileEditPage() {
  const navigate = useNavigate()
  const { currentUser, setCurrentUser } = useAppContext()
  const { showToast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mountedRef = useRef(true)
  const [editName, setEditName] = useState(() => currentUser?.name || '')
  const [editEmail, setEditEmail] = useState(() => currentUser?.email || '')
  const [editEmailCode, setEditEmailCode] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [emailSending, setEmailSending] = useState(false)
  const [emailSaving, setEmailSaving] = useState(false)
  const [emailCooldown, setEmailCooldown] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [sessions, setSessions] = useState<AuthSession[]>([])
  const [sessionActionBusy, setSessionActionBusy] = useState('')
  const [connectedApps, setConnectedApps] = useState<ConnectedApplication[]>([])
  const [connectedAppsLoading, setConnectedAppsLoading] = useState(true)
  const [connectedAppsError, setConnectedAppsError] = useState('')
  const [connectedAppsReloadKey, setConnectedAppsReloadKey] = useState(0)
  const [connectedAppBusy, setConnectedAppBusy] = useState('')
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [decorations, setDecorations] = useState<DecorationOptionsResponse | null>(null)
  const [decorationLoading, setDecorationLoading] = useState(true)
  const [decorationSaving, setDecorationSaving] = useState(false)
  const [selectedFrame, setSelectedFrame] = useState<AvatarFrameId>(currentUser?.avatarFrame || 'none')
  const [selectedOverlay, setSelectedOverlay] = useState<AvatarOverlayId>(currentUser?.avatarOverlay || 'none')
  const [selectedTitle, setSelectedTitle] = useState<EquippedTitleId | null>(currentUser?.equippedTitle || null)
  const [editError, setEditError] = useState('')

  const showEditSuccess = (message: string) => {
    if (!mountedRef.current) return
    setEditError('')
    showToast(message, 'success')
  }

  const showEditError = (message: string) => {
    if (!mountedRef.current) return
    setEditError('')
    showToast(message, 'error')
  }

  useEffect(() => () => {
    mountedRef.current = false
  }, [])

  useEffect(() => {
    if (emailCooldown <= 0) return
    const timer = window.setInterval(() => {
      setEmailCooldown((value) => Math.max(0, value - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [emailCooldown])

  useEffect(() => {
    if (!currentUser) return
    let cancelled = false
    void fetchJson<{ sessions: AuthSession[] }>('/api/me/sessions').then(({ response, data }) => {
      if (!cancelled && response.ok) setSessions(data?.sessions || [])
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [currentUser])

  useEffect(() => {
    if (!currentUser) return
    let cancelled = false
    const controller = new AbortController()
    setConnectedAppsLoading(true)
    setConnectedAppsError('')
    void fetchJson<ConnectedApplicationsResponse>('/api/me/connected-apps', {
      signal: controller.signal,
    }).then(({ response, data }) => {
      if (cancelled || controller.signal.aborted) return
      if (!response.ok || !data) {
        setConnectedAppsError(data?.message || '连接应用状态加载失败，请重试。')
        return
      }
      setConnectedApps(data.applications || [])
    }).catch(() => {
      if (!cancelled && !controller.signal.aborted) {
        setConnectedAppsError('网络异常，暂时无法读取连接应用。')
      }
    }).finally(() => {
      if (!cancelled && !controller.signal.aborted) setConnectedAppsLoading(false)
    })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [currentUser, connectedAppsReloadKey])

  useEffect(() => {
    if (!currentUser) return
    let cancelled = false
    setDecorationLoading(true)
    void fetchJson<DecorationOptionsResponse>('/api/me/decorations').then(({ response, data }) => {
      if (cancelled) return
      if (response.ok && data) {
        setDecorations(data)
        setSelectedFrame(data.equipped.avatarFrame)
        setSelectedOverlay(data.equipped.avatarOverlay)
        setSelectedTitle(data.equipped.equippedTitle)
      } else {
        setEditError(data?.message || '站内装饰加载失败，请重试。')
      }
    }).catch(() => {
      if (!cancelled) setEditError('网络异常，站内装饰暂时无法加载。')
    }).finally(() => {
      if (!cancelled) setDecorationLoading(false)
    })
    return () => { cancelled = true }
  }, [currentUser])

  if (!currentUser) return <Navigate to="/auth" replace />

  const initial = currentUser.name.trim()[0] || currentUser.id[0] || '★'

  const handleSaveName = async () => {
    if (savingName) return
    const name = editName.trim()
    if (!name) {
      setEditError('昵称不能为空。')
      return
    }
    if (name === currentUser.name) {
      showToast('昵称没有变化。', 'info')
      setEditError('')
      return
    }
    setSavingName(true)
    setEditError('')
    try {
      const { response, data } = await fetchJson<UserResponse>('/api/me/name', {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      })
      if (!mountedRef.current) return
      if (!response.ok || !data?.user) {
        showEditError(data?.message || '昵称保存失败，请重试。')
        return
      }
      setCurrentUser(data.user)
      setEditName(data.user.name)
      showEditSuccess('昵称已更新。')
    } catch (error) {
      showEditError(getRequestErrorMessage(error, '昵称保存失败，请重试。'))
    } finally {
      if (mountedRef.current) setSavingName(false)
    }
  }

  const handleSendEmailChangeCode = async () => {
    if (emailSending || emailCooldown > 0) return
    const email = editEmail.trim()
    if (!EMAIL_PATTERN.test(email)) {
      setEditError('请输入有效的邮箱地址。')
      return
    }
    if (email.toLowerCase() === (currentUser.email || '').trim().toLowerCase()) {
      setEditError('新邮箱不能与当前邮箱相同。')
      return
    }
    setEmailSending(true)
    setEditError('')
    try {
      const { response, data } = await fetchJson<ApiResponse<{ retryAfter?: number }>>('/api/me/email-code', {
        method: 'POST',
        body: JSON.stringify({ email }),
      })
      if (!mountedRef.current) return
      if (!response.ok) {
        showEditError(data?.message || '验证码发送失败，请重试。')
        if (response.status === 429 && data?.retryAfter) setEmailCooldown(data.retryAfter)
        return
      }
      setEmailCooldown(60)
      showEditSuccess('验证码已发送到新邮箱。')
    } catch (error) {
      showEditError(getRequestErrorMessage(error, '验证码发送失败，请重试。'))
    } finally {
      if (mountedRef.current) setEmailSending(false)
    }
  }

  const handleSaveEmail = async () => {
    if (emailSaving) return
    const email = editEmail.trim()
    const emailCode = editEmailCode.trim()
    if (!EMAIL_PATTERN.test(email)) {
      setEditError('请输入有效的邮箱地址。')
      return
    }
    if (!/^\d{6}$/.test(emailCode)) {
      setEditError('请输入 6 位邮箱验证码。')
      return
    }
    setEmailSaving(true)
    setEditError('')
    try {
      const { response, data } = await fetchJson<UserResponse>('/api/me/email', {
        method: 'PATCH',
        body: JSON.stringify({ email, emailCode }),
      })
      if (!mountedRef.current) return
      if (!response.ok || !data?.user) {
        showEditError(data?.message || '邮箱换绑失败，请重试。')
        return
      }
      setCurrentUser(data.user)
      setEditEmail(data.user.email || '')
      setEditEmailCode('')
      showEditSuccess('邮箱已重新绑定。')
    } catch (error) {
      showEditError(getRequestErrorMessage(error, '邮箱换绑失败，请重试。'))
    } finally {
      if (mountedRef.current) setEmailSaving(false)
    }
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (uploading) return
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setEditError('请选择图片文件。')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setEditError('图片大小不能超过 2MB。')
      return
    }

    setEditError('')
    setUploading(true)
    const reader = new FileReader()
    reader.onload = async (loadEvent) => {
      const base64 = loadEvent.target?.result as string
      try {
        const { response, data } = await fetchJson<UserResponse>('/api/me/avatar', {
          method: 'POST',
          body: JSON.stringify({ avatar: base64 }),
        })
        if (!mountedRef.current) return
        if (!response.ok) {
          showEditError(data?.message || '头像上传失败。')
          return
        }
        if (data?.user) {
          setCurrentUser(data.user)
          showEditSuccess('头像已更新。')
        }
      } catch (error) {
        showEditError(getRequestErrorMessage(error, '头像上传失败，请重试。'))
      } finally {
        if (mountedRef.current) setUploading(false)
      }
    }
    reader.onerror = () => {
      setUploading(false)
      showEditError('读取图片失败，请重试。')
    }
    reader.readAsDataURL(file)
  }

  const handleRevokeOtherSessions = async () => {
    if (sessionActionBusy || !sessions.some((session) => !session.current)) return
    setSessionActionBusy('others')
    setEditError('')
    try {
      const { response, data } = await fetchJson<ApiResponse<{ revoked?: number }>>('/api/me/sessions/revoke-others', { method: 'POST' })
      if (!mountedRef.current) return
      if (!response.ok) {
        showEditError(data?.message || '其他会话注销失败，请重试。')
        return
      }
      setSessions((current) => current.filter((session) => session.current))
      showEditSuccess(`已注销 ${data?.revoked || 0} 个其他登录会话。`)
    } catch (error) {
      showEditError(getRequestErrorMessage(error, '其他会话注销失败，请重试。'))
    } finally {
      if (mountedRef.current) setSessionActionBusy('')
    }
  }

  const handleRevokeSession = async (session: AuthSession) => {
    if (session.current || sessionActionBusy) return
    setSessionActionBusy(session.id)
    setEditError('')
    try {
      const { response, data } = await fetchJson<ApiResponse>(`/api/me/sessions/${session.id}`, { method: 'DELETE' })
      if (!mountedRef.current) return
      if (!response.ok) {
        showEditError(data?.message || '会话注销失败，请重试。')
        return
      }
      setSessions((current) => current.filter((item) => item.id !== session.id))
      showEditSuccess('已注销选中的登录会话。')
    } catch (error) {
      showEditError(getRequestErrorMessage(error, '会话注销失败，请重试。'))
    } finally {
      if (mountedRef.current) setSessionActionBusy('')
    }
  }

  const handleRevokeConnectedApp = async (application: ConnectedApplication) => {
    if (!application.canRevoke || connectedAppBusy) return
    if (!window.confirm(`确定撤销${application.name}的星栈账号授权吗？界芽本地存档不会被删除。`)) return
    setConnectedAppBusy(application.id)
    setConnectedAppsError('')
    try {
      const { response, data } = await fetchJson<ApiResponse<{ application?: ConnectedApplication }>>(
        `/api/me/connected-apps/${application.id}`,
        { method: 'DELETE' },
      )
      if (!mountedRef.current) return
      if (!response.ok || !data?.application) {
        showEditError(data?.message || '应用授权撤销失败，请重试。')
        return
      }
      setConnectedApps((current) => current.map((item) => (
        item.id === application.id ? data.application as ConnectedApplication : item
      )))
      showEditSuccess(data.message || '应用授权已撤销。')
    } catch (error) {
      showEditError(getRequestErrorMessage(error, '应用授权撤销失败，请重试。'))
    } finally {
      if (mountedRef.current) setConnectedAppBusy('')
    }
  }

  const handleSavePassword = async () => {
    if (passwordSaving) return
    if (!oldPassword || newPassword.length < 6) {
      setEditError('请填写旧密码，新密码至少 6 位。')
      return
    }
    if (newPassword !== confirmPassword) {
      setEditError('两次新密码不一致。')
      return
    }
    setPasswordSaving(true)
    setEditError('')
    try {
      const { response, data } = await fetchJson<ApiResponse>('/api/me/password', {
        method: 'POST',
        body: JSON.stringify({ oldPassword, newPassword }),
      })
      if (!mountedRef.current) return
      if (!response.ok) {
        showEditError(data?.message || '密码修改失败，请重试。')
        return
      }
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
      showEditSuccess('密码已更新，其他登录设备已注销。')
      setSessions((current) => current.filter((session) => session.current))
    } catch (error) {
      showEditError(getRequestErrorMessage(error, '密码修改失败，请重试。'))
    } finally {
      if (mountedRef.current) setPasswordSaving(false)
    }
  }

  const handleSaveDecorations = async () => {
    if (decorationSaving) return
    setDecorationSaving(true)
    setEditError('')
    try {
      const { response, data } = await fetchJson<UserResponse & { decorations?: DecorationOptionsResponse }>('/api/me/decorations', {
        method: 'PATCH',
        body: JSON.stringify({
          avatarFrame: selectedFrame,
          avatarOverlay: selectedOverlay,
          equippedTitle: selectedTitle,
        }),
      })
      if (!mountedRef.current) return
      if (!response.ok || !data?.user || !data.decorations) {
        showEditError(data?.message || '站内装饰保存失败，请重试。')
        return
      }
      setCurrentUser(data.user)
      setDecorations(data.decorations)
      setSelectedFrame(data.decorations.equipped.avatarFrame)
      setSelectedOverlay(data.decorations.equipped.avatarOverlay)
      setSelectedTitle(data.decorations.equipped.equippedTitle)
      showEditSuccess('站内装饰已更新。')
    } catch (error) {
      showEditError(getRequestErrorMessage(error, '站内装饰保存失败，请重试。'))
    } finally {
      if (mountedRef.current) setDecorationSaving(false)
    }
  }

  return (
    <div className="profile-edit-page">
      <PageHeader
        kicker="Profile Settings"
        title="编辑个人资料"
        description="更新你的昵称、头像和绑定邮箱。邮箱换绑需要完成新的邮箱验证码验证。"
        actions={
          <Button variant="ghost" icon={<ArrowLeft size={16} />} onClick={() => navigate('/account')}>
            返回个人主页
          </Button>
        }
      />

      <Panel className="profile-edit-card">
        <section className="profile-edit-section profile-edit-avatar-section">
          <div className="profile-edit-section-copy">
            <h2>头像</h2>
            <p>支持 PNG、JPG、WebP、GIF，图片大小不能超过 2MB。</p>
          </div>
          <div className="profile-edit-avatar-actions">
            <div className={`profile-edit-avatar-preview ${uploading ? 'uploading' : ''}`}>
              <DecoratedAvatar
                avatar={currentUser.avatar}
                fallback={initial}
                frame={currentUser.avatarFrame}
                overlay={currentUser.avatarOverlay}
                size="edit"
                alt="当前头像"
              />
            </div>
            <Button variant="ghost" onClick={() => fileInputRef.current?.click()} loading={uploading}>
              更换头像
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={handleFileChange}
            />
          </div>
        </section>

        <section className="profile-edit-section profile-edit-decoration-section">
          <div className="profile-edit-section-copy">
            <h2>站内装饰</h2>
            <p>装备头像框、头像叠加层和称号。未解锁项目会显示获得条件，称号不能自定义。</p>
          </div>
          <div className="profile-edit-decoration-content">
            {decorationLoading ? (
              <LoadingState className="profile-decoration-loading" variant="compact" label="正在加载装饰选项…" />
            ) : decorations ? (
              <>
                <div className="profile-decoration-preview">
                  <DecoratedAvatar
                    avatar={currentUser.avatar}
                    fallback={initial}
                    frame={selectedFrame}
                    overlay={selectedOverlay}
                    size="edit"
                    alt="装饰预览"
                  />
                  <div>
                    <strong>{currentUser.name}</strong>
                    <span>
                      {selectedTitle
                        ? `${decorations.titles.find((item) => item.id === selectedTitle)?.icon || ''} ${decorations.titles.find((item) => item.id === selectedTitle)?.name || decorations.fallbackTitle.name}`
                        : `${decorations.fallbackTitle.icon} ${decorations.fallbackTitle.name}`}
                    </span>
                  </div>
                </div>

                <div className="profile-decoration-group">
                  <div className="profile-decoration-group-title">头像框</div>
                  <div className="profile-decoration-option-grid">
                    {decorations.frames.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={`profile-decoration-option ${selectedFrame === option.id ? 'selected' : ''} ${!option.unlocked ? 'locked' : ''}`}
                        disabled={!option.unlocked}
                        onClick={() => setSelectedFrame(option.id as AvatarFrameId)}
                        title={option.unlocked ? option.description : option.unlockText}
                      >
                        <DecoratedAvatar
                          avatar={currentUser.avatar}
                          fallback={initial}
                          frame={option.id as AvatarFrameId}
                          size="discussion"
                          alt=""
                        />
                        <span className="profile-decoration-option-copy">
                          <strong>{option.name}</strong>
                          <small>{option.unlocked ? '已解锁' : `🔒 ${option.unlockText}`}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="profile-decoration-group">
                  <div className="profile-decoration-group-title">头像叠加层</div>
                  <div className="profile-decoration-option-grid">
                    {decorations.overlays.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={`profile-decoration-option ${selectedOverlay === option.id ? 'selected' : ''} ${!option.unlocked ? 'locked' : ''}`}
                        disabled={!option.unlocked}
                        onClick={() => setSelectedOverlay(option.id as AvatarOverlayId)}
                        title={option.unlocked ? option.description : option.unlockText}
                      >
                        <DecoratedAvatar
                          avatar={currentUser.avatar}
                          fallback={initial}
                          overlay={option.id as AvatarOverlayId}
                          size="discussion"
                          alt=""
                        />
                        <span className="profile-decoration-option-copy">
                          <strong>{option.name}</strong>
                          <small>{option.unlocked ? '已解锁' : `🔒 ${option.unlockText}`}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="profile-decoration-group">
                  <div className="profile-decoration-group-title">称号</div>
                  <div className="profile-decoration-title-list">
                    <button
                      type="button"
                      className={`profile-decoration-title ${selectedTitle === null ? 'selected' : ''}`}
                      onClick={() => setSelectedTitle(null)}
                    >
                      <span>{decorations.fallbackTitle.icon}</span>
                      <span><strong>当前等级称号</strong><small>{decorations.fallbackTitle.name}</small></span>
                    </button>
                    {decorations.titles.filter((option) => option.id !== decorations.fallbackTitle.id).map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={`profile-decoration-title ${selectedTitle === option.id ? 'selected' : ''}`}
                        onClick={() => setSelectedTitle(option.id as EquippedTitleId)}
                      >
                        <span>{option.icon || '✦'}</span>
                        <span><strong>{option.name}</strong><small>{option.source === 'honor' ? '荣誉称号' : option.unlockText}</small></span>
                      </button>
                    ))}
                  </div>
                </div>

                <Button variant="primary" onClick={() => void handleSaveDecorations()} loading={decorationSaving}>
                  保存站内装饰
                </Button>
              </>
            ) : null}
          </div>
        </section>

        <section className="profile-edit-section">
          <div className="profile-edit-section-copy">
            <h2>昵称</h2>
            <p>昵称会显示在个人主页、讨论区和排行榜中。</p>
          </div>
          <div className="profile-edit-control-row">
            <input
              id="profile-edit-name"
              className="auth-input"
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
              maxLength={40}
              aria-label="昵称"
            />
            <Button variant="ghost" onClick={handleSaveName} loading={savingName}>
              保存昵称
            </Button>
          </div>
        </section>

        <section className="profile-edit-section profile-edit-email-section">
          <div className="profile-edit-section-copy">
            <h2>换绑邮箱</h2>
            <p>当前绑定：{currentUser.email || '未绑定'}。验证码会发送到新的邮箱地址。</p>
          </div>
          <div className="profile-edit-email-form">
            <input
              id="profile-edit-email"
              className="auth-input"
              type="email"
              value={editEmail}
              onChange={(event) => setEditEmail(event.target.value)}
              placeholder="输入新的邮箱地址"
              autoComplete="email"
              aria-label="新邮箱地址"
            />
            <div className="profile-edit-control-row">
              <input
                className="auth-input"
                inputMode="numeric"
                maxLength={6}
                value={editEmailCode}
                onChange={(event) => setEditEmailCode(event.target.value.replace(/\D/g, ''))}
                placeholder="6 位验证码"
                autoComplete="one-time-code"
                aria-label="邮箱验证码"
              />
              <button
                className="ghost profile-edit-code-button"
                type="button"
                onClick={handleSendEmailChangeCode}
                disabled={emailSending || emailCooldown > 0}
              >
                {emailSending ? '发送中…' : emailCooldown > 0 ? `${emailCooldown}s 后重发` : '发送验证码'}
              </button>
            </div>
            <Button variant="primary" onClick={handleSaveEmail} loading={emailSaving}>
              确认换绑
            </Button>
          </div>
        </section>

        <section className="profile-edit-section profile-edit-sessions-section">
          <div className="profile-edit-section-copy">
            <h2>登录会话</h2>
            <p>查看当前账号的登录记录。发现异常设备时，可以立即注销其他会话。</p>
          </div>
          <div className="profile-edit-sessions-content">
            <div className="profile-edit-sessions-head">
              <span>{sessions.length || 0} 个会话</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleRevokeOtherSessions()}
                loading={sessionActionBusy === 'others'}
                disabled={!sessions.some((session) => !session.current)}
              >
                注销其他会话
              </Button>
            </div>
            <div className="profile-edit-sessions-list">
              {sessions.length === 0 ? (
                <span className="profile-edit-session-empty">暂时无法读取会话信息</span>
              ) : sessions.map((session) => (
                <div className="profile-edit-session-item" key={session.id}>
                  <div>
                    <strong>{session.current ? '当前设备' : '其他登录设备'}</strong>
                    <time dateTime={session.createdAt}>登录于 {new Date(session.createdAt).toLocaleString('zh-CN')}</time>
                  </div>
                  {session.current ? (
                    <span className="profile-edit-session-current">当前使用中</span>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => void handleRevokeSession(session)} loading={sessionActionBusy === session.id}>
                      注销
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="profile-edit-section profile-edit-connected-apps-section">
          <div className="profile-edit-section-copy">
            <h2>已连接应用</h2>
            <p>管理通过星栈账号授权的独立应用。应用拥有自己的会话和数据，不会继承星栈管理员权限。</p>
          </div>
          <div className="profile-edit-connected-apps-content">
            {connectedAppsLoading ? (
              <LoadingState variant="compact" label="正在读取连接应用…" />
            ) : connectedAppsError ? (
              <div className="profile-edit-connected-app-error" role="status">
                <span>{connectedAppsError}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConnectedAppsReloadKey((value) => value + 1)}
                >
                  重试
                </Button>
              </div>
            ) : connectedApps.map((application) => {
              const status = CONNECTED_APP_STATUS[application.status]
              return (
                <article className="profile-connected-app" key={application.id}>
                  <div className="profile-connected-app-head">
                    <span className="profile-connected-app-icon" aria-hidden="true"><Sprout size={20} /></span>
                    <div>
                      <div className="profile-connected-app-title">
                        <strong>{application.name}</strong>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </div>
                      <p>{application.description}</p>
                    </div>
                  </div>
                  <ul className="profile-connected-app-permissions" aria-label={`${application.name}授权范围`}>
                    {application.permissions.map((permission) => (
                      <li key={permission.id}>
                        <strong>{permission.label}</strong>
                        <span>{permission.description}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="profile-connected-app-foot">
                    <span>
                      {application.status === 'connected' && application.connectedAt
                        ? `授权于 ${new Date(application.connectedAt).toLocaleString('zh-CN')}`
                        : application.status === 'revocation_pending'
                          ? '旧凭据已失效，后台正在完成物理撤销。'
                          : '尚未授权；进入界芽后可选择使用星栈账号。'}
                    </span>
                    <div className="profile-connected-app-actions">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<ExternalLink size={14} />}
                        onClick={() => openInNewTab(application.homepage)}
                      >
                        进入游戏
                      </Button>
                      {application.status === 'connected' && (
                        <Button
                          variant="danger"
                          size="sm"
                          icon={<Unlink size={14} />}
                          loading={connectedAppBusy === application.id}
                          onClick={() => void handleRevokeConnectedApp(application)}
                        >
                          撤销授权
                        </Button>
                      )}
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        <section className="profile-edit-section profile-edit-password-section">
          <div className="profile-edit-section-copy">
            <h2>修改密码</h2>
            <p>修改后会自动注销其他设备上的登录会话。</p>
          </div>
          <div className="profile-edit-password-form">
            <input className="auth-input" type="password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} placeholder="当前密码" autoComplete="current-password" aria-label="当前密码" />
            <input className="auth-input" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="新密码（至少 6 位）" autoComplete="new-password" aria-label="新密码" />
            <input className="auth-input" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="确认新密码" autoComplete="new-password" aria-label="确认新密码" />
            <Button variant="ghost" onClick={() => void handleSavePassword()} loading={passwordSaving}>保存密码</Button>
          </div>
        </section>

        {editError && <div className="auth-error profile-edit-message">{editError}</div>}
      </Panel>
    </div>
  )
}
