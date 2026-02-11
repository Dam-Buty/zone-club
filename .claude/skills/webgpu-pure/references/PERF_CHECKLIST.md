# Performance Checklist - WebGPU

## Measuring Performance

### FPS & Frame Time
```typescript
let lastTime = 0;
let frameCount = 0;
function render(now: number) {
  frameCount++;
  if (now - lastTime >= 1000) {
    console.log(`FPS: ${frameCount}, Frame: ${(1000/frameCount).toFixed(1)}ms`);
    frameCount = 0;
    lastTime = now;
  }
  // ... render ...
  requestAnimationFrame(render);
}
```

### GPU Utilization
- Chrome DevTools > Performance > GPU
- Chrome `chrome://gpu` for capabilities
- `performance.measure()` around submit calls (CPU side only)

---

## Quick Wins

1. **Minimize CPU-GPU sync**: Never use `mapAsync` in render loops
2. **Batch draw calls**: Group objects by pipeline/material, minimize state changes
3. **Reuse pipelines**: Cache created pipelines, never recreate per frame
4. **Texture atlases**: Reduce texture binding changes between draws
5. **Instanced rendering**: For repeated geometry with different transforms

---

## Compute Shader Best Practices

- **Workgroup size**: Typically 64 or 256 (must be power of 2)
- **Occupancy**: Match workgroup size to GPU warp/wave size (32 for NVIDIA, 64 for AMD)
- **Memory coalescing**: Access memory in sequential pattern within workgroups
- **Shared memory**: Use `var<workgroup>` for data shared within a workgroup

```wgsl
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let index = id.x;
  if (index >= arrayLength(&data)) { return; }
  // ...
}
```

---

## Buffer Alignment

- **Uniform buffers**: 256-byte minimum alignment for offsets
- **Storage buffers**: 32-byte alignment recommended
- **Struct members**: Follow WGSL alignment rules (vec3 takes 16 bytes, mat4 takes 64 bytes)

```typescript
const uniformBuffer = device.createBuffer({
  size: 256, // Minimum alignment
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
```

---

## Pipeline Hygiene

- Create all pipelines at init time, not per frame
- Use `layout: "auto"` for simple cases, explicit layouts for shared bind groups
- Group bind groups by update frequency:
  - `@group(0)` = per-frame (camera, time) -- updated every frame
  - `@group(1)` = per-material (textures) -- rarely changes
  - `@group(2)` = per-object (model matrix) -- per draw call

---

## Mobile / Tiler GPUs

- Prefer render pass over multiple passes (tiler-friendly)
- Minimize render target switches
- Use `loadOp: "clear"` instead of `"load"` when possible (avoids tile memory read)
- Keep shader ALU low -- mobile GPUs have fewer compute units
- Prefer `rgba8unorm` over `rgba16float` when HDR is not needed
