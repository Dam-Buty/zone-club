/**
 * Procedural Kent tile texture generator (octagon + diamond dot pattern).
 *
 * One texture tile = one octagonal tile with quarter-diamonds at corners.
 * When tiled via THREE.RepeatWrapping, the quarter-diamonds merge into
 * full diamond inserts at every four-tile intersection.
 *
 * Reference: carrelage-sol-traditionnel-kent-noir-33x33-cm.avif
 */
import * as THREE from 'three'

// ─── Geometry helpers ────────────────────────────────────────

/** Regular octagon cut distance for a square of side S. */
function cutDistance(S: number): number {
  return S / (2 + Math.SQRT2)
}

/** Draw one octagon path, inset from the tile square by `g` (half-grout). */
function octagonPath(ctx: CanvasRenderingContext2D, S: number, g: number, dg: number) {
  const a = cutDistance(S)
  ctx.beginPath()
  ctx.moveTo(a + dg, g)
  ctx.lineTo(S - a - dg, g)
  ctx.lineTo(S - g, a + dg)
  ctx.lineTo(S - g, S - a - dg)
  ctx.lineTo(S - a - dg, S - g)
  ctx.lineTo(a + dg, S - g)
  ctx.lineTo(g, S - a - dg)
  ctx.lineTo(g, a + dg)
  ctx.closePath()
}

/** Draw corner quarter-diamond at specified corner. */
function cornerTriangle(
  ctx: CanvasRenderingContext2D,
  S: number,
  corner: 'tl' | 'tr' | 'br' | 'bl',
  dg: number,
) {
  const a = cutDistance(S)
  ctx.beginPath()
  switch (corner) {
    case 'tl':
      ctx.moveTo(0, 0)
      ctx.lineTo(a - dg, 0)
      ctx.lineTo(0, a - dg)
      break
    case 'tr':
      ctx.moveTo(S, 0)
      ctx.lineTo(S, a - dg)
      ctx.lineTo(S - a + dg, 0)
      break
    case 'br':
      ctx.moveTo(S, S)
      ctx.lineTo(S - a + dg, S)
      ctx.lineTo(S, S - a + dg)
      break
    case 'bl':
      ctx.moveTo(0, S)
      ctx.lineTo(0, S - a + dg)
      ctx.lineTo(a - dg, S)
      break
  }
  ctx.closePath()
}

// ─── Color map ───────────────────────────────────────────────

function generateColorMap(size: number, grout: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  const S = size
  const G = grout
  const g = G / 2 // half-grout for flat edges
  const dg = G * 0.7 // diagonal grout offset

  // 1. Background = grout color
  ctx.fillStyle = '#8a8580'
  ctx.fillRect(0, 0, S, S)

  // 2. Corner quarter-diamonds (black inserts)
  ctx.fillStyle = '#1a1a1a'
  for (const corner of ['tl', 'tr', 'br', 'bl'] as const) {
    cornerTriangle(ctx, S, corner, dg)
    ctx.fill()
  }

  // 3. Octagon (off-white ceramic)
  ctx.fillStyle = '#f2f0ea'
  octagonPath(ctx, S, g, dg)
  ctx.fill()

  // 4. Subtle sheen gradient on octagon (top-down soft highlight)
  const grad = ctx.createLinearGradient(0, g, 0, S - g)
  grad.addColorStop(0, 'rgba(255,255,255,0.06)')
  grad.addColorStop(0.5, 'rgba(255,255,255,0.0)')
  grad.addColorStop(1, 'rgba(0,0,0,0.03)')
  ctx.fillStyle = grad
  octagonPath(ctx, S, g, dg)
  ctx.fill()

  return canvas
}

// ─── Height / bump map ───────────────────────────────────────

