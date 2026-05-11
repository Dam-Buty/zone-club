import * as THREE from 'three'

/**
 * 2D texture atlas for cassette posters. All unique poster images are tiled
 * into a single DataTexture grid, completely avoiding DataArrayTexture which
 * has driver-level bugs on Vulkan/NVIDIA and iOS Metal WebGPU backends
 * (horizontal tearing/corruption on array texture layer uploads).
 *
 * Each poster occupies a 200×300 cell in the atlas grid. Instances reference
 * their cell via a vec4 attribute (uOffset, vOffset, uScale, vScale) that
 * the TSL shader uses to remap box-face UVs to the correct atlas sub-region.
 *
 * Slot 0 is reserved for the fallback color (no poster).
 * Unique posters are deduplicated: ~50 unique URLs for ~520 instances.
 *
 * Per-poster GPU upload uses writeTexture with 2D sub-region origin,
 * uploading only 240KB per poster instead of the full ~13MB atlas.
 *
 * IndexedDB caching: the fully-built atlas (Uint8Array) is saved to IndexedDB
 * keyed by a fingerprint of the poster URLs. On revisit, the atlas is restored
 * from cache in ~50ms (1 GPU upload) instead of re-decoding all images
 * (~3s + 15 GPU uploads on mobile).
 */

// Aligned with TMDB w185 source (~185×278). 200×300 is the smallest power-friendly
// size that doesn't downscale below source. Atlas = 200×300×4×18×18 = 78 MB
// (vs 127 MB at 256×384, which was upscaling the source).
const POSTER_WIDTH = 200
const POSTER_HEIGHT = 300
const BYTES_PER_PIXEL = 4
const POSTER_ROW_BYTES = POSTER_WIDTH * BYTES_PER_PIXEL

// ===== IndexedDB Atlas Cache =====
const IDB_NAME = 'cassette-atlas-cache'
// Bump on POSTER_WIDTH/HEIGHT change — old cached atlases have incompatible byte layout
const IDB_VERSION = 2
const IDB_STORE = 'atlases'
const IDB_KEY = 'current' // single-entry cache (latest atlas only)

function openAtlasDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (db.objectStoreNames.contains(IDB_STORE)) {
        db.deleteObjectStore(IDB_STORE)
      }
      db.createObjectStore(IDB_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

interface AtlasCacheEntry {
  fingerprint: string
  data: ArrayBuffer
  cols: number
  rows: number
  loadedSlots: number[]
}

async function idbGet(): Promise<AtlasCacheEntry | undefined> {
  const db = await openAtlasDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY)
    req.onsuccess = () => resolve(req.result as AtlasCacheEntry | undefined)
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => db.close()
  })
}

async function idbPut(entry: AtlasCacheEntry): Promise<void> {
  const db = await openAtlasDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(entry, IDB_KEY)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

let _extractCanvas: HTMLCanvasElement | null = null
let _extractCtx: CanvasRenderingContext2D | null = null

function extractPosterPixels(img: HTMLImageElement): Uint8ClampedArray {
  if (!_extractCanvas) {
    _extractCanvas = document.createElement('canvas')
    _extractCanvas.width = POSTER_WIDTH
    _extractCanvas.height = POSTER_HEIGHT
    _extractCtx = _extractCanvas.getContext('2d', { willReadFrequently: true })!
  }
  const ctx = _extractCtx!
  ctx.drawImage(img, 0, 0, POSTER_WIDTH, POSTER_HEIGHT)
  return ctx.getImageData(0, 0, POSTER_WIDTH, POSTER_HEIGHT).data
}

// ===== SHARED POSTER IMAGE CACHE =====
const _posterCache = new Map<string, Promise<HTMLImageElement>>()

export function preloadPosterImage(url: string): Promise<HTMLImageElement> {
  const existing = _posterCache.get(url)
  if (existing) return existing

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => {
      // Retry once with cache-bust to bypass stale non-CORS cached responses
      const retry = new Image()
      retry.crossOrigin = 'anonymous'
      retry.onload = () => resolve(retry)
      retry.onerror = reject
      retry.src = url + (url.includes('?') ? '&' : '?') + 'cb=1'
    }
    img.src = url
  })

  _posterCache.set(url, promise)
  return promise
}

export interface CassetteInstanceData {
  cassetteKey: string
  filmId: number
  worldPosition: THREE.Vector3
  worldQuaternion: THREE.Quaternion
  hoverOffsetZ: number
  hoverTiltAngle: number  // per-instance tilt (radians) applied during hover
  posterUrl: string | null
  fallbackColor: string
}

export class CassetteTextureAtlas {
  texture: THREE.DataTexture
  readonly cols: number
  readonly rows: number
  readonly atlasWidth: number
  readonly atlasHeight: number
  private data: Uint8Array
  private loadedSlots = new Set<number>()
  private _dirty = false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _renderer: any = null

