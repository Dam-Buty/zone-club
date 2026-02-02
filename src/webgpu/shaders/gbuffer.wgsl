// ============================================================================
// G-Buffer Shader - Geometry Pass for Deferred Rendering
// ============================================================================
// This shader writes geometry and material data to the G-Buffer (MRT).
// It is the first pass in the deferred rendering pipeline.
//
// G-Buffer Layout:
// - Location 0: Albedo (rgba8unorm)    - RGB=base color, A=alpha
// - Location 1: Normal (rgba16float)   - RGB=world normal (encoded [0,1])
// - Location 2: Material (rgba8unorm)  - R=metallic, G=roughness, B=ao, A=flags
// - Location 3: Emissive (rgba16float) - RGB=emissive color, A=intensity
// - Depth: depth32float
// ============================================================================

// ============================================================================
// Uniform Structures
// ============================================================================

/**
 * Per-frame uniforms containing camera matrices
 */
struct CameraUniforms {
    viewProjection: mat4x4f,  // Combined view-projection matrix
    view: mat4x4f,            // View matrix only
    projection: mat4x4f,      // Projection matrix only
    cameraPosition: vec3f,    // Camera world position
    _padding: f32,            // Alignment padding
}

/**
 * Per-object uniforms containing model transform
 */
struct ModelUniforms {
    model: mat4x4f,       // Model-to-world transform
    normalMatrix: mat4x4f, // transpose(inverse(model)) for normal transform
}

/**
 * Material data structure (matches Material.ts packMaterial layout)
 * Total: 48 bytes (12 floats), aligned to 16 bytes
 */
struct MaterialData {
    albedo: vec3f,           // Base color (RGB)
    metallic: f32,           // Metallic factor [0,1]
    roughness: f32,          // Roughness factor [0,1]
    ao: f32,                 // Ambient occlusion [0,1]
    emissive: vec3f,         // Emissive color (RGB)
    emissiveIntensity: f32,  // Emissive strength (can be > 1 for HDR)
    _padding: vec2f,         // Alignment padding
}

// ============================================================================
// Bindings
// ============================================================================

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(1) @binding(0) var<uniform> model: ModelUniforms;
@group(2) @binding(0) var<uniform> material: MaterialData;

// Optional: Texture bindings for textured materials
// @group(2) @binding(1) var materialSampler: sampler;
// @group(2) @binding(2) var albedoTexture: texture_2d<f32>;
// @group(2) @binding(3) var normalTexture: texture_2d<f32>;
// @group(2) @binding(4) var metallicRoughnessTexture: texture_2d<f32>;

// ============================================================================
// Vertex Input/Output
// ============================================================================

struct VertexInput {
    @location(0) position: vec3f,  // Object-space position
    @location(1) uv: vec2f,        // Texture coordinates
    @location(2) normal: vec3f,    // Object-space normal
    // Optional: tangent for normal mapping
    // @location(3) tangent: vec4f,
}

struct VertexOutput {
    @builtin(position) clipPosition: vec4f,  // Clip-space position (required)
    @location(0) worldPosition: vec3f,       // World-space position
    @location(1) worldNormal: vec3f,         // World-space normal
    @location(2) uv: vec2f,                  // Texture coordinates
}

// ============================================================================
// G-Buffer Output (Multiple Render Targets)
// ============================================================================

struct GBufferOutput {
    @location(0) albedo: vec4f,    // RGB=base color, A=alpha
    @location(1) normal: vec4f,    // RGB=encoded world normal, A=unused
    @location(2) material: vec4f,  // R=metallic, G=roughness, B=ao, A=flags
    @location(3) emissive: vec4f,  // RGB=emissive color, A=intensity
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Encode normal from [-1,1] to [0,1] for storage in G-Buffer
 */
fn encodeNormal(n: vec3f) -> vec3f {
    return n * 0.5 + 0.5;
}

// ============================================================================
// Vertex Shader
// ============================================================================

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;

    // Transform position to world space
    let worldPos4 = model.model * vec4f(input.position, 1.0);
    output.worldPosition = worldPos4.xyz;

    // Transform position to clip space
    output.clipPosition = camera.viewProjection * worldPos4;

