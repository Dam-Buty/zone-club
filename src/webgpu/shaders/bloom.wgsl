// ============================================================================
// Bloom Shader
// ============================================================================
// Multi-pass bloom effect for HDR rendering.
// Uses progressive downsampling/upsampling with high-quality filters.
//
// Passes:
// 1. Threshold: Extract bright pixels above luminance threshold
// 2. Downsample: Progressive blur using 13-tap filter (5 levels)
// 3. Upsample: Combine levels with tent filter
// ============================================================================

// Vertex output structure shared by all passes
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

// Bloom parameters uniform buffer
struct BloomUniforms {
  threshold: f32,      // Luminance threshold for bright pixels (default 1.0)
  softThreshold: f32,  // Soft knee for smooth transition (default 0.5)
  intensity: f32,      // Final bloom intensity multiplier (default 1.0)
  radius: f32,         // Blur radius multiplier (default 0.5)
  texelSize: vec2f,    // 1.0 / current texture resolution
  _padding: vec2f,     // Padding for 16-byte alignment
}

@group(0) @binding(0) var<uniform> params: BloomUniforms;
@group(0) @binding(1) var sourceTex: texture_2d<f32>;
@group(0) @binding(2) var texSampler: sampler;

// For upsample pass - previous mip level to blend with
@group(0) @binding(3) var previousLevel: texture_2d<f32>;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate luminance using standard coefficients
 * Matches human perception of brightness
 */
fn luminance(color: vec3f) -> f32 {
  return dot(color, vec3f(0.2126, 0.7152, 0.0722));
}

/**
 * Soft threshold with smooth knee
 * Creates a gradual transition instead of hard cutoff
 * This preserves more color information and reduces artifacts
 */
fn softThresholdFilter(color: vec3f) -> vec3f {
  let brightness = luminance(color);

  // Calculate soft knee contribution
  let soft = brightness - params.threshold + params.softThreshold;
  let softCurve = clamp(soft * soft / (4.0 * params.softThreshold + 0.00001), 0.0, 1.0);

  // Blend between hard threshold and soft knee
  let contribution = max(softCurve, brightness - params.threshold) / max(brightness, 0.00001);

  return color * contribution;
}

// ============================================================================
// Fullscreen Triangle Vertex Shader
// ============================================================================
// Generates a fullscreen triangle using vertex index
// More efficient than a quad (3 vertices vs 6)

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var output: VertexOutput;

  // Generate triangle that covers the entire screen
  // Vertex 0: (-1, -1) -> UV (0, 1)
  // Vertex 1: (3, -1)  -> UV (2, 1)
  // Vertex 2: (-1, 3)  -> UV (0, -1)
  let x = f32((vertexIndex << 1u) & 2u);
  let y = f32(vertexIndex & 2u);

  output.position = vec4f(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
  // Flip Y for correct UV orientation
  output.uv = vec2f(x, 1.0 - y);

  return output;
}

// ============================================================================
// THRESHOLD PASS
// ============================================================================
// Extracts bright pixels that should contribute to bloom
// Uses soft threshold for smooth transitions

@fragment
fn thresholdFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(sourceTex, texSampler, input.uv).rgb;
  let thresholded = softThresholdFilter(color);
  return vec4f(thresholded, 1.0);
}

// ============================================================================
// DOWNSAMPLE PASS (13-tap filter)
// ============================================================================
// High-quality downsampling using 13 samples in a pattern
// This reduces aliasing and produces smoother blur
//
// Sample pattern (weights shown):
//     1   2   1
//   2   4   2
//     2   4   2
//   1   2   1
// Total weight: 16

