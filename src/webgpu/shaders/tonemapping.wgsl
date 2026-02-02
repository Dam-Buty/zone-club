// ============================================================================
// Tone Mapping and Color Grading Shader
// ============================================================================
// Full-screen post-processing pass for HDR to LDR conversion with
// cinematic color grading effects.
//
// Pipeline:
// 1. Apply exposure adjustment (in linear space)
// 2. Apply color grading (saturation, contrast, brightness, temperature)
// 3. Apply tone mapping algorithm (ACES, Reinhard, or Filmic)
// 4. Apply vignette effect (optional)
// 5. Convert to sRGB color space with gamma correction
// ============================================================================

// Vertex output structure
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

// Tone mapping parameters uniform buffer
// Total size: 48 bytes (12 floats, aligned to 16 bytes)
struct ToneMappingUniforms {
  exposure: f32,          // Exposure multiplier (default 1.0)
  gamma: f32,             // Gamma correction value (default 2.2)
  algorithm: u32,         // 0 = ACES, 1 = Reinhard, 2 = Filmic
  saturation: f32,        // Color saturation (default 1.0)
  contrast: f32,          // Contrast adjustment (default 1.0)
  brightness: f32,        // Brightness offset (default 0.0)
  colorTempKelvin: f32,   // Color temperature in Kelvin (6500 = neutral)
  vignetteStrength: f32,  // Vignette intensity (default 0.0, no vignette)
  vignetteRadius: f32,    // Vignette start radius (default 0.75)
  texelSizeX: f32,        // 1.0 / width
  texelSizeY: f32,        // 1.0 / height
  _padding: f32,          // Padding for 16-byte alignment
}

@group(0) @binding(0) var<uniform> params: ToneMappingUniforms;
@group(0) @binding(1) var hdrTexture: texture_2d<f32>;
@group(0) @binding(2) var texSampler: sampler;

// Optional bloom texture for compositing
@group(0) @binding(3) var bloomTexture: texture_2d<f32>;

// ============================================================================
// Constants
// ============================================================================

const EPSILON: f32 = 0.0001;

// Luminance coefficients (Rec. 709)
const LUMINANCE_WEIGHTS: vec3f = vec3f(0.2126, 0.7152, 0.0722);

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate luminance (perceived brightness) of a color
 * Uses Rec. 709 coefficients for accurate human perception
 */
fn luminance(color: vec3f) -> f32 {
  return dot(color, LUMINANCE_WEIGHTS);
}

/**
 * Safe normalize to avoid division by zero
 */
fn safeNormalize(v: vec3f) -> vec3f {
  let len = length(v);
  return select(v / len, vec3f(0.0), len < EPSILON);
}

// ============================================================================
// Tone Mapping Algorithms
// ============================================================================

/**
 * Reinhard Tone Mapping (Simple)
 * Classic, simple tone mapping that preserves colors but can look flat.
 * Good for comparison and subtle scenes.
 *
 * @param hdr - HDR color input
 * @return Tone mapped LDR color
 */
fn reinhardToneMap(hdr: vec3f) -> vec3f {
  return hdr / (hdr + vec3f(1.0));
}

/**
 * Reinhard Extended Tone Mapping
 * Allows for white point adjustment for brighter highlights.
 *
 * @param hdr - HDR color input
 * @param whitePoint - Maximum luminance in the scene
 * @return Tone mapped LDR color
 */
fn reinhardExtendedToneMap(hdr: vec3f, whitePoint: f32) -> vec3f {
  let numerator = hdr * (1.0 + hdr / (whitePoint * whitePoint));
  return numerator / (1.0 + hdr);
}

/**
 * ACES Filmic Tone Mapping
 * Industry-standard cinematic look used in many AAA games and films.
 * Provides excellent contrast and color preservation.
 *
 * This is the simplified/fitted version of the full ACES transform,
 * using the RRT (Reference Rendering Transform) and ODT (Output Device Transform).
 *
 * @param hdr - HDR color input (in linear space)
 * @return Tone mapped LDR color
 */
fn acesToneMap(hdr: vec3f) -> vec3f {
  // ACES fitted curve by Krzysztof Narkowicz
  // https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/
  let a: f32 = 2.51;
  let b: f32 = 0.03;
  let c: f32 = 2.43;
  let d: f32 = 0.59;
  let e: f32 = 0.14;

  return clamp((hdr * (a * hdr + b)) / (hdr * (c * hdr + d) + e), vec3f(0.0), vec3f(1.0));
}

