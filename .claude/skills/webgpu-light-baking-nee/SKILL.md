---
name: webgpu-light-baking-nee
description: Use when a WebGPU/TSL lightmap or GI bake (three-mesh-bvh hemisphere gather) is noisy/grainy at reasonable sample counts, leaves surfaces far from small bright emitters (neon signs, tubes, strips) dark/black, lacks crisp cast shadows, or shows black UV seams or light leaks.
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
2. UV2 atlas + valid-texel mask          (see "UV note" below)
3. UV-space GBuffer: worldPos, RAW geometry normal, albedo, emission, validMask
4. DIRECT (NEE): per texel, sample each emitter → BVH shadow ray → accumulate
5. INDIRECT bounce: hemisphere gather, read REFLECTED radiance only (emitters → 0)
6. Accumulation (more samples / ping-pong)
7. DILATION: flood valid texels outward past chart borders (kills black seams)
8. Export (PNG/EXR/DataTexture) → material.lightMap
```

**A single UV-space fragment pass** that computes worldPos/normal on the fly (no separate GBuffer, no compute) is a valid simpler form; the GBuffer + compute-pass + `StorageTexture` version is the scalable upgrade, not a prerequisite.

**UV note (our project):** the standard is xatlas (`xatlas-three`) for UV2. But xatlas is **non-deterministic and mutates geometry** → it breaks a "deterministic procedural UV, ship no asset" pipeline. For **flat** surfaces, a planar-per-slot projection + a gutter is fine and deterministic; reserve xatlas for curved/complex geometry that planar projection would distort.

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
- **xatlas-three / jpcy/xatlas** — UV2 (standard; non-deterministic — see UV note). github.com/repalash/xatlas-three
- **JamesRandall webgpu path tracer (2026)** — modern WebGPU compute architecture. jamesdrandall.com
- **Three.js docs** — WebGPURenderer / TSL / StorageTexture. threejs.org/docs
