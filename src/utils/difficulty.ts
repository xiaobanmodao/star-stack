import { DIFFICULTY_LEVELS, type DifficultyKey } from '../constants'

export type DifficultyMeta = {
  key: DifficultyKey
  label: string
  colorToken: string
}

const legacyMap: Record<string, DifficultyKey> = {
  入门: 'simple',
  '普及-': 'simple',
  普及: 'medium',
  '普及+': 'challenging',
  '提高-': 'challenging',
  提高: 'difficult',
  '提高+': 'difficult',
  省选: 'extreme',
  noi: 'extreme',
  NOI: 'extreme',
  国集: 'extreme',
}

export const getDifficultyMeta = (value?: string | null): DifficultyMeta => {
  const normalized = String(value || '').trim()
  const key = DIFFICULTY_LEVELS.some((item) => item.key === normalized)
    ? normalized as DifficultyKey
    : legacyMap[normalized] || 'medium'
  const level = DIFFICULTY_LEVELS.find((item) => item.key === key) || DIFFICULTY_LEVELS[1]
  return {
    key: level.key,
    label: level.label,
    colorToken: level.colorToken,
  }
}

export const getDifficultyLabel = (value?: string | null) => getDifficultyMeta(value).label

export const getDifficultyClassName = (value?: string | null) => `difficulty-${getDifficultyMeta(value).key}`

export const getDifficultyOptions = () => DIFFICULTY_LEVELS.map((item) => ({
  value: item.key,
  label: item.label,
}))

export const aggregateDifficultyStats = <T extends { solved: number; tried: number }>(
  stats: Record<string, T> | undefined,
) => {
  const aggregated = new Map<DifficultyKey, T>()
  Object.entries(stats || {}).forEach(([value, item]) => {
    const key = getDifficultyMeta(value).key
    const previous = aggregated.get(key)
    if (!previous) {
      aggregated.set(key, { ...item })
      return
    }
    aggregated.set(key, {
      solved: previous.solved + item.solved,
      tried: previous.tried + item.tried,
    } as T)
  })
  return DIFFICULTY_LEVELS
    .filter((item) => aggregated.has(item.key))
    .map((item) => [item.key, aggregated.get(item.key)!] as const)
}
