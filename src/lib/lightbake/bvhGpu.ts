import { StorageBufferAttribute } from 'three/webgpu'
import { storage } from 'three/tsl'
import type { BufferGeometry } from 'three'
import type { MeshBVH } from 'three-mesh-bvh'

// WGSL helpers proven in app/radiosity-spike/page.tsx — a cheap per-pixel hash RNG
// + a cosine-ish hemisphere sample (Duff et al. orthonormal basis). Copied verbatim
// so the bake reuses the exact code that produced colour bleed on the spike.
export const WGSL_HELPERS = /* wgsl */`
  fn rndHash(p: vec2f, i: u32) -> vec2f {
    let s = p + vec2f(f32(i) * 0.1234, f32(i) * 0.5678);
    let x = fract(sin(dot(s, vec2f(127.1, 311.7))) * 43758.5453);
    let y = fract(sin(dot(s, vec2f(269.5, 183.3))) * 43758.5453);
    return vec2f(x, y);
  }
  fn hemiSample(n: vec3f, u: vec2f) -> vec3f {
    let sgn = select(-1.0, 1.0, n.z >= 0.0);
    let a = -1.0 / (sgn + n.z);
    let b = n.x * n.y * a;
    let b1 = vec3f(1.0 + sgn * n.x * n.x * a, sgn * b, -sgn * n.x);
    let b2 = vec3f(b, sgn + n.y * n.y * a, -n.y);
    let r = sqrt(u.x);
    let th = 6.2831853 * u.y;
    return r * cos(th) * b1 + r * sin(th) * b2 + sqrt(max(0.0, 1.0 - u.x)) * n;
  }
  // Radiance clamp (firefly killer): cap a per-sample NEE contribution at maxLum, SCALING by
  // luminance so the hue is preserved (a component-wise min would tint the highlight). The
  // near-field area-light term Le·cos·cos·area/dist² blows up as dist→0 (a sign close to a
  // surface) → one stray sample becomes a speckle that no box-blur can erase. maxLum<=0 disables.
  fn clampRad(c: vec3f, maxLum: f32) -> vec3f {
    if (maxLum <= 0.0) { return c; }
    let l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    if (l > maxLum) { return c * (maxLum / l); }
    return c;
  }
`

export interface BvhBufferCounts {
  indexCount: number // triangles (index buffer packed as uvec3)
  positionCount: number // vertices
  nodeFloats: number // total floats in the flattened BVH (8 per node)
}

// `_roots[0]` is the flattened BVH ArrayBuffer (32 B / node = 8 floats = BYTES_PER_NODE).
function bvhRootBuffer(bvh: MeshBVH): ArrayBuffer {
  return (bvh as unknown as { _roots: ArrayBuffer[] })._roots[0]
}

/**
 * Pure counts for the storage-buffer layout — node-testable, no GPU. Mirrors what
 * gpuStorages() uploads: index as uvec3 (count = tris), position as vec3 (count =
 * verts), BVH as 8 floats/node. Use this to assert buffer shape without a renderer.
 */
export function packBvhBuffers(geo: BufferGeometry, bvh: MeshBVH): BvhBufferCounts {
  const index = geo.getIndex()
  if (!index) throw new Error('packBvhBuffers: geometry must be indexed')
  return {
    indexCount: index.count / 3,
    positionCount: geo.getAttribute('position').count,
    nodeFloats: new Float32Array(bvhRootBuffer(bvh)).length,
  }
}

export interface GpuStorages {
  index: unknown // storage(uvec3) — triangle vertex indices
  position: unknown // storage(vec3)
  normal: unknown // storage(vec3)
  color: unknown // storage(vec3) — albedo
  emission: unknown // storage(vec3) — emitter radiance (0 on non-emitters)
  bvh: unknown // storage(BVHNode)
  indexCount: number
  positionCount: number
  nodeCount: number
}

/**
 * Build the read-only TSL storage nodes for a merged, indexed geometry carrying
 * position/normal/color/emission attributes, exactly as the spike did. Browser-only
 * (needs a WebGPU context). Pass the returned nodes into a wgslFn(...) call.
 */
export function gpuStorages(geo: BufferGeometry, bvh: MeshBVH): GpuStorages {
  const index = geo.getIndex()
  if (!index) throw new Error('gpuStorages: geometry must be indexed')
  const need = (name: string) => {
    const a = geo.getAttribute(name)
    if (!a) throw new Error(`gpuStorages: geometry missing "${name}" attribute`)
    return a
  }

  const sIndex = new StorageBufferAttribute(index.array as Uint32Array, 3)
  const sPosition = new StorageBufferAttribute(need('position').array as Float32Array, 3)
  const sNormal = new StorageBufferAttribute(need('normal').array as Float32Array, 3)
  const sColor = new StorageBufferAttribute(need('color').array as Float32Array, 3)
  const sEmission = new StorageBufferAttribute(need('emission').array as Float32Array, 3)
  const sBvh = new StorageBufferAttribute(new Float32Array(bvhRootBuffer(bvh)), 8)

  return {
    index: storage(sIndex, 'uvec3', sIndex.count).toReadOnly(),
    position: storage(sPosition, 'vec3', sPosition.count).toReadOnly(),
    normal: storage(sNormal, 'vec3', sNormal.count).toReadOnly(),
    color: storage(sColor, 'vec3', sColor.count).toReadOnly(),
    emission: storage(sEmission, 'vec3', sEmission.count).toReadOnly(),
    bvh: storage(sBvh, 'BVHNode', sBvh.count).toReadOnly(),
    indexCount: sIndex.count,
    positionCount: sPosition.count,
    nodeCount: sBvh.count,
  }
}
