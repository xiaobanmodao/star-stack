import { describe, expect, it } from 'vitest'
import { resolvePreloadRoute } from './routePreload'

describe('route preloading', () => {
  it('maps high-frequency routes to their preload groups', () => {
    expect(resolvePreloadRoute('/oj')).toBe('/oj')
    expect(resolvePreloadRoute('/oj/list?page=2')).toBe('/oj/list')
    expect(resolvePreloadRoute('/oj/list')).toBe('/oj/list')
    expect(resolvePreloadRoute('/chat/plaza')).toBe('/chat')
    expect(resolvePreloadRoute('/messages/astro01')).toBe('/messages')
    expect(resolvePreloadRoute('/leaderboard')).toBe('/leaderboard')
  })
})
