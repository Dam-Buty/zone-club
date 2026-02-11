// ============================================================================
// Shadow Mapping Shader
// ============================================================================
// This shader is used for shadow map generation (depth-only rendering).
// Only ceiling lights (plafonniers) cast shadows, not neon tubes.
//
// Features:
// - Depth-only rendering for shadow map generation
// - Support for both directional (ortho) and spot (perspective) lights
// - Configurable bias handled via pipeline depth state
// ============================================================================

// ============================================================================
// Uniform Structures
// ============================================================================

/**
 * Shadow rendering uniforms
 * Contains the light's view-projection matrix and the object's model matrix
 */
struct ShadowUniforms {
    /** Light's view-projection matrix */
    lightViewProjection: mat4x4f,
    /** Object's model-to-world transform */
    model: mat4x4f,
}

// ============================================================================
// Bindings
// ============================================================================

@group(0) @binding(0) var<uniform> shadowUniforms: ShadowUniforms;

// ============================================================================
// Vertex Input
// ============================================================================

/**
 * Minimal vertex input for shadow pass
 * We only need position - no UV, normals, or other attributes
 */
struct VertexInput {
    @location(0) position: vec3f,
}

// ============================================================================
// Vertex Shader - Shadow Map Generation
// ============================================================================

/**
 * Transform vertices to light's clip space for depth rendering
 * This is the main entry point for shadow map generation
 */
@vertex
fn shadowVertexMain(input: VertexInput) -> @builtin(position) vec4f {
    // Transform to world space
    let worldPos = shadowUniforms.model * vec4f(input.position, 1.0);

    // Transform to light's clip space
    return shadowUniforms.lightViewProjection * worldPos;
}

// ============================================================================
// Fragment Shader (Optional)
// ============================================================================
// WebGPU can render depth-only passes without a fragment shader.
// However, we provide an empty one for compatibility and potential
// future use (e.g., alpha testing for foliage shadows).

/**
 * Empty fragment shader for depth-only pass
 * The GPU will automatically write the depth value
 */
@fragment
fn shadowFragmentMain() {
    // Nothing to do - depth is written automatically
    // This fragment shader is optional but can be useful for:
    // - Alpha testing (discard fragments based on texture alpha)
    // - Variance shadow maps (writing depth and depth^2)
}

// ============================================================================
// Alpha-Tested Shadow Fragment (for future use)
// ============================================================================
// Uncomment and use this when you need alpha-tested shadows
// (e.g., for foliage, fences, or other transparent geometry)

/*
struct AlphaVertexInput {
    @location(0) position: vec3f,
    @location(1) uv: vec2f,
}

struct AlphaVertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
}

@group(1) @binding(0) var alphaSampler: sampler;
@group(1) @binding(1) var alphaTexture: texture_2d<f32>;

@vertex
fn shadowAlphaVertexMain(input: AlphaVertexInput) -> AlphaVertexOutput {
    var output: AlphaVertexOutput;

    let worldPos = shadowUniforms.model * vec4f(input.position, 1.0);
    output.position = shadowUniforms.lightViewProjection * worldPos;
    output.uv = input.uv;

    return output;
}

@fragment
fn shadowAlphaFragmentMain(input: AlphaVertexOutput) {
    let alpha = textureSample(alphaTexture, alphaSampler, input.uv).a;

    // Discard transparent fragments
    if (alpha < 0.5) {
        discard;
    }

    // Depth is written automatically for non-discarded fragments
}
*/

// ============================================================================
// PCF Shadow Sampling Functions (for use in pbr-lighting.wgsl)
// ============================================================================
// These functions should be copied to or included in the lighting shader
// They are provided here as reference

