import { PlaneGeometry, Color, type BufferGeometry } from 'three'

// The néon-noir emitter rig as offline emissive proxy quads (world-space geometry + linear
// HDR emission). At bake, rays that hit these read their `emission` → coloured indirect
// light. Mirrors the REAL scene emitters (src/components/interior): the dim cold ceiling
// fluo set the nocturnal ambient, the vivid genre-neon signs are the néon-noir accents
// (magenta/cyan/green bleed on floor + walls), plus the cold vitrine moonlight.

type Face = 'z+' | 'z-' | 'x+' | 'x-' | 'y-'

interface EmitterSpec {
  name: string
  pos: [number, number, number]
  size: [number, number] // along-wall width, height
  face: Face
  color: string // sRGB hex
  intensity: number // linear radiance multiplier (tuned for the bake, not the realtime mat)
}

// Genre-neon signs — the colour accents (positions/colours from Aisle.tsx GENRE_CONFIG).
const GENRE_SIGNS: EmitterSpec[] = [
  { name: 'horreur', pos: [-4.38, 2.24, -3.56], size: [1.22, 0.30], face: 'x+', color: '#00ff00', intensity: 5.0 },
  { name: 'bizarre', pos: [-4.38, 2.24, -0.84], size: [1.42, 0.36], face: 'x+', color: '#ff00ff', intensity: 4.5 },
  { name: 'polar', pos: [-4.38, 2.24, 0.42], size: [1.12, 0.28], face: 'x+', color: '#4fc3f7', intensity: 4.5 },
  { name: 'thriller', pos: [-4.38, 2.24, 1.35], size: [1.01, 0.25], face: 'x+', color: '#ff6600', intensity: 4.5 },
  { name: 'action', pos: [-2.25, 2.24, -4.18], size: [1.22, 0.30], face: 'z+', color: '#ff4444', intensity: 5.0 },
  { name: 'aventure', pos: [-0.6, 2.24, -4.18], size: [1.22, 0.30], face: 'z+', color: '#ff9f1c', intensity: 4.5 },
  { name: 'animation', pos: [0.6, 2.24, -4.18], size: [1.01, 0.25], face: 'z+', color: '#ff8800', intensity: 4.5 },
  { name: 'drame', pos: [1.9, 2.24, -4.18], size: [1.01, 0.25], face: 'z+', color: '#8844ff', intensity: 5.0 },
  { name: 'comedie', pos: [3.92, 2.24, -2.65], size: [1.22, 0.30], face: 'x-', color: '#ffff00', intensity: 4.0 },
  { name: 'romance', pos: [3.92, 2.24, -0.35], size: [1.22, 0.30], face: 'x-', color: '#ff5c8a', intensity: 4.5 },
  // Island sign faces (Nouveautés magenta, SF cyan, Classiques gold) — vertical on island flanks.
  { name: 'nouveautes', pos: [-2.2, 2.24, -0.2], size: [1.44, 0.36], face: 'x+', color: '#ff00ff', intensity: 4.0 },
  { name: 'sf', pos: [0.05, 2.24, -0.2], size: [1.44, 0.36], face: 'x-', color: '#00ccff', intensity: 4.5 },
]

// Cold ceiling fluo — DIM (nocturnal ambient, lets the neon accents dominate).
const CEILING_FLUO: EmitterSpec[] = [
  { name: 'fluo-0', pos: [-3.3, 2.72, 0], size: [0.45, 6.6], face: 'y-', color: '#eaf0ff', intensity: 1.6 },
  { name: 'fluo-1', pos: [-1.0, 2.72, 0], size: [0.45, 6.6], face: 'y-', color: '#eaf0ff', intensity: 1.1 },
  { name: 'fluo-2', pos: [2.3, 2.72, 0], size: [0.45, 6.6], face: 'y-', color: '#eaf0ff', intensity: 1.1 },
  { name: 'fluo-3', pos: [3.8, 2.72, 0], size: [0.45, 6.6], face: 'y-', color: '#eaf0ff', intensity: 1.6 },
]

const OTHER: EmitterSpec[] = [
  // 2 island overhead tubes (cool).
  { name: 'island-tube-0', pos: [-2.2, 2.66, -0.2], size: [0.5, 3.8], face: 'y-', color: '#eaf0ff', intensity: 1.3 },
  { name: 'island-tube-1', pos: [0.05, 2.66, -0.2], size: [0.5, 3.8], face: 'y-', color: '#eaf0ff', intensity: 1.3 },
  // Warm counter tube.
  { name: 'comptoir', pos: [3, 2.66, 3], size: [0.14, 1.4], face: 'y-', color: '#ffe2b0', intensity: 3.0 },
  // Cold vitrine moonlight (south wall, into the room).
  { name: 'vitrine', pos: [0.5, 1.4, 4.1], size: [5.0, 2.2], face: 'z-', color: '#5577aa', intensity: 1.4 },
  // CRT phosphor glow (warm-white screen, faces into room).
  { name: 'crt', pos: [3.9, 1.8, 4.1], size: [0.5, 0.38], face: 'z-', color: '#bfe0ff', intensity: 2.2 },
]

const ALL: EmitterSpec[] = [...GENRE_SIGNS, ...CEILING_FLUO, ...OTHER]

export interface EmissiveProxy {
  name: string
  /** World-space quad geometry (positioned/oriented just into the room). */
  geometry: BufferGeometry
  /** Linear HDR radiance (sRGB colour × intensity). */
  emission: [number, number, number]
}

const _c = new Color()
const EPS = 0.03 // nudge into the room so the surface doesn't self-occlude the proxy

function orient(geo: PlaneGeometry, face: Face, pos: [number, number, number]) {
  let [x, y, z] = pos
  switch (face) {
    case 'z+': z += EPS; break // north wall, faces +Z (no rotation)
    case 'z-': geo.rotateY(Math.PI); z -= EPS; break // south wall, faces -Z
    case 'x+': geo.rotateY(Math.PI / 2); x += EPS; break // left wall, faces +X
    case 'x-': geo.rotateY(-Math.PI / 2); x -= EPS; break // right wall, faces -X
    case 'y-': geo.rotateX(-Math.PI / 2); y -= EPS; break // ceiling, faces down
  }
  geo.translate(x, y, z)
}

/** Build the offline emissive proxy quads for the full néon-noir rig. */
export function emissiveRig(): EmissiveProxy[] {
  return ALL.map((e) => {
    const geometry = new PlaneGeometry(e.size[0], e.size[1])
    orient(geometry, e.face, e.pos)
    _c.set(e.color).convertSRGBToLinear()
    return { name: e.name, geometry, emission: [_c.r * e.intensity, _c.g * e.intensity, _c.b * e.intensity] }
  })
}

export const EMISSIVE_RIG_COUNT = ALL.length
