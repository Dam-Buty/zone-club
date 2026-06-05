import * as THREE from 'three'
import { positionWorld, normalWorld, clamp, vec3, varying, texture, attribute, float } from 'three/tsl'
import { shIrradiance, shSpecular } from '../../lib/lightbake/shReconstruct'
import { GRID_MIN, gridExt, G } from '../../lib/lightbake/probeGrid'
import { PROBE_PI, OBJ_SPEC, OBJ_GI } from './bakeDebugStore'
import { MOON_RAKE } from '../../lib/lightbake/bakeShellRuntime'
import { MOONLIGHT } from '../../lib/lightbake/emissiveRig'
import type { ProbeVolumes } from './ProbeVolumeContext'

const _mcol = new THREE.Color(MOONLIGHT.color)
const MOON_COL: [number, number, number] = [_mcol.r, _mcol.g, _mcol.b] // linear cold moon hue

type ProbeOpts = {
  scale?: number      // diffuse GI multiplier
  spec?: boolean      // add the baked "catch the neon" specular highlight (GLOSSY receivers only)
  sharp?: number      // specular lobe exponent (lower = broader/softer; semi-gloss ≈ 8, gloss ≈ 16)
  tone?: number       // Reinhard white-point roll-off on the DIFFUSE GI (0 = off). Caps bright albedo·E
                      // so a prop sitting in a hot neon zone reads as LIT, not a self-lit "lightbox"
                      // ("glow from inside" fix on the wall posters). Same curve as the K7 (?k7=).
  floorMoon?: number  // add the cold floor moon as a DIFFUSE fill (floor-level props sitting in a dim
                      // probe zone — e.g. the entrance mats — so they catch the same cold entrance light
                      // the floor cookie gives the floor, which the sparse probe volume misses there)
}

// Shared SH-L1 probe-receiver attach. In baked mode (`?baked=1`) the analytical rig is dropped, so any
// mesh WITHOUT an emissiveNode reads as a flat black/unlit blob. This walks an object tree and gives
// every mesh material the baked-GI emissive: emissive = albedo·E·PROBE_PI [+ specular] [+ floor moon].
//   • albedo = map × color (the REAL base albedo — never the raw map alone; a dark-tinted surface like
//     the doormat would otherwise wash out, see the counter fix).
//   • E = SH-L1 irradiance reconstructed at the surface (varying → vertex-stage eval).
//   • spec (opt) = shSpecular: the glossy surface CATCHES the dominant neon as a view-dependent highlight
//     so it reads as lit BY light, not self-glowing.
//   • floorMoon (opt) = albedo·MOON_COL·MOON_RAKE·k: the cold entrance light for floor-level mats.
// One E/spec node is shared across the tree (each material's shader evals positionWorld/normalWorld per-mesh).
export function attachProbeEmissive(root: THREE.Object3D | null, probes: ProbeVolumes, opts: ProbeOpts = {}): void {
  if (!root) return
  const { scale = 1, spec = false, sharp = 10, tone = 0, floorMoon = 0 } = opts
  const e = gridExt()
  const gMin = vec3(GRID_MIN[0], GRID_MIN[1], GRID_MIN[2])
  const gInv = vec3(1 / e[0], 1 / e[1], 1 / e[2])
  const half = vec3(0.5 / G[0], 0.5 / G[1], 0.5 / G[2])
  const uvw = clamp(positionWorld.sub(gMin).mul(gInv), half, vec3(1).sub(half))
  const E = varying(shIrradiance(probes.shR, probes.shG, probes.shB, uvw, normalWorld))
  const specNode = spec ? shSpecular(probes.shR, probes.shG, probes.shB, uvw, normalWorld, sharp) : null
  const apply = (m: THREE.Material) => {
    const sm = m as THREE.MeshStandardMaterial
    if (!sm.color) return // skip materials without a diffuse colour (e.g. MeshBasicMaterial decals)
    const tint = vec3(sm.color.r, sm.color.g, sm.color.b)
    let albedo = sm.map ? texture(sm.map).mul(tint) : tint
    // Vertex-coloured GLBs (e.g. the Pulp Fiction standee colours its art via the COLOR_0 attribute, NOT a
    // texture map) — without this the baked emissive used the flat baseColorFactor and lost the art (grey).
    if (sm.vertexColors) albedo = albedo.mul(attribute('color', 'vec4').xyz)
    let diff = (scale === 1 ? albedo.mul(E).mul(PROBE_PI) : albedo.mul(E).mul(PROBE_PI).mul(scale)).mul(OBJ_GI)
    // Reinhard white-point roll-off (x·W/(x+W) → asymptotes to W): caps the diffuse GI so a prop in a
    // hot neon zone can't blow past the bloom into a self-lit lightbox. Same mechanism as the K7 tone.
    if (tone > 0) diff = diff.mul(float(tone)).div(diff.add(float(tone)))
    let node = diff
    if (specNode) node = node.add(specNode.mul(OBJ_SPEC))
    if (floorMoon > 0) node = node.add(vec3(MOON_COL[0], MOON_COL[1], MOON_COL[2]).mul(MOON_RAKE).mul(floorMoon)) // direct cold add (NOT ×albedo → dark mats catch it, like the floor cookie's cold)
    const nm = m as unknown as { emissiveNode?: unknown; needsUpdate: boolean }
    nm.emissiveNode = node
    nm.needsUpdate = true
  }
  root.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh || !mesh.material) return
    if (Array.isArray(mesh.material)) mesh.material.forEach(apply)
    else apply(mesh.material)
  })
}
