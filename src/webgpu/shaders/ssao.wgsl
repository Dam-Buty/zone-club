// ============================================================================
// SSAO Shader - Screen-Space Ambient Occlusion
// ============================================================================
// Implements hemisphere sampling in view space to compute ambient occlusion.
// Uses a noise texture for random rotation to reduce banding artifacts.
//
// Algorithm:
// 1. Reconstruct view-space position from depth
// 2. Build TBN matrix from normal and random rotation
// 3. Sample hemisphere in tangent space, transform to view space
// 4. Project samples to screen and compare depths
// 5. Accumulate occlusion based on depth difference
// ============================================================================

// ============================================================================
// Uniforms
// ============================================================================

struct SSAOUniforms {
    projection: mat4x4f,      // Projection matrix (for projecting samples)
    invProjection: mat4x4f,   // Inverse projection (for position reconstruction)
    radius: f32,              // Sample radius in world units
    bias: f32,                // Depth bias to prevent self-occlusion
    kernelSize: f32,          // Number of samples
    intensity: f32,           // AO intensity (power exponent)
    noiseScale: vec2f,        // screenSize / noiseSize
    _padding: vec2f,          // Alignment padding
}

// ============================================================================
// Bindings
// ============================================================================

@group(0) @binding(0) var<uniform> params: SSAOUniforms;
@group(0) @binding(1) var normalTex: texture_2d<f32>;
@group(0) @binding(2) var depthTex: texture_depth_2d;
@group(0) @binding(3) var noiseTex: texture_2d<f32>;
@group(0) @binding(4) var<storage, read> kernel: array<vec4f>;  // vec4f for alignment, only xyz used
@group(0) @binding(5) var texSampler: sampler;

// ============================================================================
// Vertex Output
// ============================================================================

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Reconstruct view-space position from depth and UV coordinates
 * Uses textureLoad to avoid uniform control flow issues
 */
fn getViewPos(uv: vec2f, texSize: vec2u) -> vec3f {
    // Use textureLoad instead of textureSample for uniform control flow
    let coords = vec2i(uv * vec2f(texSize));
    let depth = textureLoad(depthTex, coords, 0);

    // Convert UV to clip space [-1, 1]
    // Note: Y is flipped in WebGPU (UV y=0 is top, clip y=1 is top)
    let clipX = uv.x * 2.0 - 1.0;
    let clipY = (1.0 - uv.y) * 2.0 - 1.0;

    let clipPos = vec4f(clipX, clipY, depth, 1.0);

    // Transform to view space
    let viewPos = params.invProjection * clipPos;

    return viewPos.xyz / viewPos.w;
}

/**
 * Get view-space position at specific texel coordinates
 * More efficient when you don't need filtering
 */
fn getViewPosLoad(coords: vec2i, texSize: vec2u) -> vec3f {
    let depth = textureLoad(depthTex, coords, 0);

    // Calculate UV from texel coordinates
    let uv = (vec2f(coords) + 0.5) / vec2f(texSize);

    let clipX = uv.x * 2.0 - 1.0;
    let clipY = (1.0 - uv.y) * 2.0 - 1.0;

    let clipPos = vec4f(clipX, clipY, depth, 1.0);
    let viewPos = params.invProjection * clipPos;

    return viewPos.xyz / viewPos.w;
}

/**
 * Decode normal from [0,1] to [-1,1] range
 */
fn decodeNormal(encoded: vec3f) -> vec3f {
    return normalize(encoded * 2.0 - 1.0);
}

// ============================================================================
// Vertex Shader - Fullscreen Triangle
// ============================================================================

