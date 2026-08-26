// Service Worker — cache-first for immutable 3D assets, stale-while-revalidate for the
// film catalog API, network-only for everything else (posters, auth, rentals…).
// (posters are served by /api/poster proxy with HTTP Cache-Control: max-age=2592000 immutable,
// so the browser HTTP cache handles them — duplicating in SW cache wasted ~58 MB on mobile).
// Bump VERSION on every deploy to invalidate stale caches.
// v6 : le catalogue est passé de 18 à 127 films sans que cette version soit
// touchée, donc les navigateurs servaient un cache `zone-club-v5` figé sur un état
// antérieur au reset de la base — au point d'afficher encore des films devenus
// indisponibles. Le bump supprime les anciens caches à l'activation (voir
// l'événement `activate` plus bas).
const VERSION = 'v6'
const CACHE_NAME = `zone-club-${VERSION}`

// Assets to pre-cache on install (critical path)
const PRECACHE_URLS = [
  '/textures/env/indoor_night.hdr',
  '/models/shelf.glb',
  '/models/vhs_cassette_tape.glb',
  '/basis/basis_transcoder.wasm',
  '/textures/wall/color.ktx2',
  '/textures/wall/normal.ktx2',
  '/textures/wall/roughness.ktx2',
  '/textures/wall/ao.ktx2',
  '/textures/wood/color.ktx2',
  '/textures/wood/normal.ktx2',
  '/textures/wood/roughness.ktx2',
  '/textures/storefront/color.ktx2',
  '/textures/storefront/normal.ktx2',
  '/textures/storefront/roughness.ktx2',
  '/textures/storefront/ao.ktx2',
  '/textures/floor/color.ktx2',
  '/textures/floor/normal.ktx2',
  '/textures/floor/roughness.ktx2',
]

// URL patterns and their caching strategies
function getStrategy(url) {
  const path = new URL(url).pathname

  // Immutable 3D assets — cache-first (never changes between deploys)
  if (
    path.startsWith('/models/') ||
    path.startsWith('/textures/') ||
    path.startsWith('/basis/') ||
    path.endsWith('.glb') ||
    path.endsWith('.ktx2') ||
    path.endsWith('.hdr') ||
    path.endsWith('.wasm')
  ) {
    return 'cache-first'
  }

  // Next.js static bundles — cache-first (content-hashed filenames = immutable)
  if (path.startsWith('/_next/static/')) {
    return 'cache-first'
  }

  // Poster proxy — network-only: served by /api/poster with HTTP Cache-Control
  // max-age=2592000 immutable. Browser HTTP cache handles repeat fetches without
  // SW intervention; duplicating in SW cache wasted ~58 MB on mobile.

  // Film catalog API — stale-while-revalidate: serve the cached catalog
  // instantly, then refresh it in the background so newly-added films surface
  // on the NEXT visit without needing a deploy + VERSION bump. (Was cache-first,
  // which stranded new films in stale caches until a redeploy — the trade-off
  // saved ~1 MB of revalidation per visit but caused a freshness bug.)
  if (path.startsWith('/api/films/')) {
    return 'stale-while-revalidate'
  }

  // Everything else (auth, rentals, reviews, admin, etc.)
  return 'network-only'
}

// Install: pre-cache critical assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(PRECACHE_URLS).catch(() => {
        // Non-fatal: some assets may not exist yet in dev
      })
    )
  )
  self.skipWaiting()
})

// Activate: clean up old cache versions
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

// Fetch: apply strategy based on URL
self.addEventListener('fetch', (event) => {
  const { request } = event

  // Only handle GET requests
  if (request.method !== 'GET') return

  const strategy = getStrategy(request.url)

  if (strategy === 'network-only') return // let browser handle normally

  if (strategy === 'cache-first') {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(request).then((cached) => {
          if (cached) return cached
          return fetch(request).then((response) => {
            if (response.ok) {
              cache.put(request, response.clone())
            }
            return response
          })
        })
      )
    )
    return
  }

  if (strategy === 'stale-while-revalidate') {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(request).then((cached) => {
          // Background refresh; .catch keeps it from ever rejecting so waitUntil is safe.
          const networkFetch = fetch(request)
            .then((response) => {
              if (response.ok) cache.put(request, response.clone())
              return response
            })
            .catch(() => undefined)
          // Keep the SW alive until the background revalidation settles.
          event.waitUntil(networkFetch)
          // Serve cache instantly when present; otherwise wait for the network.
          return cached || networkFetch.then((response) => response || fetch(request))
        })
      )
    )
    return
  }
})

// ===== Push Notifications (Chromecast film ended) =====
self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'Zone Club', body: event.data.text() }
  }

  const title = payload.title || 'Zone Club'
  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: payload.data || {},
    vibrate: [200, 100, 200],
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const data = event.notification.data || {}
  const filmId = data.filmId
  const targetUrl = filmId ? `/?castEnded=${filmId}` : '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing tab if available
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus()
          client.navigate(targetUrl)
          return
        }
      }
      // No existing tab — open new window
      return self.clients.openWindow(targetUrl)
    })
  )
})
