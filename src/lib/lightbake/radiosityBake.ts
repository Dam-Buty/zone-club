import * as THREE from 'three/webgpu'
import { wgsl, wgslFn, attribute, positionWorld, normalWorld, uv, vec2, vec3, vec4, float, sub } from 'three/tsl'
import { bvhIntersectFirstHit, getVertexAttribute } from 'three-mesh-bvh/webgpu'
import type { MeshBVH } from 'three-mesh-bvh'
import { gpuStorages, WGSL_HELPERS } from './bvhGpu'

export interface RadiosityBakeOptions {
  resolution?: number // lightmap side, px (square)
  samples?: number // hemisphere rays per texel per bounce
  bounces?: number // gather iterations (1 = direct emissive bleed; >1 = multi-bounce, Task 3b)
  sky?: [number, number, number] // cold miss term (moonlight through the vitrine)
}

const DEFAULTS = { resolution: 1024, samples: 64, bounces: 1, sky: [0.0, 0.0, 0.0] as [number, number, number] }

/**
 * UV-space iterative radiosity bake (Phase 1 core), proven-pattern WebGPU/TSL.
 *
 * `geometry` is a single merged, indexed geometry carrying position/normal/color
 * (albedo)/emission/uv1. `bvh` is its MeshBVH. Each lightmapped texel is "unwrapped"
 * into the atlas via vertexNode = (uv1-0.5)*2 (the ProgressiveLightMapGPU trick), and
 * its outgoing radiance is gathered against the BVH:
 *
 *   L₁[texel] = emission_self + albedo_self · meanₛ( hit ? emission[hit] : sky )
 *
 * Bounce 1 reads `emission` at the hit (a static vertex attribute), so it needs NO
 * texture sampling — that's what makes the de-risk cheap. Returns the HDR lightmap.
 */
export async function radiosityBake(
  renderer: THREE.WebGPURenderer,
  geometry: THREE.BufferGeometry,
  bvh: MeshBVH,
  options: RadiosityBakeOptions = {},
): Promise<THREE.Texture> {
  const opts = { ...DEFAULTS, ...options }
  const storages = gpuStorages(geometry, bvh)

  const helpers = wgsl(WGSL_HELPERS)

  // One bounce: gather emission at ray hits. (Multi-bounce reads the previous
  // lightmap at the hit's uv1 — added in Task 3b once texture-at-hit is proven.)
  const gather = wgslFn(/* wgsl */`
    fn gather(
      P: vec3f,
      N: vec3f,
      selfEmission: vec3f,
      selfAlbedo: vec3f,
      seed: vec2f,
      samples: f32,
      sky: vec3f,
      geom_index: ptr<storage, array<vec3u>, read>,
      geom_position: ptr<storage, array<vec3f>, read>,
      geom_emission: ptr<storage, array<vec3f>, read>,
      bvh: ptr<storage, array<BVHNode>, read>,
    ) -> vec3f {
      let S = i32(samples);
      var indirect = vec3f(0.0);
      for (var i = 0; i < S; i = i + 1) {
        let u = rndHash(seed, u32(i));
        let dir = hemiSample(N, u);
        var ray = Ray(P + N * 0.002, dir);
        let hit = bvhIntersectFirstHit(geom_index, geom_position, bvh, ray);
        if (hit.didHit) {
          indirect = indirect + getVertexAttribute(hit.barycoord, hit.indices.xyz, geom_emission);
        } else {
          indirect = indirect + sky;
        }
      }
      indirect = indirect / f32(S);
      return selfEmission + selfAlbedo * indirect;
    }
  `, [bvhIntersectFirstHit, getVertexAttribute, helpers])

  const bakeMat = new THREE.MeshBasicNodeMaterial()
  bakeMat.side = THREE.DoubleSide
  // Unwrap: place each vertex at its uv1 in clip space → fragment runs per lightmap texel.
  // flipY mirrors ProgressiveLightMapGPU: it reconciles clip-space Y (+1 up) with texture
  // Y so that runtime sample(uv1) reads the exact texel this bake wrote for that point.
  bakeMat.vertexNode = vec4(sub(uv(1).flipY(), vec2(0.5)).mul(2), 0, 1)
  bakeMat.colorNode = gather({
    P: positionWorld,
    N: normalWorld,
    selfEmission: attribute('emission'),
    selfAlbedo: attribute('color'),
    seed: uv(1),
    samples: float(opts.samples),
    sky: vec3(opts.sky[0], opts.sky[1], opts.sky[2]),
    geom_index: storages.index,
    geom_position: storages.position,
    geom_emission: storages.emission,
    bvh: storages.bvh,
  })

  const mesh = new THREE.Mesh(geometry, bakeMat)
  mesh.frustumCulled = false
  const scene = new THREE.Scene()
  scene.add(mesh)
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) // unused proj (vertexNode overrides clip)

  const rt = new THREE.RenderTarget(opts.resolution, opts.resolution, {
    type: THREE.HalfFloatType,
    colorSpace: THREE.NoColorSpace,
    depthBuffer: false,
  })

  const prevTarget = renderer.getRenderTarget()
  const prevTone = renderer.toneMapping
  renderer.toneMapping = THREE.NoToneMapping
  renderer.setRenderTarget(rt)
  await renderer.renderAsync(scene, cam)
  renderer.setRenderTarget(prevTarget)
  renderer.toneMapping = prevTone

  bakeMat.dispose()
  return rt.texture
}
