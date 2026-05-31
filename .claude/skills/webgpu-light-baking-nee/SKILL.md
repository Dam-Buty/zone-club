---
name: webgpu-light-baking-nee
description: Use when a WebGPU/TSL lightmap or GI bake (three-mesh-bvh hemisphere gather) is noisy/grainy at reasonable sample counts, leaves surfaces far from small bright emitters (neon signs, tubes, strips) dark/black, lacks crisp cast shadows, shows black UV seams or light leaks, OR when a seemingly-correct bake lights NOTHING at runtime / only some surfaces (WebGPU `material.lightMap` ignored, or a uv-flip atlas mismatch).
---

# Next-Event Estimation for WebGPU/TSL Light Baking

## Overview

A pure hemisphere-gather bake (shoot random rays from each texel, hope they hit a light) is the #1 cause of noise AND dark surfaces in a lightmap. Small bright emitters (neon signs, tubes) are rarely hit by chance → the estimator's variance explodes, and surfaces far from them (the floor under high signs) stay black at any sample count.

**Next-Event Estimation (NEE) = at every shaded point, sample the emitters DIRECTLY**: pick a point on each light, cast one shadow ray, add its contribution if unoccluded. It's path-tracing ABC and the single biggest quality lever — it fixes noise, dark surfaces, AND gives real cast shadows in one pass.

But a bake that is *mathematically* correct can still be *unusable*: black UV seams, leaks and bias are **pipeline** bugs, not estimator bugs. This skill covers both.

## When to use

- A bake/GI gather is grainy at hundreds of samples.
- Surfaces far from small emitters read dark/black.
- No crisp cast shadows from occluders.
- Tiny/bright area lights dominate (signs, tubes, strips).
- Black seams / light leaks in the lightmap (pipeline section).
- Stack: `three-mesh-bvh` (`/webgpu` TSL raycaster) + a WebGPU/TSL UV-space bake.