@fragment
fn downsampleFragment(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let ts = params.texelSize;

  // Center sample (weight 4)
  var color = textureSample(sourceTex, texSampler, uv).rgb * 4.0;

  // Corner samples (weight 1 each)
  color += textureSample(sourceTex, texSampler, uv + vec2f(-ts.x, -ts.y)).rgb;
  color += textureSample(sourceTex, texSampler, uv + vec2f( ts.x, -ts.y)).rgb;
  color += textureSample(sourceTex, texSampler, uv + vec2f(-ts.x,  ts.y)).rgb;
  color += textureSample(sourceTex, texSampler, uv + vec2f( ts.x,  ts.y)).rgb;

  // Edge samples (weight 2 each)
  color += textureSample(sourceTex, texSampler, uv + vec2f(-ts.x, 0.0)).rgb * 2.0;
  color += textureSample(sourceTex, texSampler, uv + vec2f( ts.x, 0.0)).rgb * 2.0;
  color += textureSample(sourceTex, texSampler, uv + vec2f(0.0, -ts.y)).rgb * 2.0;
  color += textureSample(sourceTex, texSampler, uv + vec2f(0.0,  ts.y)).rgb * 2.0;

  // Normalize by total weight (16)
  return vec4f(color / 16.0, 1.0);
}

// ============================================================================
// UPSAMPLE PASS (9-tap tent filter with blend)
// ============================================================================
// Upsamples and blends with previous level using tent filter
// The tent filter produces smooth gradients without blocky artifacts
//
// Sample pattern (weights shown):
//   1  2  1
//   2  4  2
//   1  2  1
// Total weight: 16

@fragment
fn upsampleFragment(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  // Apply radius multiplier to texel size for adjustable blur
  let ts = params.texelSize * params.radius;

  // 9-tap tent filter
  // Corner samples (weight 1 each)
  var color = textureSample(sourceTex, texSampler, uv + vec2f(-ts.x, -ts.y)).rgb;
  color += textureSample(sourceTex, texSampler, uv + vec2f( ts.x, -ts.y)).rgb;
  color += textureSample(sourceTex, texSampler, uv + vec2f(-ts.x,  ts.y)).rgb;
  color += textureSample(sourceTex, texSampler, uv + vec2f( ts.x,  ts.y)).rgb;

  // Edge samples (weight 2 each)
  color += textureSample(sourceTex, texSampler, uv + vec2f(0.0, -ts.y)).rgb * 2.0;
  color += textureSample(sourceTex, texSampler, uv + vec2f(0.0,  ts.y)).rgb * 2.0;
  color += textureSample(sourceTex, texSampler, uv + vec2f(-ts.x, 0.0)).rgb * 2.0;
  color += textureSample(sourceTex, texSampler, uv + vec2f( ts.x, 0.0)).rgb * 2.0;

  // Center sample (weight 4)
  color += textureSample(sourceTex, texSampler, uv).rgb * 4.0;

  // Normalize by total weight (16)
  color = color / 16.0;

  // Additive blend with previous level
  let previous = textureSample(previousLevel, texSampler, uv).rgb;
  return vec4f(color + previous, 1.0);
}

// ============================================================================
// UPSAMPLE FIRST PASS (no previous level)
// ============================================================================
// First upsample pass has no previous level to blend with

@fragment
fn upsampleFirstFragment(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let ts = params.texelSize * params.radius;

  // 9-tap tent filter (same as upsample but no blend)
  var color = textureSample(sourceTex, texSampler, uv + vec2f(-ts.x, -ts.y)).rgb;
  color += textureSample(sourceTex, texSampler, uv + vec2f( ts.x, -ts.y)).rgb;
  color += textureSample(sourceTex, texSampler, uv + vec2f(-ts.x,  ts.y)).rgb;
  color += textureSample(sourceTex, texSampler, uv + vec2f( ts.x,  ts.y)).rgb;
  color += textureSample(sourceTex, texSampler, uv + vec2f(0.0, -ts.y)).rgb * 2.0;
  color += textureSample(sourceTex, texSampler, uv + vec2f(0.0,  ts.y)).rgb * 2.0;
  color += textureSample(sourceTex, texSampler, uv + vec2f(-ts.x, 0.0)).rgb * 2.0;
  color += textureSample(sourceTex, texSampler, uv + vec2f( ts.x, 0.0)).rgb * 2.0;
  color += textureSample(sourceTex, texSampler, uv).rgb * 4.0;

  return vec4f(color / 16.0, 1.0);
}
