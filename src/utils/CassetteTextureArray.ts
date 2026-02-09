import * as THREE from 'three'

/**
 * Manages a DataArrayTexture that stacks all cassette poster textures into
 * a single GPU texture array. Each cassette poster is a "layer" in the array.
 *
 * This allows a single InstancedMesh with 1 material to render all ~520 cassettes
 * with unique textures — reducing 520 draw calls to 1.
 *
 * Texture resolution: 200×300 per layer (matches TMDB w200 source exactly, no downscaling).
 * Total for 520 layers: ~125 MB RGBA (within M1 8GB GPU capabilities).
 * Mipmaps enabled for quality at distance (smooth downsampling).
 *
 * WebGPU maxTextureArrayLayers: M1 via Metal supports up to 2048 layers.
 */

const LAYER_WIDTH = 200
const LAYER_HEIGHT = 300
const BYTES_PER_PIXEL = 4 // RGBA

// ===== SHARED POSTER IMAGE CACHE =====
// Keeps loaded HTMLImageElement references alive so the browser doesn't GC them.
// App.tsx preloads all posters at module level → cache is warm by the time
// CassetteTextureArray needs them → 0ms instead of ~600ms network re-fetches.
const _posterCache = new Map<string, Promise<HTMLImageElement>>()

/**
 * Preload a poster image into the shared cache.
 * Returns a promise that resolves to the loaded HTMLImageElement.
 * If the same URL was already requested, returns the existing promise (dedup).
 */
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

// Canvas for resizing loaded poster images
let resizeCanvas: HTMLCanvasElement | null = null
let resizeCtx: CanvasRenderingContext2D | null = null

function getResizeCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  if (!resizeCanvas) {
    resizeCanvas = document.createElement('canvas')
    resizeCanvas.width = LAYER_WIDTH
    resizeCanvas.height = LAYER_HEIGHT
    resizeCtx = resizeCanvas.getContext('2d', { willReadFrequently: true })!
  }
  return { canvas: resizeCanvas, ctx: resizeCtx! }
}

export interface CassetteInstanceData {
  cassetteKey: string
  filmId: number
  worldPosition: THREE.Vector3   // position in world space (after parent transforms)
  worldQuaternion: THREE.Quaternion
  hoverOffsetZ: number
  posterUrl: string | null
  fallbackColor: string
}

export class CassetteTextureArray {
  textureArray: THREE.DataArrayTexture
  private maxLayers: number
  private data: Uint8Array
  private loadedLayers = new Set<number>()
  private _dirty = false

  constructor(maxLayers: number) {
    this.maxLayers = maxLayers
    const size = LAYER_WIDTH * LAYER_HEIGHT * BYTES_PER_PIXEL * maxLayers
    this.data = new Uint8Array(size)

    // Fast bulk fill: set all pixels to a uniform dark color via Uint32Array view.
    // ~1ms for 125MB vs ~300-500ms for 520 individual fillLayerWithColor calls.
    // Little-endian RGBA packing: uint32 = (A << 24) | (B << 16) | (G << 8) | R
    // Dark blue-grey: RGBA(26, 26, 46, 255) = 0xFF2E1A1A
    const uint32View = new Uint32Array(this.data.buffer)
    uint32View.fill(0xFF2E1A1A)

    this.textureArray = new THREE.DataArrayTexture(this.data, LAYER_WIDTH, LAYER_HEIGHT, maxLayers)
    this.textureArray.format = THREE.RGBAFormat
    this.textureArray.type = THREE.UnsignedByteType
    // Mipmaps for quality at distance — smooth downsampling instead of aliasing
    this.textureArray.minFilter = THREE.LinearMipmapLinearFilter
    this.textureArray.magFilter = THREE.LinearFilter
    this.textureArray.generateMipmaps = true
    this.textureArray.anisotropy = 16
    this.textureArray.colorSpace = THREE.SRGBColorSpace
    this._dirty = true
  }

  /**
   * Fill a layer with a solid fallback color (used when no poster available).
   * Does NOT trigger GPU upload — call flush() after batch operations.
   */
  fillLayerWithColor(layerIndex: number, hexColor: string): void {
    if (layerIndex >= this.maxLayers) return

    const color = new THREE.Color(hexColor)
    const r = Math.floor(color.r * 255)
    const g = Math.floor(color.g * 255)
    const b = Math.floor(color.b * 255)

    const offset = layerIndex * LAYER_WIDTH * LAYER_HEIGHT * BYTES_PER_PIXEL
    for (let i = 0; i < LAYER_WIDTH * LAYER_HEIGHT; i++) {
      const idx = offset + i * BYTES_PER_PIXEL
      this.data[idx] = r
      this.data[idx + 1] = g
      this.data[idx + 2] = b
      this.data[idx + 3] = 255
    }
    this._dirty = true
  }

  /**
   * Load a poster image from URL and copy it into the specified layer.
   * Uses the shared poster cache — if App.tsx already preloaded this URL,
   * the promise is already resolved and we get the image instantly (~0ms).
   * Does NOT trigger GPU upload — call flush() to batch uploads per frame.
   */
  loadPosterIntoLayer(url: string, layerIndex: number): Promise<void> {
    if (layerIndex >= this.maxLayers) return Promise.resolve()
    if (this.loadedLayers.has(layerIndex)) return Promise.resolve()

    return preloadPosterImage(url).then((img) => {
      const { ctx } = getResizeCanvas()

      // Draw resized image to canvas
      ctx.clearRect(0, 0, LAYER_WIDTH, LAYER_HEIGHT)
      ctx.drawImage(img, 0, 0, LAYER_WIDTH, LAYER_HEIGHT)

      // Read pixel data
      const imageData = ctx.getImageData(0, 0, LAYER_WIDTH, LAYER_HEIGHT)
      const pixels = imageData.data

      // Copy into the correct layer of the DataArrayTexture
      const offset = layerIndex * LAYER_WIDTH * LAYER_HEIGHT * BYTES_PER_PIXEL
      const rowBytes = LAYER_WIDTH * BYTES_PER_PIXEL
      // DataArrayTexture expects rows bottom-to-top (OpenGL convention)
      // but getImageData is top-to-bottom, so we flip Y using TypedArray.set()
      for (let y = 0; y < LAYER_HEIGHT; y++) {
        const srcStart = y * rowBytes
        const dstStart = (LAYER_HEIGHT - 1 - y) * rowBytes + offset
        this.data.set(pixels.subarray(srcStart, srcStart + rowBytes), dstStart)
      }

      this.loadedLayers.add(layerIndex)
      this._dirty = true
    }).catch(() => {
      // On error, keep the fallback color already set
    })
  }

  /**
   * Flush pending texture changes to the GPU (call once per frame from animation loop).
   * Returns true if a flush occurred.
   */
  flush(): boolean {
    if (this._dirty) {
      this.textureArray.needsUpdate = true
      this._dirty = false
      return true
    }
    return false
  }

  dispose(): void {
    this.textureArray.dispose()
    this.loadedLayers.clear()
  }

  get layerWidth(): number { return LAYER_WIDTH }
  get layerHeight(): number { return LAYER_HEIGHT }
}
