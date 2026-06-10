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

// Persistent ping-pong bake targets — REUSED across bakes. Allocating fresh RenderTargets every bake
// and disposing them at the end made the NEXT bake ("Re-bake" button) render BLACK: the re-bake's
// render reused a pipeline/bind-group that still referenced the freed targets → the shell GI lightmap
// came out empty and walls/floor/ceiling went dark. Stable module-level targets keep every binding
// valid across re-bakes; only a resolution change reallocates them.
let _bakeRtA: THREE.RenderTarget | null = null
let _bakeRtB: THREE.RenderTarget | null = null
let _bakeRtDirect: THREE.RenderTarget | null = null // DIRECT-only snapshot (pass 0) — kept crisp
let _bakeRtFinal: THREE.RenderTarget | null = null // combined output — DEDICATED stable target: the
// runtime/probe bindings always reference THIS texture, whatever the intermediate pass count/parity
let _bakeRtMoon: THREE.RenderTarget | null = null // separate ADDITIVE moon-rake target (NOT albedo-modulated)
let _bakeRtRes = 0
const _mkRt = (res: number) => new THREE.RenderTarget(res, res, { type: THREE.HalfFloatType, colorSpace: THREE.NoColorSpace, depthBuffer: false })
function bakeTargets(res: number): [THREE.RenderTarget, THREE.RenderTarget, THREE.RenderTarget, THREE.RenderTarget] {
  if (!_bakeRtA || !_bakeRtB || !_bakeRtDirect || !_bakeRtFinal || _bakeRtRes !== res) {
    _bakeRtA?.dispose(); _bakeRtB?.dispose(); _bakeRtDirect?.dispose(); _bakeRtFinal?.dispose()
    _bakeRtA = _mkRt(res); _bakeRtB = _mkRt(res); _bakeRtDirect = _mkRt(res); _bakeRtFinal = _mkRt(res); _bakeRtRes = res
  }
  return [_bakeRtA, _bakeRtB, _bakeRtDirect, _bakeRtFinal]
}
// The moon rake lives in its OWN persistent target so the runtime can ADD it to the shell emissive
// (NOT multiply it by the dark hex-tile albedo, which crushes the cold light to black). Reused across bakes.
// NEAREST filtering (vs the GI targets' default linear): the runtime samples this at the floor's uv1, and
// bilinear blur would smear the window-vs-poster cut into a soft wash — Nearest keeps the découpe crisp.
function moonTarget(res: number): THREE.RenderTarget {
  if (!_bakeRtMoon || _bakeRtMoon.width !== res) {
    _bakeRtMoon?.dispose()
    _bakeRtMoon = new THREE.RenderTarget(res, res, { type: THREE.HalfFloatType, colorSpace: THREE.NoColorSpace, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter })
  }
  return _bakeRtMoon
}

/** Baked DIRECTIONAL cookie/gobo for the exterior "moonlight": a distant parallel light (dir = travel
 *  direction) whose per-texel contribution is gated by `maskTex` (glass channel) projected orthographically
 *  along the light onto the window plane (z = zWall). winRect = world [xmin,ymin,width,height] of the window;
 *  maskSub = [offX,offY,scaleX,scaleY] sub-rect inside the mask PNG. rad = linear HDR radiance. */
