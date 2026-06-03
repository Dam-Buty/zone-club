import * as THREE from 'three/webgpu'
import { texture, uv, vec3, uniform, float, mix, wgslFn, positionWorld, cameraPosition } from 'three/tsl'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { MeshBVH, SAH } from 'three-mesh-bvh'
import { collectShell } from './collectShell.ts'
import { ATLAS_SLOT_COUNT, applyShellUv1, applyShellUv1World, bakeName } from './shellUv1.ts'
import { emissiveRig } from './emissiveRig.ts'
import { radiosityBake, type MoonGobo } from './radiosityBake.ts'

// Live shell lightmap intensity (the ?lmi= knob). A uniform so the dev panel updates it without a
// re-bake. Module-level singleton — shared by the emissiveNode the bake attaches to every shell mat.
export const SHELL_LMI = uniform(1.4)

// Live intensity of the exterior moon rake — the cold light projected on the FLOOR by the per-fragment
// cookie. ADDED to the floor emissive (NOT ×albedo, so the near-black hex floor shows it). ?mrake= drives
// it live. Decoupled from ?moon (which is the probe/furniture intensity); the floor uses the cold HUE only.
export const MOON_RAKE = uniform(0.6)
// Warm-GI multiplier WHERE the rake lands (coverage g). The bright pink neon GI drowns the cold, so we dim
// it by g → the cold reads by contrast (gaps g=1 → gi×MOON_DAMP, posters g=0.3 → barely dimmed). ?mdamp=.
export const MOON_DAMP = uniform(0.45)
// Specular glint intensity of the FLOOR rake — the glossy floor (roughness 0.38) mirroring the bright
// vitrine toward the eye. View-dependent; this is the cue that reads as actual LIGHT on the floor (a wet
// floor catching the window) rather than a flat colour film. ?mspec= drives it live. 0 = diffuse-only.
export const MOON_SPEC = uniform(1.5)

function setVec3(geo: THREE.BufferGeometry, name: string, rgb: [number, number, number]) {
  const n = geo.attributes.position.count
  const a = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { a[i * 3] = rgb[0]; a[i * 3 + 1] = rgb[1]; a[i * 3 + 2] = rgb[2] }
  geo.setAttribute(name, new THREE.BufferAttribute(a, 3))
}
function reindex(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const c = geo.attributes.position.count
  const idx = new Uint32Array(c)
  for (let i = 0; i < c; i++) idx[i] = i
  geo.setIndex(new THREE.BufferAttribute(idx, 1))
  return geo
}
// uv1 for non-lightmapped BVH occluders (e.g. the vitrine posters added so the exterior moonbeam is
// masked by them): point every vertex at an UNUSED atlas slot (bottom row of the 3×3 = never written =
// black), so an indirect bounce that happens to hit an occluder reads ~0 reflected radiance instead of
// a wrong chart. They are shadow-casters only — they must not inject light.
function setUnusedUv1(geo: THREE.BufferGeometry) {
  const n = geo.attributes.position.count
  const a = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) { a[i * 2] = 0.5; a[i * 2 + 1] = 0.83 } // slot 7 (col1,row2), unused/black
  geo.setAttribute('uv1', new THREE.BufferAttribute(a, 2))
}

export interface RuntimeBakeOptions {
  albedo?: number // shell diffuse used in the gather (lightMap ≈ irradiance·albedo); runtime then ×texture
  resolution?: number
  samples?: number
  neeSamples?: number
  bounces?: number
  blur?: number
  clampDirect?: number // max luminance per NEE sample (firefly clamp); 0 disables
  neonBoost?: number // ?neon= — scales the coloured genre signs in the bake
  fluoBoost?: number // ?fluo= — scales the white ceiling fluo in the bake
  intensity?: number // lightMapIntensity attached to the materials
  sky?: [number, number, number]
}

/**
 * Bake the néon-noir GI lightmap of the LIVE shell on the MAIN renderer and attach it to the 6
 * shell surfaces (`material.lightMap`, uv1 channel). Returns the lightmap.
 *
 * - Must run on the renderer that DRAWS the scene: WebGPU textures are device-bound, so a
 *   lightmap baked on a separate renderer is unusable on the main one.
 * - Caller MUST pause the R3F frameloop around this call — `radiosityBake` ping-pongs offscreen
 *   render targets and a stray main-scene render into them would corrupt the bake.
 * - uv1 consistency: the bake geometry is the live geometry pushed to WORLD space, and the live
 *   mesh's uv1 is computed in the SAME world frame (`applyShellUv1World`), so the atlas maps back
 *   exactly (no floor V-flip — see shellUv1).
 */
