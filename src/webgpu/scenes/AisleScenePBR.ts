/**
 * AisleScenePBR - PBR-enabled Video Club Scene with Deferred Rendering
 */
console.log('[AisleScenePBR] Module loading - START');

import { mat4, vec3 } from 'gl-matrix';
console.log('[AisleScenePBR] gl-matrix imported');

import { Camera } from '../core/Camera';
console.log('[AisleScenePBR] Camera imported');

import { createPlane, createBox, createCassette, createVerticalPlane, type Mesh } from '../core/Geometry';
console.log('[AisleScenePBR] Geometry imported');

import { TextureLoader } from '../core/TextureLoader';
console.log('[AisleScenePBR] TextureLoader imported');

import { Materials, packMaterial, createMaterial, type PBRMaterial } from '../core/Material';
console.log('[AisleScenePBR] Material imported');

// Rendering passes
import { GBuffer } from '../rendering/GBuffer';
console.log('[AisleScenePBR] GBuffer imported');

import { ShadowPass, type ShadowLight, type ShadowMapResult } from '../rendering/ShadowPass';
console.log('[AisleScenePBR] ShadowPass imported');

import { SSAOPass } from '../rendering/SSAOPass';
console.log('[AisleScenePBR] SSAOPass imported');

import { BloomPass } from '../rendering/BloomPass';
console.log('[AisleScenePBR] BloomPass imported');

import { ToneMappingPass, ToneMappingPresets } from '../rendering/ToneMappingPass';
console.log('[AisleScenePBR] ToneMappingPass imported');

import { FXAAPass } from '../rendering/FXAAPass';
console.log('[AisleScenePBR] FXAAPass imported');

import { InstancedMeshGroup } from '../objects/InstancedMeshGroup';
console.log('[AisleScenePBR] InstancedMeshGroup imported');

// Import shaders
import gbufferShaderSource from '../shaders/gbuffer.wgsl?raw';
console.log('[AisleScenePBR] gbuffer shader imported, length:', gbufferShaderSource.length);

import pbrLightingShaderSource from '../shaders/pbr-lighting.wgsl?raw';
console.log('[AisleScenePBR] pbr-lighting shader imported, length:', pbrLightingShaderSource.length);

console.log('[AisleScenePBR] Module loading - ALL IMPORTS DONE');

// ============================================================================
// Configuration
// ============================================================================

/**
 * Render configuration for the PBR pipeline
 */
export interface PBRRenderConfig {
  // Shadows
  shadowMapSize: number;
  shadowBias: number;
  shadowNormalBias: number;
  enableShadows: boolean;

  // SSAO
  ssaoRadius: number;
  ssaoKernelSize: number;
  ssaoHalfResolution: boolean;
  enableSSAO: boolean;

  // Bloom
  bloomThreshold: number;
  bloomIntensity: number;
  bloomLevels: number;
  enableBloom: boolean;

  // Tone Mapping
  toneMappingAlgorithm: 'aces' | 'reinhard' | 'filmic';
  exposure: number;
  vignetteStrength: number;

  // FXAA
  fxaaEnabled: boolean;
  fxaaQuality: 'low' | 'medium' | 'high';
}

const DEFAULT_CONFIG: PBRRenderConfig = {
  // Shadows
  shadowMapSize: 2048,
  shadowBias: 0.005,
  shadowNormalBias: 0.02,
  enableShadows: true,

  // SSAO
  ssaoRadius: 0.5,
  ssaoKernelSize: 16,
  ssaoHalfResolution: true,
  enableSSAO: true,

  // Bloom
  bloomThreshold: 1.0,
  bloomIntensity: 0.5,
  bloomLevels: 5,
  enableBloom: true,

  // Tone Mapping
  toneMappingAlgorithm: 'aces',
  exposure: 1.2,
  vignetteStrength: 0.2,

  // FXAA
  fxaaEnabled: true,
  fxaaQuality: 'high',
};

// ============================================================================
// Types
// ============================================================================

/**
 * Scene object with PBR material
 */
interface PBRSceneObject {
  mesh: Mesh;
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  modelMatrix: mat4;
  normalMatrix: mat4;
  material: PBRMaterial;
  materialBuffer: GPUBuffer;
  materialBindGroup: GPUBindGroup;
  modelBuffer: GPUBuffer;
  modelBindGroup: GPUBindGroup;
  filmId?: number;
}

/**
 * Point light definition
 */
interface PointLight {
  position: [number, number, number];
  color: [number, number, number];
  intensity: number;
  radius: number;
}

/**
 * Film data from TMDB
 */
interface FilmData {
  id: number;
  title: string;
  poster_path: string | null;
}

// ============================================================================
// AisleScenePBR Class
// ============================================================================

export class AisleScenePBR {
  private device: GPUDevice;
  private _format: GPUTextureFormat;
  private camera: Camera;
  private canvas: HTMLCanvasElement;
  private _textureLoader: TextureLoader;
  private config: PBRRenderConfig;

  // Scene objects
  private objects: PBRSceneObject[] = [];
  private pointLights: PointLight[] = [];
  private filmData: Map<number, FilmData> = new Map();

  // GPU instancing for cassettes
  private cassetteInstanceGroup: InstancedMeshGroup | null = null;

  // Rendering passes
  private gBuffer!: GBuffer;
  private shadowPass!: ShadowPass;
  private ssaoPass!: SSAOPass;
  private bloomPass!: BloomPass;
  private toneMappingPass!: ToneMappingPass;
  private fxaaPass!: FXAAPass;

  // Shadow map for ceiling lights
  private ceilingShadowMap: ShadowMapResult | null = null;
  private ceilingShadowLight: ShadowLight = {
    position: [0, 6, 0],
    target: [0, 0, 0],
    near: 0.1,
    far: 15,
    orthoSize: 10,
  };

  // G-Buffer pipeline
  private gbufferPipeline!: GPURenderPipeline;
  private cameraUniformBuffer!: GPUBuffer;
  private cameraBindGroup!: GPUBindGroup;
  private cameraBindGroupLayout!: GPUBindGroupLayout;
  private modelBindGroupLayout!: GPUBindGroupLayout;
  private materialBindGroupLayout!: GPUBindGroupLayout;

  // Lighting pipeline
  private lightingPipeline!: GPURenderPipeline;
  private lightingPipelineWithShadows!: GPURenderPipeline;
  private lightingUniformBuffer!: GPUBuffer;
  private pointLightsBuffer!: GPUBuffer;
  private lightingBindGroup!: GPUBindGroup;
  private shadowBindGroup: GPUBindGroup | null = null;

  // HDR render target for lighting output
  private hdrTexture!: GPUTexture;
  private hdrTextureView!: GPUTextureView;

  // FXAA intermediate texture (reused each frame)
  private fxaaIntermediateTexture: GPUTexture | null = null;
  private fxaaIntermediateView: GPUTextureView | null = null;

  // Shadow render uniform buffers pool (reused each frame)
  private shadowUniformBufferPool: GPUBuffer[] = [];
  private shadowUniformBufferIndex = 0;

  // Interaction
  hoveredCassette: number | null = null;

  // Performance monitoring
  private initStartTime = 0;
  private resourceStats = {
    textures: 0,
    buffers: 0,
    pipelines: 0,
    bindGroups: 0,
  };

  // Initialization state
  private isInitialized = false;
  private initError: Error | null = null;

  constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
    config?: Partial<PBRRenderConfig>
  ) {
    this.initStartTime = performance.now();
    console.log('[PBR] ========== INITIALIZATION START ==========');
    console.log('[PBR] Canvas dimensions:', context.canvas.width, 'x', context.canvas.height);
    console.log('[PBR] Format:', format);
    console.log('[PBR] Config:', JSON.stringify(config || 'default'));

    this.device = device;
    this._format = format;
    this.canvas = context.canvas as HTMLCanvasElement;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Validate canvas dimensions
    if (this.canvas.width <= 0 || this.canvas.height <= 0) {
      console.error('[PBR] CRITICAL: Invalid canvas dimensions!', this.canvas.width, this.canvas.height);
      throw new Error(`Invalid canvas dimensions: ${this.canvas.width}x${this.canvas.height}`);
    }

    this.camera = new Camera(this.canvas.width / this.canvas.height);
    this._textureLoader = new TextureLoader(device);

    try {
      // Initialize rendering passes
      this.initializeRenderingPasses();

      // Create pipelines
      this.createGBufferPipeline();
      this.createLightingPipeline();

      // Create HDR render target
      this.createHDRTarget();

      // Build the scene
      this.buildScene();
      this.setupLights();
      this.setupControls();

      // Create shadow map
      if (this.config.enableShadows) {
        this.createShadowMap();
      }

      // Load film data for cassettes
      this.loadFilmData();

      this.isInitialized = true;
      const initTime = performance.now() - this.initStartTime;
      console.log('[PBR] ========== INITIALIZATION COMPLETE ==========');
      console.log(`[PBR] Total init time: ${initTime.toFixed(2)}ms`);
      console.log('[PBR] Resource stats:', this.resourceStats);
    } catch (error) {
      this.initError = error as Error;
      console.error('[PBR] INITIALIZATION FAILED:', error);
      throw error;
    }
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  /**
   * Initialize all rendering passes
   */
  private initializeRenderingPasses(): void {
    const passStartTime = performance.now();
    let { width, height } = this.canvas;

    // Safeguard against invalid dimensions
    if (width <= 0 || height <= 0) {
      console.warn('[PBR] Invalid canvas dimensions, using defaults:', width, height);
      width = 800;
      height = 600;
    }
    console.log('[PBR] Initializing passes with dimensions:', width, 'x', height);

    // Calculate estimated memory usage
    const estimatedMemory = this.estimateMemoryUsage(width, height);
    console.log(`[PBR] Estimated GPU memory: ${(estimatedMemory / 1024 / 1024).toFixed(2)} MB`);

    // G-Buffer for deferred rendering
    let t0 = performance.now();
    console.log('[PBR] Creating GBuffer...');
    this.gBuffer = new GBuffer(this.device, width, height);
    this.resourceStats.textures += 5; // albedo, normal, material, emissive, depth
    console.log(`[PBR] GBuffer created in ${(performance.now() - t0).toFixed(2)}ms`);

    // Shadow mapping
    t0 = performance.now();
    console.log('[PBR] Creating ShadowPass...');
    this.shadowPass = new ShadowPass(this.device, {
      mapSize: this.config.shadowMapSize,
      bias: this.config.shadowBias,
      normalBias: this.config.shadowNormalBias,
    });
    this.resourceStats.pipelines += 1;
    this.resourceStats.buffers += 1;
    console.log(`[PBR] ShadowPass created in ${(performance.now() - t0).toFixed(2)}ms`);

    // SSAO - only create if enabled
    t0 = performance.now();
    console.log('[PBR] Creating SSAOPass...');
    this.ssaoPass = new SSAOPass(this.device, width, height, {
      radius: this.config.ssaoRadius,
      kernelSize: this.config.ssaoKernelSize,
      halfResolution: this.config.ssaoHalfResolution,
    });
    this.resourceStats.textures += 3; // ao, blurTemp, noise
    this.resourceStats.buffers += 4; // kernel, ssaoUniform, blurH, blurV
    this.resourceStats.pipelines += 2; // ssao, blur
    console.log(`[PBR] SSAOPass created in ${(performance.now() - t0).toFixed(2)}ms`);

    // Bloom - only create if enabled
    t0 = performance.now();
    console.log('[PBR] Creating BloomPass...');
    this.bloomPass = new BloomPass(this.device, width, height, {
      threshold: this.config.bloomThreshold,
      intensity: this.config.bloomIntensity,
      levels: this.config.bloomLevels,
    });
    this.resourceStats.textures += this.config.bloomLevels * 2 - 1;
    this.resourceStats.buffers += this.config.bloomLevels * 2 - 1;
    this.resourceStats.pipelines += 4; // threshold, downsample, upsample, upsampleFirst
    console.log(`[PBR] BloomPass created in ${(performance.now() - t0).toFixed(2)}ms`);

    // Tone mapping
    t0 = performance.now();
    console.log('[PBR] Creating ToneMappingPass...');
    this.toneMappingPass = new ToneMappingPass(this.device, width, height, {
      algorithm: this.config.toneMappingAlgorithm,
      exposure: this.config.exposure,
      vignetteStrength: this.config.vignetteStrength,
    });
    this.resourceStats.buffers += 1;
    this.resourceStats.pipelines += 2; // standard, withBloom
    console.log(`[PBR] ToneMappingPass created in ${(performance.now() - t0).toFixed(2)}ms`);

    // FXAA
    t0 = performance.now();
    console.log('[PBR] Creating FXAAPass...');
    this.fxaaPass = new FXAAPass(this.device, width, height, {
      enabled: this.config.fxaaEnabled,
      quality: this.config.fxaaQuality,
    });
    this.resourceStats.buffers += 1;
    this.resourceStats.pipelines += 2; // fxaa, passthrough
    console.log(`[PBR] FXAAPass created in ${(performance.now() - t0).toFixed(2)}ms`);

    // Create FXAA intermediate texture (reused each frame instead of creating new one)
    t0 = performance.now();
    console.log('[PBR] Creating FXAA intermediate texture...');
    this.fxaaIntermediateTexture = this.device.createTexture({
      label: 'FXAA Intermediate Texture',
      size: [width, height],
      format: 'bgra8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.fxaaIntermediateView = this.fxaaIntermediateTexture.createView();
    this.resourceStats.textures += 1;
    console.log(`[PBR] FXAA intermediate texture created in ${(performance.now() - t0).toFixed(2)}ms`);

    const totalTime = performance.now() - passStartTime;
    console.log(`[PBR] All passes initialized in ${totalTime.toFixed(2)}ms`);
  }

  /**
   * Estimate GPU memory usage
   */
  private estimateMemoryUsage(width: number, height: number): number {
    let total = 0;

    // GBuffer
    total += width * height * 4;  // albedo rgba8
    total += width * height * 8;  // normal rgba16float
    total += width * height * 4;  // material rgba8
    total += width * height * 8;  // emissive rgba16float
    total += width * height * 4;  // depth32float

    // HDR target
    total += width * height * 8;  // rgba16float

    // SSAO (half res)
    const ssaoW = Math.floor(width / 2);
    const ssaoH = Math.floor(height / 2);
    total += ssaoW * ssaoH * 2;  // ao + blur temp (r8)

    // Bloom (5 levels)
    for (let i = 0; i < 5; i++) {
      const w = Math.floor(width / Math.pow(2, i + 1));
      const h = Math.floor(height / Math.pow(2, i + 1));
      total += w * h * 8 * 2;  // down + up textures
    }

    // Shadow map
    total += this.config.shadowMapSize * this.config.shadowMapSize * 4;

    // FXAA intermediate
    total += width * height * 4;

    return total;
  }

  /**
   * Create the G-Buffer render pipeline
   */
  private createGBufferPipeline(): void {
    const t0 = performance.now();
    console.log('[PBR] Creating G-Buffer pipeline...');

    // Camera uniforms bind group layout
    this.cameraBindGroupLayout = this.device.createBindGroupLayout({
      label: 'Camera Bind Group Layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    });

    // Model uniforms bind group layout
    this.modelBindGroupLayout = this.device.createBindGroupLayout({
      label: 'Model Bind Group Layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'uniform' },
        },
      ],
    });

    // Material bind group layout
    this.materialBindGroupLayout = this.device.createBindGroupLayout({
      label: 'Material Bind Group Layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    });

    // Create camera uniform buffer
    // Layout: mat4 viewProj (64) + mat4 view (64) + mat4 proj (64) + vec3 camPos (12) + padding (4) = 208 bytes
    this.cameraUniformBuffer = this.device.createBuffer({
      label: 'Camera Uniform Buffer',
      size: 208,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.cameraBindGroup = this.device.createBindGroup({
      label: 'Camera Bind Group',
      layout: this.cameraBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.cameraUniformBuffer } },
      ],
    });

    // Create G-Buffer shader module
    const gbufferModule = this.device.createShaderModule({
      label: 'G-Buffer Shader',
      code: gbufferShaderSource,
    });

    // Create G-Buffer pipeline
    this.gbufferPipeline = this.device.createRenderPipeline({
      label: 'G-Buffer Pipeline',
      layout: this.device.createPipelineLayout({
        label: 'G-Buffer Pipeline Layout',
        bindGroupLayouts: [
          this.cameraBindGroupLayout,
          this.modelBindGroupLayout,
          this.materialBindGroupLayout,
        ],
      }),
      vertex: {
        module: gbufferModule,
        entryPoint: 'vertexMain',
        buffers: [
          {
            arrayStride: 32, // position (12) + uv (8) + normal (12)
            stepMode: 'vertex',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },  // position
              { shaderLocation: 1, offset: 12, format: 'float32x2' }, // uv
              { shaderLocation: 2, offset: 20, format: 'float32x3' }, // normal
            ],
          },
        ],
      },
      fragment: {
        module: gbufferModule,
        entryPoint: 'fragmentMain',
        targets: [
          { format: 'rgba8unorm' },    // Albedo
          { format: 'rgba16float' },   // Normal
          { format: 'rgba8unorm' },    // Material
          { format: 'rgba16float' },   // Emissive
        ],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'back',
      },
      depthStencil: {
        format: 'depth32float',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    this.resourceStats.pipelines += 1;
    this.resourceStats.buffers += 1; // camera uniform
    console.log(`[PBR] G-Buffer pipeline created in ${(performance.now() - t0).toFixed(2)}ms`);
  }

  /**
   * Create the PBR lighting pipeline
   */
  private createLightingPipeline(): void {
    const t0 = performance.now();
    console.log('[PBR] Creating Lighting pipeline...');
    // Lighting uniforms buffer
    // Layout matches LightingUniforms struct in pbr-lighting.wgsl
    // cameraPosition (12) + padding (4) + invViewProj (64) + directional (32) + ambient (32) + numPointLights (4) + padding (12) = 160 bytes
    this.lightingUniformBuffer = this.device.createBuffer({
      label: 'Lighting Uniform Buffer',
      size: 256, // Padded for alignment
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Point lights storage buffer (max 32 lights for neon-heavy scenes)
    // Each light: position (12) + radius (4) + color (12) + intensity (4) = 32 bytes
    this.pointLightsBuffer = this.device.createBuffer({
      label: 'Point Lights Buffer',
      size: 32 * 32, // Max 32 lights
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Create lighting bind group
    const lightingBindGroupLayout = this.device.createBindGroupLayout({
      label: 'Lighting Bind Group Layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ],
    });

    this.lightingBindGroup = this.device.createBindGroup({
      label: 'Lighting Bind Group',
      layout: lightingBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.lightingUniformBuffer } },
        { binding: 1, resource: { buffer: this.pointLightsBuffer } },
      ],
    });

    // Create PBR lighting shader module
    const lightingModule = this.device.createShaderModule({
      label: 'PBR Lighting Shader',
      code: pbrLightingShaderSource,
    });

    // Create lighting pipeline (without shadows)
    this.lightingPipeline = this.device.createRenderPipeline({
      label: 'PBR Lighting Pipeline',
      layout: this.device.createPipelineLayout({
        label: 'Lighting Pipeline Layout',
        bindGroupLayouts: [
          this.gBuffer.getReadBindGroupLayout(),
          lightingBindGroupLayout,
        ],
      }),
      vertex: {
        module: lightingModule,
        entryPoint: 'vertexMain',
      },
      fragment: {
        module: lightingModule,
        entryPoint: 'fragmentMain',
        targets: [{ format: 'rgba16float' }], // HDR output
      },
      primitive: {
        topology: 'triangle-list',
      },
    });

    // Shadow pipeline with shadows is not implemented yet
    // (fragmentMainWithShadows entry point doesn't exist in the shader)
    // For now, just use the same pipeline without shadows
    this.lightingPipelineWithShadows = this.lightingPipeline;

    this.resourceStats.pipelines += 1;
    this.resourceStats.buffers += 2; // lighting uniform + point lights
    console.log(`[PBR] Lighting pipeline created in ${(performance.now() - t0).toFixed(2)}ms`);
  }

  /**
   * Create HDR render target for lighting output
   */
  private createHDRTarget(): void {
    console.log('[PBR] Creating HDR render target...');
    this.hdrTexture = this.device.createTexture({
      label: 'HDR Render Target',
      size: [this.canvas.width, this.canvas.height],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.hdrTextureView = this.hdrTexture.createView();
    this.resourceStats.textures += 1;
    console.log('[PBR] HDR render target created');
  }

  /**
   * Create shadow map for ceiling lights
   */
  private createShadowMap(): void {
    console.log('[PBR] Creating shadow map...');
    this.ceilingShadowMap = this.shadowPass.createShadowMap(this.ceilingShadowLight);

    // Create shadow bind group for lighting pass
    this.shadowBindGroup = this.shadowPass.createShadowBindGroup(
      this.ceilingShadowMap.view,
      this.ceilingShadowMap.viewProjection
    );
    this.resourceStats.textures += 1;
    console.log(`[PBR] Shadow map created (${this.config.shadowMapSize}x${this.config.shadowMapSize})`);
  }

  // ==========================================================================
  // Scene Building
  // ==========================================================================

  /**
   * Add a PBR object to the scene
   */
  private addPBRObject(
    mesh: Mesh,
    position: vec3,
    material: PBRMaterial,
    scale: vec3 = vec3.fromValues(1, 1, 1),
    rotation?: { axis: vec3; angle: number }
  ): PBRSceneObject {
    // Create vertex and index buffers
    const vertexBuffer = this.device.createBuffer({
      size: mesh.vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(vertexBuffer, 0, mesh.vertices as unknown as ArrayBuffer);

    const indexBuffer = this.device.createBuffer({
      size: mesh.indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(indexBuffer, 0, mesh.indices as unknown as ArrayBuffer);

    // Create model matrix
    const modelMatrix = mat4.create();
    mat4.translate(modelMatrix, modelMatrix, position);
    if (rotation) {
      mat4.rotate(modelMatrix, modelMatrix, rotation.angle, rotation.axis);
    }
    mat4.scale(modelMatrix, modelMatrix, scale);

    // Create normal matrix (transpose of inverse of model matrix)
    const normalMatrix = mat4.create();
    mat4.invert(normalMatrix, modelMatrix);
    mat4.transpose(normalMatrix, normalMatrix);

    // Create model uniform buffer
    // Layout: mat4 model (64) + mat4 normalMatrix (64) = 128 bytes
    const modelBuffer = this.device.createBuffer({
      label: `Model Buffer - ${material.name}`,
      size: 128,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const modelData = new Float32Array(32);
    modelData.set(modelMatrix as Float32Array, 0);
    modelData.set(normalMatrix as Float32Array, 16);
    this.device.queue.writeBuffer(modelBuffer, 0, modelData);

    const modelBindGroup = this.device.createBindGroup({
      layout: this.modelBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: modelBuffer } },
      ],
    });

    // Create material uniform buffer
    const materialBuffer = this.device.createBuffer({
      label: `Material Buffer - ${material.name}`,
      size: 64, // 16 floats * 4 bytes (padded for WebGPU alignment)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(materialBuffer, 0, packMaterial(material) as unknown as ArrayBuffer);

    const materialBindGroup = this.device.createBindGroup({
      layout: this.materialBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: materialBuffer } },
      ],
    });

    const obj: PBRSceneObject = {
      mesh,
      vertexBuffer,
      indexBuffer,
      modelMatrix,
      normalMatrix,
      material,
      materialBuffer,
      materialBindGroup,
      modelBuffer,
      modelBindGroup,
    };

    this.objects.push(obj);
    return obj;
  }

  /**
   * Build the complete scene geometry
   */
  private buildScene(): void {
    const t0 = performance.now();
    console.log('[PBR] Building scene geometry...');

    // Room dimensions: 10m x 15m (half of original)
    // -------------------------------------------------------------------------
    // Floor - Black/white checkered
    // -------------------------------------------------------------------------
    const floor = createPlane(10, 15, 5, 7);
    this.addPBRObject(floor, vec3.fromValues(0, 0, 0), {
      ...Materials.TILE_FLOOR,
      albedo: [0.15, 0.15, 0.15], // Dark tiles (checkered pattern in shader)
    });

    // -------------------------------------------------------------------------
    // Ceiling - Gray industrial
    // -------------------------------------------------------------------------
    const ceiling = createPlane(10, 15, 2, 3);
    this.addPBRObject(
      ceiling,
      vec3.fromValues(0, 3.5, 0),
      createMaterial('Ceiling', [0.4, 0.4, 0.42], { roughness: 0.9 }),
      vec3.fromValues(1, -1, 1) // Flip to face down
    );

    // -------------------------------------------------------------------------
    // Walls - White/off-white
    // -------------------------------------------------------------------------
    const wallMaterial = createMaterial('Wall', [0.92, 0.90, 0.88], { roughness: 0.85 });

    // Back wall
    const backWall = createVerticalPlane(10, 4);
    this.addPBRObject(backWall, vec3.fromValues(0, 1.75, -7.5), wallMaterial);

    // Left wall
    const leftWall = createVerticalPlane(15, 4);
    this.addPBRObject(
      leftWall,
      vec3.fromValues(-5, 1.75, 0),
      wallMaterial,
      vec3.fromValues(1, 1, 1),
      { axis: vec3.fromValues(0, 1, 0), angle: Math.PI / 2 }
    );

    // Right wall
    const rightWall = createVerticalPlane(15, 4);
    this.addPBRObject(
      rightWall,
      vec3.fromValues(5, 1.75, 0),
      wallMaterial,
      vec3.fromValues(1, 1, 1),
      { axis: vec3.fromValues(0, 1, 0), angle: -Math.PI / 2 }
    );

    // Front wall
    const frontWall = createVerticalPlane(10, 4);
    this.addPBRObject(
      frontWall,
      vec3.fromValues(0, 1.75, 7.5),
      wallMaterial,
      vec3.fromValues(1, 1, 1),
      { axis: vec3.fromValues(0, 1, 0), angle: Math.PI }
    );

    // -------------------------------------------------------------------------
    // Counter
    // -------------------------------------------------------------------------
    this.buildCounter();

    // -------------------------------------------------------------------------
    // Shelf structures (without cassettes - those will be instanced)
    // Scaled to 10x15m room - gondolas at +-1.4m from center
    // -------------------------------------------------------------------------
    this.buildShelfStructure(-1.4, 'left');
    this.buildShelfStructure(1.4, 'right');
    this.buildBackWallShelves();

    // -------------------------------------------------------------------------
    // Neon decorations
    // -------------------------------------------------------------------------
    this.buildNeonDecorations();

    // -------------------------------------------------------------------------
    // Ceiling lights
    // -------------------------------------------------------------------------
    this.buildCeilingLights();

    // -------------------------------------------------------------------------
    // Decorations
    // -------------------------------------------------------------------------
    this.buildDecorations();

    // -------------------------------------------------------------------------
    // Manager character
    // -------------------------------------------------------------------------
    this.buildManager();

    // Log scene build stats
    console.log(`[PBR] Scene built in ${(performance.now() - t0).toFixed(2)}ms`);
    console.log(`[PBR] Total objects: ${this.objects.length}`);
    this.resourceStats.buffers += this.objects.length * 4; // vertex, index, model, material per object
  }

  /**
   * Build the counter area
   */
  private buildCounter(): void {
    const woodMaterial = Materials.WOOD_VARNISHED;
    const darkPlastic = Materials.PLASTIC_DARK;

    // Counter body (scaled to 10x15m room)
    const counterBody = createBox(3, 1, 0.8);
    this.addPBRObject(counterBody, vec3.fromValues(0, 0.5, 6), woodMaterial);

    // Counter top
    const counterTop = createBox(3.2, 0.06, 0.9);
    this.addPBRObject(counterTop, vec3.fromValues(0, 1.03, 6), {
      ...woodMaterial,
      roughness: 0.25, // More polished top
    });

    // Cyan neon front panel
    const frontPanel = createBox(3, 0.04, 0.04);
    this.addPBRObject(frontPanel, vec3.fromValues(0, 0.5, 5.55), Materials.NEON_CYAN);

    // Cash register
    const registerBase = createBox(0.45, 0.15, 0.35);
    this.addPBRObject(registerBase, vec3.fromValues(-0.6, 1.1, 6), darkPlastic);

    const registerScreen = createBox(0.25, 0.08, 0.02);
    this.addPBRObject(
      registerScreen,
      vec3.fromValues(-0.6, 1.27, 5.82),
      createMaterial('Register Screen', [0.2, 0.6, 0.3], {
        emissive: [0.2, 0.6, 0.3],
        emissiveIntensity: 0.8,
      })
    );

    // Back shelf
    const backShelf = createBox(2.5, 2, 0.2);
    this.addPBRObject(backShelf, vec3.fromValues(0, 1.5, 7), woodMaterial);
  }

  /**
   * Build shelf structure (without cassettes)
   * Scaled to 10x15m room - central gondola 5m long
   */
  private buildShelfStructure(xOffset: number, side: 'left' | 'right'): void {
    const shelfMaterial = createMaterial('Shelf Metal', [0.1, 0.1, 0.12], {
      metallic: 0.7,
      roughness: 0.5,
    });

    // Central spine (5m long gondola)
    const spinePanel = createBox(0.04, 1.6, 5);
    this.addPBRObject(spinePanel, vec3.fromValues(xOffset, 0.8, -1), shelfMaterial);

    // Build shelves on both sides
    for (const shelfSide of ['inner', 'outer'] as const) {
      const isInner = shelfSide === 'inner';
      const direction = side === 'left' ? (isInner ? 1 : -1) : (isInner ? -1 : 1);
      const shelfX = xOffset + direction * 0.07;

      for (let level = 0; level < 6; level++) {
        const y = 0.15 + level * 0.23;

        // Shelf board
        const shelfMesh = createBox(0.10, 0.015, 5);
        this.addPBRObject(shelfMesh, vec3.fromValues(shelfX, y, -1), shelfMaterial);

        // Front lip
        const lipMesh = createBox(0.015, 0.04, 5);
        const lipX = shelfX + direction * 0.05;
        this.addPBRObject(lipMesh, vec3.fromValues(lipX, y + 0.02, -1), shelfMaterial);
      }
    }

    // Vertical support posts (3 posts over 5m)
    const postMesh = createBox(0.05, 1.6, 0.05);
    for (let i = 0; i < 3; i++) {
      const z = -3.5 + i * 2.5;
      this.addPBRObject(postMesh, vec3.fromValues(xOffset, 0.8, z), shelfMaterial);
    }

    // Top and bottom rails
    const railMesh = createBox(0.25, 0.05, 5);
    this.addPBRObject(railMesh, vec3.fromValues(xOffset, 1.58, -1), shelfMaterial);
    this.addPBRObject(railMesh, vec3.fromValues(xOffset, 0.03, -1), shelfMaterial);
  }

  /**
   * Build back wall shelf structure
   * Scaled to 10x15m room - back wall at z=-7.5
   */
  private buildBackWallShelves(): void {
    const shelfMaterial = createMaterial('Back Shelf Metal', [0.1, 0.1, 0.12], {
      metallic: 0.7,
      roughness: 0.5,
    });

    // Back panel (8.5m wide to fit 10m room)
    const backPanel = createBox(8.5, 1.6, 0.03);
    this.addPBRObject(backPanel, vec3.fromValues(0, 0.8, -7.15), shelfMaterial);

    // Shelf levels
    for (let level = 0; level < 6; level++) {
      const y = 0.15 + level * 0.23;

      const shelfMesh = createBox(8.5, 0.015, 0.10);
      this.addPBRObject(shelfMesh, vec3.fromValues(0, y, -7.05), shelfMaterial);

      const lipMesh = createBox(8.5, 0.04, 0.015);
      this.addPBRObject(lipMesh, vec3.fromValues(0, y + 0.02, -6.95), shelfMaterial);
    }

    // Vertical dividers (5 dividers)
    const dividerMesh = createBox(0.04, 1.6, 0.12);
    for (let i = 0; i < 5; i++) {
      const x = -4 + i * 2;
      this.addPBRObject(dividerMesh, vec3.fromValues(x, 0.8, -7.05), shelfMaterial);
    }

    // Top and bottom rails
    const railMesh = createBox(8.5, 0.05, 0.05);
    this.addPBRObject(railMesh, vec3.fromValues(0, 1.58, -7.1), shelfMaterial);
    this.addPBRObject(railMesh, vec3.fromValues(0, 0.03, -7.1), shelfMaterial);
  }

  /**
   * Build neon decorations
   * Scaled to 10x15m room
   */
  private buildNeonDecorations(): void {
    // Main sign neon frame (purple) - above back wall shelves
    const hBorder = createBox(4.5, 0.08, 0.04);
    this.addPBRObject(hBorder, vec3.fromValues(0, 3.2, -7.15), Materials.NEON_PURPLE);
    this.addPBRObject(hBorder, vec3.fromValues(0, 2.2, -7.15), Materials.NEON_PURPLE);

    const vBorder = createBox(0.08, 1.0, 0.04);
    this.addPBRObject(vBorder, vec3.fromValues(-2.25, 2.7, -7.15), Materials.NEON_PURPLE);
    this.addPBRObject(vBorder, vec3.fromValues(2.25, 2.7, -7.15), Materials.NEON_PURPLE);

    // Shelf accent strips (purple) - along ceiling
    const stripMesh = createBox(0.04, 0.04, 6);
    this.addPBRObject(stripMesh, vec3.fromValues(-1.5, 3.35, 0), Materials.NEON_PURPLE);
    this.addPBRObject(stripMesh, vec3.fromValues(1.5, 3.35, 0), Materials.NEON_PURPLE);

    // Floor strips (full room length)
    const floorStrip = createBox(0.03, 0.03, 12);
    this.addPBRObject(floorStrip, vec3.fromValues(-1.2, 0.02, 0), Materials.NEON_PINK);
    this.addPBRObject(floorStrip, vec3.fromValues(1.2, 0.02, 0), Materials.NEON_CYAN);

    // Corner neons
    const cornerNeon = createBox(0.05, 3.5, 0.05);
    this.addPBRObject(cornerNeon, vec3.fromValues(-4.9, 1.75, -7.4), Materials.NEON_PINK);
    this.addPBRObject(cornerNeon, vec3.fromValues(4.9, 1.75, -7.4), Materials.NEON_CYAN);
  }

  /**
   * Build ceiling light fixtures
   * Scaled to 10x15m room
   */
  private buildCeilingLights(): void {
    const fixtureMaterial = createMaterial('Light Fixture', [0.15, 0.15, 0.15], {
      metallic: 0.6,
      roughness: 0.4,
    });

    const lightTubeMaterial = createMaterial('Light Tube', [0.95, 0.98, 1.0], {
      emissive: [1.0, 0.98, 0.95],
      emissiveIntensity: 2.5,
    });

    const lightTube = createBox(0.08, 0.04, 1.5);
    const lightFixture = createBox(0.2, 0.06, 1.7);

    // Main row of lights (center, from z=-6 to z=5)
    for (let z = -6; z <= 5; z += 2.5) {
      this.addPBRObject(lightFixture, vec3.fromValues(0, 3.42, z), fixtureMaterial);
      this.addPBRObject(lightTube, vec3.fromValues(0, 3.38, z), lightTubeMaterial);
    }

    // Side rows
    for (let z = -5; z <= 4; z += 3) {
      this.addPBRObject(lightFixture, vec3.fromValues(-1.5, 3.42, z), fixtureMaterial);
      this.addPBRObject(lightTube, vec3.fromValues(-1.5, 3.38, z), {
        ...lightTubeMaterial,
        emissiveIntensity: 1.5,
      });
      this.addPBRObject(lightFixture, vec3.fromValues(1.5, 3.42, z), fixtureMaterial);
      this.addPBRObject(lightTube, vec3.fromValues(1.5, 3.38, z), {
        ...lightTubeMaterial,
        emissiveIntensity: 1.5,
      });
    }
  }

  /**
   * Build decorative elements
   * Scaled to 10x15m room
   */
  private buildDecorations(): void {
    // Plant
    const potMaterial = createMaterial('Pot', [0.4, 0.25, 0.15], { roughness: 0.8 });
    const plantMaterial = createMaterial('Plant', [0.1, 0.4, 0.15], { roughness: 0.9 });

    const potMesh = createBox(0.25, 0.3, 0.25);
    this.addPBRObject(potMesh, vec3.fromValues(1.2, 0.15, 5.5), potMaterial);

    const plantMesh = createBox(0.4, 0.5, 0.4);
    this.addPBRObject(plantMesh, vec3.fromValues(1.2, 0.55, 5.5), plantMaterial);

    // Trash bin
    const trashMesh = createBox(0.3, 0.5, 0.3);
    this.addPBRObject(trashMesh, vec3.fromValues(-1.2, 0.25, 5.5), Materials.PLASTIC_DARK);

    // Return box
    const returnBoxMesh = createBox(0.5, 0.2, 0.3);
    this.addPBRObject(
      returnBoxMesh,
      vec3.fromValues(0.6, 1.12, 5.8),
      createMaterial('Return Box', [0.5, 0.1, 0.1], { roughness: 0.6 })
    );

    // Floor mat (at entrance)
    const matMesh = createPlane(1.5, 1, 1, 1);
    this.addPBRObject(
      matMesh,
      vec3.fromValues(0, 0.01, 6.8),
      createMaterial('Floor Mat', [0.25, 0.1, 0.1], { roughness: 0.95 })
    );

    // Queue posts (in front of counter)
    const postMaterial = createMaterial('Queue Post', [0.6, 0.5, 0.1], {
      metallic: 0.8,
      roughness: 0.3,
    });

    const postMesh = createBox(0.08, 0.9, 0.08);
    this.addPBRObject(postMesh, vec3.fromValues(-0.8, 0.45, 4.5), postMaterial);
    this.addPBRObject(postMesh, vec3.fromValues(0.8, 0.45, 4.5), postMaterial);

    const ropeMesh = createBox(1.5, 0.03, 0.03);
    this.addPBRObject(
      ropeMesh,
      vec3.fromValues(0, 0.7, 4.5),
      createMaterial('Queue Rope', [0.5, 0.1, 0.15], { roughness: 0.8 })
    );
  }

  /**
   * Build the manager character
   * Scaled to 10x15m room - behind counter at z=6.5
   */
  private buildManager(): void {
    const managerX = 0.5;
    const managerZ = 6.5; // Behind counter
    const scale = 1.0; // Normal human scale

    const skin = Materials.SKIN;
    const shirt = Materials.FABRIC_SHIRT;
    const denim = Materials.DENIM;
    const leather = Materials.LEATHER_SHOE;

    // Legs
    const legMesh = createBox(0.15 * scale, 0.45 * scale, 0.15 * scale);
    this.addPBRObject(legMesh, vec3.fromValues(managerX - 0.12 * scale, 0.22 * scale, managerZ), denim);
    this.addPBRObject(legMesh, vec3.fromValues(managerX + 0.12 * scale, 0.22 * scale, managerZ), denim);

    // Shoes
    const shoeMesh = createBox(0.16 * scale, 0.06 * scale, 0.22 * scale);
    this.addPBRObject(shoeMesh, vec3.fromValues(managerX - 0.12 * scale, 0.03 * scale, managerZ - 0.03 * scale), leather);
    this.addPBRObject(shoeMesh, vec3.fromValues(managerX + 0.12 * scale, 0.03 * scale, managerZ - 0.03 * scale), leather);

    // Belt
    const beltMaterial = createMaterial('Belt', [0.1, 0.08, 0.05], { roughness: 0.6 });
    const beltMesh = createBox(0.42 * scale, 0.05 * scale, 0.18 * scale);
    this.addPBRObject(beltMesh, vec3.fromValues(managerX, 0.47 * scale, managerZ), beltMaterial);

    // Torso
    const torsoMesh = createBox(0.45 * scale, 0.5 * scale, 0.22 * scale);
    this.addPBRObject(torsoMesh, vec3.fromValues(managerX, 0.75 * scale, managerZ), shirt);

    // Arms
    const upperArmMesh = createBox(0.12 * scale, 0.2 * scale, 0.12 * scale);
    this.addPBRObject(upperArmMesh, vec3.fromValues(managerX - 0.28 * scale, 0.88 * scale, managerZ), shirt);
    this.addPBRObject(upperArmMesh, vec3.fromValues(managerX + 0.28 * scale, 0.88 * scale, managerZ), shirt);

    const forearmMesh = createBox(0.1 * scale, 0.25 * scale, 0.1 * scale);
    this.addPBRObject(forearmMesh, vec3.fromValues(managerX - 0.28 * scale, 0.62 * scale, managerZ), skin);
    this.addPBRObject(forearmMesh, vec3.fromValues(managerX + 0.28 * scale, 0.62 * scale, managerZ), skin);

    // Hands
    const handMesh = createBox(0.1 * scale, 0.12 * scale, 0.06 * scale);
    this.addPBRObject(handMesh, vec3.fromValues(managerX - 0.28 * scale, 0.44 * scale, managerZ), skin);
    this.addPBRObject(handMesh, vec3.fromValues(managerX + 0.28 * scale, 0.44 * scale, managerZ), skin);

    // Head
    const headMesh = createBox(0.28 * scale, 0.3 * scale, 0.25 * scale);
    this.addPBRObject(headMesh, vec3.fromValues(managerX, 1.24 * scale, managerZ), skin);

    // Hair
    const hairMaterial = createMaterial('Hair', [0.12, 0.08, 0.04], { roughness: 0.9 });
    const topHairMesh = createBox(0.3 * scale, 0.1 * scale, 0.26 * scale);
    this.addPBRObject(topHairMesh, vec3.fromValues(managerX, 1.42 * scale, managerZ), hairMaterial);
  }

  // ==========================================================================
  // Lighting Setup
  // ==========================================================================

  /**
   * Setup scene lights
   * Scaled to 10x15m room
   */
  private setupLights(): void {
    // Pink neon strips (left side)
    this.addPointLight([-1.2, 0.1, -4], [1.0, 0.18, 0.58], 2.5, 5);
    this.addPointLight([-1.2, 0.1, 0], [1.0, 0.18, 0.58], 2.5, 5);
    this.addPointLight([-1.2, 0.1, 4], [1.0, 0.18, 0.58], 2.5, 5);

    // Cyan neon strips (right side)
    this.addPointLight([1.2, 0.1, -4], [0.0, 1.0, 0.97], 2.5, 5);
    this.addPointLight([1.2, 0.1, 0], [0.0, 1.0, 0.97], 2.5, 5);
    this.addPointLight([1.2, 0.1, 4], [0.0, 1.0, 0.97], 2.5, 5);

    // Ceiling lights (warm white) - scaled positions
    for (let z = -6; z <= 5; z += 2.5) {
      this.addPointLight([0, 3.3, z], [1.0, 0.95, 0.85], 3.0, 5);
    }

    // Corner neons
    this.addPointLight([-4.7, 1.75, -7.2], [1.0, 0.18, 0.58], 4.0, 6);
    this.addPointLight([4.7, 1.75, -7.2], [0.0, 1.0, 0.97], 4.0, 6);

    // Main sign backlight (purple)
    this.addPointLight([0, 2.7, -7], [0.69, 0.15, 1.0], 5.0, 8);
  }

  /**
   * Add a point light to the scene
   */
  private addPointLight(
    position: [number, number, number],
    color: [number, number, number],
    intensity: number,
    radius: number
  ): void {
    this.pointLights.push({ position, color, intensity, radius });
  }

  // ==========================================================================
  // Film Data Loading
  // ==========================================================================

  /**
   * Load film data from TMDB API
   */
  private async loadFilmData(): Promise<void> {
    const API_KEY = import.meta.env.VITE_TMDB_API_KEY;
    if (!API_KEY) return;

    const filmIds = [550, 238, 78, 603, 680, 694, 348, 1091, 105, 562, 280, 115, 620, 62, 985, 185, 111, 103, 769, 578];

    for (const id of filmIds) {
      try {
        const res = await fetch(`https://api.themoviedb.org/3/movie/${id}?api_key=${API_KEY}&language=fr-FR`);
        if (res.ok) {
          const data = await res.json();
          this.filmData.set(id, {
            id: data.id,
            title: data.title,
            poster_path: data.poster_path,
          });
        }
      } catch (e) {
        console.warn(`Failed to load film ${id}`, e);
      }
    }

    // Build instanced cassettes after loading film data
    await this.buildInstancedCassettes();
  }

  /**
   * Build cassettes using GPU instancing
   * Scaled to 10x15m room - central gondola 5m long, back wall 8.5m wide
   */
  private async buildInstancedCassettes(): Promise<void> {
    const cassetteMesh = createCassette();
    this.cassetteInstanceGroup = new InstancedMeshGroup(this.device, cassetteMesh, 2000);

    const filmIds = Array.from(this.filmData.keys());
    let filmIndex = 0;

    // Side shelves (gondola offset +-1.4 from center, 5m long)
    for (const shelfUnit of ['left', 'right'] as const) {
      const unitX = shelfUnit === 'left' ? -1.4 : 1.4;

      for (const shelfSide of ['inner', 'outer'] as const) {
        const isInner = shelfSide === 'inner';
        const direction = shelfUnit === 'left' ? (isInner ? 1 : -1) : (isInner ? -1 : 1);
        const xOffset = unitX + direction * 0.02;

        for (let level = 0; level < 6; level++) {
          const y = 0.18 + level * 0.23;

          // 25 cassettes per shelf (5m / 0.18m spacing)
          for (let i = 0; i < 25; i++) {
            const z = -3.5 + i * 0.18;
            const filmId = filmIds[filmIndex % filmIds.length];

            const transform = mat4.create();
            mat4.translate(transform, transform, vec3.fromValues(xOffset, y + 0.114, z));

            if (direction > 0) {
              mat4.rotateY(transform, transform, Math.PI / 2);
            } else {
              mat4.rotateY(transform, transform, -Math.PI / 2);
            }

            this.cassetteInstanceGroup.addInstance(transform, filmIndex % 20, filmId);
            filmIndex++;
          }
        }
      }
    }

    // Back wall cassettes (8.5m wide)
    for (let level = 0; level < 6; level++) {
      const y = 0.18 + level * 0.23;

      // 45 cassettes per level (8m / 0.18m spacing)
      for (let i = 0; i < 45; i++) {
        const x = -4.0 + i * 0.18;
        const filmId = filmIds[filmIndex % filmIds.length];

        const transform = mat4.create();
        mat4.translate(transform, transform, vec3.fromValues(x, y + 0.114, -6.8));

        this.cassetteInstanceGroup.addInstance(transform, filmIndex % 20, filmId);
        filmIndex++;
      }
    }
  }

  // ==========================================================================
  // Controls
  // ==========================================================================

  /**
   * Setup input controls
   */
  private setupControls(): void {
    this.canvas.addEventListener('click', () => {
      this.canvas.requestPointerLock();
    });

    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === this.canvas) {
        this.camera.onMouseMove(e.movementX, e.movementY);
      }
    });

    const keys: Record<string, boolean> = {};
    document.addEventListener('keydown', (e) => { keys[e.key.toLowerCase()] = true; });
    document.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

    const moveSpeed = 0.08;
    const updateMovement = () => {
      if (keys['w'] || keys['arrowup']) this.camera.moveForward(moveSpeed);
      if (keys['s'] || keys['arrowdown']) this.camera.moveForward(-moveSpeed);
      if (keys['a'] || keys['arrowleft']) this.camera.moveRight(-moveSpeed);
      if (keys['d'] || keys['arrowright']) this.camera.moveRight(moveSpeed);
      requestAnimationFrame(updateMovement);
    };
    updateMovement();
  }

  // ==========================================================================
  // Resize
  // ==========================================================================

  /**
   * Handle canvas resize
   */
  resize(width: number, height: number): void {
    console.log(`[PBR] Resize to ${width}x${height}`);

    if (width <= 0 || height <= 0) {
      console.error('[PBR] Invalid resize dimensions:', width, height);
      return;
    }

    this.camera.setAspect(width / height);

    // Resize all rendering passes
    this.gBuffer.resize(width, height);
    this.ssaoPass.resize(width, height);
    this.bloomPass.resize(width, height);
    this.toneMappingPass.resize(width, height);
    this.fxaaPass.resize(width, height);

    // Recreate HDR target
    this.hdrTexture.destroy();
    this.createHDRTarget();

    // Recreate FXAA intermediate texture
    if (this.fxaaIntermediateTexture) {
      this.fxaaIntermediateTexture.destroy();
    }
    this.fxaaIntermediateTexture = this.device.createTexture({
      label: 'FXAA Intermediate Texture (resized)',
      size: [width, height],
      format: 'bgra8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.fxaaIntermediateView = this.fxaaIntermediateTexture.createView();

    console.log('[PBR] Resize complete');
  }

  // ==========================================================================
  // Update Uniforms
  // ==========================================================================

  /**
   * Update camera uniforms
   */
  private updateCameraUniforms(): void {
    const data = new Float32Array(52); // 208 bytes

    // viewProjection matrix
    data.set(this.camera.getViewProjectionMatrix(), 0);

    // view matrix
    data.set(this.camera.getViewMatrix(), 16);

    // projection matrix
    data.set(this.camera.getProjectionMatrix(), 32);

    // camera position
    const camPos = this.camera.getPosition();
    data[48] = camPos[0];
    data[49] = camPos[1];
    data[50] = camPos[2];
    data[51] = 0; // padding

    this.device.queue.writeBuffer(this.cameraUniformBuffer, 0, data);
  }

  /**
   * Update lighting uniforms
   */
  private updateLightingUniforms(): void {
    const data = new Float32Array(64); // 256 bytes

    // Camera position
    const camPos = this.camera.getPosition();
    data[0] = camPos[0];
    data[1] = camPos[1];
    data[2] = camPos[2];
    data[3] = 0; // padding

    // Inverse view-projection matrix
    const invViewProj = mat4.create();
    mat4.invert(invViewProj, this.camera.getViewProjectionMatrix() as mat4);
    data.set(invViewProj as Float32Array, 4);

    // Directional light (subtle, main light comes from ceiling)
    data[20] = 0.2;  // direction x
    data[21] = 0.8;  // direction y
    data[22] = 0.3;  // direction z
    data[23] = 0;    // padding
    data[24] = 0.9;  // color r
    data[25] = 0.85; // color g
    data[26] = 0.8;  // color b
    data[27] = 0.1;  // intensity (low - ambient light)

    // Ambient light
    data[28] = 0.02; // sky color r
    data[29] = 0.02; // sky color g
    data[30] = 0.06; // sky color b
    data[31] = 0;    // padding
    data[32] = 0.01; // ground color r
    data[33] = 0.01; // ground color g
    data[34] = 0.02; // ground color b
    data[35] = 0.8;  // intensity

    // Number of point lights
    data[36] = this.pointLights.length;

    this.device.queue.writeBuffer(this.lightingUniformBuffer, 0, data);

    // Update point lights buffer
    const lightData = new Float32Array(this.pointLights.length * 8);
    for (let i = 0; i < this.pointLights.length; i++) {
      const light = this.pointLights[i];
      const offset = i * 8;

      lightData[offset] = light.position[0];
      lightData[offset + 1] = light.position[1];
      lightData[offset + 2] = light.position[2];
      lightData[offset + 3] = light.radius;
      lightData[offset + 4] = light.color[0];
      lightData[offset + 5] = light.color[1];
      lightData[offset + 6] = light.color[2];
      lightData[offset + 7] = light.intensity;
    }
    this.device.queue.writeBuffer(this.pointLightsBuffer, 0, lightData);
  }

  // ==========================================================================
  // Render
  // ==========================================================================

  private frameCount = 0;
  private lastFPSTime = 0;
  private fpsFrameCount = 0;
  private currentFPS = 0;
  private frameTimes: number[] = [];

  /**
   * Main render function - executes the full PBR pipeline
   */
  render(context: GPUCanvasContext): void {
    const frameStart = performance.now();

    // Check initialization
    if (!this.isInitialized) {
      console.error('[PBR] Scene not initialized, skipping render');
      return;
    }

    // Debug logging (first frame only)
    if (this.frameCount === 0) {
      console.log('[PBR] ========== FIRST FRAME RENDER ==========');
      console.log('[PBR] Objects count:', this.objects.length);
      console.log('[PBR] Point lights count:', this.pointLights.length);
      console.log('[PBR] Config:', JSON.stringify(this.config, null, 2));
      console.log('[PBR] Shadow buffer pool size:', this.shadowUniformBufferPool.length);
    }
    this.frameCount++;

    // FPS calculation
    this.fpsFrameCount++;
    const now = performance.now();
    if (now - this.lastFPSTime >= 1000) {
      this.currentFPS = this.fpsFrameCount;
      this.fpsFrameCount = 0;
      this.lastFPSTime = now;

      // Log FPS every second for first 10 seconds, then every 10 seconds
      if (this.frameCount < 600 || this.frameCount % 600 === 0) {
        const avgFrameTime = this.frameTimes.length > 0
          ? this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length
          : 0;
        console.log(`[PBR] FPS: ${this.currentFPS}, Avg frame time: ${avgFrameTime.toFixed(2)}ms`);
        this.frameTimes = [];
      }
    }

    // Update uniforms
    this.updateCameraUniforms();
    this.updateLightingUniforms();

    const commandEncoder = this.device.createCommandEncoder();

    // -------------------------------------------------------------------------
    // Pass 1: Shadow Pass (ceiling lights only)
    // -------------------------------------------------------------------------
    if (this.config.enableShadows && this.ceilingShadowMap) {
      this.renderShadowPass(commandEncoder);
    }

    // -------------------------------------------------------------------------
    // Pass 2: G-Buffer Pass (all geometry)
    // -------------------------------------------------------------------------
    if (this.frameCount === 1) console.log('[PBR] Rendering G-Buffer pass...');
    this.renderGBufferPass(commandEncoder);

    // -------------------------------------------------------------------------
    // Pass 3: SSAO Pass (half resolution)
    // -------------------------------------------------------------------------
    if (this.config.enableSSAO) {
      this.renderSSAOPass(commandEncoder);
    }

    // -------------------------------------------------------------------------
    // Pass 4: PBR Lighting Pass (deferred shading)
    // -------------------------------------------------------------------------
    if (this.frameCount === 1) console.log('[PBR] Rendering Lighting pass...');
    this.renderLightingPass(commandEncoder);

    // -------------------------------------------------------------------------
    // Pass 5: Bloom Pass
    // -------------------------------------------------------------------------
    if (this.config.enableBloom) {
      this.renderBloomPass(commandEncoder);
    }

    // -------------------------------------------------------------------------
    // Pass 6: Tone Mapping Pass
    // -------------------------------------------------------------------------
    if (this.frameCount === 1) console.log('[PBR] Rendering Tone Mapping pass...');
    const swapChainTexture = context.getCurrentTexture();
    const toneMappedView = this.renderToneMappingPass(commandEncoder, swapChainTexture);

    // -------------------------------------------------------------------------
    // Pass 7: FXAA Pass (final output to swapchain)
    // -------------------------------------------------------------------------
    if (this.config.fxaaEnabled) {
      this.renderFXAAPass(commandEncoder, toneMappedView, swapChainTexture);
    }

    // Submit all commands
    if (this.frameCount === 1) console.log('[PBR] Submitting commands...');
    this.device.queue.submit([commandEncoder.finish()]);

    // Track frame time
    const frameTime = performance.now() - frameStart;
    this.frameTimes.push(frameTime);
    if (this.frameTimes.length > 60) {
      this.frameTimes.shift();
    }

    // Log first frame completion
    if (this.frameCount === 1) {
      console.log(`[PBR] First frame complete in ${frameTime.toFixed(2)}ms`);
      console.log('[PBR] Shadow buffer pool size after first frame:', this.shadowUniformBufferPool.length);
    }

    // Warn if frame takes too long
    if (frameTime > 50 && this.frameCount > 1) {
      console.warn(`[PBR] Slow frame #${this.frameCount}: ${frameTime.toFixed(2)}ms`);
    }
  }

  /**
   * Get or create a shadow uniform buffer from the pool
   */
  private getShadowUniformBuffer(): GPUBuffer {
    if (this.shadowUniformBufferIndex >= this.shadowUniformBufferPool.length) {
      // Create new buffer if pool is exhausted
      const buffer = this.device.createBuffer({
        label: `Shadow Uniform Buffer ${this.shadowUniformBufferPool.length}`,
        size: 128, // mat4x4f (lightVP) + mat4x4f (model)
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.shadowUniformBufferPool.push(buffer);

      // Log pool growth (only occasionally to avoid spam)
      if (this.shadowUniformBufferPool.length % 50 === 0) {
        console.log(`[PBR] Shadow buffer pool grew to ${this.shadowUniformBufferPool.length}`);
      }
    }
    return this.shadowUniformBufferPool[this.shadowUniformBufferIndex++];
  }

  /**
   * Render shadow pass (with buffer pooling to prevent memory leak)
   */
  private renderShadowPass(commandEncoder: GPUCommandEncoder): void {
    if (!this.ceilingShadowMap) return;

    // Reset buffer pool index for this frame
    this.shadowUniformBufferIndex = 0;

    const passDescriptor = this.shadowPass.getRenderPassDescriptor(this.ceilingShadowMap.view);
    const pass = commandEncoder.beginRenderPass(passDescriptor);

    pass.setPipeline(this.shadowPass.getShadowPipeline());

    // Render all shadow-casting objects
    let shadowCasterCount = 0;
    for (const obj of this.objects) {
      // Skip emissive objects (they don't cast shadows)
      if (obj.material.emissiveIntensity > 0.5) continue;

      // Use pooled buffer instead of creating new one each frame
      const uniformBuffer = this.getShadowUniformBuffer();

      // Write light VP and model matrix
      this.device.queue.writeBuffer(uniformBuffer, 0, this.ceilingShadowMap!.viewProjection);
      this.device.queue.writeBuffer(uniformBuffer, 64, obj.modelMatrix as Float32Array);

      const bindGroup = this.device.createBindGroup({
        label: 'Shadow Render Bind Group (pooled)',
        layout: this.shadowPass.getShadowUniformsBindGroupLayout(),
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
        ],
      });

      pass.setBindGroup(0, bindGroup);
      pass.setVertexBuffer(0, obj.vertexBuffer);
      pass.setIndexBuffer(obj.indexBuffer, 'uint16');
      pass.drawIndexed(obj.mesh.indices.length);
      shadowCasterCount++;
    }

    pass.end();

    // Log on first frame only
    if (this.frameCount === 1) {
      console.log(`[PBR] Shadow pass rendered ${shadowCasterCount} objects`);
    }
  }

  /**
   * Render G-Buffer pass
   */
  private renderGBufferPass(commandEncoder: GPUCommandEncoder): void {
    const passDescriptor = this.gBuffer.getRenderPassDescriptor();
    const pass = commandEncoder.beginRenderPass(passDescriptor);

    pass.setPipeline(this.gbufferPipeline);
    pass.setBindGroup(0, this.cameraBindGroup);

    // Render all objects
    for (const obj of this.objects) {
      pass.setBindGroup(1, obj.modelBindGroup);
      pass.setBindGroup(2, obj.materialBindGroup);
      pass.setVertexBuffer(0, obj.vertexBuffer);
      pass.setIndexBuffer(obj.indexBuffer, 'uint16');
      pass.drawIndexed(obj.mesh.indices.length);
    }

    pass.end();
  }

  /**
   * Render SSAO pass
   */
  private renderSSAOPass(commandEncoder: GPUCommandEncoder): void {
    // Get projection matrices for SSAO
    const projMatrix = this.camera.getProjectionMatrix();
    const invProjMatrix = mat4.create();
    mat4.invert(invProjMatrix, projMatrix as mat4);

    // Create SSAO bind group
    const ssaoBindGroup = this.ssaoPass.createBindGroup(
      this.gBuffer.getNormalView(),
      this.gBuffer.getDepthView(),
      projMatrix,
      invProjMatrix as Float32Array
    );

    // SSAO pass
    const ssaoPassDescriptor = this.ssaoPass.getRenderPassDescriptor();
    const ssaoRenderPass = commandEncoder.beginRenderPass(ssaoPassDescriptor);
    ssaoRenderPass.setPipeline(this.ssaoPass.getSSAOPipeline());
    ssaoRenderPass.setBindGroup(0, ssaoBindGroup);
    ssaoRenderPass.draw(3); // Fullscreen triangle
    ssaoRenderPass.end();

    // Horizontal blur pass
    const hBlurBindGroup = this.ssaoPass.createHorizontalBlurBindGroup(this.gBuffer.getDepthView());
    const hBlurPassDescriptor = this.ssaoPass.getHorizontalBlurRenderPassDescriptor();
    const hBlurPass = commandEncoder.beginRenderPass(hBlurPassDescriptor);
    hBlurPass.setPipeline(this.ssaoPass.getBlurPipeline());
    hBlurPass.setBindGroup(0, hBlurBindGroup);
    hBlurPass.draw(3);
    hBlurPass.end();

    // Vertical blur pass
    const vBlurBindGroup = this.ssaoPass.createVerticalBlurBindGroup(this.gBuffer.getDepthView());
    const vBlurPassDescriptor = this.ssaoPass.getVerticalBlurRenderPassDescriptor();
    const vBlurPass = commandEncoder.beginRenderPass(vBlurPassDescriptor);
    vBlurPass.setPipeline(this.ssaoPass.getBlurPipeline());
    vBlurPass.setBindGroup(0, vBlurBindGroup);
    vBlurPass.draw(3);
    vBlurPass.end();
  }

  /**
   * Render PBR lighting pass
   */
  private renderLightingPass(commandEncoder: GPUCommandEncoder): void {
    const passDescriptor: GPURenderPassDescriptor = {
      label: 'Lighting Pass',
      colorAttachments: [{
        view: this.hdrTextureView,
        clearValue: { r: 0.02, g: 0.02, b: 0.05, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    };

    const pass = commandEncoder.beginRenderPass(passDescriptor);

    // Use shadow pipeline if shadows are enabled
    if (this.config.enableShadows && this.shadowBindGroup) {
      pass.setPipeline(this.lightingPipelineWithShadows);
      pass.setBindGroup(0, this.gBuffer.getReadBindGroup());
      pass.setBindGroup(1, this.lightingBindGroup);
      pass.setBindGroup(2, this.shadowBindGroup);
    } else {
      pass.setPipeline(this.lightingPipeline);
      pass.setBindGroup(0, this.gBuffer.getReadBindGroup());
      pass.setBindGroup(1, this.lightingBindGroup);
    }

    pass.draw(3); // Fullscreen triangle
    pass.end();
  }

  /**
   * Render bloom pass
   */
  private renderBloomPass(commandEncoder: GPUCommandEncoder): void {
    const levels = this.bloomPass.getLevels();

    // Threshold pass (extract bright pixels)
    const thresholdBindGroup = this.bloomPass.createThresholdBindGroup(this.hdrTextureView);
    const thresholdPassDescriptor = this.bloomPass.getThresholdPassDescriptor();
    const thresholdPass = commandEncoder.beginRenderPass(thresholdPassDescriptor);
    thresholdPass.setPipeline(this.bloomPass.getThresholdPipeline());
    thresholdPass.setBindGroup(0, thresholdBindGroup);
    thresholdPass.draw(3);
    thresholdPass.end();

    // Downsample chain
    for (let i = 1; i < levels; i++) {
      const sourceView = this.bloomPass.getDownsampleView(i - 1);
      const downsampleBindGroup = this.bloomPass.createDownsampleBindGroup(sourceView, i);
      const downsamplePassDescriptor = this.bloomPass.getDownsamplePassDescriptor(i);
      const downsamplePass = commandEncoder.beginRenderPass(downsamplePassDescriptor);
      downsamplePass.setPipeline(this.bloomPass.getDownsamplePipeline());
      downsamplePass.setBindGroup(0, downsampleBindGroup);
      downsamplePass.draw(3);
      downsamplePass.end();
    }

    // Upsample chain
    // First upsample (no previous level to blend with)
    const firstUpsampleBindGroup = this.bloomPass.createUpsampleFirstBindGroup(
      this.bloomPass.getDownsampleView(levels - 1),
      levels - 2
    );
    const firstUpsamplePassDescriptor = this.bloomPass.getUpsamplePassDescriptor(levels - 2);
    const firstUpsamplePass = commandEncoder.beginRenderPass(firstUpsamplePassDescriptor);
    firstUpsamplePass.setPipeline(this.bloomPass.getUpsampleFirstPipeline());
    firstUpsamplePass.setBindGroup(0, firstUpsampleBindGroup);
    firstUpsamplePass.draw(3);
    firstUpsamplePass.end();

    // Remaining upsample passes
    for (let i = levels - 3; i >= 0; i--) {
      const currentLevel = this.bloomPass.getDownsampleView(i + 1);
      const previousLevel = this.bloomPass.getUpsampleView(i + 1);
      const upsampleBindGroup = this.bloomPass.createUpsampleBindGroup(currentLevel, previousLevel, i);
      const upsamplePassDescriptor = this.bloomPass.getUpsamplePassDescriptor(i);
      const upsamplePass = commandEncoder.beginRenderPass(upsamplePassDescriptor);
      upsamplePass.setPipeline(this.bloomPass.getUpsamplePipeline());
      upsamplePass.setBindGroup(0, upsampleBindGroup);
      upsamplePass.draw(3);
      upsamplePass.end();
    }
  }

  /**
   * Render tone mapping pass
   */
  private renderToneMappingPass(commandEncoder: GPUCommandEncoder, swapChainTexture: GPUTexture): GPUTextureView {
    // If FXAA is enabled, render to reusable intermediate texture
    // Otherwise render directly to swap chain
    let outputView: GPUTextureView;

    if (this.config.fxaaEnabled) {
      // Use pre-allocated intermediate texture (NO memory leak!)
      if (!this.fxaaIntermediateView) {
        console.error('[PBR] FXAA intermediate texture not initialized!');
        outputView = swapChainTexture.createView();
      } else {
        outputView = this.fxaaIntermediateView;
      }
    } else {
      outputView = swapChainTexture.createView();
    }

    const passDescriptor = this.toneMappingPass.getRenderPassDescriptor(outputView);
    const pass = commandEncoder.beginRenderPass(passDescriptor);

    if (this.config.enableBloom) {
      pass.setPipeline(this.toneMappingPass.getPipelineWithBloom());
      const bindGroup = this.toneMappingPass.createBindGroupWithBloom(
        this.hdrTextureView,
        this.bloomPass.getBloomTextureView()
      );
      pass.setBindGroup(0, bindGroup);
    } else {
      pass.setPipeline(this.toneMappingPass.getPipeline());
      const bindGroup = this.toneMappingPass.createBindGroup(this.hdrTextureView);
      pass.setBindGroup(0, bindGroup);
    }

    pass.draw(3);
    pass.end();

    return outputView;
  }

  /**
   * Render FXAA pass
   */
  private renderFXAAPass(
    commandEncoder: GPUCommandEncoder,
    toneMappedView: GPUTextureView,
    swapChainTexture: GPUTexture
  ): void {
    const outputView = swapChainTexture.createView();
    const passDescriptor = this.fxaaPass.getRenderPassDescriptor(outputView);
    const pass = commandEncoder.beginRenderPass(passDescriptor);

    pass.setPipeline(this.fxaaPass.getPipeline());
    const bindGroup = this.fxaaPass.createBindGroup(toneMappedView);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Get the camera instance
   */
  getCamera(): Camera {
    return this.camera;
  }

  /**
   * Get current render configuration
   */
  getConfig(): PBRRenderConfig {
    return { ...this.config };
  }

  /**
   * Update render configuration
   */
  updateConfig(config: Partial<PBRRenderConfig>): void {
    this.config = { ...this.config, ...config };

    // Update passes with new configuration
    if (config.toneMappingAlgorithm || config.exposure || config.vignetteStrength) {
      this.toneMappingPass.updateConfig({
        algorithm: this.config.toneMappingAlgorithm,
        exposure: this.config.exposure,
        vignetteStrength: this.config.vignetteStrength,
      });
    }

    if (config.fxaaEnabled !== undefined || config.fxaaQuality) {
      this.fxaaPass.updateConfig({
        enabled: this.config.fxaaEnabled,
        quality: this.config.fxaaQuality,
      });
    }

    if (config.bloomThreshold || config.bloomIntensity) {
      this.bloomPass.setConfig({
        threshold: this.config.bloomThreshold,
        intensity: this.config.bloomIntensity,
      });
    }
  }

  /**
   * Apply a tone mapping preset
   */
  applyToneMappingPreset(presetName: keyof typeof ToneMappingPresets): void {
    this.toneMappingPass.applyPreset(presetName);
  }

  /**
   * Release all GPU resources
   */
  destroy(): void {
    console.log('[PBR] Destroying scene resources...');

    // Destroy rendering passes
    this.gBuffer.destroy();
    this.shadowPass.destroy();
    this.ssaoPass.destroy();
    this.bloomPass.destroy();
    this.toneMappingPass.destroy();
    this.fxaaPass.destroy();

    // Destroy shadow map
    if (this.ceilingShadowMap) {
      this.ceilingShadowMap.texture.destroy();
    }

    // Destroy HDR target
    this.hdrTexture.destroy();

    // Destroy FXAA intermediate texture
    if (this.fxaaIntermediateTexture) {
      this.fxaaIntermediateTexture.destroy();
    }

    // Destroy shadow uniform buffer pool
    for (const buffer of this.shadowUniformBufferPool) {
      buffer.destroy();
    }
    console.log(`[PBR] Destroyed ${this.shadowUniformBufferPool.length} shadow buffers`);

    // Destroy uniform buffers
    this.cameraUniformBuffer.destroy();
    this.lightingUniformBuffer.destroy();
    this.pointLightsBuffer.destroy();

    // Destroy object resources
    for (const obj of this.objects) {
      obj.vertexBuffer.destroy();
      obj.indexBuffer.destroy();
      obj.modelBuffer.destroy();
      obj.materialBuffer.destroy();
    }

    // Destroy instanced mesh group
    if (this.cassetteInstanceGroup) {
      this.cassetteInstanceGroup.destroy();
    }

    console.log('[PBR] Scene destroyed');
  }
}
