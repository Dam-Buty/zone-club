---
name: webgpu-pure
description: "Expert skill for pure WebGPU development without Three.js. Covers WebGPU API, WGSL shaders, render/compute pipelines, post-processing (bloom, tone mapping, HDR), neon/synthwave aesthetics, and performance optimization. Use this skill for any WebGPU implementation, shader debugging, pipeline configuration, or graphics rendering task."
---

# WebGPU Pure - Expert Development Skill

## Mandatory Rules

### Before Coding

1. **Study reference images pixel by pixel** -- materials, textures, lighting, proportions
2. **Break down into verifiable sub-tasks** -- the more complex, the more granular
3. **Research state of the art** -- NEVER assume, verify techniques (PBR, shaders, etc.)
4. **Ask as many questions as needed** -- even 100 if necessary
5. **Verify visually after EACH change** -- compare against reference
6. **Admit when you don't know** -- propose alternatives with confidence index

### Forbidden

- **NEVER** use simple boxes when proper geometry exists (e.g. NeonTube.ts)
- **NEVER** mark tasks "completed" without visual verification
- **NEVER** generate "plausible-looking" code without thinking about the goal
- **NEVER** confuse "producing code" with "solving the problem"

---

## Core Expertise

- **WebGPU API**: adapters, devices, queues, command encoders, pipeline management
- **WGSL shaders**: vertex, fragment, compute with optimal performance patterns
- **Pipeline optimization**: render/compute pipelines, binding groups, buffer layouts
- **Post-processing**: HDR, bloom, tone mapping, vignette, grain, scanlines
- **Neon/Synthwave**: emissive glow, color palettes, multipass techniques
- **Cross-platform**: Chrome, Firefox, Safari, Edge compatibility
- **Performance profiling**: GPU utilization, memory bandwidth, command optimization

---

## Architecture

```
Web App → WebGPU (Browser) → Native GPU API (Metal/D3D12/Vulkan) → GPU Driver → GPU
```

## Initialization

```typescript
async function initWebGPU(canvas: HTMLCanvasElement) {
  if (!navigator.gpu) throw new Error("WebGPU not supported");
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("No GPU adapter found");
  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu")!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "premultiplied" });
  return { device, context, format };
}
```

---

## Workflow: BUILD

1. Initialize WebGPU (adapter, device, context)
2. Create shader modules (WGSL) -- see [WGSL Patterns](references/WGSL_PATTERNS.md)
3. Define vertex buffer layouts and bind group layouts
4. Create render/compute pipelines
5. Set up render loop with command encoder
6. Add post-processing if needed -- see [PostProcess HDR Bloom](references/POSTPROCESS_HDR_BLOOM.md)
7. Profile and optimize -- see [Performance Checklist](references/PERF_CHECKLIST.md)

## Workflow: DEBUG

When something doesn't render or looks wrong:

1. Check the [Debug Playbook](references/DEBUG_PLAYBOOK.md)
2. Verify error scopes for GPU validation errors
3. Use shader minimal technique (reduce to simplest possible shader)
4. Consult [Anti-Patterns & Lessons](references/ANTI_PATTERNS_LESSONS.md)

---

## Render Loop Pattern

```typescript
function render() {
  updateUniforms(performance.now() / 1000);
  const commandEncoder = device.createCommandEncoder();
  const renderPass = commandEncoder.beginRenderPass({
    colorAttachments: [{
      view: targetView,
      clearValue: { r: 0.02, g: 0.02, b: 0.04, a: 1 },
      loadOp: "clear", storeOp: "store",
    }],
    depthStencilAttachment: {
      view: depthTextureView,
      depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store",
    },
  });
  renderPass.setPipeline(renderPipeline);
  renderPass.setBindGroup(0, uniformBindGroup);
  // Draw objects...
  renderPass.end();
  device.queue.submit([commandEncoder.finish()]);
  requestAnimationFrame(render);
}
```

---

## References

- [WebGPU Fundamentals](references/WEBGPU_FUNDAMENTALS_REFERENCE.md) -- condensed from [webgpufundamentals.org](https://webgpufundamentals.org/): init, WGSL, memory layout, buffers, textures, compute, optimization
- [Debug Playbook](references/DEBUG_PLAYBOOK.md) -- error scopes, black render checklist, shader isolation
- [PostProcess HDR Bloom](references/POSTPROCESS_HDR_BLOOM.md) -- HDR pipeline, tone mapping, bloom, parameters guide
- [Performance Checklist](references/PERF_CHECKLIST.md) -- FPS measurement, quick wins, pipeline hygiene
- [WGSL Patterns](references/WGSL_PATTERNS.md) -- struct packing, bind groups, vertex layouts, debug views
- [Neon/Synthwave Recipes](references/NEON_SYNTHWAVE_RECIPES.md) -- color palette, emissive glow, multipass
- [Anti-Patterns & Lessons](references/ANTI_PATTERNS_LESSONS.md) -- common pitfalls, diagnostic rendu noir
