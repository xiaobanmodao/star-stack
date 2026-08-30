export type SubmissionFeedbackStage = 'success' | 'fail'

export type SubmissionActionKey =
  | 'edit'
  | 'retry'
  | 'solutions'
  | 'discussion'
  | 'records'
  | 'problemset'
  | 'account'

export type SubmissionAction = {
  key: SubmissionActionKey
  label: string
  variant: 'primary' | 'ghost'
}

const failureActions: SubmissionAction[] = [
  { key: 'edit', label: '返回修改', variant: 'primary' },
  { key: 'solutions', label: '查看题解', variant: 'ghost' },
  { key: 'discussion', label: '查看讨论', variant: 'ghost' },
  { key: 'records', label: '我的提交', variant: 'ghost' },
]

const judgeFailureActions: SubmissionAction[] = [
  { key: 'retry', label: '重新提交', variant: 'primary' },
  { key: 'edit', label: '返回题目', variant: 'ghost' },
  { key: 'records', label: '我的提交', variant: 'ghost' },
]

const successActions: SubmissionAction[] = [
  { key: 'problemset', label: '继续刷题', variant: 'primary' },
  { key: 'solutions', label: '查看题解', variant: 'ghost' },
  { key: 'records', label: '查看我的提交', variant: 'ghost' },
  { key: 'account', label: '查看成长记录', variant: 'ghost' },
]

export const getSubmissionActionPlan = (
  kind: string,
  stage: SubmissionFeedbackStage,
): SubmissionAction[] => {
  if (stage === 'success' || kind === 'accepted') return successActions
  if (kind === 'judge') return judgeFailureActions
  return failureActions
}
