import { normalizeProblemTags } from './problemTags.js'

export const PROBLEM_QUALITY_STATUSES = Object.freeze(['unchecked', 'self_tested', 'pending_review', 'verified'])
export const PROBLEM_EDITORIAL_STATUSES = Object.freeze(['none', 'draft', 'published'])

export const PROBLEM_QUALITY_LABELS = Object.freeze({
  unchecked: '未检查',
  self_tested: '已自测',
  pending_review: '审核中',
  verified: '已确认',
})

export const PROBLEM_EDITORIAL_LABELS = Object.freeze({
  none: '暂无题解',
  draft: '题解草稿',
  published: '题解已发布',
})

const MAX_RECOMMENDED_FOR_LENGTH = 120
const MAX_REVISION_SUMMARY_LENGTH = 500
const MAX_ESTIMATED_MINUTES = 600

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key)

const readStoredValue = (value, snakeKey, camelKey) => (
  hasOwn(value, snakeKey) ? value[snakeKey] : value?.[camelKey]
)

const normalizeMetadataText = (value, maxLength) => String(value ?? '')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  .trim()
  .slice(0, maxLength)

export const normalizeEstimatedMinutes = (value, fallback = null) => {
  if (value === null || value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_ESTIMATED_MINUTES) return fallback
  return parsed
}

const normalizeStatus = (value, allowed, fallback) => allowed.includes(value) ? value : fallback

const getStoredTags = (value) => normalizeProblemTags(value)

export const normalizeProblemMetadata = (body = {}, { existing = null, isAdmin = false } = {}) => {
  const current = existing || {}
  const topicTags = hasOwn(body, 'topicTags') ? getStoredTags(body.topicTags) : getStoredTags(readStoredValue(current, 'topic_tags', 'topicTags'))
  const techniqueTags = hasOwn(body, 'techniqueTags') ? getStoredTags(body.techniqueTags) : getStoredTags(readStoredValue(current, 'technique_tags', 'techniqueTags'))
  const estimatedMinutes = hasOwn(body, 'estimatedMinutes')
    ? normalizeEstimatedMinutes(body.estimatedMinutes)
    : normalizeEstimatedMinutes(readStoredValue(current, 'estimated_minutes', 'estimatedMinutes'))
  const recommendedFor = hasOwn(body, 'recommendedFor')
    ? normalizeMetadataText(body.recommendedFor, MAX_RECOMMENDED_FOR_LENGTH)
    : normalizeMetadataText(readStoredValue(current, 'recommended_for', 'recommendedFor'), MAX_RECOMMENDED_FOR_LENGTH)
  const revisionSummary = hasOwn(body, 'revisionSummary')
    ? normalizeMetadataText(body.revisionSummary, MAX_REVISION_SUMMARY_LENGTH)
    : normalizeMetadataText(readStoredValue(current, 'revision_summary', 'revisionSummary'), MAX_REVISION_SUMMARY_LENGTH)

  return {
    topicTags,
    techniqueTags,
    estimatedMinutes,
    recommendedFor,
    qualityStatus: isAdmin && hasOwn(body, 'qualityStatus')
      ? normalizeStatus(body.qualityStatus, PROBLEM_QUALITY_STATUSES, 'unchecked')
      : normalizeStatus(readStoredValue(current, 'quality_status', 'qualityStatus'), PROBLEM_QUALITY_STATUSES, 'unchecked'),
    editorialStatus: isAdmin && hasOwn(body, 'editorialStatus')
      ? normalizeStatus(body.editorialStatus, PROBLEM_EDITORIAL_STATUSES, 'none')
      : normalizeStatus(readStoredValue(current, 'editorial_status', 'editorialStatus'), PROBLEM_EDITORIAL_STATUSES, 'none'),
    revisionSummary,
  }
}

export const serializeProblemMetadata = (row = {}) => ({
  topicTags: getStoredTags(row.topic_tags),
  techniqueTags: getStoredTags(row.technique_tags),
  estimatedMinutes: normalizeEstimatedMinutes(row.estimated_minutes),
  recommendedFor: normalizeMetadataText(row.recommended_for, MAX_RECOMMENDED_FOR_LENGTH),
  qualityStatus: normalizeStatus(row.quality_status, PROBLEM_QUALITY_STATUSES, 'unchecked'),
  editorialStatus: normalizeStatus(row.editorial_status, PROBLEM_EDITORIAL_STATUSES, 'none'),
  revisionSummary: normalizeMetadataText(row.revision_summary, MAX_REVISION_SUMMARY_LENGTH),
})

export const serializePublicProblemMetadata = (row = {}) => {
  const metadata = serializeProblemMetadata(row)
  return {
    topicTags: metadata.topicTags,
    techniqueTags: metadata.techniqueTags,
    estimatedMinutes: metadata.estimatedMinutes,
    recommendedFor: metadata.recommendedFor,
  }
}
