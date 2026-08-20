import { useState } from 'react'
import './OnboardingModal.css'
import { useModalFocus } from '../hooks/useModalFocus'

const STEPS = [
  { icon: '🚀', title: '欢迎来到星栈', desc: '这里聚合了在线评测、社区讨论与个人成长。先花 10 秒认识一下主要入口。' },
  { icon: '🧭', title: '项目大厅', desc: '首页是星栈导航中心，可以进入 OJ、界芽计划和 StarCode。' },
  { icon: '📚', title: 'OJ 题库', desc: '在题库中按难度、标签筛选题目，每天还有每日一题和签到打卡。' },
  { icon: '⌨️', title: '在线评测', desc: '在题目页直接写代码、运行样例、提交评测，支持 C++ / Python / Java。' },
  { icon: '💬', title: '聊天社区', desc: '广场发帖、聊天室、私信和好友都在这里，遇到问题随时找人讨论。' },
]

export default function OnboardingModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0)
  const dialogRef = useModalFocus(true, onClose)
  const current = STEPS[step]
  const isLast = step === STEPS.length - 1

  return (
    <div className="confirm-backdrop onboarding-backdrop" role="dialog" aria-modal="true" aria-labelledby="onboarding-dialog-title" onClick={onClose}>
      <div ref={dialogRef} className="confirm-panel onboarding-modal" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <div className="onboarding-dots" aria-hidden="true">
          {STEPS.map((item, index) => (
            <span key={item.title} className={index === step ? 'active' : ''} />
          ))}
        </div>
        <div className="onboarding-icon" aria-hidden="true">{current.icon}</div>
        <h2 id="onboarding-dialog-title">{current.title}</h2>
        <p>{current.desc}</p>
        <div className="confirm-actions">
          <button className="ghost" type="button" onClick={onClose}>
            跳过
          </button>
          {!isLast && (
            <button className="primary" type="button" onClick={() => setStep((prev) => prev + 1)}>
              下一步
            </button>
          )}
          {isLast && (
            <button className="primary" type="button" onClick={onClose}>
              开始探索
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
