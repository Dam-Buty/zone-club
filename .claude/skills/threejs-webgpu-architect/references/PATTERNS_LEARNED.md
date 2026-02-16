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

---

## GLB Scene Clone — Material Sharing Bug (CRITICAL)

### Problem
`glbScene.clone(true)` clones meshes and child nodes, but **materials are shared by reference**.
If instance A sets `mat.map = null` or `mat.colorNode = ...`, ALL future clones inherit the corrupted material.

### Symptom
Second instance of a component using the same GLB shows wrong/missing textures.
`meshesWithMap` is empty because `mat.map` was already nullified by the first instance.

### Fix
```typescript
cloned.traverse((child) => {
  if (child instanceof THREE.Mesh) {
    const origMat = child.material as THREE.MeshStandardMaterial
    if (origMat) {
      child.material = origMat.clone() // Deep-clone material
      // NOW safe to modify child.material
    }
  }
})
```

**Rule**: Always clone materials explicitly before modifying them on cloned GLB scenes.

---

## Neon Sign Lighting — RectAreaLight + Soft Glow

### Problem
Bloom alone (screen-space) gives no real PBR wall illumination. A small glow plane with `AdditiveBlending` creates visible hard rectangular edges.

### Solution (3-part)

**1. RectAreaLight for real PBR illumination**
```typescript
// One per neon panel — faces backward toward the wall
<rectAreaLight
  width={width * 0.9}
  height={height * 0.7}
  intensity={rectLightIntensity} // luminance-compensated
  color={color}
  position={[0, 0, -0.04]}
  rotation={[0, Math.PI, 0]}
/>
```

Intensity uses same luminance compensation as emissive:
```typescript
const luminance = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
const intensity = THREE.MathUtils.clamp(0.6 / luminance, 0.4, 1.5)
```

**2. Soft glow plane (atmospheric haze)**
- Canvas gradient texture with 6 stops: `66 → 33 → 18 → 08 → 02 → 00`
- **Oversize the plane** (`width * 3, height * 4`) so gradient fades to zero well before mesh edge
- Low opacity (0.15), `AdditiveBlending`, `depthWrite={false}`

**3. WebGPU RectAreaLight initialization**
```typescript
// REQUIRED in WebGPU — NOT the same as WebGL's RectAreaLightUniformsLib
import { RectAreaLightNode } from 'three/webgpu'
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js'
RectAreaLightTexturesLib.init()
RectAreaLightNode.setLTC(RectAreaLightTexturesLib)
```

**Cost**: ~0 GPU overhead per panel (analytical light, no shadow map).

---

## TSL Per-Fragment Lighting Correction

### Problem
Ceiling lights overexpose the top of held objects, underexpose the bottom. Uniform albedo darkening (`mat.color = 0.5`) loses detail everywhere equally.

### Solution: Y-gradient via TSL colorNode
```typescript
import { texture, positionLocal, mix, float, clamp as tslClamp } from 'three/tsl'

const texNode = texture(coverTex)
const normalizedHeight = tslClamp(positionLocal.x.add(1.0).div(2.0), 0.0, 1.0)
// Top: darken (0.64), Bottom: brighten (1.67)
const correction = mix(float(1.67), float(0.64), normalizedHeight)
const correctedColor = texNode.mul(float(0.5)).mul(correction)
;(mat as any).colorNode = correctedColor
```

**Note**: `positionLocal.x` maps to the model's height axis after portrait rotation.

### Scene Light Dimming
While viewing held objects, traverse scene and dim overhead lights:
```typescript
scene.traverse((child) => {
  if (child instanceof THREE.RectAreaLight) {
    savedLights.push({ light: child, intensity: child.intensity })
    child.intensity *= 0.35
  }
})
// Restore on cleanup
```

---

## TSL Bump Map for WebGPU

### Problem
`material.bumpMap = texture` is **ignored** by the WebGPU renderer. Only TSL nodes work.

### Solution
```typescript
import { bumpMap, texture } from 'three/tsl'

const bumpTex = new THREE.CanvasTexture(bumpCanvas)
;(mat as any).normalNode = bumpMap(texture(bumpTex), 1.5) // scale = bump strength
mat.needsUpdate = true
```

**Type declaration** needed in `three-webgpu.d.ts`:
```typescript
declare module 'three/tsl' {
  export const bumpMap: any;
}
```

---

## VHS Cover LRU Cache

### Pattern
Avoid re-fetching TMDB data and re-rendering canvas textures when user switches between films.

```typescript
// Data cache (TMDB API results)
const VHS_DATA_CACHE = new Map<number, VHSCoverData>()

// Texture cache with LRU eviction
const VHS_TEXTURE_CACHE = new Map<number, THREE.CanvasTexture>()
const VHS_TEXTURE_LRU: number[] = [] // oldest first
const VHS_TEXTURE_MAX = 20 // ~80MB VRAM (20 × 4MB per 1024² RGBA)

// On eviction: dispose bump map + color texture
const evicted = VHS_TEXTURE_CACHE.get(evictId)
if (evicted) {
  evicted.userData.bumpMap?.dispose()
  evicted.dispose()
}
```

**Bump map** stored as `texture.userData.bumpMap` alongside the color texture.
