/**
 * Tone Mapping and Color Grading Post-Processing Pass
 *
 * Implements HDR to LDR tone mapping with cinematic color grading effects.
 * Designed for the retro 80s video club scene with a cinematic look.
 *
 * Features:
 * - Multiple tone mapping algorithms (ACES, Reinhard, Filmic)
 * - Color grading controls (saturation, contrast, brightness, color temperature)
 * - Cinematic vignette effect
 * - Optional bloom compositing
 *
 * Pipeline order:
 * 1. Exposure adjustment (linear space)
 * 2. Color grading (linear space)
 * 3. Tone mapping (HDR to LDR)
 * 4. Vignette (post tone map)
 * 5. sRGB gamma correction
 */

import toneMappingShaderSource from '../shaders/tonemapping.wgsl';

/**
 * Tone mapping algorithm selection
 */
export type ToneMappingAlgorithm = 'aces' | 'reinhard' | 'filmic';

/**
 * Configuration options for tone mapping and color grading
 */
export interface ToneMappingConfig {
  /** Tone mapping algorithm (default: 'aces') */
  algorithm: ToneMappingAlgorithm;

  /** Exposure multiplier - controls overall brightness (default: 1.0) */
  exposure: number;

  /** Gamma correction value (default: 2.2) */
  gamma: number;

  /** Color saturation multiplier (0 = grayscale, 1 = normal, >1 = oversaturated) (default: 1.0) */
  saturation: number;

  /** Contrast multiplier (1 = normal, >1 = more contrast) (default: 1.0) */
  contrast: number;

  /** Brightness offset (-1 to 1 recommended) (default: 0.0) */
  brightness: number;

  /** Color temperature in Kelvin (6500 = neutral daylight) (default: 6500) */
  colorTemperature: number;

  /** Vignette effect strength (0 = none, 1 = full) (default: 0.0) */
  vignetteStrength: number;

  /** Vignette start radius from center (default: 0.75) */
  vignetteRadius: number;
}

/**
 * Default tone mapping configuration
 * Tuned for a cinematic 80s video club aesthetic
 */
const DEFAULT_CONFIG: ToneMappingConfig = {
  algorithm: 'aces',
  exposure: 1.0,
  gamma: 2.2,
  saturation: 1.0,
  contrast: 1.0,
  brightness: 0.0,
  colorTemperature: 6500,
  vignetteStrength: 0.0,
  vignetteRadius: 0.75,
};

/**
 * Preset configurations for common looks
 */
export const ToneMappingPresets = {
  /** Neutral - No color grading, just tone mapping */
  neutral: {
    algorithm: 'aces' as ToneMappingAlgorithm,
    exposure: 1.0,
    gamma: 2.2,
    saturation: 1.0,
    contrast: 1.0,
    brightness: 0.0,
    colorTemperature: 6500,
    vignetteStrength: 0.0,
    vignetteRadius: 0.75,
  },

  /** Cinematic - Slightly desaturated with vignette */
  cinematic: {
    algorithm: 'aces' as ToneMappingAlgorithm,
    exposure: 1.1,
    gamma: 2.2,
    saturation: 0.9,
    contrast: 1.1,
    brightness: -0.02,
    colorTemperature: 6200,
    vignetteStrength: 0.4,
    vignetteRadius: 0.7,
  },

  /** Retro 80s - Warm tones, high contrast, strong vignette */
  retro80s: {
    algorithm: 'filmic' as ToneMappingAlgorithm,
    exposure: 1.2,
    gamma: 2.2,
    saturation: 1.15,
    contrast: 1.15,
    brightness: 0.0,
    colorTemperature: 5500,
    vignetteStrength: 0.5,
    vignetteRadius: 0.65,
  },

  /** Neon Night - Cool tones, high saturation for neon scenes */
  neonNight: {
    algorithm: 'aces' as ToneMappingAlgorithm,
    exposure: 0.95,
    gamma: 2.2,
    saturation: 1.25,
    contrast: 1.2,
    brightness: -0.03,
    colorTemperature: 7500,
    vignetteStrength: 0.35,
    vignetteRadius: 0.75,
  },

  /** Vintage Film - Faded look with warm highlights */
  vintageFilm: {
    algorithm: 'reinhard' as ToneMappingAlgorithm,
    exposure: 1.15,
    gamma: 2.3,
    saturation: 0.85,
    contrast: 0.95,
    brightness: 0.05,
    colorTemperature: 5800,
    vignetteStrength: 0.55,
    vignetteRadius: 0.6,
  },
};

