/**
 * FXAA Post-Processing Pass (Fast Approximate Anti-Aliasing)
 *
 * Implements NVIDIA's FXAA 3.11 algorithm for edge anti-aliasing.
 * This is a screen-space technique that works as a final post-process pass
 * after tone mapping, smoothing jagged edges in the rendered image.
 *
 * Algorithm:
 * 1. Edge Detection - Find high contrast areas using luminance
 * 2. Edge Direction - Determine if edge is horizontal or vertical
 * 3. Edge Walking - Search along the edge to find its extent
 * 4. Blend - Mix pixel with neighbor based on edge position
 *
 * FXAA is very fast compared to MSAA/SSAA but can cause some blurring.
 * Use the quality presets to balance between performance and quality.
 */

import fxaaShaderSource from '../shaders/fxaa.wgsl?raw';

/**
 * Quality preset for FXAA
 * - 'low': 4 search iterations, fastest but may miss some edges
 * - 'medium': 8 search iterations, good balance
 * - 'high': 12 search iterations, best quality
 */
export type FXAAQuality = 'low' | 'medium' | 'high';

/**
 * Configuration for the FXAA pass
 */
export interface FXAAConfig {
  /** Whether FXAA is enabled (default true) */
  enabled: boolean;
  /** Quality preset affecting number of search iterations (default 'medium') */
  quality: FXAAQuality;
  /** Edge detection threshold - minimum contrast for edge detection (default 0.0833 = 1/12) */
  edgeThreshold: number;
  /** Minimum threshold for dark areas to avoid noise amplification (default 0.0625 = 1/16) */
  edgeThresholdMin: number;
  /** Sub-pixel aliasing removal amount (0.0 = off, 1.0 = full, default 0.75) */
  subpixelQuality: number;
}

/**
 * Default FXAA configuration
 */
const DEFAULT_CONFIG: FXAAConfig = {
  enabled: true,
  quality: 'medium',
  edgeThreshold: 0.0833,      // 1/12 - good balance
  edgeThresholdMin: 0.0625,   // 1/16 - skip very dark areas
  subpixelQuality: 0.75,      // 75% sub-pixel AA
};

/**
 * Map quality preset to numeric value for shader
 */
const QUALITY_TO_NUMBER: Record<FXAAQuality, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

/**
 * Uniform buffer structure (must match WGSL FXAAUniforms)
 * Total size: 32 bytes (8 floats, 16-byte aligned)
 * - texelSizeX: f32
 * - texelSizeY: f32
 * - edgeThreshold: f32
 * - edgeThresholdMin: f32
 * - subpixelQuality: f32
 * - qualityPreset: f32
 * - _padding: vec2f
 */
const UNIFORM_BUFFER_SIZE = 32;

/**
 * FXAA Post-Processing Pass
 *
 * Usage:
 * ```typescript
 * const fxaa = new FXAAPass(device, width, height);
 *
 * // In render loop:
 * const bindGroup = fxaa.createBindGroup(toneMappedTextureView);
 * const passDescriptor = fxaa.getRenderPassDescriptor(swapChainTextureView);
 *
 * const encoder = device.createCommandEncoder();
 * const pass = encoder.beginRenderPass(passDescriptor);
 * pass.setPipeline(fxaa.getPipeline());
 * pass.setBindGroup(0, bindGroup);
 * pass.draw(3); // Fullscreen triangle
 * pass.end();
 * ```
 */
export class FXAAPass {
  private device: GPUDevice;
  private config: FXAAConfig;

  // Texture dimensions
  private width: number;
  private height: number;

  // Pipelines - one for FXAA, one for passthrough when disabled
  private fxaaPipeline!: GPURenderPipeline;
  private passthroughPipeline!: GPURenderPipeline;

  // Bind group layout
  private bindGroupLayout!: GPUBindGroupLayout;

  // Sampler for texture filtering
  private sampler!: GPUSampler;

  // Uniform buffer
  private uniformBuffer!: GPUBuffer;

  // Shader module
  private shaderModule!: GPUShaderModule;

  /**
   * Create a new FXAA pass
   *
   * @param device - WebGPU device
   * @param width - Render target width
   * @param height - Render target height
   * @param config - Optional configuration overrides
   */
  constructor(
    device: GPUDevice,
    width: number,
    height: number,
    config?: Partial<FXAAConfig>
  ) {
    if (width <= 0 || height <= 0) {
      throw new Error(`FXAAPass dimensions must be positive: ${width}x${height}`);
    }

    this.device = device;
    this.width = width;
    this.height = height;
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.createShaderModule();
    this.createSampler();
    this.createBindGroupLayout();
    this.createPipelines();
    this.createUniformBuffer();
    this.updateUniformBuffer();
  }

  /**
   * Create the WGSL shader module
   */
  private createShaderModule(): void {
    this.shaderModule = this.device.createShaderModule({
      label: 'FXAA Shader',
      code: fxaaShaderSource,
    });
  }

