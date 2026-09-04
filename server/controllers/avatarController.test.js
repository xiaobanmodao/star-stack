import { beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { MAX_AVATAR_BYTES, parseStoredAvatar } from '../utils/avatar.js'

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getAuthToken: vi.fn(),
  getUserByToken: vi.fn(),
  serializeUser: vi.fn(),
}))

vi.mock('../db.js', () => ({ getDb: mocks.getDb }))
vi.mock('../middleware/auth.js', () => ({
  getAuthToken: mocks.getAuthToken,
  getUserByToken: mocks.getUserByToken,
}))
vi.mock('../utils/userHelpers.js', () => ({ serializeUser: mocks.serializeUser }))

import { getUserAvatar, updateAvatar } from './avatarController.js'

const createResponse = () => ({
  status: vi.fn().mockReturnThis(),
  setHeader: vi.fn(),
  send: vi.fn().mockReturnThis(),
  end: vi.fn().mockReturnThis(),
  json: vi.fn().mockReturnThis(),
})

describe('avatar controller', () => {
  beforeEach(() => vi.clearAllMocks())

  it('serves the original stored avatar bytes with immutable revision caching', async () => {
    mocks.getDb.mockResolvedValue({
      get: vi.fn().mockResolvedValue({
        avatar: 'data:image/png;base64,aGVsbG8=',
        avatar_revision: 3,
      }),
    })
    const response = createResponse()

    await getUserAvatar({
      params: { id: 'alice' },
      query: { v: '3' },
      headers: {},
    }, response)

    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png')
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=31536000, immutable')
    expect(response.send.mock.calls[0][0].toString('utf8')).toBe('hello')
  })

  it('falls back to revalidation for an unversioned URL and honors ETag', async () => {
    const db = {
      get: vi.fn().mockResolvedValue({
        avatar: 'data:image/webp;base64,aGVsbG8=',
        avatar_revision: 4,
      }),
    }
    mocks.getDb.mockResolvedValue(db)
    const first = createResponse()
    await getUserAvatar({ params: { id: 'alice' }, query: {}, headers: {} }, first)
    const etag = first.setHeader.mock.calls.find(([name]) => name === 'ETag')[1]

    const cached = createResponse()
    await getUserAvatar({
      params: { id: 'alice' },
      query: {},
      headers: { 'if-none-match': etag },
    }, cached)

    expect(first.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=0, must-revalidate')
    expect(cached.status).toHaveBeenCalledWith(304)
    expect(cached.send).not.toHaveBeenCalled()
  })

  it('compresses an upload before storage and preserves decoration fields', async () => {
    const source = await sharp({
      create: {
        width: 1400,
        height: 900,
        channels: 3,
        background: { r: 42, g: 88, b: 170 },
      },
    }).png().toBuffer()
    const db = {
      get: vi.fn().mockResolvedValue({ avatar_revision: 6 }),
      run: vi.fn(),
    }
    const user = {
      id: 'alice',
      avatar_revision: 5,
      avatar_frame: 'supernova',
      avatar_overlay: 'perfect-solve',
      is_banned: 0,
    }
    mocks.getAuthToken.mockReturnValue('test-token')
    mocks.getDb.mockResolvedValue(db)
    mocks.getUserByToken.mockResolvedValue(user)
    mocks.serializeUser.mockImplementation(async (_db, value) => ({ ...value }))
    const response = createResponse()

    await updateAvatar({
      body: { avatar: `data:image/png;base64,${source.toString('base64')}` },
    }, response)

    const storedAvatar = db.get.mock.calls[0][1]
    const parsed = parseStoredAvatar(storedAvatar)
    expect(parsed.contentType).toBe('image/webp')
    expect(parsed.buffer.length).toBeLessThan(MAX_AVATAR_BYTES)
    expect(db.get.mock.calls[0][0]).toContain('avatar_revision = avatar_revision + 1')
    expect(user.avatar).toBe('/api/users/alice/avatar?v=6')
    expect(user.avatar_frame).toBe('supernova')
    expect(user.avatar_overlay).toBe('perfect-solve')
    expect(response.json).toHaveBeenCalledWith({ user: expect.objectContaining({
      avatar_frame: 'supernova',
      avatar_overlay: 'perfect-solve',
    }) })
  })
})
