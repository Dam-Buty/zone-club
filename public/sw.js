// Service Worker — cache-first pour les assets 3D immuables, network-only pour
// tout le reste (catalogue, posters, auth, locations…).
//
// Les posters sont servis par /api/poster avec un Cache-Control max-age=2592000
// immutable : le cache HTTP du navigateur suffit, les dupliquer ici coûtait
// ~58 Mo sur mobile.
//
// VERSION à bumper quand les assets précachés changent (modèles GLB, textures
// KTX2, HDR) : leurs URLs ne sont pas content-hashées, donc rien d'autre ne les
// invalide. L'`activate` supprime tous les caches dont le nom ne correspond pas.
//
// v7 : le catalogue sort du cache applicatif. Il y était en
// stale-while-revalidate, ce qui servait toujours une version en retard d'une
// visite, et les entrées mortes ne disparaissaient qu'au bump manuel de VERSION
// — le catalogue est passé de 18 à 127 films sans que personne y pense, et les
// navigateurs ont servi pendant des jours un état antérieur au reset de la base,
// jusqu'à afficher des films devenus indisponibles. La fraîcheur d'une donnée
// qui bouge chaque semaine ne peut pas dépendre d'un geste manuel au
// déploiement. Le coût réel de ce cache était de 233 Ko gzip, ramenés à 120 Ko
// en cessant de servir la ligne SQL entière (voir FILM_LIST_COLUMNS dans
// lib/films.ts) — largement payable à chaque visite.
const VERSION = 'v7'
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

  // Tout le reste — catalogue, proxy poster, auth, locations, critiques, admin.
  // Le catalogue compris : c'est de la donnée mutable, son cache est celui du
  // navigateur, piloté par le Cache-Control des routes (voir l'en-tête de ce
  // fichier).
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
