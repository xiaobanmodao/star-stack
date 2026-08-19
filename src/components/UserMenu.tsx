import { useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import './UserMenu.css'
import { OJ_ENABLED } from '../constants'
import type { UserRecord } from '../types'

interface UserMenuProps {
  currentUser: UserRecord
  initial: string
  openLogoutConfirm: () => void
}

export default function UserMenu({ currentUser, initial, openLogoutConfirm }: UserMenuProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const closeTimerRef = useRef<number | null>(null)

  const handleMouseEnter = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    setUserMenuOpen(true)
  }

  const handleMouseLeave = () => {
    closeTimerRef.current = window.setTimeout(() => {
      setUserMenuOpen(false)
    }, 300)
  }

  const handleAvatarClick = () => {
    if (location.pathname !== '/account') {
      navigate('/account')
    }
  }

  return (
    <div
      className="user-menu"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="user-avatar-btn" onClick={handleAvatarClick} style={{ cursor: 'pointer' }}>
        {currentUser.avatar ? (
          <img src={currentUser.avatar} alt="头像" />
        ) : (
          <span>{initial}</span>
        )}
      </div>
      <div className={`user-menu-panel ${userMenuOpen ? 'open' : ''}`} role="menu" aria-label="用户菜单">
        <div className="user-menu-level">
          <span aria-hidden="true">{currentUser.icon || '✦'}</span>
          <span>Lv.{currentUser.level ?? 1}</span>
          <strong>{currentUser.title || '星尘'}</strong>
        </div>
        <div className="user-menu-divider" aria-hidden="true" />
        <button className="user-menu-item" type="button" onClick={() => {
          if (location.pathname !== '/account') navigate('/account')
          setUserMenuOpen(false)
        }}>
          个人中心
        </button>
        <button className="user-menu-item" type="button" onClick={() => {
          if (location.pathname !== '/my-problems') navigate('/my-problems')
          setUserMenuOpen(false)
        }}>
          我的题目
        </button>
        {currentUser.isAdmin && (
          <button className="user-menu-item" type="button" onClick={() => {
            if (location.pathname !== '/admin') navigate('/admin')
            setUserMenuOpen(false)
          }}>
            管理员面板
          </button>
        )}
        {OJ_ENABLED && (
          <button className="user-menu-item" type="button" onClick={() => {
            if (location.pathname !== '/oj/submissions') navigate('/oj/submissions')
            setUserMenuOpen(false)
          }}>
            我的提交
          </button>
        )}
        <div className="user-menu-divider" aria-hidden="true" />
        <button className="user-menu-item danger" type="button" onClick={() => {
          openLogoutConfirm()
          setUserMenuOpen(false)
        }}>
          退出账号
        </button>
      </div>
    </div>
  )
}
