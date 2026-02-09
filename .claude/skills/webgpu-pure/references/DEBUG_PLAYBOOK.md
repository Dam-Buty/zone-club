# Debug Playbook - WebGPU

## Error Scopes

Use GPU error scopes to catch validation errors:

```typescript
device.pushErrorScope("validation");

// GPU operations...

const error = await device.popErrorScope();
if (error) {
  console.error("WebGPU Error:", error.message);
}
```

## Device Loss Handling

```typescript
device.lost.then((info) => {
  console.error("Device lost:", info.message);
  if (info.reason !== "destroyed") {
    initWebGPU(); // Attempt reinit
  }
});
```

---

## "Rendu Noir" (Black Render) Checklist

When the screen is completely black:

1. **Check `device.queue.submit()`** -- did you forget to submit commands?
2. **Check texture format** -- does `targets[{ format }]` match the canvas format?
3. **Check clear value** -- is `clearValue` set to pure black `{ r:0, g:0, b:0, a:1 }`? Try a visible color.
4. **Check depth test** -- is `depthCompare: "less"` correct? Is depth buffer created?
5. **Check vertex data** -- are positions actually visible in the viewport?
6. **Check bind group** -- do bindings match the shader `@group/@binding` declarations?
7. **Check pipeline layout** -- does `layout: "auto"` or explicit layout match?

---

## Shader Minimal Technique

When a shader doesn't produce expected output:

1. Replace fragment shader with solid color:
```wgsl
@fragment
fn fragmentMain() -> @location(0) vec4f {
  return vec4f(1.0, 0.0, 0.0, 1.0); // Solid red
}
```

2. If red appears: problem is in fragment calculations, not pipeline setup
3. If still black: problem is in vertex shader, pipeline, or submission
4. Incrementally add back complexity until the bug reappears

---

## Isolate Post-Processing

When post-processing produces wrong results:

1. **Bypass all post-processing** -- render directly to canvas
2. If scene looks correct without post-processing: problem is in post-processing chain
3. **Check double tone mapping** -- if scene already does tone mapping, post-processing must NOT do it again
4. **Check HDR format** -- post-processing input must be `rgba16float` for HDR values
5. Add passes back one at a time: bloom, then tone mapping, then vignette, etc.

---

## Visualize Values

### Check raw colors (before tone mapping)
```wgsl
return vec4f(color, 1.0); // Output raw before any transforms
```

### Check if HDR is working
```wgsl
// Green = HDR values present, Red = LDR only
let isHDR = select(vec3f(1,0,0), vec3f(0,1,0), any(color > vec3f(1.0)));
return vec4f(isHDR, 1.0);
```

### Read GPU values to CPU
Use a storage buffer to write values from shader, then `mapAsync` to read on CPU (NOT in render loop -- only for debugging).
