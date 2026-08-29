const DIFFICULTY_LEVELS = Object.freeze([
  { key: 'simple', label: '简单', colorToken: '--ss-difficulty-simple', rank: 1 },
  { key: 'medium', label: '中等', colorToken: '--ss-difficulty-medium', rank: 2 },
  { key: 'challenging', label: '较难', colorToken: '--ss-difficulty-challenging', rank: 3 },
  { key: 'difficult', label: '困难', colorToken: '--ss-difficulty-difficult', rank: 4 },
  { key: 'extreme', label: '极难', colorToken: '--ss-difficulty-extreme', rank: 5 },
])

const ALIASES = Object.freeze({
  simple: ['simple', '简单', '入门', '普及-'],
  medium: ['medium', '中等', '普及'],
  challenging: ['challenging', '较难', '普及+', '提高-'],
  difficult: ['difficult', '困难', '提高', '提高+'],
  extreme: ['extreme', '极难', '省选', 'noi', 'NOI', '国集'],
})

const LEVEL_BY_KEY = new Map(DIFFICULTY_LEVELS.map((level) => [level.key, level]))
const KEY_BY_ALIAS = new Map(Object.entries(ALIASES).flatMap(([key, values]) => values.map((value) => [value, key])))

export const normalizeDifficulty = (value, fallback = 'medium') => {
  const normalized = String(value || '').trim()
  if (LEVEL_BY_KEY.has(normalized)) return normalized
  return KEY_BY_ALIAS.get(normalized) || fallback
}

export const normalizeDifficultyForCreate = (value) => normalizeDifficulty(value, 'simple')

export const getDifficultyMeta = (value) => {
  const key = normalizeDifficulty(value)
  return LEVEL_BY_KEY.get(key) || LEVEL_BY_KEY.get('medium')
}

export const getDifficultyAliases = (value) => {
  const key = normalizeDifficulty(value)
  return [...(ALIASES[key] || ALIASES.medium)]
}

export const serializeDifficulty = (value) => {
  const meta = getDifficultyMeta(value)
  return {
    difficulty: meta.label,
    difficultyKey: meta.key,
    difficultyLabel: meta.label,
    difficultyColorToken: meta.colorToken,
  }
}

export const getDifficultyKeys = () => DIFFICULTY_LEVELS.map((level) => level.key)

export const getDifficultyLabels = () => DIFFICULTY_LEVELS.map((level) => level.label)

export const getDifficultyRank = (value) => getDifficultyMeta(value).rank

export const getDifficultyRating = (value) => {
  const ratingByRank = { 1: 0.05, 2: 0.15, 3: 0.25, 4: 0.4, 5: 0.6 }
  return ratingByRank[getDifficultyRank(value)] || ratingByRank[2]
}
