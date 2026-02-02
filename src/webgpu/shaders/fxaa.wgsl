// ============================================================================
// FXAA 3.11 Shader (Fast Approximate Anti-Aliasing)
// ============================================================================
// Implementation based on NVIDIA's FXAA 3.11 by Timothy Lottes
// Simplified and optimized for WebGPU
//
// Algorithm Overview:
// 1. Edge Detection: Detect edges using luminance contrast between neighboring pixels
// 2. Edge Direction: Determine if edge is horizontal or vertical
// 3. Edge Walking: Search along the edge to find its endpoints
// 4. Final Blend: Interpolate between pixel and neighbor based on edge shape
//
// This implementation supports three quality presets:
// - Low:    4 search steps, faster but may miss some edges
// - Medium: 8 search steps, good balance of quality and performance
// - High:   12 search steps, best quality but slower
// ============================================================================

// Vertex output structure
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

// FXAA parameters uniform buffer
struct FXAAUniforms {
  texelSize: vec2f,         // 1.0 / texture resolution
  edgeThreshold: f32,       // Minimum edge detection threshold (default 0.0833 = 1/12)
  edgeThresholdMin: f32,    // Minimum edge detection in dark areas (default 0.0625 = 1/16)
  subpixelQuality: f32,     // Sub-pixel aliasing removal (0.0 = off, 1.0 = full)
  qualityPreset: f32,       // 0 = low, 1 = medium, 2 = high
  _padding: vec2f,          // Padding for 16-byte alignment
}

@group(0) @binding(0) var<uniform> params: FXAAUniforms;
@group(0) @binding(1) var sourceTex: texture_2d<f32>;
@group(0) @binding(2) var texSampler: sampler;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate luminance using standard Rec. 709 coefficients
 * This matches human perception of brightness
 */
fn luminance(color: vec3f) -> f32 {
  return dot(color, vec3f(0.299, 0.587, 0.114));
}

/**
 * Sample texture and return luminance using textureLoad for uniform control flow
 */
fn sampleLumaLoad(coords: vec2i) -> f32 {
  return luminance(textureLoad(sourceTex, coords, 0).rgb);
}

/**
 * Load texture at UV coordinates using textureLoad
 */
fn loadAtUV(uv: vec2f, texSize: vec2u) -> vec3f {
  let coords = vec2i(clamp(uv, vec2f(0.0), vec2f(1.0)) * vec2f(texSize));
  return textureLoad(sourceTex, coords, 0).rgb;
}

/**
 * Sample luminance at UV using textureLoad
 */
fn sampleLumaAtUV(uv: vec2f, texSize: vec2u) -> f32 {
  return luminance(loadAtUV(uv, texSize));
}

/**
 * Sample luminance with pixel offset using textureLoad
 */