/**
 * Generate a fullscreen triangle using vertex index
 * More efficient than a quad (single triangle, no index buffer)
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
// Fragment Shader - SSAO Calculation
// ============================================================================

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) f32 {
    // Get texture dimensions for textureLoad
    let texSize = textureDimensions(depthTex);
    let coords = vec2i(input.uv * vec2f(texSize));

    // Load depth using textureLoad (uniform control flow compatible)
    let depth = textureLoad(depthTex, coords, 0);

    // Background check - compute result without early return for uniform control flow
    let isBackground = depth >= 1.0;

    // Get view-space position
    let viewPos = getViewPos(input.uv, texSize);

    // Get view-space normal (transform world normal to view space)
    // Use textureLoad for uniform control flow
    let normalCoords = vec2i(input.uv * vec2f(textureDimensions(normalTex)));
    let worldNormal = decodeNormal(textureLoad(normalTex, normalCoords, 0).rgb);

    // For now, treat world normal as view normal (assumes view matrix is identity-ish)
    let normal = worldNormal;

    // Get random rotation from noise texture
    let noiseUV = input.uv * params.noiseScale;
    let noiseCoords = vec2i(fract(noiseUV) * vec2f(textureDimensions(noiseTex)));
    let randomVec = textureLoad(noiseTex, noiseCoords, 0).xyz;

    // Create TBN matrix for hemisphere orientation
    // Gram-Schmidt process to orthonormalize tangent
    let tangent = normalize(randomVec - normal * dot(randomVec, normal));
    let bitangent = cross(normal, tangent);
    let TBN = mat3x3f(tangent, bitangent, normal);

    // Sample and accumulate occlusion
    var occlusion = 0.0;
    let kernelSize = i32(params.kernelSize);

    for (var i = 0; i < kernelSize; i++) {
        // Get sample offset from kernel (hemisphere sample)
        let sampleOffset = kernel[i].xyz;

        // Transform sample to view space using TBN
        let samplePos = viewPos + TBN * sampleOffset * params.radius;

        // Project sample position to screen space
        var offset = params.projection * vec4f(samplePos, 1.0);
        offset = offset / offset.w;

        // Convert to UV coordinates
        let sampleUV = vec2f(
            offset.x * 0.5 + 0.5,
            1.0 - (offset.y * 0.5 + 0.5)  // Flip Y for WebGPU
        );

        // Clamp UV to valid range (avoid out of bounds)
        let clampedUV = clamp(sampleUV, vec2f(0.0), vec2f(1.0));
        let isValidSample = sampleUV.x >= 0.0 && sampleUV.x <= 1.0 && sampleUV.y >= 0.0 && sampleUV.y <= 1.0;

        // Get depth at sample position
        let sampleDepth = getViewPos(clampedUV, texSize).z;

        // Range check: only occlude if sample is close enough
        let rangeCheck = smoothstep(0.0, 1.0, params.radius / abs(viewPos.z - sampleDepth));

        // Occlusion test: if geometry is in front of sample position, it occludes
        let isOccluded = select(0.0, 1.0, sampleDepth >= samplePos.z + params.bias);

        // Only add occlusion if sample was valid
        occlusion += select(0.0, isOccluded * rangeCheck, isValidSample);
    }

    // Normalize occlusion
    occlusion = 1.0 - (occlusion / f32(kernelSize));

    // Apply intensity (as power to control falloff)
    let ao = pow(occlusion, params.intensity);

    // Return 1.0 for background, computed AO otherwise
    return select(ao, 1.0, isBackground);
}

// ============================================================================
// Blur Shader - Bilateral Blur for SSAO
// ============================================================================
// Bilateral blur preserves edges by considering depth differences
// This reduces noise while keeping sharp occlusion boundaries

struct BlurUniforms {
    direction: vec2f,         // (1,0) for horizontal, (0,1) for vertical
    texelSize: vec2f,         // 1.0 / textureSize
    depthThreshold: f32,      // Threshold for edge detection
    _padding: vec3f,
}

@group(0) @binding(0) var<uniform> blurParams: BlurUniforms;
@group(0) @binding(1) var aoTex: texture_2d<f32>;
@group(0) @binding(2) var blurDepthTex: texture_depth_2d;
@group(0) @binding(3) var blurSampler: sampler;

@vertex
fn blurVertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var output: VertexOutput;

    let x = f32((vertexIndex << 1u) & 2u);
    let y = f32(vertexIndex & 2u);

    output.position = vec4f(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
    output.uv = vec2f(x, 1.0 - y);

    return output;
}

@fragment
fn blurFragmentMain(input: VertexOutput) -> @location(0) f32 {
    // Gaussian weights for 5-tap blur
    const weights = array<f32, 5>(0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);

    let centerDepth = textureSample(blurDepthTex, blurSampler, input.uv);
    var result = textureSample(aoTex, blurSampler, input.uv).r * weights[0];
    var totalWeight = weights[0];

    // Sample in both directions along the blur axis
    for (var i = 1; i < 5; i++) {
        let offset = blurParams.direction * blurParams.texelSize * f32(i);

        // Positive direction
        let uvPos = input.uv + offset;
        let depthPos = textureSample(blurDepthTex, blurSampler, uvPos);
        let depthDiffPos = abs(centerDepth - depthPos);
        let weightPos = weights[i] * step(depthDiffPos, blurParams.depthThreshold);
        result += textureSample(aoTex, blurSampler, uvPos).r * weightPos;
        totalWeight += weightPos;

        // Negative direction
        let uvNeg = input.uv - offset;
        let depthNeg = textureSample(blurDepthTex, blurSampler, uvNeg);
        let depthDiffNeg = abs(centerDepth - depthNeg);
        let weightNeg = weights[i] * step(depthDiffNeg, blurParams.depthThreshold);
        result += textureSample(aoTex, blurSampler, uvNeg).r * weightNeg;
        totalWeight += weightNeg;
    }

    return result / totalWeight;
}
