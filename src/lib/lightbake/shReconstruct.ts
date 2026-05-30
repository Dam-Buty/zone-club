import * as THREE from 'three/webgpu'
import { texture3D, vec3, dot, max, float } from 'three/tsl'
import { G, SH_RUNTIME_C0, SH_RUNTIME_C1 } from './probeGrid.ts'

// TSL nodes are typed `any` in src/types/three-webgpu.d.ts (the lib ships no usable node type).
type Node = any

/**
 * Create one colour channel's SH-L1 volume from packed half-float RGBA data.
 *
 * TRAP 1 (verified vs three 0.184): `Data3DTexture` defaults to NearestFilter, which makes
 * `WGSLNodeBuilder.isUnfilterable()` true → a TSL `texture3D(t).sample()` silently compiles to
 * `textureLoad` (point sampling) → banding between probe cells, with NO error. `LinearFilter` +
 * `HalfFloatType` (RGBA16F is always filterable; NOT 32-bit FloatType) flips it to
 * `textureSample`/`textureSampleLevel`. The Task-9 build guard asserts this on the generated WGSL.
 */
export function makeProbeVolume(half: Uint16Array): THREE.Data3DTexture {
  const t = new THREE.Data3DTexture(half, G[0], G[1], G[2]) // width=X, height=Y, depth=Z
  t.format = THREE.RGBAFormat
  t.type = THREE.HalfFloatType
  t.minFilter = THREE.LinearFilter
  t.magFilter = THREE.LinearFilter
  t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping
  t.generateMipmaps = false
  t.colorSpace = THREE.NoColorSpace // linear HDR irradiance
  t.needsUpdate = true
  return t
}

const C0 = float(SH_RUNTIME_C0)
const C1 = float(SH_RUNTIME_C1)

/**
 * Build the TSL node for per-channel SH-L1 irradiance `E(n)` at `uvwNode` for world normal `nNode`.
 * Each volume's RGBA texel = (`.x`=L00, `.yzw`=(L1-1, L10, L11)); the L1 triplet pairs with
 * (n.y, n.z, n.x). `texture3D(t).sample()` → `textureSample(Level)` because the volumes are
 * filterable (makeProbeVolume). Mirrors `reconstructE` in probeGrid.ts (same C0/C1, same axes).
 *
 * Plain node-composing function (not a TSL `Fn`) so the raw `Data3DTexture`s don't cross a Fn
 * boundary — they're wrapped by `texture3D()` here.
 */
export function shIrradiance(
  shR: THREE.Data3DTexture,
  shG: THREE.Data3DTexture,
  shB: THREE.Data3DTexture,
  uvwNode: Node,
  nNode: Node,
): Node {
  const cr = texture3D(shR).sample(uvwNode)
  const cg = texture3D(shG).sample(uvwNode)
  const cb = texture3D(shB).sample(uvwNode)
  const nSwz = vec3(nNode.y, nNode.z, nNode.x)
  const r = max(float(0), cr.x.mul(C0).add(dot(cr.yzw, nSwz).mul(C1)))
  const g = max(float(0), cg.x.mul(C0).add(dot(cg.yzw, nSwz).mul(C1)))
  const b = max(float(0), cb.x.mul(C0).add(dot(cb.yzw, nSwz).mul(C1)))
  return vec3(r, g, b)
}
