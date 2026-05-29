# WebGPU Radiosity Lightmap (néon-noir shell) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bake the static shell's néon-noir GI (multi-bounce coloured indirect + soft contact AO) into a `uv1` lightmap **entirely in WebGPU/TSL** (no WebGL2, no GLB), ship the lightmap PNG, and light the shell at runtime via `material.lightMap`.

**Architecture:** An offline bake route (`/radiosity-bake`, WebGPU) mounts the real shell, assigns a **deterministic procedural `uv1`** (atlas slot per mesh + planar projection), builds a merged `MeshBVH`, and runs an **iterative radiosity gather in TSL** using `three-mesh-bvh/webgpu` (`bvhIntersectFirstHit` + `getVertexAttribute`) — proven in the `/radiosity-spike`. All lighting is **emissive geometry** (neon meshes + thin emissive proxy quads for the fluo/vitrine/under-shelf/comptoir rig) plus a cold sky/moonlight miss term; each bounce reads the previous bounce's lightmap × albedo at ray hits. A Playwright driver exports `public/baked/shell-lightmap.png`. At runtime (`?baked=1`), the same procedural `uv1` is recomputed on the same meshes and the lightmap is attached; the realtime rig is dropped (emissive neon meshes stay for bloom).

**Tech Stack:** three 0.184 WebGPURenderer + TSL, `three-mesh-bvh` 0.9.10 (`/webgpu` TSL raycaster), React/Next App Router, Playwright **MCP** for headless WebGPU verification (the project has no `playwright` npm dep; WebGPU runs in the MCP browser — `adapter:true`). Branch `lighti-cook`.

**Proven foundation (the spike):** `app/radiosity-spike/page.tsx` proved, self-verified via Playwright: (1) `three-mesh-bvh/webgpu` BVH intersect works in our stack; (2) a 1-bounce hemisphere gather with `getVertexAttribute` albedo lookup produces real colour bleed (red wall → red floor). See `memory/lightbake-workstream.md` "SPIKE RESULT" for the exact working buffer pattern.

**Supersedes:** `2026-05-29-neon-noir-shell-lightmap.md` (the WebGL2 direct+AO plan). That direction is abandoned — bake is now WebGPU-native radiosity.

---

## Locked decisions

