---
name: webgpu-light-baking-nee
description: Use when a WebGPU/TSL lightmap or GI bake (three-mesh-bvh hemisphere gather) is noisy/grainy at reasonable sample counts, leaves surfaces far from small bright emitters dark/black, or has no crisp cast shadows — typically with tiny area lights like neon signs, tubes, or strip lights.
---

# Next-Event Estimation for WebGPU/TSL Light Baking

## Overview

A pure hemisphere-gather bake (shoot random rays from each texel, hope they hit a light) is the #1 cause of noise AND dark surfaces in a lightmap. Small bright emitters (neon signs, tubes) are rarely hit by chance → variance explodes, and surfaces far from them (the floor under high signs) stay black no matter the sample count.

**Next-Event Estimation (NEE) = at every shaded point, sample the emitters DIRECTLY**: pick a point on each light, cast one shadow ray, add its contribution if unoccluded. It's path-tracing ABC and the single biggest quality lever — it fixes noise, dark surfaces, AND gives real cast shadows in one pass.

## When to use

- A bake/GI gather is grainy at hundreds of samples.
- Surfaces far from small emitters read dark/black (floor under high neon signs).
- No crisp cast shadows from occluders.
- Tiny/bright area lights dominate (signs, tubes, strips).
- Stack: `three-mesh-bvh` (`/webgpu` TSL raycaster) + a WebGPU/TSL UV-space bake.

**Not for:** already-converged bakes, or scenes lit only by a big smooth environment (hemisphere gather is fine there — the lights aren't small).

## The estimator (rectangular area light, diffuse surface)

For a shading point `P`, normal `N`, Lambert albedo `ρ`, one area light contributes:

```
L_direct = (ρ/π) · mean_S [ V · L_e · cosθ_P · cosθ_L · area / dist² ]
```

- `x_L` = a point sampled on the light; `dist = |x_L − P|`; `ω = (x_L − P)/dist`
- `cosθ_P = max(0, N·ω)`  — surface faces the light
- `cosθ_L = max(0, N_L·(−ω))` — light faces the point (rectangles are one-sided here; use abs() if the proxy is double-sided)
- `V` = visibility: 1 if the shadow ray `P→x_L` is unoccluded, else 0  ← **the shadow ray**
- `area` = light area = `1/pdf_A` for uniform area sampling. The `area/dist²·cosθ_L` together convert the area-measure pdf to solid angle.
- `L_e` = emitter radiance (linear colour × intensity)

## Algorithm (per texel)

1. Get `P` (world pos), `N` (**raw geometry normal**, see mistakes), `ρ` (albedo).
2. **Direct (NEE)** — for each emitter (or one importance-picked emitter, S samples):
   - Sample `x_L` on the rectangle: `corner + u·edge1 + v·edge2`, `u,v` ∈ rng.
   - Compute `ω, dist, cosθ_P, cosθ_L`. Skip if either cos ≤ 0.
   - **Shadow ray**: origin `P + N·ε`, dir `ω`, max length `dist − 2ε` → BVH occlusion (any-hit). If blocked → skip.
   - Accumulate `L_e · cosθ_P · cosθ_L · area / dist²`.
   - `L_direct += ρ/π · accum / S`.
3. **Indirect (bounce)** — keep the hemisphere gather, but read only the **reflected** radiance of the previous lightmap at hits. Do **NOT** add emitters' emission here (NEE already did the direct light).
4. `L_out = emission_self + L_direct + L_indirect`.

## Avoiding double-counting (the #1 trap)

NEE computes direct light. If the indirect hemisphere gather ALSO adds an emitter's emission when a bounce ray hits it, direct light is counted twice → too bright and still noisy. Clean options:

- **Diffuse bake (recommended):** the indirect term reads only reflected radiance (previous lightmap × albedo at the hit). Emitters contribute 0 to indirect — their direct light is NEE's job.
- **MIS (only if you keep BSDF-sampled hits on lights):** weight each technique with the balance heuristic `w = pdf_light / (pdf_light + pdf_bsdf)`. Overkill for a pure-diffuse bake.

## Reference pattern (three-gpu-pathtracer — our three-mesh-bvh stack)

`directLightContribution`: pick a light → `randomLightSample` (returns direction, pdf, emission, dist) → reject if `dot(faceNormal, dir) < 0` → **shadow ray** via `attenuateHit` (BVH occlusion) → BSDF pdf → `misHeuristic(lightPdf, bsdfPdf)` (= 1.0 for delta lights) → `emission · throughput · bsdf · misWeight / lightPdf`. We mirror this **minus MIS** (diffuse-only).

## Sampling quality (optional upgrade, later)

Uniform area sampling is fine to start. **Solid-angle sampling** of the rectangle (Ureña 2013, "area-preserving parametrization for spherical rectangles") puts samples where `cosθ_L/dist²` is largest → lower variance for large/near lights. Add only if uniform sampling is still noisy after NEE.

## Common mistakes

| Mistake | Symptom | Fix |
|---|---|---|
| Double-counting direct light in the indirect term | Too bright + still noisy | Indirect reads reflected radiance only; emitters = 0 in indirect |
| Using `normalWorld` (flipped toward view on two-sided faces) | Half the surfaces black (opposite-normal pairs) | Use the **raw geometry normal** (`normalLocal` on an identity-mesh world geometry) |
| Forgetting `cosθ_L` (light's own cosine) | Wrong falloff, light leaks past edges | Include `max(0, N_L·(−ω))` |
| Shadow-ray self-intersection | Speckled shadows / surface acne | Offset origin by `N·ε`, shorten ray by `~2ε` |
| Not dividing by pdf (× area) | Wrong global intensity | Multiply by `area` (= 1/pdf_A) for uniform sampling |
| Tiny emitters via hemisphere gather only (no NEE) | The exact noise + dark-surface bug this skill fixes | Add NEE |

## Why it works

NEE removes the lottery of randomly hitting small lights: every texel gets every *visible* light's direct contribution via one shadow ray each → smooth result, all surfaces lit, true cast shadows, an order of magnitude fewer samples for the same quality.

**Sources:** three-gpu-pathtracer `directLightContribution` (gkjohnson, built on three-mesh-bvh); Ureña et al. 2013 (spherical rectangle sampling); Veach & Guibas 1995 (MIS / balance heuristic); pbrt "Direct Lighting".
