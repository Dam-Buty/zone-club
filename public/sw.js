// Minimal service worker — required for PWA installability.
// No caching: WebGPU + 3D assets are best served fresh from network.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {
  // Network-only: let the browser handle all requests normally.
  // A fetch listener is required by Chrome for the install prompt.
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
