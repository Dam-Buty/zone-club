# WebGPU API Reference (MDN 2026)

## RÈGLES OBLIGATOIRES - PROJET 3D/WEBGPU

**AVANT de coder:**
1. Étudier l'image de référence pixel par pixel
2. Rechercher l'état de l'art (pas d'improvisation!)
3. Utiliser les outils existants (NeonTube.ts, TextureLoader, etc.)
4. Vérifier visuellement CHAQUE modification

**INTERDIT:**
- Boîtes/formes simples par paresse
- Suppositions au lieu de recherche
- Marquer "complété" sans vérification visuelle

---

## Architecture

```
Physical GPU → Native API (Metal/D3D12/Vulkan) → WebGPU → GPUAdapter → GPUDevice
```

## Device Initialization

```javascript
async function initWebGPU() {
  if (!navigator.gpu) throw Error("WebGPU not supported");

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance" // or "low-power"
  });
  if (!adapter) throw Error("No adapter found");

  const device = await adapter.requestDevice();
  return { adapter, device };
}
```

## Canvas Context

```javascript
const context = canvas.getContext("webgpu");
context.configure({
  device,
  format: navigator.gpu.getPreferredCanvasFormat(),
  alphaMode: "premultiplied",
});
```

## Buffers

```javascript
// Create buffer
const buffer = device.createBuffer({
  size: byteLength,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  mappedAtCreation: false,
});

// Write data
device.queue.writeBuffer(buffer, offset, data);

// Map for reading
await buffer.mapAsync(GPUMapMode.READ);
const mapped = buffer.getMappedRange();
buffer.unmap();
```

**Usage Flags:** `COPY_SRC`, `COPY_DST`, `MAP_READ`, `MAP_WRITE`, `VERTEX`, `INDEX`, `UNIFORM`, `STORAGE`, `INDIRECT`

## Textures

```javascript
const texture = device.createTexture({
  size: [width, height, depth],
  format: "rgba8unorm", // or depth24plus, etc.
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
});

const view = texture.createView();
```

## Samplers

```javascript
const sampler = device.createSampler({
  addressModeU: "repeat",
  addressModeV: "repeat",
  magFilter: "linear",
  minFilter: "linear",
  mipmapFilter: "linear",
});
```

## Shader Module (WGSL)

```javascript
const shaderModule = device.createShaderModule({
  code: `
    struct Uniforms {
      mvp: mat4x4f,
      time: f32,
    }

    @group(0) @binding(0) var<uniform> uniforms: Uniforms;

    @vertex
    fn vertexMain(@location(0) pos: vec3f) -> @builtin(position) vec4f {
      return uniforms.mvp * vec4f(pos, 1.0);
    }

    @fragment
    fn fragmentMain() -> @location(0) vec4f {
      return vec4f(1.0, 0.0, 0.0, 1.0);
    }
  `
});
```

## Bind Group Layout

```javascript
const bindGroupLayout = device.createBindGroupLayout({
  entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
    { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
  ],
});
```

## Bind Group

```javascript
const bindGroup = device.createBindGroup({
  layout: bindGroupLayout,
  entries: [
    { binding: 0, resource: { buffer: uniformBuffer } },
    { binding: 1, resource: textureView },
    { binding: 2, resource: sampler },
  ],
});
```

## Render Pipeline

```javascript
const pipeline = device.createRenderPipeline({
  layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
  vertex: {
    module: shaderModule,
    entryPoint: "vertexMain",
    buffers: [{
      arrayStride: 32, // bytes per vertex
      stepMode: "vertex",
      attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x3" },  // position
        { shaderLocation: 1, offset: 12, format: "float32x2" }, // uv
        { shaderLocation: 2, offset: 20, format: "float32x3" }, // normal
      ],
    }],
  },
  fragment: {
    module: shaderModule,
    entryPoint: "fragmentMain",
    targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }],
  },
  primitive: {
    topology: "triangle-list",
    cullMode: "back",
    frontFace: "ccw",
  },
  depthStencil: {
    depthWriteEnabled: true,
    depthCompare: "less",
    format: "depth24plus",
  },
});
```

## Compute Pipeline

```javascript
const computePipeline = device.createComputePipeline({
  layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
  compute: {
    module: shaderModule,
    entryPoint: "main",
  },
});
```

## Command Encoding & Submission

```javascript
const commandEncoder = device.createCommandEncoder();

// Render Pass
const renderPass = commandEncoder.beginRenderPass({
  colorAttachments: [{
    view: context.getCurrentTexture().createView(),
    clearValue: { r: 0, g: 0, b: 0, a: 1 },
    loadOp: "clear",
    storeOp: "store",
  }],
  depthStencilAttachment: {
    view: depthTexture.createView(),
    depthClearValue: 1.0,
    depthLoadOp: "clear",
    depthStoreOp: "store",
  },
});

renderPass.setPipeline(pipeline);
renderPass.setBindGroup(0, bindGroup);
renderPass.setVertexBuffer(0, vertexBuffer);
renderPass.setIndexBuffer(indexBuffer, "uint16");
renderPass.drawIndexed(indexCount);
renderPass.end();

// Compute Pass
const computePass = commandEncoder.beginComputePass();
computePass.setPipeline(computePipeline);
computePass.setBindGroup(0, bindGroup);
computePass.dispatchWorkgroups(workgroupsX, workgroupsY, workgroupsZ);
computePass.end();

// Submit
device.queue.submit([commandEncoder.finish()]);
```

## WGSL Types Reference

### Scalars
- `bool`, `i32`, `u32`, `f32`, `f16`

### Vectors
- `vec2<T>`, `vec3<T>`, `vec4<T>`
- Shortcuts: `vec2f`, `vec3f`, `vec4f`, `vec2i`, `vec3i`, `vec4i`, `vec2u`, `vec3u`, `vec4u`

### Matrices
- `mat2x2<T>`, `mat3x3<T>`, `mat4x4<T>`
- Shortcuts: `mat4x4f`, `mat3x3f`, etc.

### Arrays
- `array<T, N>` (fixed size)
- `array<T>` (runtime sized, storage only)

### Structs
```wgsl
struct MyStruct {
  field1: f32,
  field2: vec3f,
}
```

## WGSL Built-in Functions

### Math
`abs`, `acos`, `asin`, `atan`, `atan2`, `ceil`, `clamp`, `cos`, `cross`, `degrees`, `distance`, `dot`, `exp`, `exp2`, `floor`, `fract`, `inverseSqrt`, `length`, `log`, `log2`, `max`, `min`, `mix`, `normalize`, `pow`, `radians`, `reflect`, `refract`, `round`, `sign`, `sin`, `smoothstep`, `sqrt`, `step`, `tan`, `trunc`

### Texture
`textureSample`, `textureSampleLevel`, `textureSampleGrad`, `textureLoad`, `textureStore`, `textureDimensions`

## WGSL Built-in Variables

### Vertex Stage
- `@builtin(vertex_index)`: `u32`
- `@builtin(instance_index)`: `u32`
- `@builtin(position)`: `vec4f` (output)

### Fragment Stage
- `@builtin(position)`: `vec4f` (input, screen coords)
- `@builtin(front_facing)`: `bool`
- `@builtin(sample_index)`: `u32`
- `@builtin(sample_mask)`: `u32`

### Compute Stage
- `@builtin(local_invocation_id)`: `vec3u`
- `@builtin(local_invocation_index)`: `u32`
- `@builtin(global_invocation_id)`: `vec3u`
- `@builtin(workgroup_id)`: `vec3u`
- `@builtin(num_workgroups)`: `vec3u`

## Error Handling

```javascript
// Error scope
device.pushErrorScope("validation");
// ... operations ...
const error = await device.popErrorScope();
if (error) console.error(error.message);

// Uncaptured errors
device.addEventListener("uncapturederror", (e) => {
  console.error("GPU Error:", e.error);
});
```

## Best Practices

1. Use `navigator.gpu.getPreferredCanvasFormat()` for canvas
2. Use explicit `GPUPipelineLayout` over `"auto"` for performance
3. Batch commands before submission
4. Use staging buffers for CPU↔GPU transfers
5. Keep compute workgroup size ≥64 for good occupancy
6. Properly destroy/release resources when done
7. Handle device loss gracefully

## Multi-Pass Rendering (Post-Processing)

```javascript
// Pass 1: Render to texture
const renderTexture = device.createTexture({
  size: [width, height],
  format: "rgba16float",
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
});

// Pass 2: Post-process and output to canvas
const postProcessPass = commandEncoder.beginRenderPass({
  colorAttachments: [{
    view: context.getCurrentTexture().createView(),
    loadOp: "clear",
    storeOp: "store",
  }],
});
// Bind renderTexture as input, apply effects
postProcessPass.end();
```

## Bloom Effect Pattern

```wgsl
// 1. Extract bright pixels
@fragment
fn extractBright(input: FragInput) -> @location(0) vec4f {
  let color = textureSample(sceneTexture, samp, input.uv);
  let brightness = dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));
  if (brightness > 1.0) {
    return color;
  }
  return vec4f(0.0);
}

// 2. Blur (gaussian, multiple passes)
// 3. Composite: original + blurred bright
```
