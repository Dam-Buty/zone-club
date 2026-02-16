# Neon / Synthwave Recipes

## Neon Color Palette

### CSS
```css
--neon-pink: #ff2d95;
--neon-cyan: #00fff7;
--neon-purple: #b026ff;
--neon-yellow: #fff600;
--dark-bg: #0a0a0f;
```

### WGSL
```wgsl
let neonPink = vec3f(1.0, 0.176, 0.584);
let neonCyan = vec3f(0.0, 1.0, 0.969);
let neonPurple = vec3f(0.69, 0.149, 1.0);
let neonYellow = vec3f(1.0, 0.965, 0.0);
```

### TypeScript
```typescript
const NEON_COLORS = {
  pink: '#ff2d95',
  cyan: '#00fff7',
  purple: '#b026ff',
  yellow: '#fff600',
  green: '#00ff00',
  orange: '#ff8800',
  red: '#ff4444',
  blue: '#0088ff',
};
```

---

## Emissive Materials (WGSL)

### Flickering Neon Effect

```wgsl
if (emissive > 0.1) {
  let flicker = sin(time * 8.0 + worldPos.x) * 0.03 + 0.97;
  let emissiveColor = baseColor * emissive * flicker;
  let bloom = emissiveColor * smoothstep(0.5, 2.0, emissive) * 0.5;
  finalColor = finalColor + emissiveColor + bloom;
}
```

### Steady Glow (No Flicker)
```wgsl
let emissiveColor = baseColor * emissiveIntensity;
finalColor += emissiveColor;
```

---

## Glow Multipass Technique

For a convincing neon glow, use multiple rendering passes:

### Pass 1: Scene Render
Render the scene normally. Emissive surfaces output values > 1.0 in HDR format (`rgba16float`).

### Pass 2: Bright Extraction
Extract only pixels above the bloom threshold:
```wgsl
let luminance = dot(color, vec3f(0.2126, 0.7152, 0.0722));
let brightness = max(0.0, luminance - threshold);
return vec4f(color * (brightness / max(luminance, 0.001)), 1.0);
```

### Pass 3 & 4: Gaussian Blur
Apply horizontal then vertical blur to the bright extract. Multiple iterations create wider glow.

### Pass 5: Composite
Add the blurred glow back to the original scene:
```wgsl
let final = sceneColor + bloomColor * bloomIntensity;
```

---

## Luminance Compensation (CRITICAL for neon colors)

Bloom uses perceptual luminance: `L = 0.2126*R + 0.7152*G + 0.0722*B`

Low-luminance colors (violet, red, magenta) won't trigger bloom at the same intensity as yellow/green.

**Fix**: Compensate emissive intensity per color:

```typescript
const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
const intensity = Math.min(Math.max(1.3 / luminance, 1.3), 4.5);
```

| Color | Luminance | Compensated Intensity |
|-------|-----------|----------------------|
| Yellow | 0.93 | 1.40 |
| Green | 0.72 | 1.81 |
| Orange | 0.50 | 2.60 |
| Red | 0.42 | 3.07 |
| Violet | 0.38 | 3.45 |
| Magenta | 0.28 | 4.50 |

---

## Synthwave Bloom Settings

| Style | Strength | Radius | Threshold |
|-------|----------|--------|-----------|
| Very subtle | 0.10-0.15 | 0.3 | 0.9 |
| **Realistic neon** | **0.15-0.25** | **0.4** | **0.9** |
| Cyberpunk stylized | 0.3-0.5 | 0.5 | 0.7 |
| Over-the-top | > 0.5 | > 0.6 | < 0.7 |

**Note**: WebGPU TSL bloom is more aggressive than classic UnrealBloomPass. Keep strength 0.15-0.25 for realism.

---

## Real PBR Neon Illumination (Three.js WebGPU)

Bloom alone is screen-space — it doesn't illuminate nearby surfaces. For realistic neon signs that light up the wall behind them:

### 3-Layer Approach

**Layer 1: RectAreaLight** — real PBR illumination
```typescript
// One per neon sign, facing backward toward the wall
<rectAreaLight
  width={signWidth * 0.9}
  height={signHeight * 0.7}
  intensity={compensatedIntensity} // luminance-compensated (same formula as emissive)
  color={neonColor}
  position={[0, 0, -0.04]}
  rotation={[0, Math.PI, 0]}
/>
```

**Layer 2: Soft glow plane** — atmospheric haze (fakes volumetric scattering)
- Canvas radial gradient: 6 stops with fast falloff (`66 → 33 → 18 → 08 → 02 → 00`)
- **Oversize the plane** (`width * 3, height * 4`) so gradient fades fully before mesh edge
- `AdditiveBlending`, low opacity (0.15), `depthWrite={false}`

**Layer 3: Emissive mesh + bloom** — screen-space glow on the sign itself

### Glow Plane Edge Fix

**Problem**: Even with a soft gradient texture, the plane mesh itself has hard rectangular edges → visible cutoff.

**Solution**: Make the plane much larger than the sign (3-4x each dimension). The gradient reaches near-zero opacity well before the mesh boundary, so the edge is invisible.

### WebGPU RectAreaLight Init
```typescript
import { RectAreaLightNode } from 'three/webgpu'
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js'
RectAreaLightTexturesLib.init()
RectAreaLightNode.setLTC(RectAreaLightTexturesLib)
// NOT the same as WebGL's RectAreaLightUniformsLib!
```
