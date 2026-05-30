import * as THREE from 'three/webgpu'
import { wgsl, wgslFn, attribute, positionWorld, normalWorld, uv, vec2, vec3, vec4, float, sub, storage, texture } from 'three/tsl'
import { bvhIntersectFirstHit, getVertexAttribute } from 'three-mesh-bvh/webgpu'
import type { MeshBVH } from 'three-mesh-bvh'
import { gpuStorages, WGSL_HELPERS } from './bvhGpu'

export interface RadiosityBakeOptions {
  resolution?: number // lightmap side, px (square)
  samples?: number // hemisphere rays per texel per bounce
  bounces?: number // gather iterations (1 = direct emissive bleed; 2+ = multi-bounce GI)
  sky?: [number, number, number] // cold miss term (moonlight through the vitrine)
}

const DEFAULTS = { resolution: 1024, samples: 64, bounces: 3, sky: [0.0, 0.0, 0.0] as [number, number, number] }

/**
 * UV-space iterative radiosity bake (Phase 1 core), proven-pattern WebGPU/TSL.
 *
 * `geometry` is a single merged, indexed geometry carrying position/normal/color
 * (albedo)/emission/uv1. `bvh` is its MeshBVH. Each lightmapped texel is "unwrapped"
 * into the atlas via vertexNode = (uv1.flipY()-0.5)*2 (the ProgressiveLightMapGPU trick).
 *
 *   L₀[texel]   = emission
 *   L_{k+1}[t]  = emission_self + albedo_self · meanₛ( hit ? L_k[uv1_hit] : sky )
 *
 * Each bounce reads the PREVIOUS lightmap at the hit's interpolated uv1 (via
 * getVertexAttribute on a vec3-packed uv1 storage + textureLoad), ping-ponging two HDR
 * render targets. Returns the final HDR lightmap.
 */
export async function radiosityBake(
  renderer: THREE.WebGPURenderer,
  geometry: THREE.BufferGeometry,
  bvh: MeshBVH,
  options: RadiosityBakeOptions = {},
): Promise<THREE.Texture> {
  const opts = { ...DEFAULTS, ...options }
  const storages = gpuStorages(geometry, bvh)

  // uv1 packed as vec3 (z=0) so getVertexAttribute (vec3f) returns it at hits.
  const uv1Attr = geometry.getAttribute('uv1')
  if (!uv1Attr) throw new Error('radiosityBake: geometry needs a uv1 attribute')
  const uv1packed = new Float32Array(uv1Attr.count * 3)
  for (let i = 0; i < uv1Attr.count; i++) { uv1packed[i * 3] = uv1Attr.getX(i); uv1packed[i * 3 + 1] = uv1Attr.getY(i) }
  const sUv1 = new THREE.StorageBufferAttribute(uv1packed, 3)
  const uv1Storage = storage(sUv1, 'vec3', sUv1.count).toReadOnly()

  const helpers = wgsl(WGSL_HELPERS)
  // Unwrap: place each vertex at its uv1 in clip space (flipY reconciles clip-Y vs texel-Y).
  const unwrap = vec4(sub(uv(1).flipY(), vec2(0.5)).mul(2), 0, 1)

  const gather = wgslFn(/* wgsl */`
    fn gather(
      P: vec3f,
      N: vec3f,
      selfEmission: vec3f,
      selfAlbedo: vec3f,
      seed: vec2f,
      samples: f32,
      sky: vec3f,
      res: f32,
      geom_index: ptr<storage, array<vec3u>, read>,
      geom_position: ptr<storage, array<vec3f>, read>,
      geom_uv1: ptr<storage, array<vec3f>, read>,
      bvh: ptr<storage, array<BVHNode>, read>,
      prevLightmap: texture_2d<f32>,
    ) -> vec3f {
      let S = i32(samples);
      var indirect = vec3f(0.0);
      for (var i = 0; i < S; i = i + 1) {
        let u = rndHash(seed, u32(i));
        let dir = hemiSample(N, u);
        var ray = Ray(P + N * 0.002, dir);
        let hit = bvhIntersectFirstHit(geom_index, geom_position, bvh, ray);
        if (hit.didHit) {
          let uvh = getVertexAttribute(hit.barycoord, hit.indices.xyz, geom_uv1);
          let px = vec2i(i32(uvh.x * res), i32(uvh.y * res));
          indirect = indirect + textureLoad(prevLightmap, px, 0).rgb;
        } else {
          indirect = indirect + sky;
        }
      }
      indirect = indirect / f32(S);
      return selfEmission + selfAlbedo * indirect;
    }
  `, [bvhIntersectFirstHit, getVertexAttribute, helpers])

  const mkRT = () => new THREE.RenderTarget(opts.resolution, opts.resolution, {
    type: THREE.HalfFloatType, colorSpace: THREE.NoColorSpace, depthBuffer: false,
  })
  let rtPrev = mkRT()
  let rtCur = mkRT()

  const scene = new THREE.Scene()
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const mesh = new THREE.Mesh(geometry)
  mesh.frustumCulled = false
  scene.add(mesh)

  const prevTone = renderer.toneMapping
  const prevTarget = renderer.getRenderTarget()
  renderer.toneMapping = THREE.NoToneMapping

  // L₀ = emission, baked into the atlas.
  const emiMat = new THREE.MeshBasicNodeMaterial()
  emiMat.side = THREE.DoubleSide
  emiMat.vertexNode = unwrap
  emiMat.colorNode = attribute('emission')
  mesh.material = emiMat
  renderer.setRenderTarget(rtPrev)
  await renderer.renderAsync(scene, cam)

  // Gather material reads the previous lightmap at hits (prevTex.value swapped per bounce).
  const prevTex = texture(rtPrev.texture)
  const gatherMat = new THREE.MeshBasicNodeMaterial()
  gatherMat.side = THREE.DoubleSide
  gatherMat.vertexNode = unwrap
  gatherMat.colorNode = gather({
    P: positionWorld,
    N: normalWorld,
    selfEmission: attribute('emission'),
    selfAlbedo: attribute('color'),
    seed: uv(1),
    samples: float(opts.samples),
    sky: vec3(opts.sky[0], opts.sky[1], opts.sky[2]),
    res: float(opts.resolution),
    geom_index: storages.index,
    geom_position: storages.position,
    geom_uv1: uv1Storage,
    bvh: storages.bvh,
    prevLightmap: prevTex,
  })
  mesh.material = gatherMat

  for (let k = 0; k < opts.bounces; k++) {
    prevTex.value = rtPrev.texture
    renderer.setRenderTarget(rtCur)
    await renderer.renderAsync(scene, cam)
    const t = rtPrev; rtPrev = rtCur; rtCur = t // result now in rtPrev
  }

  renderer.setRenderTarget(prevTarget)
  renderer.toneMapping = prevTone
  emiMat.dispose()
  gatherMat.dispose()
  rtCur.dispose()
  return rtPrev.texture
}