  /**
   * Create linear sampler for texture filtering
   * FXAA needs linear filtering for smooth blending
   */
  private createSampler(): void {
    this.sampler = this.device.createSampler({
      label: 'FXAA Sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
  }

  /**
   * Create bind group layout
   */
  private createBindGroupLayout(): void {
    this.bindGroupLayout = this.device.createBindGroupLayout({
      label: 'FXAA Bind Group Layout',
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
  }

  /**
   * Create render pipelines for FXAA and passthrough
   */
  private createPipelines(): void {
    const pipelineLayout = this.device.createPipelineLayout({
      label: 'FXAA Pipeline Layout',
      bindGroupLayouts: [this.bindGroupLayout],
    });

    // Common color target state - output to sRGB swapchain
    // FXAA should be the final pass before presenting
    const colorTargetState: GPUColorTargetState = {
      format: 'bgra8unorm', // Common swapchain format
      writeMask: GPUColorWrite.ALL,
    };

    // FXAA pipeline
    this.fxaaPipeline = this.device.createRenderPipeline({
      label: 'FXAA Pipeline',
      layout: pipelineLayout,
      vertex: {
        module: this.shaderModule,
        entryPoint: 'vertexMain',
      },
      fragment: {
        module: this.shaderModule,
        entryPoint: 'fxaaFragment',
        targets: [colorTargetState],
      },
      primitive: {
        topology: 'triangle-list',
      },
    });

    // Passthrough pipeline (when FXAA is disabled)
    this.passthroughPipeline = this.device.createRenderPipeline({
      label: 'FXAA Passthrough Pipeline',
      layout: pipelineLayout,
      vertex: {
        module: this.shaderModule,
        entryPoint: 'vertexMain',
      },
      fragment: {
        module: this.shaderModule,
        entryPoint: 'passthroughFragment',
        targets: [colorTargetState],
      },
      primitive: {
        topology: 'triangle-list',
      },
    });
  }

  /**
   * Create uniform buffer
   */
  private createUniformBuffer(): void {
    this.uniformBuffer = this.device.createBuffer({
      label: 'FXAA Uniform Buffer',
      size: UNIFORM_BUFFER_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  /**
   * Update uniform buffer with current configuration
   */
  private updateUniformBuffer(): void {
    const uniforms = new Float32Array([
      1.0 / this.width,              // texelSizeX
      1.0 / this.height,             // texelSizeY
      this.config.edgeThreshold,     // edgeThreshold
      this.config.edgeThresholdMin,  // edgeThresholdMin
      this.config.subpixelQuality,   // subpixelQuality
      QUALITY_TO_NUMBER[this.config.quality], // qualityPreset
      0.0, // padding
      0.0, // padding
    ]);

    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);
  }

  /**
   * Resize the FXAA pass
   *
   * @param width - New width
   * @param height - New height
   */
  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) {
      throw new Error(`FXAAPass dimensions must be positive: ${width}x${height}`);
    }

    if (this.width === width && this.height === height) {
      return;
    }

    this.width = width;
    this.height = height;

    // Update uniform buffer with new texel size
    this.updateUniformBuffer();
  }

  /**
   * Get the active render pipeline
   * Returns FXAA pipeline if enabled, passthrough otherwise
   */
  getPipeline(): GPURenderPipeline {
    return this.config.enabled ? this.fxaaPipeline : this.passthroughPipeline;
  }

  /**
   * Get the FXAA pipeline (always returns FXAA regardless of enabled state)
   */
  getFXAAPipeline(): GPURenderPipeline {
    return this.fxaaPipeline;
  }

  /**
   * Get the passthrough pipeline
   */
  getPassthroughPipeline(): GPURenderPipeline {
    return this.passthroughPipeline;
  }

  /**
   * Get the bind group layout
   */
  getBindGroupLayout(): GPUBindGroupLayout {
    return this.bindGroupLayout;
  }

  /**
   * Create a bind group for rendering
   *
   * @param sourceTexture - Texture view of the input (e.g., tone mapped result)
   * @returns GPUBindGroup for use in render pass
   */
  createBindGroup(sourceTexture: GPUTextureView): GPUBindGroup {
    return this.device.createBindGroup({
      label: 'FXAA Bind Group',
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: sourceTexture },
        { binding: 2, resource: this.sampler },
      ],
    });
  }

  /**
   * Get render pass descriptor for FXAA pass
   *
   * @param outputView - Texture view to render to (e.g., swapchain texture)
   * @returns GPURenderPassDescriptor
   */
  getRenderPassDescriptor(outputView: GPUTextureView): GPURenderPassDescriptor {
    return {
      label: 'FXAA Render Pass',
      colorAttachments: [{
        view: outputView,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    };
  }

  /**
   * Update FXAA configuration
   *
   * @param config - Partial configuration to update
   */
  updateConfig(config: Partial<FXAAConfig>): void {
    this.config = { ...this.config, ...config };
    this.updateUniformBuffer();
  }

  /**
   * Get current configuration
   */
  getConfig(): FXAAConfig {
    return { ...this.config };
  }

  /**
   * Check if FXAA is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Enable or disable FXAA
   *
   * @param enabled - Whether to enable FXAA
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * Set quality preset
   *
   * @param quality - Quality preset ('low', 'medium', 'high')
   */
  setQuality(quality: FXAAQuality): void {
    if (this.config.quality !== quality) {
      this.config.quality = quality;
      this.updateUniformBuffer();
    }
  }

  /**
   * Get current quality preset
   */
  getQuality(): FXAAQuality {
    return this.config.quality;
  }

  /**
   * Set edge detection threshold
   *
   * @param threshold - Threshold value (default 0.0833)
   */
  setEdgeThreshold(threshold: number): void {
    if (this.config.edgeThreshold !== threshold) {
      this.config.edgeThreshold = threshold;
      this.updateUniformBuffer();
    }
  }

  /**
   * Set sub-pixel quality
   *
   * @param quality - Sub-pixel quality (0.0 to 1.0)
   */
  setSubpixelQuality(quality: number): void {
    const clamped = Math.max(0, Math.min(1, quality));
    if (this.config.subpixelQuality !== clamped) {
      this.config.subpixelQuality = clamped;
      this.updateUniformBuffer();
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
   * Release all GPU resources
   */
  destroy(): void {
    this.uniformBuffer.destroy();
  }
}
