import * as THREE from 'three/webgpu'
import { wgsl, wgslFn, attribute, positionWorld, normalLocal, uv, vec2, vec3, vec4, float, sub, storage, texture } from 'three/tsl'
import { bvhIntersectFirstHit, getVertexAttribute } from 'three-mesh-bvh/webgpu'
import type { MeshBVH } from 'three-mesh-bvh'
import { gpuStorages, WGSL_HELPERS } from './bvhGpu.ts'
import type { EmitterRect } from './emissiveRig.ts'

/** Minimal emitter for NEE: a world rectangle + its linear HDR radiance. EmissiveProxy satisfies it. */
export type NeeEmitter = { rect: EmitterRect; emission: [number, number, number] }

export interface RadiosityBakeOptions {
  resolution?: number // lightmap side, px (square)
  samples?: number // hemisphere rays per texel per bounce (INDIRECT)
  neeSamples?: number // shadow-ray samples per emitter (DIRECT / NEE)
  bounces?: number // gather iterations
  sky?: [number, number, number] // cold miss term (moonlight through the vitrine)
  blur?: number // post-bake denoise passes (3×3 box)
  clampDirect?: number // max luminance per NEE sample (firefly clamp); 0 disables
  grayscale?: boolean // force emitter emission to luminance (neutral but colour-ready)
}

const DEFAULTS = { resolution: 1024, samples: 48, neeSamples: 4, bounces: 3, sky: [0, 0, 0] as [number, number, number], blur: 0, clampDirect: 100, grayscale: false }
const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b

/**
 * UV-space radiosity bake with **Next-Event Estimation** (direct light sampling), WebGPU/TSL.
 *
 * - `renderGeometry` = lightmapped surfaces only (unwrapped to the atlas via uv1).
 * - `bvhGeometry` = surfaces + occluders (the shadow-ray world). Emitters are NOT here — a
 *   light must not occlude shadow rays — they are sampled directly via `emitters[].rect`.
 *
 * Per texel: DIRECT = Σ emitters of `albedo/π · meanₙ( V · Le · cosP · cosL · area / dist² )`
 * (V from a BVH shadow ray); INDIRECT = the hemisphere bounce reading ONLY the previous
 * lightmap's reflected radiance (emitters contribute 0 → no double count). L = emission + direct + indirect.
 */
