import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppContext } from '../context/AppContext'
import CheckinBanner from '../components/CheckinBanner'
import type { OjProblemSummary } from '../types'
import { fetchJson, openInNewTab } from '../utils'
import { Badge, Button, EmptyState, ErrorState, LoadingState, Panel } from '../components/ui'
import './EntryPages.css'

type OjOverview = {
  total: number
  difficulties: Record<string, number>
  topTags: { tag: string; count: number }[]
}

type HotProblem = OjProblemSummary & {
  submission_count?: number
}

type RecentAc = {
  created_at: string
  user_name: string
  problem_id: number
  problem_title: string
}

export default function OjHomePage() {
  const navigate = useNavigate()
  const { currentUser } = useAppContext()
  const [quickJumpId, setQuickJumpId] = useState('')
  const [overview, setOverview] = useState<OjOverview | null>(null)
  const [hotProblems, setHotProblems] = useState<HotProblem[]>([])
  const [recentAc, setRecentAc] = useState<RecentAc[]>([])
  const [continueProblem, setContinueProblem] = useState<OjProblemSummary | null>(null)
  const [overviewLoading, setOverviewLoading] = useState(true)
  const [overviewError, setOverviewError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  const handleQuickJump = useCallback(() => {
    const value = quickJumpId.trim().toLowerCase()
    if (!value) return

    const match = value.match(/\d+/)
    if (!match) return

    navigate(`/oj/p${match[0]}`)
  }, [navigate, quickJumpId])

  useEffect(() => {
    const controller = new AbortController()
    setOverviewLoading(true)
    setOverviewError('')
    ;(async () => {
      try {
        const [overviewResult, hotResult, recentResult, continueResult] = await Promise.all([
          fetchJson<OjOverview>('/api/oj/overview', { signal: controller.signal }),
          fetchJson<{ hotProblems: HotProblem[] }>('/api/oj/hot-problems', { signal: controller.signal }),
          fetchJson<{ recentAC: RecentAc[] }>('/api/oj/recent-ac', { signal: controller.signal }),
          fetchJson<{ problem: OjProblemSummary | null }>('/api/oj/continue-last', { signal: controller.signal }),
        ])
        if (controller.signal.aborted) return
        if (overviewResult.response.ok && overviewResult.data) setOverview(overviewResult.data)
        if (hotResult.response.ok && hotResult.data) setHotProblems(hotResult.data.hotProblems || [])
        if (recentResult.response.ok && recentResult.data) setRecentAc(recentResult.data.recentAC || [])
        if (continueResult.response.ok && continueResult.data) setContinueProblem(continueResult.data.problem || null)
      } catch {
        if (!controller.signal.aborted) setOverviewError('网络异常，OJ 首页暂时无法加载。')
      } finally {
        if (!controller.signal.aborted) setOverviewLoading(false)
      }
    })()
    return () => controller.abort()
  }, [currentUser, reloadToken])

  const handleRandomProblem = async () => {
    const { data } = await fetchJson<{ problem: OjProblemSummary }>('/api/oj/random-problem')
    if (data?.problem) {
      openInNewTab(`/oj/p${data.problem.id}`)
    }
  }

  const difficultyEntries = Object.entries(overview?.difficulties || {})
  const topTags = overview?.topTags || []

  return (
    <div className="oj-page oj-workbench-v2">
      <section className="oj-workbench-hero">
        <div className="oj-workbench-copy">
          <Badge tone="info">OJ Workspace</Badge>
          <h1>选择一道题，然后进入专注训练。</h1>
          <p>
            题号直达、难度筛选、热门训练、最近 AC 都集中在这里。减少犹豫，把更多时间留给思考和调试。
          </p>
          <div className="oj-workbench-actions">
            <Button variant="primary" size="lg" onClick={() => navigate('/oj/list')}>
              进入题库
            </Button>
            {continueProblem && (
              <Button variant="ghost" size="lg" onClick={() => openInNewTab(`/oj/p${continueProblem.id}`)}>
                继续 P{continueProblem.id}
              </Button>
            )}
            <Button variant="ghost" size="lg" onClick={handleRandomProblem}>
              随机一题
            </Button>
          </div>
        </div>

        <Panel className="oj-workbench-jump" elevated>
          <div className="oj-workbench-jump-head">
            <span>Quick Jump</span>
          </div>
          <label>
            输入题号
            <div className="oj-workbench-jump-control">
              <span className="oj-quick-jump-prefix" aria-hidden="true">P</span>
              <input
                className="auth-input small"
                placeholder="例如 1001"
                value={quickJumpId}
                onChange={(e) => setQuickJumpId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleQuickJump()
                  }
                }}
              />
              <Button variant="primary" size="sm" onClick={handleQuickJump}>
                跳转
              </Button>
            </div>
          </label>
          <div className="oj-workbench-metrics">
            <div>
              <strong>{overview?.total ?? '-'}</strong>
              <span>公开题目</span>
            </div>
            <div>
              <strong>{difficultyEntries.length || '-'}</strong>
              <span>难度层级</span>
            </div>
          </div>
        </Panel>
      </section>

      <CheckinBanner key={currentUser?.id ?? 'guest'} />

      {overviewError && (
        <ErrorState
          description={overviewError}
          onRetry={() => setReloadToken((value) => value + 1)}
        />
      )}
      {overviewLoading && !overview && <LoadingState variant="inline" label="正在加载 OJ 首页…" />}

      <section className="oj-workbench-grid">
        <Panel className="oj-workbench-section oj-workbench-difficulty">
          <div className="oj-workbench-section-head">
            <div>
              <span>Difficulty</span>
              <h2>按难度出发</h2>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/oj/list')}>全部题目</Button>
          </div>
          <div className="oj-workbench-difficulty-list">
            {difficultyEntries.map(([name, count]) => (
              <button key={name} type="button" onClick={() => navigate(`/oj/list?difficulty=${encodeURIComponent(name)}`)}>
                <span className={`oj-badge ${name}`}>{name}</span>
                <strong>{count}</strong>
              </button>
            ))}
            {difficultyEntries.length === 0 && <EmptyState title="暂无难度数据" description="导入题目后会显示难度分布。" />}
          </div>
        </Panel>

        <Panel className="oj-workbench-section">
          <div className="oj-workbench-section-head">
            <div>
              <span>Hot</span>
              <h2>热门训练</h2>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/oj/list')}>全部题目</Button>
          </div>
          <div className="oj-workbench-list">
            {(hotProblems.length > 0 ? hotProblems : []).map((problem) => (
              <button key={problem.id} type="button" onClick={() => openInNewTab(`/oj/p${problem.id}`)}>
                <span>P{problem.id}</span>
                <strong>{problem.title}</strong>
                <em>{problem.submission_count ?? 0} 次提交</em>
              </button>
            ))}
            {hotProblems.length === 0 && (
              <EmptyState title="今天还没有热门提交" description="可以从随机一题开始点亮第一条训练动态。" />
            )}
          </div>
        </Panel>

        <Panel className="oj-workbench-section">
          <div className="oj-workbench-section-head">
            <div>
              <span>Tags</span>
              <h2>高频标签</h2>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/oj/list')}>筛选</Button>
          </div>
          <div className="oj-workbench-tags">
            {topTags.map((item) => (
              <button key={item.tag} type="button" onClick={() => navigate(`/oj/list?tag=${encodeURIComponent(item.tag)}`)}>
                {item.tag}
                <span>{item.count}</span>
              </button>
            ))}
            {topTags.length === 0 && <EmptyState title="暂无标签数据" description="题目标签会在这里形成星域入口。" />}
          </div>
        </Panel>

        <Panel className="oj-workbench-section">
          <div className="oj-workbench-section-head">
            <div>
              <span>Accepted</span>
              <h2>最近 AC</h2>
            </div>
          </div>
          <div className="oj-workbench-list">
            {recentAc.slice(0, 5).map((item) => (
              <button key={`${item.problem_id}-${item.created_at}`} type="button" onClick={() => openInNewTab(`/oj/p${item.problem_id}`)}>
                <span>{item.user_name}</span>
                <strong>P{item.problem_id} {item.problem_title}</strong>
                <em>Accepted</em>
              </button>
            ))}
            {recentAc.length === 0 && (
              <EmptyState title="还没有通过记录" description="第一条 Accepted 动态等你来点亮。" />
            )}
          </div>
        </Panel>
      </section>
    </div>
  )
}
