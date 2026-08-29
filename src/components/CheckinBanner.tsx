import { useEffect, useState } from 'react'
import { CalendarCheck, Flame, Trophy } from 'lucide-react'
import { useAppContext } from '../context/AppContext'
import type { CheckinResponse } from '../types'
import { fetchJson } from '../utils'
import { Button, Panel } from './ui'
import './CheckinBanner.css'

export default function CheckinBanner() {
  const { currentUser } = useAppContext()
  const [checkin, setCheckin] = useState<CheckinResponse | null>(null)
  const [checkingIn, setCheckingIn] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!currentUser?.id) return

    const controller = new AbortController()
    void fetchJson<CheckinResponse>('/api/me/checkin', { signal: controller.signal }).then(({ response, data }) => {
      if (controller.signal.aborted) return
      if (response.ok && data) setCheckin(data)
    }).catch(() => undefined)
    return () => controller.abort()
  }, [currentUser])

  const handleCheckin = async () => {
    if (!currentUser || checkingIn || checkin?.checkedToday) return
    setCheckingIn(true)
    setError('')
    const { response, data } = await fetchJson<CheckinResponse>('/api/me/checkin', {
      method: 'POST',
    })
    setCheckingIn(false)
    if (!response.ok || !data) {
      setError(data?.message || '签到失败，请重试。')
      return
    }
    setCheckin(data)
  }

  if (!currentUser) return null

  return (
    <Panel className={`oj-checkin-banner ${!checkin ? 'is-loading' : ''} ${checkingIn ? 'is-submitting' : ''}`}>
      <div className="oj-checkin-copy">
        <CalendarCheck size={22} strokeWidth={1.8} aria-hidden="true" />
        <div>
          <span className="oj-checkin-kicker">Daily Check-in</span>
          <strong>每日签到</strong>
          <p>{checkin?.checkedToday ? '今天已经签到，继续保持训练节奏。' : '连续打卡，让训练更有惯性。'}</p>
        </div>
      </div>

      <div className="oj-checkin-metrics">
        <div className="oj-checkin-metric">
          <Flame size={16} strokeWidth={1.8} aria-hidden="true" />
          <div>
            <strong>{checkin ? checkin.currentStreak : <span className="checkin-value-loading" aria-label="加载中" />}</strong>
            <span>当前连续</span>
          </div>
        </div>
        <div className="oj-checkin-metric">
          <Trophy size={16} strokeWidth={1.8} aria-hidden="true" />
          <div>
            <strong>{checkin ? checkin.maxStreak : <span className="checkin-value-loading" aria-label="加载中" />}</strong>
            <span>最长连续</span>
          </div>
        </div>
        <div className="oj-checkin-metric">
          <CalendarCheck size={16} strokeWidth={1.8} aria-hidden="true" />
          <div>
            <strong>{checkin ? checkin.totalDays : <span className="checkin-value-loading" aria-label="加载中" />}</strong>
            <span>累计签到</span>
          </div>
        </div>
      </div>

      <div className="oj-checkin-action">
        <Button
          variant={checkin?.checkedToday ? 'ghost' : 'primary'}
          size="sm"
          onClick={handleCheckin}
          disabled={!checkin || checkin.checkedToday || checkingIn}
          loading={!checkin || checkingIn}
        >
          {checkin?.checkedToday ? '今日已签到' : checkin ? '立即签到' : '加载中…'}
        </Button>
        {error && <span className="oj-checkin-error">{error}</span>}
      </div>
    </Panel>
  )
}
