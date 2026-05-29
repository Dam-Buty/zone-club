# Néon-noir Shell Lightmap — Implementation Plan (subsystem 1 of 2)

> 🛑 **SUPERSEDED (29/05/2026) — DO NOT EXECUTE.** This baked direct+AO in **WebGL2** and deferred colour. The spike then proved true colour-bleed is achievable **WebGPU-native**, so the authoritative plan is **`2026-05-29-webgpu-radiosity-lightmap.md`**. Only the néon-noir 7-emitter rig idea carries over. Kept for history only. See `memory/lightbake-workstream.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bake the static shell's néon-noir lighting (soft area-light shadows + AO + indirect) into a `uv1` lightmap **offline**, ship it, and light the shell at runtime via `material.lightMap` instead of the legacy ~14 RectAreaLights — cheaper on the Mac Mini M1 *and* more photoreal.

**Architecture:** A WebGL2 bake page (`/bake`) builds the static shell as plain Three meshes + a **néon-noir emitter rig**, unwraps a `uv1` atlas (xatlas-three), renders a UV-space g-buffer, runs the vendored three-mesh-bvh Monte-Carlo raycaster **once per light, summed**, into an HDR lightmap, and exports `shell.glb` + `shell-lightmap.png`. A Playwright script drives it headless. At runtime, a `?baked=1`-gated `BakedShell` loads the GLB + lightmap (sampled via `uv1`); the procedural shell + the baked-away realtime lights are disabled.

**Tech Stack:** three 0.184 (WebGL2 bake, WebGPU runtime), `three-mesh-bvh` 0.9.10, `xatlas-three` 0.2.1, React/Next App Router, Playwright (`@playwright/test` already used in repo). Branch `lighti-cook`.

**Spec:** `docs/superpowers/specs/2026-05-29-neon-noir-baked-lighting-design.md`. **Supersedes** Tasks 2–7 of `docs/superpowers/plans/2026-05-29-lightmap-bake-pipeline.md` (the legacy-rig transcription is replaced by the néon-noir rig). This plan delivers **Phase 0 + Phase A (shell)**; the irradiance probe volume is **Plan B**, written after this plan's M1 checkpoint.

---

## Prerequisite (already done)

**Task 1 — Vendored baker core (uv1):** DONE at commit `5742dfe`. `src/lib/lightbake/{generateAtlas,renderAtlas,LightmapperMaterial,Lightmapper}.ts` are vendored and adapted to `uv1`; `npx tsc --noEmit` is green. Do **not** redo. This plan starts at Task 2.

## Locked decisions

- **uv channel:** `material.lightMap` is sampled from **`uv1`** in three 0.184.
- **Multi-light:** bake **one RectAreaLight at a time, sum** the HDR results (the vendored raycaster handles one light). The directional moonlight is also summed in.
- **Export pack:** HDR lightmap ÷ `LIGHTMAP_SCALE` → clamp 0–1 → PNG; runtime `lightMapIntensity = LIGHTMAP_SCALE`.
- **Shell scope:** floor, ceiling, 4 walls, 8 wall-shelves, 2 island shelves. NOT cassettes/manager/TV/CRT/genre panels (dynamic).
- **Rig:** néon-noir — keep the physical emitters (ceiling fluo, island overhead, comptoir, vitrine cold, under-shelf strips, directional moonlight), DROP the legacy GI-faking lights (wall-wash, fill PointLights, ceiling-bounce). The 16 emissive neon-tube meshes stay (bloom).
- **Colour-ready:** Phase A bakes with the real (coloured) emitter colours but is validated for shape/shadows first; PNG already RGB.

## File Structure

- `src/lib/lightbake/constants.ts` — **NEW**: bake constants + `BAKE_SHELL` ids.
- `src/lib/lightbake/buildBakeScene.ts` — **NEW**: pure builder → shell meshes (Standard mats) + néon-noir rig as plain Three objects.
- `src/lib/lightbake/bakeShell.ts` — **NEW**: orchestration (unwrap → BVH → g-buffer → per-light sum → HDR texture).
- `app/bake/page.tsx` — **NEW**: WebGL2 harness; runs `bakeShell`, exposes `window.__bake` + `window.__bakeExport()`.
- `scripts/bake.mjs` — **NEW**: Playwright driver → `public/baked/`.
- `src/components/interior/BakedShell.tsx` — **NEW**: runtime baked shell (lightMap uv1).
- `src/components/interior/InteriorScene.tsx` — **MODIFY**: `?baked=1` gate.
- `src/components/interior/Lighting.tsx` — **MODIFY**: `bakedLighting` prop drops baked-away lights.
- `tests/lightbake/constants.test.mjs`, `tests/lightbake/build-scene.test.mjs` — **NEW**: unit tests for pure logic.

---

## Task 2: Bake constants + shell membership

**Files:**
- Create: `src/lib/lightbake/constants.ts`
- Test: `tests/lightbake/constants.test.mjs`

- [ ] **Step 1: Write the failing test**

`tests/lightbake/constants.test.mjs`:
```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { BAKE_SHELL, LIGHTMAP_RESOLUTION, LIGHTMAP_SCALE, SAMPLES_PER_LIGHT } from '../../src/lib/lightbake/constants.ts'

