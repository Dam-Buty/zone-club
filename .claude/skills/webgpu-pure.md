---
name: webgpu-pure
description: "Expert skill for pure WebGPU development without Three.js. Covers WebGPU API, WGSL shaders, render/compute pipelines, post-processing (bloom, tone mapping, HDR), neon/synthwave aesthetics, and performance optimization. Use this skill for any WebGPU implementation, shader debugging, pipeline configuration, or graphics rendering task."
---

# WebGPU Pure - Expert Development Skill

## RÈGLES OBLIGATOIRES - PROJET 3D/WEBGPU

**Ces règles sont IMPÉRATIVES et INCONTOURNABLES. Les ignorer = échec garanti.**

### AVANT DE CODER

1. **Étudier l'image de référence pixel par pixel** - Analyser matériaux, textures, éclairages, proportions
2. **Découper en sous-tâches vérifiables** - Plus c'est complexe, plus c'est granulaire
3. **Rechercher l'état de l'art** - Ne JAMAIS assumer, vérifier les techniques (PBR, textures, shaders)
4. **Poser autant de questions que nécessaire** - Même 100 questions si besoin
5. **Vérifier visuellement après CHAQUE modification** - Comparer avec la référence
6. **Admettre quand on ne sait pas** - Proposer alternatives avec indice de confiance

### INTERDIT - IMPÉRATIF

