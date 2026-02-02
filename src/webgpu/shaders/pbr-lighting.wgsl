// ============================================================================
// PBR Lighting Shader - Deferred Lighting Pass
// ============================================================================
// This shader reads the G-Buffer and computes PBR lighting.
// It renders a fullscreen triangle and accumulates lighting for each pixel.
//
// Features:
// - Physically Based Rendering (PBR) with metallic-roughness workflow
// - Support for multiple point lights
// - Support for directional light (sun)
// - Ambient lighting with hemisphere
// - Emissive materials
// - HDR output (requires tone mapping post-process)
// ============================================================================

// ============================================================================
// Constants
// ============================================================================

const PI: f32 = 3.14159265359;
const EPSILON: f32 = 0.0001;
const MAX_POINT_LIGHTS: u32 = 16u;

// ============================================================================
// Light Structures
// ============================================================================

/**
 * Point light with position, color, and attenuation
 */
struct PointLight {
    position: vec3f,       // World-space position
    radius: f32,           // Influence radius (beyond this, contribution is 0)
    color: vec3f,          // Light color (can be HDR, values > 1)
    intensity: f32,        // Light intensity multiplier
}

/**
 * Directional light (e.g., sun)
 */
struct DirectionalLight {
    direction: vec3f,      // Direction TO the light (normalized)
    _padding1: f32,
    color: vec3f,          // Light color
    intensity: f32,        // Light intensity
}

/**
 * Ambient lighting configuration
 */
struct AmbientLight {
    skyColor: vec3f,       // Color from above (hemisphere lighting)
    _padding1: f32,
    groundColor: vec3f,    // Color from below
    intensity: f32,        // Overall ambient intensity
}

// ============================================================================
// Uniform Structures
// ============================================================================

/**
 * Camera and lighting uniforms
 */
struct LightingUniforms {
    cameraPosition: vec3f,     // Camera world position for specular
    _padding1: f32,
    invViewProj: mat4x4f,      // Inverse view-projection for position reconstruction

    // Directional light
    directionalLight: DirectionalLight,

    // Ambient light
    ambientLight: AmbientLight,

    // Point light count
    numPointLights: u32,
    _padding2: vec3f,
}

// ============================================================================
// Bindings
// ============================================================================

// Group 0: G-Buffer textures
@group(0) @binding(0) var gbufferSampler: sampler;
@group(0) @binding(1) var albedoTex: texture_2d<f32>;
@group(0) @binding(2) var normalTex: texture_2d<f32>;
@group(0) @binding(3) var materialTex: texture_2d<f32>;
@group(0) @binding(4) var emissiveTex: texture_2d<f32>;
@group(0) @binding(5) var depthTex: texture_depth_2d;

// Group 1: Lighting uniforms and lights
@group(1) @binding(0) var<uniform> lighting: LightingUniforms;
@group(1) @binding(1) var<storage, read> pointLights: array<PointLight>;

// ============================================================================
// Vertex Shader - Fullscreen Triangle
// ============================================================================

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
}

/**
 * Generate a fullscreen triangle using vertex index
 * This is more efficient than drawing a quad (2 triangles)
 *
 * Vertex 0: (-1, -1) -> (0, 1)
 * Vertex 1: ( 3, -1) -> (2, 1)
 * Vertex 2: (-1,  3) -> (0, -1)
 *
 * The triangle covers the entire [-1,1] clip space
 */
@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var output: VertexOutput;

    // Generate positions for fullscreen triangle
    let x = f32((vertexIndex << 1u) & 2u);  // 0, 2, 0
    let y = f32(vertexIndex & 2u);           // 0, 0, 2

    // Position: [-1, 3] range to cover screen
    output.position = vec4f(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);

    // UV coordinates [0, 1] with Y flipped for WebGPU
    output.uv = vec2f(x, 1.0 - y);

    return output;
}

// ============================================================================
// PBR Helper Functions
// ============================================================================

/**
 * Decode normal from [0,1] to [-1,1] range
 */
fn decodeNormal(encoded: vec3f) -> vec3f {
    return normalize(encoded * 2.0 - 1.0);
}

/**
 * Reconstruct world position from depth buffer
 */
