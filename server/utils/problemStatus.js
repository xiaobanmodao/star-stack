export const PROBLEM_STATUSES = Object.freeze(['draft', 'pending_review', 'published', 'hidden'])

export const isProblemStatus = (status) => PROBLEM_STATUSES.includes(status)

export const normalizeProblemStatus = (status, fallback = 'draft') => (
  isProblemStatus(status) ? status : fallback
)

// 普通出题者不能通过请求体直接改变审核状态。
// 修改审核中、已发布或已隐藏的题目后自动退回草稿，避免公开内容绕过审核。
export const getCreatorUpdateStatus = (currentStatus) => (
  ['pending_review', 'published', 'hidden'].includes(currentStatus)
    ? 'draft'
    : normalizeProblemStatus(currentStatus)
)

export const getAdminCreateStatus = (requestedStatus) => (
  requestedStatus === 'draft' ? 'draft' : 'published'
)
