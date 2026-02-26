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
 */

const POSTER_WIDTH = 200
const POSTER_HEIGHT = 300
const BYTES_PER_PIXEL = 4
const POSTER_ROW_BYTES = POSTER_WIDTH * BYTES_PER_PIXEL

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
    img.onerror = reject
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
    this.texture.minFilter = THREE.LinearFilter
    this.texture.magFilter = THREE.LinearFilter
    this.texture.generateMipmaps = false
    this.texture.flipY = false
    this.texture.colorSpace = THREE.SRGBColorSpace
    this._dirty = true
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setRenderer(renderer: any): void {
    this._renderer = renderer
  }

  isGPUReady(): boolean {
    if (!this._renderer) return false
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const backend = (this._renderer as any).backend
      return !!(backend?.device && backend.get?.(this.texture)?.texture)
    } catch { return false }
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

      if (this._renderer) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const backend = (this._renderer as any).backend
          if (backend?.device && backend.get) {
            const device = backend.device as GPUDevice
            const texData = backend.get(this.texture)
            if (texData?.texture) {
              device.queue.writeTexture(
                {
                  texture: texData.texture,
                  origin: { x: col * POSTER_WIDTH, y: row * POSTER_HEIGHT, z: 0 },
                },
                pixels as unknown as ArrayBufferView<ArrayBuffer>,
                { bytesPerRow: POSTER_ROW_BYTES, rowsPerImage: POSTER_HEIGHT },
                { width: POSTER_WIDTH, height: POSTER_HEIGHT, depthOrArrayLayers: 1 }
              )
              this.loadedSlots.add(slot)
              return
            }
          }
        } catch {
          // GPU not ready — fall through to CPU path
        }
      }

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

  dispose(): void {
    this.texture.dispose()
    this.loadedSlots.clear()
  }

  get posterWidth(): number { return POSTER_WIDTH }
  get posterHeight(): number { return POSTER_HEIGHT }
}
