# WGSL Shader Patterns

## Vertex Shader Structure

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

---

## Fragment Shader with Lighting

```wgsl
@group(0) @binding(1) var texSampler: sampler;
@group(0) @binding(2) var albedoTexture: texture_2d<f32>;

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let albedo = textureSample(albedoTexture, texSampler, input.uv).rgb;
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

## Struct Packing Rules

WGSL has strict alignment requirements:

| Type | Alignment | Size |
|------|-----------|------|
| `f32` | 4 | 4 |
| `vec2f` | 8 | 8 |
| `vec3f` | **16** | 12 |
| `vec4f` | 16 | 16 |
| `mat4x4f` | 16 | 64 |

**Key rule**: `vec3f` has 16-byte alignment but only 12 bytes of data. Add padding or reorder fields.

```wgsl
// WRONG: time will overlap with cameraPos due to alignment
struct Bad {
  cameraPos: vec3f,  // 16 bytes (12 data + 4 padding)
  time: f32,         // This starts at byte 12, NOT 16!
}

// CORRECT: place f32 after vec3 to fill padding
struct Good {
  cameraPos: vec3f,  // bytes 0-11
  time: f32,         // bytes 12-15 (fills vec3 padding)
}
```

---

## Bind Group Conventions

Recommended hierarchy by update frequency:

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

## Vertex Buffer Layout

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

---

## Uniform Buffer (256-byte alignment)

```typescript
const uniformBuffer = device.createBuffer({
  size: 256, // Minimum alignment for uniform buffers
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

const uniformData = new Float32Array([
  ...viewProjectionMatrix, // 16 floats (mat4)
  time,                     // 1 float
  0, 0, 0,                  // padding to align vec3
  cameraX, cameraY, cameraZ, 0, // vec3 + padding
]);
device.queue.writeBuffer(uniformBuffer, 0, uniformData);
```

---

## Debug Views

### Visualize raw colors
```wgsl
return vec4f(color, 1.0); // Before tone mapping
```

### Check if HDR is working
```wgsl
let isHDR = select(vec3f(1,0,0), vec3f(0,1,0), any(color > vec3f(1.0)));
return vec4f(isHDR, 1.0); // Green = HDR, Red = LDR
```

### Visualize normals
```wgsl
return vec4f(input.normal * 0.5 + 0.5, 1.0); // Normals as colors
```

### Visualize UVs
```wgsl
return vec4f(input.uv, 0.0, 1.0); // Red = U, Green = V
```
