import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const createOpaqueToken = () => randomBytes(32).toString('base64url')

export const hashOpaqueToken = (value, maxLength = 512) => {
  if (typeof value !== 'string' || !value || value.length > maxLength) return null
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export const verifyOpaqueToken = (storedHash, value) => {
  const candidateHash = hashOpaqueToken(value)
  if (!candidateHash || typeof storedHash !== 'string') return false
  const stored = Buffer.from(storedHash, 'hex')
  const candidate = Buffer.from(candidateHash, 'hex')
  return stored.length === candidate.length && timingSafeEqual(stored, candidate)
}
