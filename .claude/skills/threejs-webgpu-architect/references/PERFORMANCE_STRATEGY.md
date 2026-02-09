# Performance Strategy - Advanced Patterns

## InstancedMesh + DataArrayTexture

**520 unique-texture meshes → 1 draw call.**

### Setup

```typescript
// DataArrayTexture: all posters in one GPU texture
const arrayTex = new THREE.DataArrayTexture(data, width, height, layerCount);

// TSL material: sample by layer index
import { texture, uv, instanceIndex } from 'three/tsl';
const layerIdx = instancedBufferAttribute(layerAttr);
const color = texture(arrayTex).uv(uv()).depth(layerIdx);
```

### Critical Rules

- **NEVER use `vec3(uv.x, uv.y, layer)`** -- broken in Three.js TSL, use `.depth()` instead
- **Y-flip poster pixels** when copying to array (OpenGL UV convention: V=0 at bottom)
- Per-instance data via `InstancedBufferAttribute` (not StorageBufferAttribute)
- Raycasting: `intersect.instanceId` maps to cassetteKey via lookup array in `userData`

### Bounding Sphere Bug (CRITICAL)

`setMatrixAt()` does NOT invalidate the bounding sphere. If renderer computes bounding sphere before useEffect sets matrices, you get a stale zero-radius sphere at origin.

Raycast checks `ray.intersectsSphere(boundingSphere)` first → always misses → **no detection**.

**Fix**:
1. Set `frustumCulled={false}` in JSX (prevent stale computation)
2. Call `mesh.computeBoundingSphere()` after setting all matrices in useEffect

---

## DataArrayTexture GPU Upload Batching

`needsUpdate = true` triggers FULL re-upload of entire texture (~51MB for 520 layers).

**NEVER set `needsUpdate` inside per-item loops** (fillLayerWithColor, loadPosterIntoLayer).

```typescript
// Pattern: dirty flag + flush once per frame
class TextureArray {
  private dirty = false;

  loadLayer(index: number, data: Uint8Array) {
    // Copy data to internal buffer
    this.dirty = true; // Mark dirty, DON'T set needsUpdate
  }

  flush() {
    if (this.dirty) {
      this.texture.needsUpdate = true; // Single upload per frame
      this.dirty = false;
    }
  }
}

// In animation loop:
useFrame(() => {
  textureArray.flush(); // One GPU upload per frame max
});
```

Without batching: 520 poster loads = 520 x 51MB uploads = massive GPU stalls.
With batching: 520 poster loads = ~20 uploads (1 per frame during loading).

---

## Cross-Origin Image Preloading

**Browser HTTP cache does NOT reliably persist cross-origin images** (TMDB CDN). Images get GC'd → cache miss → network re-fetch.

### Shared Cache Pattern (940ms → 142ms, -85%)

```typescript
// Module-level shared cache — keeps Image refs alive
const imageCache = new Map<string, Promise<HTMLImageElement>>();

export function preloadPosterImage(url: string): Promise<HTMLImageElement> {
  if (imageCache.has(url)) return imageCache.get(url)!;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
  imageCache.set(url, promise);
  return promise;
}
```

App.tsx calls `preloadPosterImage()` at module load time → CassetteTextureArray consumes resolved Promise (~0ms).

---

## useFrame Consolidation

500+ individual useFrame callbacks = significant R3F overhead.

### Registry Pattern

```typescript
const animationRegistry = new Map<string, AnimationCallback>();

// Components register/unregister in useEffect
useEffect(() => {
  animationRegistry.set(id, myCallback);
  return () => { animationRegistry.delete(id); };
}, []);

// Single useFrame iterates registry
function AnimationLoop() {
  useFrame((state, delta) => {
    const store = useStore.getState(); // Read once
    animationRegistry.forEach(cb => cb(state, delta, store));
  });
}
```

Eliminates N Zustand subscriptions + N useFrame callbacks.

---

## Raycaster Layers

```typescript
raycaster.layers.set(1); // Only test layer 1 objects

// Layer assignments:
// Layer 0 = static geometry (default, render only)
// Layer 1 = cassettes (interactive)
// Layer 2 = UI elements (TV, bell)

mesh.layers.enable(1); // Make this mesh raycastable
```

Reduces raycast from ~867 to ~526 objects tested per frame.

---

## Material / Geometry Deduplication

### Problem
Inline `<meshStandardMaterial>` in JSX loops creates NEW GPU material per mesh.

### Fix
```typescript
// Module-level shared resources
const sharedMat = new THREE.MeshStandardMaterial({ color: '#333' });
const sharedGeo = new THREE.BoxGeometry(0.168, 0.228, 0.03);

// In component
<mesh material={sharedMat} geometry={sharedGeo} />
```

For texture-dependent materials: use `useMemo` + dispose in cleanup.

---

## Zustand Subscription Rules (CRITICAL)

| Context | Method | Re-renders? |
|---------|--------|-------------|
| Component needs reactive value | `useStore(state => state.value)` | Yes (only on value change) |
| Event handler needs current value | `useStore.getState()` | No |
| High-frequency state monitoring | `useStore.subscribe()` in useEffect | No |
| **Full store (NEVER in Canvas)** | ~~`useStore()`~~ | **Every mutation = 30fps re-renders** |

---

## React Anti-Patterns in R3F

- **NEVER call setState inside `useMemo`** → "Cannot update component while rendering"
- **Array literal props** like `position={[1,2,3]}` create new ref every render → use scalars
- **Memoize callback factories** in `useMemo` with stable deps