export async function radiosityBake(
  renderer: THREE.WebGPURenderer,
  renderGeometry: THREE.BufferGeometry,
  bvhGeometry: THREE.BufferGeometry,
  bvh: MeshBVH,
  emitters: ReadonlyArray<NeeEmitter>,
  options: RadiosityBakeOptions = {},
): Promise<THREE.Texture> {
  const opts = { ...DEFAULTS, ...options }
  const storages = gpuStorages(bvhGeometry, bvh)

  // uv1 of the BVH geometry packed as vec3 (z=0) → getVertexAttribute returns it at hits.
  const uv1Attr = bvhGeometry.getAttribute('uv1')
  if (!uv1Attr) throw new Error('radiosityBake: bvhGeometry needs a uv1 attribute')
  const uv1packed = new Float32Array(uv1Attr.count * 3)
  for (let i = 0; i < uv1Attr.count; i++) { uv1packed[i * 3] = uv1Attr.getX(i); uv1packed[i * 3 + 1] = uv1Attr.getY(i) }
  const sUv1 = new THREE.StorageBufferAttribute(uv1packed, 3)
  const uv1Storage = storage(sUv1, 'vec3', sUv1.count).toReadOnly()

  // Emitter rectangles: 5 vec3 per emitter (corner, edge1, edge2, emission, facing).
  const N = Math.max(1, emitters.length)
  const emitterData = new Float32Array(N * 15)
  emitters.forEach((em, i) => {
    const o = i * 15, r = em.rect
    const e = opts.grayscale ? (() => { const L = lum(em.emission[0], em.emission[1], em.emission[2]); return [L, L, L] })() : em.emission
    emitterData[o] = r.corner[0]; emitterData[o + 1] = r.corner[1]; emitterData[o + 2] = r.corner[2]
    emitterData[o + 3] = r.edge1[0]; emitterData[o + 4] = r.edge1[1]; emitterData[o + 5] = r.edge1[2]
    emitterData[o + 6] = r.edge2[0]; emitterData[o + 7] = r.edge2[1]; emitterData[o + 8] = r.edge2[2]
    emitterData[o + 9] = e[0]; emitterData[o + 10] = e[1]; emitterData[o + 11] = e[2]
    emitterData[o + 12] = r.facing[0]; emitterData[o + 13] = r.facing[1]; emitterData[o + 14] = r.facing[2]
  })
  const sEmitters = new THREE.StorageBufferAttribute(emitterData, 3)
  const emittersStorage = storage(sEmitters, 'vec3', sEmitters.count).toReadOnly()

  const helpers = wgsl(WGSL_HELPERS)
  // uv1 → clip, NO flipY. The runtime reads the atlas at the raw uv1 (probe `textureLoad(uv1)` +
  // the shell emissiveNode `texture(lightmap, uv(1))`), so the bake must WRITE at the raw uv1 too.
  // A `.flipY()` here mirrors V across the WHOLE atlas — and since the 3×3 atlas has an unused bottom
  // row (only 6 of 9 slots used), it shoved the top-row surfaces' bake (floor/ceiling/wall-north)
  // into the empty row → they read black, while the middle row (left/right/south walls) happened to
  // align → the "only two opposite walls lit" bug. Identity mapping (point U → texel U → read U) is
  // correct and flip-free.
  const unwrap = vec4(sub(uv(1), vec2(0.5)).mul(2), 0, 1)

  const gather = wgslFn(/* wgsl */`
    fn gather(
      P: vec3f, N: vec3f, selfEmission: vec3f, selfAlbedo: vec3f,
      seed: vec2f, samples: f32, neeSamples: f32, emitterCount: f32, res: f32, sky: vec3f, clampDirect: f32,
      geom_index: ptr<storage, array<vec3u>, read>,
      geom_position: ptr<storage, array<vec3f>, read>,
      geom_uv1: ptr<storage, array<vec3f>, read>,
      bvh: ptr<storage, array<BVHNode>, read>,
      emitters: ptr<storage, array<vec3f>, read>,
      prevLightmap: texture_2d<f32>,
    ) -> vec3f {
      let PI = 3.14159265;

      // ---- DIRECT (Next-Event Estimation): sample each emitter rectangle + shadow ray ----
      var direct = vec3f(0.0);
      let EC = i32(emitterCount);
      let NS = i32(neeSamples);
      for (var e = 0; e < EC; e = e + 1) {
        let base = u32(e) * 5u;
        let corner = emitters[base + 0u];
        let edge1  = emitters[base + 1u];
        let edge2  = emitters[base + 2u];
        let Le     = emitters[base + 3u];
        let facing = emitters[base + 4u]; // unit room-facing normal (one-sided)
        let area = length(cross(edge1, edge2));
        if (area <= 0.0) { continue; }
        var accum = vec3f(0.0);
        for (var s = 0; s < NS; s = s + 1) {
          let r = rndHash(seed + vec2f(f32(e) * 0.7361, f32(e) * 0.1987), u32(s));
          let xL = corner + r.x * edge1 + r.y * edge2;
          let d = xL - P;
          let dist2 = dot(d, d);
          let dist = sqrt(dist2);
          let wi = d / dist;
          let cosP = max(0.0, dot(N, wi));
          let cosL = max(0.0, -dot(facing, wi)); // emitter shines ONE-sided toward P only
          if (cosP <= 0.0 || cosL <= 0.0) { continue; }
          var sray = Ray(P + N * 0.003, wi);
          let sh = bvhIntersectFirstHit(geom_index, geom_position, bvh, sray);
          let occluded = sh.didHit && sh.dist < (dist - 0.01);
          if (!occluded) {
            accum = accum + clampRad(Le * cosP * cosL * area / dist2, clampDirect);
          }
        }
        direct = direct + accum / f32(NS);
      }
      direct = selfAlbedo / PI * direct;

      // ---- INDIRECT (hemisphere bounce): reflected radiance of prev lightmap only ----
      let S = i32(samples);
      var indirect = vec3f(0.0);
      for (var i = 0; i < S; i = i + 1) {
        let u = rndHash(seed, u32(i) + 97u);
        let dir = hemiSample(N, u);
        var ray = Ray(P + N * 0.003, dir);
        let hit = bvhIntersectFirstHit(geom_index, geom_position, bvh, ray);
        if (hit.didHit) {
          let uvh = getVertexAttribute(hit.barycoord, hit.indices.xyz, geom_uv1);
          let px = vec2i(i32(uvh.x * res), i32(uvh.y * res));
          indirect = indirect + textureLoad(prevLightmap, px, 0).rgb; // reflected only, NO emission
        } else {
          indirect = indirect + sky;
        }
      }
      indirect = selfAlbedo * (indirect / f32(S));

      return selfEmission + direct + indirect;
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
  renderer.setClearColor(0x000000, 1)
  renderer.setRenderTarget(rtPrev)
  renderer.clear() // L₀ = black

  const prevTex = texture(rtPrev.texture)
  const gatherMat = new THREE.MeshBasicNodeMaterial()
  gatherMat.side = THREE.DoubleSide
  gatherMat.vertexNode = unwrap
  gatherMat.colorNode = gather({
    P: positionWorld,
    N: normalLocal, // raw geometry normal (not normalWorld — see the NEE skill)
    selfEmission: attribute('emission'),
    selfAlbedo: attribute('color'),
    seed: uv(1),
    samples: float(opts.samples),
    neeSamples: float(opts.neeSamples),
    emitterCount: float(N),
    res: float(opts.resolution),
    sky: vec3(opts.sky[0], opts.sky[1], opts.sky[2]),
    clampDirect: float(opts.clampDirect),
    geom_index: storages.index,
    geom_position: storages.position,
    geom_uv1: uv1Storage,
    bvh: storages.bvh,
    emitters: emittersStorage,
    prevLightmap: prevTex,
  })
  mesh.material = gatherMat

  for (let k = 0; k < opts.bounces; k++) {
    prevTex.value = rtPrev.texture
    renderer.setRenderTarget(rtCur)
    await renderer.renderAsync(scene, cam)
    const t = rtPrev; rtPrev = rtCur; rtCur = t
  }

  if (opts.blur > 0) {
    const blurFn = wgslFn(/* wgsl */`
      fn boxBlur(fragUv: vec2f, res: f32, src: texture_2d<f32>) -> vec3f {
        let px = vec2i(i32(fragUv.x * res), i32(fragUv.y * res));
        var sum = vec3f(0.0);
        for (var dy = -1; dy <= 1; dy = dy + 1) {
          for (var dx = -1; dx <= 1; dx = dx + 1) {
            sum = sum + textureLoad(src, px + vec2i(dx, dy), 0).rgb;
          }
        }
        return sum / 9.0;
      }
    `)
    const blurTex = texture(rtPrev.texture)
    const blurMat = new THREE.MeshBasicNodeMaterial()
    blurMat.colorNode = blurFn({ fragUv: uv(), res: float(opts.resolution), src: blurTex })
    const quad = new THREE.BufferGeometry()
    quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
    quad.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2))
    const quadMesh = new THREE.Mesh(quad, blurMat)
    quadMesh.frustumCulled = false
    const blurScene = new THREE.Scene()
    blurScene.add(quadMesh)
    for (let b = 0; b < opts.blur; b++) {
      blurTex.value = rtPrev.texture
      renderer.setRenderTarget(rtCur)
      await renderer.renderAsync(blurScene, cam)
      const t = rtPrev; rtPrev = rtCur; rtCur = t
    }
    blurMat.dispose()
  }

  renderer.setRenderTarget(prevTarget)
  renderer.toneMapping = prevTone
  renderer.setClearColor(prevClear, prevClearAlpha)
  gatherMat.dispose()
  rtCur.dispose()
  return rtPrev.texture
}
