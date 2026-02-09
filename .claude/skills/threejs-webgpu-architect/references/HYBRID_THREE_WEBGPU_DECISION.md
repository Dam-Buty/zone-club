# Decision Tree: Three.js R3F vs Pure WebGPU

## When to Use Three.js / React Three Fiber

- **Rapid prototyping** -- scene graph, helpers, controls out of the box
- **Existing ecosystem** -- drei, postprocessing, rapier, cannon, leva
- **Complex scene graphs** -- parent/child transforms, groups, instancing
- **PBR materials** -- meshStandardMaterial, meshPhysicalMaterial ready to use
- **GLTF loading** -- useGLTF with Draco support via drei
- **React integration** -- declarative 3D inside React apps
- **Team familiarity** -- more developers know Three.js than raw WebGPU

## When to Use Pure WebGPU

- **Custom compute shaders** -- particle systems, physics, image processing
- **Maximum GPU control** -- precise pipeline configuration, memory management
- **Specialized rendering pipelines** -- non-standard rendering techniques
- **Learning/education** -- understanding how GPUs actually work
- **Minimal bundle size** -- no Three.js overhead (~600KB min)
- **WebGPU-specific features** -- compute, storage textures, indirect draw

## The Hybrid Approach (Recommended)

**Three.js WebGPU Renderer** (`three/webgpu`) gives the best of both worlds:

```typescript
import * as THREE from 'three/webgpu';
import { Canvas } from '@react-three/fiber';

// R3F ecosystem + WebGPU backend
<Canvas gl={(canvas) => {
  const renderer = new THREE.WebGPURenderer({ canvas });
  return renderer;
}}>
```

### Benefits
- Full R3F ecosystem (drei, fiber hooks, etc.)
- WebGPU rendering backend (Metal/Vulkan/D3D12)
- TSL for custom shader nodes
- Fallback to WebGL when WebGPU unavailable

---

## TSL (Three Shading Language)

Node-based shader system that compiles to both WGSL and GLSL:

```typescript
import { texture, uv, color, float, mix } from 'three/tsl';

// Works with both WebGPU and WebGL renderers
const baseColor = texture(albedoMap).uv(uv());
const finalColor = mix(baseColor, color('#ff0000'), float(0.5));
material.colorNode = finalColor;
```

### When to Use TSL vs Raw WGSL

| Scenario | Use TSL | Use Raw WGSL |
|----------|---------|-------------|
| Custom material effects | Yes | No |
| Post-processing nodes | Yes | No |
| Compute-heavy algorithms | No | Yes |
| Full pipeline control | No | Yes |
| Cross-renderer compatibility | Yes | No |

---

## Migration Path

```
WebGL (Three.js)
    ↓ Change import to 'three/webgpu'
Three.js WebGPU Renderer
    ↓ Add custom TSL nodes for effects
Custom TSL Nodes
    ↓ Only if TSL is insufficient
Pure WebGPU (if needed)
```

Most projects never need to go past step 2. TSL covers 95% of custom shader needs.

---

## Decision Checklist

- [ ] Do I need React integration? → **Three.js R3F**
- [ ] Do I need PBR materials out of the box? → **Three.js**
- [ ] Do I need compute shaders? → **Three.js WebGPU** (TSL compute) or **Pure WebGPU**
- [ ] Do I need maximum GPU control? → **Pure WebGPU**
- [ ] Do I need cross-browser fallback? → **Three.js** (WebGPU with WebGL fallback)
- [ ] Is bundle size critical? → **Pure WebGPU**
- [ ] Is development speed critical? → **Three.js R3F**
