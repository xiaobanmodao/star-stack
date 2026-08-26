import { describe, expect, it, vi } from 'vitest'
import {
  getDecorationIdentity,
  getDecorationOptions,
  validateDecorationSelection,
} from './decorations.js'

const createDb = ({ xp = 0, achievements = [] } = {}) => ({
  get: vi.fn().mockResolvedValue({ xp }),
  all: vi.fn().mockResolvedValue(achievements.map((achievement_type) => ({ achievement_type }))),
})

describe('decoration unlock rules', () => {
  it('keeps legacy users on the default appearance', () => {
    const identity = getDecorationIdentity({}, { level: 1, title: '星尘', icon: '✦' })

    expect(identity).toMatchObject({
      avatarFrame: 'none',
      avatarOverlay: 'none',
      equippedTitle: null,
      displayTitle: '星尘',
      displayTitleIcon: '✦',
    })
  })

  it('falls back safely when stored decoration ids are invalid or no longer unlocked', () => {
    const identity = getDecorationIdentity({
      avatar_frame: 'missing-frame',
      avatar_overlay: 'missing-overlay',
      equipped_title: 'honor:missing-honor',
    }, { level: 7, title: '黑洞', icon: '🕳️' })

    expect(identity).toMatchObject({
      avatarFrame: 'none',
      avatarOverlay: 'none',
      equippedTitle: null,
      displayTitle: '黑洞',
      displayTitleIcon: '🕳️',
    })
  })

  it('does not expose an honor or overlay stored without its achievement', () => {
    const identity = getDecorationIdentity({
      avatar_frame: 'meteor',
      avatar_overlay: 'perfect-solve',
      equipped_title: 'honor:perfect_solve',
    }, { level: 7, title: '黑洞', icon: '🕳️' })

    expect(identity).toMatchObject({
      avatarOverlay: 'none',
      equippedTitle: null,
      displayTitle: '黑洞',
    })
  })

  it('unlocks avatar frames only at their configured levels', async () => {
    const levelTwo = await getDecorationOptions(createDb({ xp: 100 }), { id: 'astro01' })
    const levelFour = await getDecorationOptions(createDb({ xp: 700 }), { id: 'astro01' })

    expect(levelTwo.frames.find((item) => item.id === 'meteor')?.unlocked).toBe(true)
    expect(levelTwo.frames.find((item) => item.id === 'planet')?.unlocked).toBe(false)
    expect(levelFour.frames.find((item) => item.id === 'planet')?.unlocked).toBe(true)
  })

  it('only unlocks image overlays through their corresponding honors', async () => {
    const locked = await getDecorationOptions(createDb({ xp: 6000 }), { id: 'astro01' })
    const unlocked = await getDecorationOptions(
      createDb({ xp: 6000, achievements: ['streak_100', 'perfect_solve'] }),
      { id: 'astro01' },
    )

    expect(locked.overlays.find((item) => item.id === 'streak-100')?.unlocked).toBe(false)
    expect(unlocked.overlays.find((item) => item.id === 'streak-100')?.unlocked).toBe(true)
    expect(unlocked.overlays.find((item) => item.id === 'perfect-solve')?.unlocked).toBe(true)
  })
})

describe('decoration selections', () => {
  it('rejects locked items before they can be saved', async () => {
    const options = await getDecorationOptions(createDb({ xp: 0 }), { id: 'astro01' })

    expect(validateDecorationSelection(options, {
      avatarFrame: 'meteor',
      avatarOverlay: 'none',
      equippedTitle: null,
    })).toBe('头像框尚未解锁')
  })

  it('supports equipping an honor and falling back to the level title', async () => {
    const options = await getDecorationOptions(createDb({ xp: 100, achievements: ['streak_7'] }), { id: 'astro01' })

    expect(validateDecorationSelection(options, {
      avatarFrame: 'meteor',
      avatarOverlay: 'none',
      equippedTitle: 'honor:streak_7',
    })).toBeNull()
    expect(validateDecorationSelection(options, {
      avatarFrame: 'meteor',
      avatarOverlay: 'none',
      equippedTitle: null,
    })).toBeNull()
  })
})
