export const MAX_PROBLEM_TAGS = 8
export const MAX_PROBLEM_TAG_LENGTH = 32

const normalizeTagValue = (value) => String(value ?? '')
  .replace(/[\u0000-\u001f\u007f]/g, '')
  .trim()
  .slice(0, MAX_PROBLEM_TAG_LENGTH)

export const normalizeProblemTags = (value, { maxTags = MAX_PROBLEM_TAGS } = {}) => {
  const rawTags = Array.isArray(value) ? value : String(value ?? '').split(',')
  const unique = []
  const seen = new Set()
  for (const rawTag of rawTags) {
    const tag = normalizeTagValue(rawTag)
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    unique.push(tag)
    if (unique.length >= maxTags) break
  }
  return unique
}

export const serializeProblemTags = (value) => normalizeProblemTags(value)
