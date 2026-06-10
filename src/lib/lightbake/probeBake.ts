import * as THREE from 'three/webgpu'
import { wgsl, wgslFn, Fn, instanceIndex, instancedArray, storage, texture, vec3, vec2, vec4, float } from 'three/tsl'
import { bvhIntersectFirstHit, getVertexAttribute } from 'three-mesh-bvh/webgpu'
import type { MeshBVH } from 'three-mesh-bvh'
import { gpuStorages, WGSL_HELPERS } from './bvhGpu.ts'
import { G, PROBE_COUNT, probeWorld, flatIndex } from './probeGrid.ts'
import { makeProbeVolume } from './shReconstruct.ts'
import type { NeeEmitter, MoonGobo } from './radiosityBake.ts'

const SAMPLES = 256   // full-sphere rays per probe (indirect bounce off the lit shell)
const NEE_SAMPLES = 8 // shadow rays per emitter (direct neon, also projected to SH)

/**
 * Bake raw SH-L1 (4 coeffs × rgb) per probe on the MAIN renderer, reusing the Phase-1 BVH +
 * emitter rig + the FINISHED Phase-1 lightmap (the static surfaces' outgoing radiance, read via
 * getVertexAttribute at the hit's uv1). Returns 3 per-channel Float32Arrays of length
 * `PROBE_COUNT*4` = [L00, L1-1, L10, L11]. The caller flood-fills dead probes then packs (Task 5/6).
 *
 * Output buffer is `vec4` (not vec3) to dodge std430's 16-byte vec3 padding → unambiguous readback.
 */
