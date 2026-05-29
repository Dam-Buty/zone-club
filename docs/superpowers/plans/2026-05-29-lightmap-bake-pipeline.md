# Offline GI Lightmap Bake Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bake the video-club's static-shell lighting (soft area-light shadows + AO + indirect) into a lightmap **offline**, ship the texture, and have the WebGPU runtime light the shell with a cheap lightmap lookup instead of ~14 RectAreaLights — cheaper on the Mac Mini M1 *and* more realistic.

**Architecture:** A separate **WebGL2 bake page** (`/bake`) builds the static shell as plain Three meshes + the real light rig, unwraps a non-overlapping `uv1` atlas (xatlas-three), renders a UV-space g-buffer (world position/normal), then runs a three-mesh-bvh Monte-Carlo raycaster (vendored from `three-lightmap-baker`) **once per light, summed**, to accumulate an HDR lightmap. A Playwright script drives the page headless and exports `shell.glb` (geometry with `uv1`) + `shell-lightmap.png` (tonemapped, with an intensity scalar) into `public/baked/`. At runtime, a flag-gated `BakedShell` loads the GLB + lightmap, applies `material.lightMap` (sampled via `uv1`), and the procedural shell + its real-time lights are disabled.

**Phasing:** **Phase A** (this plan) = grayscale GI (no material color bleed) — the safe base. **Phase A+** (Tasks 11–12, after A is validated on M1) = add an albedo g-buffer for colored indirect bounces.

**Tech Stack:** three 0.184 (WebGL2 for bake, WebGPU at runtime), `three-mesh-bvh` 0.9.10 (GPU raycast GLSL), `xatlas-three` (UV unwrap), `three-gpu-pathtracer` (already installed — only used as quality reference, NOT imported by the baker), React/Next App Router, Playwright (offline driver). Runs on the `lighti-cook` branch.

**Vendored source reference:** `https://github.com/lucas-jones/three-lightmap-baker` (`main`), files `src/atlas/generateAtlas.ts`, `src/atlas/renderAtlas.ts`, `src/lightmap/Lightmapper.ts`, `src/lightmap/LightmapperMaterial.ts`. Fetch raw via `https://raw.githubusercontent.com/lucas-jones/three-lightmap-baker/main/<path>`.

