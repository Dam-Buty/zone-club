# WebGPU Fundamentals Reference

Condensed reference from [webgpufundamentals.org](https://webgpufundamentals.org/) — the definitive learning resource for pure WebGPU development.

---

## 1. Initialization

```javascript
async function initWebGPU(canvas) {
  const adapter = await navigator.gpu?.requestAdapter();
  const device = await adapter?.requestDevice();
  if (!device) throw new Error("WebGPU not supported");

  const context = canvas.getContext("webgpu");
  const format = navigator.gpu.getPreferredCanvasFormat(); // rgba8unorm or bgra8unorm
  context.configure({ device, format, alphaMode: "premultiplied" });
  return { device, context, format };
}
```

**Rules:**
- Always use `?.` — adapter/device can be null
- Query `getPreferredCanvasFormat()` — never hardcode
- Label EVERY resource (`label: 'my buffer'`) for clear error messages

---

## 2. Shader Modules (WGSL)

```javascript
const module = device.createShaderModule({
  label: 'scene shaders',
  code: /* wgsl */ `
    @vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
      // Clip space: X [-1,+1] left→right, Y [-1,+1] bottom→top
    }
    @fragment fn fs() -> @location(0) vec4f {
      return vec4f(1, 0, 0, 1);
    }
  `,
});
```

**Gotcha:** Shaders only include resources actually accessed from the entry point. Unused bindings won't appear in the pipeline layout.

---

## 3. WGSL Quick Reference

### Types
| Type | Size | Align | Notes |
|------|------|-------|-------|
| `f32` | 4 | 4 | |
| `i32` | 4 | 4 | |
| `u32` | 4 | 4 | |
| `f16` | 2 | 2 | Optional feature |
| `vec2<f32>` | 8 | 8 | |
| `vec3<f32>` | 12 | **16** | **Padded to 16!** |
| `vec4<f32>` | 16 | 16 | |
| `mat4x4<f32>` | 64 | 16 | 4 × vec4 columns |

### Variables
```wgsl
var a: f32 = 1.0;    // mutable
let b = 2.0;         // immutable binding (runtime)
const PI = 3.14159;  // compile-time constant
```

### Swizzles & Construction
```wgsl
let v = vec4f(1, 2, 3, 4);
let xy = v.xy;                    // vec2f(1, 2)
let rrb = v.rrb;                  // vec3f(1, 1, 3)
let mixed = vec4f(v.zw, 0, 1);   // vec4f(3, 4, 0, 1)
```

### Key Differences from GLSL/JS
- **No ternary** → use `select(falseVal, trueVal, cond)`
- **`++`/`--` are statements**, not expressions (`let b = a++` is ERROR)
- **Type strictness**: `f32(intVal) + floatVal` required
- **Swizzle not on LHS**: `color.rgb = x` is ERROR → `color = vec4f(x, color.a)`
- **`_` phony assignment**: `_ = unusedVar;` to suppress warnings
- **Flat interpolation required for integers**: `@interpolate(flat) myInt: u32`

### Entry Points
```wgsl
@vertex fn vs(...) -> @builtin(position) vec4f { ... }
@fragment fn fs(...) -> @location(0) vec4f { ... }
@compute @workgroup_size(8, 8, 1) fn cs(...) { ... }
```

### Built-in Variables
| Builtin | Stage | Direction | Type |
|---------|-------|-----------|------|
| `vertex_index` | vertex | in | `u32` |
| `instance_index` | vertex | in | `u32` |
| `position` | vertex | **out** | `vec4f` (clip space) |
| `position` | fragment | **in** | `vec4f` (pixel coords) |
| `front_facing` | fragment | in | `bool` |
| `frag_depth` | fragment | out | `f32` |
| `global_invocation_id` | compute | in | `vec3u` |
| `local_invocation_id` | compute | in | `vec3u` |
| `workgroup_id` | compute | in | `vec3u` |

---

## 4. Memory Layout (CRITICAL)

> "Computing sizes and offsets is probably the largest pain point of WebGPU."

### Alignment Rules
- `vec3<f32>` aligns to **16 bytes** (not 12!) — causes silent padding
- Struct alignment = max alignment of all members
- Struct size rounds up to next multiple of its alignment
- Array stride = `roundUp(elementAlign, elementSize)`