test('BAKE_SHELL lists floor/ceiling/walls/8 shelves/2 islands', () => {
  assert.ok(BAKE_SHELL.includes('floor'))
  assert.ok(BAKE_SHELL.includes('ceiling'))
  assert.equal(BAKE_SHELL.filter((n) => n.startsWith('wall-')).length, 4)
  assert.equal(BAKE_SHELL.filter((n) => n.startsWith('shelf-')).length, 8)
  assert.equal(BAKE_SHELL.filter((n) => n.startsWith('island-')).length, 2)
})

test('bake constants are sane', () => {
  assert.equal(LIGHTMAP_RESOLUTION, 2048)
  assert.equal(LIGHTMAP_SCALE, 4.0)
  assert.ok(SAMPLES_PER_LIGHT >= 64)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/lightbake/constants.test.mjs`
Expected: FAIL — `Cannot find module '.../constants.ts'`.

- [ ] **Step 3: Write the constants**

`src/lib/lightbake/constants.ts`:
```ts
export const LIGHTMAP_RESOLUTION = 2048
export const SAMPLES_PER_LIGHT = 256
export const LIGHTMAP_SCALE = 4.0 // HDR→PNG pack divisor; runtime lightMapIntensity

// Mesh ids that make up the bakeable static shell (one shared atlas covers all).
export const BAKE_SHELL = [
  'floor', 'ceiling',
  'wall-north', 'wall-south', 'wall-left', 'wall-right',
  'shelf-0', 'shelf-1', 'shelf-2', 'shelf-3', 'shelf-4', 'shelf-5', 'shelf-6', 'shelf-7',
  'island-0', 'island-1',
] as const
export type BakeShellId = (typeof BAKE_SHELL)[number]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/lightbake/constants.test.mjs`
Expected: PASS (2 tests).
NB: if Node cannot import `.ts`, run with `node --experimental-strip-types --test tests/lightbake/constants.test.mjs` (Node ≥ 22.6). Confirm the repo's Node version with `node -v` first.

- [ ] **Step 5: Commit**

```bash
git add src/lib/lightbake/constants.ts tests/lightbake/constants.test.mjs
git commit -m "feat(lightbake): bake constants + BAKE_SHELL membership"
```

---

## Task 3: Néon-noir bake-scene builder

**Files:**
- Create: `src/lib/lightbake/buildBakeScene.ts`
- Test: `tests/lightbake/build-scene.test.mjs`

The builder duplicates the shell geometry (the procedural shell lives in R3F components) using the shared room constants, and defines the néon-noir rig as plain Three objects. **The light raycaster reads RectAreaLight world position + size; it does NOT rasterize them — no proxy meshes needed for the shell bake** (proxies are a Plan B concern).

- [ ] **Step 1: Read the real shelf/island transforms**

Read these and copy the exact transforms (do not guess):
- `src/components/interior/Aisle.tsx` — wall-shelf section placement + the 2 islands.
- `src/components/interior/WallShelf.tsx`, `src/components/interior/IslandShelf.tsx` — per-shelf geometry/size.

Record, for each of the 8 wall-shelf sections and 2 islands: center `[x,y,z]`, rotation `[x,y,z]`, and bounding box size `[w,h,d]`. You will pass these to `addBox` in Step 3.

- [ ] **Step 2: Write the failing test (rig inventory)**

`tests/lightbake/build-scene.test.mjs`:
```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { describeBakeRig } from '../../src/lib/lightbake/buildBakeScene.ts'

// describeBakeRig() is a pure, GL-free summary used for unit testing
// (buildBakeScene itself needs a WebGL context, validated visually in Task 5).
test('néon-noir rig: physical emitters kept, GI-fakes dropped', () => {
  const r = describeBakeRig()
  // Ceiling fluo (4) + 2 island overhead + comptoir tube + comptoir overhead + vitrine cold + under-shelf strips
  assert.ok(r.rectAreaLights >= 8, `expected >=8 rect lights, got ${r.rectAreaLights}`)
  assert.equal(r.directionalLights, 1, 'one cold moonlight')
  // GI-faking lights must be gone
  assert.equal(r.pointLights, 0, 'no fill PointLights in the baked rig')
  assert.ok(!r.names.includes('wall-wash'), 'legacy wall-wash dropped')
  assert.ok(!r.names.includes('ceiling-bounce'), 'legacy ceiling-bounce dropped')
})

test('shell has 16 meshes', () => {
  const r = describeBakeRig()
  assert.equal(r.shellMeshCount, 16)
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tests/lightbake/build-scene.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the builder + the pure rig descriptor**

`src/lib/lightbake/buildBakeScene.ts` — full file. Replace the `SHELVES` array with the real transforms read in Step 1.
```ts
import * as THREE from 'three'
import { ROOM_WIDTH, ROOM_HEIGHT, ROOM_DEPTH } from '../../components/interior/constants'
import { BAKE_SHELL } from './constants'

export type BakeScene = {
  scene: THREE.Scene
  meshes: THREE.Mesh[]
  lights: THREE.Light[]
}

const W = ROOM_WIDTH, H = ROOM_HEIGHT, D = ROOM_DEPTH

// Per-shelf transforms — TRANSCRIBED from Aisle.tsx / WallShelf.tsx / IslandShelf.tsx (Step 1).
// shape: [id, center[x,y,z], rot[x,y,z], size[w,h,d]]
const SHELVES: [string, THREE.Vector3Tuple, THREE.Vector3Tuple, THREE.Vector3Tuple][] = [
  // TODO-IMPL: paste the 8 'shelf-N' + 2 'island-N' rows from Step 1 here, e.g.:
  // ['shelf-0', [-W/2 + 0.2, 1.2, -2.0], [0, Math.PI/2, 0], [0.4, 2.0, 3.0]],
]

const standard = (color = 0xc8c0b8, roughness = 0.62) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 })

// néon-noir rig definition — single source of truth, also summarised by describeBakeRig().
type RectDef = { name: string; intensity: number; w: number; h: number; pos: THREE.Vector3Tuple; rot: THREE.Vector3Tuple; color: number }
const RECTS: RectDef[] = [
  // Ceiling fluo tubes (warm key) — pools of warm light
  { name: 'ceiling-0', intensity: 4.0, w: 0.4, h: 7.0, pos: [-3.3, 2.68, 0], rot: [-Math.PI / 2, 0, 0], color: 0xfff2e0 },
  { name: 'ceiling-1', intensity: 2.6, w: 0.4, h: 7.0, pos: [-1.0, 2.68, 0], rot: [-Math.PI / 2, 0, 0], color: 0xfff2e0 },
  { name: 'ceiling-2', intensity: 2.6, w: 0.4, h: 7.0, pos: [ 2.3, 2.68, 0], rot: [-Math.PI / 2, 0, 0], color: 0xfff2e0 },
  { name: 'ceiling-3', intensity: 4.0, w: 0.4, h: 7.0, pos: [ 3.8, 2.68, 0], rot: [-Math.PI / 2, 0, 0], color: 0xfff2e0 },
  // Island overhead
  { name: 'island-top-0', intensity: 1.8, w: 0.6, h: 4.0, pos: [-2.2, 2.68, -0.2], rot: [-Math.PI / 2, 0, 0], color: 0xf0f5ff },
  { name: 'island-top-1', intensity: 1.8, w: 0.6, h: 4.0, pos: [ 0.05, 2.68, -0.2], rot: [-Math.PI / 2, 0, 0], color: 0xf0f5ff },
  // Comptoir warm
  { name: 'comptoir-tube', intensity: 3.0, w: 0.12, h: 1.4, pos: [3, 2.68, 3], rot: [-Math.PI / 2, 0, 0], color: 0xfff5e6 },
  { name: 'comptoir-overhead', intensity: 1.2, w: 3.0, h: 2.0, pos: [2.8, 2.1, 2.5], rot: [-Math.PI / 2, 0, 0], color: 0xffd8b0 },
  // Vitrine cold night portal
  { name: 'vitrine-cold', intensity: 1.4, w: 5.0, h: 2.2, pos: [0.5, 1.4, D / 2 - 0.1], rot: [0, Math.PI, 0], color: 0x5577aa },
  // Under-shelf strips — TODO-IMPL: one thin RectAreaLight per shelf lip, derived from SHELVES (Step 1).
]

const DIRECTIONAL = { intensity: 1.0, color: 0x6688cc, pos: [3, 5, 5] as THREE.Vector3Tuple }

export function buildBakeScene(): BakeScene {
  const scene = new THREE.Scene()
  const meshes: THREE.Mesh[] = []
  const lights: THREE.Light[] = []

  const addPlane = (name: string, w: number, h: number, pos: THREE.Vector3Tuple, rot: THREE.Vector3Tuple) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), standard())
    m.name = name; m.position.set(...pos); m.rotation.set(...rot)
    scene.add(m); meshes.push(m)
  }
  const addBox = (name: string, size: THREE.Vector3Tuple, pos: THREE.Vector3Tuple, rot: THREE.Vector3Tuple) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(...size), standard(0xbdb6ad, 0.7))
    m.name = name; m.position.set(...pos); m.rotation.set(...rot)
    scene.add(m); meshes.push(m)
  }

  addPlane('floor',      W, D, [0, 0, 0],     [-Math.PI / 2, 0, 0])
  addPlane('ceiling',    W, D, [0, H, 0],     [ Math.PI / 2, 0, 0])
  addPlane('wall-north', W, H, [0, H / 2, -D / 2], [0, 0, 0])
  addPlane('wall-south', W, H, [0, H / 2,  D / 2], [0, Math.PI, 0])
  addPlane('wall-left',  D, H, [-W / 2, H / 2, 0], [0,  Math.PI / 2, 0])
  addPlane('wall-right', D, H, [ W / 2, H / 2, 0], [0, -Math.PI / 2, 0])
  for (const [id, pos, rot, size] of SHELVES) addBox(id, size, pos, rot)

  for (const r of RECTS) {
    const l = new THREE.RectAreaLight(r.color, r.intensity, r.w, r.h)
    l.name = r.name; l.position.set(...r.pos); l.rotation.set(...r.rot)
    scene.add(l); lights.push(l)
  }
  const dir = new THREE.DirectionalLight(DIRECTIONAL.color, DIRECTIONAL.intensity)
  dir.name = 'moonlight'; dir.position.set(...DIRECTIONAL.pos)
  scene.add(dir); lights.push(dir)

  return { scene, meshes, lights }
}

// GL-free summary for unit tests.
export function describeBakeRig() {
  return {
    rectAreaLights: RECTS.length,
    directionalLights: 1,
    pointLights: 0,
    names: RECTS.map((r) => r.name),
    shellMeshCount: 6 + SHELVES.length, // floor+ceiling+4 walls + shelves/islands
  }
}
```
NB: the test asserts `shellMeshCount === 16` → `SHELVES` must contain exactly 10 rows (8 shelves + 2 islands). Until Step 1's rows are pasted, the test will report the gap — that is the intended driver, not a placeholder to ship.

- [ ] **Step 5: Paste the real shelf rows + under-shelf strips**

Fill `SHELVES` (10 rows) and the under-shelf `RECTS` entries from Step 1's measurements. Re-run the test.

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test tests/lightbake/build-scene.test.mjs`
Expected: PASS (2 tests). `rectAreaLights >= 8`, `shellMeshCount === 16`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/lightbake/buildBakeScene.ts tests/lightbake/build-scene.test.mjs
git commit -m "feat(lightbake): néon-noir bake-scene builder (physical emitters, no GI-fakes)"
```

---

## Task 4: Bake orchestration (per-light sum → HDR lightmap)

**Files:**
- Create: `src/lib/lightbake/bakeShell.ts`

- [ ] **Step 1: Write the orchestration + helpers (full file)**

`src/lib/lightbake/bakeShell.ts`:
```ts
import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { generateAtlas, loadXAtlasThree } from './generateAtlas'
import { renderAtlas } from './renderAtlas'
import { generateLightmapper } from './Lightmapper'
import { LIGHTMAP_RESOLUTION, SAMPLES_PER_LIGHT } from './constants'
import type { BakeScene } from './buildBakeScene'

export type BakeResult = { lightmap: THREE.Texture; meshes: THREE.Mesh[] }

// Merge all shell geometry (baked into world space) into one geometry for the BVH (occluders).
function mergeWorld(meshes: THREE.Mesh[]): THREE.BufferGeometry {
  const geos = meshes.map((m) => {
    m.updateMatrixWorld(true)
    const g = m.geometry.clone()
    g.applyMatrix4(m.matrixWorld)
    // keep only position+normal to avoid attribute-mismatch in merge
    const keep = new THREE.BufferGeometry()
    keep.setAttribute('position', g.getAttribute('position'))
    if (g.getAttribute('normal')) keep.setAttribute('normal', g.getAttribute('normal'))
    if (g.index) keep.setIndex(g.index)
    return keep.toNonIndexed()
  })
  return BufferGeometryUtils.mergeGeometries(geos, false)
}

// Additively blit `tex` into `target` via a fullscreen quad.
const _addScene = new THREE.Scene()
const _addCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
const _addMat = new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true })
const _addQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), _addMat)
_addScene.add(_addQuad)
function addInto(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, tex: THREE.Texture) {
  _addMat.map = tex
  const prevAutoClear = renderer.autoClear
  renderer.autoClear = false
  renderer.setRenderTarget(target)
  renderer.render(_addScene, _addCam)
  renderer.setRenderTarget(null)
  renderer.autoClear = prevAutoClear
}

export async function bakeShell(
  renderer: THREE.WebGLRenderer,
  bake: BakeScene,
  onProgress?: (p: number) => void,
): Promise<BakeResult> {
  await loadXAtlasThree()
  await generateAtlas(bake.meshes) // writes uv1 atlas in-place

  const bvh = new MeshBVH(mergeWorld(bake.meshes))
  const { positionTexture, normalTexture } = renderAtlas(renderer, bake.meshes, LIGHTMAP_RESOLUTION)

  const sum = new THREE.WebGLRenderTarget(LIGHTMAP_RESOLUTION, LIGHTMAP_RESOLUTION, { type: THREE.FloatType })
  renderer.setRenderTarget(sum); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.setRenderTarget(null)

  // Only RectAreaLights drive the per-light raycaster (the directional is added as a high-altitude rect proxy below).
  const rects = bake.lights.filter((l) => (l as THREE.RectAreaLight).isRectAreaLight) as THREE.RectAreaLight[]
  for (let i = 0; i < rects.length; i++) {
    const L = rects[i]
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
    addInto(renderer, sum, lm.renderTexture.texture)
    onProgress?.((i + 1) / rects.length)
  }

  return { lightmap: sum.texture, meshes: bake.meshes }
}
```
NB: the directional moonlight is baked as a far, large RectAreaLight proxy — add it to `RECTS` in `buildBakeScene` instead of as a `DirectionalLight` if the raycaster (which only consumes rects) must see it. (The current builder keeps it separate; decide in Task 5 once you see the bake — if the moonlight is missing from the lightmap, convert it to a large high-altitude rect.) Document the choice in the commit.

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0. If `three/examples/jsm/utils/BufferGeometryUtils.js` types are missing, import from `three/addons/utils/BufferGeometryUtils.js` (the repo's tsconfig `paths`/`three-webgpu.d.ts` may map one form).

- [ ] **Step 3: Commit**

```bash
git add src/lib/lightbake/bakeShell.ts
git commit -m "feat(lightbake): bake orchestration — per-light sum into HDR lightmap"
```

---

## Task 5: Bake harness page `/bake`

**Files:**
- Create: `app/bake/page.tsx`

- [ ] **Step 1: Write the page (full file)**

`app/bake/page.tsx`:
```tsx
'use client'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { buildBakeScene } from '../../src/lib/lightbake/buildBakeScene'
import { bakeShell } from '../../src/lib/lightbake/bakeShell'
import { LIGHTMAP_SCALE, LIGHTMAP_RESOLUTION } from '../../src/lib/lightbake/constants'

declare global {
  interface Window {
    __bake?: { status: 'init' | 'baking' | 'done' | 'error'; progress: number; error?: string }
    __bakeExport?: () => Promise<{ glb: ArrayBuffer; png: string; scale: number } | null>
  }
}

export default function BakePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    window.__bake = { status: 'init', progress: 0 }
    const canvas = canvasRef.current!
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false })
    renderer.setSize(LIGHTMAP_RESOLUTION, LIGHTMAP_RESOLUTION, false)
    const bake = buildBakeScene()
    let lightmap: THREE.Texture | null = null

    ;(async () => {
      try {
        window.__bake = { status: 'baking', progress: 0 }
        const res = await bakeShell(renderer, bake, (p) => { window.__bake = { status: 'baking', progress: p } })
        lightmap = res.lightmap
        // preview: apply the lightMap to the shell and render to screen
        for (const m of res.meshes) {
          const mat = m.material as THREE.MeshStandardMaterial
          mat.lightMap = lightmap; mat.lightMapIntensity = LIGHTMAP_SCALE; mat.needsUpdate = true
        }
        window.__bake = { status: 'done', progress: 1 }
      } catch (e) {
        window.__bake = { status: 'error', progress: 0, error: String(e) }
      }
    })()

    window.__bakeExport = async () => {
      if (!lightmap) return null
      // 1) GLB with uv1 geometry
      const exporter = new GLTFExporter()
      const glb = await exporter.parseAsync(bake.scene, { binary: true, onlyVisible: false }) as ArrayBuffer
      // 2) tonemap-pack the HDR lightmap to PNG (÷ scale, clamp 0..1)
      const png = packLightmapToPng(renderer, lightmap, LIGHTMAP_SCALE)
      return { glb, png, scale: LIGHTMAP_SCALE }
    }
    return () => { renderer.dispose() }
  }, [])
  return <canvas ref={canvasRef} style={{ width: 512, height: 512 }} />
}

function packLightmapToPng(renderer: THREE.WebGLRenderer, hdr: THREE.Texture, scale: number): string {
  const size = LIGHTMAP_RESOLUTION
  const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.UnsignedByteType })
  const mat = new THREE.ShaderMaterial({
    uniforms: { tMap: { value: hdr }, uScale: { value: scale } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position,1.0);} `,
    fragmentShader: `varying vec2 vUv; uniform sampler2D tMap; uniform float uScale;
      void main(){ vec3 c = texture2D(tMap, vUv).rgb / uScale; gl_FragColor = vec4(clamp(c,0.0,1.0),1.0);} `,
  })
  const scene = new THREE.Scene(); const cam = new THREE.OrthographicCamera(-1,1,1,-1,0,1)
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2), mat))
  renderer.setRenderTarget(rt); renderer.render(scene, cam)
  const buf = new Uint8Array(size*size*4); renderer.readRenderTargetPixels(rt, 0,0,size,size, buf)
  renderer.setRenderTarget(null)
  const c = document.createElement('canvas'); c.width=size; c.height=size
  const ctx = c.getContext('2d')!; const img = ctx.createImageData(size,size); img.data.set(buf); ctx.putImageData(img,0,0)
  return c.toDataURL('image/png')
}
```

- [ ] **Step 2: Verify the bake renders (Playwright, visual)**

Start dev: `PORT=3001 npm run dev` (separate shell). Then drive with Playwright MCP (or `scripts/bake.mjs` from Task 6): load `http://localhost:3001/bake`, poll `window.__bake.status === 'done'` (timeout 180s), screenshot.
Expected: the preview shows the shell with **soft néon-noir baked shadows/AO** (warm pools under ceiling tubes, cold cast near the vitrine, dark corners). `await window.__bakeExport()` returns non-null `{ glb (ArrayBuffer > 0), png (data:image/png...), scale: 4 }`.

