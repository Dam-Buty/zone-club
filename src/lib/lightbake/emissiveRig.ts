import { PlaneGeometry, Color, Matrix4, Vector3, type BufferGeometry } from 'three'

// The néon-noir emitter rig as offline emissive proxy quads (world-space geometry + linear
// HDR emission). At bake, rays that hit these read their `emission` → coloured indirect
// light. Mirrors the REAL scene emitters (src/components/interior): the dim cold ceiling
// fluo set the nocturnal ambient, the vivid genre-neon signs are the néon-noir accents
// (magenta/cyan/green bleed on floor + walls), plus the cold vitrine moonlight.

type Face = 'z+' | 'z-' | 'x+' | 'x-' | 'y-' | 'y+'

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

// Cold ceiling fluo — DIM (nocturnal ambient, lets the neon accents dominate). Big white area
// emitters: even at low intensity they deliver more lumens to floor/walls than the small neon
// signs, so they must stay well below the signs or they grey-wash the néon-noir.
// Down-facing fluo strips — the primary room light (far-field onto the floor 2.7 m below → low
// variance, no subdivision needed).
const CEILING_FLUO_DOWN: EmitterSpec[] = [
  { name: 'fluo-0', pos: [-3.3, 2.72, 0], size: [0.45, 6.6], face: 'y-', color: '#eaf0ff', intensity: 0.5 },
  { name: 'fluo-1', pos: [-1.0, 2.72, 0], size: [0.45, 6.6], face: 'y-', color: '#eaf0ff', intensity: 0.35 },
  { name: 'fluo-2', pos: [2.3, 2.72, 0], size: [0.45, 6.6], face: 'y-', color: '#eaf0ff', intensity: 0.35 },
  { name: 'fluo-3', pos: [3.8, 2.72, 0], size: [0.45, 6.6], face: 'y-', color: '#eaf0ff', intensity: 0.5 },
]

// Up-facing ceiling wash — a surface tube emits both ways. Hung 0.25 m below the 2.8 m ceiling
// (not flush): at 0.04 m the near-field area/dist² term exploded into ceiling fireflies. But a
// single 6.6 m strip THAT close to the ceiling still has huge per-texel variance under uniform
// area sampling (most samples land far from a given texel) → the bake comes out cloudy/marbled.
// FIX = stratify: subdivide each tube into UP_SEGMENTS short quads. Same area, same radiance, same
// total power — but each segment is near-square under the texels it lights, so its uniform samples
// are ~equidistant → low variance. This is stratified light sampling, the principled cure for a
// long near-field strip (vs brute-forcing neeSamples on the whole strip).
const CEILING_UP_TUBES = [
  { x: -3.3, intensity: 0.4 }, { x: -1.0, intensity: 0.3 }, { x: 2.3, intensity: 0.3 }, { x: 3.8, intensity: 0.4 },
]
const UP_SEGMENTS = 16 // 8 laissait encore des taches de variance near-field sur le plafond à 256 spp (10/06)
const SEG_LEN = 6.6 / UP_SEGMENTS
const CEILING_FLUO_UP: EmitterSpec[] = CEILING_UP_TUBES.flatMap((t, ti) =>
  Array.from({ length: UP_SEGMENTS }, (_, i) => ({
    name: `fluo-${ti}-up-${i}`,
    pos: [t.x, 2.55, -3.3 + SEG_LEN * (i + 0.5)] as [number, number, number],
    size: [0.45, SEG_LEN] as [number, number],
    face: 'y+' as Face,
    color: '#eaf0ff',
    intensity: t.intensity,
  })),
)

const CEILING_FLUO: EmitterSpec[] = [...CEILING_FLUO_DOWN, ...CEILING_FLUO_UP]

