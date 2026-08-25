import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import './UserMenu.css'
import { OJ_ENABLED } from '../constants'
import type { UserRecord } from '../types'
import { BookOpen, CircleUserRound, FileText, LogOut, ShieldCheck, UserRound } from 'lucide-react'
import DecoratedAvatar from './profile/DecoratedAvatar'

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
  const menuRef = useRef<HTMLDivElement>(null)
  const avatarRef = useRef<HTMLButtonElement>(null)

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

  const toggleMenu = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    setUserMenuOpen((open) => !open)
  }

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setUserMenuOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !userMenuOpen) return
      event.preventDefault()
      setUserMenuOpen(false)
      avatarRef.current?.focus()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current)
    }
  }, [userMenuOpen])

  return (
    <div
      className="user-menu"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        ref={avatarRef}
        className="user-avatar-btn"
        type="button"
        aria-label={`打开用户菜单，当前用户 ${currentUser.name || currentUser.id}`}
        aria-haspopup="menu"
        aria-expanded={userMenuOpen}
        onClick={toggleMenu}
        onFocus={handleMouseEnter}
      >
        <DecoratedAvatar
          avatar={currentUser.avatar}
          fallback={initial}
          frame={currentUser.avatarFrame}
          overlay={currentUser.avatarOverlay}
          size="topbar"
          alt="头像"
          loading="eager"
        />
      </button>
      <div
        ref={menuRef}
        className={`user-menu-panel ${userMenuOpen ? 'open' : ''}`}
        role="menu"
        aria-label="用户菜单"
        aria-hidden={!userMenuOpen}
      >
        <div className="user-menu-level">
          <span aria-hidden="true">{currentUser.displayTitleIcon || currentUser.icon || <CircleUserRound size={16} strokeWidth={1.8} />}</span>
          <span>Lv.{currentUser.level ?? 1}</span>
          <strong>{currentUser.displayTitle || currentUser.title || '星尘'}</strong>
        </div>
        <div className="user-menu-divider" aria-hidden="true" />
        <button className="user-menu-item" role="menuitem" type="button" onClick={() => {
          if (location.pathname !== '/account') navigate('/account')
          setUserMenuOpen(false)
        }}>
          <UserRound size={15} strokeWidth={1.8} aria-hidden="true" /> 个人中心
        </button>
        <button className="user-menu-item" role="menuitem" type="button" onClick={() => {
          if (location.pathname !== '/my-problems') navigate('/my-problems')
          setUserMenuOpen(false)
        }}>
          <BookOpen size={15} strokeWidth={1.8} aria-hidden="true" /> 我的题目
        </button>
        {currentUser.isAdmin && (
          <button className="user-menu-item" role="menuitem" type="button" onClick={() => {
            if (location.pathname !== '/admin') navigate('/admin')
            setUserMenuOpen(false)
          }}>
            <ShieldCheck size={15} strokeWidth={1.8} aria-hidden="true" /> 管理员面板
          </button>
        )}
        {OJ_ENABLED && (
          <button className="user-menu-item" role="menuitem" type="button" onClick={() => {
            if (location.pathname !== '/oj/submissions') navigate('/oj/submissions')
            setUserMenuOpen(false)
          }}>
            <FileText size={15} strokeWidth={1.8} aria-hidden="true" /> 我的提交
          </button>
        )}
        <div className="user-menu-divider" aria-hidden="true" />
        <button className="user-menu-item danger" role="menuitem" type="button" onClick={() => {
          openLogoutConfirm()
          setUserMenuOpen(false)
        }}>
          <LogOut size={15} strokeWidth={1.8} aria-hidden="true" /> 退出账号
        </button>
      </div>
    </div>
  )
}
