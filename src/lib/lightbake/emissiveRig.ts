import { PlaneGeometry, Color, type BufferGeometry } from 'three'

// The néon-noir emitter rig, mirrored from Lighting.tsx as offline emissive proxy quads.
// At bake, rays that hit these read their `emission` → coloured indirect light. v1 covers
// the dominant emitters; wall washes / fills / the 16 neon tubes / moonlight term are added
// & tuned in Task 8 against the néon-noir target. Intensities are starting points.
interface EmitterSpec {
  name: string
  pos: [number, number, number]
  rot: [number, number, number] // euler radians (applied X→Y→Z)
  size: [number, number] // width, height of the quad
  color: string // sRGB hex (converted to linear at build)
  intensity: number
}

const EMITTERS: EmitterSpec[] = [
  // 4 ceiling fluo tubes (cold white), long along Z, facing down.
  { name: 'ceil-0', pos: [-3.3, 2.7, 0], rot: [-Math.PI / 2, 0, 0], size: [0.4, 7.0], color: '#f0f5ff', intensity: 4.0 },
  { name: 'ceil-1', pos: [-1.0, 2.7, 0], rot: [-Math.PI / 2, 0, 0], size: [0.4, 7.0], color: '#f0f5ff', intensity: 2.5 },
  { name: 'ceil-2', pos: [2.3, 2.7, 0], rot: [-Math.PI / 2, 0, 0], size: [0.4, 7.0], color: '#f0f5ff', intensity: 2.5 },
  { name: 'ceil-3', pos: [3.8, 2.7, 0], rot: [-Math.PI / 2, 0, 0], size: [0.4, 7.0], color: '#f0f5ff', intensity: 4.0 },
  // 2 island overhead tubes.
  { name: 'island-0', pos: [-2.2, 2.68, -0.2], rot: [-Math.PI / 2, 0, 0], size: [0.6, 4.0], color: '#f0f5ff', intensity: 1.8 },
  { name: 'island-1', pos: [0.05, 2.68, -0.2], rot: [-Math.PI / 2, 0, 0], size: [0.6, 4.0], color: '#f0f5ff', intensity: 1.8 },
  // Warm comptoir tube.
  { name: 'comptoir', pos: [3, 2.68, 3], rot: [-Math.PI / 2, 0, 0], size: [0.12, 1.4], color: '#fff5e6', intensity: 3.0 },
  // Cold vitrine light (moonlight through the storefront), facing into the room.
  { name: 'vitrine', pos: [0.5, 1.4, 4.15], rot: [0, Math.PI, 0], size: [5.0, 2.2], color: '#5577aa', intensity: 1.2 },
]

export interface EmissiveProxy {
  name: string
  /** World-space quad geometry (positioned/oriented). */
  geometry: BufferGeometry
  /** Linear HDR radiance (sRGB colour × intensity). */
  emission: [number, number, number]
}

const _c = new Color()

/** Build the offline emissive proxy quads for the néon-noir rig. */
export function emissiveRig(): EmissiveProxy[] {
  return EMITTERS.map((e) => {
    const geometry = new PlaneGeometry(e.size[0], e.size[1])
    geometry.rotateX(e.rot[0])
    geometry.rotateY(e.rot[1])
    geometry.rotateZ(e.rot[2])
    geometry.translate(e.pos[0], e.pos[1], e.pos[2])
    _c.set(e.color).convertSRGBToLinear()
    return { name: e.name, geometry, emission: [_c.r * e.intensity, _c.g * e.intensity, _c.b * e.intensity] }
  })
}

export const EMISSIVE_RIG_COUNT = EMITTERS.length