const OTHER: EmitterSpec[] = [
  // 2 island overhead tubes (cool).
  { name: 'island-tube-0', pos: [-2.2, 2.66, -0.2], size: [0.5, 3.8], face: 'y-', color: '#eaf0ff', intensity: 0.45 },
  { name: 'island-tube-1', pos: [0.05, 2.66, -0.2], size: [0.5, 3.8], face: 'y-', color: '#eaf0ff', intensity: 0.45 },
  // Warm counter tube.
  { name: 'comptoir', pos: [3, 2.66, 3], size: [0.4, 1.8], face: 'y-', color: '#ffd29a', intensity: 3.2 }, // 5.0 saturait le coin en orange monochrome + cramait les props blancs (A/B 10/06)
  // Cold vitrine street-glow (south wall, into the room). ⚠️ NE PAS remonter jusqu'au plafond :
  // l'ancien quad plein-hauteur (size 2.8, top à y=2.8) touchait le plafond → near-field → moutonnement
  // bleu figé sur les dalles devant la vitrine. Physiquement la lumière de rue/lune entre par le HAUT
  // vers le BAS — le plafond au-dessus de la fenêtre reste sombre. Top à 1.8 m (A/B 10/06).
  { name: 'vitrine', pos: [0.5, 1.15, 4.1], size: [6.5, 1.3], face: 'z-', color: '#5577aa', intensity: 5.0 },
  // CRT phosphor glow (warm-white screen, faces into room).
  { name: 'crt', pos: [3.9, 1.8, 4.1], size: [0.5, 0.38], face: 'z-', color: '#bfe0ff', intensity: 2.2 },
]

// Multiplicateurs sur l'intensité BAKÉE — défauts (1.0 = origine de chaque émetteur). Les deux
// leviers de composition, réglables en live via ?neon= (enseignes de genre colorées, pousse la GI
// colorée sur sol/étagères/K7) et ?fluo= (néon blanc plafond). Purement baké, zéro lumière dynamique.
const DEFAULT_NEON_BOOST = 1.5
const DEFAULT_FLUO_BOOST = 5.0

export interface EmissiveProxy {
  name: string
  /** World-space quad geometry (positioned/oriented just into the room). */
  geometry: BufferGeometry
  /** Linear HDR radiance (sRGB colour × intensity). */
  emission: [number, number, number]
  /** World rectangle (corner + 2 edges) for NEE direct light sampling. */
  rect: EmitterRect
}

/** World-space rectangle: a sampled point is `corner + u·edge1 + v·edge2`, u,v ∈ [0,1]. */
export interface EmitterRect {
  corner: [number, number, number]
  edge1: [number, number, number]
  edge2: [number, number, number]
  /** Unit room-facing normal. NEE emits ONE-sided along it (no backward leak onto the
   *  wall/ceiling the sign is mounted on). Authoritative — resolves cross(edge1,edge2)'s
   *  winding ambiguity (the ceiling case flips it). */
  facing: [number, number, number]
}

const _c = new Color()
const EPS = 0.03 // nudge into the room so the surface doesn't self-occlude the proxy

// Room-facing unit normal per wall — the direction the emitter actually shines INTO the room.
const FACE_NORMAL: Record<Face, [number, number, number]> = {
  'z+': [0, 0, 1], // north wall → +Z
  'z-': [0, 0, -1], // south wall → -Z
  'x+': [1, 0, 0], // left wall → +X
  'x-': [-1, 0, 0], // right wall → -X
  'y-': [0, -1, 0], // ceiling → down
  'y+': [0, 1, 0], // up toward the ceiling (tube halo)
}

// Lever (b) — downward colour pools. Per genre sign, a small y- emitter pulled into the room over
// the aisle floor and tinted the sign's colour → it casts a FRANC coloured pool on the floor in
// front of that section. The wall signs shine HORIZONTALLY (y=2.24) and never reach the floor on
// their own — these are what put colour underfoot. Far-field (2.3 m above the floor) ⇒ low-variance,
// no subdivision. Scaled by ?neon= alongside the signs so one knob drives all the coloured GI.
const POOL_Y = 2.1 // lower → tighter, brighter pool
const POOL_OFFSET = 0.9 // metres into the room from the wall sign
const POOL_SIZE = 0.7 // smaller source → more concentrated spot (was 0.9)
const POOL_INTENSITY = 1.2 // subtle colour halo underfoot. 4.0 (pre shell-fix) flooded the floor magenta — it compensated for the never-rendering lightmap; 0 kills all colour underfoot (signs shine horizontally). 1.2 = réaliste (A/B 10/06)
const FLOOR_POOLS: EmitterSpec[] = GENRE_SIGNS.map((s) => {
  const n = FACE_NORMAL[s.face]
  return {
    name: `pool-${s.name}`,
    pos: [s.pos[0] + n[0] * POOL_OFFSET, POOL_Y, s.pos[2] + n[2] * POOL_OFFSET] as [number, number, number],
    size: [POOL_SIZE, POOL_SIZE] as [number, number],
    face: 'y-' as Face,
    color: s.color,
    intensity: POOL_INTENSITY,
  }
})

