struct Uniforms {
  resolution: vec2f,
  time: f32,
  grainIntensity: f32,
  scanlineIntensity: f32,
  trackingEnabled: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;
@group(0) @binding(2) var inputSampler: sampler;

fn rand(co: vec2f) -> f32 {
  return fract(sin(dot(co, vec2f(12.9898, 78.233))) * 43758.5453);
}

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
  var uv = fragCoord.xy / uniforms.resolution;

  if (uniforms.trackingEnabled > 0.5) {
    let trackingLine = step(0.98, fract(uv.y * 20.0 + uniforms.time * 2.0));
    uv.x += trackingLine * 0.02 * sin(uniforms.time * 10.0);
  }

  var color = textureSample(inputTexture, inputSampler, uv);

  let scanline = sin(fragCoord.y * 2.0) * 0.5 + 0.5;
  color = mix(color, color * scanline, uniforms.scanlineIntensity * 0.3);

  let grain = rand(uv + vec2f(uniforms.time, 0.0)) - 0.5;
  color += vec4f(vec3f(grain * uniforms.grainIntensity * 0.1), 0.0);

  let caOffset = 0.001;
  let r = textureSample(inputTexture, inputSampler, uv + vec2f(caOffset, 0.0)).r;
  let b = textureSample(inputTexture, inputSampler, uv - vec2f(caOffset, 0.0)).b;
  color.r = r;
  color.b = b;

  let vignette = 1.0 - smoothstep(0.5, 1.5, length(uv - 0.5) * 1.5);
  color *= vignette;

  return vec4f(color.rgb, 1.0);
}