- **WebGPU/TSL bake** via `three-mesh-bvh/webgpu`. No WebGL2, no `three-gpu-pathtracer` (it can't bake lightmaps — camera-only), no vendored WebGL baker (Task 1 of the old plan becomes dead code, deleted in Task 0).
- **Deterministic procedural `uv1`** (no xatlas, no GLB, no geometry/uv round-trip): each lightmapped shell mesh gets one slot in an N×N atlas; within its slot, planar-project by the geometry's dominant axis. Computed by ONE shared pure function used at bake AND runtime → identical geometry ⇒ identical uv1 ⇒ the baked PNG maps correctly at runtime. **Ship only `shell-lightmap.png` + `manifest.json`.**
- **Lightmap scope = non-instanced static surfaces:** floor, ceiling, 4 walls, 2 island bodies (+ tops/pedestals), 8 shelf back panels. The **instanced shelf planks/dividers** (`WallShelf` InstancedMesh) are **occluders only** (included in the BVH so they cast contact shadows into the bake) but are NOT lightmapped in v1 — they keep a cheap fill / get probes later.
- **All lighting = emissive geometry** + a cold sky/moonlight miss term. The 7-emitter néon-noir rig is realised as: real emissive neon-tube meshes (already in `Lighting.tsx`) + thin **emissive proxy quads** (offline only) for the fluo tubes, vitrine, under-shelf strips, comptoir light. Miss rays return a faint cold colour (the moonlight ambient through the vitrine). Uniform iterative gather — no separate analytic light sampling.
- **Iterative radiosity:** `L₀ = emission`; for K bounces `L_{k+1}[texel] = emission + albedo · mean_S( hit ? L_k[hitUv1] : sky )`. Accumulate S samples/bounce (offline → many; clean). HDR float RT, ping-pong. Export = tonemap `÷ LIGHTMAP_SCALE` → 8-bit PNG; runtime `lightMapIntensity = LIGHTMAP_SCALE`.
- **Flag:** `?baked=1`. Procedural path stays default until M1-validated.
- **Phasing:** prove UV-space radiosity on the spike test scene (Task 3) → real shell grayscale (Task 5) → colour (Task 8) → tune (Task 8) → M1 checkpoint (Task 9). Probe volume for shelves+dynamics = a separate later plan.

## File Structure

- `src/lib/lightbake/shellUv1.ts` — **NEW**: `applyShellUv1(mesh, slotIndex, slotCount)` deterministic procedural uv1; `SHELL_SLOTS` (ordered lightmapped-mesh names → slot). Pure, unit-tested.
- `src/lib/lightbake/bvhGpu.ts` — **NEW**: `buildGpuBvh(mergedGeometry)` → `{ storages, nodeCount }` (the proven StorageBufferAttribute pattern: index/position/normal/color/emission + BVH nodes); shared wgsl helper snippets (`rngHash`, `hemiSample`). Pure-ish, unit-tested for buffer counts.
- `src/lib/lightbake/collectShell.ts` — **NEW**: traverse an R3F group, return `{ lightmapped: Mesh[] (by SHELL_SLOTS order), occluders: Mesh[] }` via `userData.bakeRole`.
- `src/lib/lightbake/emissiveRig.ts` — **NEW**: build the néon-noir emissive proxy quads (positions/sizes/colours/intensities) as `THREE.Mesh[]` with an `emission` vertex attribute. Offline only.
- `src/lib/lightbake/radiosityBake.ts` — **NEW**: orchestration — merge (lightmapped+occluders+emitters) → procedural uv1 on lightmapped → g-buffer (worldpos/normal/albedo/emission per texel, uv1 layout) → iterative gather (ping-pong) → HDR lightmap. WebGPU/TSL.
- `app/radiosity-bake/page.tsx` — **NEW**: bake harness; mounts `<BakeShellMount/>` (the real shell), runs `radiosityBake`, previews, exposes `window.__bake` + `window.__bakeExport()`.
- `scripts/bake-radiosity.mjs` — **NEW**: Playwright(-MCP-style) driver → `public/baked/shell-lightmap.png` + `manifest.json`. (If no `playwright` npm dep, document running via the MCP / a one-off `npx playwright`.)
- `src/components/interior/BakedShellLighting.tsx` — **NEW**: runtime; on `?baked=1`, traverse shell group, `applyShellUv1` + attach `lightMap`/`lightMapIntensity`.
- `src/components/interior/Aisle.tsx`, `Storefront.tsx`, `WallShelf.tsx`, `IslandShelf.tsx` — **MODIFY**: tag shell meshes with `userData.bakeRole = 'lightmapped' | 'occluder'`.
- `src/components/interior/InteriorScene.tsx` — **MODIFY**: `?baked=1` gate → mount `<BakedShellLighting/>` + `bakedLighting` prop.
- `src/components/interior/Lighting.tsx` — **MODIFY**: `bakedLighting` drops the realtime rig (keep emissive neon).
- `tests/lightbake/shell-uv1.test.mjs`, `tests/lightbake/bvh-gpu.test.mjs` — **NEW**.

---

## Task 0: Remove the abandoned WebGL2 baker

**Files:** Delete `src/lib/lightbake/{generateAtlas,renderAtlas,LightmapperMaterial,Lightmapper,constants}.ts` IF unused by the new path (constants `BAKE_SHELL` may be reused — keep `constants.ts`, delete the 4 vendored WebGL files). Keep `app/radiosity-spike/page.tsx` (reference).

- [ ] **Step 1:** `git rm src/lib/lightbake/generateAtlas.ts src/lib/lightbake/renderAtlas.ts src/lib/lightbake/LightmapperMaterial.ts src/lib/lightbake/Lightmapper.ts`
- [ ] **Step 2:** `npx tsc --noEmit` → exit 0 (nothing imported them outside themselves).
- [ ] **Step 3:** Commit: `git commit -m "chore(lightbake): drop vendored WebGL2 baker — superseded by WebGPU/TSL radiosity"`

---

## Task 1: Deterministic procedural `uv1`

**Files:** Create `src/lib/lightbake/shellUv1.ts`; Test `tests/lightbake/shell-uv1.test.mjs`.

- [ ] **Step 1: Failing test**

`tests/lightbake/shell-uv1.test.mjs`:
```js
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { applyShellUv1, SHELL_SLOTS } from '../../src/lib/lightbake/shellUv1.ts'

test('uv1 is in [0,1], lands inside the mesh slot, deterministic', () => {
  const g = new THREE.PlaneGeometry(4, 3).toNonIndexed()
  applyShellUv1(g, 5, 16) // slot 5 of a 4x4 atlas
  const uv1 = g.getAttribute('uv1')
  assert.ok(uv1, 'uv1 written')
  // slot 5 in a 4x4 grid → col 1, row 1 → x in [0.25,0.5], y in [0.25,0.5]
  for (let i = 0; i < uv1.count; i++) {
    const x = uv1.getX(i), y = uv1.getY(i)
    assert.ok(x >= 0.25 - 1e-4 && x <= 0.5 + 1e-4, `x ${x} in slot`)
    assert.ok(y >= 0.25 - 1e-4 && y <= 0.5 + 1e-4, `y ${y} in slot`)
  }
  // determinism
  const g2 = new THREE.PlaneGeometry(4, 3).toNonIndexed()
  applyShellUv1(g2, 5, 16)
  const a = g.getAttribute('uv1').array, b = g2.getAttribute('uv1').array
  for (let i = 0; i < a.length; i++) assert.equal(a[i], b[i])
})
```

- [ ] **Step 2:** Run `node --test tests/lightbake/shell-uv1.test.mjs` → FAIL (module missing).

- [ ] **Step 3: Implement** `src/lib/lightbake/shellUv1.ts`:
```ts
import { BufferGeometry, BufferAttribute, Box3, Vector3 } from 'three'

// Lightmapped shell meshes, in a STABLE order → atlas slot index. (Instanced shelf
// planks are NOT here — occluders only.)
export const SHELL_SLOTS = [
  'floor', 'ceiling', 'wall-north', 'wall-south', 'wall-left', 'wall-right',
  'island-0', 'island-1',
  'shelfback-0', 'shelfback-1', 'shelfback-2', 'shelfback-3',
  'shelfback-4', 'shelfback-5', 'shelfback-6', 'shelfback-7',
] as const

const _box = new Box3(), _size = new Vector3(), _p = new Vector3()

// Planar-project the geometry by its dominant (smallest-extent) axis into the
// [0,1]² slot for `slotIndex` of an `slotCount` (perfect-square) atlas. Deterministic.
export function applyShellUv1(geo: BufferGeometry, slotIndex: number, slotCount: number): void {
  const grid = Math.round(Math.sqrt(slotCount))
  const col = slotIndex % grid, row = Math.floor(slotIndex / grid)
  const cell = 1 / grid
  const pad = cell * 0.04 // gutter to avoid bilinear bleed across slots
  const pos = geo.getAttribute('position')
  geo.computeBoundingBox()
  _box.copy(geo.boundingBox!); _box.getSize(_size)
  // dominant axis = the thinnest (project onto the other two)
  const ax = _size.x, ay = _size.y, az = _size.z
  let u: 'x' | 'y' | 'z', v: 'x' | 'y' | 'z'
  if (ax <= ay && ax <= az) { u = 'z'; v = 'y' }
  else if (ay <= ax && ay <= az) { u = 'x'; v = 'z' }
  else { u = 'x'; v = 'y' }
  const uMin = _box.min[u], uExt = _size[u] || 1, vMin = _box.min[v], vExt = _size[v] || 1
  const out = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i)
    const fu = (_p[u] - uMin) / uExt // 0..1 within mesh
    const fv = (_p[v] - vMin) / vExt
    out[i * 2] = (col + pad + fu * (1 - 2 * pad)) * cell + 0 // place into slot
    out[i * 2 + 1] = (row + pad + fv * (1 - 2 * pad)) * cell
  }
  // NB: rewrite cleanly — slot origin is col*cell; in-slot span is (1-2*pad)*cell.
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i)
    const fu = (_p[u] - uMin) / uExt, fv = (_p[v] - vMin) / vExt
    out[i * 2] = col * cell + (pad + fu * (1 - 2 * pad)) * cell
    out[i * 2 + 1] = row * cell + (pad + fv * (1 - 2 * pad)) * cell
  }
  geo.setAttribute('uv1', new BufferAttribute(out, 2))
}
```
(Clean up to the single loop in implementation; the test pins the slot bounds.)

- [ ] **Step 4:** Run test → PASS. **Step 5:** Commit `feat(lightbake): deterministic procedural uv1 (atlas slot + planar projection)`.

---

## Task 2: GPU BVH buffer helpers

**Files:** Create `src/lib/lightbake/bvhGpu.ts`; Test `tests/lightbake/bvh-gpu.test.mjs`.

- [ ] **Step 1: Failing test** (buffer counts match geometry + BVH):
```js
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { packBvhBuffers } from '../../src/lib/lightbake/bvhGpu.ts'

test('packBvhBuffers yields index/position triplet counts + non-empty nodes', () => {
  const geo = new THREE.BoxGeometry(1, 1, 1).toNonIndexed()
  const n = geo.attributes.position.count
  const idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i
  geo.setIndex(new THREE.BufferAttribute(idx, 1))
  const bvh = new MeshBVH(geo)
  const b = packBvhBuffers(geo, bvh)
  assert.equal(b.indexCount, n / 3)        // triangles
  assert.equal(b.positionCount, n)
  assert.ok(b.nodeFloats % 8 === 0 && b.nodeFloats > 0) // 8 floats / node
})
```

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Implement** `src/lib/lightbake/bvhGpu.ts` (StorageBufferAttribute + `storage()` per the proven spike pattern). Provide `packBvhBuffers(geo, bvh)` returning the typed counts (for the test) and `gpuStorages(geo, bvh)` returning the TSL `storage(...).toReadOnly()` nodes for `index('uvec3')`, `position/normal/color/emission('vec3')`, `bvh('BVHNode')`. Also export the wgsl helper snippets `rngHash`, `hemiSample` (copied verbatim from the working spike). Full code in implementation (mirror `app/radiosity-spike/page.tsx` buffer setup).

- [ ] **Step 4:** Run test → PASS. **Step 5:** `npx tsc --noEmit` → 0. **Step 6:** Commit `feat(lightbake): GPU BVH storage-buffer helpers (proven spike pattern)`.

---

## Task 3: UV-space radiosity on the spike test scene (de-risk the bake)

**Files:** Create `src/lib/lightbake/radiosityBake.ts`; extend `app/radiosity-spike/page.tsx` (or a sibling) with a UV-space mode.

This generalises the proven CAMERA-space gather to UV space: vertex shader places each triangle at its `uv1` clip position → a g-buffer fragment writes world position/normal/albedo/emission per texel; then an iterative gather fragment reads the g-buffer + previous lightmap and casts hemisphere rays (BVH), reading the previous lightmap at hit `uv1` (via `getVertexAttribute` on the uv1 buffer). Ping-pong K bounces.

- [ ] **Step 1:** Implement `radiosityBake(renderer, { lightmapped, occluders, emitters }, opts)` → `THREE.Texture` (HDR lightmap). Stages: assign procedural uv1 to `lightmapped`; merge all (lightmapped+occluders+emitters) into one geometry for the BVH with `color` (albedo) + `emission` attributes (occluders albedo only; emitters emission set); g-buffer pass (uv1 layout) for the lightmapped set; iterative gather (ping-pong float RTs). Full TSL in implementation, built on the spike's `wgslFn` + `gpuStorages`.

- [ ] **Step 2: Verify (Playwright MCP, self-served).** Test scene = the spike's red-wall/white-floor/box, but bake a lightmap and apply it (sampled via uv1) onto the geometry rendered from a normal camera. Navigate `localhost:3001/radiosity-spike?mode=uvbake`, wait `window.__spike.status==='done'`, screenshot, Read PNG.
Expected: the floor near the red wall is reddish **in the baked lightmap** (not just live shading) — i.e., reload-stable colour bleed in `uv1` space. 0 console errors.

- [ ] **Step 3:** Commit `feat(lightbake): UV-space iterative radiosity bake (validated on test scene)`.

---

## Task 4: Tag + collect the real shell; emissive rig

**Files:** Modify `Aisle.tsx`, `Storefront.tsx`, `WallShelf.tsx`, `IslandShelf.tsx`; Create `collectShell.ts`, `emissiveRig.ts`.

- [ ] **Step 1:** Add `userData.bakeRole`/stable `name` to shell meshes: `'lightmapped'` (floor, ceiling, 4 walls, 2 island bodies+tops, 8 shelf back panels — names matching `SHELL_SLOTS`) and `'occluder'` (instanced planks/dividers, misc). Use the imperative-ref pattern (NOT JSX `userData=` — see `memory` R3F anti-pattern). floor/ceiling already named.
- [ ] **Step 2:** `collectShell(group)` → `{ lightmapped: Mesh[] ordered by SHELL_SLOTS, occluders: Mesh[] }`.
- [ ] **Step 3:** `emissiveRig()` → the néon-noir emissive proxy quads (start from `Lighting.tsx` positions: 4 ceiling fluo, 2 island overhead, comptoir, vitrine cold, under-shelf strips) as `Mesh[]` carrying an `emission` attribute (colour × intensity). Plus the real neon-tube meshes are collected as emitters too.
- [ ] **Step 4:** Unit test `collectShell` on a small mock group (membership counts). Run → PASS.
- [ ] **Step 5:** Commit `feat(lightbake): tag/collect shell meshes + néon-noir emissive rig`.

---

## Task 5: Bake harness `/radiosity-bake` on the real shell (grayscale-first)

**Files:** Create `app/radiosity-bake/page.tsx`.

- [ ] **Step 1:** Page mounts a `<BakeShellMount/>` rendering the **real** shell components (reuse the InteriorScene shell subtree, no cassettes/manager), waits a frame for geometry, `collectShell`, builds `emissiveRig`, runs `radiosityBake`. Phase-grayscale: force emitter emission to luminance (RGB equal) so output is neutral but colour-ready. Apply the resulting lightMap to the lightmapped meshes (uv1) for preview. Expose `window.__bake` + `window.__bakeExport()` (tonemap → PNG).
- [ ] **Step 2: Verify (Playwright MCP).** Navigate `/radiosity-bake`, wait `done`, screenshot. Expected: shell shows soft GI + AO (warm pools under the fluo proxies, dark contact at wall/floor + under shelves), grayscale. 0 errors. `__bakeExport()` returns a PNG dataURL.
- [ ] **Step 3:** Commit `feat(lightbake): WebGPU radiosity bake harness on the real shell (grayscale)`.

---

## Task 6: Offline driver → ship the lightmap

**Files:** Create `scripts/bake-radiosity.mjs`; Modify `package.json` (`"bake": "node scripts/bake-radiosity.mjs"`).

- [ ] **Step 1:** Driver loads `/radiosity-bake` in a WebGPU-enabled chromium (flags `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=metal`), waits `done`, calls `__bakeExport()`, writes `public/baked/shell-lightmap.png` + `manifest.json` (`{ scale, resolution, slotCount, bakedAt }`). If `playwright` isn't installed, document `npm i -D playwright` OR a manual export-via-MCP fallback.
- [ ] **Step 2:** Run the bake → assets written; open the PNG (a recognisable néon-noir lightmap atlas).
- [ ] **Step 3:** Commit `feat(lightbake): offline radiosity bake driver + baked lightmap`.

---

## Task 7: Runtime attach + flag + drop rig

**Files:** Create `BakedShellLighting.tsx`; Modify `InteriorScene.tsx`, `Lighting.tsx`.

- [ ] **Step 1:** `BakedShellLighting`: on mount (when `?baked=1`), `collectShell` the live shell group, `applyShellUv1(mesh.geometry, SHELL_SLOTS.indexOf(name), 16)` per lightmapped mesh, load `/baked/shell-lightmap.png` (`colorSpace=NoColorSpace`, `flipY=false`, `channel=1`), set `material.lightMap`/`lightMapIntensity = manifest.scale`.
- [ ] **Step 2:** `Lighting.tsx` `bakedLighting` → drop the realtime RectAreaLights/PointLights/directional; keep emissive neon (bloom) + a tiny hemisphere fill for the instanced planks not lightmapped.
- [ ] **Step 3:** Gate in `InteriorScene.tsx`.
- [ ] **Step 4: Verify A/B (Playwright MCP).** `/?baked=1` vs `/`. Expected: shell carries baked GI (warm pools, soft AO); 0 errors; realtime rig gone. Cassettes still lit (hemisphere fill for now).
- [ ] **Step 5:** Commit `feat(lightbake): runtime baked-shell lightmap (flag-gated) + drop rig`.

---

## Task 8: Colour + néon-noir rig tuning

- [ ] **Step 1:** Remove the grayscale luminance forcing in the bake → real neon chrominance flows (coloured bleed on walls/floor/islands). Runtime/format unchanged.
- [ ] **Step 2:** Tune `emissiveRig` colours/intensities + bounce count + sample count vs the néon-noir target (warm pools, magenta/cyan bite, cold vitrine, dark contrast). Re-bake (`npm run bake`) + screenshot each iteration (self-served).
- [ ] **Step 3:** Commit `perf(lightbake): coloured néon-noir radiosity + rig tuning`.

---

## Task 9: M1 validation checkpoint — STOP for user

- [ ] **Step 1:** `npm run build` + run on the Mac Mini M1; compare `/` vs `/?baked=1`: néon-noir realism (coloured bleed + soft shadows) and FPS. Record numbers. **Do not start the probe-volume plan (shelves + cassettes/manager/TV) until the user confirms the shell bake is good + M1 headroom is known.**

---

## Self-review notes

- **Spec coverage:** WebGPU/TSL radiosity (Tasks 2-3,5) ✓; colour bleed (Task 8) ✓; néon-noir rig as emissive geometry (Task 4) ✓; no GLB / procedural uv1 round-trip-free (Task 1) ✓; runtime attach + drop rig (Task 7) ✓; M1 checkpoint (Task 9) ✓.
- **Known limitation (flagged for user):** instanced shelf planks/dividers are occluders only, NOT lightmapped in v1 (they keep a hemisphere fill); they + cassettes/manager/TV get the SH-L1 probe volume in the next plan. The big-surface colour bleed (the dominant néon-noir effect) IS delivered here.
- **Risk — procedural uv1 texel density:** equal atlas slots over-allocate small meshes and under-allocate the floor; if the floor looks low-res, give it a larger slot (weight slots by surface area) — a `shellUv1.ts` change, no pipeline change.
- **Risk — bake determinism vs runtime geometry:** procedural uv1 matches only if bake & runtime build identical geometry. Both mount the SAME shell components → identical. If a shell component is later changed, re-bake.
- **Type consistency:** `LIGHTMAP_SCALE` (manifest) == runtime `lightMapIntensity`; `SHELL_SLOTS` order is the single source for slot indices at bake AND runtime.
