/**
 * G-Buffer for Deferred Rendering
 *
 * Manages multiple render targets (MRT) for the geometry pass:
 * - albedo: RGBA8Unorm - base color (RGB) + alpha (A)
 * - normal: RGBA16Float - world space normals (RGB) + unused (A)
 * - material: RGBA8Unorm - metallic (R), roughness (G), AO (B), flags (A)
 * - emissive: RGBA16Float - emissive color (RGB) + intensity (A)
 * - depth: Depth24Plus
 */
export class GBuffer {
  private device: GPUDevice;
  private width: number;
  private height: number;

  // G-Buffer textures
  private albedoTexture!: GPUTexture;
  private normalTexture!: GPUTexture;
  private materialTexture!: GPUTexture;
  private emissiveTexture!: GPUTexture;
  private depthTexture!: GPUTexture;

  // Texture views for render attachments
  private albedoView!: GPUTextureView;
  private normalView!: GPUTextureView;
  private materialView!: GPUTextureView;
  private emissiveView!: GPUTextureView;
  private depthView!: GPUTextureView;

  // Sampler for reading textures in lighting pass
  private sampler!: GPUSampler;

  // Cached bind group layout and bind group
  private readBindGroupLayout!: GPUBindGroupLayout;
  private readBindGroup!: GPUBindGroup;

  constructor(device: GPUDevice, width: number, height: number) {
    if (width <= 0 || height <= 0) {
      throw new Error(`GBuffer dimensions must be positive: ${width}x${height}`);
    }

    this.device = device;
    this.width = width;
    this.height = height;

    this.createSampler();
    this.createBindGroupLayout();
    this.createTextures();
    this.createBindGroup();
  }

  /**
   * Create nearest-neighbor sampler to avoid interpolation of normals
   */
  private createSampler(): void {
    this.sampler = this.device.createSampler({
      magFilter: 'nearest',
      minFilter: 'nearest',
      mipmapFilter: 'nearest',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
  }

  /**
   * Create bind group layout for reading G-Buffer textures in lighting pass
   */
  private createBindGroupLayout(): void {
    this.readBindGroupLayout = this.device.createBindGroupLayout({
      label: 'GBuffer Read Bind Group Layout',
      entries: [
        // Sampler
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'non-filtering' },
        },
        // Albedo texture
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d' },
        },
        // Normal texture
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d' },
        },
        // Material texture
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d' },
        },
        // Emissive texture
        {
          binding: 4,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d' },
        },
        // Depth texture
        {
          binding: 5,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'depth', viewDimension: '2d' },
        },
      ],
    });
  }

  /**
   * Create all G-Buffer textures
   */
  private createTextures(): void {
    // Albedo: RGBA8Unorm - 4 bytes/pixel
    this.albedoTexture = this.device.createTexture({
      label: 'GBuffer Albedo',
      size: [this.width, this.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.albedoView = this.albedoTexture.createView();

    // Normal: RGBA16Float - 8 bytes/pixel (precision needed for world space normals)
    this.normalTexture = this.device.createTexture({
      label: 'GBuffer Normal',
      size: [this.width, this.height],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.normalView = this.normalTexture.createView();

    // Material: RGBA8Unorm - 4 bytes/pixel
    // R: metallic, G: roughness, B: AO, A: flags
    this.materialTexture = this.device.createTexture({
      label: 'GBuffer Material',
      size: [this.width, this.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.materialView = this.materialTexture.createView();

    // Emissive: RGBA16Float - 8 bytes/pixel (HDR support)
    this.emissiveTexture = this.device.createTexture({
      label: 'GBuffer Emissive',
      size: [this.width, this.height],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.emissiveView = this.emissiveTexture.createView();

    // Depth: Depth32Float - supports TEXTURE_BINDING for SSAO and lighting pass
    this.depthTexture = this.device.createTexture({
      label: 'GBuffer Depth',
      size: [this.width, this.height],
      format: 'depth32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.depthView = this.depthTexture.createView();
  }

  /**
   * Create bind group for reading G-Buffer textures in lighting pass
   */
  private createBindGroup(): void {
    this.readBindGroup = this.device.createBindGroup({
      label: 'GBuffer Read Bind Group',
      layout: this.readBindGroupLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: this.albedoView },
        { binding: 2, resource: this.normalView },
        { binding: 3, resource: this.materialView },
        { binding: 4, resource: this.emissiveView },
        { binding: 5, resource: this.depthView },
      ],
    });
  }

  /**
   * Resize the G-Buffer textures
   * Destroys old textures and creates new ones with updated dimensions
   */
  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) {
      throw new Error(`GBuffer dimensions must be positive: ${width}x${height}`);
    }

    if (this.width === width && this.height === height) {
      return;
    }

    this.width = width;
    this.height = height;

    // Destroy old textures
    this.albedoTexture.destroy();
    this.normalTexture.destroy();
    this.materialTexture.destroy();
    this.emissiveTexture.destroy();
    this.depthTexture.destroy();

    // Create new textures with updated dimensions
    this.createTextures();
    this.createBindGroup();
  }

  /**
   * Get the bind group layout for reading G-Buffer textures
   */
  getReadBindGroupLayout(): GPUBindGroupLayout {
    return this.readBindGroupLayout;
  }

  /**
   * Get the bind group for reading G-Buffer textures in lighting pass
   */
  getReadBindGroup(): GPUBindGroup {
    return this.readBindGroup;
  }

  /**
   * Get render pass descriptor for writing to the G-Buffer (MRT)
   */
  getRenderPassDescriptor(): GPURenderPassDescriptor {
    return {
      label: 'GBuffer Render Pass',
      colorAttachments: [
        // Location 0: Albedo
        {
          view: this.albedoView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
        // Location 1: Normal
        {
          view: this.normalView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
        // Location 2: Material
        {
          view: this.materialView,
          clearValue: { r: 0, g: 0.5, b: 1, a: 0 }, // Default: no metallic, mid roughness, full AO
          loadOp: 'clear',
          storeOp: 'store',
        },
        // Location 3: Emissive
        {
          view: this.emissiveView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: this.depthView,
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    };
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
   * Get the depth texture view for external use (e.g., SSAO pass)
   */
  getDepthView(): GPUTextureView {
    return this.depthView;
  }

  /**
   * Get the normal texture view for external use (e.g., SSAO pass)
   */
  getNormalView(): GPUTextureView {
    return this.normalView;
  }

  /**
   * Release all GPU resources
   */
  destroy(): void {
    this.albedoTexture.destroy();
    this.normalTexture.destroy();
    this.materialTexture.destroy();
    this.emissiveTexture.destroy();
    this.depthTexture.destroy();
  }
}