/*
// Shadow configuration structure (matches ShadowPass.ts shadowConfigBuffer layout)
struct ShadowConfig {
    lightViewProjection: mat4x4f,
    bias: f32,
    normalBias: f32,
    mapSize: f32,
    pcfSamples: f32,
}

// Calculate shadow coordinates from world position
fn worldToShadowCoord(worldPos: vec3f, lightVP: mat4x4f) -> vec3f {
    // Transform to light clip space
    let lightClip = lightVP * vec4f(worldPos, 1.0);

    // Perspective divide
    let lightNDC = lightClip.xyz / lightClip.w;

    // Convert from [-1,1] to [0,1] for UV lookup
    // Note: Y is flipped for WebGPU texture coordinates
    let shadowCoord = vec3f(
        lightNDC.x * 0.5 + 0.5,
        lightNDC.y * -0.5 + 0.5,
        lightNDC.z  // Depth stays in [0,1] for WebGPU
    );

    return shadowCoord;
}

// Sample shadow with PCF (Percentage Closer Filtering)
fn sampleShadowPCF(
    shadowMap: texture_depth_2d,
    shadowSampler: sampler_comparison,
    shadowCoord: vec3f,
    texelSize: f32
) -> f32 {
    // Check if we're outside the shadow map
    if (shadowCoord.x < 0.0 || shadowCoord.x > 1.0 ||
        shadowCoord.y < 0.0 || shadowCoord.y > 1.0 ||
        shadowCoord.z < 0.0 || shadowCoord.z > 1.0) {
        return 1.0; // No shadow outside the light's view
    }

    var shadow = 0.0;
    let offset = 1.5;
    let sampleCount = 16.0;

    // 4x4 PCF kernel for smooth shadow edges
    for (var y = -offset; y <= offset; y += 1.0) {
        for (var x = -offset; x <= offset; x += 1.0) {
            let sampleUV = shadowCoord.xy + vec2f(x, y) * texelSize;
            shadow += textureSampleCompare(shadowMap, shadowSampler, sampleUV, shadowCoord.z);
        }
    }

    return shadow / sampleCount;
}

// Optimized 4-sample PCF for performance
fn sampleShadowPCF4(
    shadowMap: texture_depth_2d,
    shadowSampler: sampler_comparison,
    shadowCoord: vec3f,
    texelSize: f32
) -> f32 {
    if (shadowCoord.x < 0.0 || shadowCoord.x > 1.0 ||
        shadowCoord.y < 0.0 || shadowCoord.y > 1.0 ||
        shadowCoord.z < 0.0 || shadowCoord.z > 1.0) {
        return 1.0;
    }

    // 2x2 PCF with bilinear offsets
    let offset = 0.5 * texelSize;

    var shadow = 0.0;
    shadow += textureSampleCompare(shadowMap, shadowSampler, shadowCoord.xy + vec2f(-offset, -offset), shadowCoord.z);
    shadow += textureSampleCompare(shadowMap, shadowSampler, shadowCoord.xy + vec2f( offset, -offset), shadowCoord.z);
    shadow += textureSampleCompare(shadowMap, shadowSampler, shadowCoord.xy + vec2f(-offset,  offset), shadowCoord.z);
    shadow += textureSampleCompare(shadowMap, shadowSampler, shadowCoord.xy + vec2f( offset,  offset), shadowCoord.z);

    return shadow * 0.25;
}

// Apply shadow with normal-based bias
fn calculateShadow(
    worldPos: vec3f,
    worldNormal: vec3f,
    shadowMap: texture_depth_2d,
    shadowSampler: sampler_comparison,
    shadowConfig: ShadowConfig
) -> f32 {
    // Apply normal bias to push the sample point along the surface normal
    // This reduces shadow acne on surfaces facing away from the light
    let biasedPos = worldPos + worldNormal * shadowConfig.normalBias;

    // Get shadow coordinates
    let shadowCoord = worldToShadowCoord(biasedPos, shadowConfig.lightViewProjection);

    // Apply depth bias
    let biasedCoord = vec3f(shadowCoord.xy, shadowCoord.z - shadowConfig.bias);

    // Sample with PCF
    let texelSize = 1.0 / shadowConfig.mapSize;
    return sampleShadowPCF(shadowMap, shadowSampler, biasedCoord, texelSize);
}
*/
