# Phase 2 — SH-L1 Irradiance Probe Volume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Light the *dynamic / instanced* objects the Phase-1 lightmap cannot reach — ~520 instanced K7 cassettes, the instanced shelf planks, the manager NPC and the TV body — by baking an **SH-L1 irradiance probe volume** with the SAME WebGPU/TSL BVH gather, and sampling it per-vertex at runtime.

**Architecture:** A 3D grid of probes (room + 0.5 m margin). One WebGPU **compute kernel** runs a full-sphere Monte-Carlo gather per probe against the existing BVH (`gpuStorages`), accumulating **two** terms onto SH-L1: the **direct** neon NEE (emitter rects) and the **indirect** bounce read from the FINISHED Phase-1 lightmap treated as the static surfaces' outgoing radiance. The 4 raw SH-L1 coefficients per colour channel are read back, dead probes (inside islands/comptoir) are flood-filled, and the result is uploaded into **3 `Data3DTexture` RGBA16F** volumes (LinearFilter + HalfFloat — the load-bearing "Trap 1" fix). Receivers sample the 3 volumes trilinearly in the **vertex stage** and reconstruct irradiance `E(n)` from their world normal, added to their material as an emissive diffuse term. Everything is gated behind the existing `?baked=1` flag and runs after the shell bake.

**Tech Stack:** three 0.184 (`three/webgpu`, `three/tsl`), `three-mesh-bvh/webgpu`, React Three Fiber 9.5. Node test runner for the pure-JS unit tests (same harness as Phase 1, `tests/lightbake/*.test.mjs`).

---

## ⚠️ Gate & assumptions (read before starting)

- **M1 FPS gate is ASSUMED, not measured.** The design (`docs/superpowers/specs/2026-05-29-neon-noir-baked-lighting-design.md` §6.2) conditions Phase 2 on Phase-1 M1 passing with FPS margin. The shell A/B (commit `6fa0826`) validated Phase-1 *visually* but the FPS-with-margin number on the Mac Mini M1 was NOT taken. This plan sizes the runtime cost to that assumption (per-vertex SH on ~520 K7 + planks). **Task 12 (M2 gate) MUST measure FPS;** if margin is thin, coarsen the grid (Task 1 knob) and/or drop planks/manager/TV from v1.
- **This plan depends on Phase-1 output at runtime:** the probe bake reads the attached shell lightmap. It extends `BakedShellLighting` (commit `6fa0826`) to run *after* `bakeAndAttachShell` resolves.
- **Reconciled contracts** (the derisk agents disagreed; these are the locked choices — do not silently change one side):
  - **SH storage = by COLOUR CHANNEL.** 3 `Data3DTexture` `shR/shG/shB`. Each RGBA16F texel holds ONE channel's 4 raw SH-L1 coefficients: `.x=L00`, `.y=L1(-1)` (pairs with `n.y`), `.z=L10` (pairs with `n.z`), `.w=L11` (pairs with `n.x`).
  - **SH math = raw coeffs at bake, scale at runtime.** Bake projects `L_lm = (4π/N)·Σ L(ω)·Y_lm(ω)` with `Y00=0.282095`, `Y1m=0.488603·(y,z,x)`. Runtime reconstructs `E_c(n) = max(0, c0·tex.x + c1·dot(tex.yzw, vec3(n.y,n.z,n.x)))` with `c0=0.886227 (=π·0.282095)`, `c1=1.023327 (=2π/3·0.488603)`. The lit term is `albedo · E(n) · PROBE_INTENSITY` — `PROBE_INTENSITY` is a calibrated uniform (starts ≈ `1/π` ≈ 0.318) because the exact irradiance↔exitance π factor is a visual-calibration knob, not a constant to argue about (Task 12).
  - **Grid = 11×6×11 = 726 probes**, room ±0.5 m margin, half-texel uvw remap (Task 1). Coarsening knob documented.
  - **K7 injection = emissive add**, NOT colorNode multiply (colorNode×irradiance renders black when the rig is dropped and no lights remain — the exact failure mode of baked mode). `mat.emissiveNode += cappedColor.mul(E).mul(PROBE_INTENSITY)`.

---

## ✅ AS-BUILT STATUS (30/05) — T1–T9 DONE, K7 LIT; corrections vs the sketches below

**Executed inline this session: T1→T9 committed (`3f32c45`→`4bb3a9f`), T10–T12 REMAIN.** The ~520 instanced K7 are lit by the baked SH GI (user-confirmed); `/probe-guard` PASS; 20/20 node tests; no regression. Resume: `?baked=1` (tune `&pi=`, default 1.2).

**⚠️ THREE CORRECTIONS the original task sketches below got WRONG — a T10–T12 executor MUST use the as-built code, not the verbatim sketches:**
1. **Task 4's compute output (the sketch wrote SH via a `wgslFn` `ptr<storage,read_write>` param) is a SILENT NO-OP** in three 0.184 — the buffer stays all-zero, no error. AND a `wgslFn` returning a WGSL-string `struct` is NOT TSL-accessible (`getStructTypeNode` null). **As-built (`probeBake.ts`):** the gather `wgslFn` RETURNS `vec3` = the SH coeff selected by a `coeff: f32` param; the `Fn` calls it **4× per probe** and writes via `shOut.element(i).assign(vec4(c,0))` (the ONLY persisting path). Readback `getArrayBufferAsync(shOut.value)` then works. Output buffer is `vec4` (not vec3) to dodge std430 16-B padding.
2. **Task 5's dead-probe AABBs:** as-built filters `collectShell` occluders to **non-InstancedMesh, volume 0.2–6 m³** (else `Box3.setFromObject` on the 520-instance K7 mesh spans the whole room → kills the volume). 8 boxes, 12 dead probes flood-filled.
3. **Task 7/8 publish:** `onProbeVolumes` must fire UNCONDITIONALLY — the sketch's `if(!cancelled)` drops it under React StrictMode's double-mount (cleanup flips `cancelled=true`, 2nd mount returns early on `ranRef`). K7 SH is evaluated **vertex-stage via `varying()`** (instanceIndex is vertex-only); per-instance world pos via `worldPosBuf.element(instanceIndex)` (no vertex-buffer slot, budget was 7/8).