fn reconstructWorldPosition(uv: vec2f, depth: f32) -> vec3f {
    // Convert UV to clip space
    let clipX = uv.x * 2.0 - 1.0;
    let clipY = (1.0 - uv.y) * 2.0 - 1.0;

    let clipPos = vec4f(clipX, clipY, depth, 1.0);
    let worldPos = lighting.invViewProj * clipPos;

    return worldPos.xyz / worldPos.w;
}

/**
 * Fresnel-Schlick approximation
 */
fn fresnelSchlick(cosTheta: f32, F0: vec3f) -> vec3f {
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

/**
 * GGX Normal Distribution Function
 */
fn distributionGGX(N: vec3f, H: vec3f, roughness: f32) -> f32 {
    let a = roughness * roughness;
    let a2 = a * a;
    let NdotH = max(dot(N, H), 0.0);
    let NdotH2 = NdotH * NdotH;

    let denom = NdotH2 * (a2 - 1.0) + 1.0;
    return a2 / (PI * denom * denom + EPSILON);
}

/**
 * Schlick-GGX Geometry Function
 */
fn geometrySchlickGGX(NdotV: f32, roughness: f32) -> f32 {
    let r = roughness + 1.0;
    let k = (r * r) / 8.0;
    return NdotV / (NdotV * (1.0 - k) + k + EPSILON);
}

/**
 * Smith's Geometry Function
 */
fn geometrySmith(N: vec3f, V: vec3f, L: vec3f, roughness: f32) -> f32 {
    let NdotV = max(dot(N, V), 0.0);
    let NdotL = max(dot(N, L), 0.0);
    return geometrySchlickGGX(NdotV, roughness) * geometrySchlickGGX(NdotL, roughness);
}

/**
 * Calculate light attenuation with smooth falloff
 */
fn calculateAttenuation(distance: f32, radius: f32) -> f32 {
    let d = max(distance, EPSILON);

    // Inverse square falloff
    let invSqr = 1.0 / (d * d);

    // Smooth cutoff at radius
    let falloff = clamp(1.0 - pow(d / radius, 4.0), 0.0, 1.0);

    return invSqr * falloff * falloff;
}

// ============================================================================
// PBR BRDF Calculation
// ============================================================================

/**
 * Calculate Cook-Torrance BRDF for a single light
 * Returns the outgoing radiance contribution from this light
 */
fn calculatePBRLight(
    N: vec3f,         // Surface normal
    V: vec3f,         // View direction (to camera)
    L: vec3f,         // Light direction (to light)
    albedo: vec3f,    // Base color
    metallic: f32,    // Metallic factor
    roughness: f32,   // Roughness factor
    radiance: vec3f   // Incoming light radiance
) -> vec3f {
    // Half vector
    let H = normalize(V + L);

    // Calculate base reflectivity (F0)
    // Dielectrics have F0 = 0.04, metals use their albedo as F0
    let F0 = mix(vec3f(0.04), albedo, metallic);

    // Cook-Torrance BRDF components
    let D = distributionGGX(N, H, roughness);
    let G = geometrySmith(N, V, L, roughness);
    let F = fresnelSchlick(max(dot(H, V), 0.0), F0);

    // Specular BRDF
    let numerator = D * G * F;
    let NdotV = max(dot(N, V), 0.0);
    let NdotL = max(dot(N, L), 0.0);
    let denominator = 4.0 * NdotV * NdotL + EPSILON;
    let specular = numerator / denominator;

    // Diffuse BRDF (Lambertian)
    // kS = Fresnel = energy reflected as specular
    // kD = 1 - kS = energy available for diffuse
    let kS = F;
    var kD = vec3f(1.0) - kS;

    // Metals have no diffuse reflection (all energy goes to specular)
    kD = kD * (1.0 - metallic);

    // Lambertian diffuse
    let diffuse = kD * albedo / PI;

    // Final contribution: (diffuse + specular) * radiance * NdotL
    return (diffuse + specular) * radiance * NdotL;
}

// ============================================================================
// Fragment Shader
// ============================================================================

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    // -------------------------------------------------------------------------
    // Sample G-Buffer
    // -------------------------------------------------------------------------
    let albedoSample = textureSample(albedoTex, gbufferSampler, input.uv);
    let normalSample = textureSample(normalTex, gbufferSampler, input.uv);
    let materialSample = textureSample(materialTex, gbufferSampler, input.uv);
    let emissiveSample = textureSample(emissiveTex, gbufferSampler, input.uv);
    let depth = textureSample(depthTex, gbufferSampler, input.uv);

    // Early exit for sky/background pixels (no geometry)
    if (depth >= 1.0) {
        // Return background color (could be skybox in the future)
        return vec4f(0.02, 0.02, 0.05, 1.0); // Dark blue-ish background
    }

    // -------------------------------------------------------------------------
    // Decode G-Buffer data
    // -------------------------------------------------------------------------
    let albedo = albedoSample.rgb;
    let N = decodeNormal(normalSample.rgb);
    let metallic = materialSample.r;
    let roughness = materialSample.g;
    let ao = materialSample.b;
    let emissive = emissiveSample.rgb;

    // Reconstruct world position
    let worldPos = reconstructWorldPosition(input.uv, depth);

    // View direction (from surface to camera)
    let V = normalize(lighting.cameraPosition - worldPos);

    // -------------------------------------------------------------------------
    // Lighting accumulation
    // -------------------------------------------------------------------------
    var Lo = vec3f(0.0); // Accumulated radiance

    // -------------------------------------------------------------------------
    // Directional Light (Sun)
    // -------------------------------------------------------------------------
    if (lighting.directionalLight.intensity > 0.0) {
        let L = normalize(lighting.directionalLight.direction);
        let radiance = lighting.directionalLight.color * lighting.directionalLight.intensity;

        Lo += calculatePBRLight(N, V, L, albedo, metallic, roughness, radiance);
    }

    // -------------------------------------------------------------------------
    // Point Lights
    // -------------------------------------------------------------------------
    for (var i = 0u; i < lighting.numPointLights; i++) {
        let light = pointLights[i];

        // Light direction and distance
        let lightVec = light.position - worldPos;
        let distance = length(lightVec);
        let L = lightVec / distance;

        // Skip lights that are out of range
        if (distance > light.radius) {
            continue;
        }

        // Calculate attenuation
        let attenuation = calculateAttenuation(distance, light.radius);

        // Incoming radiance from this light
        let radiance = light.color * light.intensity * attenuation;

        // Accumulate light contribution
        Lo += calculatePBRLight(N, V, L, albedo, metallic, roughness, radiance);
    }

    // -------------------------------------------------------------------------
    // Ambient Lighting (Hemisphere)
    // -------------------------------------------------------------------------
    // Simple hemisphere lighting based on normal direction
    let hemisphereFactor = dot(N, vec3f(0.0, 1.0, 0.0)) * 0.5 + 0.5;
    let ambientColor = mix(
        lighting.ambientLight.groundColor,
        lighting.ambientLight.skyColor,
        hemisphereFactor
    );
    let ambient = ambientColor * albedo * ao * lighting.ambientLight.intensity;

    // -------------------------------------------------------------------------
    // Final Color
    // -------------------------------------------------------------------------
    var color = ambient + Lo + emissive;

    // Output HDR color (tone mapping should be done in a separate post-process pass)
    return vec4f(color, 1.0);
}