**Pre-flight cleanup:** The throwaway ProgressiveLightMap PoC must be removed first (it's disqualified). See Task 0.

---

## Key decisions (locked)

- **uv channel:** modern three samples `material.lightMap` from **`uv1`** (not `uv2`). The vendored code writes `uv2` — every vendored file is adapted to `uv1`.
- **Multi-light:** the baker handles one light. We **loop the bake per light and sum** the HDR results (simple, robust, N× bake time — acceptable offline). No shader changes for Phase A.
- **Export format (Phase A):** lightmap is HDR (`FloatType`). We **tonemap-pack to PNG**: divide by `LIGHTMAP_SCALE` (a constant, e.g. 4.0), clamp 0–1, store PNG; at runtime `material.lightMapIntensity = LIGHTMAP_SCALE`. Ships easily, browser-loadable. (A+/later can move to half-float KTX2 if range clips.)
- **Geometry round-trip:** the bake unwraps geometry (writes `uv1`) → that exact geometry must reach runtime. We export the unwrapped shell as **`shell.glb`** and load THAT at runtime (the procedural shell is disabled when baking is on). One shared atlas lightmap covers all shell meshes (xatlas `packAtlas` packs them into one atlas → per-mesh `uv1` regions).
- **Scope of "shell" (Phase A):** floor, ceiling, the 4 walls, the 8 wall-shelves, the 2 island shelves. NOT cassettes (dynamic), NOT genre panels/manager/TV/CRT (dynamic). Defined explicitly in `BAKE_SHELL` (Task 2).
- **Flag:** runtime baked lighting is gated by `?baked=1` (and later a store/env flag). Procedural path stays default until validated on M1.

---

## File Structure

- `src/lib/lightbake/generateAtlas.ts` — vendored: xatlas unwrap → writes `uv1`.
- `src/lib/lightbake/renderAtlas.ts` — vendored: UV-space g-buffer (world position + normal) + seam dilation.
- `src/lib/lightbake/LightmapperMaterial.ts` — vendored: three-mesh-bvh Monte-Carlo raycaster shader (single light).
- `src/lib/lightbake/Lightmapper.ts` — vendored: per-light accumulation loop into a FloatType RT.
- `src/lib/lightbake/buildBakeScene.ts` — **NEW**: pure builder returning the static shell meshes (Standard mats) + the light rig as plain Three objects (reuses room constants + Lighting positions).
- `src/lib/lightbake/bakeShell.ts` — **NEW**: orchestration — unwrap → g-buffer → per-light bake → sum → return `{ lightmapTexture, meshes, scale }`.
- `src/lib/lightbake/constants.ts` — **NEW**: `LIGHTMAP_RESOLUTION`, `LIGHTMAP_SCALE`, `SAMPLES_PER_LIGHT`, `BAKE_SHELL` ids.
- `app/bake/page.tsx` — **NEW**: WebGL2 bake harness; runs `bakeShell`, displays, exposes `window.__bake` (status) + `window.__bakeExport()` (returns `{ glb: ArrayBuffer, png: dataURL, scale }`).
- `scripts/bake.mjs` — **NEW**: Playwright driver; loads `/bake`, waits, calls export, writes `public/baked/shell.glb` + `public/baked/shell-lightmap.png` + `public/baked/manifest.json`.
- `src/components/interior/BakedShell.tsx` — **NEW**: runtime; loads `shell.glb` + lightmap, applies `lightMap`/`lightMapIntensity` (uv1), renders the baked shell.
- `src/components/interior/InteriorScene.tsx` — modify: when `?baked=1`, render `<BakedShell/>` instead of the procedural shell + pass `bakedLighting` to `<Lighting/>`.
- `src/components/interior/Lighting.tsx` — modify: accept `bakedLighting` prop → drop the baked-away RectAreaLights (keep only what's needed for dynamic objects).
- `tests/lightbake/*.test.mjs` — **NEW**: unit tests for pure logic (uv1 rename, multi-light sum bookkeeping, manifest, BAKE_SHELL membership).

---

## Task 0: Remove the disqualified ProgressiveLightMap PoC

**Files:**
- Delete: `src/components/interior/LightBakePoC.tsx`
- Modify: `src/components/interior/InteriorScene.tsx` (remove import + `<LightBakePoC/>`)
- Modify: `src/components/interior/Aisle.tsx` (the `name="bake-floor"`/`name="bake-ceiling"` tags can stay — harmless and reused by the bake scene builder)

- [ ] **Step 1: Remove the PoC wiring**

In `src/components/interior/InteriorScene.tsx` delete the line `import { LightBakePoC } from './LightBakePoC'` and the JSX block:
```tsx
      {/* PoC light-baking spike — gated by ?bake=1 (throwaway, feasibility only) */}
      <LightBakePoC enabled={typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('bake')} />
```

- [ ] **Step 2: Delete the PoC file**

Run: `rm src/components/interior/LightBakePoC.tsx`

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(lightbake): remove disqualified ProgressiveLightMap PoC"
```

---

## Task 1: Vendor + adapt the baker core (uv1)

**Files:**
- Create: `src/lib/lightbake/generateAtlas.ts`
- Create: `src/lib/lightbake/renderAtlas.ts`
- Create: `src/lib/lightbake/LightmapperMaterial.ts`
- Create: `src/lib/lightbake/Lightmapper.ts`

- [ ] **Step 1: Fetch the four source files**

```bash
mkdir -p src/lib/lightbake
B=https://raw.githubusercontent.com/lucas-jones/three-lightmap-baker/main/src
curl -s "$B/atlas/generateAtlas.ts"      -o src/lib/lightbake/generateAtlas.ts
curl -s "$B/atlas/renderAtlas.ts"        -o src/lib/lightbake/renderAtlas.ts
curl -s "$B/lightmap/LightmapperMaterial.ts" -o src/lib/lightbake/LightmapperMaterial.ts
curl -s "$B/lightmap/Lightmapper.ts"     -o src/lib/lightbake/Lightmapper.ts
```

- [ ] **Step 2: Adapt `generateAtlas.ts` to write `uv1` and load WASM locally**

Change the `packAtlas` output channel and the WASM URLs. Replace the body of `generateAtlas` and `loadXAtlasThree`:
```ts
import { BufferAttribute, Mesh } from 'three'
import { UVUnwrapper } from 'xatlas-three'

const unwrapper = new UVUnwrapper({ BufferAttribute })

export const loadXAtlasThree = async () => {
  await unwrapper.loadLibrary(
    () => {},
    'https://cdn.jsdelivr.net/npm/xatlasjs@0.1.0/dist/xatlas.wasm',
    'https://cdn.jsdelivr.net/npm/xatlasjs@0.1.0/dist/xatlas.js',
  )
}

export const generateAtlas = async (meshes: Mesh[]) => {
  const geometry = meshes.map((m) => m.geometry)
  unwrapper.packOptions.padding = 4
  // Write into a temp 'uv2' then rename → 'uv1' (three lightMap samples uv1).
  await unwrapper.packAtlas(geometry, 'uv2', 'uv')
  for (const g of geometry) {
    const uv2 = g.getAttribute('uv2')
    if (uv2) { g.setAttribute('uv1', uv2); g.deleteAttribute('uv2') }
  }
}
```

- [ ] **Step 3: Adapt `renderAtlas.ts` to read `uv1`**

In both vertex shaders, replace `attribute vec2 uv2;` → `attribute vec2 uv1;` and `(uv2 + offset)` → `(uv1 + offset)` (two occurrences). Everything else (the FloatType targets, the dilation `offsets` loop) is unchanged.

- [ ] **Step 4: Keep `LightmapperMaterial.ts` and `Lightmapper.ts` as-is**

They use `three-mesh-bvh` exports `shaderStructs`, `shaderIntersectFunction`, `MeshBVHUniformStruct` (present in 0.9.10) and read the position/normal g-buffer textures — no uv changes needed. Confirm the imports resolve.

- [ ] **Step 5: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0. (If `three-mesh-bvh` GLSL exports moved, the failure names them — fix the import path then.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/lightbake
git commit -m "feat(lightbake): vendor three-lightmap-baker core, adapted to uv1"
```

---

## Task 2: Static-shell scene builder + constants

**Files:**
- Create: `src/lib/lightbake/constants.ts`
- Create: `src/lib/lightbake/buildBakeScene.ts`
- Test: `tests/lightbake/build-scene.test.mjs`

- [ ] **Step 1: Constants**

`src/lib/lightbake/constants.ts`:
```ts
export const LIGHTMAP_RESOLUTION = 2048
export const SAMPLES_PER_LIGHT = 256
export const LIGHTMAP_SCALE = 4.0 // HDR→PNG pack divisor; runtime lightMapIntensity
// Mesh ids that make up the bakeable static shell.
export const BAKE_SHELL = [
  'floor', 'ceiling', 'wall-north', 'wall-left', 'wall-right',
  'shelf-0','shelf-1','shelf-2','shelf-3','shelf-4','shelf-5','shelf-6','shelf-7',
  'island-0','island-1',
] as const
```

- [ ] **Step 2: Scene builder**

`src/lib/lightbake/buildBakeScene.ts` builds the shell geometry + lights as plain Three objects. It reuses `ROOM_WIDTH/HEIGHT/DEPTH` from `src/components/interior/constants.ts` and the light positions from `Lighting.tsx`. Because the procedural shell currently lives inside R3F components, **this builder duplicates the geometry definitions** (walls/floor/ceiling/shelves) using the same constants. Provide the full builder:
```ts
import * as THREE from 'three'
import { ROOM_WIDTH, ROOM_HEIGHT, ROOM_DEPTH } from '../../components/interior/constants'

export type BakeScene = { scene: THREE.Scene; meshes: THREE.Mesh[]; lights: THREE.Light[] }

const standard = (color = 0xc8c0b8, roughness = 0.6) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 })

export function buildBakeScene(): BakeScene {
  const scene = new THREE.Scene()
  const meshes: THREE.Mesh[] = []

  const add = (name: string, geo: THREE.BufferGeometry, pos: THREE.Vector3Tuple, rot: THREE.Vector3Tuple) => {
    const m = new THREE.Mesh(geo, standard())
    m.name = name; m.position.set(...pos); m.rotation.set(...rot)
    scene.add(m); meshes.push(m); return m
  }

  add('floor', new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH), [0, 0, 0], [-Math.PI / 2, 0, 0])
  add('ceiling', new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH), [0, ROOM_HEIGHT, 0], [Math.PI / 2, 0, 0])
  add('wall-north', new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_HEIGHT), [0, ROOM_HEIGHT / 2, -ROOM_DEPTH / 2], [0, 0, 0])
  add('wall-left', new THREE.PlaneGeometry(ROOM_DEPTH, ROOM_HEIGHT), [-ROOM_WIDTH / 2, ROOM_HEIGHT / 2, 0], [0, Math.PI / 2, 0])
  add('wall-right', new THREE.PlaneGeometry(ROOM_DEPTH, ROOM_HEIGHT), [ROOM_WIDTH / 2, ROOM_HEIGHT / 2, 0], [0, -Math.PI / 2, 0])
  // NOTE: shelf-0..7 / island-0..1 geometry is added in Task 2b once the exact
  // shelf transforms are read from WallShelf.tsx / IslandShelf.tsx / Aisle.tsx.

  // Lights — mirror Lighting.tsx desktop rig as plain RectAreaLights.
  const lights: THREE.Light[] = []
  const rect = (i: number, w: number, h: number, pos: THREE.Vector3Tuple, rot: THREE.Vector3Tuple, color = 0xfff5e6) => {
    const l = new THREE.RectAreaLight(color, i, w, h)
    l.position.set(...pos); l.rotation.set(...rot); scene.add(l); lights.push(l)
  }
  rect(4.0, 0.4, 7.0, [-3.3, 2.68, 0], [-Math.PI / 2, 0, 0], 0xf0f5ff)
  rect(4.0, 0.4, 7.0, [3.8, 2.68, 0], [-Math.PI / 2, 0, 0], 0xf0f5ff)
  // ... remaining lights copied 1:1 from Lighting.tsx in Task 2b.

  return { scene, meshes, lights }
}
```

- [ ] **Step 2b: Fill in shelf geometry + remaining lights**

Read `WallShelf.tsx`, `IslandShelf.tsx`, `Aisle.tsx` (the `computeWallShelfCassettes`/island placement gives the shelf transforms) and `Lighting.tsx` (all 14 RectAreaLights + 3 PointLights + hemisphere + directional). Add each shelf as a `BoxGeometry` at its transform and each light with its exact params. (No placeholder — transcribe the real values.)

- [ ] **Step 3: Failing test — shell membership**

`tests/lightbake/build-scene.test.mjs`:
```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { BAKE_SHELL } from '../../src/lib/lightbake/constants.ts'

test('BAKE_SHELL lists floor/ceiling/walls/shelves/islands', () => {
  assert.ok(BAKE_SHELL.includes('floor'))
  assert.ok(BAKE_SHELL.includes('ceiling'))
  assert.equal(BAKE_SHELL.filter((n) => n.startsWith('shelf-')).length, 8)
  assert.equal(BAKE_SHELL.filter((n) => n.startsWith('island-')).length, 2)
})
```
(`build-scene` itself needs a DOM/GL context, so it is verified visually in the bake page, Task 4 — not unit-tested.)

- [ ] **Step 4: Run test**

Run: `node --test tests/lightbake/build-scene.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/lightbake tests/lightbake
git commit -m "feat(lightbake): static-shell scene builder + constants"
```

---

## Task 3: Bake orchestration (multi-light sum)

**Files:**
- Create: `src/lib/lightbake/bakeShell.ts`

- [ ] **Step 1: Orchestration**

`bakeShell.ts` ties the vendored pieces together: unwrap → g-buffer → per-light Monte-Carlo bake into a FloatType RT, summed across lights via additive blending.
```ts
import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { generateAtlas, loadXAtlasThree } from './generateAtlas'
import { renderAtlas } from './renderAtlas'
import { generateLightmapper } from './Lightmapper'
import { LIGHTMAP_RESOLUTION, SAMPLES_PER_LIGHT } from './constants'
import type { BakeScene } from './buildBakeScene'

export type BakeResult = { lightmap: THREE.Texture; meshes: THREE.Mesh[] }

export async function bakeShell(
  renderer: THREE.WebGLRenderer,
  bake: BakeScene,
  onProgress?: (p: number) => void,
): Promise<BakeResult> {
  await loadXAtlasThree()
  await generateAtlas(bake.meshes) // writes uv1 atlas

  // Merge shell geometry into one BVH (occluders for raycasting).
  const merged = bake.meshes.map((m) => {
    const g = m.geometry.clone()
    g.applyMatrix4(m.matrixWorld.clone().identity().compose(m.position, m.quaternion, m.scale))
    return g
  })
  // (Use BufferGeometryUtils.mergeGeometries in implementation; positions in world space.)
  const bvhGeo = mergeWorld(bake.meshes)
  const bvh = new MeshBVH(bvhGeo)

  const { positionTexture, normalTexture } = renderAtlas(renderer, bake.meshes, LIGHTMAP_RESOLUTION)

  // Accumulation target (sum of all lights).
  const sum = new THREE.WebGLRenderTarget(LIGHTMAP_RESOLUTION, LIGHTMAP_RESOLUTION, { type: THREE.FloatType })

  const rectLights = bake.lights.filter((l) => (l as THREE.RectAreaLight).isRectAreaLight) as THREE.RectAreaLight[]
  for (let i = 0; i < rectLights.length; i++) {
    const L = rectLights[i]
    const lm = generateLightmapper(renderer, positionTexture, normalTexture, bvh, {
      resolution: LIGHTMAP_RESOLUTION,
      casts: 4,
      lightPosition: L.getWorldPosition(new THREE.Vector3()),
      lightSize: Math.max(L.width, L.height),
      filterMode: THREE.LinearFilter,
      directLightEnabled: true,
      indirectLightEnabled: true,
      ambientLightEnabled: true,
      ambientDistance: 1.5,
    })
    for (let s = 0; s < SAMPLES_PER_LIGHT; s++) lm.render()
    addInto(renderer, sum, lm.renderTexture) // additive blit
    onProgress?.((i + 1) / rectLights.length)
  }

  return { lightmap: sum.texture, meshes: bake.meshes }
}
```
Implement the helpers `mergeWorld(meshes)` (clone each geometry, bake its world matrix in, `mergeGeometries`), and `addInto(renderer, target, tex)` (fullscreen quad, `AdditiveBlending`, render `tex` into `target`). Provide both fully in the implementation (no placeholder).

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/lightbake/bakeShell.ts
git commit -m "feat(lightbake): bake orchestration with per-light summation"
```

---

## Task 4: Bake harness page (`/bake`)

**Files:**
- Create: `app/bake/page.tsx`

- [ ] **Step 1: Page**

A `'use client'` page that creates a `WebGLRenderer`, builds the scene, runs `bakeShell`, displays the lit shell with the lightmap applied, and exposes `window.__bake` (`{status, progress}`) + `window.__bakeExport()` returning `{ glb, png, scale }`. Use `GLTFExporter` for the GLB (geometry incl. `uv1`) and pack the HDR lightmap to PNG via a fullscreen tonemap pass (`÷ LIGHTMAP_SCALE`, clamp, `canvas.toDataURL`). Provide the full component in implementation. Verification is in Task 4 Step 2.

- [ ] **Step 2: Verify the bake renders (Playwright)**

Start dev: `PORT=3001 npm run dev`. Then:
```bash
npx playwright ... # or drive via the bake.mjs harness in Task 5
```
Load `http://localhost:3001/bake`, wait for `window.__bake.status === 'done'`, screenshot. Expected: the shell shows soft baked shadows/AO; `window.__bakeExport()` returns non-null `glb` (ArrayBuffer > 0) and `png` (dataURL).

- [ ] **Step 3: Commit**

```bash
git add app/bake/page.tsx
git commit -m "feat(lightbake): WebGL2 bake harness page"
```

---

## Task 5: Offline driver (`scripts/bake.mjs`)

**Files:**
- Create: `scripts/bake.mjs`
- Modify: `package.json` (add `"bake": "node scripts/bake.mjs"`)

- [ ] **Step 1: Playwright driver**

Loads `/bake`, waits for `done`, calls `window.__bakeExport()`, decodes the dataURL PNG + the GLB ArrayBuffer, writes `public/baked/shell.glb`, `public/baked/shell-lightmap.png`, `public/baked/manifest.json` (`{ scale, resolution, bakedAt }`). Full script in implementation.

- [ ] **Step 2: Run the bake**

Run: `PORT=3001 npm run dev` (separate shell) then `npm run bake`
Expected: `public/baked/shell.glb` + `shell-lightmap.png` + `manifest.json` written; manifest `scale === 4`.

- [ ] **Step 3: Commit**

```bash
git add scripts/bake.mjs package.json public/baked
git commit -m "feat(lightbake): offline Playwright bake driver + baked assets"
```

---

## Task 6: Runtime integration (`BakedShell`) + flag

**Files:**
- Create: `src/components/interior/BakedShell.tsx`
- Modify: `src/components/interior/InteriorScene.tsx`
- Modify: `src/components/interior/Lighting.tsx`

- [ ] **Step 1: `BakedShell.tsx`**

Loads `public/baked/shell.glb` (`useGLTF`) + `public/baked/shell-lightmap.png` (`useTexture`, set `colorSpace = NoColorSpace`, `flipY = false`, `channel = 1`). For each loaded mesh: `material.lightMap = tex; material.lightMapIntensity = manifest.scale`. Renders the baked group. Full component in implementation.

- [ ] **Step 2: Gate in `InteriorScene.tsx`**

```tsx
const baked = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('baked')
// when baked: render <BakedShell/> and pass bakedLighting to <Lighting/> (procedural shell still renders cassettes etc.)
<Lighting isMobile={isMobile} bakedLighting={baked} />
{baked && <BakedShell />}
```

- [ ] **Step 3: `Lighting.tsx` drops baked-away lights**

Add prop `bakedLighting?: boolean`. When true, **do not render** the 14 RectAreaLights / hemisphere that the bake replaced; keep only what dynamic objects (cassettes/manager) still need (decide during impl — likely 1–2 cheap fills + the emissive neon). Directional shadow can stay or go.

- [ ] **Step 4: Verify A/B + no errors (Playwright)**

Load `/?baked=1`, enter, wait for scene. Screenshot. Compare to `/` (procedural). Expected: shell shows baked soft shadows/AO; 0 console errors; the 14 RectAreaLights are gone from the render.

- [ ] **Step 5: Commit**

```bash
git add src/components/interior/BakedShell.tsx src/components/interior/InteriorScene.tsx src/components/interior/Lighting.tsx
git commit -m "feat(lightbake): runtime baked-shell lighting (flag-gated)"
```

---

## Task 7: Validation checkpoint (M1) — STOP for user

- [ ] **Step 1: User validates on Mac Mini M1**

Build (`npm run build`) + run; on the M1, compare `/` vs `/?baked=1`: (a) visual realism of the shell (soft shadows + AO), (b) FPS while walking. Record numbers. **Do not proceed to A+ until the user confirms A is good.**

---

## Phase A+ (after A validated): colored indirect (color bleed)

## Task 11: Albedo g-buffer

**Files:**
- Modify: `src/lib/lightbake/renderAtlas.ts`
- Modify: `src/lib/lightbake/bakeShell.ts`

- [ ] **Step 1:** Add a third UV-space pass to `renderAtlas` that outputs each mesh's **albedo** (material `color`/`map`) into a FloatType atlas texture (same `uv1` projection as position/normal).
- [ ] **Step 2:** Return `albedoTexture` from `renderAtlas`; thread it into `bakeShell` → `generateLightmapper`.
- [ ] **Step 3:** Commit.

## Task 12: Colored bounce in the raycaster

**Files:**
- Modify: `src/lib/lightbake/LightmapperMaterial.ts`

- [ ] **Step 1:** Add an `albedo` sampler uniform. In the indirect-bounce branch, multiply the bounced radiance by the albedo sampled at the hit's UV (requires carrying UV through the BVH hit — use `three-mesh-bvh`'s barycentric UV interpolation). This turns grayscale indirect into colored bleed.
- [ ] **Step 2:** Re-bake (`npm run bake`), reload `/?baked=1`, screenshot. Expected: warm/colored bounce visible (e.g., wall colour on the floor).
- [ ] **Step 3:** Commit.

---

## Risks & mitigations

- **xatlas overlap on merged/box geometry** → seams/leaks. Mitigation: `packOptions.padding = 4` + the dilation pass in `renderAtlas`; inspect the atlas in `/bake`.
- **three-mesh-bvh GLSL export drift** (0.9.10) → Task 1 Step 5 catches it; pin or adjust import.
- **HDR range clipped by PNG pack** → if bright spots clip, raise `LIGHTMAP_SCALE` or move to half-float KTX2 (note in manifest).
- **`uv1` mismatch bake↔runtime** → solved by shipping the unwrapped `shell.glb` (single source of geometry+uv1); runtime never re-unwraps.
- **Bake time** (14 lights × 256 samples) → offline only; if too slow, lower `SAMPLES_PER_LIGHT` or `LIGHTMAP_RESOLUTION` per the `/bake` progress readout.
- **Shared materials** (`SHARED_WALL_MATERIAL`) → the baked GLB carries its own per-mesh materials; runtime uses the GLB's materials with the shared atlas lightMap. No conflict with the procedural shared material (procedural shell is disabled when baked).