/**
 * Full ACES Tone Mapping with proper matrices
 * More accurate than the fitted curve but slightly more expensive.
 * Includes the sRGB to ACEScg color space conversion.
 *
 * @param hdr - HDR color input (in sRGB/Rec.709 primaries)
 * @return Tone mapped LDR color (in sRGB primaries)
 */
fn acesFullToneMap(hdr: vec3f) -> vec3f {
  // sRGB to ACEScg (AP1) input matrix
  let ACESInputMat = mat3x3f(
    vec3f(0.59719, 0.07600, 0.02840),
    vec3f(0.35458, 0.90834, 0.13383),
    vec3f(0.04823, 0.01566, 0.83777)
  );

  // ACEScg (AP1) to sRGB output matrix
  let ACESOutputMat = mat3x3f(
    vec3f( 1.60475, -0.10208, -0.00327),
    vec3f(-0.53108,  1.10813, -0.07276),
    vec3f(-0.07367, -0.00605,  1.07602)
  );

  // Convert from sRGB to ACEScg color space
  var color = ACESInputMat * hdr;

  // Apply RRT and ODT fit
  let a = color * (color + 0.0245786) - 0.000090537;
  let b = color * (0.983729 * color + 0.4329510) + 0.238081;
  color = a / b;

  // Convert back to sRGB color space
  color = ACESOutputMat * color;

  return clamp(color, vec3f(0.0), vec3f(1.0));
}

/**
 * Uncharted 2 / Filmic Tone Mapping
 * Originally developed by John Hable for Uncharted 2.
 * Good for games with realistic lighting, slightly more contrast than Reinhard.
 *
 * @param hdr - HDR color input
 * @return Tone mapped LDR color
 */
fn filmicToneMap(hdr: vec3f) -> vec3f {
  // Filmic curve parameters
  let A: f32 = 0.15;  // Shoulder strength
  let B: f32 = 0.50;  // Linear strength
  let C: f32 = 0.10;  // Linear angle
  let D: f32 = 0.20;  // Toe strength
  let E: f32 = 0.02;  // Toe numerator
  let F: f32 = 0.30;  // Toe denominator

  // Apply the filmic curve formula
  let x = hdr;
  let mapped = ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;

  // White point
  let W: f32 = 11.2;
  let whiteScale = ((W * (A * W + C * B) + D * E) / (W * (A * W + B) + D * F)) - E / F;

  return mapped / whiteScale;
}

// ============================================================================
// Color Grading Functions
// ============================================================================

/**
 * Adjust saturation of a color
 * Works by lerping between the grayscale and original color.
 *
 * @param color - Input color
 * @param saturation - Saturation multiplier (0 = grayscale, 1 = original, >1 = oversaturated)
 * @return Saturation-adjusted color
 */
fn adjustSaturation(color: vec3f, saturation: f32) -> vec3f {
  let lum = luminance(color);
  let gray = vec3f(lum);
  return mix(gray, color, saturation);
}

/**
 * Adjust contrast of a color
 * Pivots around middle gray (0.5) to increase or decrease contrast.
 *
 * @param color - Input color
 * @param contrast - Contrast multiplier (1 = original, >1 = more contrast, <1 = less contrast)
 * @return Contrast-adjusted color
 */
fn adjustContrast(color: vec3f, contrast: f32) -> vec3f {
  // Use 0.5 as the pivot point for contrast adjustment
  let midGray = vec3f(0.5);
  return (color - midGray) * contrast + midGray;
}

/**
 * Adjust brightness of a color
 * Simple additive brightness adjustment.
 *
 * @param color - Input color
 * @param brightness - Brightness offset (-1 to 1 recommended)
 * @return Brightness-adjusted color
 */
fn adjustBrightness(color: vec3f, brightness: f32) -> vec3f {
  return color + vec3f(brightness);
}

/**
 * Convert color temperature (Kelvin) to RGB multiplier
 * Based on Tanner Helland's algorithm.
 * 6500K is neutral daylight.
 *
 * @param kelvin - Color temperature in Kelvin (1000-40000)
 * @return RGB color multiplier
 */
fn colorTemperatureToRGB(kelvin: f32) -> vec3f {
  let temp = clamp(kelvin, 1000.0, 40000.0) / 100.0;

  var r: f32;
  var g: f32;
  var b: f32;

  // Red
  if (temp <= 66.0) {
    r = 1.0;
  } else {
    r = pow(temp - 60.0, -0.1332047592) * 329.698727446 / 255.0;
  }

  // Green
  if (temp <= 66.0) {
    g = (log(temp) * 99.4708025861 - 161.1195681661) / 255.0;
  } else {
    g = pow(temp - 60.0, -0.0755148492) * 288.1221695283 / 255.0;
  }

  // Blue
  if (temp >= 66.0) {
    b = 1.0;
  } else if (temp <= 19.0) {
    b = 0.0;
  } else {
    b = (log(temp - 10.0) * 138.5177312231 - 305.0447927307) / 255.0;
  }

  return clamp(vec3f(r, g, b), vec3f(0.0), vec3f(1.0));
}

