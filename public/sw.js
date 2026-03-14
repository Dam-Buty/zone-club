// Service Worker — cache-first for 3D assets, stale-while-revalidate for API data
// Bump VERSION on every deploy to invalidate stale caches
const VERSION = 'v1'
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

  // Poster proxy — cache-first (TMDB images are immutable per path)
  if (path.startsWith('/api/poster/')) {
    return 'cache-first'
  }

  // Film catalog API — stale-while-revalidate (data may change, serve fast)
  if (path.startsWith('/api/films/')) {
    return 'stale-while-revalidate'
  }

  // Everything else — network only
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
          const fetchPromise = fetch(request).then((response) => {
            if (response.ok) {
              cache.put(request, response.clone())
            }
            return response
          })
          return cached || fetchPromise
        })
      )
    )
    return
  }
})