- [ ] **Step 3: Commit**

```bash
git add app/bake/page.tsx
git commit -m "feat(lightbake): WebGL2 bake harness page (/bake) + PNG pack + GLB export"
```

---

## Task 6: Offline Playwright bake driver

**Files:**
- Create: `scripts/bake.mjs`
- Modify: `package.json` (add `"bake": "node scripts/bake.mjs"`)

- [ ] **Step 1: Write the driver (full file)**

`scripts/bake.mjs`:
```js
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'

const URL = process.env.BAKE_URL ?? 'http://localhost:3001/bake'
const OUT = 'public/baked'

const browser = await chromium.launch()
const page = await browser.newPage()
page.on('console', (m) => console.log('[bake page]', m.text()))
await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__bake && (window.__bake.status === 'done' || window.__bake.status === 'error'), null, { timeout: 300000 })
const status = await page.evaluate(() => window.__bake)
if (status.status !== 'done') throw new Error('bake failed: ' + (status.error ?? 'unknown'))

const out = await page.evaluate(async () => {
  const r = await window.__bakeExport()
  if (!r) return null
  return { glb: Array.from(new Uint8Array(r.glb)), png: r.png, scale: r.scale }
})
if (!out) throw new Error('export returned null')

await mkdir(OUT, { recursive: true })
await writeFile(`${OUT}/shell.glb`, Buffer.from(out.glb))
const pngB64 = out.png.split(',')[1]
await writeFile(`${OUT}/shell-lightmap.png`, Buffer.from(pngB64, 'base64'))
await writeFile(`${OUT}/manifest.json`, JSON.stringify({ scale: out.scale, resolution: 2048, kind: 'shell-lightmap' }, null, 2))
console.log('baked → public/baked/{shell.glb,shell-lightmap.png,manifest.json}')
await browser.close()
```