**For T10 (planks):** copy the K7 pattern exactly — `useProbeVolumes()`, per-vertex/instance world pos, `shIrradiance(shR,shG,shB,uvw,normalWorld)` added to a node material's emissive, gated on `probes!=null`, `?pi` intensity. WallShelf/IslandShelf use `MeshStandardMaterial` → convert to `MeshStandardNodeMaterial` (or reuse the K7 helper). **For T12 (M2):** the `coeff`-selector gather is 4× the BVH cost (~0.3 s, fine offline) — fine; if M1 FPS is thin, coarsen the grid (`probeGrid.G → [9,5,9]`).

---

## File Structure

| File | Responsibility | Create/Modify |
|---|---|---|
| `src/lib/lightbake/probeGrid.ts` | Pure grid math: bounds, `probeWorld(i,j,k)`, `worldToUvwHalfTexel`, flat-index helpers, SH pack/unpack contract constants. No GPU. | Create |
| `src/lib/lightbake/shReconstruct.ts` | Shared TSL helper `shIrradiance(shR, shG, shB, uvwNode, normalNode)` → `vec3` irradiance, and `makeProbeVolume(data, G)` (the Trap-1 `Data3DTexture` factory). | Create |
| `src/lib/lightbake/probeBake.ts` | The compute kernel (sphere gather + NEE direct + lightmap-as-emitter, SH-L1 projection), readback, dead-probe flood-fill, → 3 `Data3DTexture`. Reuses `gpuStorages`, `emissiveRig`, `WGSL_HELPERS`. | Create |
| `src/components/interior/BakedShellLighting.tsx` | After the shell bake, run `probeBake`, store the 3 volumes in a context/store so receivers can read them. | Modify |
| `src/components/interior/ProbeVolumeContext.tsx` | A tiny React context carrying `{shR,shG,shB,ready}` from the baker to the receivers. | Create |
| `src/components/interior/CassetteInstances.tsx` | Inject per-vertex SH irradiance into the K7 material (primary receiver). | Modify |
| `src/components/interior/WallShelf.tsx`, `IslandShelf.tsx` | Inject SH into the instanced plank materials (secondary). | Modify |
| `src/components/interior/Manager3D.tsx`, `InteractiveTVDisplay.tsx` | Flat single-tap SH on the manager + TV body (optional, lowest priority). | Modify |
| `tests/lightbake/probe-grid.test.mjs` | World↔uvw roundtrip, flat-index, asymmetric-corner, pack/unpack. | Create |
| `tests/lightbake/sh-projection.test.mjs` | Directional-emitter → reconstructed `E(n)` peaks toward the emitter (the math contract). | Create |

---

## Task 1: Probe grid math (pure, TDD)

**Files:**
- Create: `src/lib/lightbake/probeGrid.ts`
- Test: `tests/lightbake/probe-grid.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/lightbake/probe-grid.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { G, PROBE_COUNT, probeWorld, worldToUvwHalfTexel, flatIndex } from '../../src/lib/lightbake/probeGrid.ts'

test('grid is 11×6×11 = 726 probes', () => {
  assert.deepEqual(G, [11, 6, 11])
  assert.equal(PROBE_COUNT, 726)
})

test('flatIndex matches x + y*GX + z*GX*GY', () => {
  assert.equal(flatIndex(0, 0, 0), 0)
  assert.equal(flatIndex(1, 0, 0), 1)
  assert.equal(flatIndex(0, 1, 0), 11)
  assert.equal(flatIndex(0, 0, 1), 66)
  assert.equal(flatIndex(10, 5, 10), 725)
})

test('probeWorld(i) → worldToUvwHalfTexel round-trips to the probe texel centre', () => {
  // probe (i,j,k) world centre, mapped back, must land on (i+0.5)/G per axis
  for (const [i, j, k] of [[0,0,0],[5,3,5],[10,5,10]]) {
    const w = probeWorld(i, j, k)
    const uvw = worldToUvwHalfTexel(w)
    assert.ok(Math.abs(uvw[0] - (i + 0.5) / G[0]) < 1e-6, `u ${uvw[0]}`)
    assert.ok(Math.abs(uvw[1] - (j + 0.5) / G[1]) < 1e-6, `v ${uvw[1]}`)
    assert.ok(Math.abs(uvw[2] - (k + 0.5) / G[2]) < 1e-6, `w ${uvw[2]}`)
  }
})

test('worldToUvwHalfTexel clamps a point past the margin into [halfTexel, 1-halfTexel]', () => {
  const uvw = worldToUvwHalfTexel([100, 100, 100])
  assert.ok(uvw[0] <= 1 - 0.5 / G[0] + 1e-9 && uvw[0] >= 0.5 / G[0] - 1e-9)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/lightbake/probe-grid.test.mjs`
Expected: FAIL — `probeGrid.ts` does not exist / exports undefined.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/lightbake/probeGrid.ts
import { ROOM_WIDTH, ROOM_DEPTH, ROOM_HEIGHT } from '../../components/interior/constants'

// Room ±0.5 m margin so a receiver anywhere inside the walls has a full 8-cell trilinear stencil.
const MARGIN = 0.5
export const GRID_MIN: readonly [number, number, number] = [-ROOM_WIDTH / 2 - MARGIN, -MARGIN, -ROOM_DEPTH / 2 - MARGIN]
export const GRID_MAX: readonly [number, number, number] = [ROOM_WIDTH / 2 + MARGIN, ROOM_HEIGHT + MARGIN, ROOM_DEPTH / 2 + MARGIN]

// Literal spec spacing ≈ 1.0 m XZ / 0.7 m Y over the margined extent → 11×6×11.
// COARSENING KNOB (if M2 FPS margin is thin): drop to [9,5,9]=405 by widening spacing.
export const G: readonly [number, number, number] = [11, 6, 11]
export const PROBE_COUNT = G[0] * G[1] * G[2]

export const gridExt = (): [number, number, number] => [GRID_MAX[0] - GRID_MIN[0], GRID_MAX[1] - GRID_MIN[1], GRID_MAX[2] - GRID_MIN[2]]

export const flatIndex = (i: number, j: number, k: number): number => i + j * G[0] + k * G[0] * G[1]

/** World centre of probe (i,j,k). Half-texel: probe i sits at (i+0.5)/G of the extent. */
export function probeWorld(i: number, j: number, k: number): [number, number, number] {
  const e = gridExt()
  return [GRID_MIN[0] + ((i + 0.5) / G[0]) * e[0], GRID_MIN[1] + ((j + 0.5) / G[1]) * e[1], GRID_MIN[2] + ((k + 0.5) / G[2]) * e[2]]
}

