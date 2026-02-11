struct Uniforms {
  resolution: vec2f,
  time: f32,
  glowIntensity: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;
@group(0) @binding(2) var inputSampler: sampler;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
  var positions = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f(1.0, -1.0),
    vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0),
    vec2f(1.0, -1.0),
    vec2f(1.0, 1.0)
  );
  return vec4f(positions[vertexIndex], 0.0, 1.0);
}

@fragment
fn fragmentMain(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
  let uv = fragCoord.xy / uniforms.resolution;
  let texColor = textureSample(inputTexture, inputSampler, uv);

  let brightness = max(texColor.r, max(texColor.g, texColor.b));

  var bloom = vec4f(0.0);
  let blurSize = 0.003 * uniforms.glowIntensity;

  for (var i = -2; i <= 2; i++) {
    for (var j = -2; j <= 2; j++) {
      let offset = vec2f(f32(i), f32(j)) * blurSize;
      let sample = textureSample(inputTexture, inputSampler, uv + offset);
      let sampleBrightness = max(sample.r, max(sample.g, sample.b));
      if (sampleBrightness > 0.7) {
        bloom += sample;
      }
    }
  }
  bloom /= 25.0;

  let result = texColor + bloom * uniforms.glowIntensity;
  return vec4f(result.rgb, 1.0);
}
