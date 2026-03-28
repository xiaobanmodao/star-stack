import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { StatsResponse } from '../types'
import { fetchJson } from '../utils'

export default function HomePage() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<{
    problemCount: number
    userCount: number
    todaySubmissions: number
  } | null>(null)

  useEffect(() => {
    const loadStats = async () => {
      const { response, data } = await fetchJson<StatsResponse>('/api/stats')
      if (response.ok && data) {
        setStats(data)
      }
    }
    void loadStats()
  }, [])

  return (
    <section className="hero hero-premium hero-minimal">
      <div className="hero-left hero-left-minimal">
        <div className="eyebrow">STARSTACK</div>
        <h1>在一片星空里，专注训练与执行。</h1>
        <p>
          把算法评测、自动化执行和技术协作收进一个更安静的入口。
          首页只保留最核心的信息，让注意力更直接落在真正要做的事上。
        </p>
        <div className="hero-actions">
          <button className="primary" onClick={() => navigate('/oj')}>
            进入评测系统
          </button>
          <button className="ghost" onClick={() => navigate('/starbot')}>
            打开 StarBot
          </button>
        </div>
      </div>

      <div className="hero-summary">
        <div className="hero-summary-row">
          <span className="hero-summary-label">题库规模</span>
          <strong>{stats?.problemCount ?? '-'}</strong>
        </div>
        <div className="hero-summary-row">
          <span className="hero-summary-label">今日提交</span>
          <strong>{stats?.todaySubmissions ?? '-'}</strong>
        </div>
        <div className="hero-summary-row">
          <span className="hero-summary-label">活跃用户</span>
          <strong>{stats?.userCount ?? '-'}</strong>
        </div>
      </div>
    </section>
  )
}
