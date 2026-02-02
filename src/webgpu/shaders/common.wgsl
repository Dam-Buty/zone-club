// ============================================================================
// Common WGSL Functions for PBR Rendering
// ============================================================================
// This file contains shared constants and utility functions used by
// multiple shaders in the deferred rendering pipeline.
// ============================================================================

// Mathematical constants
const PI: f32 = 3.14159265359;
const INV_PI: f32 = 0.31830988618;
const EPSILON: f32 = 0.0001;

// ============================================================================
// Normal Encoding/Decoding
// ============================================================================
// Normals are stored in [0,1] range in the G-Buffer to utilize
// the full precision of RGBA16Float textures.

/**
 * Encode a normal vector from [-1,1] to [0,1] range for storage
 * @param n - Normal vector in world space, range [-1,1]
 * @return Encoded normal in [0,1] range
 */
fn encodeNormal(n: vec3f) -> vec3f {
    return n * 0.5 + 0.5;
}

/**
 * Decode a normal vector from [0,1] to [-1,1] range
 * @param n - Encoded normal from G-Buffer, range [0,1]
 * @return Normal vector in world space, range [-1,1]
 */
fn decodeNormal(n: vec3f) -> vec3f {
    return normalize(n * 2.0 - 1.0);
}

// ============================================================================
// Fresnel Functions
// ============================================================================

/**
 * Fresnel-Schlick approximation
 * Describes how light reflects at different angles on a surface.
 * At grazing angles, all surfaces become more reflective.
 *
 * @param cosTheta - Dot product between view and half vector (clamped to 0-1)
 * @param F0 - Base reflectivity at normal incidence (0.04 for dielectrics, albedo for metals)
 * @return Fresnel reflectance
 */