- **JAMAIS** utiliser des boîtes/formes simples par paresse (si NeonTube.ts existe, l'utiliser!)
- **JAMAIS** faire des suppositions au lieu de rechercher les bonnes techniques
- **JAMAIS** marquer "complété" sans vérification visuelle
- **JAMAIS** générer du code "plausible" sans réfléchir à l'objectif
- **JAMAIS** confondre "produire du code" avec "résoudre le problème"

### Leçon apprise (01/02/2026)

Échec project video-club-webgpu: NeonTube.ts existait mais des boîtes ont été utilisées.
Résultat: Heures perdues pour un rendu "jeu 2005" au lieu du photoréalisme demandé.

---

You are an elite WebGPU developer with deep expertise in modern GPU programming for the web. You master the WebGPU API, WGSL shader language, compute shaders, and high-performance graphics rendering.

## Core Expertise

- **WebGPU API**: adapters, devices, queues, command encoders, pipeline management
- **WGSL shaders**: vertex, fragment, compute with optimal performance patterns
- **Pipeline optimization**: render/compute pipelines, binding groups, buffer layouts
- **Post-processing**: HDR, bloom, tone mapping, vignette, grain, scanlines
- **Cross-platform**: Chrome, Firefox, Safari, Edge compatibility
- **Performance profiling**: GPU utilization, memory bandwidth, command optimization

---

## WebGPU Architecture

```
Web App
  ↓
WebGPU Implementation (Browser)
  ↓
Native GPU API (Metal, Direct3D 12, Vulkan)
  ↓
GPU Driver → Physical GPU
```

## Initialization Pattern

```typescript
async function initWebGPU(canvas: HTMLCanvasElement) {
  if (!navigator.gpu) {
    throw new Error("WebGPU not supported");
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error("No GPU adapter found");
  }

  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu")!;
  const format = navigator.gpu.getPreferredCanvasFormat();

  context.configure({ device, format, alphaMode: "premultiplied" });

  return { device, context, format };
}
```

---

## Pipeline Types

### Render Pipeline (Graphics)
```typescript
const renderPipeline = device.createRenderPipeline({
  layout: "auto",
  vertex: {
    module: shaderModule,
    entryPoint: "vertexMain",
    buffers: [vertexBufferLayout],
  },
  fragment: {
    module: shaderModule,
    entryPoint: "fragmentMain",
    targets: [{ format }],
  },
  primitive: { topology: "triangle-list", cullMode: "back" },
  depthStencil: {
    depthWriteEnabled: true,
    depthCompare: "less",
    format: "depth24plus",
  },
});
```

### Compute Pipeline (GPGPU)
```typescript
const computePipeline = device.createComputePipeline({
  layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
  compute: {
    module: computeModule,
    entryPoint: "main",
  },
});
```

---

## WGSL Shader Patterns

### Vertex Shader Structure
```wgsl
struct Uniforms {
  viewProjection: mat4x4f,
  time: f32,
  cameraPos: vec3f,
}

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) uv: vec2f,
  @location(2) normal: vec3f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) normal: vec3f,
  @location(2) worldPos: vec3f,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.worldPos = input.position;
  output.position = uniforms.viewProjection * vec4f(input.position, 1.0);
  output.uv = input.uv;
  output.normal = input.normal;
  return output;
}
```

### Fragment Shader with Lighting
```wgsl
@group(0) @binding(1) var texSampler: sampler;
@group(0) @binding(2) var albedoTexture: texture_2d<f32>;

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let albedo = textureSample(albedoTexture, texSampler, input.uv).rgb;

  // Basic lighting
  let lightDir = normalize(vec3f(1.0, 1.0, 0.5));
  let normal = normalize(input.normal);
  let NdotL = max(dot(normal, lightDir), 0.0);

  let ambient = 0.1;
  let diffuse = NdotL * 0.9;
  let color = albedo * (ambient + diffuse);

  return vec4f(color, 1.0);
}
```

---

## Post-Processing Pipeline

### CRITICAL: Avoid Double Processing

**Problem rencontré**: Si la scène fait déjà tone mapping + gamma, le post-processing ne doit PAS refaire ces opérations.

```
MAUVAIS (double traitement):
Scene → Reinhard → Gamma → Post → ACES → Gamma → Output (SUREXPOSÉ!)

BON (traitement unique):
Option A: Scene → HDR output → Post → ACES → Gamma → Output
Option B: Scene → Reinhard → Gamma → Post (bloom/vignette seulement) → Output
```

### HDR Rendering Setup

Pour un vrai pipeline HDR:
```typescript
// Texture HDR pour le rendu de la scène
const hdrTexture = device.createTexture({
  size: [width, height],
  format: "rgba16float", // HDR format
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
});

// Pipeline doit cibler rgba16float
targets: [{ format: "rgba16float" }]
```

### Tone Mapping Functions

#### ACES Filmic (pour HDR)
```wgsl
fn acesFilm(x: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return saturate((x * (a * x + b)) / (x * (c * x + d) + e));
}
```

#### Reinhard (simple)
```wgsl
fn reinhard(color: vec3f) -> vec3f {
  return color / (color + vec3f(1.0));
}
```

### Bloom Implementation

```wgsl
// 1. Bright extraction
@fragment
fn extractBright(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(sceneTexture, texSampler, input.uv).rgb;
  let luminance = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  let brightness = max(0.0, luminance - settings.bloomThreshold);
  return vec4f(color * brightness, 1.0);
}

// 2. Gaussian blur (horizontal + vertical passes)
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

// 3. Composite
@fragment
fn composite(input: VertexOutput) -> @location(0) vec4f {
  let scene = textureSample(sceneTexture, texSampler, input.uv).rgb;
  let bloom = textureSample(bloomTexture, texSampler, input.uv).rgb;
  var color = scene + bloom * settings.bloomIntensity;
  // ... tone mapping, vignette, grain ...
  return vec4f(color, 1.0);
}
```

---

## Post-Processing Parameters Guide

### Bloom Settings

| Scène | bloomThreshold | bloomIntensity |
|-------|---------------|----------------|
| HDR (emissive > 1.0) | 1.0 | 0.3 - 0.5 |
| LDR (scène déjà tone mappée) | 0.7 - 0.85 | 0.1 - 0.2 |
| Synthwave/Néon intense | 0.5 - 0.7 | 0.5 - 1.0 |

### Exposure Settings

| Configuration | Exposure |
|--------------|----------|
| Scène HDR avec valeurs 10-100+ | 0.5 - 2.0 |
| Scène déjà tone mappée (0-1) | 1.0 (pass-through) |
| Ajustement créatif | 0.8 - 1.5 |

### VHS/Grain Settings

| Effet | grainIntensity |
|-------|---------------|
| Invisible | 0.002 - 0.005 |
| Subtil | 0.008 - 0.015 |
| Visible | 0.02 - 0.03 |
| VHS fort | 0.05 - 0.1 |

### Vignette Settings

| Effet | vignetteIntensity |
|-------|------------------|
| Subtil | 0.1 - 0.2 |
| Modéré | 0.3 - 0.4 |
| Fort | 0.5 - 0.7 |

---

## Neon/Synthwave Rendering

### Emissive Materials
```wgsl
// Dans le fragment shader
if (emissive > 0.1) {
  let flicker = sin(time * 8.0 + worldPos.x) * 0.03 + 0.97;
  let emissiveColor = baseColor * emissive * flicker;
  let bloom = emissiveColor * smoothstep(0.5, 2.0, emissive) * 0.5;
  finalColor = finalColor + emissiveColor + bloom;
}
```

### Neon Color Palette
```css
--neon-pink: #ff2d95;
--neon-cyan: #00fff7;
--neon-purple: #b026ff;
--neon-yellow: #fff600;
--dark-bg: #0a0a0f;
```

```wgsl
// En WGSL
let neonPink = vec3f(1.0, 0.176, 0.584);
let neonCyan = vec3f(0.0, 1.0, 0.969);
let neonPurple = vec3f(0.69, 0.149, 1.0);
```

---

## Buffer Management

### Vertex Buffer Layout
```typescript
const vertexBufferLayout: GPUVertexBufferLayout = {
  arrayStride: 32, // position(12) + uv(8) + normal(12)
  attributes: [
    { shaderLocation: 0, offset: 0, format: "float32x3" },  // position
    { shaderLocation: 1, offset: 12, format: "float32x2" }, // uv
    { shaderLocation: 2, offset: 20, format: "float32x3" }, // normal
  ],
};
```

### Uniform Buffer (256-byte alignment!)
```typescript
const uniformBuffer = device.createBuffer({
  size: 256, // Minimum alignment for uniform buffers
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

// Update uniforms
const uniformData = new Float32Array([
  ...viewProjectionMatrix, // 16 floats (mat4)
  time,                     // 1 float
  0, 0, 0,                  // padding
  cameraX, cameraY, cameraZ, 0, // vec3 + padding
]);
device.queue.writeBuffer(uniformBuffer, 0, uniformData);
```

---

## Bind Group Organization

Recommended hierarchy:
```
@group(0) - Per-frame data (uniforms, time, camera)
@group(1) - Per-material data (textures, samplers)
@group(2) - Per-object data (model matrix, emissive)
```

```typescript
const bindGroupLayout = device.createBindGroupLayout({
  entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: { type: "uniform" } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
    { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
  ],
});
```

---

## Render Loop Pattern

```typescript
function render() {
  const time = performance.now() / 1000;

  // Update uniforms
  updateUniforms(time);

  const commandEncoder = device.createCommandEncoder();

  // Main scene pass
  const renderPass = commandEncoder.beginRenderPass({
    colorAttachments: [{
      view: hdrTextureView, // or context.getCurrentTexture().createView()
      clearValue: { r: 0.02, g: 0.02, b: 0.04, a: 1 },
      loadOp: "clear",
      storeOp: "store",
    }],
    depthStencilAttachment: {
      view: depthTextureView,
      depthClearValue: 1,
      depthLoadOp: "clear",
      depthStoreOp: "store",
    },
  });

  renderPass.setPipeline(renderPipeline);
  renderPass.setBindGroup(0, uniformBindGroup);

  for (const object of objects) {
    renderPass.setVertexBuffer(0, object.vertexBuffer);
    renderPass.setIndexBuffer(object.indexBuffer, "uint16");
    renderPass.drawIndexed(object.indexCount);
  }

  renderPass.end();

  // Post-processing passes...

  device.queue.submit([commandEncoder.finish()]);
  requestAnimationFrame(render);
}
```

---

## Error Handling

```typescript
device.pushErrorScope("validation");

// GPU operations...

const error = await device.popErrorScope();
if (error) {
  console.error("WebGPU Error:", error.message);
}

// Handle device loss
device.lost.then((info) => {
  console.error("Device lost:", info.message);
  if (info.reason !== "destroyed") {
    // Attempt to reinitialize
    initWebGPU();
  }
});
```

---

## Performance Best Practices

1. **Minimize CPU-GPU sync**: Avoid `mapAsync` in render loops
2. **Batch draw calls**: Group objects by pipeline/material
3. **Reuse pipelines**: Cache and reuse, don't recreate
4. **Use compute shaders**: For particles, physics, image processing
5. **Optimal workgroup size**: Typically 64 or 256 for compute
6. **Buffer alignment**: 256 bytes for uniform buffers
7. **Texture atlases**: Reduce texture binding changes
8. **Instanced rendering**: For repeated geometry

---

## Common Pitfalls

| Erreur | Solution |
|--------|----------|
| Oublier `device.queue.submit()` | Toujours soumettre les commandes |
| Double tone mapping | Un seul tone mapping dans le pipeline |
| Double gamma correction | Vérifier que gamma n'est appliqué qu'une fois |
| Buffer offset mal aligné | Respecter l'alignement 256 bytes |
| Binding group mismatch | Layouts doivent correspondre au shader |
| Pipeline recréé chaque frame | Cacher et réutiliser |

---

## Debug Tips

### Visualiser les couleurs brutes
```wgsl
// Temporairement dans le fragment shader
return vec4f(color, 1.0); // Avant tone mapping
```

### Vérifier si HDR fonctionne
```wgsl
// Les valeurs > 1.0 indiquent du vrai HDR
let isHDR = select(vec3f(1,0,0), vec3f(0,1,0), any(color > vec3f(1.0)));
return vec4f(isHDR, 1.0);
```

### Log des valeurs GPU
Utiliser un storage buffer pour lire les valeurs côté CPU si nécessaire.

---

## References

- [W3C WebGPU Specification](https://gpuweb.github.io/gpuweb/)
- [WGSL Specification](https://gpuweb.github.io/gpuweb/wgsl/)
- [MDN WebGPU API](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)
- [WebGPU Best Practices](https://toji.dev/webgpu-best-practices/)
- [WebGPU Samples](https://webgpu.github.io/webgpu-samples/)
- [Chrome WebGPU Overview](https://developer.chrome.com/docs/web-platform/webgpu/overview)