function generateHeightMap(size: number, grout: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  const S = size
  const G = grout
  const g = G / 2
  const dg = G * 0.7

  // Background = grout (low)
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, S, S)

  // Corner diamonds (medium height — slightly recessed vs octagon)
  ctx.fillStyle = '#cccccc'
  for (const corner of ['tl', 'tr', 'br', 'bl'] as const) {
    cornerTriangle(ctx, S, corner, dg)
    ctx.fill()
  }

  // Octagon surface (full height)
  ctx.fillStyle = '#ffffff'
  octagonPath(ctx, S, g, dg)
  ctx.fill()

  return canvas
}

// ─── Normal map from heightmap ───────────────────────────────

function heightToNormalMap(heightCanvas: HTMLCanvasElement, strength: number = 2.0): HTMLCanvasElement {
  const S = heightCanvas.width
  const hCtx = heightCanvas.getContext('2d')!
  const hData = hCtx.getImageData(0, 0, S, S).data

  const normalCanvas = document.createElement('canvas')
  normalCanvas.width = S
  normalCanvas.height = S
  const nCtx = normalCanvas.getContext('2d')!
  const nImg = nCtx.createImageData(S, S)
  const nData = nImg.data

  // Helper: get height at (x, y) with wrapping
  const h = (x: number, y: number) => {
    const wx = ((x % S) + S) % S
    const wy = ((y % S) + S) % S
    return hData[(wy * S + wx) * 4] / 255
  }

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // Sobel-like gradient
      const dX = (h(x + 1, y) - h(x - 1, y)) * strength
      const dY = (h(x, y + 1) - h(x, y - 1)) * strength

      // Tangent-space normal
      const len = Math.sqrt(dX * dX + dY * dY + 1)
      const nx = -dX / len
      const ny = -dY / len
      const nz = 1 / len

      const idx = (y * S + x) * 4
      nData[idx + 0] = Math.round((nx * 0.5 + 0.5) * 255)
      nData[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255)
      nData[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255)
      nData[idx + 3] = 255
    }
  }

  nCtx.putImageData(nImg, 0, 0)
  return normalCanvas
}

// ─── Public API ──────────────────────────────────────────────

interface KentTileResult {
  map: THREE.CanvasTexture
  normalMap: THREE.CanvasTexture
}

/**
 * Generate tileable Kent tile textures (octagon + diamond dot).
 *
 * @param repeatX - number of tiles across X (UV repeat)
 * @param repeatY - number of tiles across Y (UV repeat)
 * @param size - texture resolution per tile (default 256)
 * @param groutPx - grout width in pixels (default 6)
 */
export function generateKentTileTextures(
  repeatX: number,
  repeatY: number,
  size = 256,
  groutPx = 6,
): KentTileResult {
  // Color map
  const colorCanvas = generateColorMap(size, groutPx)
  const colorTex = new THREE.CanvasTexture(colorCanvas)
  colorTex.wrapS = THREE.RepeatWrapping
  colorTex.wrapT = THREE.RepeatWrapping
  colorTex.repeat.set(repeatX, repeatY)
  colorTex.colorSpace = THREE.SRGBColorSpace
  colorTex.anisotropy = 16
  colorTex.minFilter = THREE.LinearMipmapLinearFilter
  colorTex.magFilter = THREE.LinearFilter
  colorTex.generateMipmaps = true

  // Normal map from heightmap
  const heightCanvas = generateHeightMap(size, groutPx)
  const normalCanvas = heightToNormalMap(heightCanvas, 2.0)
  const normalTex = new THREE.CanvasTexture(normalCanvas)
  normalTex.wrapS = THREE.RepeatWrapping
  normalTex.wrapT = THREE.RepeatWrapping
  normalTex.repeat.set(repeatX, repeatY)
  normalTex.colorSpace = THREE.LinearSRGBColorSpace
  normalTex.anisotropy = 16
  normalTex.minFilter = THREE.LinearMipmapLinearFilter
  normalTex.magFilter = THREE.LinearFilter
  normalTex.generateMipmaps = true

  return { map: colorTex, normalMap: normalTex }
}
