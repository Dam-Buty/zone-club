import { BufferGeometry, BufferAttribute, Box3, Vector3 } from 'three'

// Lightmapped shell meshes, in a STABLE order → atlas slot index. This order is
// the SINGLE source of truth for slot indices at bake AND runtime. (Instanced
// shelf planks/dividers are NOT here — they are occluders only.)
export const SHELL_SLOTS = [
  'floor', 'ceiling', 'wall-north', 'wall-south', 'wall-left', 'wall-right',
  'island-0', 'island-1',
  'shelfback-0', 'shelfback-1', 'shelfback-2', 'shelfback-3',
  'shelfback-4', 'shelfback-5', 'shelfback-6', 'shelfback-7',
] as const

export type ShellSlot = (typeof SHELL_SLOTS)[number]

const _box = new Box3()
const _size = new Vector3()
const _p = new Vector3()

type Axis = 'x' | 'y' | 'z'

/**
 * Planar-project `geo` by its dominant (thinnest) axis into the [0,1]² slot for
 * `slotIndex` of a perfect-square `slotCount` atlas, writing a `uv1` attribute.
 *
 * Deterministic: identical geometry + (slotIndex, slotCount) ⇒ identical uv1.
 * That invariant is what lets us ship only the baked PNG — the runtime recomputes
 * the same uv1 on the same meshes, so the lightmap maps back exactly.
 *
 * A small per-slot gutter keeps bilinear sampling from bleeding across slots.
 */
export function applyShellUv1(geo: BufferGeometry, slotIndex: number, slotCount: number): void {
  const grid = Math.round(Math.sqrt(slotCount))
  const col = slotIndex % grid
  const row = Math.floor(slotIndex / grid)
  const cell = 1 / grid
  const pad = cell * 0.04 // gutter to avoid bilinear bleed across slots

  const pos = geo.getAttribute('position')
  geo.computeBoundingBox()
  _box.copy(geo.boundingBox!)
  _box.getSize(_size)

  // Drop the thinnest axis; project onto the other two.
  const ax = _size.x, ay = _size.y, az = _size.z
  let u: Axis, v: Axis
  if (ax <= ay && ax <= az) { u = 'z'; v = 'y' }
  else if (ay <= ax && ay <= az) { u = 'x'; v = 'z' }
  else { u = 'x'; v = 'y' }

  const uMin = _box.min[u], uExt = _size[u] || 1
  const vMin = _box.min[v], vExt = _size[v] || 1

  const out = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i)
    const fu = (_p[u] - uMin) / uExt // 0..1 within the mesh
    const fv = (_p[v] - vMin) / vExt
    out[i * 2] = col * cell + (pad + fu * (1 - 2 * pad)) * cell
    out[i * 2 + 1] = row * cell + (pad + fv * (1 - 2 * pad)) * cell
  }
  geo.setAttribute('uv1', new BufferAttribute(out, 2))
}