// Exterior "moonlight" = a baked DIRECTIONAL COOKIE/GOBO (Unity/Bakery idiom). A distant parallel light
// (direction L) whose per-lightmap-texel contribution is gated by the storefront GLASS mask projected
// orthographically along L onto the receiver (see radiosityBake `moonPass`). It is NOT an area emitter
// behind the glass (those get occluded by the posters and wash out) — the mask itself carves the window
// pattern, decoupled from geometry, with NO 1/dist² so it reads as a crisp rake against the pink neon GI.
// 100% baked: one constant vector + one static texture read at bake time. Tuned/calibrated via ?moon=,
// ?moonDebug=1 (dumps the projected mask), ?msub= (mask sub-rect). Consumed by radiosityBake + probeBake.
const _mdir = new Vector3(0.25, -0.55, -0.8).normalize()
export const MOONLIGHT = {
  dir: [_mdir.x, _mdir.y, _mdir.z] as [number, number, number], // travel dir: into room (z-), down (y-)
  color: '#6f88c4', // cold moonlight (sRGB)
  intensity: 14.0, // probe/furniture (desk, Rick) cold-rim intensity (×probeScale). Floor uses the HUE only.
  zWall: 4.25, // world Z of the south (storefront) wall plane (Storefront at [0,0,ROOM_DEPTH/2], depth 8.5)
  // World vitrine rect [xmin, ymin, width, height]: VITRINE_CENTER_X -0.8 local → +0.8 world after the
  // [0,π,0] storefront rotation; WIDTH 5.2, BOTTOM 0.5, HEIGHT 2.28 → X∈[-1.8,3.4], Y∈[0.5,2.78].
  winRect: [-1.8, 0.5, 5.2, 2.28] as [number, number, number, number],
  // Mask sub-rect [offX, offY, scaleX, scaleY] isolating the vitrine inside storefront-mask.png — the
  // window occupies only part of the facade photo. MEASURED by scanning the green (glass) channel of the
  // 2816×1536 mask: the right-hand vitrine box spans U[0.420,0.965] V[0.301,0.954]. The moonPass mirrors
  // U (interior is π-rotated vs the facade photo) and inverts V (PNG row0=top). Override live via ?msub=.
  maskSub: [0.42, 0.301, 0.545, 0.653] as [number, number, number, number],
  // SECOND aperture — the entrance DOOR. DOOR_CENTER_X 3.0 local → -3.0 world after the π rotation;
  // DOOR_WIDTH 1.0, full-height glass to DOOR_HEIGHT 2.3 → X∈[-3.5,-2.5], Y∈[0,2.3]. Same z=zWall plane.
  // Its green box in the mask (measured) is U[0.121,0.320] V[0.326,0.996].
  doorRect: [-3.5, 0.0, 1.0, 2.3] as [number, number, number, number],
  doorMaskSub: [0.121, 0.326, 0.199, 0.67] as [number, number, number, number],
  // Warm-GI attenuation WHERE the rake lands (contrast lever): cur *= mix(1, neonDamp, coverage). The
  // neon floor pools near the vitrine are dimmed only under the cold rake so the moonlight reads. ?mdamp=.
  neonDamp: 0.45,
  // Probe-side intensity multiplier (?mprobe=). The SH-L1 probe receivers (counter top, Rick, furniture)
  // read shIrradiance·albedo·PROBE_PI(0.7), which loses directional energy vs the floor lightmap's lmi(1.8),
  // so the cold RIM needs ~2.5× the floor rake's radiance to read against the warm neon GI. Decoupled: the
  // floor rake stays at `intensity` (28, mostly hidden behind the counter), the visible rim gets intensity×this.
  probeScale: 2.5,
  // Mask "openness" for the floor wash (?mfloor=). The open/visible floor projects onto the poster-DENSE
  // top of the vitrine → strict mask (0) leaves it dark. 0.5 lets ~half the light through the poster zones
  // too → a broad cold wash over the whole floor band (the posters still dim it, but don't zero it).
  maskFloor: 0.3,
}