/**
 * Map algorithm name to shader enum value
 */
function algorithmToIndex(algorithm: ToneMappingAlgorithm): number {
  switch (algorithm) {
    case 'aces':
      return 0;
    case 'reinhard':
      return 1;
    case 'filmic':
      return 2;
    default:
      return 0;
  }
}

/**
 * Uniform buffer layout:
 * - exposure: f32 (offset 0)
 * - gamma: f32 (offset 4)
 * - algorithm: u32 (offset 8)
 * - saturation: f32 (offset 12)
 * - contrast: f32 (offset 16)
 * - brightness: f32 (offset 20)
 * - colorTempKelvin: f32 (offset 24)
 * - vignetteStrength: f32 (offset 28)
 * - vignetteRadius: f32 (offset 32)
 * - texelSizeX: f32 (offset 36)
 * - texelSizeY: f32 (offset 40)
 * - _padding: f32 (offset 44)
 * Total: 48 bytes
 */
const UNIFORM_BUFFER_SIZE = 48;

/**
 * ToneMappingPass - HDR to LDR conversion with color grading
 *
 * Usage:
 * ```typescript
 * const toneMapping = new ToneMappingPass(device, width, height, {
 *   algorithm: 'aces',
 *   vignetteStrength: 0.3,
 * });
 *
 * // In render loop:
 * const bindGroup = toneMapping.createBindGroup(hdrTextureView);
 * const passEncoder = commandEncoder.beginRenderPass(
 *   toneMapping.getRenderPassDescriptor(outputView)
 * );
 * passEncoder.setPipeline(toneMapping.getPipeline());
 * passEncoder.setBindGroup(0, bindGroup);
 * passEncoder.draw(3); // Fullscreen triangle
 * passEncoder.end();
 * ```
 */
export class ToneMappingPass {
  private device: GPUDevice;
  private config: ToneMappingConfig;

  // Dimensions
  private width: number;
  private height: number;

  // GPU Resources
  private shaderModule!: GPUShaderModule;
  private pipeline!: GPURenderPipeline;
  private pipelineWithBloom!: GPURenderPipeline;
  private bindGroupLayout!: GPUBindGroupLayout;
  private bindGroupLayoutWithBloom!: GPUBindGroupLayout;
  private uniformBuffer!: GPUBuffer;
  private sampler!: GPUSampler;

  /**
   * Create a new ToneMappingPass
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
    config?: Partial<ToneMappingConfig>
  ) {
    if (width <= 0 || height <= 0) {
      throw new Error(`ToneMappingPass dimensions must be positive: ${width}x${height}`);
    }

    this.device = device;
    this.width = width;
    this.height = height;
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.createShaderModule();
    this.createSampler();
    this.createBindGroupLayouts();
    this.createPipelines();
    this.createUniformBuffer();
    this.updateUniformBuffer();
  }

  /**
   * Create the WGSL shader module
   */
  private createShaderModule(): void {
    this.shaderModule = this.device.createShaderModule({
      label: 'Tone Mapping Shader',
      code: toneMappingShaderSource,
    });
  }