### Common Trap: vec3 Padding
```wgsl
struct Bad {
  a: vec3f,  // offset 0,  size 12, but next field aligns to 16
  b: f32,    // offset 16  ← NOT 12!
}
// Total: 20 bytes (not 16 as you'd expect)
```

**Fix:** Use `vec4f` instead of `vec3f` + separate f32, or use a memory layout library.

### Recommendation
Use `webgpu-utils` or similar to auto-compute offsets from WGSL code.

---

## 5. Buffers

### Uniform Buffers (small, frequent reads)
```javascript
const uniformBuffer = device.createBuffer({
  size: 64,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(uniformBuffer, 0, data);
```
- Max size: **64 KiB** (default)
- Read-only in shaders

### Storage Buffers (large, read/write)
```javascript
const storageBuffer = device.createBuffer({
  size: bigData.byteLength,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
```
- Max size: **128 MiB** (default)
- Supports `read_write` in shaders
- Supports runtime-sized arrays: `var<storage> data: array<f32>;`

### WGSL Declaration
```wgsl
@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var<storage, read> vertices: array<Vertex>;
@group(0) @binding(2) var<storage, read_write> output: array<f32>;
```

### Mapped Buffer Pattern (advanced)
```javascript
const buf = device.createBuffer({
  size: dataSize,
  usage: GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC,
  mappedAtCreation: true,
});
new Float32Array(buf.getMappedRange()).set(data);
buf.unmap();
```

---

## 6. Inter-Stage Variables

### Struct Pattern (recommended)
```wgsl
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
  @location(1) uv: vec2f,
};

@vertex fn vs(...) -> VertexOutput { ... }
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  return input.color;
}
```

**Connection is by `@location(N)`, not by variable name.**

### Interpolation Modes
```wgsl
@location(0) @interpolate(perspective, center) normal: vec3f  // default
@location(1) @interpolate(linear, center) screenUV: vec2f
@location(2) @interpolate(flat) materialId: u32               // required for integers
```

---

## 7. Textures & Samplers

### Creation
```javascript
const texture = device.createTexture({
  size: [width, height],
  format: 'rgba8unorm',
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  mipLevelCount: Math.floor(Math.log2(Math.max(width, height))) + 1,
});
```

### Sampler
```javascript
const sampler = device.createSampler({
  magFilter: 'linear',
  minFilter: 'linear',
  mipmapFilter: 'linear',
  addressModeU: 'repeat',    // or 'clamp-to-edge'
  addressModeV: 'repeat',
});
```

### Bind Group
```javascript
const bindGroup = device.createBindGroup({
  layout: pipeline.getBindGroupLayout(0),
  entries: [
    { binding: 0, resource: sampler },
    { binding: 1, resource: texture.createView() },
  ],
});
```

### WGSL Sampling
```wgsl
@group(0) @binding(0) var mySampler: sampler;
@group(0) @binding(1) var myTexture: texture_2d<f32>;

@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  return textureSample(myTexture, mySampler, uv);
}
```

### Gotchas
- **Always generate mipmaps** for textures that will be minified — otherwise severe aliasing
- **Y-axis flip**: texture coord 0,0 = first texel. May need `1.0 - uv.y` depending on source
- **Filter cost**: linear = 4+ texels/sample, nearest = 1. Choose per use case

---

## 8. Compute Shaders

```wgsl
@group(0) @binding(0) var<storage, read_write> data: array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  data[i] = data[i] * 2.0;
}
```

```javascript
const pipeline = device.createComputePipeline({
  layout: 'auto',
  compute: { module, entryPoint: 'main' },
});

const encoder = device.createCommandEncoder();
const pass = encoder.beginComputePass();
pass.setPipeline(pipeline);
pass.setBindGroup(0, bindGroup);
pass.dispatchWorkgroups(Math.ceil(count / 64));
pass.end();
device.queue.submit([encoder.finish()]);
```

**Rule:** `dispatchWorkgroups(ceil(N / workgroupSize))` to cover all elements.

---

## 9. Render Pipeline