- [ ] **Step 2: Add the npm script**

In `package.json` `scripts`, add: `"bake": "node scripts/bake.mjs",`

- [ ] **Step 3: Run the bake**

Run (dev server up on 3001): `npm run bake`
Expected: `public/baked/shell.glb` (> 0 bytes), `shell-lightmap.png` (a 2048² PNG), `manifest.json` with `scale: 4`. Open the PNG — it should look like a recognisable néon-noir lightmap (warm pools, cold vitrine wash, soft AO in corners).

- [ ] **Step 4: Commit**

```bash
git add scripts/bake.mjs package.json public/baked
git commit -m "feat(lightbake): offline Playwright bake driver + baked shell assets"
```

---

## Task 7: Runtime baked shell + flag + drop legacy lights

**Files:**
- Create: `src/components/interior/BakedShell.tsx`
- Modify: `src/components/interior/InteriorScene.tsx`
- Modify: `src/components/interior/Lighting.tsx`

- [ ] **Step 1: Write `BakedShell.tsx` (full file)**

`src/components/interior/BakedShell.tsx`:
```tsx
import { useGLTF, useTexture } from '@react-three/drei'
import { useEffect } from 'react'
import * as THREE from 'three/webgpu'

export function BakedShell() {
  const gltf = useGLTF('/baked/shell.glb')
  const lightmap = useTexture('/baked/shell-lightmap.png')

  useEffect(() => {
    lightmap.flipY = false
    lightmap.colorSpace = THREE.NoColorSpace
    lightmap.channel = 1 // sample from uv1
    lightmap.needsUpdate = true
    // manifest scale is the runtime lightMapIntensity (kept in sync with LIGHTMAP_SCALE = 4.0)
    const intensity = 4.0
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const mat = m.material as THREE.MeshStandardMaterial
      mat.lightMap = lightmap
      mat.lightMapIntensity = intensity
      mat.needsUpdate = true
    })
  }, [gltf, lightmap])

  return <primitive object={gltf.scene} />
}
useGLTF.preload('/baked/shell.glb')
```
NB: if `useTexture`/`useGLTF` from drei misbehave under the WebGPU renderer, load with `THREE.TextureLoader`/`GLTFLoader` in a `useEffect` instead — the repo already uses raw three loaders elsewhere; follow that pattern. Verify `lightmap.channel = 1` actually maps to `uv1` in three 0.184 (it does: `Texture.channel` selects the uv attribute index).