  constructor(maxSlots: number) {
    this.cols = Math.ceil(Math.sqrt(maxSlots))
    this.rows = Math.ceil(maxSlots / this.cols)
    this.atlasWidth = this.cols * POSTER_WIDTH
    this.atlasHeight = this.rows * POSTER_HEIGHT

    const size = this.atlasWidth * this.atlasHeight * BYTES_PER_PIXEL
    this.data = new Uint8Array(size)

    const uint32View = new Uint32Array(this.data.buffer)
    uint32View.fill(0xFF2E1A1A) // RGBA(26, 26, 46, 255) little-endian

    this.texture = new THREE.DataTexture(this.data, this.atlasWidth, this.atlasHeight)
    this.texture.format = THREE.RGBAFormat
    this.texture.type = THREE.UnsignedByteType
    this.texture.minFilter = THREE.LinearMipmapLinearFilter
    this.texture.magFilter = THREE.LinearFilter
    this.texture.generateMipmaps = true
    this.texture.flipY = false
    this.texture.colorSpace = THREE.SRGBColorSpace
    this._dirty = true
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setRenderer(renderer: any): void {
    this._renderer = renderer
    try {
      const maxAnisotropy = typeof renderer.getMaxAnisotropy === 'function'
        ? renderer.getMaxAnisotropy()
        : 1
      this.texture.anisotropy = Math.min(16, Math.max(1, maxAnisotropy))
    } catch {
      this.texture.anisotropy = 1
    }
  }

  isGPUReady(): boolean {
    return !!this._renderer
  }

  /**
   * Returns the UV rect [uOffset, vOffset, uScale, vScale] for a grid slot.
   * Used by instances to build the per-instance atlasRect attribute.
   */
  getSlotRect(slot: number): [number, number, number, number] {
    const col = slot % this.cols
    const row = Math.floor(slot / this.cols)
    return [
      (col * POSTER_WIDTH) / this.atlasWidth,
      (row * POSTER_HEIGHT) / this.atlasHeight,
      POSTER_WIDTH / this.atlasWidth,
      POSTER_HEIGHT / this.atlasHeight,
    ]
  }

  async loadPosterIntoSlot(url: string, slot: number): Promise<void> {
    if (this.loadedSlots.has(slot)) return

    try {
      const img = await preloadPosterImage(url)
      const pixels = extractPosterPixels(img)
      const col = slot % this.cols
      const row = Math.floor(slot / this.cols)

      this.copyPixelsToAtlas(pixels, col, row)
      this.loadedSlots.add(slot)
      this._dirty = true
    } catch {
      // On error, keep the fallback color
    }
  }

  private copyPixelsToAtlas(pixels: Uint8ClampedArray, col: number, row: number): void {
    const atlasRowBytes = this.atlasWidth * BYTES_PER_PIXEL
    const startX = col * POSTER_WIDTH * BYTES_PER_PIXEL
    const startY = row * POSTER_HEIGHT
    for (let y = 0; y < POSTER_HEIGHT; y++) {
      const srcOffset = y * POSTER_ROW_BYTES
      const dstOffset = (startY + y) * atlasRowBytes + startX
      this.data.set(
        pixels.subarray(srcOffset, srcOffset + POSTER_ROW_BYTES),
        dstOffset
      )
    }
  }

  flush(): boolean {
    if (this._dirty) {
      this.texture.needsUpdate = true
      this._dirty = false
      return true
    }
    return false
  }

  /**
   * Save the fully-built atlas to IndexedDB for instant restore on next visit.
   * Best-effort — silently ignores errors (quota, private browsing, etc.).
   */
  async saveToCache(fingerprint: string): Promise<void> {
    try {
      await idbPut({
        fingerprint,
        data: (this.data.buffer as ArrayBuffer).slice(0), // structured-clone-safe copy
        cols: this.cols,
        rows: this.rows,
        loadedSlots: Array.from(this.loadedSlots),
      })
    } catch {
      // Cache save is best-effort
    }
  }

  /**
   * Try to restore the atlas from IndexedDB cache.
   * Returns true if cache hit (data restored, ready to flush).
   */
  async restoreFromCache(fingerprint: string): Promise<boolean> {
    try {
      const _t0 = performance.now()
      const cached = await idbGet()
      const _t1 = performance.now()
      console.warn(`[IDB-GET] ${(_t1 - _t0).toFixed(0)}ms (has=${!!cached})`)
      if (!cached) return false
      if (cached.fingerprint !== fingerprint) return false
      if (cached.cols !== this.cols || cached.rows !== this.rows) return false

      const _t2 = performance.now()
      this.data.set(new Uint8Array(cached.data))
      const _t3 = performance.now()
      console.warn(`[IDB-COPY] ${(_t3 - _t2).toFixed(0)}ms (${(cached.data.byteLength / 1024 / 1024).toFixed(1)}MB)`)
      for (const slot of cached.loadedSlots) {
        this.loadedSlots.add(slot)
      }
      this._dirty = true
      return true
    } catch {
      return false
    }
  }

  dispose(): void {
    this.texture.dispose()
    this.loadedSlots.clear()
  }

  get posterWidth(): number { return POSTER_WIDTH }
  get posterHeight(): number { return POSTER_HEIGHT }
}