// One transform per emitter (rotation by face + translation), the single source of truth
// for both the BVH geometry and the NEE rectangle. world = T · R (rotate then translate).
function emitterMatrix(face: Face, pos: [number, number, number]): Matrix4 {
  const m = new Matrix4()
  let [x, y, z] = pos
  switch (face) {
    case 'z+': m.makeRotationY(0); z += EPS; break // north wall, faces +Z
    case 'z-': m.makeRotationY(Math.PI); z -= EPS; break // south wall, faces -Z
    case 'x+': m.makeRotationY(Math.PI / 2); x += EPS; break // left wall, faces +X
    case 'x-': m.makeRotationY(-Math.PI / 2); x -= EPS; break // right wall, faces -X
    case 'y-': m.makeRotationX(-Math.PI / 2); y -= EPS; break // ceiling, faces down
    case 'y+': m.makeRotationX(Math.PI / 2); y += EPS; break // faces up — ceiling halo
  }
  m.setPosition(x, y, z)
  return m
}

const _bl = new Vector3(), _br = new Vector3(), _tl = new Vector3()

/** Build the offline emissive proxy quads + their world rectangles (for NEE). `neon` scales the
 *  coloured genre signs, `fluo` the white ceiling fluo — the two composition levers (?neon=/?fluo=).
 *  The island tubes / warm comptoir / cold vitrine / crt (OTHER) stay unscaled. */
export function emissiveRig(boosts: { neon?: number; fluo?: number } = {}): EmissiveProxy[] {
  const neon = boosts.neon ?? DEFAULT_NEON_BOOST
  const fluo = boosts.fluo ?? DEFAULT_FLUO_BOOST
  const ALL: EmitterSpec[] = [
    ...GENRE_SIGNS.map((s) => ({ ...s, intensity: s.intensity * neon })),
    ...FLOOR_POOLS.map((s) => ({ ...s, intensity: s.intensity * neon })),
    ...CEILING_FLUO.map((s) => ({ ...s, intensity: s.intensity * fluo })),
    ...OTHER,
  ]
  return ALL.map((e) => {
    const [w, h] = e.size
    const M = emitterMatrix(e.face, e.pos)
    const geometry = new PlaneGeometry(w, h).applyMatrix4(M)
    _c.set(e.color).convertSRGBToLinear()
    const emission: [number, number, number] = [_c.r * e.intensity, _c.g * e.intensity, _c.b * e.intensity]
    // World rectangle from the 4 local corners: bottom-left + 2 edge vectors.
    _bl.set(-w / 2, -h / 2, 0).applyMatrix4(M)
    _br.set(w / 2, -h / 2, 0).applyMatrix4(M)
    _tl.set(-w / 2, h / 2, 0).applyMatrix4(M)
    const rect: EmitterRect = {
      corner: [_bl.x, _bl.y, _bl.z],
      edge1: [_br.x - _bl.x, _br.y - _bl.y, _br.z - _bl.z],
      edge2: [_tl.x - _bl.x, _tl.y - _bl.y, _tl.z - _bl.z],
      facing: FACE_NORMAL[e.face],
    }
    return { name: e.name, geometry, emission, rect }
  })
}

export const EMISSIVE_RIG_COUNT = GENRE_SIGNS.length + FLOOR_POOLS.length + CEILING_FLUO.length + OTHER.length