- [ ] **Step 2: Add the `bakedLighting` prop to `Lighting.tsx`**

In `src/components/interior/Lighting.tsx`, change the signature to accept `bakedLighting?: boolean` and, when true, render ONLY the emissive neon tubes (`<NeonTubesInstanced />`) + a single low hemisphere fill — DROP all RectAreaLights, all PointLights, and the directional (they are baked into the lightmap):
```tsx
export function Lighting({ isMobile = false, bakedLighting = false }: { isMobile?: boolean; bakedLighting?: boolean }) {
  if (bakedLighting) {
    return (
      <>
        <hemisphereLight color="#fff8f0" groundColor="#2a3040" intensity={0.08} />
        <NeonTubesInstanced />
      </>
    )
  }
  return <OptimizedLighting isMobile={isMobile} />
}
```
(Move `NeonTubesInstanced` out of `OptimizedLighting` if it is nested, so both paths can render it.)

- [ ] **Step 3: Gate in `InteriorScene.tsx`**

In `src/components/interior/InteriorScene.tsx`, read the flag and swap shell + lighting:
```tsx
const baked = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('baked')
// ...
<Lighting isMobile={isMobile} bakedLighting={baked} />
{baked && <BakedShell />}
{!baked && /* existing procedural shell (Aisle/Storefront/etc.) */}
```
Wrap the existing procedural shell components in `{!baked && ( ... )}` so they don't double-render. Cassettes/manager/TV/CRT stay rendered in BOTH paths (they are dynamic — Plan B lights them).

