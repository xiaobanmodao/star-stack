import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchJson } from '../utils'
import type { StatsResponse } from '../types'
import { Badge, Button, Panel } from '../components/ui'
import './EntryPages.css'

export default function HomePage() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<StatsResponse | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { response, data } = await fetchJson<StatsResponse>('/api/stats')
      if (!cancelled && response.ok && data) {
        setStats(data)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const statCards = [
    { label: '题目', value: stats?.problemCount ?? '-' },
    { label: '用户', value: stats?.userCount ?? '-' },
    { label: '今日提交', value: stats?.todaySubmissions ?? '-' },
  ]

  const entryCards = [
    {
      kicker: 'Problem Set',
      title: '题库训练',
      desc: '按难度、标签和通过率快速找到下一题。',
      action: '进入题库',
      path: '/oj/list',
      featured: true,
    },
    {
      kicker: 'Workspace',
      title: '在线评测',
      desc: '题面、IDE、运行样例和提交结果在同一条路径里。',
      action: '打开 OJ',
      path: '/oj',
    },
    {
      kicker: 'Discussion',
      title: '讨论闭环',
      desc: '题目讨论会回到题目，不再把做题流打散。',
      action: '看讨论',
      path: '/discussions',
    },
    {
      kicker: 'Growth',
      title: '成长记录',
      desc: '用星图、成就和连续天数记录训练节奏。',
      action: '查看个人中心',
      path: '/account',
    },
  ]

  return (
    <div className="home-entry-v2">
      <section className="home-entry-hero">
        <div className="home-entry-copy">
          <Badge tone="info">StarStack Online Judge</Badge>
          <h1>把刷题路径收束成一座深空工作台。</h1>
          <p>
            找题、读题、写代码、看评测、回讨论和复盘成长都在同一条航线上。页面安静、入口清楚，低配电脑也能轻松打开。
          </p>
          <div className="home-entry-actions" aria-label="主要入口">
            <Button variant="primary" size="lg" onClick={() => navigate('/oj/list')}>
              开始训练
            </Button>
            <Button variant="ghost" size="lg" onClick={() => navigate('/oj')}>
              打开 OJ 工作台
            </Button>
          </div>
          <div className="home-entry-stats" aria-label="站点概览">
            {statCards.map((item) => (
              <div key={item.label}>
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        <Panel className="home-entry-orbit" aria-label="训练流程">
          <div className="home-entry-orbit-head">
            <span>Training Route</span>
            <strong>Online</strong>
          </div>
          <div className="home-entry-map">
            <span className="route-node node-a">题</span>
            <span className="route-node node-b">码</span>
            <span className="route-node node-c">判</span>
            <span className="route-node node-d">论</span>
            <span className="route-line line-a" />
            <span className="route-line line-b" />
            <span className="route-line line-c" />
          </div>
          <div className="home-entry-orbit-foot">
            <span>题库</span>
            <span>IDE</span>
            <span>评测</span>
            <span>讨论</span>
          </div>
        </Panel>
      </section>

      <section className="home-entry-grid" aria-label="功能入口">
        {entryCards.map((card) => (
          <button
            key={card.title}
            type="button"
            className={`home-entry-card ${card.featured ? 'featured' : ''}`}
            onClick={() => navigate(card.path)}
          >
            <span>{card.kicker}</span>
            <strong>{card.title}</strong>
            <p>{card.desc}</p>
            <em>{card.action}</em>
          </button>
        ))}
      </section>

      <Panel className="home-entry-flow">
        <div>
          <span>01</span>
          <strong>找题</strong>
        </div>
        <div>
          <span>02</span>
          <strong>编码</strong>
        </div>
        <div>
          <span>03</span>
          <strong>反馈</strong>
        </div>
        <div>
          <span>04</span>
          <strong>复盘</strong>
        </div>
      </Panel>
    </div>
  )
}
