type RouteLoader = () => Promise<unknown>

const loaders: Record<string, RouteLoader[]> = {
  '/oj': [
    () => import('../components/OjLayout'),
    () => import('../pages/OjHomePage'),
  ],
  '/oj/list': [
    () => import('../components/OjLayout'),
    () => import('../pages/OjProblemListPage'),
  ],
  '/chat': [
    () => import('../pages/chat/ChatHubPage'),
    () => import('../pages/chat/PlazaPane'),
  ],
  '/messages': [() => import('../pages/MessageListPage')],
  '/leaderboard': [() => import('../pages/LeaderboardPage')],
}

const loadedRoutes = new Set<string>()
const pendingRoutes = new Map<string, Promise<void>>()
const scheduledRoutes = new Set<string>()

type IdleWindow = Window & typeof globalThis & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
}

export const resolvePreloadRoute = (path: string) => {
  const pathname = path.split(/[?#]/, 1)[0] || '/'
  return Object.keys(loaders)
    .sort((a, b) => b.length - a.length)
    .find((key) => pathname === key || pathname.startsWith(`${key}/`)) || null
}

export const preloadRoute = (path: string) => {
  if (typeof window === 'undefined') return
  const route = resolvePreloadRoute(path)
  if (!route || loadedRoutes.has(route) || pendingRoutes.has(route) || scheduledRoutes.has(route)) return
  scheduledRoutes.add(route)

  const schedule = () => {
    const browserWindow = window as IdleWindow
    if (browserWindow.requestIdleCallback) {
      browserWindow.requestIdleCallback(start, { timeout: 1000 })
    } else {
      window.setTimeout(start, 120)
    }
  }

  const start = () => {
    scheduledRoutes.delete(route)
    const promise = Promise.all(loaders[route].map((loader) => loader()))
      .then(() => {
        loadedRoutes.add(route)
      })
      .catch(() => {
        // 分块加载失败时不记录为已完成，下次用户再次聚焦/悬停可以重试。
      })
      .finally(() => {
        pendingRoutes.delete(route)
      })
    pendingRoutes.set(route, promise)
  }

  // 预加载只利用空闲时间，避免与当前页面首次渲染抢占主线程。
  schedule()
}
