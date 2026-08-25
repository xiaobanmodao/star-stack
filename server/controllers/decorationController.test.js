import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  serializeUser: vi.fn(),
}))

vi.mock('../middleware/auth.js', () => ({ requireUser: mocks.requireUser }))
vi.mock('../utils/userHelpers.js', () => ({ serializeUser: mocks.serializeUser }))

import { getMyDecorations, updateMyDecorations } from './decorationController.js'

const createResponse = () => ({
  status: vi.fn().mockReturnThis(),
  json: vi.fn().mockReturnThis(),
})

const createDb = ({ xp = 100, achievements = [] } = {}) => ({
  get: vi.fn().mockResolvedValue({ xp }),
  all: vi.fn().mockResolvedValue(achievements.map((achievement_type) => ({ achievement_type }))),
  run: vi.fn().mockResolvedValue({}),
})

const createAuth = (db = createDb()) => ({
  db,
  user: {
    id: 'astro01',
    name: 'Astro',
    avatar_frame: 'none',
    avatar_overlay: 'none',
    equipped_title: null,
  },
})

describe('decoration controller', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.serializeUser.mockImplementation(async (_db, user) => ({
      id: user.id,
      avatarFrame: user.avatar_frame,
      avatarOverlay: user.avatar_overlay,
      equippedTitle: user.equipped_title,
    }))
  })

  it('returns 401 when decoration options are requested without a session', async () => {
    const response = createResponse()
    mocks.requireUser.mockImplementation(async (_req, res) => {
      res.status(401).json({ message: '未登录' })
      return null
    })

    await getMyDecorations({}, response)

    expect(response.status).toHaveBeenCalledWith(401)
    expect(response.json).toHaveBeenCalledWith({ message: '未登录' })
  })

  it('returns the current selection and options for a legacy user', async () => {
    const response = createResponse()
    const auth = createAuth(createDb({ xp: 0 }))
    mocks.requireUser.mockResolvedValue(auth)

    await getMyDecorations({}, response)

    const payload = response.json.mock.calls[0][0]
    expect(payload.equipped).toMatchObject({
      avatarFrame: 'none',
      avatarOverlay: 'none',
      equippedTitle: null,
    })
    expect(payload.frames.find((item) => item.id === 'meteor')?.unlocked).toBe(false)
    expect(payload.overlays.find((item) => item.id === 'streak-100')?.unlocked).toBe(false)
  })

  it('saves unlocked decorations and keeps the nested response shape', async () => {
    const response = createResponse()
    const auth = createAuth(createDb({ xp: 100, achievements: ['streak_7'] }))
    mocks.requireUser.mockResolvedValue(auth)

    await updateMyDecorations({
      body: {
        avatarFrame: 'meteor',
        avatarOverlay: 'none',
        equippedTitle: 'honor:streak_7',
      },
    }, response)

    const payload = response.json.mock.calls[0][0]
    expect(payload.success).toBe(true)
    expect(payload.decorations.equipped).toMatchObject({
      avatarFrame: 'meteor',
      avatarOverlay: 'none',
      equippedTitle: 'honor:streak_7',
    })
    expect(payload.equipped).toEqual(payload.decorations.equipped)
    expect(auth.db.run).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users'),
      'meteor',
      'none',
      'honor:streak_7',
      'astro01',
    )
  })

  it('rejects locked and malformed selections without writing to the database', async () => {
    const lockedResponse = createResponse()
    const lockedAuth = createAuth(createDb({ xp: 0 }))
    mocks.requireUser.mockResolvedValue(lockedAuth)

    await updateMyDecorations({
      body: { avatarFrame: 'meteor', avatarOverlay: 'none', equippedTitle: null },
    }, lockedResponse)

    expect(lockedResponse.status).toHaveBeenCalledWith(400)
    expect(lockedAuth.db.run).not.toHaveBeenCalled()

    const malformedResponse = createResponse()
    const malformedAuth = createAuth(createDb({ xp: 100 }))
    mocks.requireUser.mockResolvedValue(malformedAuth)

    await updateMyDecorations({
      body: { avatarFrame: 'meteor', avatarOverlay: 'none', equippedTitle: 42 },
    }, malformedResponse)

    expect(malformedResponse.status).toHaveBeenCalledWith(400)
    expect(malformedAuth.db.run).not.toHaveBeenCalled()
  })
})
