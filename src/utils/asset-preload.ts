// Top-level asset preload — kicks off browser fetches for the heaviest interior
// assets the moment this module is imported (typically at App.tsx mount).
//
// HDR + KTX2 don't have a `useX.preload()` API equivalent to useGLTF.preload.
// Instead, we issue plain fetch() calls so the responses populate the HTTP
// cache (and the SW cache via existing /textures/ cache-first rule). When
// useTexture/Environment/KTX2Loader run later, they hit the cache instantly.
//
// This eliminates the "preloaded but not used" warnings caused by the
// <link rel="preload"> in app/layout.tsx — those expire after ~4s if not
// consumed, but our Suspense tree takes longer to mount. Using fetch() here
// puts the bytes in disk cache where they survive indefinitely.

const ASSETS_TO_PREFETCH = [
  '/textures/env/indoor_night.hdr',
  '/basis/basis_transcoder.wasm',
  '/textures/wall/color.ktx2',
  '/textures/wall/normal.ktx2',
  '/textures/wall/roughness.ktx2',
  '/textures/wall/ao.ktx2',
  '/textures/wood/color.ktx2',
  '/textures/wood/normal.ktx2',
  '/textures/wood/roughness.ktx2',
  '/textures/floor/color.ktx2',
  '/textures/floor/normal.ktx2',
  '/textures/floor/roughness.ktx2',
  '/textures/storefront/color.ktx2',
  '/textures/storefront/normal.ktx2',
  '/textures/storefront/roughness.ktx2',
  '/textures/storefront/ao.ktx2',
]

if (typeof window !== 'undefined') {
  for (const url of ASSETS_TO_PREFETCH) {
    fetch(url, { cache: 'force-cache', priority: 'low' } as RequestInit).catch(() => {
      // Silent fail — Suspense will retry on its own when components mount
    })
  }
}

export {}
