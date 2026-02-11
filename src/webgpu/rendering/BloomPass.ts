/**
 * Bloom Post-Processing Pass
 *
 * Implements a high-quality multi-pass bloom effect for HDR rendering.
 * Uses progressive downsampling/upsampling with optimized filter kernels.
 *
 * Algorithm:
 * 1. Threshold pass - Extract bright pixels above luminance threshold
 * 2. Downsample chain - Progressive blur using 13-tap filter (5 levels by default)
 * 3. Upsample chain - Combine levels with tent filter and additive blending
 *
 * The final bloom texture can be composited with the main scene in a post-process pass.
 */

import bloomShaderSource from '../shaders/bloom.wgsl?raw';

/**
 * Configuration for the bloom effect
 */
export interface BloomConfig {
  /** Luminance threshold for bright pixel extraction (default 1.0) */
  threshold: number;
  /** Soft knee for smooth threshold transition (default 0.5) */
  softThreshold: number;
  /** Final bloom intensity multiplier (default 1.0) */
  intensity: number;
  /** Blur radius multiplier (default 0.5) */
  radius: number;
  /** Number of mipmap levels for blur (default 5) */
  levels: number;
}

/**
 * Default bloom configuration
 */
const DEFAULT_CONFIG: BloomConfig = {
  threshold: 1.0,
  softThreshold: 0.5,
  intensity: 1.0,
  radius: 0.5,
  levels: 5,
};

/**
 * Uniform buffer structure (must match WGSL)
 * Total size: 32 bytes (8 floats)
 * - threshold: f32
 * - softThreshold: f32
 * - intensity: f32
 * - radius: f32
 * - texelSizeX: f32
 * - texelSizeY: f32
 * - _padding1: f32
 * - _padding2: f32
 */

export class BloomPass {
  private device: GPUDevice;
  private config: BloomConfig;

  // Texture dimensions
  private width: number;
  private height: number;

  // Mipmap chain for downsampling/upsampling
  private bloomTextures: GPUTexture[] = [];
  private bloomViews: GPUTextureView[] = [];

  // Pipelines
  private thresholdPipeline!: GPURenderPipeline;
  private downsamplePipeline!: GPURenderPipeline;
  private upsamplePipeline!: GPURenderPipeline;
  private upsampleFirstPipeline!: GPURenderPipeline;

  // Bind group layouts
  private thresholdBindGroupLayout!: GPUBindGroupLayout;
  private blurBindGroupLayout!: GPUBindGroupLayout;
  private upsampleBindGroupLayout!: GPUBindGroupLayout;

  // Sampler for texture filtering
  private sampler!: GPUSampler;

  // Uniform buffers for each level
  private uniformBuffers: GPUBuffer[] = [];

  // Shader module
  private shaderModule!: GPUShaderModule;

  constructor(
    device: GPUDevice,
    width: number,
    height: number,
    config?: Partial<BloomConfig>
  ) {
    if (width <= 0 || height <= 0) {
      throw new Error(`BloomPass dimensions must be positive: ${width}x${height}`);
    }

    this.device = device;
    this.width = width;
    this.height = height;
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.createShaderModule();
    this.createSampler();
    this.createBindGroupLayouts();
    this.createPipelines();
    this.createTextures();
    this.createUniformBuffers();
  }

  /**
   * Create the WGSL shader module
   */
  private createShaderModule(): void {
    this.shaderModule = this.device.createShaderModule({
      label: 'Bloom Shader',
      code: bloomShaderSource,
    });
  }