/**
 * Apply white balance adjustment based on color temperature
 * Shifts colors towards warm (lower K) or cool (higher K).
 *
 * @param color - Input color
 * @param kelvin - Target color temperature in Kelvin
 * @return White-balanced color
 */
fn applyWhiteBalance(color: vec3f, kelvin: f32) -> vec3f {
  // Get the color of the target temperature
  let tempColor = colorTemperatureToRGB(kelvin);

  // Neutral temperature (6500K) color for reference
  let neutralColor = colorTemperatureToRGB(6500.0);

  // Calculate the adjustment ratio
  let adjustment = neutralColor / (tempColor + EPSILON);

  return color * adjustment;
}

// ============================================================================
// Vignette Effect
// ============================================================================

/**
 * Calculate vignette darkening factor
 * Creates a smooth darkening towards the edges of the screen.
 *
 * @param uv - Screen UV coordinates [0,1]
 * @param strength - Vignette intensity (0 = none, 1 = full)
 * @param radius - Distance from center where vignette starts
 * @return Vignette multiplier (1 = no darkening, 0 = full black)
 */
fn calculateVignette(uv: vec2f, strength: f32, radius: f32) -> f32 {
  // Calculate distance from center (0.5, 0.5)
  let center = vec2f(0.5);
  let dist = distance(uv, center);

  // Smooth falloff from radius to edge
  let vignette = smoothstep(radius, radius + 0.5, dist);

  // Apply strength and return darkening factor
  return 1.0 - (vignette * strength);
}

/**
 * Cinematic vignette with elliptical shape
 * Accounts for aspect ratio to create an oval vignette.
 *
 * @param uv - Screen UV coordinates [0,1]
 * @param strength - Vignette intensity
 * @param radius - Vignette start radius
 * @param aspectRatio - Width / Height
 * @return Vignette multiplier
 */
fn calculateCinematicVignette(uv: vec2f, strength: f32, radius: f32, aspectRatio: f32) -> f32 {
  // Adjust UV for aspect ratio to create elliptical vignette
  var adjustedUV = uv - 0.5;
  adjustedUV.x *= aspectRatio;

  let dist = length(adjustedUV);

  // Smooth polynomial falloff for cinematic look
  let vignette = smoothstep(radius * 0.5, radius + 0.3, dist);

  return 1.0 - (vignette * vignette * strength);
}

// ============================================================================
// Color Space Conversion
// ============================================================================

/**
 * Convert linear RGB to sRGB with gamma correction
 * Uses the standard sRGB transfer function (IEC 61966-2-1)
 *
 * @param linear - Color in linear space
 * @return Color in sRGB space
 */
fn linearToSRGB(linear: vec3f) -> vec3f {
  let cutoff = linear < vec3f(0.0031308);
  let higher = vec3f(1.055) * pow(max(linear, vec3f(0.0)), vec3f(1.0 / 2.4)) - vec3f(0.055);
  let lower = linear * vec3f(12.92);
  return select(higher, lower, cutoff);
}

/**
 * Simple gamma correction
 * Faster than proper sRGB conversion, use when performance matters.
 *
 * @param linear - Color in linear space
 * @param gamma - Gamma value (typically 2.2)
 * @return Gamma-corrected color
 */
fn gammaCorrect(linear: vec3f, gamma: f32) -> vec3f {
  return pow(max(linear, vec3f(0.0)), vec3f(1.0 / gamma));
}

// ============================================================================
// Fullscreen Triangle Vertex Shader
// ============================================================================
// Generates a fullscreen triangle using vertex index.
// More efficient than a quad (3 vertices vs 6, no index buffer needed).

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var output: VertexOutput;

  // Generate oversized triangle that covers the entire screen
  // Vertex 0: (-1, -1) -> UV (0, 1)
  // Vertex 1: (3, -1)  -> UV (2, 1)
  // Vertex 2: (-1, 3)  -> UV (0, -1)
  let x = f32((vertexIndex << 1u) & 2u);
  let y = f32(vertexIndex & 2u);

  output.position = vec4f(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
  // Flip Y for correct UV orientation (WebGPU has Y-down in framebuffer)
  output.uv = vec2f(x, 1.0 - y);

  return output;
}