**Not for:** already-converged bakes, or scenes lit only by a big smooth environment (the lights aren't small → hemisphere gather is fine).

## Where NEE fits — the bake pipeline

NEE is step 4. Getting the surrounding steps right is what makes it *usable*:

```
1. Collect bakeable geometry → build BVH (occluders included)
2. Lightmap-UV atlas (the `uv1` channel) + valid-texel mask   (see "UV note" — procedural, NOT xatlas)
3. UV-space GBuffer: worldPos, RAW geometry normal, albedo, emission, validMask
4. DIRECT (NEE): per texel, sample each emitter → BVH shadow ray → accumulate
5. INDIRECT bounce: hemisphere gather, read REFLECTED radiance only (emitters → 0)
6. Accumulation (more samples / ping-pong)
7. DILATION: flood valid texels outward past chart borders (kills black seams)
8. Export (PNG/EXR/DataTexture) → apply at runtime (WebGPU: via emissiveNode, NOT material.lightMap — see "Applying the bake at runtime")
```

**A single UV-space fragment pass** that computes worldPos/normal on the fly (no separate GBuffer, no compute) is a valid simpler form; the GBuffer + compute-pass + `StorageTexture` version is the scalable upgrade, not a prerequisite.

**UV note (terminology + our choice):** a lightmap ALWAYS needs its own UV set, separate from the diffuse-texture UV — in Three.js r184 that is the **`uv1`** attribute (channel 1; "UV2" is the industry's old name for the same thing). We DO produce it, but **procedurally** (`applyShellUv1`: planar-per-slot projection + gutter), NOT with **xatlas**. xatlas (`xatlas-three`) is the standard auto-unwrapper, but it is **non-deterministic and mutates geometry**, so it can't be recomputed identically at runtime → it would force shipping a UV asset. Planar projection is deterministic and distortion-free for **flat** surfaces; reserve xatlas for curved geometry it would stretch.

## The estimator (rectangular area light, diffuse surface)

```
L_direct = (ρ/π) · mean_S [ V · L_e · cosθ_P · cosθ_L · area / dist² ]
```

- `x_L` = a point sampled on the light; `dist = |x_L − P|`; `ω = (x_L − P)/dist`
- `cosθ_P = max(0, N·ω)` — surface faces light; `cosθ_L = max(0, N_L·(−ω))` — light faces point
- `V` = visibility (shadow ray P→x_L unoccluded); `area = 1/pdf_A` (uniform area sampling)
- `area·cosθ_L/dist²` together convert the area-measure pdf to solid angle
- For MIS you compare in solid-angle measure: `pdf_solidangle = pdf_area · dist² / cosθ_L`

## Algorithm (per texel)

```
P = worldPos[texel]; N = rawGeometryNormal[texel]; ρ = albedo[texel]
direct = 0
for each emitter (or one importance-picked emitter, S samples):
  accum = 0
  for s in S:
    u,v = rng2D()
    xL  = corner + u·edge1 + v·edge2
    NL  = normalize(cross(edge1, edge2));  area = length(cross(edge1, edge2))
    d   = xL − P;  dist2 = dot(d,d);  dist = sqrt(dist2);  ω = d/dist
    cosP = max(0, dot(N, ω));  cosL = max(0, dot(NL, −ω))
    if cosP<=0 || cosL<=0: continue
    if bvhAnyHit(P + N·ε, ω, dist − 2·ε): continue   // ← shadow ray (occluded)
    accum += L_e · cosP · cosL · area / dist2
  direct += ρ/π · accum / S
L_out = emission_self + direct + L_indirect
```

## Avoiding double-counting (the #1 trap)

NEE computes direct light. If the indirect hemisphere gather ALSO adds an emitter's emission when a bounce ray hits it, direct light is counted twice → too bright AND still noisy.

- **Diffuse bake (recommended):** indirect reads only reflected radiance (previous lightmap × albedo at the hit). Emitters contribute 0 to indirect.
- **MIS (only if you keep BSDF-sampled hits on lights):** balance heuristic `w = pdf_light/(pdf_light+pdf_bsdf)`. Overkill for a pure-diffuse bake.

## Lightmap-pipeline artifacts (NOT estimator bugs)

A black seam or a leak is a *data* bug, not a sampling bug. Triage separately:

| Symptom | Likely cause | Fix |
|---|---|---|
| Black seams at chart borders | no dilation / too little padding | **dilation** post-pass + gutter in the atlas |
| Whole surfaces black, in opposite-normal pairs | `normalWorld` flipped on two-sided faces | use the **raw geometry normal** (unflipped) |
| Speckled "surface acne" shadows | shadow-ray self-hit | origin `P + N·ε`, max length `dist − 2·ε` |
| Light leaks through thin walls | bias too high / use of smooth normal | bake against the **face normal**; thin walls need geometry, not bias |
| Dark band at curved silhouettes | shadow terminator on low-poly smooth shading | offset along face normal / shadow-terminator fix |
| Stretched / blurry on big surfaces | uneven texel density (square slot) | aspect-correct slot or area-proportional packing |
| **Bake looks perfect but surfaces stay BLACK at runtime (WebGPU)** | **`material.lightMap` silently ignored** — attached after the material's first compile, node graph never re-runs `setupLightMap` | apply the atlas via an explicit `emissiveNode`/`colorNode` at uv1, NOT `material.lightMap` — see **"Applying the bake at runtime"** |
| **Only SOME surfaces lit (e.g. two opposite walls), the rest black** | bake-WRITE uv ≠ runtime-READ uv (a stray `.flipY()`); a full-atlas V-flip shoves some slot-rows into the atlas's UNUSED rows | identical uv1 mapping on write & read (no flip); EVERY reader agrees (shell sample + probe `textureLoad`) |
| Low-frequency cloudiness / marbling on big flat surfaces | INDIRECT-gather variance (too few hemisphere samples) — NOT fireflies | more `samples` + denoise/blur + a bounce; the radiance **clamp does NOT help here** (it's direct-only) |
| Cloudy / marbled ONLY around a long thin emitter close to its surface | near-field strip variance under uniform area sampling | **subdivide the strip into short ~square segments** (same energy, stratified) + sane standoff distance |

## Applying the bake at runtime — the WebGPU surprise (cost us a day)

A *mathematically correct* bake can light **nothing** because the runtime never reads it. Two failures, both invisible until you isolate (see "Auditing" below). These are NOT estimator bugs.

**1. `material.lightMap` is silently ignored by the WebGPU `MeshStandardMaterial`** when the lightMap is attached AFTER the material's first compile (the normal case — you bake a second or two after the meshes mount). The node graph's `setupLightMap` runs once, at first build, *without* the lightMap; a later `mat.lightMap = tex; mat.needsUpdate = true` — even with `lightMap.channel = 1` and `flipY = false` — does NOT re-insert the irradiance node. The surface stays lit only by the environment/IBL, which is easy to misread as "the bake is too weak." (May-2026 three forum: *"lightMap not using uv1 in MeshStandardMaterial, works in ShaderMaterial."*)

**Fix — drive the atlas through an explicit TSL node**, the same path that already works for dynamic receivers (SH probes / instanced objects):
```js
const lm   = texture(lightmap, uv(1))                  // sample the atlas at the lightmap UV
const base = mat.map ? texture(mat.map) : vec3(mat.color.r, mat.color.g, mat.color.b)
mat.emissiveNode = base.mul(lm.rgb).mul(intensityUniform) // emissive-ADD ≈ outgoing radiance
mat.needsUpdate = true
```
The bake stores irradiance×albedo, so adding it as emissive ≈ the diffuse outgoing radiance, and it survives "no analytical lights" baked mode (a `colorNode` multiply would render black there). Modulate by the surface's own albedo (`mat.map`/`mat.color`) so each surface keeps its identity. Make `intensityUniform` a live `uniform()` so you tune intensity without re-baking.

**2. Bake-WRITE uv must EXACTLY match runtime-READ uv — including any V-flip.** The UV-space bake rasterizes each surface by mapping its `uv1` to clip space (`unwrap = (uv1 − 0.5)·2`). If you `.flipY()` there but read the atlas at raw `uv1` at runtime (or vice-versa), the content lands at a different V than where it's read. **Far worse with a partially-used atlas:** a full-atlas V-flip moves the top slot-row's surfaces into the UNUSED bottom row → those surfaces read pure black, while the middle row happens to align → the diagnostic **"only some surfaces (e.g. two opposite walls) are lit."** Use the IDENTITY mapping (surface point U → texel U → read U), no flip, and make EVERY reader agree: the shell `texture(lightmap, uv(1))` AND the probe `textureLoad(lightmap, uv1·res)`.

### Auditing "is the bake even being applied?"
Isolate, don't guess. Kill every OTHER light contribution and amplify the bake:
- `environmentIntensity → 0`, object self-illum → 0, probe/SH term → 0, lightmap intensity → high.
- Surfaces still **black** ⇒ the lightmap isn't contributing → a *plumbing* bug (above), not a bake-value bug.
- **Plumbing vs values:** make the gather `return vec3f(1.0)` (constant). Shell still black ⇒ application/UV bug (not the estimator). Shell white ⇒ the values are the issue.
- **Material vs lightMap path:** set `material.emissive` to a solid colour (no map). Surface turns that colour ⇒ the material renders fine, so it's specifically the lightMap path being dropped.
- **See the atlas:** show `texture(lightmap, uv(0))` on a full-0..1-UV surface to eyeball which slots actually got content.

## Noise: the clamp is DIRECT-only; cloudiness is INDIRECT variance

- A **radiance clamp** (cap per-sample luminance) kills **fireflies** from the DIRECT NEE term (a sample landing very close to an emitter → `area/dist²` spike). It does NOT touch the indirect hemisphere gather. Cranking it *up* does nothing for cloudiness; cranking it to a huge value just disables firefly suppression.
- Low-frequency **cloudiness / marbling** on big surfaces is **indirect-gather variance** → fix with more `samples` + a denoise/blur pass (+ a bounce), not a tighter clamp.
- **Near-field strip emitters** (a long ceiling tube ~0.05–0.25 m from the ceiling it lights): uniform area sampling has huge per-texel variance (most samples land far along the strip) → cloudy even with clamp+denoise. **Subdivide the strip into short ~square segments** (same area, radiance, total power) → stratified → low variance. Pair with a sane standoff so `area/dist²` isn't absurd (≈0.04 m blew into fireflies; ≈0.25 m + clamp was clean).

## Implementation priority order

```
1 NEE uniform-area sampling     5 dilation
2 robust shadow ray (ε/maxT)    6 progressive accumulation
3 direct/indirect separation    7 MIS (only if needed)
4 clean UV-space GBuffer        8 solid-angle rect sampling (Ureña)
                                9 denoise / reprojection
                               10 many-light importance sampling
```
Don't start at MIS or spherical-rectangle sampling — they don't compensate for an unstable GBuffer/UV/BVH base.

## Validation test matrix

| Test | Expected |
|---|---|
| A — big area light (Cornell-box) | clean direct + visible soft shadow |
| B — tiny neon rectangle | huge noise drop vs hemisphere-only gather |
| C — occluder between texel & light | shadow ray blocks the direct term |
| D — no occlusion | falloff matches `cosθ_P·cosθ_L/dist²` |
| E — deliberate double-count (emitter added in indirect) | too bright → proves the trap is caught |
| F — UV seam, no dilation vs dilation | black seam → reduced seam |

## Reference pattern (three-gpu-pathtracer — our three-mesh-bvh stack)

`directLightContribution`: pick a light → `randomLightSample` (direction, pdf, emission, dist) → reject if `dot(faceNormal,dir)<0` → shadow ray via `attenuateHit` (BVH occlusion) → BSDF pdf → `misHeuristic(lightPdf,bsdfPdf)` (=1.0 for delta lights) → `emission·throughput·bsdf·misWeight/lightPdf`. We mirror this **minus MIS** (diffuse-only).

## Why it works

NEE removes the lottery of randomly hitting small lights: every texel gets every *visible* light's direct contribution via one shadow ray each → smooth result, all surfaces lit, true cast shadows, an order of magnitude fewer samples.

## Sources

- **three-gpu-pathtracer** (gkjohnson) — `directLightContribution`, lights, MIS, on three-mesh-bvh. github.com/gkjohnson/three-gpu-pathtracer
- **three-mesh-bvh** `/webgpu` — shadow-ray / occlusion (any-hit). github.com/gkjohnson/three-mesh-bvh
- **three-lightmap-baker** (lucas-jones) — UV-space bake pipeline reference (WebGL2; we use WebGPU/TSL). github.com/lucas-jones/three-lightmap-baker (issue #9: denoise/dilation)
- **PBRT v4** "A Better Path Tracer" / v3 "Direct Lighting" — why NEE/MIS (variance). pbr-book.org
- **Saarland NEE+MIS assignment** — naive→NEE→MIS, the double-count pitfall, area→solid-angle pdf. graphics.cg.uni-saarland.de
- **Ureña, Fajardo, King 2013** — spherical-rectangle (solid-angle) sampling upgrade. ugr.es/~curena/publ/2013-egsr
- **ndotl "Baking artifact-free lightmaps on the GPU"** — seams/padding/dilation/bias/leaks. ndotl.wordpress.com
- **xatlas-three / jpcy/xatlas** — auto UV-unwrap generator (standard, but non-deterministic; we use procedural `uv1` instead — see UV note). github.com/repalash/xatlas-three
- **JamesRandall webgpu path tracer (2026)** — modern WebGPU compute architecture. jamesdrandall.com
- **Three.js docs** — WebGPURenderer / TSL / StorageTexture. threejs.org/docs
- **three.js forum (Dec 2025)** "Lightmap not using UV1/UV2 in MeshStandardMaterial (but works in ShaderMaterial)" — corroborates the WebGPU `material.lightMap` failure → sample the atlas explicitly. discourse.threejs.org/t/.../88564
- **This project (May 2026)** — `radiosityBake.ts` (unwrap: identity uv1, no flipY) + `bakeShellRuntime.ts` (apply via `emissiveNode`, `SHELL_LMI` uniform): the two-bug fix that made the shell GI actually render.
