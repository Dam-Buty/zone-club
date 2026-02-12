# Patterns Learned

Discovered patterns from Zone Club development (02/2026). Organized by category.

---

## Rendering Pipeline

### Bloom + Luminance Compensation
**Problem**: Low-luminance colors (violet, red) don't trigger bloom at same threshold as yellow/green.
**Solution**: `emissiveIntensity = clamp(1.3 / luminance, 1.3, 4.5)` per color.

### GTAO Half-Resolution
`aoPass.resolutionScale = 0.5` — imperceptible quality loss, -75% fragments.
**Gotcha**: GTAO RenderTarget uses `RedFormat`. Use `aoTexture.x` to extract scalar (not multiply vec4 directly).

### FXAA Post-Process
FXAA pass after bloom/vignette. ~3% GPU cost. Cheaper than MSAA.

### Pipeline Order
Scene MRT → GTAO(0.5x) → Bloom → Vignette → FXAA

### meshStandardMaterial over meshPhysicalMaterial
Physical material costs ~2x GPU for clearcoat/IOR/sheen. Use Standard everywhere except glass/water/jewelry.

---

## Asset Optimization

### GLB Draco Compression
`gltf-transform optimize input.glb output.glb --compress draco` — 24MB → 993KB. Use `useGLTF(url, true)`.

### Font Stripping
Strip typeface.json to only needed characters — 1367KB → 29KB (-97.9%).

### TMDB w200 for Small Objects
Use `w200` endpoint for cassette textures. Matches DataArrayTexture layer resolution (200x300).

### Anisotropic Filtering
`texture.anisotropy = 16` on floor, walls, wood textures. Hardware-accelerated, ~0% GPU cost.

---

## Instancing & Batching

### InstancedMesh + DataArrayTexture
520 unique-texture meshes → 1 InstancedMesh + DataArrayTexture with per-instance layer index.
TSL: `texture(arrayTex).uv(uv()).depth(layerIdx)`.
**Gotcha**: Never use `vec3(u, v, layer)` — use `.depth()` API. Y-flip pixels for OpenGL convention.

### Bounding Sphere Invalidation
`setMatrixAt()` doesn't invalidate bounding sphere → raycast misses all instances.
**Fix**: (1) `frustumCulled={false}` in JSX, (2) `mesh.computeBoundingSphere()` after all matrices set.

### GPU Upload Batching
`needsUpdate = true` uploads entire DataArrayTexture (~51MB) per call.
**Fix**: Dirty flag + `flush()` called once per frame from animation loop. 520 uploads → ~20.

---

## React / R3F Patterns

### Module-Level Shared Materials & Geometries
Inline `<meshStandardMaterial>` in loops creates new GPU material per mesh.
**Fix**: `const sharedMat = new THREE.MeshStandardMaterial(...)` at module level.

### useFrame Consolidation
500+ individual useFrame callbacks = significant overhead.
**Fix**: Registry `Map<string, Callback>` + single useFrame that iterates all entries.

### Zustand: No Full-Store Subscription in Canvas
`useStore()` without selector re-renders on EVERY mutation.
**Fix**: Individual selectors for reactive values, `getState()` for event handlers, `subscribe()` for high-frequency monitoring.

### React.memo for Canvas Content
Wrap all Canvas-level components in `React.memo()`. Use individual Zustand selectors, not full store.

### Never setState in useMemo
Calling setState inside useMemo → "Cannot update component while rendering".
**Fix**: Use `useEffect` for callbacks that trigger parent setState.

### Cross-Origin Image Preloading
Browser HTTP cache doesn't persist cross-origin images → re-fetch (940ms).
**Fix**: `Map<string, Promise<HTMLImageElement>>` at module level. 940ms → 142ms.

---

## Debugging

### Raycast Overlay Mesh Bug
Meshes in front of interactive surfaces block raycast. ALL overlay meshes must carry same `userData` flag as target.

### Raycaster Layers
`raycaster.layers.set(1)` + `mesh.layers.enable(1)` to filter targets. Layer 0=static, 1=cassettes, 2=interactive.
867 → 526 objects tested.

### Text3D Bevel Artifacts
Handwritten fonts have complex paths → bevel creates holes. Use `bevelEnabled={false}` + emissive + bloom.

### Shadow Map Optimization
1024x1024 sufficient for indoor (-75% shadow pass cost). `castShadow=false` on GLB, small objects, cassettes.
