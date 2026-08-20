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
}

const loadedRoutes = new Set<string>()

export const resolvePreloadRoute = (path: string) => {
  const pathname = path.split(/[?#]/, 1)[0] || '/'
  return Object.keys(loaders)
    .sort((a, b) => b.length - a.length)
    .find((key) => pathname === key || pathname.startsWith(`${key}/`)) || null
}

export const preloadRoute = (path: string) => {
  const route = resolvePreloadRoute(path)
  if (!route || loadedRoutes.has(route)) return
  loadedRoutes.add(route)
  void Promise.allSettled(loaders[route].map((loader) => loader()))
}
