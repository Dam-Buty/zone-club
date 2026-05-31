import * as THREE from 'three/webgpu'
import { texture, uv, vec3, uniform } from 'three/tsl'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { MeshBVH, SAH } from 'three-mesh-bvh'
import { collectShell } from './collectShell.ts'
import { ATLAS_SLOT_COUNT, applyShellUv1, applyShellUv1World } from './shellUv1.ts'
import { emissiveRig } from './emissiveRig.ts'
import { radiosityBake } from './radiosityBake.ts'

// Live shell lightmap intensity (the ?lmi= knob). A uniform so the dev panel updates it without a
// re-bake. Module-level singleton — shared by the emissiveNode the bake attaches to every shell mat.
export const SHELL_LMI = uniform(1.4)

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
): Promise<ShellBakeResult> {
  const {
    albedo = 0.7, resolution = 1024, samples = 96, neeSamples = 8, bounces = 2, blur = 3,
    clampDirect = 100, neonBoost = 1.5, fluoBoost = 5.0, intensity = 1.4,
    sky = [0.008, 0.012, 0.025] as [number, number, number],
  } = opts
  const { lightmapped } = collectShell(root)
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

  const render = reindex(mergeGeometries(worldSurfaces.map((g) => g.clone()), false)!)
  const bvhGeo = reindex(mergeGeometries(worldSurfaces.map((g) => g.clone()), false)!)
  const bvh = new MeshBVH(bvhGeo, { maxLeafSize: 1, strategy: SAH })
  worldSurfaces.forEach((g) => g.dispose())

  const lightmap = await radiosityBake(renderer, render, bvhGeo, bvh, emissiveRig({ neon: neonBoost, fluo: fluoBoost }), {
    resolution, samples, neeSamples, bounces, sky, blur, clampDirect, grayscale: false,
  })

  // Apply the baked atlas via an EXPLICIT emissiveNode sampled at uv1 — NOT material.lightMap. In
  // the WebGPU MeshStandardMaterial, a lightMap attached AFTER the material's first compile is
  // ignored (setupLightMap ran once without it; needsUpdate + channel=1 don't re-add it — confirmed
  // empirically + the May-2026 three forum issue). The K7 already prove the emissiveNode path works.
  // We modulate the atlas by each surface's OWN albedo (map if present, else colour) so the walls/
  // floor/ceiling keep their identity under the GI, and scale by the live SHELL_LMI uniform.
  SHELL_LMI.value = intensity
  const lmSample = texture(lightmap, uv(1))
  for (const mesh of lightmapped) {
    const mat = mesh.material as THREE.MeshStandardNodeMaterial
    const base = mat.map ? texture(mat.map) : vec3(mat.color.r, mat.color.g, mat.color.b)
    mat.emissiveNode = base.mul(lmSample.rgb).mul(SHELL_LMI)
    mat.lightMap = lightmap // kept for reference; the emissiveNode above is what actually renders
    mat.lightMap.channel = 1
    mat.needsUpdate = true
  }
  return { lightmap, bvhGeo, bvh, lightmapRes: resolution }
}