fn fresnelSchlick(cosTheta: f32, F0: vec3f) -> vec3f {
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

/**
 * Fresnel-Schlick with roughness for IBL (Image-Based Lighting)
 * Accounts for roughness in the Fresnel term for environment mapping.
 *
 * @param cosTheta - Dot product between normal and view direction
 * @param F0 - Base reflectivity
 * @param roughness - Surface roughness (0 = smooth, 1 = rough)
 * @return Fresnel reflectance adjusted for roughness
 */
fn fresnelSchlickRoughness(cosTheta: f32, F0: vec3f, roughness: f32) -> vec3f {
    return F0 + (max(vec3f(1.0 - roughness), F0) - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

// ============================================================================
// Normal Distribution Function (NDF)
// ============================================================================

/**
 * GGX/Trowbridge-Reitz Normal Distribution Function
 * Describes the statistical distribution of microfacet normals on the surface.
 * This determines how "sharp" the specular highlight appears.
 *
 * @param N - Surface normal
 * @param H - Half vector (normalized light + view)
 * @param roughness - Surface roughness (0 = smooth mirror, 1 = completely rough)
 * @return Probability of microfacets aligned with H
 */
fn distributionGGX(N: vec3f, H: vec3f, roughness: f32) -> f32 {
    let a = roughness * roughness;
    let a2 = a * a;
    let NdotH = max(dot(N, H), 0.0);
    let NdotH2 = NdotH * NdotH;

    let numerator = a2;
    let denominator = NdotH2 * (a2 - 1.0) + 1.0;

    return numerator / (PI * denominator * denominator + EPSILON);
}

// ============================================================================
// Geometry Function (Shadowing-Masking)
// ============================================================================

/**
 * Schlick-GGX Geometry Function (single direction)
 * Accounts for self-shadowing of microfacets.
 *
 * @param NdotV - Dot product between normal and direction (view or light)
 * @param roughness - Surface roughness
 * @return Geometry term for one direction
 */
fn geometrySchlickGGX(NdotV: f32, roughness: f32) -> f32 {
    // Remap roughness for direct lighting (different from IBL)
    let r = roughness + 1.0;
    let k = (r * r) / 8.0;

    let numerator = NdotV;
    let denominator = NdotV * (1.0 - k) + k;

    return numerator / (denominator + EPSILON);
}

/**
 * Smith's Geometry Function
 * Combines geometry shadowing from both view and light directions.
 *
 * @param N - Surface normal
 * @param V - View direction
 * @param L - Light direction
 * @param roughness - Surface roughness
 * @return Combined geometry term
 */
fn geometrySmith(N: vec3f, V: vec3f, L: vec3f, roughness: f32) -> f32 {
    let NdotV = max(dot(N, V), 0.0);
    let NdotL = max(dot(N, L), 0.0);
    let ggx1 = geometrySchlickGGX(NdotV, roughness);
    let ggx2 = geometrySchlickGGX(NdotL, roughness);

    return ggx1 * ggx2;
}

// ============================================================================
// Position Reconstruction
// ============================================================================

/**
 * Reconstruct world position from depth buffer and screen UV
 * Used in the lighting pass to get world position without storing it in G-Buffer.
 *
 * @param uv - Screen UV coordinates [0,1]
 * @param depth - Depth value from depth buffer [0,1] (0=near, 1=far in WebGPU)
 * @param invViewProj - Inverse of the view-projection matrix
 * @return World position
 */
fn reconstructWorldPos(uv: vec2f, depth: f32, invViewProj: mat4x4f) -> vec3f {
    // Convert UV to clip space: [0,1] -> [-1,1]
    // Note: Y is flipped in WebGPU (0 is top, 1 is bottom in UV, but -1 is bottom in clip)
    let clipX = uv.x * 2.0 - 1.0;
    let clipY = (1.0 - uv.y) * 2.0 - 1.0;

    // Create clip space position (depth is already in [0,1] for WebGPU)
    let clipPos = vec4f(clipX, clipY, depth, 1.0);

    // Transform to world space
    let worldPos = invViewProj * clipPos;

    // Perspective divide
    return worldPos.xyz / worldPos.w;
}

// ============================================================================
// Color Space Conversions
// ============================================================================

/**
 * Convert linear color to sRGB (gamma correction)
 * Apply this at the end of the lighting pass before output.
 *
 * @param linearColor - Color in linear space
 * @return Color in sRGB space
 */
fn linearToSRGB(linearColor: vec3f) -> vec3f {
    let cutoff = linearColor < vec3f(0.0031308);
    let higher = vec3f(1.055) * pow(linearColor, vec3f(1.0 / 2.4)) - vec3f(0.055);
    let lower = linearColor * vec3f(12.92);
    return select(higher, lower, cutoff);
}

/**
 * Convert sRGB color to linear
 * Apply this when reading textures that are in sRGB space.
 *
 * @param srgbColor - Color in sRGB space
 * @return Color in linear space
 */
fn srgbToLinear(srgbColor: vec3f) -> vec3f {
    let cutoff = srgbColor < vec3f(0.04045);
    let higher = pow((srgbColor + vec3f(0.055)) / vec3f(1.055), vec3f(2.4));
    let lower = srgbColor / vec3f(12.92);
    return select(higher, lower, cutoff);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate luminance of a color (perceived brightness)
 * Uses standard coefficients for human perception.
 *
 * @param color - RGB color
 * @return Luminance value
 */
fn luminance(color: vec3f) -> f32 {
    return dot(color, vec3f(0.2126, 0.7152, 0.0722));
}

/**
 * Simple tone mapping using Reinhard operator
 * Maps HDR values to [0,1] range.
 *
 * @param hdrColor - Color in HDR (can have values > 1)
 * @return Tone mapped color in [0,1]
 */
fn reinhardToneMap(hdrColor: vec3f) -> vec3f {
    return hdrColor / (hdrColor + vec3f(1.0));
}

/**
 * ACES Filmic tone mapping
 * More cinematic look than Reinhard, better contrast.
 *
 * @param hdrColor - Color in HDR
 * @return Tone mapped color
 */
fn acesToneMap(hdrColor: vec3f) -> vec3f {
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    return clamp((hdrColor * (a * hdrColor + b)) / (hdrColor * (c * hdrColor + d) + e), vec3f(0.0), vec3f(1.0));
}

/**
 * Calculate light attenuation using inverse square law with smooth falloff
 *
 * @param distance - Distance from light source
 * @param radius - Light influence radius (beyond this, light is 0)
 * @return Attenuation factor [0,1]
 */
fn lightAttenuation(distance: f32, radius: f32) -> f32 {
    let d = max(distance, EPSILON);
    let invSqr = 1.0 / (d * d);

    // Smooth falloff at the edge of the radius
    let falloff = clamp(1.0 - pow(d / radius, 4.0), 0.0, 1.0);

    return invSqr * falloff * falloff;
}
