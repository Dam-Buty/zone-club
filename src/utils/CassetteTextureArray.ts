import * as THREE from 'three'

/**
 * Manages a DataArrayTexture that stacks all cassette poster textures into
 * a single GPU texture array. Each cassette poster is a "layer" in the array.
 *
 * This allows a single InstancedMesh with 1 material to render all ~520 cassettes
 * with unique textures — reducing 520 draw calls to 1.
 *
 * Texture resolution: 200x300 per layer (matches TMDB w200 source exactly).
 * Total for 520 layers: ~125 MB RGBA (within M1 8GB GPU capabilities).
 *
 * WebGPU optimization: uses copyExternalImageToTexture for per-layer direct GPU upload.
 * Each poster uploads only 240KB (1 layer) instead of re-uploading the full 125MB array.
 * No mipmaps — LinearFilter + anisotropy 16 is sufficient at 200x300 resolution.
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _renderer: any = null // THREE.WebGPURenderer (no @types/three export)

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
    // No mipmaps — LinearFilter + anisotropy 16 is sufficient at 200x300
    // Saves 62.5MB VRAM (mipmap chain) and avoids full-array mipmap regeneration
    this.textureArray.minFilter = THREE.LinearFilter
    this.textureArray.magFilter = THREE.LinearFilter
    this.textureArray.generateMipmaps = false
    this.textureArray.anisotropy = 16
    this.textureArray.colorSpace = THREE.SRGBColorSpace
    this._dirty = true
  }

  /**
   * Store a reference to the WebGPU renderer for direct GPU uploads.
   * Must be called after the first render (when the GPUTexture is allocated).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setRenderer(renderer: any): void {
    this._renderer = renderer
  }

  /**
   * Check if the GPU texture is allocated and ready for direct uploads.
   * Returns false before the first render (GPUTexture not yet created).
   */
  isGPUReady(): boolean {
    if (!this._renderer) return false
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const backend = (this._renderer as any).backend
      return !!(backend?.device && backend.get?.(this.textureArray)?.texture)
    } catch { return false }
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
   * Uses WebGPU copyExternalImageToTexture when the renderer is available,
   * uploading only 240KB per layer instead of the full 125MB array.
   * Falls back to the canvas path for the first frame before GPUTexture exists.
   */
  async loadPosterIntoLayer(url: string, layerIndex: number): Promise<void> {
    if (layerIndex >= this.maxLayers) return
    if (this.loadedLayers.has(layerIndex)) return

    try {
      const img = await preloadPosterImage(url)

      // Create ImageBitmap with hardware resize + Y-flip
      const bitmap = await createImageBitmap(img, {
        resizeWidth: LAYER_WIDTH,
        resizeHeight: LAYER_HEIGHT,
        imageOrientation: 'flipY',
      })

      // Try direct GPU upload via WebGPU API
      if (this._renderer) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const backend = (this._renderer as any).backend
          if (backend?.device && backend.get) {
            const device = backend.device as GPUDevice
            const texData = backend.get(this.textureArray)
            if (texData?.texture) {
              device.queue.copyExternalImageToTexture(
                { source: bitmap, flipY: false }, // already flipped by createImageBitmap
                { texture: texData.texture, origin: { x: 0, y: 0, z: layerIndex } },
                { width: LAYER_WIDTH, height: LAYER_HEIGHT, depthOrArrayLayers: 1 }
              )
              bitmap.close()
              this.loadedLayers.add(layerIndex)
              return
            }
          }
        } catch {
          // GPUTexture not ready yet — fall through to canvas path
        }
      }

      // Fallback: canvas path (first frame before GPUTexture is allocated)
      bitmap.close()
      this.loadPosterViaCanvas(img, layerIndex)
    } catch {
      // On error, keep the fallback color already set
    }
  }

  /**
   * Fallback poster loading via canvas (used before WebGPU GPUTexture is ready).
   * Copies pixels into the CPU-side Uint8Array for later flush().
   */
  private loadPosterViaCanvas(img: HTMLImageElement, layerIndex: number): void {
    const canvas = document.createElement('canvas')
    canvas.width = LAYER_WIDTH
    canvas.height = LAYER_HEIGHT
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!

    ctx.drawImage(img, 0, 0, LAYER_WIDTH, LAYER_HEIGHT)
    const imageData = ctx.getImageData(0, 0, LAYER_WIDTH, LAYER_HEIGHT)
    const pixels = imageData.data

    const offset = layerIndex * LAYER_WIDTH * LAYER_HEIGHT * BYTES_PER_PIXEL
    const rowBytes = LAYER_WIDTH * BYTES_PER_PIXEL
    // DataArrayTexture expects rows bottom-to-top (OpenGL convention)
    for (let y = 0; y < LAYER_HEIGHT; y++) {
      const srcStart = y * rowBytes
      const dstStart = (LAYER_HEIGHT - 1 - y) * rowBytes + offset
      this.data.set(pixels.subarray(srcStart, srcStart + rowBytes), dstStart)
    }

    this.loadedLayers.add(layerIndex)
    this._dirty = true
  }

  /**
   * Flush pending texture changes to the GPU (call once per frame from animation loop).
   * Only needed for the initial fallback color upload. Once setRenderer() is called,
   * poster uploads go directly to the GPU via copyExternalImageToTexture.
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
