/**
 * Shadow Mapping Pass
 *
 * Manages shadow map generation for lights in the scene.
 * Supports both directional (orthographic) and spot (perspective) light shadows.
 *
 * Features:
 * - Configurable shadow map resolution
 * - Depth bias to prevent shadow acne
 * - PCF (Percentage Closer Filtering) for soft shadows
 * - Support for multiple shadow-casting lights
 */

import shadowShaderCode from '../shaders/shadow.wgsl';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Shadow mapping configuration options
 */
export interface ShadowConfig {
  /** Shadow map resolution (default 2048) */
  mapSize: number;
  /** Depth bias to prevent shadow acne (default 0.005) */
  bias: number;
  /** Normal-based bias (default 0.02) */
  normalBias: number;
  /** Number of PCF filter samples (default 16) */
  pcfSamples: number;
}

/**
 * Light configuration for shadow map generation
 */
export interface ShadowLight {
  /** World-space position of the light */
  position: [number, number, number];
  /** Target point the light is looking at */
  target: [number, number, number];
  /** Near clipping plane */
  near: number;
  /** Far clipping plane */
  far: number;
  /** Field of view in radians (for spot lights) */
  fov?: number;
  /** Orthographic size (for directional lights) */
  orthoSize?: number;
}

/**
 * Result of shadow map creation
 */
export interface ShadowMapResult {
  /** The shadow depth texture */
  texture: GPUTexture;
  /** View for rendering to the shadow map */
  view: GPUTextureView;
  /** Light's view-projection matrix for shadow coordinate calculation */
  viewProjection: Float32Array;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: ShadowConfig = {
  mapSize: 2048,
  bias: 0.005,
  normalBias: 0.02,
  pcfSamples: 16,
};

// ============================================================================
// Shadow Pass Class
// ============================================================================

export class ShadowPass {
  private device: GPUDevice;
  private config: ShadowConfig;

  // Shadow rendering pipeline
  private shadowPipeline!: GPURenderPipeline;
  private shadowPipelineLayout!: GPUPipelineLayout;

  // Bind group layouts
  private shadowUniformsBindGroupLayout!: GPUBindGroupLayout;
  private shadowSamplingBindGroupLayout!: GPUBindGroupLayout;

  // Comparison sampler for shadow sampling
  private shadowSampler!: GPUSampler;

  // Shadow configuration uniform buffer (for lighting pass)
  private shadowConfigBuffer!: GPUBuffer;

  constructor(device: GPUDevice, config?: Partial<ShadowConfig>) {
    this.device = device;
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.createBindGroupLayouts();
    this.createShadowPipeline();
    this.createShadowSampler();
    this.createShadowConfigBuffer();
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  /**
   * Create bind group layouts for shadow rendering and sampling
   */
  private createBindGroupLayouts(): void {
    // Layout for shadow map generation (uniforms only)
    this.shadowUniformsBindGroupLayout = this.device.createBindGroupLayout({
      label: 'Shadow Uniforms Bind Group Layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'uniform' },
        },
      ],
    });

