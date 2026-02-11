# Post-Processing, HDR & Bloom

## CRITICAL: Avoid Double Processing

```
WRONG (double treatment):
Scene → Reinhard → Gamma → Post → ACES → Gamma → Output (OVEREXPOSED!)

CORRECT (single treatment):
Option A: Scene → HDR output → Post → ACES → Gamma → Output
Option B: Scene → Reinhard → Gamma → Post (bloom/vignette only) → Output
```

**Rule**: If the scene already does tone mapping + gamma, post-processing must NOT redo them. Choose ONE location for tone mapping in the pipeline.

---

## HDR Rendering Setup

For a true HDR pipeline, use `rgba16float`:

```typescript
const hdrTexture = device.createTexture({
  size: [width, height],
  format: "rgba16float", // HDR format
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
});

// Pipeline must target rgba16float
targets: [{ format: "rgba16float" }]
```

---

## Tone Mapping Functions

### ACES Filmic (for HDR scenes)
```wgsl
fn acesFilm(x: vec3f) -> vec3f {
  let a = 2.51; let b = 0.03;
  let c = 2.43; let d = 0.59; let e = 0.14;
  return saturate((x * (a * x + b)) / (x * (c * x + d) + e));
}
```

### Reinhard (simple)
```wgsl
fn reinhard(color: vec3f) -> vec3f {
  return color / (color + vec3f(1.0));
}
```

### Decision: Which to Use

| Scenario | Tone Mapping |
|----------|-------------|
| HDR scene with values > 1.0 (emissive, lights) | ACES Filmic |
| Simple scene, values 0-1 | Reinhard or none |
| Artistic/stylized (synthwave) | ACES with exposure adjustment |

---

## Bloom Implementation

### 1. Bright Extraction
```wgsl
@fragment
fn extractBright(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(sceneTexture, texSampler, input.uv).rgb;
  let luminance = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  let brightness = max(0.0, luminance - settings.bloomThreshold);
  return vec4f(color * brightness, 1.0);
}
```

### 2. Gaussian Blur (horizontal + vertical passes)
```wgsl
fn gaussianBlur(uv: vec2f, direction: vec2f) -> vec3f {
  let weights = array<f32, 5>(0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  var result = textureSample(inputTexture, texSampler, uv).rgb * weights[0];
  for (var i = 1; i < 5; i++) {
    let offset = direction * f32(i) * texelSize;
    result += textureSample(inputTexture, texSampler, uv + offset).rgb * weights[i];
    result += textureSample(inputTexture, texSampler, uv - offset).rgb * weights[i];
  }
  return result;
}
```

### 3. Composite
```wgsl
@fragment
fn composite(input: VertexOutput) -> @location(0) vec4f {
  let scene = textureSample(sceneTexture, texSampler, input.uv).rgb;
  let bloom = textureSample(bloomTexture, texSampler, input.uv).rgb;
  var color = scene + bloom * settings.bloomIntensity;
  // Apply tone mapping here (ACES or Reinhard)
  // Apply gamma: pow(color, vec3f(1.0/2.2))
  return vec4f(color, 1.0);
}
```

---

## Parameters Guide

### Bloom Settings

| Scene Type | bloomThreshold | bloomIntensity |
|------------|---------------|----------------|
| HDR (emissive > 1.0) | 1.0 | 0.3 - 0.5 |
| LDR (already tone mapped) | 0.7 - 0.85 | 0.1 - 0.2 |
| Synthwave/Neon intense | 0.5 - 0.7 | 0.5 - 1.0 |

### Exposure Settings

| Configuration | Exposure |
|--------------|----------|
| HDR scene with values 10-100+ | 0.5 - 2.0 |
| Already tone mapped (0-1) | 1.0 (pass-through) |
| Creative adjustment | 0.8 - 1.5 |

### VHS/Grain Settings

| Effect | grainIntensity |
|--------|---------------|
| Invisible | 0.002 - 0.005 |
| Subtle | 0.008 - 0.015 |
| Visible | 0.02 - 0.03 |
| Heavy VHS | 0.05 - 0.1 |

### Vignette Settings

| Effect | vignetteIntensity |
|--------|------------------|
| Subtle | 0.1 - 0.2 |
| Moderate | 0.3 - 0.4 |
| Strong | 0.5 - 0.7 |