- [ ] **Step 4: Verify A/B (Playwright, visual)**

`PORT=3001 npm run dev`. Load `http://localhost:3001/?baked=1`, enter the scene, wait for load, screenshot. Compare to `http://localhost:3001/` (procedural).
Expected: baked shell shows soft néon-noir shadows/AO + warm pools + cold vitrine; **0 console errors**; the 14 legacy RectAreaLights + 3 PointLights are absent from the baked render (verify via no realtime light cost / inspect). Cassettes still render (lit by leftover hemisphere for now — Plan B replaces this).

- [ ] **Step 5: Commit**

```bash
git add src/components/interior/BakedShell.tsx src/components/interior/InteriorScene.tsx src/components/interior/Lighting.tsx
git commit -m "feat(lightbake): runtime baked néon-noir shell (flag-gated) + drop legacy lights"
```

---

## Task 8: Néon-noir rig tuning loop (visual)

**Files:**
- Modify: `src/lib/lightbake/buildBakeScene.ts` (rig values only)

- [ ] **Step 1: Compare bake to néon-noir reference, adjust, re-bake**

Open `/bake` (or `/?baked=1`). Against the néon-noir target (warm pools under fluo, coloured neon bite, cold vitrine, dark contrasted corners): tune `RECTS` intensities/colours + the under-shelf strips + the moonlight in `buildBakeScene.ts`. Re-run `npm run bake` after each change. Iterate until the shell reads as néon-noir (not flat, not blown out). If bright spots clip the PNG pack, raise `LIGHTMAP_SCALE` (and the matching `intensity = 4.0` in `BakedShell.tsx`) together.

