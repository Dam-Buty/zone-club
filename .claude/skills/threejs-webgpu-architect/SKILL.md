---
name: threejs-webgpu-architect
description: "Expert skill for Three.js WebGPU architecture, React Three Fiber performance, photorealism, asset pipelines, and scene optimization. Use for any Three.js/R3F task involving scene architecture, PBR materials, GTAO/SSAO, bloom post-processing, InstancedMesh patterns, GLB/KTX2 asset pipelines, glass/reflections, rain simulation, mobile touch controls, and performance budgeting. Covers both Three.js WebGPU renderer and classic WebGL patterns."
---

# Three.js WebGPU Architect

## When to Use This Skill

- **Scene architecture**: structuring R3F components, scene graph, state management
- **Photorealism**: PBR materials, GTAO, bloom, tone mapping, post-processing pipeline
- **Performance optimization**: InstancedMesh, DataArrayTexture, draw call reduction, profiling
- **Asset pipeline**: GLB Draco compression, texture optimization, font stripping
- **Visual effects**: glass reflections, rain simulation, neon glow, idle video system
- **Decision making**: Three.js R3F vs pure WebGPU, material choice, rendering strategy

## Mandatory Rules

1. **Study reference images pixel by pixel** before coding
2. **Never use simple boxes** when proper geometry exists
3. **Verify visually after EACH change** -- compare with reference
4. **Never mark "completed" without visual verification**
5. **Research state of the art** -- never assume

---

## Response Method (5 Steps)

1. **Understand the constraint** -- what's the target? photoreal? performance budget? both?
2. **Check references** -- consult the relevant reference doc before proposing
3. **Propose approach** -- with trade-offs and confidence index
4. **Implement** -- following project patterns (module-level shared resources, Zustand rules)
5. **Verify visually** -- compare result against reference or expected outcome

---

## Key Project Patterns (Quick Reference)

- **meshStandardMaterial everywhere** except glass surfaces (Physical costs 2x GPU)
- **Module-level shared geometries/materials** -- never inline in JSX loops
- **Zustand: never `useStore()` without selector** inside Canvas
- **useStore.getState()** in event handlers (no subscription)
- **InstancedMesh + DataArrayTexture** for 500+ unique-texture objects (1 draw call)
- **GTAO half-res** (resolutionScale=0.5) for SSAO at 75% less cost
- **Pipeline order**: Scene MRT -> GTAO(0.5x) -> Bloom -> Vignette -> FXAA
- **GLB clone: always clone materials** -- `glbScene.clone(true)` shares materials by reference
- **RectAreaLight for neon signs** -- real PBR wall illumination, luminance-compensated intensity
- **TSL colorNode for lighting correction** -- per-fragment Y-gradient on held objects
- **TSL bumpMap for normalNode** -- classic `material.bumpMap` is ignored in WebGPU
- **LRU cache for generated textures** -- avoid re-rendering Canvas2D textures

---

## References

- [Performance R3F](references/PERFORMANCE_R3F.md) -- geometry sharing, animation throttle, frustum culling, React.memo, disposal, lighting, shadows, raycast
- [Glass & Reflections](references/GLASS_REFLECTIONS.md) -- gaussian glow, headlight reflections on glass, vehicle types
- [Rain Simulation](references/RAIN_SIMULATION.md) -- multi-layer particles, wind system, gust physics
- [Idle Video System](references/IDLE_VIDEO_SYSTEM.md) -- idle detection hook, lazy-loaded video overlay
- [Architecture Blueprint](references/ARCHITECTURE_BLUEPRINT.md) -- project module structure, scene graph, R3F patterns, state management
- [Photorealism Pipeline](references/PHOTOREALISM_PIPELINE.md) -- PBR, GTAO, bloom, FXAA, pipeline order
- [Asset Pipeline](references/ASSET_PIPELINE_GLTF_KTX2.md) -- GLB Draco, image compression, font stripping, TMDB textures
- [Performance Strategy](references/PERFORMANCE_STRATEGY.md) -- InstancedMesh+DataArrayTexture, upload batching, image preloading, useFrame consolidation
- [Hybrid Decision Tree](references/HYBRID_THREE_WEBGPU_DECISION.md) -- Three.js R3F vs pure WebGPU, TSL, migration path
- [Mobile Controls R3F](references/MOBILE_CONTROLS_R3F.md) -- virtual joystick, touch camera, dual-input Controls, viewport meta, safe area