fn sampleLumaOffset(coords: vec2i, offset: vec2i, texSize: vec2u) -> f32 {
  let newCoords = clamp(coords + offset, vec2i(0), vec2i(texSize) - vec2i(1));
  return luminance(textureLoad(sourceTex, newCoords, 0).rgb);
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
// FXAA Fragment Shader
// ============================================================================

@fragment
fn fxaaFragment(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let texSize = textureDimensions(sourceTex);
  let coords = vec2i(uv * vec2f(texSize));

  // Get the center pixel color using textureLoad
  let centerColor = textureLoad(sourceTex, coords, 0);
  let centerLuma = luminance(centerColor.rgb);

  // ========================================================================
  // STEP 1: LOCAL CONTRAST CHECK
  // ========================================================================
  // Sample luminance at the four cardinal neighbors using textureLoad
  let lumaN = sampleLumaOffset(coords, vec2i(0, -1), texSize);
  let lumaS = sampleLumaOffset(coords, vec2i(0, 1), texSize);
  let lumaE = sampleLumaOffset(coords, vec2i(1, 0), texSize);
  let lumaW = sampleLumaOffset(coords, vec2i(-1, 0), texSize);

  // Find the maximum and minimum luminance around the center
  let lumaMin = min(centerLuma, min(min(lumaN, lumaS), min(lumaE, lumaW)));
  let lumaMax = max(centerLuma, max(max(lumaN, lumaS), max(lumaE, lumaW)));

  // Calculate local contrast (range of luminance values)
  let lumaRange = lumaMax - lumaMin;

  // Check if this is an edge (no early return for uniform control flow)
  let isEdge = lumaRange >= max(params.edgeThresholdMin, lumaMax * params.edgeThreshold);

  // ========================================================================
  // STEP 2: SUB-PIXEL ALIASING TEST
  // ========================================================================
  let lumaNW = sampleLumaOffset(coords, vec2i(-1, -1), texSize);
  let lumaNE = sampleLumaOffset(coords, vec2i(1, -1), texSize);
  let lumaSW = sampleLumaOffset(coords, vec2i(-1, 1), texSize);
  let lumaSE = sampleLumaOffset(coords, vec2i(1, 1), texSize);

  let lumaNS = lumaN + lumaS;
  let lumaWE = lumaW + lumaE;

  let subpixelNSWE = lumaNS + lumaWE;
  let subpixelNW_NE_SW_SE = lumaNW + lumaNE + lumaSW + lumaSE;

  let subpixelA = subpixelNSWE * 2.0 + subpixelNW_NE_SW_SE;
  let subpixelB = (subpixelA * (1.0 / 12.0)) - centerLuma;
  let safeRange = select(1.0, lumaRange, lumaRange > 0.0);
  let subpixelC = clamp(abs(subpixelB) / safeRange, 0.0, 1.0);
  let subpixelD = (-2.0 * subpixelC + 3.0) * subpixelC * subpixelC;
  let subpixelFinal = subpixelD * subpixelD * params.subpixelQuality;

  // ========================================================================
  // STEP 3: EDGE DIRECTION DETECTION
  // ========================================================================
  let edgeHorizontal = abs(lumaNW + lumaNE - 2.0 * lumaN) +
                       abs(lumaW + lumaE - 2.0 * centerLuma) * 2.0 +
                       abs(lumaSW + lumaSE - 2.0 * lumaS);

  let edgeVertical = abs(lumaNW + lumaSW - 2.0 * lumaW) +
                     abs(lumaN + lumaS - 2.0 * centerLuma) * 2.0 +
                     abs(lumaNE + lumaSE - 2.0 * lumaE);

  let isHorizontalEdge = edgeHorizontal >= edgeVertical;

  // ========================================================================
  // STEP 4: CHOOSE EDGE ORIENTATION (branchless)
  // ========================================================================
  let luma1 = select(lumaW, lumaN, isHorizontalEdge);
  let luma2 = select(lumaE, lumaS, isHorizontalEdge);
  var stepLength = select(params.texelSize.x, params.texelSize.y, isHorizontalEdge);

  let gradient1 = luma1 - centerLuma;
  let gradient2 = luma2 - centerLuma;
  let isSteepest1 = abs(gradient1) >= abs(gradient2);
  let gradientScaled = 0.25 * max(abs(gradient1), abs(gradient2));

  stepLength = select(stepLength, -stepLength, isSteepest1);
  let lumaLocalAverage = select(0.5 * (luma2 + centerLuma), 0.5 * (luma1 + centerLuma), isSteepest1);

  // ========================================================================
  // STEP 5: SIMPLIFIED EDGE DETECTION (avoid complex iterative sampling)
  // ========================================================================
  var currentUV = uv;
  currentUV = select(
    vec2f(currentUV.x + stepLength * 0.5, currentUV.y),
    vec2f(currentUV.x, currentUV.y + stepLength * 0.5),
    isHorizontalEdge
  );

  let searchStep = select(
    vec2f(0.0, params.texelSize.y),
    vec2f(params.texelSize.x, 0.0),
    isHorizontalEdge
  );

  // Sample at fixed positions (avoid iterative conditional sampling)
  var uvPos = currentUV + searchStep;
  var uvNeg = currentUV - searchStep;

  // Sample all positions upfront (uniform control flow)
  let lumaEndPos1 = sampleLumaAtUV(uvPos, texSize) - lumaLocalAverage;
  let lumaEndNeg1 = sampleLumaAtUV(uvNeg, texSize) - lumaLocalAverage;

  uvPos += searchStep;
  uvNeg -= searchStep;
  let lumaEndPos2 = sampleLumaAtUV(uvPos, texSize) - lumaLocalAverage;
  let lumaEndNeg2 = sampleLumaAtUV(uvNeg, texSize) - lumaLocalAverage;

  uvPos += searchStep;
  uvNeg -= searchStep;
  let lumaEndPos3 = sampleLumaAtUV(uvPos, texSize) - lumaLocalAverage;
  let lumaEndNeg3 = sampleLumaAtUV(uvNeg, texSize) - lumaLocalAverage;

  uvPos += searchStep;
  uvNeg -= searchStep;
  let lumaEndPos4 = sampleLumaAtUV(uvPos, texSize) - lumaLocalAverage;
  let lumaEndNeg4 = sampleLumaAtUV(uvNeg, texSize) - lumaLocalAverage;

  // Find where edges end (branchless)
  let reachedPos1 = abs(lumaEndPos1) >= gradientScaled;
  let reachedPos2 = abs(lumaEndPos2) >= gradientScaled;
  let reachedPos3 = abs(lumaEndPos3) >= gradientScaled;
  let reachedPos4 = abs(lumaEndPos4) >= gradientScaled;

  let reachedNeg1 = abs(lumaEndNeg1) >= gradientScaled;
  let reachedNeg2 = abs(lumaEndNeg2) >= gradientScaled;
  let reachedNeg3 = abs(lumaEndNeg3) >= gradientScaled;
  let reachedNeg4 = abs(lumaEndNeg4) >= gradientScaled;

  // Calculate distance to edge end (branchless selection)
  var stepsPos = select(4.0, 3.0, reachedPos3);
  stepsPos = select(stepsPos, 2.0, reachedPos2);
  stepsPos = select(stepsPos, 1.0, reachedPos1);

  var stepsNeg = select(4.0, 3.0, reachedNeg3);
  stepsNeg = select(stepsNeg, 2.0, reachedNeg2);
  stepsNeg = select(stepsNeg, 1.0, reachedNeg1);

  let lumaEndPos = select(select(select(lumaEndPos4, lumaEndPos3, reachedPos3), lumaEndPos2, reachedPos2), lumaEndPos1, reachedPos1);
  let lumaEndNeg = select(select(select(lumaEndNeg4, lumaEndNeg3, reachedNeg3), lumaEndNeg2, reachedNeg2), lumaEndNeg1, reachedNeg1);

  // ========================================================================
  // STEP 7: CALCULATE BLEND FACTOR
  // ========================================================================
  let stepSize = select(params.texelSize.y, params.texelSize.x, isHorizontalEdge);
  let distancePos = stepsPos * stepSize;
  let distanceNeg = stepsNeg * stepSize;

  let isCloserPos = distancePos < distanceNeg;
  let distanceCloser = min(distancePos, distanceNeg);
  let edgeLength = distancePos + distanceNeg;

  var pixelOffset = -distanceCloser / max(edgeLength, 0.0001) + 0.5;

  let isLumaCenterSmaller = centerLuma < lumaLocalAverage;
  let correctVariationPos = (lumaEndPos < 0.0) != isLumaCenterSmaller;
  let correctVariationNeg = (lumaEndNeg < 0.0) != isLumaCenterSmaller;
  let correctVariation = select(correctVariationNeg, correctVariationPos, isCloserPos);

  pixelOffset = select(0.0, pixelOffset, correctVariation);

  // ========================================================================
  // STEP 8: FINAL BLEND
  // ========================================================================
  let finalOffset = max(pixelOffset, subpixelFinal);

  var finalUV = uv;
  finalUV = select(
    vec2f(finalUV.x + finalOffset * stepLength, finalUV.y),
    vec2f(finalUV.x, finalUV.y + finalOffset * stepLength),
    isHorizontalEdge
  );

  // Load final color (use textureLoad for uniform control flow)
  let finalCoords = vec2i(clamp(finalUV, vec2f(0.0), vec2f(1.0)) * vec2f(texSize));
  let aaColor = textureLoad(sourceTex, finalCoords, 0);

  // Return original color if not an edge, AA color otherwise
  return select(centerColor, aaColor, isEdge);
}

// ============================================================================
// PASSTHROUGH FRAGMENT SHADER (for when FXAA is disabled)
// ============================================================================

@fragment
fn passthroughFragment(input: VertexOutput) -> @location(0) vec4f {
  let texSize = textureDimensions(sourceTex);
  let coords = vec2i(input.uv * vec2f(texSize));
  return textureLoad(sourceTex, coords, 0);
}
