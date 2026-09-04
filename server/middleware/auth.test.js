import { describe, expect, it, vi } from 'vitest'
import { getUserByToken } from './auth.js'

describe('session user loading', () => {
  it('does not read the Base64 avatar blob for every authenticated request', async () => {
    const get = vi.fn()
      .mockResolvedValueOnce({ token: 'token', user_id: 'alice', created_at: new Date().toISOString() })
      .mockResolvedValueOnce({
        id: 'alice',
        name: 'Alice',
        has_avatar: 1,
        avatar_revision: 7,
        account_status: 'active',
      })

    const user = await getUserByToken({ get, run: vi.fn() }, 'token')
    const userQuery = get.mock.calls[1][0]

    expect(userQuery).toContain('AS has_avatar')
    expect(userQuery).not.toMatch(/\bavatar\s*,/)
    expect(user.avatar).toBe('/api/users/alice/avatar?v=7')
    expect(user).not.toHaveProperty('has_avatar')
  })
})