export interface MoonGobo {
  maskTex: THREE.Texture
  dir: [number, number, number]
  rad: [number, number, number]
  zWall: number
  winRect: [number, number, number, number]
  maskSub: [number, number, number, number]
  doorRect?: [number, number, number, number] // optional 2nd aperture (entrance door)
  doorMaskSub?: [number, number, number, number]
  neonDamp?: number // warm-GI attenuation factor where the rake lands (1 = no damp)
  probeScale?: number // probe-side radiance multiplier (the cold rim on SH receivers needs more than the floor)
  shadow?: boolean // interior cast shadows in the rake (counter/couch). false → the rake reaches the open floor
  // Mask "openness" for the floor wash: g = mix(maskG, 1, maskFloor) INSIDE an aperture. 0 = strict posters
  // (only glass gaps pass → open floor projects to the dense top-posters → stays dark). 1 = ignore poster
  // detail (broad cold wash over the whole vitrine band). The open/visible floor needs this lifted to read.
  maskFloor?: number
  // Optional INTERIOR-occluder BVH (counter, islands, couch…) for cast shadows in the rake. Built by
  // bakeShellRuntime and attached here. SEPARATE from the gather's shell+poster BVH so adding it never
  // perturbs the validated GI bake — the moon shadow ray tests ONLY these interior solids.
  occluderGeo?: THREE.BufferGeometry
  occluderBvh?: MeshBVH
  debug?: number
}

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
  moon: MoonGobo | null = null,
): Promise<{ lightmap: THREE.Texture; moonmap: THREE.Texture | null }> {
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
        let facingRaw = emitters[base + 4u]; // longueur = exposant de focus (cos^f), direction = normale one-sided
        let fexp = max(1.0, length(facingRaw));
        let facing = facingRaw / max(length(facingRaw), 1e-5);
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
          let cosL = pow(max(0.0, -dot(facing, wi)), fexp); // one-sided, lobe directionnel cos^f (focus enseignes)
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

  const targets = bakeTargets(opts.resolution)
  let rtPrev = targets[0], rtCur = targets[1]
  const rtDirect = targets[2], rtFinal = targets[3]

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

  // ── SPLIT DIRECT / INDIRECT ── La passe 0 lit un lightmap noir → sa sortie = DIRECT (NEE) seul
  // (+ le sky de miss, lisse). On la snapshotte dans rtDirect : le direct (halos d'enseignes, ombres
  // NEE) reste NET ; l'INDIRECT (final − direct) est par nature basse fréquence mais c'est lui qui
  // porte tout le bruit de variance en taches 30-60 cm (« masque sale » sur les murs nus, feedback
  // 10/06) → on le floute LARGE sans toucher au direct. C'est le pipeline standard des bakers offline.
  // Fullscreen-triangle partagé par toutes les passes post (copy/diff/blur/combine).
  const quad = new THREE.BufferGeometry()
  quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
  quad.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2))
  const quadMesh = new THREE.Mesh(quad)
  quadMesh.frustumCulled = false
  const postScene = new THREE.Scene()
  postScene.add(quadMesh)
  const post = async (mat: THREE.Material, target: THREE.RenderTarget) => {
    quadMesh.material = mat
    renderer.setRenderTarget(target)
    await renderer.renderAsync(postScene, cam)
  }
  // Box blur à rayon paramétrable (WGSL accepte des bornes de boucle dynamiques).
  const blurFn = wgslFn(/* wgsl */`
    fn boxBlur(fragUv: vec2f, res: f32, r: f32, src: texture_2d<f32>) -> vec3f {
      let px = vec2i(i32(fragUv.x * res), i32(fragUv.y * res));
      let ri = i32(r);
      var sum = vec3f(0.0);
      for (var dy = -ri; dy <= ri; dy = dy + 1) {
        for (var dx = -ri; dx <= ri; dx = dx + 1) {
          sum = sum + textureLoad(src, px + vec2i(dx, dy), 0).rgb;
        }
      }
      let w = f32(2 * ri + 1);
      return sum / (w * w);
    }
  `)
  // Bounces — et SNAPSHOT de la passe 0 : elle lit un lightmap noir, sa sortie EST le direct (NEE)
  // seul (+ sky de miss, lisse). Les seeds étant fixes par texel, le terme direct de chaque passe
  // est identique → (final − pass0) = indirect pur des rebonds.
  // ⚠️ Le snapshot utilise copyTextureToTexture (blit GPU pur) : intercaler une PASSE DE RENDU entre
  // deux passes gather rend la passe gather suivante NOIRE (même classe de bug que « blur=6 → shell
  // noir », vécu 2× le 10/06 — l'invalidation des bind groups au .value-swap n'est pas fiable).
  for (let k = 0; k < opts.bounces; k++) {
    prevTex.value = rtPrev.texture
    renderer.setRenderTarget(rtCur)
    await renderer.renderAsync(scene, cam)
    const t = rtPrev; rtPrev = rtCur; rtCur = t
    if (k === 0) renderer.copyTextureToTexture(rtPrev.texture, rtDirect.texture)
  }

  // ── SPLIT DIRECT / INDIRECT ── le direct (halos d'enseignes, ombres NEE) reste NET ; l'indirect
  // (final − direct) est par nature basse fréquence mais porte tout le bruit de variance en taches
  // 30-60 cm (« masque sale » sur les murs nus, feedback 10/06) → flou LARGE sur lui seul.
  // C'est le pipeline standard des bakers offline.
  {
    // 1. INDIRECT pur = final − direct brut (clampé ≥ 0) → rtCur.
    const finTex = texture(rtPrev.texture)
    const dTex = texture(rtDirect.texture)
    const diffMat = new THREE.MeshBasicNodeMaterial()
    diffMat.colorNode = finTex.sub(dTex).max(vec3(0, 0, 0))
    await post(diffMat, rtCur)

    // 2. Flou LARGE de l'indirect : 9×9 (r=4) × 6 passes ≈ σ 9 texels ≈ 12 cm à 2048 — écrase les
    //    taches de variance sans rien casser (l'indirect physique est plus basse fréquence que ça).
    //    Un matériau FRAIS par passe, texture source FIXE — aucune mutation .value (cf. piège ci-dessus).
    let wSrc = rtCur, wDst = rtPrev
    const wideMats: THREE.Material[] = []
    for (let b = 0; b < 6; b++) {
      const m = new THREE.MeshBasicNodeMaterial()
      m.colorNode = blurFn({ fragUv: uv(), res: float(opts.resolution), r: float(4), src: texture(wSrc.texture) })
      wideMats.push(m)
      await post(m, wDst)
      const t = wSrc; wSrc = wDst; wDst = t
    }

    // 3. Adoucissement du direct : TROIS 5×5 en cascade (σ≈2.8 texels ≈ 3.7 cm à 2048) — mesuré
    //    nécessaire (un seul 5×5 laissait ~12 % de bruit HF sur les murs unis ; le direct des
    //    enseignes LOINTAINES a une forte variance relative — feedback 10/06). Les pénombres des
    //    enseignes restent lisibles à cette échelle.
    const preDirMat = new THREE.MeshBasicNodeMaterial()
    preDirMat.colorNode = blurFn({ fragUv: uv(), res: float(opts.resolution), r: float(2), src: texture(rtDirect.texture) })
    await post(preDirMat, wDst) // wDst est libre après le ping-pong du flou large
    const preDirMat2 = new THREE.MeshBasicNodeMaterial()
    preDirMat2.colorNode = blurFn({ fragUv: uv(), res: float(opts.resolution), r: float(2), src: texture(wDst.texture) })
    await post(preDirMat2, rtDirect) // retour dans rtDirect (matériaux frais, pas de .value — cf. piège)

    // 4. COMBINE → rtFinal (target DÉDIÉE, stable à travers les re-bakes : les bindings runtime/probe
    //    référencent toujours cette texture, peu importe la parité des passes intermédiaires).
    const cDir = blurFn({ fragUv: uv(), res: float(opts.resolution), r: float(2), src: texture(rtDirect.texture) })
    const cInd = texture(wSrc.texture)
    const combineMat = new THREE.MeshBasicNodeMaterial()
    combineMat.colorNode = cDir.add(cInd)
    await post(combineMat, rtFinal)

    diffMat.dispose(); wideMats.forEach((m) => m.dispose()); preDirMat.dispose(); preDirMat2.dispose(); combineMat.dispose()
    quad.dispose()
  }

  // ── MOONLIGHT rake (final pass → SEPARATE ADDITIVE target) ── Project the storefront glass mask
  // orthographically along L onto each texel; mask.g gates where light passes (glass) vs posters; an
  // optional interior shadow ray blocks it behind the counter. The cold term is written to its OWN target
  // (moonRt), NOT the albedo-modulated GI lightmap: the runtime ADDS it to the shell emissive, so the dark
  // hex-tile floor (texture albedo ≈ black) still shows the rake instead of crushing it to 0 (`base·lm`
  // killed it — measured: the GI lightmap held the moon over ~24% of the floor slot, but ×black-tile = 0).
  // ?moonDebug=1 dumps the projected cookie vec3(hit,g) for world→mask-UV calibration.
  let moonmapTex: THREE.Texture | null = null
  if (moon && moon.maskTex && moon.maskTex.image) {
    const mImgW = (moon.maskTex.image as { width: number }).width
    const mImgH = (moon.maskTex.image as { height: number }).height
    const dbg = moon.debug ?? 0
    const F = (x: number) => { const s = String(x); return /[.e]/.test(s) ? s : s + '.0' } // WGSL f32 literal
    const hasDoor = moon.doorRect && moon.doorMaskSub ? 1 : 0
    const dRect = moon.doorRect ?? [0, 0, 1, 1]
    const dSub = moon.doorMaskSub ?? [0, 0, 1, 1]
    const maskFloorV = moon.maskFloor ?? 0 // lift g toward 1 inside an aperture (open floor → poster-dense top → needs this)
    // INTERIOR-occluder BVH (counter/islands/couch…) for cast shadows in the rake — SEPARATE from the
    // gather BVH so it never perturbs the validated GI. Wired only when bakeShellRuntime supplied it.
    const occ = moon.occluderGeo && moon.occluderBvh ? gpuStorages(moon.occluderGeo, moon.occluderBvh) : null
    const shadowSig = occ ? `,
        occIndex: ptr<storage, array<vec3u>, read>, occPos: ptr<storage, array<vec3f>, read>, occBvh: ptr<storage, array<BVHNode>, read>` : ''
    const shadowBody = occ ? `
            if (g > 0.0) {                          // cast a shadow ray P→window; an interior solid blocks the rake
              var sray = Ray(P + N * 0.02, -moonDir);
              let sh = bvhIntersectFirstHit(occIndex, occPos, occBvh, sray);
              if (sh.didHit && sh.dist < (t - 0.05)) { g = 0.0; }
            }` : ''
    // Constants interpolated as WGSL literals (no fragile arg binding). Output = the ADDITIVE cold radiance
    // (moonRad·cosP·glass), NOT multiplied by albedo — the runtime scales + adds it (MOON_RAKE uniform).
    const moonFn = wgslFn(/* wgsl */`
      fn moonPass(P: vec3f, N: vec3f, maskTex: texture_2d<f32>${shadowSig}) -> vec3f {
        let moonDir = vec3f(${F(moon.dir[0])}, ${F(moon.dir[1])}, ${F(moon.dir[2])});
        let moonRad = vec3f(${F(moon.rad[0])}, ${F(moon.rad[1])}, ${F(moon.rad[2])});
        let zWall = ${F(moon.zWall)}; let clampDirect = ${F(opts.clampDirect)}; let debug = ${F(dbg)};
        let hasDoor = ${F(hasDoor)};
        let vwx = ${F(moon.winRect[0])}; let vwy = ${F(moon.winRect[1])}; let vww = ${F(moon.winRect[2])}; let vwh = ${F(moon.winRect[3])};
        let vsx = ${F(moon.maskSub[0])}; let vsy = ${F(moon.maskSub[1])}; let vssx = ${F(moon.maskSub[2])}; let vssy = ${F(moon.maskSub[3])};
        let dwx = ${F(dRect[0])}; let dwy = ${F(dRect[1])}; let dww = ${F(dRect[2])}; let dwh = ${F(dRect[3])};
        let dsx = ${F(dSub[0])}; let dsy = ${F(dSub[1])}; let dssx = ${F(dSub[2])}; let dssy = ${F(dSub[3])};
        let mw = ${F(mImgW)}; let mh = ${F(mImgH)};
        if (debug > 2.5) { return vec3f(1.0); }
        if (debug > 1.5) { return vec3f(P.y * 5.0, 0.0, 0.0); }
        var g = 0.0;
        var hit = 0.0;
        let denom = -moonDir.z;                  // march back along -L toward the +z aperture
        if (denom > 0.001) {
          let t = (zWall - P.z) / denom;
          if (t > 0.0) {
            let Pw = P - moonDir * t;            // hit on the window plane
            // VITRINE first (U mirror: interior is PI-rotated vs the photo; V invert: PNG row0=top)
            let un = (Pw.x - vwx) / vww;
            let vn = (Pw.y - vwy) / vwh;
            if (un >= 0.0 && un <= 1.0 && vn >= 0.0 && vn <= 1.0) {
              hit = 1.0;
              let um = vsx + (1.0 - un) * vssx;
              let vm = vsy + (1.0 - vn) * vssy;
              g = textureLoad(maskTex, vec2i(i32(um * mw), i32(vm * mh)), 0).g;
            } else if (hasDoor > 0.5) {          // else the DOOR (apertures are disjoint → at most one hit)
              let dun = (Pw.x - dwx) / dww;
              let dvn = (Pw.y - dwy) / dwh;
              if (dun >= 0.0 && dun <= 1.0 && dvn >= 0.0 && dvn <= 1.0) {
                hit = 1.0;
                let dum = dsx + (1.0 - dun) * dssx;
                let dvm = dsy + (1.0 - dvn) * dssy;
                g = textureLoad(maskTex, vec2i(i32(dum * mw), i32(dvm * mh)), 0).g;
              }
            }
            if (hit > 0.5) { g = mix(g, 1.0, ${F(maskFloorV)}); }  // "open" the mask → broad floor wash (vs strict poster gaps)
            ${shadowBody}
          }
        }
        if (debug > 0.5) { return vec3f(hit, g, 0.0); }  // =1: RED=projection lands, GREEN=glass passes
        let cosP = max(0.0, dot(N, -moonDir));   // surface receives the moon FROM -L
        return clampRad(moonRad * cosP * g, clampDirect);   // ADDITIVE cold rake (runtime scales + adds, no albedo ×)
      }
    `, occ ? [bvhIntersectFirstHit, helpers] : [helpers])
    const moonMaskNode = texture(moon.maskTex)
    const moonMat = new THREE.MeshBasicNodeMaterial()
    moonMat.side = THREE.DoubleSide
    moonMat.vertexNode = unwrap // P=positionWorld matches the gather (baked world geo, identity mesh matrix)
    moonMat.colorNode = moonFn({
      P: positionWorld, N: normalLocal, maskTex: moonMaskNode,
      ...(occ ? { occIndex: occ.index, occPos: occ.position, occBvh: occ.bvh } : {}),
    })
    mesh.material = moonMat
    const moonRt = moonTarget(opts.resolution)
    renderer.setRenderTarget(moonRt)
    renderer.clear() // moonRt starts black → 0 where the rake doesn't reach
    await renderer.renderAsync(scene, cam)
    moonMat.dispose()
    moonmapTex = moonRt.texture

    // ANALYTICAL readback: ALWAYS stash moonRt pixels on globalThis for a DOM-side decode — at debug=0 this
    // is the actual ADDITIVE cold radiance written to the floor/wall slots (verify it's non-zero before
    // blaming the runtime add); at debug>=1 it's the (hit,g) cookie. The count log runs only at debug>=1.
    {
      const r = opts.resolution
      const data = await renderer.readRenderTargetPixelsAsync(moonRt, 0, 0, r, r)
      ;(globalThis as unknown as { __moonAtlas?: unknown }).__moonAtlas = { data, res: r, debug: dbg }
      if (dbg >= 1) {
        let hitCount = 0, gCount = 0, minX = 1, minY = 1, maxX = 0, maxY = 0
        for (let y = 0; y < r; y++) {
          for (let x = 0; x < r; x++) {
            const i = (y * r + x) * 4
            if (data[i] !== 0) { hitCount++; const u = x / r, v = y / r; if (u < minX) minX = u; if (u > maxX) maxX = u; if (v < minY) minY = v; if (v > maxY) maxY = v }
            if (data[i + 1] !== 0) gCount++
          }
        }
        console.log(`[moon-readback] res=${r} hit(R!=0)=${hitCount} glass(G!=0)=${gCount} hitUVbbox=[${minX.toFixed(3)},${minY.toFixed(3)} → ${maxX.toFixed(3)},${maxY.toFixed(3)}]`)
      }
    }
  }

  renderer.setRenderTarget(prevTarget)
  renderer.toneMapping = prevTone
  renderer.setClearColor(prevClear, prevClearAlpha)
  gatherMat.dispose()
  // rtFinal/moonRt are persistent module-level targets (see bakeTargets/moonTarget) — do NOT dispose
  // them, so the returned textures stay stable, valid bindings that the next "Re-bake" re-renders into.
  // rtFinal est la sortie DÉDIÉE du combine direct+indirect — indépendante de la parité des passes.
  return { lightmap: rtFinal.texture, moonmap: moonmapTex }
}
