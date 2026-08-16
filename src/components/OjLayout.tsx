import { useLocation, useNavigate, Outlet } from 'react-router-dom'
import { House, BookOpen, Code2, FileText } from 'lucide-react'
import './OjLayout.css'

const NAV_ITEMS = [
  { path: '/oj', label: '评测首页', icon: House, match: (p: string) => p === '/oj' },
  { path: '/oj/list', label: '题库', icon: BookOpen, match: (p: string) => p.startsWith('/oj/list') },
  { path: '/oj/judge', label: '代码评测', icon: Code2, match: (p: string) => p.startsWith('/oj/judge') },
  { path: '/oj/submissions', label: '提交记录', icon: FileText, match: (p: string) => p.startsWith('/oj/submissions') },
]

/**
 * OJ 子站布局：动态张闭侧边栏（复用原全局侧栏设计）
 * 收起 = 窄图标栏；悬停 = 展开显示图标 + 文字（文字在图标右侧），悬浮不挤压内容
 */
export default function OjLayout() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  return (
    <>
      <aside className="sidebar oj-sidebar" aria-label="评测子站导航">
        <nav className="nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.path}
              type="button"
              className={`nav-link ${item.match(pathname) ? 'active' : ''}`}
              onClick={() => navigate(item.path)}
            >
              <span className="nav-icon" aria-hidden="true">
                <item.icon size={18} strokeWidth={1.8} />
              </span>
              <span className="nav-label">{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="status-dot" />
          <span className="sidebar-footer-text">Online Judge</span>
        </div>
      </aside>
      <div className="oj-sidebar-main">
        <Outlet />
      </div>
    </>
  )
}
