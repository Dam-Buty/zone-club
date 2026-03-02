// Minimal service worker — required for PWA installability.
// No caching: WebGPU + 3D assets are best served fresh from network.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {
  // Network-only: let the browser handle all requests normally.
  // A fetch listener is required by Chrome for the install prompt.
})