  /**
   * Create linear sampler for texture filtering
   */
  private createSampler(): void {
    this.sampler = this.device.createSampler({
      label: 'Bloom Sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
  }

  /**
   * Create bind group layouts for each pass type
   */
  private createBindGroupLayouts(): void {
    // Threshold and downsample passes: uniform + source texture + sampler
    this.thresholdBindGroupLayout = this.device.createBindGroupLayout({
      label: 'Bloom Threshold Bind Group Layout',
      entries: [
        // Uniform buffer
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        // Source texture
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d' },
        },
        // Sampler
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' },
        },
      ],
    });

    // Downsample uses same layout as threshold
    this.blurBindGroupLayout = this.thresholdBindGroupLayout;

    // Upsample pass: uniform + source texture + sampler + previous level texture
    this.upsampleBindGroupLayout = this.device.createBindGroupLayout({
      label: 'Bloom Upsample Bind Group Layout',
      entries: [
        // Uniform buffer
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        // Source texture (current level being upsampled)
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d' },
        },
        // Sampler
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' },
        },
        // Previous level texture (to blend with)
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d' },
        },
      ],
    });
  }

  /**
   * Create render pipelines for each pass
   */
  private createPipelines(): void {
    // Common pipeline layout for threshold and downsample
    const thresholdPipelineLayout = this.device.createPipelineLayout({
      label: 'Bloom Threshold Pipeline Layout',
      bindGroupLayouts: [this.thresholdBindGroupLayout],
    });

    // Pipeline layout for upsample with previous level
    const upsamplePipelineLayout = this.device.createPipelineLayout({
      label: 'Bloom Upsample Pipeline Layout',
      bindGroupLayouts: [this.upsampleBindGroupLayout],
    });

    // Common render target state for all pipelines
    const colorTargetState: GPUColorTargetState = {
      format: 'rgba16float',
      writeMask: GPUColorWrite.ALL,
    };

    // Threshold pipeline
    this.thresholdPipeline = this.device.createRenderPipeline({
      label: 'Bloom Threshold Pipeline',
      layout: thresholdPipelineLayout,
      vertex: {
        module: this.shaderModule,
        entryPoint: 'vertexMain',
      },
      fragment: {
        module: this.shaderModule,
        entryPoint: 'thresholdFragment',
        targets: [colorTargetState],
      },
      primitive: {
        topology: 'triangle-list',
      },
    });

    // Downsample pipeline
    this.downsamplePipeline = this.device.createRenderPipeline({
      label: 'Bloom Downsample Pipeline',
      layout: thresholdPipelineLayout,
      vertex: {
        module: this.shaderModule,
        entryPoint: 'vertexMain',
      },
      fragment: {
        module: this.shaderModule,
        entryPoint: 'downsampleFragment',
        targets: [colorTargetState],
      },
      primitive: {
        topology: 'triangle-list',
      },
    });

    // Upsample pipeline (with previous level blending)
    this.upsamplePipeline = this.device.createRenderPipeline({
      label: 'Bloom Upsample Pipeline',
      layout: upsamplePipelineLayout,
      vertex: {
        module: this.shaderModule,
        entryPoint: 'vertexMain',
      },
      fragment: {
        module: this.shaderModule,
        entryPoint: 'upsampleFragment',
        targets: [colorTargetState],
      },
      primitive: {
        topology: 'triangle-list',
      },
    });

    // Upsample first pass pipeline (no previous level)
    this.upsampleFirstPipeline = this.device.createRenderPipeline({
      label: 'Bloom Upsample First Pipeline',
      layout: thresholdPipelineLayout,
      vertex: {
        module: this.shaderModule,
        entryPoint: 'vertexMain',
      },
      fragment: {
        module: this.shaderModule,
        entryPoint: 'upsampleFirstFragment',
        targets: [colorTargetState],
      },
      primitive: {
        topology: 'triangle-list',
      },
    });
  }

  /**
   * Create bloom textures for the mipmap chain
   * Level 0 is half resolution, each subsequent level is half of the previous
   */
  private createTextures(): void {
    // Destroy existing textures if any
    this.destroyTextures();

    this.bloomTextures = [];
    this.bloomViews = [];

    // Create textures for each mip level
    // Level 0: width/2, height/2
    // Level 1: width/4, height/4
    // etc.
    for (let i = 0; i < this.config.levels; i++) {
      const levelWidth = Math.max(1, Math.floor(this.width / Math.pow(2, i + 1)));
      const levelHeight = Math.max(1, Math.floor(this.height / Math.pow(2, i + 1)));

      const texture = this.device.createTexture({
        label: `Bloom Texture Level ${i}`,
        size: [levelWidth, levelHeight],
        format: 'rgba16float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });

      this.bloomTextures.push(texture);
      this.bloomViews.push(texture.createView({
        label: `Bloom Texture View Level ${i}`,
      }));
    }

    // Create one additional texture for upsampling result at each level
    // These are used to store the upsampled results
    for (let i = this.config.levels - 2; i >= 0; i--) {
      const levelWidth = Math.max(1, Math.floor(this.width / Math.pow(2, i + 1)));
      const levelHeight = Math.max(1, Math.floor(this.height / Math.pow(2, i + 1)));

      const texture = this.device.createTexture({
        label: `Bloom Upsample Texture Level ${i}`,
        size: [levelWidth, levelHeight],
        format: 'rgba16float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });

      this.bloomTextures.push(texture);
      this.bloomViews.push(texture.createView({
        label: `Bloom Upsample Texture View Level ${i}`,
      }));
    }
  }

  /**
   * Create uniform buffers for each level
   */
  private createUniformBuffers(): void {
    // Destroy existing buffers
    this.destroyUniformBuffers();

    this.uniformBuffers = [];

    // Create a uniform buffer for each mip level
    // We need levels * 2 - 1 buffers (downsample + upsample passes)
    const totalPasses = this.config.levels * 2 - 1;

    for (let i = 0; i < totalPasses; i++) {
      const buffer = this.device.createBuffer({
        label: `Bloom Uniform Buffer ${i}`,
        size: 32, // 8 floats * 4 bytes
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.uniformBuffers.push(buffer);
    }
  }

  /**
   * Update uniform buffer for a specific pass
   */
  private updateUniformBuffer(bufferIndex: number, levelWidth: number, levelHeight: number): void {
    const uniforms = new Float32Array([
      this.config.threshold,
      this.config.softThreshold,
      this.config.intensity,
      this.config.radius,
      1.0 / levelWidth,  // texelSizeX
      1.0 / levelHeight, // texelSizeY
      0.0, // padding
      0.0, // padding
    ]);

    this.device.queue.writeBuffer(this.uniformBuffers[bufferIndex], 0, uniforms);
  }

  /**
   * Resize bloom textures
   */
  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) {
      throw new Error(`BloomPass dimensions must be positive: ${width}x${height}`);
    }

    if (this.width === width && this.height === height) {
      return;
    }

    this.width = width;
    this.height = height;

    this.createTextures();
  }

  /**
   * Get the bind group layout for threshold pass
   */
  getThresholdBindGroupLayout(): GPUBindGroupLayout {
    return this.thresholdBindGroupLayout;
  }

  /**
   * Get the bind group layout for blur passes (downsample)
   */
  getBlurBindGroupLayout(): GPUBindGroupLayout {
    return this.blurBindGroupLayout;
  }

  /**
   * Get the bind group layout for upsample passes
   */
  getUpsampleBindGroupLayout(): GPUBindGroupLayout {
    return this.upsampleBindGroupLayout;
  }

  /**
   * Create bind group for threshold pass
   */
  createThresholdBindGroup(sourceTexture: GPUTextureView): GPUBindGroup {
    // Update uniform buffer for full resolution
    this.updateUniformBuffer(0, this.width, this.height);

    return this.device.createBindGroup({
      label: 'Bloom Threshold Bind Group',
      layout: this.thresholdBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffers[0] } },
        { binding: 1, resource: sourceTexture },
        { binding: 2, resource: this.sampler },
      ],
    });
  }

  /**
   * Create bind group for downsample pass at a specific level
   */
  createDownsampleBindGroup(sourceView: GPUTextureView, level: number): GPUBindGroup {
    const levelWidth = Math.max(1, Math.floor(this.width / Math.pow(2, level + 1)));
    const levelHeight = Math.max(1, Math.floor(this.height / Math.pow(2, level + 1)));

    // Update uniform buffer with texel size for this level
    this.updateUniformBuffer(level, levelWidth, levelHeight);

    return this.device.createBindGroup({
      label: `Bloom Downsample Bind Group Level ${level}`,
      layout: this.blurBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffers[level] } },
        { binding: 1, resource: sourceView },
        { binding: 2, resource: this.sampler },
      ],
    });
  }

  /**
   * Create bind group for upsample pass
   */
  createUpsampleBindGroup(currentLevel: GPUTextureView, previousLevel: GPUTextureView, level: number): GPUBindGroup {
    const levelWidth = Math.max(1, Math.floor(this.width / Math.pow(2, level + 1)));
    const levelHeight = Math.max(1, Math.floor(this.height / Math.pow(2, level + 1)));

    const bufferIndex = this.config.levels + (this.config.levels - 2 - level);
    this.updateUniformBuffer(bufferIndex, levelWidth, levelHeight);

    return this.device.createBindGroup({
      label: `Bloom Upsample Bind Group Level ${level}`,
      layout: this.upsampleBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffers[bufferIndex] } },
        { binding: 1, resource: currentLevel },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: previousLevel },
      ],
    });
  }

  /**
   * Create bind group for first upsample pass (no previous level)
   */
  createUpsampleFirstBindGroup(sourceView: GPUTextureView, level: number): GPUBindGroup {
    const levelWidth = Math.max(1, Math.floor(this.width / Math.pow(2, level + 1)));
    const levelHeight = Math.max(1, Math.floor(this.height / Math.pow(2, level + 1)));

    const bufferIndex = this.config.levels;
    this.updateUniformBuffer(bufferIndex, levelWidth, levelHeight);

    return this.device.createBindGroup({
      label: `Bloom Upsample First Bind Group`,
      layout: this.blurBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffers[bufferIndex] } },
        { binding: 1, resource: sourceView },
        { binding: 2, resource: this.sampler },
      ],
    });
  }

  /**
   * Get render pass descriptor for threshold pass (renders to level 0)
   */
  getThresholdPassDescriptor(): GPURenderPassDescriptor {
    return {
      label: 'Bloom Threshold Pass',
      colorAttachments: [{
        view: this.bloomViews[0],
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    };
  }

  /**
   * Get render pass descriptor for downsample pass at a specific level
   */
  getDownsamplePassDescriptor(level: number): GPURenderPassDescriptor {
    if (level < 0 || level >= this.config.levels) {
      throw new Error(`Invalid downsample level: ${level}`);
    }

    return {
      label: `Bloom Downsample Pass Level ${level}`,
      colorAttachments: [{
        view: this.bloomViews[level],
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    };
  }

  /**
   * Get render pass descriptor for upsample pass at a specific level
   */
  getUpsamplePassDescriptor(level: number): GPURenderPassDescriptor {
    if (level < 0 || level >= this.config.levels - 1) {
      throw new Error(`Invalid upsample level: ${level}`);
    }

    // Upsample textures are stored after the downsample textures
    const textureIndex = this.config.levels + (this.config.levels - 2 - level);

    return {
      label: `Bloom Upsample Pass Level ${level}`,
      colorAttachments: [{
        view: this.bloomViews[textureIndex],
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    };
  }

  /**
   * Get the final bloom texture view for compositing
   * This is the result of the last upsample pass (highest resolution)
   */
  getBloomTextureView(): GPUTextureView {
    // The final upsample result is at index levels + (levels - 2)
    // which is 2*levels - 2
    const finalIndex = this.config.levels * 2 - 2;
    return this.bloomViews[finalIndex];
  }

  /**
   * Get the threshold pipeline
   */
  getThresholdPipeline(): GPURenderPipeline {
    return this.thresholdPipeline;
  }

  /**
   * Get the downsample pipeline
   */
  getDownsamplePipeline(): GPURenderPipeline {
    return this.downsamplePipeline;
  }

  /**
   * Get the upsample pipeline (with blending)
   */
  getUpsamplePipeline(): GPURenderPipeline {
    return this.upsamplePipeline;
  }

  /**
   * Get the first upsample pipeline (no blending)
   */
  getUpsampleFirstPipeline(): GPURenderPipeline {
    return this.upsampleFirstPipeline;
  }

  /**
   * Get texture view for a specific downsample level
   */
  getDownsampleView(level: number): GPUTextureView {
    if (level < 0 || level >= this.config.levels) {
      throw new Error(`Invalid downsample level: ${level}`);
    }
    return this.bloomViews[level];
  }

  /**
   * Get texture view for a specific upsample level result
   */
  getUpsampleView(level: number): GPUTextureView {
    if (level < 0 || level >= this.config.levels - 1) {
      throw new Error(`Invalid upsample level: ${level}`);
    }
    const textureIndex = this.config.levels + (this.config.levels - 2 - level);
    return this.bloomViews[textureIndex];
  }

  /**
   * Get the number of mip levels
   */
  getLevels(): number {
    return this.config.levels;
  }

  /**
   * Get current bloom configuration
   */
  getConfig(): BloomConfig {
    return { ...this.config };
  }

  /**
   * Update bloom configuration
   */
  setConfig(config: Partial<BloomConfig>): void {
    const newLevels = config.levels ?? this.config.levels;

    // If levels changed, recreate textures and buffers
    if (newLevels !== this.config.levels) {
      this.config = { ...this.config, ...config };
      this.createTextures();
      this.createUniformBuffers();
    } else {
      this.config = { ...this.config, ...config };
    }
  }

  /**
   * Get current dimensions
   */
  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }

  /**
   * Destroy texture resources
   */
  private destroyTextures(): void {
    for (const texture of this.bloomTextures) {
      texture.destroy();
    }
    this.bloomTextures = [];
    this.bloomViews = [];
  }

  /**
   * Destroy uniform buffers
   */
  private destroyUniformBuffers(): void {
    for (const buffer of this.uniformBuffers) {
      buffer.destroy();
    }
    this.uniformBuffers = [];
  }

  /**
   * Release all GPU resources
   */
  destroy(): void {
    this.destroyTextures();
    this.destroyUniformBuffers();
  }
}
