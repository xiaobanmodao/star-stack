import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Panel } from '../components/ui'
import { PORTAL_PROJECTS, type PortalProject } from '../projects'
import { openInNewTab } from '../utils'
import './EntryPages.css'
import './HomePage.css'

const KIND_LABELS: Record<PortalProject['kind'], string> = {
  internal: '站内接入',
  external: '网页应用',
  desktop: '桌面应用',
}

const KIND_TONES: Record<PortalProject['kind'], 'info' | 'success' | 'warning'> = {
  internal: 'info',
  external: 'success',
  desktop: 'warning',
}

const COMMUNITY_LINKS = [
  { label: '讨论区', desc: '发帖、评论、交流心得', path: '/chat/plaza' },
  { label: '个人中心', desc: '做题数据、成就与设置', path: '/account' },
]

function ProjectCard({ project, desktopHint, onToggleDesktopHint, onOpen }: {
  project: PortalProject
  desktopHint: boolean
  onToggleDesktopHint: () => void
  onOpen: () => void
}) {
  const isDesktop = project.kind === 'desktop'
  const body = (
    <>
      <div className="portal-card-head">
        <span className="portal-card-kicker">{project.kicker}</span>
        <Badge tone={KIND_TONES[project.kind]}>{KIND_LABELS[project.kind]}</Badge>
      </div>
      <h2>{project.name}</h2>
      <p className="portal-card-tagline">{project.tagline}</p>
      <p className="portal-card-desc">{project.description}</p>
      {project.badges && project.badges.length > 0 && (
        <div className="portal-card-badges">
          {project.badges.map((badge) => (
            <span key={badge}>{badge}</span>
          ))}
        </div>
      )}
      {project.accountHint && <p className="portal-card-account-hint">{project.accountHint}</p>}
      <span className="portal-card-action">
        {isDesktop
          ? (desktopHint ? '收起' : '查看启动方式')
          : `${project.actionLabel || (project.kind === 'external' ? '打开' : '进入')} →`}
      </span>
      {isDesktop && desktopHint && project.launchHint && (
        <div className="portal-card-hint">
          <code>{project.launchHint}</code>
        </div>
      )}
    </>
  )

  if (project.kind === 'external') {
    return (
      <a
        key={project.id}
        className={`portal-card ${project.featured ? 'featured' : ''}`}
        href={project.href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${project.actionLabel || '打开'}${project.name}（新窗口）`}
      >
        {body}
      </a>
    )
  }

  return (
    <button
      key={project.id}
      type="button"
      className={`portal-card ${project.featured ? 'featured' : ''}`}
      onClick={() => {
        if (isDesktop) {
          onToggleDesktopHint()
        } else {
          onOpen()
        }
      }}
    >
      {body}
    </button>
  )
}

export default function HomePage() {
  const navigate = useNavigate()
  const [desktopHintId, setDesktopHintId] = useState<string | null>(null)

  return (
    <div className="portal-hall">
      <section className="portal-hero">
        <Badge tone="info">StarStack Hub</Badge>
        <h1>星栈 · 项目主站</h1>
        <p>
          把评测、创作与工具聚合在同一片深空里：在线评测 OJ、创造型沙盒界芽计划，
          以及面向竞赛训练的代码编辑器 StarCode。选择一个项目，开始你的航行。
        </p>
      </section>

      <section className="portal-grid" aria-label="项目大厅">
        {PORTAL_PROJECTS.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            desktopHint={desktopHintId === project.id}
            onToggleDesktopHint={() => setDesktopHintId(desktopHintId === project.id ? null : project.id)}
            onOpen={() => openInNewTab(project.href)}
          />
        ))}
      </section>

      <Panel className="portal-community">
        <div className="portal-community-title">
          <span>Community</span>
          <strong>星栈社区</strong>
        </div>
        <div className="portal-community-links">
          {COMMUNITY_LINKS.map((link) => (
            <button key={link.path} type="button" onClick={() => navigate(link.path)}>
              <strong>{link.label}</strong>
              <span>{link.desc}</span>
            </button>
          ))}
        </div>
      </Panel>
    </div>
  )
}