// ============================================================================
// Debug Visualization Variants
// ============================================================================

/**
 * Debug shader to visualize G-Buffer channels
 * Uncomment the desired visualization
 */
@fragment
fn fragmentDebug(input: VertexOutput) -> @location(0) vec4f {
    let albedoSample = textureSample(albedoTex, gbufferSampler, input.uv);
    let normalSample = textureSample(normalTex, gbufferSampler, input.uv);
    let materialSample = textureSample(materialTex, gbufferSampler, input.uv);
    let emissiveSample = textureSample(emissiveTex, gbufferSampler, input.uv);
    let depth = textureSample(depthTex, gbufferSampler, input.uv);

    // Visualize albedo
    // return vec4f(albedoSample.rgb, 1.0);

    // Visualize normals (already in [0,1] range)
    // return vec4f(normalSample.rgb, 1.0);

    // Visualize metallic (grayscale)
    // return vec4f(vec3f(materialSample.r), 1.0);

    // Visualize roughness (grayscale)
    // return vec4f(vec3f(materialSample.g), 1.0);

    // Visualize ambient occlusion (grayscale)
    // return vec4f(vec3f(materialSample.b), 1.0);

    // Visualize emissive
    // return vec4f(emissiveSample.rgb, 1.0);

    // Visualize depth (normalized for visibility)
    let linearDepth = pow(depth, 0.3); // Gamma for better visibility
    return vec4f(vec3f(linearDepth), 1.0);
}