  /**
   * Create texture sampler with linear filtering
   */
  private createSampler(): void {
    this.sampler = this.device.createSampler({
      label: 'Tone Mapping Sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
  }

  /**
   * Create bind group layouts for the pipelines
   */
  private createBindGroupLayouts(): void {
    // Standard layout: uniform + HDR texture + sampler
    this.bindGroupLayout = this.device.createBindGroupLayout({
      label: 'Tone Mapping Bind Group Layout',
      entries: [
        // Uniform buffer
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        // HDR texture
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

    // Layout with bloom: uniform + HDR texture + sampler + bloom texture
    this.bindGroupLayoutWithBloom = this.device.createBindGroupLayout({
      label: 'Tone Mapping with Bloom Bind Group Layout',
      entries: [
        // Uniform buffer
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        // HDR texture
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
        // Bloom texture
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d' },
        },
      ],
    });
  }

  /**
   * Create render pipelines
   */
  private createPipelines(): void {
    // Pipeline layout for standard tone mapping
    const pipelineLayout = this.device.createPipelineLayout({
      label: 'Tone Mapping Pipeline Layout',
      bindGroupLayouts: [this.bindGroupLayout],
    });

    // Pipeline layout with bloom
    const pipelineLayoutWithBloom = this.device.createPipelineLayout({
      label: 'Tone Mapping with Bloom Pipeline Layout',
      bindGroupLayouts: [this.bindGroupLayoutWithBloom],
    });

    // Color target state - output to sRGB (or bgra8unorm for swap chain)
    const colorTargetState: GPUColorTargetState = {
      format: 'bgra8unorm',
      writeMask: GPUColorWrite.ALL,
    };

    // Standard tone mapping pipeline
    this.pipeline = this.device.createRenderPipeline({
      label: 'Tone Mapping Pipeline',
      layout: pipelineLayout,
      vertex: {
        module: this.shaderModule,
        entryPoint: 'vertexMain',
      },
      fragment: {
        module: this.shaderModule,
        entryPoint: 'fragmentMain',
        targets: [colorTargetState],
      },
      primitive: {
        topology: 'triangle-list',
      },
    });

    // Tone mapping with bloom composite pipeline
    this.pipelineWithBloom = this.device.createRenderPipeline({
      label: 'Tone Mapping with Bloom Pipeline',
      layout: pipelineLayoutWithBloom,
      vertex: {
        module: this.shaderModule,
        entryPoint: 'vertexMain',
      },
      fragment: {
        module: this.shaderModule,
        entryPoint: 'fragmentWithBloom',
        targets: [colorTargetState],
      },
      primitive: {
        topology: 'triangle-list',
      },
    });
  }

  /**
   * Create the uniform buffer
   */
  private createUniformBuffer(): void {
    this.uniformBuffer = this.device.createBuffer({
      label: 'Tone Mapping Uniform Buffer',
      size: UNIFORM_BUFFER_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  /**
   * Update the uniform buffer with current config values
   */
  private updateUniformBuffer(): void {
    // Create buffer with proper layout
    const buffer = new ArrayBuffer(UNIFORM_BUFFER_SIZE);
    const floatView = new Float32Array(buffer);
    const uintView = new Uint32Array(buffer);

    // Pack uniforms
    floatView[0] = this.config.exposure;
    floatView[1] = this.config.gamma;
    uintView[2] = algorithmToIndex(this.config.algorithm);
    floatView[3] = this.config.saturation;
    floatView[4] = this.config.contrast;
    floatView[5] = this.config.brightness;
    floatView[6] = this.config.colorTemperature;
    floatView[7] = this.config.vignetteStrength;
    floatView[8] = this.config.vignetteRadius;
    floatView[9] = 1.0 / this.width;  // texelSizeX
    floatView[10] = 1.0 / this.height; // texelSizeY
    floatView[11] = 0.0; // padding

    this.device.queue.writeBuffer(this.uniformBuffer, 0, buffer);
  }

  /**
   * Resize the pass for new dimensions
   *
   * @param width - New width
   * @param height - New height
   */
  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) {
      throw new Error(`ToneMappingPass dimensions must be positive: ${width}x${height}`);
    }

    if (this.width === width && this.height === height) {
      return;
    }

    this.width = width;
    this.height = height;

    // Update uniform buffer with new texel sizes
    this.updateUniformBuffer();
  }

  /**
   * Get the standard render pipeline
   */
  getPipeline(): GPURenderPipeline {
    return this.pipeline;
  }

  /**
   * Get the pipeline with bloom compositing
   */
  getPipelineWithBloom(): GPURenderPipeline {
    return this.pipelineWithBloom;
  }

  /**
   * Get the bind group layout for standard tone mapping
   */
  getBindGroupLayout(): GPUBindGroupLayout {
    return this.bindGroupLayout;
  }

  /**
   * Get the bind group layout with bloom support
   */
  getBindGroupLayoutWithBloom(): GPUBindGroupLayout {
    return this.bindGroupLayoutWithBloom;
  }

  /**
   * Create a bind group for standard tone mapping
   *
   * @param hdrTexture - HDR scene texture view
   * @returns Bind group for the tone mapping pass
   */
  createBindGroup(hdrTexture: GPUTextureView): GPUBindGroup {
    return this.device.createBindGroup({
      label: 'Tone Mapping Bind Group',
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: hdrTexture },
        { binding: 2, resource: this.sampler },
      ],
    });
  }

  /**
   * Create a bind group with bloom texture for compositing
   *
   * @param hdrTexture - HDR scene texture view
   * @param bloomTexture - Bloom texture view to composite
   * @returns Bind group for the tone mapping pass with bloom
   */
  createBindGroupWithBloom(hdrTexture: GPUTextureView, bloomTexture: GPUTextureView): GPUBindGroup {
    return this.device.createBindGroup({
      label: 'Tone Mapping with Bloom Bind Group',
      layout: this.bindGroupLayoutWithBloom,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: hdrTexture },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: bloomTexture },
      ],
    });
  }

