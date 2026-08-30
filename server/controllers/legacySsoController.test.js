import { describe, expect, it, vi } from 'vitest'
import { retireLegacySso } from './legacySsoController.js'

const createResponse = () => ({
  set: vi.fn().mockReturnThis(),
  status: vi.fn().mockReturnThis(),
  json: vi.fn().mockReturnThis(),
})
describe('legacy SSO endpoint retirement', () => {
  it.each(['GET', 'POST'])('fails closed for %s without echoing supplied tokens', (method) => {
    const response = createResponse()
    const secret = 'fixture-session-token-that-must-never-be-returned'

    retireLegacySso({ method, query: { token: secret }, body: { token: secret } }, response)

    expect(response.set).toHaveBeenCalledWith('Cache-Control', 'no-store')
    expect(response.status).toHaveBeenCalledWith(410)
    const payload = response.json.mock.calls[0][0]
    expect(payload).toEqual(expect.objectContaining({ error: 'legacy_sso_retired' }))
    expect(payload).not.toHaveProperty('token')
    expect(JSON.stringify(payload)).not.toContain(secret)
  })
})
