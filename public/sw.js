// 每次发布更新版本号，activate 阶段会清理旧前端资源，避免旧 bundle 与新 HTML 混用。
const CACHE_NAME = 'starstack-v4'
const STATIC_ASSETS = [
  '/',
  '/starstack.svg',
  '/manifest.json',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  // Skip non-GET and API requests
  if (request.method !== 'GET' || request.url.includes('/api/')) return

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cache successful responses for static assets
        if (response.ok && (request.url.match(/\.(js|css|svg|png|jpe?g|webp|gif|ico|woff2?)$/) || request.url.endsWith('/') || request.url.endsWith('/manifest.json'))) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
        }
        return response
      })
      .catch(async () => {
        const cached = await caches.match(request)
        if (cached) return cached
        if (request.mode === 'navigate') {
          const fallback = await caches.match('/')
          if (fallback) return fallback
        }
        return new Response('离线状态下暂时无法加载该资源。', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })
      })
  )
})

// ---------- Web Push 通知 ----------

self.addEventListener('push', (event) => {
  let data = { title: '星栈', body: '', url: '/' }
  try {
    const parsed = event.data ? event.data.json() : {}
    data = { title: '星栈', body: '', url: '/', ...parsed }
  } catch {
    // 非 JSON 载荷忽略
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/starstack.svg',
      badge: '/starstack.svg',
      data: { url: data.url },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    })
  )
})
