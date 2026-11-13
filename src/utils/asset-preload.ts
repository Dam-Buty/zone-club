// Interior asset preload — kicks off browser fetches for the heaviest interior
// assets once the storefront is on screen (see interior-preload-gate.ts): they
// used to start the moment this module was imported and starved the storefront.
//
// HDR + KTX2 don't have a `useX.preload()` API equivalent to useGLTF.preload.
// Instead, we issue plain fetch() calls so the responses populate the HTTP
// cache (and the SW cache via existing /textures/ cache-first rule). When
// useTexture/Environment/KTX2Loader run later, they hit the cache instantly.
//
// fetch() rather than <link rel="preload">: a preload expires after ~4s if not
// consumed, and our Suspense tree takes longer to mount. fetch() puts the bytes
// in disk cache where they survive indefinitely.

import { afterStorefront } from './interior-preload-gate'

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
  // GLB : ils étaient préchargés par des <link> du <head>. Les useGLTF.preload des modules
  // de l'intérieur ne suffisent pas — plusieurs vivent dans des chunks chargés à l'entrée.
  '/models/vhs_cassette_tape.glb',
  '/models/shelf.glb',
  '/models/board.glb',
  '/models/leather_couch.glb',
  '/models/crt_tv.glb',
  '/models/rick.glb',
  '/models/fire_extinguisher.glb',
  '/models/minitel_1982-france.glb',
]

if (typeof window !== 'undefined') {
  afterStorefront(() => {
    for (const url of ASSETS_TO_PREFETCH) {
      fetch(url, { cache: 'force-cache', priority: 'low' } as RequestInit).catch(() => {
        // Silent fail — Suspense will retry on its own when components mount
      })
    }
  })
}

export {}
