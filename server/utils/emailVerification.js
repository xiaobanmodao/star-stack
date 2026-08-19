import { createHash, randomInt } from 'crypto'

export const EMAIL_CODE_TTL_MS = 10 * 60 * 1000
export const EMAIL_CODE_RESEND_MS = 60 * 1000
export const EMAIL_CODE_MAX_ATTEMPTS = 5

export const normalizeEmail = (value) => String(value || '').trim().toLowerCase()

export const isValidEmail = (email) => (
  email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
)

export const createEmailCode = () => String(randomInt(0, 1000000)).padStart(6, '0')

export const hashEmailCode = (code) => createHash('sha256').update(String(code)).digest('hex')

export const isExpired = (isoDate) => {
  const timestamp = Date.parse(isoDate)
  return !Number.isFinite(timestamp) || timestamp <= Date.now()
}
