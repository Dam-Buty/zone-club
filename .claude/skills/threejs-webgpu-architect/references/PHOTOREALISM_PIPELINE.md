# Photorealism Pipeline

## Material Selection

| Object Type | Material | Reason |
|-------------|----------|--------|
| Glass surfaces, water, jewelry | `meshPhysicalMaterial` | Needs IOR, transmission, clearcoat |
| **Everything else** (plastic, wood, metal, neon, fabric) | **`meshStandardMaterial`** | Physical costs ~2x GPU |

---

## GTAO (Ground Truth Ambient Occlusion)

### Setup with MRT

```typescript
import { mrt, output, normalView } from 'three/tsl';

// Scene pass must output normals for GTAO
scenePass.setMRT(mrt({ output, normal: normalView }));
```

### Parameters (Indoor Scene)

```typescript
const aoPass = gtao(depthTexture, normalTexture);
aoPass.resolutionScale = 0.5;  // Half-res = -75% fragments
// Params
scale: 0.5,
radius: 0.25,
thickness: 1.0,
```

### CRITICAL: RedFormat Fix

GTAO RenderTarget uses `RedFormat` (R channel only). The AO texture returns `vec4(ao, 0, 0, 0)`.

```typescript
// WRONG: Multiplying directly kills G+B channels → everything red
color * aoTexture // → vec4(r*ao, g*0, b*0, a*0) = RED!

// CORRECT: Extract scalar from R channel
const aoValue = aoTexture.x; // Scalar: broadcasts to all RGB
color * aoValue // → vec4(r*ao, g*ao, b*ao, a)
```

---

## Bloom Post-Processing

### Perceptual Luminance Compensation

Bloom uses `L = 0.2126*R + 0.7152*G + 0.0722*B`. Low-luminance colors (violet, red, magenta) don't trigger bloom.

```typescript
const luminance = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const emissiveIntensity = THREE.MathUtils.clamp(1.3 / luminance, 1.3, 4.5);
```

### WebGPU TSL Bloom Parameters

| Setting | Value |
|---------|-------|
| Strength | 0.15-0.25 (TSL is more aggressive than UnrealBloomPass) |
| Radius | 0.4 |
| Threshold | 0.9 |

---

## Text3D with Handwritten Fonts

**NEVER use `bevelEnabled={true}` with handwritten fonts** (Caveat, Dancing Script, etc.).

Complex glyph paths create degenerate triangles → holes and artifacts.

```typescript
// CORRECT for handwritten fonts
<Text3D font={CAVEAT_URL} height={0.025} bevelEnabled={false} curveSegments={10}>
  {text}
  <meshStandardMaterial emissive={color} emissiveIntensity={3} toneMapped={false} />
</Text3D>
```

Use emissive + bloom for neon effect instead of geometry bevel.

---

## Anisotropic Filtering

Set anisotropy to **16** on all PBR textures (floor, walls, wood). Hardware-accelerated, ~0% GPU cost.

```typescript
texture.anisotropy = renderer.capabilities.getMaxAnisotropy(); // Usually 16
```

---

## Post-Processing Pipeline Order

```
Scene MRT (output + normalView)
    ↓
GTAO (half-res, 0.5x)
    ↓
Bloom (strength 0.19, threshold 0.9)
    ↓
Vignette
    ↓
FXAA (~3% GPU cost, smooths geometry edges + texture boundaries)
    ↓
Output
```

---

## Shadow Configuration

- Shadow map: **1024x1024** (sufficient for indoor scene, was 2048x2048)
- `castShadow=true` only on: large furniture (comptoir, main shelf), character
- `castShadow=false` on: GLB models, small objects, planks, decorative items, cassettes