export interface ShellBakeResult {
  lightmap: THREE.Texture
  /** The world-space shell geometry (with uv1) + its BVH — reused by the Phase-2 probe bake. */
  bvhGeo: THREE.BufferGeometry
  bvh: MeshBVH
  lightmapRes: number
}

export async function bakeAndAttachShell(
  renderer: THREE.WebGPURenderer,
  root: THREE.Object3D,
  opts: RuntimeBakeOptions = {},
  moon: MoonGobo | null = null,
): Promise<ShellBakeResult> {
  const {
    albedo = 0.7, resolution = 1024, samples = 96, neeSamples = 8, bounces = 2, blur = 3,
    clampDirect = 100, neonBoost = 1.5, fluoBoost = 5.0, intensity = 1.4,
    sky = [0.008, 0.012, 0.025] as [number, number, number],
  } = opts
  const { lightmapped, occluders } = collectShell(root)
  const ALB: [number, number, number] = [albedo, albedo, albedo]

  // World-space bake geometry per slot + the matching uv1 written on the LIVE mesh.
  const worldSurfaces = lightmapped.map((mesh, slot) => {
    mesh.updateWorldMatrix(true, false)
    // (a) bake geometry: live geo cloned into WORLD space, with the attributes the gather expects.
    const w = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
    const ng = w.index ? w.toNonIndexed() : w
    if (ng !== w) w.dispose()
    setVec3(ng, 'color', ALB)
    setVec3(ng, 'emission', [0, 0, 0])
    applyShellUv1(ng, slot, ATLAS_SLOT_COUNT) // ng positions are already world → identity projection
    // (b) live mesh uv1: the SAME world projection, written in the live geo's own vertex order.
    applyShellUv1World(mesh.geometry, mesh.matrixWorld, slot, ATLAS_SLOT_COUNT)
    return ng
  })

  // BVH-only occluders flagged userData.bakeOccluder (the vitrine posters): their world geometry joins
  // the shadow-ray BVH so the exterior moonbeam is masked by them — light reaches the floor only through
  // the glass gaps. NOT in `render` (not lightmapped). Synthesized to the same attribute set as the
  // lightmapped surfaces (position/normal/uv/uv1/color/emission) so mergeGeometries + the gather's
  // storage reads stay valid; emission=0 (don't emit), uv1→unused slot (don't reflect).
  const occluderSurfaces = occluders
    .filter((m) => (m as THREE.Mesh).userData?.bakeOccluder)
    .map((mesh) => {
      mesh.updateWorldMatrix(true, false)
      const w = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
      const ng = w.index ? w.toNonIndexed() : w
      if (ng !== w) w.dispose()
      setVec3(ng, 'color', ALB)
      setVec3(ng, 'emission', [0, 0, 0])
      setUnusedUv1(ng)
      return ng
    })

  const render = reindex(mergeGeometries(worldSurfaces.map((g) => g.clone()), false)!)
  // bvhGeo = lightmapped + occluders. mergeGeometries returns null on an attribute mismatch (it logs);
  // fall back to lightmapped-only so a mismatch degrades to "no poster occlusion", never a black bake.
  const mergedBvh = mergeGeometries([...worldSurfaces, ...occluderSurfaces].map((g) => g.clone()), false)
  if (!mergedBvh && occluderSurfaces.length) console.warn('[baked] occluder attrs mismatch → baked without poster occlusion')
  const bvhGeo = reindex(mergedBvh ?? mergeGeometries(worldSurfaces.map((g) => g.clone()), false)!)
  const bvh = new MeshBVH(bvhGeo, { maxLeafSize: 1, strategy: SAH })
  worldSurfaces.forEach((g) => g.dispose())
  occluderSurfaces.forEach((g) => g.dispose())

  // (Removed: the interior-occluder BVH that fed a baked moon shadow ray. The exterior rake is now a
  // per-fragment FLOOR cookie — the window mask carves the pattern directly, no interior-shadow BVH needed.
  // `occluders` stays referenced by the probe dead-probe AABB pass below.)

  // GI bake ONLY — the moon is NO LONGER baked into the shared atlas (that washed all surfaces at low res).
  // moon=null skips radiosityBake's atlas moon pass. The exterior rake is now a SHARP per-fragment COOKIE on
  // the FLOOR ONLY (below); furniture gets the SH probe rim (probeBakeRaw, moon passed there).
  const { lightmap } = await radiosityBake(renderer, render, bvhGeo, bvh, emissiveRig({ neon: neonBoost, fluo: fluoBoost }), {
    resolution, samples, neeSamples, bounces, sky, blur, clampDirect, grayscale: false,
  }, null)

  // FLOOR COOKIE (SOTA projected gobo, per-fragment): each floor fragment marches its worldPos along -L to
  // the storefront window plane and samples the HIGH-RES glass mask → g (gaps=1, posters=maskFloor). Sharp
  // at screen resolution (not the ~38px/m atlas) → crisp découpe. FLOOR ONLY (this node is on the floor
  // material) → no wall wash. The cold is ADDED (not ×albedo, so the near-black hex floor shows it) and the
  // warm GI is dimmed where the rake lands (MOON_DAMP) so it reads. Static/deterministic projection.
  let floorCookie: ReturnType<typeof wgslFn> | null = null
  let maskNode: ReturnType<typeof texture> | null = null
  let coldCol: [number, number, number] = [0, 0, 0]
  let moonLw: [number, number, number] = [0, 1, 0] // unit dir FROM floor TOWARD the window source (−L)
  let moonZWall = 0 // vitrine plane Z (falloff origin)
  if (moon && moon.maskTex && moon.maskTex.image) {
    const F = (x: number) => { const s = String(x); return /[.e]/.test(s) ? s : s + '.0' }
    const mw = (moon.maskTex.image as { width: number }).width
    const mh = (moon.maskTex.image as { height: number }).height
    const hasDoor = moon.doorRect && moon.doorMaskSub ? 1 : 0
    const dR = moon.doorRect ?? [0, 0, 1, 1], dS = moon.doorMaskSub ?? [0, 0, 1, 1]
    const mf = moon.maskFloor ?? 0
    // Cold HUE only (moon.rad carries the ×28 probe intensity; the floor's brightness is MOON_RAKE). Floor
    // cosP = dot((0,1,0), -moonDir) ≈ 0.55 (constant) folded into the hue.
    const radMax = Math.max(moon.rad[0], moon.rad[1], moon.rad[2]) || 1
    const cosP = 0.5487
    const sat = 0.55 // desaturate the cold toward cool-WHITE → realistic moonlight, not neon-blue
    coldCol = ([0, 1, 2] as const).map((i) => (1 - sat + (moon.rad[i] / radMax) * sat) * cosP) as unknown as [number, number, number]
    const _ml = Math.hypot(moon.dir[0], moon.dir[1], moon.dir[2]) || 1
    moonLw = [-moon.dir[0] / _ml, -moon.dir[1] / _ml, -moon.dir[2] / _ml] // toward the window source
    moonZWall = moon.zWall
    floorCookie = wgslFn(/* wgsl */`
      fn floorCookie(P: vec3f, maskTex: texture_2d<f32>) -> f32 {
        let moonDir = vec3f(${F(moon.dir[0])}, ${F(moon.dir[1])}, ${F(moon.dir[2])});
        let zWall = ${F(moon.zWall)};
        let vwx=${F(moon.winRect[0])}; let vwy=${F(moon.winRect[1])}; let vww=${F(moon.winRect[2])}; let vwh=${F(moon.winRect[3])};
        let vsx=${F(moon.maskSub[0])}; let vsy=${F(moon.maskSub[1])}; let vssx=${F(moon.maskSub[2])}; let vssy=${F(moon.maskSub[3])};
        let dwx=${F(dR[0])}; let dwy=${F(dR[1])}; let dww=${F(dR[2])}; let dwh=${F(dR[3])};
        let dsx=${F(dS[0])}; let dsy=${F(dS[1])}; let dssx=${F(dS[2])}; let dssy=${F(dS[3])};
        let mw=${F(mw)}; let mh=${F(mh)}; let hasDoor=${F(hasDoor)}; let maskFloor=${F(mf)};
        let denom = -moonDir.z;
        if (denom <= 0.001) { return 0.0; }
        let t = (zWall - P.z) / denom;
        if (t <= 0.0) { return 0.0; }
        let Pw = P - moonDir * t;
        var g = 0.0; var hit = 0.0;
        let un = (Pw.x - vwx)/vww; let vn = (Pw.y - vwy)/vwh;
        if (un>=0.0 && un<=1.0 && vn>=0.0 && vn<=1.0) {
          hit = 1.0;
          let um = vsx + (1.0-un)*vssx; let vm = vsy + (1.0-vn)*vssy;
          g = textureLoad(maskTex, vec2i(i32(um*mw), i32(vm*mh)), 0).g;
        } else if (hasDoor > 0.5) {
          let dun=(Pw.x-dwx)/dww; let dvn=(Pw.y-dwy)/dwh;
          if (dun>=0.0 && dun<=1.0 && dvn>=0.0 && dvn<=1.0) {
            hit = 1.0;
            let dum=dsx+(1.0-dun)*dssx; let dvm=dsy+(1.0-dvn)*dssy;
            g = textureLoad(maskTex, vec2i(i32(dum*mw), i32(dvm*mh)), 0).g;
          }
        }
        if (hit > 0.5) { g = mix(g, 1.0, maskFloor); }
        return g;
      }`)
    maskNode = texture(moon.maskTex)
  }

  SHELL_LMI.value = intensity
  const lmSample = texture(lightmap, uv(1))
  const FLOOR_NAME = bakeName('floor')
  for (const mesh of lightmapped) {
    const mat = mesh.material as THREE.MeshStandardNodeMaterial
    const base = mat.map ? texture(mat.map) : vec3(mat.color.r, mat.color.g, mat.color.b)
    const gi = base.mul(lmSample.rgb).mul(SHELL_LMI) // GI = albedo-modulated (keeps surface identity)
    if (mesh.name === FLOOR_NAME && floorCookie && maskNode) {
      const g = floorCookie({ P: positionWorld, maskTex: maskNode }) // sharp per-fragment coverage 0..1
      // patch = the whole window projection (glass gaps AND poster shadows), 0 on the wall. Inside it, KILL
      // the warm pink GI (it's an exterior-light zone) so the cookie's structure reads; the brightness then
      // = g (gaps bright, posters DIM = real shadows). Outside (wall) → untouched pink GI. The découpe is the
      // sharp wall↔patch boundary; the poster shadows are the dim spots inside.
      const patch = g.mul(5).clamp(0, 1)
      const coldHue = vec3(coldCol[0], coldCol[1], coldCol[2])
      // Falloff from the vitrine plane → the pool is brightest at the glass and fades into the room (real
      // window light loses intensity with throw), clamped so the far edge keeps some light.
      const falloff = float(1).sub(float(moonZWall).sub(positionWorld.z).max(0).mul(0.13)).clamp(0.4, 1)
      // DIFFUSE cold = cold light × the floor ALBEDO (base) → the hex pattern reads LIT by the moon — a lit
      // FLOOR, not a flat colour film laid on top (the "texture transparente" the user flagged). Brighter than
      // the surrounding warm GI = it actually looks illuminated.
      const coldDiffuse = base.mul(coldHue).mul(g).mul(MOON_RAKE).mul(falloff)
      // SPECULAR glint = the glossy floor mirroring the bright vitrine toward the eye. Reflect the view ray
      // about the floor up-normal; peak where it aligns with the window source dir (moonLw). View-dependent —
      // the cue that sells "wet floor catching light". Gated by g (only inside the lit pool).
      const Vd = positionWorld.sub(cameraPosition).normalize()
      const up = vec3(0, 1, 0)
      const refl = Vd.sub(up.mul(Vd.dot(up).mul(2)))
      const coldSpec = coldHue.mul(refl.dot(vec3(moonLw[0], moonLw[1], moonLw[2])).max(0).pow(10)).mul(g).mul(MOON_SPEC)
      mat.emissiveNode = gi.mul(mix(float(1), MOON_DAMP, patch)).add(coldDiffuse).add(coldSpec)
    } else {
      mat.emissiveNode = gi // walls/ceiling: GI only — NO moon (the rake never touches the walls now)
    }
    mat.lightMap = lightmap // kept for reference; the emissiveNode above is what actually renders
    mat.lightMap.channel = 1
    mat.needsUpdate = true
  }
  return { lightmap, bvhGeo, bvh, lightmapRes: resolution }
}
