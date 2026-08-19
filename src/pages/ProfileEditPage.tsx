import { useEffect, useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAppContext } from '../context/AppContext'
import type { ApiResponse, UserResponse } from '../types'
import { fetchJson } from '../utils'
import { Button, PageHeader, Panel } from '../components/ui'
import './ProfileEditPage.css'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function ProfileEditPage() {
  const navigate = useNavigate()
  const { currentUser, setCurrentUser } = useAppContext()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [editName, setEditName] = useState(() => currentUser?.name || '')
  const [editEmail, setEditEmail] = useState(() => currentUser?.email || '')
  const [editEmailCode, setEditEmailCode] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [emailSending, setEmailSending] = useState(false)
  const [emailSaving, setEmailSaving] = useState(false)
  const [emailCooldown, setEmailCooldown] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [editError, setEditError] = useState('')
  const [editSuccess, setEditSuccess] = useState('')

  useEffect(() => {
    if (emailCooldown <= 0) return
    const timer = window.setInterval(() => {
      setEmailCooldown((value) => Math.max(0, value - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [emailCooldown])

  if (!currentUser) return <Navigate to="/auth" replace />

  const initial = currentUser.name.trim()[0] || currentUser.id[0] || '★'

  const handleSaveName = async () => {
    const name = editName.trim()
    if (!name) {
      setEditError('昵称不能为空。')
      setEditSuccess('')
      return
    }
    if (name === currentUser.name) {
      setEditSuccess('昵称没有变化。')
      setEditError('')
      return
    }
    setSavingName(true)
    setEditError('')
    setEditSuccess('')
    const { response, data } = await fetchJson<UserResponse>('/api/me/name', {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    })
    setSavingName(false)
    if (!response.ok || !data?.user) {
      setEditError(data?.message || '昵称保存失败，请重试。')
      return
    }
    setCurrentUser(data.user)
    setEditName(data.user.name)
    setEditSuccess('昵称已更新。')
  }

  const handleSendEmailChangeCode = async () => {
    if (emailSending || emailCooldown > 0) return
    const email = editEmail.trim()
    if (!EMAIL_PATTERN.test(email)) {
      setEditError('请输入有效的邮箱地址。')
      setEditSuccess('')
      return
    }
    if (email.toLowerCase() === (currentUser.email || '').trim().toLowerCase()) {
      setEditError('新邮箱不能与当前邮箱相同。')
      setEditSuccess('')
      return
    }
    setEmailSending(true)
    setEditError('')
    setEditSuccess('')
    const { response, data } = await fetchJson<ApiResponse<{ retryAfter?: number }>>('/api/me/email-code', {
      method: 'POST',
      body: JSON.stringify({ email }),
    })
    setEmailSending(false)
    if (!response.ok) {
      setEditError(data?.message || '验证码发送失败，请重试。')
      if (response.status === 429 && data?.retryAfter) setEmailCooldown(data.retryAfter)
      return
    }
    setEmailCooldown(60)
    setEditSuccess('验证码已发送到新邮箱。')
  }

  const handleSaveEmail = async () => {
    const email = editEmail.trim()
    const emailCode = editEmailCode.trim()
    if (!EMAIL_PATTERN.test(email)) {
      setEditError('请输入有效的邮箱地址。')
      setEditSuccess('')
      return
    }
    if (!/^\d{6}$/.test(emailCode)) {
      setEditError('请输入 6 位邮箱验证码。')
      setEditSuccess('')
      return
    }
    setEmailSaving(true)
    setEditError('')
    setEditSuccess('')
    const { response, data } = await fetchJson<UserResponse>('/api/me/email', {
      method: 'PATCH',
      body: JSON.stringify({ email, emailCode }),
    })
    setEmailSaving(false)
    if (!response.ok || !data?.user) {
      setEditError(data?.message || '邮箱换绑失败，请重试。')
      return
    }
    setCurrentUser(data.user)
    setEditEmail(data.user.email || '')
    setEditEmailCode('')
    setEditSuccess('邮箱已重新绑定。')
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setEditError('请选择图片文件。')
      setEditSuccess('')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setEditError('图片大小不能超过 2MB。')
      setEditSuccess('')
      return
    }

    setEditError('')
    setEditSuccess('')
    setUploading(true)
    const reader = new FileReader()
    reader.onload = async (loadEvent) => {
      const base64 = loadEvent.target?.result as string
      const { response, data } = await fetchJson<UserResponse>('/api/me/avatar', {
        method: 'POST',
        body: JSON.stringify({ avatar: base64 }),
      })
      setUploading(false)
      if (!response.ok) {
        setEditError(data?.message || '头像上传失败。')
        return
      }
      if (data?.user) {
        setCurrentUser(data.user)
        setEditSuccess('头像已更新。')
      }
    }
    reader.onerror = () => {
      setUploading(false)
      setEditError('读取图片失败，请重试。')
    }
    reader.readAsDataURL(file)
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
              {currentUser.avatar ? <img src={currentUser.avatar} alt="当前头像" /> : initial}
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

        {editError && <div className="auth-error profile-edit-message">{editError}</div>}
        {editSuccess && <div className="auth-success profile-edit-message">{editSuccess}</div>}
      </Panel>
    </div>
  )
}
