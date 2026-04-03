const CACHE_NAME = 'ping-watch-static-v2'
const basePath = self.location.pathname.endsWith('/sw.js')
  ? self.location.pathname.slice(0, -'/sw.js'.length)
  : ''

const withBasePath = (path) => {
  if (!basePath) {
    return path
  }
  if (path === '/') {
    return `${basePath}/`
  }
  return `${basePath}${path}`
}

const ASSETS = [
  withBasePath('/'),
  withBasePath('/index.html'),
  withBasePath('/manifest.webmanifest'),
  withBasePath('/pwa-icon-192.svg'),
  withBasePath('/pwa-icon-512.svg'),
]

const isAppShellRequest = (request) => {
  if (request.method !== 'GET') {
    return false
  }

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) {
    return false
  }

  if (request.mode === 'navigate') {
    return true
  }

  return request.destination === 'document'
    && (url.pathname === withBasePath('/') || url.pathname === withBasePath('/index.html'))
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return

  if (isAppShellRequest(event.request)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (!response || response.status !== 200) return response
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(withBasePath('/index.html'), copy)
            cache.put(withBasePath('/'), response.clone())
          })
          return response
        })
        .catch(async () => {
          const cached = await caches.match(withBasePath('/index.html'))
          if (cached) return cached
          return caches.match(withBasePath('/'))
        })
    )
    return
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached
      return fetch(event.request)
        .then((response) => {
          if (!response || response.status !== 200) return response
          if (event.request.url.startsWith(self.location.origin)) {
            const copy = response.clone()
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, copy)
            })
          }
          return response
        })
        .catch(() => cached ?? Response.error())
    })
  )
})