export async function probeBakeRaw(
  renderer: THREE.WebGPURenderer,
  bvhGeometry: THREE.BufferGeometry,
  bvh: MeshBVH,
  lightmap: THREE.Texture,
  lightmapRes: number,
  emitters: ReadonlyArray<NeeEmitter>,
  sky: [number, number, number] = [0.008, 0.012, 0.025],
  clampDirect = 100, // max luminance per NEE sample (firefly clamp); shared with the shell bake
  moon: MoonGobo | null = null, // exterior directional through the vitrine/door, projected to SH (cold rim on counter/objects)
): Promise<{ r: Float32Array; g: Float32Array; b: Float32Array }> {
  const S = gpuStorages(bvhGeometry, bvh)
  // The probe COMPUTE stage is capped at 8 storage buffers (the default WebGPU limit, and the M1 target):
  // the gather already binds 7 (ppS · shOut · geom_index · geom_position · uv1 · bvh · emitters). Adding the
  // interior-occluder BVH (×3) → 10 = GPUValidationError. The FLOOR furniture shadow is already baked into
  // the lightmap rake (radiosityBake moonPass, its own fragment-stage BVH — no limit issue there); the probe
  // only needs the moon DIRECT (aperture+mask) to give the counter top / Rick / objects their cold rim, so we
  // skip the probe-side shadow ray. Flip PROBE_MOON_SHADOW only on a device that guarantees ≥11 buffers.
  const PROBE_MOON_SHADOW = false
  const Socc = PROBE_MOON_SHADOW && moon && moon.occluderGeo && moon.occluderBvh ? gpuStorages(moon.occluderGeo, moon.occluderBvh) : null

  // uv1 packed vec3 (z=0) — IDENTICAL to radiosityBake.ts:47-52.
  const uv1Attr = bvhGeometry.getAttribute('uv1')
  if (!uv1Attr) throw new Error('probeBakeRaw: bvhGeometry needs a uv1 attribute (the shell unwrap)')
  const u1 = new Float32Array(uv1Attr.count * 3)
  for (let i = 0; i < uv1Attr.count; i++) { u1[i * 3] = uv1Attr.getX(i); u1[i * 3 + 1] = uv1Attr.getY(i) }
  const sUv1 = new THREE.StorageBufferAttribute(u1, 3)
  const uv1S = storage(sUv1, 'vec3', sUv1.count).toReadOnly()

  // Emitter rects 5×vec3 (corner, edge1, edge2, emission, facing) — IDENTICAL to radiosityBake.ts:55-66.
  const NE = Math.max(1, emitters.length)
  const ed = new Float32Array(NE * 15)
  emitters.forEach((em, i) => {
    const o = i * 15, r = em.rect
    ed[o] = r.corner[0]; ed[o + 1] = r.corner[1]; ed[o + 2] = r.corner[2]
    ed[o + 3] = r.edge1[0]; ed[o + 4] = r.edge1[1]; ed[o + 5] = r.edge1[2]
    ed[o + 6] = r.edge2[0]; ed[o + 7] = r.edge2[1]; ed[o + 8] = r.edge2[2]
    ed[o + 9] = em.emission[0]; ed[o + 10] = em.emission[1]; ed[o + 11] = em.emission[2]
    ed[o + 12] = r.facing[0]; ed[o + 13] = r.facing[1]; ed[o + 14] = r.facing[2]
  })
  const sEm = new THREE.StorageBufferAttribute(ed, 3)
  const emS = storage(sEm, 'vec3', sEm.count).toReadOnly()

  // Per-probe world positions (read by instanceIndex).
  const pp = new Float32Array(PROBE_COUNT * 3)
  for (let k = 0; k < G[2]; k++) for (let j = 0; j < G[1]; j++) for (let i = 0; i < G[0]; i++) {
    const w = probeWorld(i, j, k), idx = flatIndex(i, j, k)
    pp[idx * 3] = w[0]; pp[idx * 3 + 1] = w[1]; pp[idx * 3 + 2] = w[2]
  }
  const sPP = new THREE.StorageBufferAttribute(pp, 3)
  const ppS = storage(sPP, 'vec3', sPP.count).toReadOnly()

  // OUTPUT: 4 SH coeffs/probe, each a vec4 (rgb + pad). One writable storage buffer.
  const shOut = instancedArray(PROBE_COUNT * 4, 'vec4')

  const helpers = wgsl(WGSL_HELPERS + /* wgsl */`
    fn sphereSample(u: vec2f) -> vec3f {
      let z = 1.0 - 2.0*u.x; let r = sqrt(max(0.0, 1.0 - z*z));
      let phi = 6.2831853 * u.y; return vec3f(r*cos(phi), r*sin(phi), z);
    }`)

  // MOON → SH: splice the same exterior-directional cookie the shell rake uses into the probe gather,
  // projected onto SH-L1 as a delta light from wi=-moonDir (radiance E=moonRad·glass). SAME convention
  // as the neon NEE above (E·Y0, E·Y1·wi.{y,z,x}) so the scale matches. Gated by aperture+mask (vitrine/
  // door) and the interior-occluder shadow ray → the counter TOP + Rick + objects catch a cold rim while
  // the floor behind stays shadowed. Constants are interpolated as WGSL literals (no fragile arg binding).
  const F = (x: number) => { const s = String(x); return /[.e]/.test(s) ? s : s + '.0' }
  const hasMoon = moon ? 1 : 0
  const mImgW = moon?.maskTex?.image ? (moon.maskTex.image as { width: number }).width : 1
  const mImgH = moon?.maskTex?.image ? (moon.maskTex.image as { height: number }).height : 1
  const dRect = moon?.doorRect ?? [0, 0, 1, 1]
  const dSub = moon?.doorMaskSub ?? [0, 0, 1, 1]
  const hasDoor = moon?.doorRect && moon?.doorMaskSub ? 1 : 0
  const pScale = moon?.probeScale ?? 1 // probe rim needs more radiance than the floor rake (see MOONLIGHT.probeScale)
  const maskNode = moon ? texture(moon.maskTex) : null
  const moonSig = moon ? `, maskTex: texture_2d<f32>${Socc ? ', occIndex: ptr<storage, array<vec3u>, read>, occPos: ptr<storage, array<vec3f>, read>, occBvh: ptr<storage, array<BVHNode>, read>' : ''}` : ''
  const shadowSub = Socc ? `
            var sray = Ray(P, -moonDir);
            let shx = bvhIntersectFirstHit(occIndex, occPos, occBvh, sray);
            if (shx.didHit && shx.dist < (t - 0.05)) { gm = 0.0; }` : ''
  const moonBody = hasMoon ? `
      // ---- MOON (exterior directional via vitrine/door, gated by mask + interior shadow, → SH) ----
      {
        let moonDir = vec3f(${F(moon!.dir[0])}, ${F(moon!.dir[1])}, ${F(moon!.dir[2])});
        let moonRad = vec3f(${F(moon!.rad[0] * pScale)}, ${F(moon!.rad[1] * pScale)}, ${F(moon!.rad[2] * pScale)});
        let zWall = ${F(moon!.zWall)};
        let vwx=${F(moon!.winRect[0])}; let vwy=${F(moon!.winRect[1])}; let vww=${F(moon!.winRect[2])}; let vwh=${F(moon!.winRect[3])};
        let vsx=${F(moon!.maskSub[0])}; let vsy=${F(moon!.maskSub[1])}; let vssx=${F(moon!.maskSub[2])}; let vssy=${F(moon!.maskSub[3])};
        let dwx=${F(dRect[0])}; let dwy=${F(dRect[1])}; let dww=${F(dRect[2])}; let dwh=${F(dRect[3])};
        let dsx=${F(dSub[0])}; let dsy=${F(dSub[1])}; let dssx=${F(dSub[2])}; let dssy=${F(dSub[3])};
        let mw=${F(mImgW)}; let mh=${F(mImgH)}; let hasDoor=${F(hasDoor)};
        let denom = -moonDir.z;
        if (denom > 0.001) {
          let t = (zWall - P.z) / denom;
          if (t > 0.0) {
            let Pw = P - moonDir * t;
            var gm = 0.0;
            let un=(Pw.x-vwx)/vww; let vn=(Pw.y-vwy)/vwh;
            if (un>=0.0 && un<=1.0 && vn>=0.0 && vn<=1.0) {
              let um=vsx+(1.0-un)*vssx; let vm=vsy+(1.0-vn)*vssy;
              gm = textureLoad(maskTex, vec2i(i32(um*mw), i32(vm*mh)), 0).g;
            } else if (hasDoor > 0.5) {
              let dun=(Pw.x-dwx)/dww; let dvn=(Pw.y-dwy)/dwh;
              if (dun>=0.0 && dun<=1.0 && dvn>=0.0 && dvn<=1.0) {
                let dum=dsx+(1.0-dun)*dssx; let dvm=dsy+(1.0-dvn)*dssy;
                gm = textureLoad(maskTex, vec2i(i32(dum*mw), i32(dvm*mh)), 0).g;
              }
            }
            if (gm > 0.0) {${shadowSub}
              if (gm > 0.0) {
                let wi = -moonDir;
                let E = moonRad * gm;
                c0 = c0 + E * Y0;
                c1 = c1 + E * (Y1 * wi.y);
                c2 = c2 + E * (Y1 * wi.z);
                c3 = c3 + E * (Y1 * wi.x);
              }
            }
          }
        }
      }` : ''

  // Robust output path (verified the alternatives fail): a wgslFn returning a STRUCT is not
  // TSL-accessible (getStructTypeNode null), and writing to a storage buffer through a wgslFn
  // `ptr<storage,read_write>` param is a SILENT no-op. The ONLY proven primitives are: wgslFn→vec3
  // (radiosityBake) + TSL `.element().assign()` (persists). So the gather computes all 4 SH coeffs
  // and RETURNS the one selected by `coeff` (0..3); the Fn calls it 4× and writes each. 4× the
  // gather cost — fine offline (~0.7 s for 726 probes).
  const gather = wgslFn(/* wgsl */`
    fn probeGather(
      P: vec3f, coeff: f32, seed: vec2f, samples: f32, neeSamples: f32, emitterCount: f32,
      res: f32, sky: vec3f, clampDirect: f32,
      geom_index: ptr<storage, array<vec3u>, read>, geom_position: ptr<storage, array<vec3f>, read>,
      geom_uv1: ptr<storage, array<vec3f>, read>, bvh: ptr<storage, array<BVHNode>, read>,
      emitters: ptr<storage, array<vec3f>, read>, lightmap: texture_2d<f32>${moonSig},
    ) -> vec3f {
      let PI = 3.14159265; let Y0 = 0.282095; let Y1 = 0.488603;
      var c0 = vec3f(0.0); var c1 = vec3f(0.0); var c2 = vec3f(0.0); var c3 = vec3f(0.0);

      // ---- INDIRECT: full-sphere bounce reading the FINISHED Phase-1 lightmap (textureLoad = compute-legal) ----
      let S = i32(samples);
      for (var i = 0; i < S; i = i + 1) {
        let u = rndHash(seed, u32(i) + 13u);
        let wi = sphereSample(u);
        var ray = Ray(P, wi);
        var L = sky;
        let hit = bvhIntersectFirstHit(geom_index, geom_position, bvh, ray);
        if (hit.didHit) {
          let uvh = getVertexAttribute(hit.barycoord, hit.indices.xyz, geom_uv1);
          let px = vec2i(i32(uvh.x * res), i32(uvh.y * res));
          L = textureLoad(lightmap, px, 0).rgb;   // Phase-1 outgoing radiance (irradiance×albedo)
        }
        c0 = c0 + L * Y0;
        c1 = c1 + L * (Y1 * wi.y);
        c2 = c2 + L * (Y1 * wi.z);
        c3 = c3 + L * (Y1 * wi.x);
      }
      let w = (4.0 * PI) / f32(S);
      c0 = c0 * w; c1 = c1 * w; c2 = c2 * w; c3 = c3 * w;

      // ---- DIRECT (NEE): project the analytic neon contribution onto SH (probes near a small sign
      //      are sample-starved by uniform sphere sampling → this is effectively REQUIRED). ----
      let EC = i32(emitterCount); let NS = i32(neeSamples);
      for (var e = 0; e < EC; e = e + 1) {
        let b = u32(e) * 5u;
        let corner = emitters[b]; let e1 = emitters[b + 1u]; let e2 = emitters[b + 2u];
        let Le = emitters[b + 3u]; let facingRaw = emitters[b + 4u];
        let fexp = max(1.0, length(facingRaw));
        let facing = facingRaw / max(length(facingRaw), 1e-5);
        let area = length(cross(e1, e2));
        if (area <= 0.0) { continue; }
        for (var s = 0; s < NS; s = s + 1) {
          let r = rndHash(seed + vec2f(f32(e) * 0.7361, f32(e) * 0.1987), u32(s) + 91u);
          let xL = corner + r.x * e1 + r.y * e2;
          let d = xL - P; let dist2 = dot(d, d); let dist = sqrt(dist2); let wi = d / dist;
          let cosL = pow(max(0.0, -dot(facing, wi)), fexp); // lobe directionnel cos^f (focus enseignes)
          if (cosL <= 0.0) { continue; }
          var sray = Ray(P, wi);
          let sh = bvhIntersectFirstHit(geom_index, geom_position, bvh, sray);
          let occluded = sh.didHit && sh.dist < (dist - 0.01);
          if (!occluded) {
            let irr = clampRad(Le * cosL * area / dist2, clampDirect) / f32(NS);   // radiance arriving from the sign
            c0 = c0 + irr * Y0;
            c1 = c1 + irr * (Y1 * wi.y);
            c2 = c2 + irr * (Y1 * wi.z);
            c3 = c3 + irr * (Y1 * wi.x);
          }
        }
      }

${moonBody}
      if (coeff < 0.5) { return c0; }
      if (coeff < 1.5) { return c1; }
      if (coeff < 2.5) { return c2; }
      return c3;
    }`, [bvhIntersectFirstHit, getVertexAttribute, helpers])

  const lm = texture(lightmap)
  const kernel = Fn(() => {
    const idx = instanceIndex
    const P = ppS.element(idx)
    const seed = vec2(idx.toFloat(), idx.toFloat().mul(0.137))
    const common = {
      P, seed, samples: float(SAMPLES), neeSamples: float(NEE_SAMPLES), emitterCount: float(NE),
      res: float(lightmapRes), sky: vec3(sky[0], sky[1], sky[2]), clampDirect: float(clampDirect),
      geom_index: S.index, geom_position: S.position, geom_uv1: uv1S, bvh: S.bvh,
      emitters: emS, lightmap: lm,
      ...(maskNode ? { maskTex: maskNode } : {}),
      ...(Socc ? { occIndex: Socc.index, occPos: Socc.position, occBvh: Socc.bvh } : {}),
    }
    const base = idx.mul(4)
    // 4 gather calls (one per SH coeff) → write via .element().assign() (the persisting path).
    shOut.element(base).assign(vec4(gather({ ...common, coeff: float(0) }), 0))
    shOut.element(base.add(1)).assign(vec4(gather({ ...common, coeff: float(1) }), 0))
    shOut.element(base.add(2)).assign(vec4(gather({ ...common, coeff: float(2) }), 0))
    shOut.element(base.add(3)).assign(vec4(gather({ ...common, coeff: float(3) }), 0))
  })().compute(PROBE_COUNT)

  await renderer.computeAsync(kernel)

  // Readback: PROBE_COUNT*4 vec4 → split into 3 per-channel [L00,L1-1,L10,L11] arrays.
  // vec4 stride is exactly 4 floats (16 B) — no std430 ambiguity.
  const raw = new Float32Array(await renderer.getArrayBufferAsync(shOut.value))
  const r = new Float32Array(PROBE_COUNT * 4), g = new Float32Array(PROBE_COUNT * 4), b = new Float32Array(PROBE_COUNT * 4)
  for (let p = 0; p < PROBE_COUNT; p++) {
    for (let c = 0; c < 4; c++) {
      const v = (p * 4 + c) * 4 // vec4 base of coeff c of probe p
      r[p * 4 + c] = raw[v]; g[p * 4 + c] = raw[v + 1]; b[p * 4 + c] = raw[v + 2]
    }
  }
  return { r, g, b }
}

/** Per-channel raw arrays [L00,L1-1,L10,L11]×PROBE_COUNT → 3 Data3DTexture (RGBA = the 4 coeffs). */
export function packProbeVolumes(r: Float32Array, g: Float32Array, b: Float32Array) {
  const toHalf = THREE.DataUtils.toHalfFloat
  const pack = (ch: Float32Array): Uint16Array => {
    const out = new Uint16Array(PROBE_COUNT * 4)
    for (let p = 0; p < PROBE_COUNT; p++) {
      out[p * 4 + 0] = toHalf(ch[p * 4 + 0]) // L00  → .x
      out[p * 4 + 1] = toHalf(ch[p * 4 + 1]) // L1-1 → .y (pairs n.y)
      out[p * 4 + 2] = toHalf(ch[p * 4 + 2]) // L10  → .z (pairs n.z)
      out[p * 4 + 3] = toHalf(ch[p * 4 + 3]) // L11  → .w (pairs n.x)
    }
    return out
  }
  return { shR: makeProbeVolume(pack(r)), shG: makeProbeVolume(pack(g)), shB: makeProbeVolume(pack(b)) }
}
