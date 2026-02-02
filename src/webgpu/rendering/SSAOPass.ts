/**
 * SSAO Pass - Screen-Space Ambient Occlusion
 *
 * Implements ambient occlusion using hemisphere sampling in view space.
 * This adds depth and visual quality to the scene by darkening areas
 * where ambient light would be occluded.
 *
 * Features:
 * - Configurable sample count and radius
 * - Half-resolution rendering for performance
 * - Bilateral blur to reduce noise while preserving edges
 * - Noise texture for randomized sample rotation
 */

import ssaoShaderSource from '../shaders/ssao.wgsl?raw';

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface SSAOConfig {
  /** Sample radius in world units (default 0.5) */
  radius: number;
  /** Depth bias to prevent self-occlusion (default 0.025) */
  bias: number;
  /** Number of hemisphere samples (default 16) */
  kernelSize: number;
  /** Noise texture size (default 4) */
  noiseSize: number;
  /** AO intensity/power (default 1.0) */
  intensity: number;
  /** Render at half resolution for performance (default true) */
  halfResolution: boolean;
}

const DEFAULT_CONFIG: SSAOConfig = {
  radius: 0.5,
  bias: 0.025,
  kernelSize: 16,
  noiseSize: 4,
  intensity: 1.0,
  halfResolution: true,
};

// ============================================================================
// SSAOPass Class
// ============================================================================

export class SSAOPass {
  private device: GPUDevice;
  private config: SSAOConfig;

  // Dimensions
  private fullWidth: number;
  private fullHeight: number;
  private width: number;
  private height: number;

  // Textures
  private aoTexture!: GPUTexture;
  private aoTextureView!: GPUTextureView;
  private blurTempTexture!: GPUTexture;
  private blurTempTextureView!: GPUTextureView;
  private noiseTexture!: GPUTexture;
  private noiseTextureView!: GPUTextureView;

  // Buffers
  private kernelBuffer!: GPUBuffer;
  private ssaoUniformBuffer!: GPUBuffer;
  private blurUniformBufferH!: GPUBuffer;
  private blurUniformBufferV!: GPUBuffer;

  // Samplers
  private sampler!: GPUSampler;
  private _noiseSampler!: GPUSampler;

  // Pipelines
  private ssaoPipeline!: GPURenderPipeline;
  private blurPipeline!: GPURenderPipeline;

  // Bind Group Layouts
  private ssaoBindGroupLayout!: GPUBindGroupLayout;
  private blurBindGroupLayout!: GPUBindGroupLayout;

  constructor(
    device: GPUDevice,
    width: number,
    height: number,
    config?: Partial<SSAOConfig>
  ) {
    this.device = device;
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.fullWidth = width;
    this.fullHeight = height;
    this.width = this.config.halfResolution ? Math.floor(width / 2) : width;
    this.height = this.config.halfResolution ? Math.floor(height / 2) : height;

    this.createSamplers();
    this.createKernelBuffer();
    this.createNoiseTexture();
    this.createTextures();
    this.createUniformBuffers();
    this.createBindGroupLayouts();
    this.createPipelines();
  }

  // ============================================================================
  // Initialization Methods
  // ============================================================================