    // Transform normal to world space using the normal matrix
    // The normal matrix is transpose(inverse(model)) to handle non-uniform scaling
    output.worldNormal = normalize((model.normalMatrix * vec4f(input.normal, 0.0)).xyz);

    // Pass through texture coordinates
    output.uv = input.uv;

    return output;
}

// ============================================================================
// Fragment Shader
// ============================================================================

@fragment
fn fragmentMain(input: VertexOutput) -> GBufferOutput {
    var output: GBufferOutput;

    // -------------------------------------------------------------------------
    // Albedo (Base Color)
    // -------------------------------------------------------------------------
    // For now, use material uniform. Later, sample from albedo texture if available.
    var albedo = material.albedo;

    // Optional: Sample albedo texture
    // let texColor = textureSample(albedoTexture, materialSampler, input.uv);
    // albedo = texColor.rgb * material.albedo; // Tint with material color

    output.albedo = vec4f(albedo, 1.0);

    // -------------------------------------------------------------------------
    // World Normal
    // -------------------------------------------------------------------------
    // Normalize the interpolated normal (interpolation can denormalize it)
    var N = normalize(input.worldNormal);

    // Optional: Apply normal mapping
    // let tangentNormal = textureSample(normalTexture, materialSampler, input.uv).xyz * 2.0 - 1.0;
    // N = applyNormalMap(N, input.tangent, tangentNormal);

    // Encode normal to [0,1] range for storage
    output.normal = vec4f(encodeNormal(N), 1.0);

    // -------------------------------------------------------------------------
    // Material Properties
    // -------------------------------------------------------------------------
    var metallic = material.metallic;
    var roughness = material.roughness;
    var ao = material.ao;

    // Optional: Sample metallic-roughness texture (common format: R=unused, G=roughness, B=metallic)
    // let mrSample = textureSample(metallicRoughnessTexture, materialSampler, input.uv);
    // metallic = mrSample.b * material.metallic;
    // roughness = mrSample.g * material.roughness;

    // Clamp roughness to avoid divide by zero in lighting calculations
    roughness = clamp(roughness, 0.04, 1.0);

    // Pack material properties:
    // R = metallic [0,1]
    // G = roughness [0,1]
    // B = ambient occlusion [0,1]
    // A = flags (reserved for future use: subsurface, clearcoat, etc.)
    let flags = 0.0; // Reserved for special material features
    output.material = vec4f(metallic, roughness, ao, flags);

    // -------------------------------------------------------------------------
    // Emissive
    // -------------------------------------------------------------------------
    // Store emissive color with intensity
    // RGB stores the emission color (pre-multiplied by intensity for efficiency)
    // A stores the raw intensity for potential bloom calculations
    let emissiveColor = material.emissive * material.emissiveIntensity;
    output.emissive = vec4f(emissiveColor, material.emissiveIntensity);

    return output;
}

// ============================================================================
// Variant: Textured G-Buffer Shader
// ============================================================================
// Uncomment and use this fragment shader when you have textures

/*
@fragment
fn fragmentMainTextured(input: VertexOutput) -> GBufferOutput {
    var output: GBufferOutput;

    // Sample textures
    let albedoSample = textureSample(albedoTexture, materialSampler, input.uv);
    let normalSample = textureSample(normalTexture, materialSampler, input.uv);
    let mrSample = textureSample(metallicRoughnessTexture, materialSampler, input.uv);

    // Alpha test (optional)
    if (albedoSample.a < 0.5) {
        discard;
    }

    // Albedo
    output.albedo = vec4f(albedoSample.rgb * material.albedo, albedoSample.a);

    // Normal with normal mapping
    let tangentNormal = normalSample.xyz * 2.0 - 1.0;
    // ... apply TBN matrix transformation ...
    let N = normalize(input.worldNormal); // Placeholder
    output.normal = vec4f(encodeNormal(N), 1.0);

    // Material from texture
    let metallic = mrSample.b * material.metallic;
    let roughness = clamp(mrSample.g * material.roughness, 0.04, 1.0);
    let ao = mrSample.r; // Often stored in R channel
    output.material = vec4f(metallic, roughness, ao, 0.0);

    // Emissive
    let emissiveColor = material.emissive * material.emissiveIntensity;
    output.emissive = vec4f(emissiveColor, material.emissiveIntensity);

    return output;
}
*/