  /**
   * Get render pass descriptor for the tone mapping pass
   *
   * @param outputView - Target texture view (typically the swap chain texture)
   * @returns Render pass descriptor
   */
  getRenderPassDescriptor(outputView: GPUTextureView): GPURenderPassDescriptor {
    return {
      label: 'Tone Mapping Pass',
      colorAttachments: [
        {
          view: outputView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    };
  }

  /**
   * Update configuration (partial update supported)
   *
   * @param config - Configuration values to update
   */
  updateConfig(config: Partial<ToneMappingConfig>): void {
    this.config = { ...this.config, ...config };
    this.updateUniformBuffer();
  }

  /**
   * Apply a preset configuration
   *
   * @param presetName - Name of the preset to apply
   */
  applyPreset(presetName: keyof typeof ToneMappingPresets): void {
    const preset = ToneMappingPresets[presetName];
    if (preset) {
      this.config = { ...preset };
      this.updateUniformBuffer();
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): ToneMappingConfig {
    return { ...this.config };
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
   * Set exposure value
   *
   * @param exposure - Exposure multiplier (default: 1.0)
   */
  setExposure(exposure: number): void {
    this.config.exposure = exposure;
    this.updateUniformBuffer();
  }

  /**
   * Set tone mapping algorithm
   *
   * @param algorithm - 'aces', 'reinhard', or 'filmic'
   */
  setAlgorithm(algorithm: ToneMappingAlgorithm): void {
    this.config.algorithm = algorithm;
    this.updateUniformBuffer();
  }

  /**
   * Set saturation
   *
   * @param saturation - Saturation multiplier (0 = grayscale, 1 = normal)
   */
  setSaturation(saturation: number): void {
    this.config.saturation = saturation;
    this.updateUniformBuffer();
  }

  /**
   * Set contrast
   *
   * @param contrast - Contrast multiplier (1 = normal)
   */
  setContrast(contrast: number): void {
    this.config.contrast = contrast;
    this.updateUniformBuffer();
  }

  /**
   * Set brightness
   *
   * @param brightness - Brightness offset (-1 to 1 recommended)
   */
  setBrightness(brightness: number): void {
    this.config.brightness = brightness;
    this.updateUniformBuffer();
  }

  /**
   * Set color temperature
   *
   * @param kelvin - Color temperature in Kelvin (6500 = neutral)
   */
  setColorTemperature(kelvin: number): void {
    this.config.colorTemperature = kelvin;
    this.updateUniformBuffer();
  }

  /**
   * Set vignette effect parameters
   *
   * @param strength - Vignette intensity (0 = none, 1 = full)
   * @param radius - Vignette start radius from center
   */
  setVignette(strength: number, radius?: number): void {
    this.config.vignetteStrength = strength;
    if (radius !== undefined) {
      this.config.vignetteRadius = radius;
    }
    this.updateUniformBuffer();
  }

  /**
   * Release all GPU resources
   */
  destroy(): void {
    this.uniformBuffer.destroy();
  }
}
