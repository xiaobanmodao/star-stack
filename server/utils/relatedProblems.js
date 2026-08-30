import { getDifficultyMeta, getDifficultyRank } from './difficulty.js'

const normalizeTags = (value) => String(value || '')
  .split(',')
  .map((tag) => tag.trim().toLowerCase())
  .filter(Boolean)

export const rankRelatedProblems = ({ source, candidates, limit = 4 }) => {
  const sourceTags = new Set(normalizeTags(source.tags))
  const sourceRank = getDifficultyRank(source.difficulty)

  return candidates
    .map((candidate) => {
      const candidateTags = normalizeTags(candidate.tags)
      const sharedTags = candidateTags.filter((tag) => sourceTags.has(tag))
      const difficultyDistance = Math.abs(sourceRank - getDifficultyRank(candidate.difficulty))
      const score = sharedTags.length * 10 + Math.max(0, 5 - difficultyDistance * 2)
      return { candidate, sharedTags, score }
    })
    .sort((left, right) => right.score - left.score || left.candidate.id - right.candidate.id)
    .slice(0, limit)
}

export const getRelatedProblemReason = ({ sharedTags, source, candidate }) => {
  if (sharedTags.length > 0) return `共同标签：${sharedTags.slice(0, 2).join('、')}`
  if (getDifficultyRank(source.difficulty) === getDifficultyRank(candidate.difficulty)) {
    return `同为${getDifficultyMeta(candidate.difficulty).label}难度`
  }
  return '难度相近，适合继续练习'
}