- [ ] **Step 2: Commit the tuned rig**

```bash
git add src/lib/lightbake/buildBakeScene.ts public/baked
git commit -m "perf(lightbake): tune néon-noir emitter rig from /bake visual review"
```

---

## Task 9: M1 validation checkpoint — STOP for user

- [ ] **Step 1: User validates on Mac Mini M1**

`npm run build` + run; on the M1 compare `/` vs `/?baked=1`: (a) néon-noir realism of the shell (soft shadows + AO + warm/cold contrast), (b) FPS while walking. Record numbers. **Do not start Plan B (irradiance probe volume) until the user confirms the shell bake is good and the M1 FPS headroom is known** — Plan B's probe bake captures cubemaps FROM this lit shell and its runtime cost is gated by this measurement.

---

## Self-review notes

- **Spec coverage (subsystem 1):** rig redesign (Task 3) ✓, shell lightmap bake (Tasks 4-6) ✓, runtime BakedShell + drop legacy lights (Task 7) ✓, néon-noir tuning (Task 8) ✓, M1 checkpoint (Task 9) ✓, Phase 0 "wire shell lightMap" = Task 7 Step 1 ✓ (this is also the probe prerequisite). Colour-ready PNG ✓. Probe volume = Plan B (out of scope here, by design).
- **Known traps carried forward to Plan B** (see `memory/lightbake-probe-bake-traps.md`): Data3DTexture LinearFilter+HalfFloat, RectAreaLight cubemap proxy cards. Not relevant to the shell lightmap (the raycaster reads light positions, not rasterization).
- **Type consistency:** `LIGHTMAP_SCALE = 4.0` (constants) must equal the `intensity` in `BakedShell.tsx` and the manifest `scale` — Task 8 Step 1 keeps them in sync.
- **Placeholder honesty:** Task 3's `SHELVES`/under-shelf rows and Task 4's directional-vs-rect choice are explicit READ-then-fill steps with named sources, not shippable blanks; the unit test fails until `SHELVES` has 10 rows.