  /**
   * Create samplers for textures
   */
  private createSamplers(): void {
    // Sampler for G-Buffer textures (nearest for depth precision)
    this.sampler = this.device.createSampler({
      label: 'SSAO Sampler',
      magFilter: 'nearest',
      minFilter: 'nearest',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    // Sampler for noise texture (repeating)
    this._noiseSampler = this.device.createSampler({
      label: 'SSAO Noise Sampler',
      magFilter: 'nearest',
      minFilter: 'nearest',
      addressModeU: 'repeat',
      addressModeV: 'repeat',
    });
  }

  /**
   * Generate hemisphere sample kernel and upload to GPU
   */
  private createKernelBuffer(): void {
    const kernel = this.generateSSAOKernel(this.config.kernelSize);

    this.kernelBuffer = this.device.createBuffer({
      label: 'SSAO Kernel Buffer',
      size: kernel.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.device.queue.writeBuffer(this.kernelBuffer, 0, kernel as unknown as ArrayBuffer);
  }

  /**
   * Generate random hemisphere sample kernel
   * Samples are distributed in a hemisphere and scaled to cluster near the origin
   */
  private generateSSAOKernel(size: number): Float32Array {
    // vec4f for alignment (16 bytes per sample)
    const kernel = new Float32Array(size * 4);

    for (let i = 0; i < size; i++) {
      // Random point in unit hemisphere
      const x = Math.random() * 2 - 1;
      const y = Math.random() * 2 - 1;
      const z = Math.random(); // Only positive Z (hemisphere)

      // Normalize
      let length = Math.sqrt(x * x + y * y + z * z);
      if (length < 0.0001) {
        length = 1;
      }

      // Scale to be closer to the origin
      // lerp(0.1, 1.0, scale^2) creates more samples near the surface
      let scale = i / size;
      scale = 0.1 + scale * scale * 0.9;

      kernel[i * 4] = (x / length) * scale;
      kernel[i * 4 + 1] = (y / length) * scale;
      kernel[i * 4 + 2] = (z / length) * scale;
      kernel[i * 4 + 3] = 0; // Padding for vec4f alignment
    }

    return kernel;
  }

  /**
   * Create noise texture for random sample rotation
   * Small texture that tiles across the screen
   */
  private createNoiseTexture(): void {
    const noiseSize = this.config.noiseSize;
    const noiseData = new Float32Array(noiseSize * noiseSize * 4);

    for (let i = 0; i < noiseSize * noiseSize; i++) {
      // Random tangent-space vector (rotate around Z)
      const x = Math.random() * 2 - 1;
      const y = Math.random() * 2 - 1;
      const length = Math.sqrt(x * x + y * y) || 1;

      noiseData[i * 4] = x / length;
      noiseData[i * 4 + 1] = y / length;
      noiseData[i * 4 + 2] = 0;
      noiseData[i * 4 + 3] = 0;
    }

    this.noiseTexture = this.device.createTexture({
      label: 'SSAO Noise Texture',
      size: [noiseSize, noiseSize],
      format: 'rgba32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    this.device.queue.writeTexture(
      { texture: this.noiseTexture },
      noiseData,
      { bytesPerRow: noiseSize * 16 },
      { width: noiseSize, height: noiseSize }
    );

    this.noiseTextureView = this.noiseTexture.createView();
  }

  /**
   * Create AO and blur temporary textures
   */
  private createTextures(): void {
    // Main AO texture (single channel r8unorm)
    this.aoTexture = this.device.createTexture({
      label: 'SSAO AO Texture',
      size: [this.width, this.height],
      format: 'r8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.aoTextureView = this.aoTexture.createView();

    // Temporary texture for blur ping-pong
    this.blurTempTexture = this.device.createTexture({
      label: 'SSAO Blur Temp Texture',
      size: [this.width, this.height],
      format: 'r8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.blurTempTextureView = this.blurTempTexture.createView();
  }

  /**
   * Create uniform buffers for SSAO and blur passes
   */
  private createUniformBuffers(): void {
    // SSAO uniforms: 2 mat4x4 + 4 floats + vec2 + vec2 padding = 144 bytes
    const ssaoUniformSize = 144;
    this.ssaoUniformBuffer = this.device.createBuffer({
      label: 'SSAO Uniform Buffer',
      size: ssaoUniformSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Blur uniforms: vec2 direction + vec2 texelSize + float threshold + vec3 padding = 48 bytes (WGSL aligned)
    const blurUniformSize = 48;
    this.blurUniformBufferH = this.device.createBuffer({
      label: 'SSAO Blur Horizontal Uniform Buffer',
      size: blurUniformSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.blurUniformBufferV = this.device.createBuffer({
      label: 'SSAO Blur Vertical Uniform Buffer',
      size: blurUniformSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.updateBlurUniforms();
  }

  /**
   * Update blur uniform buffers with current texel size
   */
  private updateBlurUniforms(): void {
    const texelSize = [1.0 / this.width, 1.0 / this.height];
    const depthThreshold = 0.1;

    // Horizontal blur: direction = (1, 0)
    // Layout: vec2f direction (8) + vec2f texelSize (8) + f32 depthThreshold (4) + padding (4) + vec3f _padding (12) = 36 bytes, rounded to 48
    const horizontalData = new Float32Array([
      1.0, 0.0,           // direction (vec2f) - offset 0
      texelSize[0], texelSize[1], // texelSize (vec2f) - offset 8
      depthThreshold,     // depthThreshold (f32) - offset 16
      0, 0, 0,            // padding to align _padding to 16 bytes - offset 20
      0, 0, 0,            // _padding (vec3f) - offset 32
      0,                  // extra padding to reach 48 bytes
    ]);
    this.device.queue.writeBuffer(this.blurUniformBufferH, 0, horizontalData as unknown as ArrayBuffer);

    // Vertical blur: direction = (0, 1)
    const verticalData = new Float32Array([
      0.0, 1.0,           // direction (vec2f) - offset 0
      texelSize[0], texelSize[1], // texelSize (vec2f) - offset 8
      depthThreshold,     // depthThreshold (f32) - offset 16
      0, 0, 0,            // padding to align _padding - offset 20
      0, 0, 0,            // _padding (vec3f) - offset 32
      0,                  // extra padding to reach 48 bytes
    ]);
    this.device.queue.writeBuffer(this.blurUniformBufferV, 0, verticalData as unknown as ArrayBuffer);
  }

  /**
   * Create bind group layouts for SSAO and blur passes
   */
  private createBindGroupLayouts(): void {
    // SSAO bind group layout
    this.ssaoBindGroupLayout = this.device.createBindGroupLayout({
      label: 'SSAO Bind Group Layout',
      entries: [
        // Uniforms
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        // Normal texture
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d' },
        },
        // Depth texture
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'depth', viewDimension: '2d' },
        },
        // Noise texture
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'unfilterable-float', viewDimension: '2d' },
        },
        // Kernel buffer
        {
          binding: 4,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'read-only-storage' },
        },
        // Sampler
        {
          binding: 5,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'non-filtering' },
        },
      ],
    });

    // Blur bind group layout
    this.blurBindGroupLayout = this.device.createBindGroupLayout({
      label: 'SSAO Blur Bind Group Layout',
      entries: [
        // Uniforms
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        // AO texture
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d' },
        },
        // Depth texture
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'depth', viewDimension: '2d' },
        },
        // Sampler
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'non-filtering' },
        },
      ],
    });
  }

  /**
   * Create SSAO and blur render pipelines
   */
  private createPipelines(): void {
    const shaderModule = this.device.createShaderModule({
      label: 'SSAO Shader Module',
      code: ssaoShaderSource,
    });

    // SSAO pipeline
    this.ssaoPipeline = this.device.createRenderPipeline({
      label: 'SSAO Pipeline',
      layout: this.device.createPipelineLayout({
        label: 'SSAO Pipeline Layout',
        bindGroupLayouts: [this.ssaoBindGroupLayout],
      }),
      vertex: {
        module: shaderModule,
        entryPoint: 'vertexMain',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [{ format: 'r8unorm' }],
      },
      primitive: {
        topology: 'triangle-list',
      },
    });

    // Blur pipeline
    this.blurPipeline = this.device.createRenderPipeline({
      label: 'SSAO Blur Pipeline',
      layout: this.device.createPipelineLayout({
        label: 'SSAO Blur Pipeline Layout',
        bindGroupLayouts: [this.blurBindGroupLayout],
      }),
      vertex: {
        module: shaderModule,
        entryPoint: 'blurVertexMain',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'blurFragmentMain',
        targets: [{ format: 'r8unorm' }],
      },
      primitive: {
        topology: 'triangle-list',
      },
    });
  }

  // ============================================================================
  // Public Methods
  // ============================================================================

  /**
   * Resize the AO textures
   */
  resize(width: number, height: number): void {
    if (this.fullWidth === width && this.fullHeight === height) {
      return;
    }

    this.fullWidth = width;
    this.fullHeight = height;
    this.width = this.config.halfResolution ? Math.floor(width / 2) : width;
    this.height = this.config.halfResolution ? Math.floor(height / 2) : height;

    // Destroy old textures
    this.aoTexture.destroy();
    this.blurTempTexture.destroy();

    // Create new textures
    this.createTextures();
    this.updateBlurUniforms();
  }

  /**
   * Get the SSAO render pipeline
   */
  getSSAOPipeline(): GPURenderPipeline {
    return this.ssaoPipeline;
  }

  /**
   * Get the blur render pipeline
   */
  getBlurPipeline(): GPURenderPipeline {
    return this.blurPipeline;
  }

  /**
   * Get the AO texture view for use in the lighting pass
   */
  getAOTextureView(): GPUTextureView {
    return this.aoTextureView;
  }

  /**
   * Get the bind group layout for SSAO pass
   */
  getBindGroupLayout(): GPUBindGroupLayout {
    return this.ssaoBindGroupLayout;
  }

  /**
   * Get the blur bind group layout
   */
  getBlurBindGroupLayout(): GPUBindGroupLayout {
    return this.blurBindGroupLayout;
  }

  /**
   * Create bind group with G-Buffer inputs for SSAO pass
   */
  createBindGroup(
    normalTexture: GPUTextureView,
    depthTexture: GPUTextureView,
    projectionMatrix: Float32Array,
    invProjectionMatrix: Float32Array
  ): GPUBindGroup {
    // Update uniform buffer
    this.updateSSAOUniforms(projectionMatrix, invProjectionMatrix);

    return this.device.createBindGroup({
      label: 'SSAO Bind Group',
      layout: this.ssaoBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.ssaoUniformBuffer } },
        { binding: 1, resource: normalTexture },
        { binding: 2, resource: depthTexture },
        { binding: 3, resource: this.noiseTextureView },
        { binding: 4, resource: { buffer: this.kernelBuffer } },
        { binding: 5, resource: this.sampler },
      ],
    });
  }

