# Organized Patterns Library

Index of all discovered patterns, organized by category. Initialized from project experience (02/2026).

---

## Rendering Pipeline

### Bloom + Luminance Compensation
**Problem**: Low-luminance colors (violet, red) don't trigger bloom at same threshold as yellow/green.
**Solution**: `emissiveIntensity = clamp(1.3 / luminance, 1.3, 4.5)` per color.
**When to use**: Any scene with bloom post-processing and varied neon colors.

### GTAO Half-Resolution
**Problem**: GTAO at full resolution is expensive (~4x fragment cost).
**Solution**: `aoPass.resolutionScale = 0.5` — imperceptible quality loss, -75% fragments.
**When to use**: Indoor scenes with ambient occlusion.
**Gotcha**: GTAO RenderTarget uses `RedFormat`. Use `aoTexture.x` to extract scalar (not multiply vec4 directly).

### FXAA Post-Process
**Problem**: Geometry edges and texture boundaries show aliasing.
**Solution**: FXAA pass after bloom/vignette. ~3% GPU cost.
**When to use**: Any scene where anti-aliasing is needed without MSAA overhead.

### Pipeline Order
Scene MRT → GTAO(0.5x) → Bloom → Vignette → FXAA

### meshStandardMaterial over meshPhysicalMaterial
**Problem**: Physical material costs ~2x GPU for clearcoat/IOR/sheen calculations.
**Solution**: Use Standard everywhere except glass/water/jewelry surfaces.
**When to use**: Always, as default rule.

---

## Asset Optimization

### GLB Draco Compression
**Problem**: GLB files are large (24MB mesh data).
**Solution**: `gltf-transform optimize input.glb output.glb --compress draco` → 993KB. Use `useGLTF(url, true)`.
**When to use**: Any GLB model.

### Font Stripping
**Problem**: Typeface.json includes all glyphs (1367KB).
**Solution**: Strip to only needed characters → 29KB (-97.9%).
**When to use**: Text3D with limited character set (signs, labels).

### TMDB w200 for Small Objects
**Problem**: w342/w500 textures on 10cm cassettes waste bandwidth.
**Solution**: Use TMDB `w200` endpoint. Matches DataArrayTexture layer resolution (200x300).

### Anisotropic Filtering
**Problem**: PBR textures look blurry at oblique angles.
**Solution**: `texture.anisotropy = 16` on floor, walls, wood textures. Hardware-accelerated, ~0% GPU cost.

---

## Instancing & Batching

### InstancedMesh + DataArrayTexture
**Problem**: 520 unique-texture meshes = 520 draw calls.
**Solution**: 1 InstancedMesh + DataArrayTexture with per-instance layer index. TSL: `texture(arrayTex).uv(uv()).depth(layerIdx)`.
**When to use**: Many identical meshes with unique textures.
**Gotcha**: Never use `vec3(u, v, layer)` — use `.depth()` API. Y-flip pixels for OpenGL convention.

### Bounding Sphere Invalidation
**Problem**: `setMatrixAt()` doesn't invalidate bounding sphere → raycast misses all instances.
**Solution**: (1) `frustumCulled={false}` in JSX, (2) `mesh.computeBoundingSphere()` after all matrices set.

### GPU Upload Batching
**Problem**: `needsUpdate = true` uploads entire DataArrayTexture (~51MB) per call.
**Solution**: Dirty flag + `flush()` called once per frame from animation loop.
**Metric**: 520 uploads → ~20 uploads during loading.

---

## React / R3F Patterns

### Module-Level Shared Materials & Geometries
**Problem**: Inline `<meshStandardMaterial>` in loops creates new GPU material per mesh.
**Solution**: `const sharedMat = new THREE.MeshStandardMaterial(...)` at module level. Use `material={sharedMat}` prop.

### useFrame Consolidation
**Problem**: 500+ individual useFrame callbacks = significant overhead.
**Solution**: Registry `Map<string, Callback>` + single useFrame that iterates all entries. Components register/unregister in useEffect.

### Zustand: No Full-Store Subscription in Canvas
**Problem**: `useStore()` without selector re-renders on EVERY mutation (30fps when targeting fires every 2 frames).
**Solution**: Individual selectors for reactive values, `getState()` for event handlers, `subscribe()` for high-frequency monitoring.

### React.memo for Canvas Content
**Problem**: Parent re-renders cascade through Canvas children.
**Solution**: Wrap all Canvas-level components in `React.memo()`. Use individual Zustand selectors, not full store.

### Never setState in useMemo
**Problem**: Calling setState (via callback prop) inside useMemo → "Cannot update component while rendering".
**Solution**: Use `useEffect` for callbacks that trigger parent setState.

### Cross-Origin Image Preloading (Shared Cache)
**Problem**: Browser HTTP cache doesn't persist cross-origin images → network re-fetch (940ms).
**Solution**: `Map<string, Promise<HTMLImageElement>>` at module level. Keeps Image refs alive. 940ms → 142ms.

---

## Debugging

### Raycast Overlay Mesh Bug
**Problem**: Meshes in front of interactive surfaces block raycast (closest hit wins).
**Solution**: ALL overlay meshes must carry same `userData` flag as the target surface.
**Rule**: Check entire Z-stack in front of every interactive surface.

### Raycaster Layers
**Problem**: Raycast tests all ~867 objects per frame.
**Solution**: `raycaster.layers.set(1)` + `mesh.layers.enable(1)` to filter targets. Layer 0=static, 1=cassettes, 2=interactive.
**Metric**: 867 → 526 objects tested.

### Text3D Bevel Artifacts
**Problem**: Handwritten fonts (Caveat, Dancing Script) have complex paths → bevel creates holes.
**Solution**: `bevelEnabled={false}` + emissive + bloom for neon effect. Never bevel handwritten fonts.

### Shadow Map Optimization
**Problem**: 2048x2048 shadow map expensive for indoor scene.
**Solution**: 1024x1024 sufficient (-75% shadow pass cost). `castShadow=false` on GLB, small objects, cassettes.
