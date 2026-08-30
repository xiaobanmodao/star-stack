const MAX_CURSOR_LENGTH = 200

export const encodeCursor = (value) => Buffer
  .from(JSON.stringify(value))
  .toString('base64url')

export const decodeCursor = (raw) => {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_CURSOR_LENGTH) return null
  try {
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

export const decodePositiveIntegerCursor = (raw, field = 'id') => {
  const value = decodeCursor(raw)
  const number = Number(value?.[field])
  return Number.isSafeInteger(number) && number > 0 ? number : null
}