    // Layout for shadow sampling in lighting pass
    this.shadowSamplingBindGroupLayout = this.device.createBindGroupLayout({
      label: 'Shadow Sampling Bind Group Layout',
      entries: [
        // Shadow map texture
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: {
            sampleType: 'depth',
            viewDimension: '2d',
          },
        },
        // Comparison sampler for PCF
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'comparison' },
        },
        // Shadow configuration (light VP matrix, bias, etc.)
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    });
  }

  /**
   * Create the shadow rendering pipeline (depth-only)
   */
  private createShadowPipeline(): void {
    const shaderModule = this.device.createShaderModule({
      label: 'Shadow Shader',
      code: shadowShaderCode,
    });

    this.shadowPipelineLayout = this.device.createPipelineLayout({
      label: 'Shadow Pipeline Layout',
      bindGroupLayouts: [this.shadowUniformsBindGroupLayout],
    });

    this.shadowPipeline = this.device.createRenderPipeline({
      label: 'Shadow Render Pipeline',
      layout: this.shadowPipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'shadowVertexMain',
        buffers: [
          {
            // Position only for shadow pass (we don't need UV or normals)
            arrayStride: 32, // Same stride as main vertex buffer
            attributes: [
              {
                shaderLocation: 0,
                offset: 0,
                format: 'float32x3',
              },
            ],
          },
        ],
      },
      // No fragment shader needed - depth-only pass
      // WebGPU will write depth automatically
      primitive: {
        topology: 'triangle-list',
        cullMode: 'back', // Cull back faces for better shadow quality
        frontFace: 'ccw',
      },
      depthStencil: {
        format: 'depth32float',
        depthWriteEnabled: true,
        depthCompare: 'less',
        // Depth bias to prevent shadow acne
        depthBias: Math.floor(this.config.bias * 1000000),
        depthBiasSlopeScale: this.config.normalBias,
        depthBiasClamp: 0.01,
      },
    });
  }

  /**
   * Create comparison sampler for PCF shadow filtering
   */
  private createShadowSampler(): void {
    this.shadowSampler = this.device.createSampler({
      label: 'Shadow Comparison Sampler',
      compare: 'less',
      magFilter: 'linear',
      minFilter: 'linear',
    });
  }

  /**
   * Create uniform buffer for shadow configuration
   */
  private createShadowConfigBuffer(): void {
    // Layout: mat4x4f (lightVP) + vec4f (bias, normalBias, mapSize, pcfSamples)
    // = 64 + 16 = 80 bytes, padded to 96 for alignment
    this.shadowConfigBuffer = this.device.createBuffer({
      label: 'Shadow Config Buffer',
      size: 96,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  // ==========================================================================
  // Matrix Calculations
  // ==========================================================================

  /**
   * Create a view matrix for a light
   */
  private createLightViewMatrix(position: [number, number, number], target: [number, number, number]): Float32Array {
    const view = new Float32Array(16);

    // Calculate forward, right, and up vectors
    const forward = [
      target[0] - position[0],
      target[1] - position[1],
      target[2] - position[2],
    ];
    const forwardLen = Math.sqrt(forward[0] ** 2 + forward[1] ** 2 + forward[2] ** 2);
    forward[0] /= forwardLen;
    forward[1] /= forwardLen;
    forward[2] /= forwardLen;

    // Use world up (0, 1, 0)
    const worldUp = [0, 1, 0];

    // Right = forward x up
    const right = [
      forward[1] * worldUp[2] - forward[2] * worldUp[1],
      forward[2] * worldUp[0] - forward[0] * worldUp[2],
      forward[0] * worldUp[1] - forward[1] * worldUp[0],
    ];
    const rightLen = Math.sqrt(right[0] ** 2 + right[1] ** 2 + right[2] ** 2);
    right[0] /= rightLen;
    right[1] /= rightLen;
    right[2] /= rightLen;

    // Up = right x forward
    const up = [
      right[1] * forward[2] - right[2] * forward[1],
      right[2] * forward[0] - right[0] * forward[2],
      right[0] * forward[1] - right[1] * forward[0],
    ];

    // Build view matrix (column-major for WebGPU)
    view[0] = right[0];
    view[1] = up[0];
    view[2] = -forward[0];
    view[3] = 0;

    view[4] = right[1];
    view[5] = up[1];
    view[6] = -forward[1];
    view[7] = 0;

    view[8] = right[2];
    view[9] = up[2];
    view[10] = -forward[2];
    view[11] = 0;

    view[12] = -(right[0] * position[0] + right[1] * position[1] + right[2] * position[2]);
    view[13] = -(up[0] * position[0] + up[1] * position[1] + up[2] * position[2]);
    view[14] = forward[0] * position[0] + forward[1] * position[1] + forward[2] * position[2];
    view[15] = 1;

    return view;
  }

  /**
   * Create an orthographic projection matrix (for directional lights)
   */
  private createOrthographicMatrix(size: number, near: number, far: number): Float32Array {
    const proj = new Float32Array(16);

    const left = -size;
    const right = size;
    const bottom = -size;
    const top = size;

    proj[0] = 2 / (right - left);
    proj[5] = 2 / (top - bottom);
    proj[10] = 1 / (far - near);
    proj[12] = -(right + left) / (right - left);
    proj[13] = -(top + bottom) / (top - bottom);
    proj[14] = -near / (far - near);
    proj[15] = 1;

    return proj;
  }

  /**
   * Create a perspective projection matrix (for spot lights)
   */
  private createPerspectiveMatrix(fov: number, near: number, far: number): Float32Array {
    const proj = new Float32Array(16);

    const f = 1 / Math.tan(fov / 2);
    const rangeInv = 1 / (near - far);

    proj[0] = f; // aspect = 1 for shadow maps
    proj[5] = f;
    proj[10] = far * rangeInv;
    proj[11] = -1;
    proj[14] = near * far * rangeInv;

    return proj;
  }

  /**
   * Multiply two 4x4 matrices (column-major)
   */
  private multiplyMatrices(a: Float32Array, b: Float32Array): Float32Array {
    const result = new Float32Array(16);

    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        result[j * 4 + i] =
          a[i] * b[j * 4] +
          a[4 + i] * b[j * 4 + 1] +
          a[8 + i] * b[j * 4 + 2] +
          a[12 + i] * b[j * 4 + 3];
      }
    }

    return result;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Create a shadow map for a light
   *
   * @param light - Light configuration
   * @returns Shadow map texture, view, and light's view-projection matrix
   */
  createShadowMap(light: ShadowLight): ShadowMapResult {
    // Create shadow map texture
    const texture = this.device.createTexture({
      label: 'Shadow Map',
      size: [this.config.mapSize, this.config.mapSize],
      format: 'depth32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    const view = texture.createView({
      label: 'Shadow Map View',
    });

    // Calculate light's view-projection matrix
    const viewMatrix = this.createLightViewMatrix(light.position, light.target);

    let projMatrix: Float32Array;
    if (light.orthoSize !== undefined) {
      // Directional light (orthographic)
      projMatrix = this.createOrthographicMatrix(light.orthoSize, light.near, light.far);
    } else {
      // Spot light (perspective)
      const fov = light.fov ?? Math.PI / 4; // Default 45 degrees
      projMatrix = this.createPerspectiveMatrix(fov, light.near, light.far);
    }

    const viewProjection = this.multiplyMatrices(projMatrix, viewMatrix);

    return {
      texture,
      view,
      viewProjection,
    };
  }

  /**
   * Get the shadow rendering pipeline
   */
  getShadowPipeline(): GPURenderPipeline {
    return this.shadowPipeline;
  }

  /**
   * Get the bind group layout for shadow uniforms (used during shadow map generation)
   */
  getShadowUniformsBindGroupLayout(): GPUBindGroupLayout {
    return this.shadowUniformsBindGroupLayout;
  }

  /**
   * Get the bind group layout for shadow sampling (used in lighting pass)
   */
  getShadowBindGroupLayout(): GPUBindGroupLayout {
    return this.shadowSamplingBindGroupLayout;
  }

  /**
   * Create a bind group for shadow map rendering (per-object)
   * Contains the light's view-projection matrix and model matrix
   *
   * @param lightVP - Light's view-projection matrix
   * @param modelMatrix - Object's model matrix
   */
  createShadowRenderBindGroup(lightVP: Float32Array, modelMatrix: Float32Array): GPUBindGroup {
    // Create uniform buffer for this object
    // Layout: mat4x4f (lightVP) + mat4x4f (model) = 128 bytes
    const uniformBuffer = this.device.createBuffer({
      label: 'Shadow Render Uniforms',
      size: 128,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Write light VP and model matrix
    this.device.queue.writeBuffer(uniformBuffer, 0, lightVP as unknown as ArrayBuffer);
    this.device.queue.writeBuffer(uniformBuffer, 64, modelMatrix as unknown as ArrayBuffer);

    return this.device.createBindGroup({
      label: 'Shadow Render Bind Group',
      layout: this.shadowUniformsBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
      ],
    });
  }

  /**
   * Create a bind group for sampling a shadow map in the lighting pass
   *
   * @param shadowMapView - The shadow map texture view
   * @param lightVP - Light's view-projection matrix
   */
  createShadowBindGroup(shadowMapView: GPUTextureView, lightVP: Float32Array): GPUBindGroup {
    // Update shadow config buffer
    const configData = new Float32Array(24); // 96 bytes / 4

    // Light view-projection matrix (16 floats)
    configData.set(lightVP, 0);

    // Shadow parameters (bias, normalBias, mapSize, pcfSamples)
    configData[16] = this.config.bias;
    configData[17] = this.config.normalBias;
    configData[18] = this.config.mapSize;
    configData[19] = this.config.pcfSamples;

    this.device.queue.writeBuffer(this.shadowConfigBuffer, 0, configData);

    return this.device.createBindGroup({
      label: 'Shadow Sampling Bind Group',
      layout: this.shadowSamplingBindGroupLayout,
      entries: [
        { binding: 0, resource: shadowMapView },
        { binding: 1, resource: this.shadowSampler },
        { binding: 2, resource: { buffer: this.shadowConfigBuffer } },
      ],
    });
  }

  /**
   * Get render pass descriptor for shadow map rendering
   *
   * @param shadowMapView - The shadow map texture view to render to
   */
  getRenderPassDescriptor(shadowMapView: GPUTextureView): GPURenderPassDescriptor {
    return {
      label: 'Shadow Render Pass',
      colorAttachments: [],
      depthStencilAttachment: {
        view: shadowMapView,
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    };
  }

  /**
   * Get the current shadow configuration
   */
  getConfig(): Readonly<ShadowConfig> {
    return { ...this.config };
  }

  /**
   * Update shadow configuration
   * Note: Changes to mapSize won't affect existing shadow maps
   */
  updateConfig(config: Partial<ShadowConfig>): void {
    this.config = { ...this.config, ...config };

    // Update config buffer with new values
    const configData = new Float32Array(4);
    configData[0] = this.config.bias;
    configData[1] = this.config.normalBias;
    configData[2] = this.config.mapSize;
    configData[3] = this.config.pcfSamples;

    this.device.queue.writeBuffer(this.shadowConfigBuffer, 64, configData);
  }

  /**
   * Release all GPU resources
   */
  destroy(): void {
    this.shadowConfigBuffer.destroy();
  }
}