  /**
   * Create bind group for horizontal blur pass
   */
  createHorizontalBlurBindGroup(depthTexture: GPUTextureView): GPUBindGroup {
    return this.device.createBindGroup({
      label: 'SSAO Horizontal Blur Bind Group',
      layout: this.blurBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.blurUniformBufferH } },
        { binding: 1, resource: this.aoTextureView },
        { binding: 2, resource: depthTexture },
        { binding: 3, resource: this.sampler },
      ],
    });
  }

  /**
   * Create bind group for vertical blur pass
   */
  createVerticalBlurBindGroup(depthTexture: GPUTextureView): GPUBindGroup {
    return this.device.createBindGroup({
      label: 'SSAO Vertical Blur Bind Group',
      layout: this.blurBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.blurUniformBufferV } },
        { binding: 1, resource: this.blurTempTextureView },
        { binding: 2, resource: depthTexture },
        { binding: 3, resource: this.sampler },
      ],
    });
  }

  /**
   * Update SSAO uniform buffer with current matrices and config
   */
  private updateSSAOUniforms(
    projectionMatrix: Float32Array,
    invProjectionMatrix: Float32Array
  ): void {
    // Layout: mat4x4 projection (64) + mat4x4 invProjection (64) + 4 floats + vec2 + vec2 padding
    const data = new Float32Array(36); // 144 bytes / 4

    // Projection matrix (16 floats)
    data.set(projectionMatrix, 0);

    // Inverse projection matrix (16 floats)
    data.set(invProjectionMatrix, 16);

    // SSAO parameters
    data[32] = this.config.radius;
    data[33] = this.config.bias;
    data[34] = this.config.kernelSize;
    data[35] = this.config.intensity;

    // Note: noiseScale and padding would follow at indices 36-39
    // but we need to extend the buffer. Let's recalculate.

    // Actually, let's create a proper buffer with all data
    const fullData = new Float32Array(40); // 160 bytes for proper alignment
    fullData.set(projectionMatrix, 0);
    fullData.set(invProjectionMatrix, 16);
    fullData[32] = this.config.radius;
    fullData[33] = this.config.bias;
    fullData[34] = this.config.kernelSize;
    fullData[35] = this.config.intensity;
    fullData[36] = this.width / this.config.noiseSize; // noiseScale.x
    fullData[37] = this.height / this.config.noiseSize; // noiseScale.y
    fullData[38] = 0; // padding
    fullData[39] = 0; // padding

    // Recreate buffer if needed (size changed)
    if (this.ssaoUniformBuffer.size < fullData.byteLength) {
      this.ssaoUniformBuffer.destroy();
      this.ssaoUniformBuffer = this.device.createBuffer({
        label: 'SSAO Uniform Buffer',
        size: fullData.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
    }

    this.device.queue.writeBuffer(this.ssaoUniformBuffer, 0, fullData);
  }

  /**
   * Get render pass descriptor for SSAO pass
   */
  getRenderPassDescriptor(): GPURenderPassDescriptor {
    return {
      label: 'SSAO Render Pass',
      colorAttachments: [
        {
          view: this.aoTextureView,
          clearValue: { r: 1, g: 1, b: 1, a: 1 }, // Default: no occlusion
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    };
  }

  /**
   * Get render pass descriptor for horizontal blur
   */
  getHorizontalBlurRenderPassDescriptor(): GPURenderPassDescriptor {
    return {
      label: 'SSAO Horizontal Blur Render Pass',
      colorAttachments: [
        {
          view: this.blurTempTextureView,
          clearValue: { r: 1, g: 1, b: 1, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    };
  }

  /**
   * Get render pass descriptor for vertical blur (final output)
   */
  getVerticalBlurRenderPassDescriptor(): GPURenderPassDescriptor {
    return {
      label: 'SSAO Vertical Blur Render Pass',
      colorAttachments: [
        {
          view: this.aoTextureView,
          clearValue: { r: 1, g: 1, b: 1, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    };
  }

  /**
   * Get blur temp texture view (for debugging)
   */
  getBlurTempTextureView(): GPUTextureView {
    return this.blurTempTextureView;
  }

  /**
   * Get current AO texture dimensions
   */
  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }

  /**
   * Get full resolution dimensions
   */
  getFullWidth(): number {
    return this.fullWidth;
  }

  getFullHeight(): number {
    return this.fullHeight;
  }

  /**
   * Update configuration (requires regenerating kernel if size changed)
   */
  updateConfig(config: Partial<SSAOConfig>): void {
    const oldKernelSize = this.config.kernelSize;
    const oldHalfRes = this.config.halfResolution;

    this.config = { ...this.config, ...config };

    // Regenerate kernel if size changed
    if (this.config.kernelSize !== oldKernelSize) {
      this.kernelBuffer.destroy();
      this.createKernelBuffer();
    }

    // Resize if half resolution setting changed
    if (this.config.halfResolution !== oldHalfRes) {
      this.resize(this.fullWidth, this.fullHeight);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): SSAOConfig {
    return { ...this.config };
  }

  /**
   * Release all GPU resources
   */
  destroy(): void {
    this.aoTexture.destroy();
    this.blurTempTexture.destroy();
    this.noiseTexture.destroy();
    this.kernelBuffer.destroy();
    this.ssaoUniformBuffer.destroy();
    this.blurUniformBufferH.destroy();
    this.blurUniformBufferV.destroy();
  }
}