// ============================================================================
// Main Tone Mapping Fragment Shader
// ============================================================================

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  // Sample the HDR texture
  var color = textureSample(hdrTexture, texSampler, input.uv).rgb;

  // -------------------------------------------------------------------------
  // Step 1: Apply exposure (in linear space)
  // -------------------------------------------------------------------------
  color = color * params.exposure;

  // -------------------------------------------------------------------------
  // Step 2: Apply color grading (in linear space, before tone mapping)
  // -------------------------------------------------------------------------

  // White balance / color temperature adjustment
  if (abs(params.colorTempKelvin - 6500.0) > 100.0) {
    color = applyWhiteBalance(color, params.colorTempKelvin);
  }

  // Saturation adjustment
  if (abs(params.saturation - 1.0) > EPSILON) {
    color = adjustSaturation(color, params.saturation);
  }

  // Contrast adjustment
  if (abs(params.contrast - 1.0) > EPSILON) {
    color = adjustContrast(color, params.contrast);
  }

  // Brightness adjustment
  if (abs(params.brightness) > EPSILON) {
    color = adjustBrightness(color, params.brightness);
  }

  // Ensure non-negative values before tone mapping
  color = max(color, vec3f(0.0));

  // -------------------------------------------------------------------------
  // Step 3: Apply tone mapping algorithm
  // -------------------------------------------------------------------------
  switch (params.algorithm) {
    case 0u: {
      // ACES Filmic (default, best for cinematic look)
      color = acesToneMap(color);
    }
    case 1u: {
      // Reinhard (simple, good for comparison)
      color = reinhardToneMap(color);
    }
    case 2u: {
      // Filmic (Uncharted 2 style)
      color = filmicToneMap(color);
    }
    default: {
      // Fallback to ACES
      color = acesToneMap(color);
    }
  }

  // -------------------------------------------------------------------------
  // Step 4: Apply vignette (after tone mapping, before gamma)
  // -------------------------------------------------------------------------
  if (params.vignetteStrength > EPSILON) {
    // Calculate aspect ratio from texel size
    let aspectRatio = params.texelSizeY / params.texelSizeX;
    let vignette = calculateCinematicVignette(input.uv, params.vignetteStrength, params.vignetteRadius, aspectRatio);
    color = color * vignette;
  }

  // -------------------------------------------------------------------------
  // Step 5: Convert to sRGB with gamma correction
  // -------------------------------------------------------------------------
  // Use proper sRGB conversion for accuracy
  color = linearToSRGB(color);

  // Alternatively, use simple gamma correction (uncomment if needed):
  // color = gammaCorrect(color, params.gamma);

  return vec4f(color, 1.0);
}

// ============================================================================
// Tone Mapping with Bloom Composite Fragment Shader
// ============================================================================
// Variant that composites bloom before tone mapping

@fragment
fn fragmentWithBloom(input: VertexOutput) -> @location(0) vec4f {
  // Sample the HDR texture
  var color = textureSample(hdrTexture, texSampler, input.uv).rgb;

  // Sample and add bloom
  let bloom = textureSample(bloomTexture, texSampler, input.uv).rgb;
  color = color + bloom;

  // Apply exposure
  color = color * params.exposure;

  // Color grading
  if (abs(params.colorTempKelvin - 6500.0) > 100.0) {
    color = applyWhiteBalance(color, params.colorTempKelvin);
  }

  if (abs(params.saturation - 1.0) > EPSILON) {
    color = adjustSaturation(color, params.saturation);
  }

  if (abs(params.contrast - 1.0) > EPSILON) {
    color = adjustContrast(color, params.contrast);
  }

  if (abs(params.brightness) > EPSILON) {
    color = adjustBrightness(color, params.brightness);
  }

  color = max(color, vec3f(0.0));

  // Tone mapping
  switch (params.algorithm) {
    case 0u: {
      color = acesToneMap(color);
    }
    case 1u: {
      color = reinhardToneMap(color);
    }
    case 2u: {
      color = filmicToneMap(color);
    }
    default: {
      color = acesToneMap(color);
    }
  }

  // Vignette
  if (params.vignetteStrength > EPSILON) {
    let aspectRatio = params.texelSizeY / params.texelSizeX;
    let vignette = calculateCinematicVignette(input.uv, params.vignetteStrength, params.vignetteRadius, aspectRatio);
    color = color * vignette;
  }

  // sRGB conversion
  color = linearToSRGB(color);

  return vec4f(color, 1.0);
}