/** World point → [0,1]³ texture uvw, landing trilinear weights on the 8 surrounding probe centres. */
export function worldToUvwHalfTexel(p: readonly [number, number, number]): [number, number, number] {
  const e = gridExt()
  const out: [number, number, number] = [0, 0, 0]
  for (let a = 0; a < 3; a++) {
    const f = (p[a] - GRID_MIN[a]) / e[a]               // 0..1 across probe centres at the extremes
    const half = 0.5 / G[a]
    out[a] = Math.min(1 - half, Math.max(half, f * (1 - 1 / G[a]) + half))
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/lightbake/probe-grid.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/lightbake/probeGrid.ts tests/lightbake/probe-grid.test.mjs
git commit -m "feat(lightbake): Phase-2 probe grid math (11×6×11, half-texel uvw) + tests"
```

---

## Task 2: SH-L1 projection math + pack/unpack contract (pure, TDD)

This locks the bake↔runtime contract in plain JS so a test proves the lobe points the right way BEFORE any GPU code.

**Files:**
- Modify: `src/lib/lightbake/probeGrid.ts` (add SH helpers)
- Test: `tests/lightbake/sh-projection.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/lightbake/sh-projection.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { projectSampleL1, finalizeL1, reconstructE } from '../../src/lib/lightbake/probeGrid.ts'

// A single bright sample coming FROM +X (direction the probe sees light) must make
// reconstructed irradiance peak for a normal pointing +X and trough for -X.
test('SH-L1 lobe points toward the lit direction', () => {
  const acc = { c0: [0,0,0], c1: [0,0,0], c2: [0,0,0], c3: [0,0,0] } // L00, L1-1, L10, L11 (rgb each)
  const N = 256
  // one strong white sample from +X, rest dark — approximate by weighting one dir heavily
  for (let i = 0; i < N; i++) {
    const dir = i === 0 ? [1, 0, 0] : [0, 0, 0]
    const L = i === 0 ? [N, N, N] : [0, 0, 0] // compensate the 1/N so the single sample dominates
    projectSampleL1(acc, dir, L)
  }
  finalizeL1(acc, N)
  const ePlusX  = reconstructE(acc, [1, 0, 0])
  const eMinusX = reconstructE(acc, [-1, 0, 0])
  assert.ok(ePlusX[0] > eMinusX[0], `E(+X).r ${ePlusX[0]} should exceed E(-X).r ${eMinusX[0]}`)
  assert.ok(ePlusX[0] > 0, 'lit side positive')
  assert.ok(eMinusX[0] >= 0, 'reconstruct clamps at 0 (no negative irradiance)')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/lightbake/sh-projection.test.mjs`
Expected: FAIL — `projectSampleL1` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `probeGrid.ts`)

```ts
// ── SH-L1 projection/reconstruction contract (the bake↔runtime math, mirrored in TSL) ──
const Y00 = 0.282095, Y1 = 0.488603       // real SH basis constants
const A0c0 = Math.PI * Y00                // 0.886227  (cosine-lobe band-0 × basis)
const A1c1 = (2 * Math.PI / 3) * Y1       // 1.023327  (cosine-lobe band-1 × basis)

type Acc = { c0: number[]; c1: number[]; c2: number[]; c3: number[] }

/** Accumulate one radiance sample L coming from direction dir (unit) onto raw L1 coeffs. */
export function projectSampleL1(acc: Acc, dir: number[], L: number[]): void {
  for (let ch = 0; ch < 3; ch++) {
    acc.c0[ch] += L[ch] * Y00              // L00
    acc.c1[ch] += L[ch] * Y1 * dir[1]      // L1-1 ∝ y
    acc.c2[ch] += L[ch] * Y1 * dir[2]      // L10  ∝ z
    acc.c3[ch] += L[ch] * Y1 * dir[0]      // L11  ∝ x
  }
}

/** Finalize the Monte-Carlo estimator: × 4π/N (full sphere). */
export function finalizeL1(acc: Acc, n: number): void {
  const w = (4 * Math.PI) / n
  for (let ch = 0; ch < 3; ch++) { acc.c0[ch] *= w; acc.c1[ch] *= w; acc.c2[ch] *= w; acc.c3[ch] *= w }
}

/** Reconstruct irradiance E(n) per channel from raw L1 coeffs. Mirrors the TSL runtime. */
export function reconstructE(acc: Acc, n: number[]): number[] {
  const out = [0, 0, 0]
  for (let ch = 0; ch < 3; ch++) {
    const e = A0c0 * acc.c0[ch] + A1c1 * (acc.c1[ch] * n[1] + acc.c2[ch] * n[2] + acc.c3[ch] * n[0])
    out[ch] = Math.max(0, e)
  }
  return out
}

export const SH_RUNTIME_C0 = A0c0   // exported so the TSL helper uses the SAME constants
export const SH_RUNTIME_C1 = A1c1
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/lightbake/sh-projection.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/lightbake/probeGrid.ts tests/lightbake/sh-projection.test.mjs
git commit -m "feat(lightbake): SH-L1 projection/reconstruction contract + directional-lobe test"
```

---

## Task 3: Trap-1 `Data3DTexture` factory + TSL reconstruction helper

**Files:**
- Create: `src/lib/lightbake/shReconstruct.ts`

- [ ] **Step 1: Write the factory + helper** (no separate unit test — verified by the build-guard in Task 7 and the visual M-gate; this is GPU glue)

```ts
// src/lib/lightbake/shReconstruct.ts
import * as THREE from 'three/webgpu'
import { texture3D, vec3, dot, max, float, Fn } from 'three/tsl'
import { G } from './probeGrid.ts'
import { SH_RUNTIME_C0, SH_RUNTIME_C1 } from './probeGrid.ts'

/**
 * Create one channel's SH-L1 volume. TRAP 1 (verified vs three 0.184): Data3DTexture defaults to
 * NearestFilter → WGSLNodeBuilder.isUnfilterable() true → texture3D().sample() compiles to
 * textureLoad (point sample) → banding. LinearFilter + HalfFloatType (RGBA16F is always filterable;
 * NOT FloatType 32-bit) flips it to textureSample(Level). half = Uint16 half-float RGBA data.
 */
export function makeProbeVolume(half: Uint16Array): THREE.Data3DTexture {
  const t = new THREE.Data3DTexture(half, G[0], G[1], G[2]) // width=X, height=Y, depth=Z
  t.format = THREE.RGBAFormat
  t.type = THREE.HalfFloatType
  t.minFilter = THREE.LinearFilter
  t.magFilter = THREE.LinearFilter
  t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping
  t.generateMipmaps = false
  t.colorSpace = THREE.NoColorSpace
  t.needsUpdate = true
  return t
}

const C0 = float(SH_RUNTIME_C0)
const C1 = float(SH_RUNTIME_C1)

/**
 * TSL: trilinearly sample the 3 channel volumes at `uvwNode` and reconstruct per-channel irradiance
 * E(n) from world normal `nNode`. .sample() (no Load) → textureSampleLevel in the vertex stage.
 * Each texel = (.x=L00, .yzw=(L1-1,L10,L11)); L1 pairs with (n.y, n.z, n.x).
 */
export const shIrradiance = Fn(([shR, shG, shB, uvwNode, nNode]) => {
  const cr = texture3D(shR, uvwNode).sample()
  const cg = texture3D(shG, uvwNode).sample()
  const cb = texture3D(shB, uvwNode).sample()
  const nSwz = vec3(nNode.y, nNode.z, nNode.x)
  const r = max(float(0), cr.x.mul(C0).add(dot(cr.yzw, nSwz).mul(C1)))
  const g = max(float(0), cg.x.mul(C0).add(dot(cg.yzw, nSwz).mul(C1)))
  const b = max(float(0), cb.x.mul(C0).add(dot(cb.yzw, nSwz).mul(C1)))
  return vec3(r, g, b)
})
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0 (the TSL imports resolve; `texture3D`/`Fn`/`dot` are declared in `src/types/three-webgpu.d.ts` — add any missing export there if tsc complains).

- [ ] **Step 3: Commit**

```bash
git add src/lib/lightbake/shReconstruct.ts
git commit -m "feat(lightbake): Trap-1 Data3DTexture factory + TSL SH-L1 reconstruction helper"
```

---

## Task 4: Probe-bake compute kernel — sphere gather + NEE direct + lightmap-as-emitter

The core. Reuses `gpuStorages`, the emitter packing, and the Phase-1 lightmap. **Avoids `ptr<function>` out-params** (unproven) by writing SH straight into the output storage buffers, indexed by `instanceIndex` (the proven `radiosityBake` pattern).

**Files:**
- Create: `src/lib/lightbake/probeBake.ts`

- [ ] **Step 1: Write the kernel + readback** (read `radiosityBake.ts:44-140` and `bvhGpu.ts:71-98` first; mirror the storage/emitter setup verbatim)

```ts
// src/lib/lightbake/probeBake.ts
import * as THREE from 'three/webgpu'
import { wgsl, wgslFn, Fn, instanceIndex, instancedArray, storage, texture, uniform, vec3, vec2, float } from 'three/tsl'
import { bvhIntersectFirstHit, getVertexAttribute } from 'three-mesh-bvh/webgpu'
import type { MeshBVH } from 'three-mesh-bvh'
import { gpuStorages, WGSL_HELPERS } from './bvhGpu.ts'
import { G, PROBE_COUNT, probeWorld, flatIndex } from './probeGrid.ts'
import type { NeeEmitter } from './radiosityBake.ts'

const SAMPLES = 256        // full-sphere rays per probe
const NEE_SAMPLES = 8      // shadow rays per emitter (direct neon, projected to SH too)

/** Bake raw SH-L1 (4 coeffs × rgb) per probe. Returns 3 Float32Arrays (one per colour channel),
 *  each length PROBE_COUNT*4 = (L00,L1-1,L10,L11). Caller flood-fills + uploads (Tasks 5/6). */
export async function probeBakeRaw(
  renderer: THREE.WebGPURenderer,
  bvhGeometry: THREE.BufferGeometry,
  bvh: MeshBVH,
  lightmap: THREE.Texture,
  lightmapRes: number,
  emitters: ReadonlyArray<NeeEmitter>,
  sky: [number, number, number] = [0.008, 0.012, 0.025],
): Promise<{ r: Float32Array; g: Float32Array; b: Float32Array }> {
  const S = gpuStorages(bvhGeometry, bvh)

  // uv1 packed vec3 (z=0) — IDENTICAL to radiosityBake.ts:47-52.
  const uv1Attr = bvhGeometry.getAttribute('uv1')
  const u1 = new Float32Array(uv1Attr.count * 3)
  for (let i = 0; i < uv1Attr.count; i++) { u1[i * 3] = uv1Attr.getX(i); u1[i * 3 + 1] = uv1Attr.getY(i) }
  const sUv1 = new THREE.StorageBufferAttribute(u1, 3)
  const uv1S = storage(sUv1, 'vec3', sUv1.count).toReadOnly()

  // emitter rects 5×vec3 — IDENTICAL to radiosityBake.ts:55-66.
  const NE = Math.max(1, emitters.length)
  const ed = new Float32Array(NE * 15)
  emitters.forEach((em, i) => {
    const o = i * 15, r = em.rect
    ed[o]=r.corner[0];ed[o+1]=r.corner[1];ed[o+2]=r.corner[2]
    ed[o+3]=r.edge1[0];ed[o+4]=r.edge1[1];ed[o+5]=r.edge1[2]
    ed[o+6]=r.edge2[0];ed[o+7]=r.edge2[1];ed[o+8]=r.edge2[2]
    ed[o+9]=em.emission[0];ed[o+10]=em.emission[1];ed[o+11]=em.emission[2]
    ed[o+12]=r.facing[0];ed[o+13]=r.facing[1];ed[o+14]=r.facing[2]
  })
  const sEm = new THREE.StorageBufferAttribute(ed, 3)
  const emS = storage(sEm, 'vec3', sEm.count).toReadOnly()

  // Per-probe world positions (storage buffer, read by instanceIndex).
  const pp = new Float32Array(PROBE_COUNT * 3)
  for (let k = 0; k < G[2]; k++) for (let j = 0; j < G[1]; j++) for (let i = 0; i < G[0]; i++) {
    const w = probeWorld(i, j, k), idx = flatIndex(i, j, k)
    pp[idx * 3] = w[0]; pp[idx * 3 + 1] = w[1]; pp[idx * 3 + 2] = w[2]
  }
  const sPP = new THREE.StorageBufferAttribute(pp, 3)
  const ppS = storage(sPP, 'vec3', sPP.count).toReadOnly()

  // OUTPUT: 4 vec3 coeffs/probe → one instancedArray(PROBE_COUNT*4,'vec3'); layout [c0,c1,c2,c3] per probe.
  const shOut = instancedArray(PROBE_COUNT * 4, 'vec3')

  const helpers = wgsl(WGSL_HELPERS + /* wgsl */`
    fn sphereSample(u: vec2f) -> vec3f {
      let z = 1.0 - 2.0*u.x; let r = sqrt(max(0.0, 1.0 - z*z));
      let phi = 6.2831853 * u.y; return vec3f(r*cos(phi), r*sin(phi), z);
    }`)

  // The gather writes its 4 SH coeffs straight into shOut[base..base+3] (no ptr<function> out-params).
  const gather = wgslFn(/* wgsl */`
    fn probeGather(
      P: vec3f, base: u32, seed: vec2f, samples: f32, neeSamples: f32, emitterCount: f32,
      res: f32, sky: vec3f,
      geom_index: ptr<storage, array<vec3u>, read>, geom_position: ptr<storage, array<vec3f>, read>,
      geom_uv1: ptr<storage, array<vec3f>, read>, bvh: ptr<storage, array<BVHNode>, read>,
      emitters: ptr<storage, array<vec3f>, read>, lightmap: texture_2d<f32>,
      shOut: ptr<storage, array<vec3f>, read_write>,
    ) -> void {
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
          L = textureLoad(lightmap, px, 0).rgb;       // Phase-1 outgoing radiance (irradiance×albedo)
        }
        c0 = c0 + L * Y0;
        c1 = c1 + L * (Y1 * wi.y);
        c2 = c2 + L * (Y1 * wi.z);
        c3 = c3 + L * (Y1 * wi.x);
      }
      let w = (4.0 * PI) / f32(S);
      c0 = c0 * w; c1 = c1 * w; c2 = c2 * w; c3 = c3 * w;

      // ---- DIRECT (NEE): project the analytic neon contribution onto SH so probes near a small
      //      sign aren't sample-starved. For each emitter, sample its rect, shadow-ray, and add the
      //      unshadowed radiance along the probe→light direction. (Mirrors radiosityBake.ts:88-117.)
      let EC = i32(emitterCount); let NS = i32(neeSamples);
      for (var e = 0; e < EC; e = e + 1) {
        let b = u32(e) * 5u;
        let corner = emitters[b]; let e1 = emitters[b+1u]; let e2 = emitters[b+2u];
        let Le = emitters[b+3u]; let facing = emitters[b+4u];
        let area = length(cross(e1, e2));
        if (area <= 0.0) { continue; }
        for (var s = 0; s < NS; s = s + 1) {
          let r = rndHash(seed + vec2f(f32(e)*0.7361, f32(e)*0.1987), u32(s) + 91u);
          let xL = corner + r.x*e1 + r.y*e2;
          let d = xL - P; let dist2 = dot(d, d); let dist = sqrt(dist2); let wi = d / dist;
          let cosL = max(0.0, -dot(facing, wi));
          if (cosL <= 0.0) { continue; }
          var sray = Ray(P, wi);
          let sh = bvhIntersectFirstHit(geom_index, geom_position, bvh, sray);
          let occluded = sh.didHit && sh.dist < (dist - 0.01);
          if (!occluded) {
            let irr = Le * cosL * area / dist2 / f32(NS);   // radiance arriving from the sign
            c0 = c0 + irr * Y0;
            c1 = c1 + irr * (Y1 * wi.y);
            c2 = c2 + irr * (Y1 * wi.z);
            c3 = c3 + irr * (Y1 * wi.x);
          }
        }
      }

      shOut[base + 0u] = c0; shOut[base + 1u] = c1; shOut[base + 2u] = c2; shOut[base + 3u] = c3;
    }`, [bvhIntersectFirstHit, getVertexAttribute, helpers])

  const lm = texture(lightmap)
  const kernel = Fn(() => {
    const idx = instanceIndex
    const P = ppS.element(idx)
    gather({
      P, base: idx.mul(4), seed: vec2(idx.toFloat(), idx.toFloat().mul(0.137)),
      samples: float(SAMPLES), neeSamples: float(NEE_SAMPLES), emitterCount: float(NE),
      res: float(lightmapRes), sky: vec3(sky[0], sky[1], sky[2]),
      geom_index: S.index, geom_position: S.position, geom_uv1: uv1S, bvh: S.bvh,
      emitters: emS, lightmap: lm, shOut,
    })
  })().compute(PROBE_COUNT)

  await renderer.computeAsync(kernel)

  // Readback: PROBE_COUNT*4 vec3 → split into 3 per-channel [L00,L1-1,L10,L11] arrays.
  const raw = new Float32Array(await renderer.getArrayBufferAsync(shOut.value as unknown as THREE.StorageInstancedBufferAttribute))
  const r = new Float32Array(PROBE_COUNT * 4), g = new Float32Array(PROBE_COUNT * 4), b = new Float32Array(PROBE_COUNT * 4)
  for (let p = 0; p < PROBE_COUNT; p++) {
    for (let c = 0; c < 4; c++) {
      const v = (p * 4 + c) * 3                   // vec3 stride in the readback (16B-aligned vec3→4 floats? see risk)
      r[p * 4 + c] = raw[v]; g[p * 4 + c] = raw[v + 1]; b[p * 4 + c] = raw[v + 2]
    }
  }
  return { r, g, b }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0. (If `computeAsync`/`getArrayBufferAsync`/`StorageInstancedBufferAttribute` are missing from `src/types/three-webgpu.d.ts`, add them — same pattern Phase-1 used for `wgslFn`.)

- [ ] **Step 3: Verify the readback stride empirically (vec3 in a storage buffer may be 16-byte aligned).**

WebGPU std430 pads `vec3<f32>` to 16 bytes in arrays. The `getArrayBufferAsync` Float32 view stride per vec3 may be **4 floats, not 3**. Add a one-off assert run (temporary log in `BakedShellLighting` Task 8): log `raw.length` and confirm it equals `PROBE_COUNT*4*4` (16B) vs `PROBE_COUNT*4*3` (12B). If 16B, change the unpack `const v = (p*4+c)*4`. **Do not assume — measure once, then fix the stride constant.**

- [ ] **Step 4: Commit**

```bash
git add src/lib/lightbake/probeBake.ts
git commit -m "feat(lightbake): Phase-2 probe-bake compute kernel (sphere gather + NEE direct, SH-L1)"
```

---

## Task 5: Dead-probe classify + flood-fill (pure, TDD)

Probes buried in the islands/comptoir gather black and would darken the K7 on the island faces via trilinear. Classify from the **live occluder AABBs** (not hard-coded), then Jacobi flood-fill from valid neighbours.

**Files:**
- Modify: `src/lib/lightbake/probeBake.ts` (export `floodFillDeadProbes`)
- Test: `tests/lightbake/probe-grid.test.mjs` (add a flood-fill case)

- [ ] **Step 1: Write the failing test** (append)

```js
import { floodFillDeadProbes } from '../../src/lib/lightbake/probeBake.ts'
import { PROBE_COUNT, flatIndex } from '../../src/lib/lightbake/probeGrid.ts'

test('floodFill replaces a dead probe with its valid neighbour average', () => {
  const r = new Float32Array(PROBE_COUNT * 4).fill(1.0) // all probes = 1.0
  const valid = new Uint8Array(PROBE_COUNT).fill(1)
  const dead = flatIndex(5, 3, 5)
  for (let c = 0; c < 4; c++) r[dead * 4 + c] = 0       // dead probe = black
  valid[dead] = 0
  floodFillDeadProbes([r], valid)
  assert.ok(Math.abs(r[dead * 4] - 1.0) < 1e-6, `dead probe filled to ${r[dead * 4]}`)
  assert.equal(valid[dead], 1, 'now marked valid')
})
```

- [ ] **Step 2: Run → FAIL** (`floodFillDeadProbes` not exported).

- [ ] **Step 3: Implement** (append to `probeBake.ts`)

```ts
import { G, flatIndex as fIdx } from './probeGrid.ts'

/** Jacobi flood-fill: each dead probe ← mean of its valid 6-neighbours, iterated until none remain. */
export function floodFillDeadProbes(channels: Float32Array[], valid: Uint8Array, maxPasses = 8): void {
  const nb = [[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]]
  for (let pass = 0; pass < maxPasses; pass++) {
    let filled = 0
    const next = valid.slice()
    for (let k = 0; k < G[2]; k++) for (let j = 0; j < G[1]; j++) for (let i = 0; i < G[0]; i++) {
      const idx = fIdx(i, j, k)
      if (valid[idx]) continue
      let n = 0
      const sum = channels.map(() => [0, 0, 0, 0])
      for (const [di, dj, dk] of nb) {
        const ii = i + di, jj = j + dj, kk = k + dk
        if (ii < 0 || ii >= G[0] || jj < 0 || jj >= G[1] || kk < 0 || kk >= G[2]) continue
        const nIdx = fIdx(ii, jj, kk)
        if (!valid[nIdx]) continue
        n++
        channels.forEach((ch, c) => { for (let q = 0; q < 4; q++) sum[c][q] += ch[nIdx * 4 + q] })
      }
      if (n > 0) {
        channels.forEach((ch, c) => { for (let q = 0; q < 4; q++) ch[idx * 4 + q] = sum[c][q] / n })
        next[idx] = 1; filled++
      }
    }
    next.forEach((v, i) => { valid[i] = v })
    if (filled === 0) break
  }
}

/** Mark probes whose centre is inside any occluder AABB (from collectShell occluders) as dead. */
export function classifyDeadProbes(occluderBoxes: { min: number[]; max: number[] }[]): Uint8Array {
  const valid = new Uint8Array(PROBE_COUNT).fill(1)
  for (let k = 0; k < G[2]; k++) for (let j = 0; j < G[1]; j++) for (let i = 0; i < G[0]; i++) {
    const w = probeWorld(i, j, k)
    const inside = occluderBoxes.some((b) =>
      w[0] >= b.min[0] && w[0] <= b.max[0] && w[1] >= b.min[1] && w[1] <= b.max[1] && w[2] >= b.min[2] && w[2] <= b.max[2])
    if (inside) valid[fIdx(i, j, k)] = 0
  }
  return valid
}
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/lib/lightbake/probeBake.ts tests/lightbake/probe-grid.test.mjs
git commit -m "feat(lightbake): dead-probe classify (live occluder AABBs) + Jacobi flood-fill + test"
```

---

## Task 6: Pack raw SH → 3 half-float `Data3DTexture` (by colour channel)

**Files:**
- Modify: `src/lib/lightbake/probeBake.ts` (export `packProbeVolumes`)

- [ ] **Step 1: Implement**

```ts
import { makeProbeVolume } from './shReconstruct.ts'

/** Per-channel raw arrays [L00,L1-1,L10,L11]×PROBE_COUNT → 3 Data3DTexture (RGBA = the 4 coeffs). */
export function packProbeVolumes(r: Float32Array, g: Float32Array, b: Float32Array) {
  const toHalf = THREE.DataUtils.toHalfFloat
  const pack = (ch: Float32Array): Uint16Array => {
    const out = new Uint16Array(PROBE_COUNT * 4)
    for (let p = 0; p < PROBE_COUNT; p++) {
      out[p * 4 + 0] = toHalf(ch[p * 4 + 0]) // L00 → .x
      out[p * 4 + 1] = toHalf(ch[p * 4 + 1]) // L1-1 → .y (pairs n.y)
      out[p * 4 + 2] = toHalf(ch[p * 4 + 2]) // L10  → .z (pairs n.z)
      out[p * 4 + 3] = toHalf(ch[p * 4 + 3]) // L11  → .w (pairs n.x)
    }
    return out
  }
  return { shR: makeProbeVolume(pack(r)), shG: makeProbeVolume(pack(g)), shB: makeProbeVolume(pack(b)) }
}
```

- [ ] **Step 2: Typecheck** → `npx tsc --noEmit` exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/lightbake/probeBake.ts
git commit -m "feat(lightbake): pack raw SH-L1 into 3 half-float Data3DTexture (by colour channel)"
```

---

## Task 7: Wire the probe bake into `BakedShellLighting` + share volumes via context

**Files:**
- Create: `src/components/interior/ProbeVolumeContext.tsx`
- Modify: `src/components/interior/BakedShellLighting.tsx`

- [ ] **Step 1: Create the context**

```tsx
// src/components/interior/ProbeVolumeContext.tsx
import { createContext, useContext } from 'react'
import type * as THREE from 'three/webgpu'

export interface ProbeVolumes { shR: THREE.Data3DTexture; shG: THREE.Data3DTexture; shB: THREE.Data3DTexture }
export const ProbeVolumeContext = createContext<ProbeVolumes | null>(null)
export const useProbeVolumes = () => useContext(ProbeVolumeContext)
```

- [ ] **Step 2: Extend `BakedShellLighting`** — after `bakeAndAttachShell` resolves, run the probe bake and publish the volumes. `bakeAndAttachShell` must now RETURN `{ lightmap, bvhGeo, lightmapRes }` (modify `bakeShellRuntime.ts` to return the geometry + res it already built). Then:

```tsx
// inside bakeNow(), after the shell bake:
import { probeBakeRaw, classifyDeadProbes, floodFillDeadProbes, packProbeVolumes } from '../../lib/lightbake/probeBake'
import { emissiveRig } from '../../lib/lightbake/emissiveRig'
import { collectShell } from '../../lib/lightbake/collectShell'
import * as THREE from 'three/webgpu'

const { lightmap, bvhGeo, lightmapRes } = await bakeAndAttachShell(renderer, scene, opts)
// occluder AABBs from the LIVE meshes (not hard-coded) — collectShell already returns occluders.
const { occluders } = collectShell(scene)
const box = new THREE.Box3()
const occluderBoxes = occluders.map((m) => { box.setFromObject(m); return { min: box.min.toArray(), max: box.max.toArray() } })
const { r, g, b } = await probeBakeRaw(renderer, bvhGeo, /*bvh*/ bvhFromShell, lightmap, lightmapRes, emissiveRig())
const valid = classifyDeadProbes(occluderBoxes)
floodFillDeadProbes([r, g, b], valid)
const vols = packProbeVolumes(r, g, b)
setProbeVolumes(vols)               // React state lifted to a provider wrapping the scene
console.log('[baked] probe volume ready')
```

(Thread `bvhFromShell` out of `bakeAndAttachShell` too — it builds the BVH already. The provider is mounted in `SceneContent` wrapping `<Aisle>` so receivers can `useProbeVolumes()`.)

- [ ] **Step 3: Mount the provider** in `InteriorScene.tsx` `SceneContent`: wrap the existing children in `<ProbeVolumeContext.Provider value={probeVolumes}>` where `probeVolumes` is React state set by `BakedShellLighting`. (Lift the state to `SceneContent`, pass a setter to `BakedShellLighting`.)

- [ ] **Step 4: Manual verify** — `PORT=3001 npm run dev`, open `/?baked=1`, confirm console logs `[baked] probe volume ready` with no GPU error. Confirm the readback stride (Task 4 Step 3) here.

- [ ] **Step 5: Commit**

```bash
git add src/components/interior/ProbeVolumeContext.tsx src/components/interior/BakedShellLighting.tsx src/components/interior/InteriorScene.tsx src/lib/lightbake/bakeShellRuntime.ts
git commit -m "feat(lightbake): bake the probe volume after the shell + share via context (?baked=1)"
```

---

## Task 8: Inject SH irradiance into the K7 instanced material (primary receiver)

**Files:**
- Modify: `src/components/interior/CassetteInstances.tsx`

**Key constraints (verified):** stay ≤ 8 vertex buffers (currently 7: position/normal/uv + `atlasRect` + 3× `.toAttribute()`). Use `instancedArray.element()` for the per-instance world position (no vertex-buffer slot) and `texture3D().sample()` for the volumes (texture bindings, no slot). Inject via **emissive add**, keep the 0.20 self-illum reading the *un-lit* `cappedColor`.

- [ ] **Step 1:** Add the per-instance world-position buffer in the big `useMemo` (next to `hoverTiltBuf`, ~line 147):

```ts
const worldPosBuf = instancedArray(count, 'vec3')
const wp = worldPosBuf.value.array as Float32Array
for (let i = 0; i < count; i++) {
  const p = currentInstances[i].worldPosition
  wp[i * 3] = p.x; wp[i * 3 + 1] = p.y; wp[i * 3 + 2] = p.z
}
// return worldPosBuffer: worldPosBuf in the useMemo result; thread into the material useMemo deps.
```

- [ ] **Step 2:** In the material `useMemo`, AFTER `cappedColor` (line 239), read the volumes from context (passed as a prop `probes: ProbeVolumes | null`) and reconstruct + add. The instance is **yawed** — use the instance-rotated world normal. The K7 instance rotation is a yaw quaternion; transform `normalLocal` by it. Simplest robust path: pass per-instance yaw as a storage buffer and rotate, OR use `normalWorld` (which in TSL applies the instance normal matrix). **Use `normalWorld`** and verify at M2 (Task 12) that a left-wall K7 picks up the cross-room colour; if the lobe is mirrored, fall back to an explicit per-instance-yaw rotation.

```ts
import { texture3D, normalWorld, positionWorld, uniform, clamp, vec3, float } from 'three/tsl'
import { shIrradiance } from '../../lib/lightbake/shReconstruct'
import { GRID_MIN, gridExt, G } from '../../lib/lightbake/probeGrid'

// ... inside material useMemo, only when `probes` is present (baked mode):
let litColor = cappedColor
if (probes) {
  const gMin = uniform(new THREE.Vector3(...GRID_MIN))
  const e = gridExt()
  const gInv = uniform(new THREE.Vector3(1 / e[0], 1 / e[1], 1 / e[2]))
  const half = uniform(new THREE.Vector3(0.5 / G[0], 0.5 / G[1], 0.5 / G[2]))
  const f = positionWorld.sub(gMin).mul(gInv)
  const uvw = clamp(f, half, vec3(1).sub(half))
  const E = shIrradiance(texture3D(probes.shR), texture3D(probes.shG), texture3D(probes.shB), uvw, normalWorld)
  const PROBE_INTENSITY = float(0.32) // ≈ 1/π; calibrated at M2
  // emissive add — reliable when the analytical rig is dropped (no lights to multiply colorNode)
  // (replaces nothing in colorNode; ADDS to emissiveNode below)
  mat.userData.__probeTerm = cappedColor.mul(E).mul(PROBE_INTENSITY)
}
mat.colorNode = cappedColor
// ... existing positionNode (tilt) unchanged ...
const probeTerm = (mat.userData.__probeTerm ?? float(0))
mat.emissiveNode = hoverEmissive.add(cappedColor.mul(float(0.20))).add(probeTerm)
```

(Refine: don't stash on userData — compute `probeTerm` as a local `Node` and reference it directly in the `emissiveNode` line. The snippet shows intent.)

- [ ] **Step 3: Typecheck + manual verify** — `npx tsc --noEmit` exit 0; `/?baked=1` shows the K7 lit by the baked GI (no longer near-black), the K7 under a magenta sign picking up magenta.

- [ ] **Step 4: Commit**

```bash
git add src/components/interior/CassetteInstances.tsx
git commit -m "feat(lightbake): K7 instanced material samples SH probe irradiance (vertex stage, emissive add)"
```

---

## Task 9: Trap-1 build guard (regression test)

**Files:**
- Create: `tests/lightbake/probe-filter-guard.test.mjs` (or a small Playwright assertion)

- [ ] **Step 1:** The volumes MUST compile to `textureSample`/`textureSampleLevel`, never `textureLoad`. A Nearest-filter regression is silent. Add a guard: in `/?baked=1`, after the bake, dump the K7 material's generated WGSL (via the NodeBuilder/renderer debug hook) and assert. If no easy in-app dump hook exists, write a tiny standalone harness page `app/probe-guard/page.tsx` that builds the SH node on a throwaway material, `await renderer.compileAsync(mesh, scene)`, and reads the cached shader. Assert via Playwright `browser_evaluate`:

```js
// expectation captured in the harness page → window.__probeGuard = { hasSample, hasLoad }
// Playwright: navigate, read window.__probeGuard
//   assert hasSample === true && hasLoad === false  (on the probe volume bindings)
```

- [ ] **Step 2:** Document in the test file WHY (Trap 1) and that flipping to `textureLoad` = banding with no error.

- [ ] **Step 3: Commit**

```bash
git add tests/lightbake/probe-filter-guard.test.mjs app/probe-guard/page.tsx
git commit -m "test(lightbake): Trap-1 build guard — probe volumes must textureSample, never textureLoad"
```

---

## Task 10: Secondary receivers — instanced shelf planks + dividers

**Files:**
- Modify: `src/components/interior/WallShelf.tsx`, `src/components/interior/IslandShelf.tsx`

- [ ] **Step 1:** These are `MeshStandardMaterial` (wood). Convert the plank material to `MeshStandardNodeMaterial` (or reuse a node material) and apply the SAME emissive-add SH term as Task 8, using `positionWorld` + `normalWorld` (non-instanced island planks can use `positionWorld` directly). Read volumes from `useProbeVolumes()`.

- [ ] **Step 2:** Gate on baked mode (volumes present). When absent, leave the material unchanged.

- [ ] **Step 3: Manual verify** — planks no longer black in `/?baked=1`; if large planks band (vertex-interpolated E), note it for the fragment-stage fallback (design risk) — do NOT fix unless visibly bad.

- [ ] **Step 4: Commit**

```bash
git add src/components/interior/WallShelf.tsx src/components/interior/IslandShelf.tsx
git commit -m "feat(lightbake): shelf planks + dividers sample the SH probe volume (?baked=1)"
```

---

## Task 11: Optional receivers — manager NPC + TV body

**Files:**
- Modify: `src/components/interior/Manager3D.tsx`, `src/components/interior/InteractiveTVDisplay.tsx`

- [ ] **Step 1:** Manager (GLB, skinned) — cheapest safe v1 = ONE SH tap at the group origin (`Manager3D` world pos ≈ (2.2, 0, 3.77)), applied flat to the material as a uniform `vec3` irradiance multiplier on its albedo. Do NOT per-vertex sample the skinned mesh in v1 (post-skinning world pos needed). **Wire `Manager3D.tsx` (the 3D avatar), NOT `src/components/manager/*` (that is the 2D chat UI).**

- [ ] **Step 2:** TV — apply the SH term to the BODY materials only (`tvBodyMat` etc.); the CRT screen is self-emissive, leave it. Static mesh → `positionWorld`/`normalWorld` per-vertex is fine.

- [ ] **Step 3: Manual verify + commit**

```bash
git add src/components/interior/Manager3D.tsx src/components/interior/InteractiveTVDisplay.tsx
git commit -m "feat(lightbake): manager (flat tap) + TV body sample the SH probe volume (?baked=1)"
```

---

## Task 12: M2 visual + FPS gate [STOP — user validation]

- [ ] **Step 1:** `/?baked=1` full-scene A/B vs `/`:
  - K7 + planks lit by the baked GI (no longer black), colour bleed reads (K7 near magenta sign picks up magenta), néon-noir mood preserved.
  - Calibrate `PROBE_INTENSITY` (Task 8) so K7 brightness sits naturally against the lightmapped shell at the same spot (the π-factor knob).
  - Verify normals: a left-wall K7 (yawed) is lit from the room side, not mirrored. If wrong, switch Task 8 to explicit per-instance-yaw normal rotation.
- [ ] **Step 2:** **Measure FPS on the Mac Mini M1** with the full probe-sampling rig (~520 K7 + planks vertex-stage SH). Compare to the design's 30 fps target. If margin is thin: coarsen the grid (`probeGrid.G` → `[9,5,9]`) and/or drop Task 10/11 receivers.
- [ ] **Step 3:** Take Playwright screenshots (shell-only baked vs shell+probes baked vs realtime). Present to the user for the M2 STOP. Do not proceed past this gate without approval.

---

## Self-Review (done at write time)

- **Spec coverage:** design §5 (SH-L1, Data3DTexture RGBA16F LinearFilter, BVH gather reusing Phase-1 lightmap-as-emitter, ~400 probes, vertex sampling) → Tasks 1-8. §6 conditionality (M1 FPS) → flagged in the gate block + Task 12. §7 risks (probe runtime cost, L1-not-L2) → Tasks 1/12. Trap 1 → Tasks 3/9. Trap 2 (cubemap) → moot by the BVH-gather choice (no cubemap), noted.
- **Reconciled inter-agent conflicts:** SH packing (by-channel), pre-scale vs runtime-scale (runtime, raw storage), probe count (726 + knob), injection (emissive add). All four documented in the gate block as locked contracts.
- **Open risks carried into tasks (not placeholders):** vec3 readback stride (Task 4 Step 3 — measure), instance world-normal correctness (Task 8 Step 2 + Task 12), `ptr<storage,read_write>` out-param in the gather wgslFn (Task 4 — proven `radiosityBake` storage-param pattern, not `ptr<function>`), PROBE_INTENSITY π-calibration (Task 12).
