import * as THREE from 'three/webgpu'
import { wgsl, wgslFn, attribute, positionWorld, normalWorld, uv, vec2, vec3, vec4, float, sub, storage, texture } from 'three/tsl'
import { bvhIntersectFirstHit, getVertexAttribute } from 'three-mesh-bvh/webgpu'
import type { MeshBVH } from 'three-mesh-bvh'
import { gpuStorages, WGSL_HELPERS } from './bvhGpu.ts'

export interface RadiosityBakeOptions {
  resolution?: number // lightmap side, px (square)
  samples?: number // hemisphere rays per texel per bounce
  bounces?: number // gather iterations
  sky?: [number, number, number] // cold miss term (moonlight through the vitrine)
}

const DEFAULTS = { resolution: 1024, samples: 64, bounces: 3, sky: [0.0, 0.0, 0.0] as [number, number, number] }

/**
 * UV-space iterative radiosity bake (Phase 1 core), proven-pattern WebGPU/TSL.
 *
 * Two geometries:
 *  - `renderGeometry` = the LIGHTMAPPED surfaces only, carrying uv1/normal/color/emission.
 *    It is unwrapped into the atlas (vertexNode = (uv1.flipY()-0.5)*2) so the fragment runs
 *    once per lightmap texel.
 *  - `bvhGeometry` = EVERYTHING (lightmapped + occluders + emitters), carrying
 *    position/normal/color/emission/uv1. It feeds the BVH + storages read at ray hits.
 *
 *   L₀ = black
 *   L_{k+1}[texel] = emission_self + albedo_self · meanₛ( hit ? emission[hit] + L_k[uv1_hit] : sky )
 *
 * Lightmapped surfaces have emission=0 (so reading emission[hit] adds nothing for them — no
 * double count with L_k), emitters have emission set + uv1 in an empty atlas slot (L_k there
 * is black → only their emission shows), occluders have emission=0 + empty uv1 (→ 0, shadows).
 * Two HDR RTs ping-pong. Returns the final HDR lightmap.
 */
export async function radiosityBake(
  renderer: THREE.WebGPURenderer,
  renderGeometry: THREE.BufferGeometry,
  bvhGeometry: THREE.BufferGeometry,
  bvh: MeshBVH,
  options: RadiosityBakeOptions = {},
): Promise<THREE.Texture> {
  const opts = { ...DEFAULTS, ...options }
  const storages = gpuStorages(bvhGeometry, bvh)

  // uv1 of the BVH geometry packed as vec3 (z=0) so getVertexAttribute (vec3f) returns it.
  const uv1Attr = bvhGeometry.getAttribute('uv1')
  if (!uv1Attr) throw new Error('radiosityBake: bvhGeometry needs a uv1 attribute')
  const uv1packed = new Float32Array(uv1Attr.count * 3)
  for (let i = 0; i < uv1Attr.count; i++) { uv1packed[i * 3] = uv1Attr.getX(i); uv1packed[i * 3 + 1] = uv1Attr.getY(i) }
  const sUv1 = new THREE.StorageBufferAttribute(uv1packed, 3)
  const uv1Storage = storage(sUv1, 'vec3', sUv1.count).toReadOnly()

  const helpers = wgsl(WGSL_HELPERS)
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
      geom_emission: ptr<storage, array<vec3f>, read>,
      geom_uv1: ptr<storage, array<vec3f>, read>,
      bvh: ptr<storage, array<BVHNode>, read>,
      prevLightmap: texture_2d<f32>,
    ) -> vec3f {
      let S = i32(samples);
      var indirect = vec3f(0.0);
      for (var i = 0; i < S; i = i + 1) {
        let u = rndHash(seed, u32(i));
        let dir = hemiSample(N, u);
        var ray = Ray(P + N * 0.003, dir);
        let hit = bvhIntersectFirstHit(geom_index, geom_position, bvh, ray);
        if (hit.didHit) {
          let emi = getVertexAttribute(hit.barycoord, hit.indices.xyz, geom_emission);
          let uvh = getVertexAttribute(hit.barycoord, hit.indices.xyz, geom_uv1);
          let px = vec2i(i32(uvh.x * res), i32(uvh.y * res));
          let lm = textureLoad(prevLightmap, px, 0).rgb;
          indirect = indirect + emi + lm;
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
  const mesh = new THREE.Mesh(renderGeometry)
  mesh.frustumCulled = false
  scene.add(mesh)

  const prevTone = renderer.toneMapping
  const prevTarget = renderer.getRenderTarget()
  const prevClear = renderer.getClearColor(new THREE.Color())
  const prevClearAlpha = renderer.getClearAlpha()
  renderer.toneMapping = THREE.NoToneMapping

  // L₀ = black
  renderer.setClearColor(0x000000, 1)
  renderer.setRenderTarget(rtPrev)
  renderer.clear()

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
    geom_emission: storages.emission,
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
  renderer.setClearColor(prevClear, prevClearAlpha)
  gatherMat.dispose()
  rtCur.dispose()
  return rtPrev.texture
}