```javascript
const pipeline = device.createRenderPipeline({
  label: 'render pipeline',
  layout: 'auto',
  vertex: {
    module,
    buffers: [{
      arrayStride: 8 * 4,  // 8 floats per vertex
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },  // position
        { shaderLocation: 1, offset: 12, format: 'float32x3' }, // normal
        { shaderLocation: 2, offset: 24, format: 'float32x2' }, // uv
      ],
    }],
  },
  fragment: {
    module,
    targets: [{ format: presentationFormat }],
  },
  depthStencil: {
    format: 'depth24plus',
    depthWriteEnabled: true,
    depthCompare: 'less',
  },
  primitive: {
    topology: 'triangle-list',
    cullMode: 'back',   // backface culling — free perf
  },
});
```

### Render Pass
```javascript
const renderPassDesc = {
  colorAttachments: [{
    view: context.getCurrentTexture().createView(),
    clearValue: [0, 0, 0, 1],
    loadOp: 'clear',    // 'load' to preserve
    storeOp: 'store',   // 'discard' if not needed
  }],
  depthStencilAttachment: {
    view: depthTexture.createView(),
    depthClearValue: 1.0,
    depthLoadOp: 'clear',
    depthStoreOp: 'store',
  },
};
```

---

## 10. Performance Optimization

### Hierarchy of Impact (high → low)

1. **Reduce draw calls** — consolidate vertex data into fewer buffers
2. **Uniform buffer strategy** — 3 tiers:
   - Global (1/frame): viewProjection, lights
   - Material (1/init): color, roughness
   - Per-object (N/frame): world matrix
3. **Single large uniform buffer with offsets** — 1 `writeBuffer()` instead of N
4. **Mapped buffer pool** — pre-mapped transfer buffers, remap async after submit
5. **Backface culling** — `cullMode: 'back'` (free perf)
6. **Depth testing** — skip occluded fragments
7. **Render bundles** — pre-record static draw commands
8. **Indirect drawing** — GPU fills draw params, enables GPU-side culling

### Benchmarks (M1 Mac, 75 Hz)
| Technique | Objects @ 75fps | Gain |
|-----------|-----------------|------|
| Unoptimized | 8,000 | baseline |
| All optimizations | 15,000+ | +87% |
| CPU-only (no render) | 9,000 → 18,000 | 2x |

### When to Optimize
- < 200 objects: don't bother
- 1,000+ objects: recommended
- 5,000+ objects: essential

### Canvas Resize
```javascript
const observer = new ResizeObserver(entries => {
  for (const entry of entries) {
    const w = entry.contentBoxSize[0].inlineSize;
    const h = entry.contentBoxSize[0].blockSize;
    canvas.width = Math.max(1, Math.min(w, device.limits.maxTextureDimension2D));
    canvas.height = Math.max(1, Math.min(h, device.limits.maxTextureDimension2D));
  }
  render();
});
observer.observe(canvas);
```

---

## 11. Command Encoding Pattern

```javascript
function frame() {
  // 1. Update data
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // 2. Encode
  const encoder = device.createCommandEncoder({ label: 'frame' });

  // 3. Copy passes first (if using mapped buffers)
  encoder.copyBufferToBuffer(src, 0, dst, 0, size);

  // 4. Render pass
  const pass = encoder.beginRenderPass(renderPassDesc);
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, globalBindGroup);
  pass.setVertexBuffer(0, vertexBuffer);
  pass.draw(vertexCount);
  pass.end();

  // 5. Submit
  device.queue.submit([encoder.finish()]);
  requestAnimationFrame(frame);
}
```

**Critical:** `setPipeline()`, `draw()`, etc. only **encode** commands. Execution happens at `submit()`.

---

## 12. Bind Group Layout Convention

```
@group(0) — Global per-frame data (camera, lights, time)
@group(1) — Material data (textures, samplers, material params)
@group(2) — Per-object data (world matrix, instance data)
```

This matches the update frequency: group 0 changes least, group 2 changes most.

---

## Source

Full tutorials, interactive examples, and deep dives: [webgpufundamentals.org](https://webgpufundamentals.org/)

Topics covered: Basics, Textures, 3D Math, Lighting, Post-Processing, Compute Shaders, Optimization, WGSL Reference, Debugging.
