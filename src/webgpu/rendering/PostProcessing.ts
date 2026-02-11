/**
 * Post-Processing Pipeline for WebGPU
 * - Bloom (bright extraction + gaussian blur + composite)
 * - HDR Tone Mapping (ACES)
 * - Vignette
 * - Film Grain (VHS aesthetic)
 */

export class PostProcessing {
  private device: GPUDevice;
  private format: GPUTextureFormat;
  private width: number;
  private height: number;

  // Render targets
  private sceneTexture!: GPUTexture;
  private sceneTextureView!: GPUTextureView;
  private brightTexture!: GPUTexture;
  private brightTextureView!: GPUTextureView;
  private blurTextureA!: GPUTexture;
  private blurTextureViewA!: GPUTextureView;
  private blurTextureB!: GPUTexture;
  private blurTextureViewB!: GPUTextureView;

  // Samplers
  private linearSampler!: GPUSampler;

  // Pipelines
  private brightExtractPipeline!: GPURenderPipeline;
  private blurHorizontalPipeline!: GPURenderPipeline;
  private blurVerticalPipeline!: GPURenderPipeline;
  private compositePipeline!: GPURenderPipeline;

  // Bind group layouts
  private textureBindGroupLayout!: GPUBindGroupLayout;
  private compositeBindGroupLayout!: GPUBindGroupLayout;

  // Bind groups (recreated on resize)
  private brightExtractBindGroup!: GPUBindGroup;
  private blurHBindGroup!: GPUBindGroup;
  private blurVBindGroup!: GPUBindGroup;
  private compositeBindGroup!: GPUBindGroup;

  // Uniform buffer for settings
  private settingsBuffer!: GPUBuffer;

  // Fullscreen quad
  private quadVertexBuffer!: GPUBuffer;

  constructor(device: GPUDevice, format: GPUTextureFormat, width: number, height: number) {
    this.device = device;
    this.format = format;
    this.width = width;
    this.height = height;

    this.createSamplers();
    this.createFullscreenQuad();
    this.createSettingsBuffer();
    this.createBindGroupLayouts();
    this.createPipelines();
    this.createRenderTargets();
    this.createBindGroups();
  }

  private createSamplers() {
    this.linearSampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
  }

  private createFullscreenQuad() {
    // Fullscreen triangle (more efficient than quad)
    // Position (x, y), UV (u, v)
    // Note: WebGPU has (0,0) at top-left for textures
    const vertices = new Float32Array([
      -1, -1,  0, 1,  // bottom-left: uv (0, 1)
       3, -1,  2, 1,  // bottom-right extended: uv (2, 1)
      -1,  3,  0, -1, // top-left extended: uv (0, -1)
    ]);

    this.quadVertexBuffer = this.device.createBuffer({
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.quadVertexBuffer, 0, vertices);
  }

  private createSettingsBuffer() {
    // Settings: bloomThreshold, bloomIntensity, vignetteIntensity, grainIntensity, time, exposure, padding
    this.settingsBuffer = this.device.createBuffer({
      size: 32, // 8 floats
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Settings for scene with built-in tone mapping (output 0-1 range)
    this.updateSettings({
      bloomThreshold: 0.85,   // Only brightest pixels bloom
      bloomIntensity: 0.15,   // Subtle bloom
      vignetteIntensity: 0.2,
      grainIntensity: 0.008,  // Very subtle grain
      time: 0,
      exposure: 1.0,          // Pass-through (scene already tone-mapped)
    });
  }

  updateSettings(settings: {
    bloomThreshold?: number;
    bloomIntensity?: number;
    vignetteIntensity?: number;
    grainIntensity?: number;
    time?: number;
    exposure?: number;
  }) {
    const data = new Float32Array([
      settings.bloomThreshold ?? 0.85,
      settings.bloomIntensity ?? 0.15,
      settings.vignetteIntensity ?? 0.2,
      settings.grainIntensity ?? 0.008,
      settings.time ?? 0,
      settings.exposure ?? 1.0,
      0, 0, // padding
    ]);
    this.device.queue.writeBuffer(this.settingsBuffer, 0, data);
  }

  private createBindGroupLayouts() {
    // Single texture + sampler layout
    this.textureBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });

    // Composite: scene + bloom + settings
    this.compositeBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }, // scene
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }, // bloom
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
  }

  private createPipelines() {
    const vertexBufferLayout: GPUVertexBufferLayout = {
      arrayStride: 16,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x2' },  // position
        { shaderLocation: 1, offset: 8, format: 'float32x2' },  // uv
      ],
    };

    // === BRIGHT EXTRACT SHADER ===
    const brightExtractShader = this.device.createShaderModule({
      code: `
        struct VertexOutput {
          @builtin(position) position: vec4f,
          @location(0) uv: vec2f,
        }

        @vertex
        fn vertexMain(@location(0) pos: vec2f, @location(1) uv: vec2f) -> VertexOutput {
          var output: VertexOutput;
          output.position = vec4f(pos, 0.0, 1.0);
          output.uv = uv;
          return output;
        }

        struct Settings {
          bloomThreshold: f32,
          bloomIntensity: f32,
          vignetteIntensity: f32,
          grainIntensity: f32,
          time: f32,
          exposure: f32,
        }

        @group(0) @binding(0) var texSampler: sampler;
        @group(0) @binding(1) var sceneTexture: texture_2d<f32>;
        @group(0) @binding(2) var<uniform> settings: Settings;

        @fragment
        fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
          let color = textureSample(sceneTexture, texSampler, input.uv);

          // Apply same exposure as composite so threshold works correctly
          let exposedColor = color.rgb * settings.exposure;

          // Calculate luminance
          let luminance = dot(exposedColor, vec3f(0.2126, 0.7152, 0.0722));

          // Extract only bright areas above threshold (neons typically > 0.8)
          let brightness = max(0.0, luminance - settings.bloomThreshold);
          let softness = smoothstep(0.0, 0.5, brightness);

          return vec4f(exposedColor * softness, 1.0);
        }
      `,
    });

    this.brightExtractPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.textureBindGroupLayout] }),
      vertex: {
        module: brightExtractShader,
        entryPoint: 'vertexMain',
        buffers: [vertexBufferLayout],
      },
      fragment: {
        module: brightExtractShader,
        entryPoint: 'fragmentMain',
        targets: [{ format: 'rgba16float' }],
      },
      primitive: { topology: 'triangle-list' },
    });

    // === BLUR SHADERS (Gaussian) ===
    const blurHorizontalShader = this.device.createShaderModule({
      code: `
        struct VertexOutput {
          @builtin(position) position: vec4f,
          @location(0) uv: vec2f,
        }

        @vertex
        fn vertexMain(@location(0) pos: vec2f, @location(1) uv: vec2f) -> VertexOutput {
          var output: VertexOutput;
          output.position = vec4f(pos, 0.0, 1.0);
          output.uv = uv;
          return output;
        }

        struct Settings {
          bloomThreshold: f32,
          bloomIntensity: f32,
          vignetteIntensity: f32,
          grainIntensity: f32,
          time: f32,
          exposure: f32,
        }

        @group(0) @binding(0) var texSampler: sampler;
        @group(0) @binding(1) var inputTexture: texture_2d<f32>;
        @group(0) @binding(2) var<uniform> settings: Settings;

        // 9-tap Gaussian blur weights
        const weights = array<f32, 5>(0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);

        @fragment
        fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
          let texSize = vec2f(textureDimensions(inputTexture));
          let texelSize = 1.0 / texSize;

          var result = textureSample(inputTexture, texSampler, input.uv).rgb * weights[0];

          for (var i = 1; i < 5; i = i + 1) {
            let offset = vec2f(texelSize.x * f32(i) * 2.0, 0.0);
            result += textureSample(inputTexture, texSampler, input.uv + offset).rgb * weights[i];
            result += textureSample(inputTexture, texSampler, input.uv - offset).rgb * weights[i];
          }

          return vec4f(result, 1.0);
        }
      `,
    });

    this.blurHorizontalPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.textureBindGroupLayout] }),
      vertex: {
        module: blurHorizontalShader,
        entryPoint: 'vertexMain',
        buffers: [vertexBufferLayout],
      },
      fragment: {
        module: blurHorizontalShader,
        entryPoint: 'fragmentMain',
        targets: [{ format: 'rgba16float' }],
      },
      primitive: { topology: 'triangle-list' },
    });

    const blurVerticalShader = this.device.createShaderModule({
      code: `
        struct VertexOutput {
          @builtin(position) position: vec4f,
          @location(0) uv: vec2f,
        }

        @vertex
        fn vertexMain(@location(0) pos: vec2f, @location(1) uv: vec2f) -> VertexOutput {
          var output: VertexOutput;
          output.position = vec4f(pos, 0.0, 1.0);
          output.uv = uv;
          return output;
        }

        struct Settings {
          bloomThreshold: f32,
          bloomIntensity: f32,
          vignetteIntensity: f32,
          grainIntensity: f32,
          time: f32,
          exposure: f32,
        }

        @group(0) @binding(0) var texSampler: sampler;
        @group(0) @binding(1) var inputTexture: texture_2d<f32>;
        @group(0) @binding(2) var<uniform> settings: Settings;

        const weights = array<f32, 5>(0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);

        @fragment
        fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
          let texSize = vec2f(textureDimensions(inputTexture));
          let texelSize = 1.0 / texSize;

          var result = textureSample(inputTexture, texSampler, input.uv).rgb * weights[0];

          for (var i = 1; i < 5; i = i + 1) {
            let offset = vec2f(0.0, texelSize.y * f32(i) * 2.0);
            result += textureSample(inputTexture, texSampler, input.uv + offset).rgb * weights[i];
            result += textureSample(inputTexture, texSampler, input.uv - offset).rgb * weights[i];
          }

          return vec4f(result, 1.0);
        }
      `,
    });

    this.blurVerticalPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.textureBindGroupLayout] }),
      vertex: {
        module: blurVerticalShader,
        entryPoint: 'vertexMain',
        buffers: [vertexBufferLayout],
      },
      fragment: {
        module: blurVerticalShader,
        entryPoint: 'fragmentMain',
        targets: [{ format: 'rgba16float' }],
      },
      primitive: { topology: 'triangle-list' },
    });

    // === COMPOSITE SHADER (Bloom + Tone Mapping + Vignette + Grain) ===
    const compositeShader = this.device.createShaderModule({
      code: `
        struct VertexOutput {
          @builtin(position) position: vec4f,
          @location(0) uv: vec2f,
        }

        @vertex
        fn vertexMain(@location(0) pos: vec2f, @location(1) uv: vec2f) -> VertexOutput {
          var output: VertexOutput;
          output.position = vec4f(pos, 0.0, 1.0);
          output.uv = uv;
          return output;
        }

        struct Settings {
          bloomThreshold: f32,
          bloomIntensity: f32,
          vignetteIntensity: f32,
          grainIntensity: f32,
          time: f32,
          exposure: f32,
        }

        @group(0) @binding(0) var texSampler: sampler;
        @group(0) @binding(1) var sceneTexture: texture_2d<f32>;
        @group(0) @binding(2) var bloomTexture: texture_2d<f32>;
        @group(0) @binding(3) var<uniform> settings: Settings;

        // ACES Filmic Tone Mapping
        fn acesFilm(x: vec3f) -> vec3f {
          let a = 2.51;
          let b = 0.03;
          let c = 2.43;
          let d = 0.59;
          let e = 0.14;
          return saturate((x * (a * x + b)) / (x * (c * x + d) + e));
        }

        // Film grain noise
        fn hash(p: vec2f) -> f32 {
          return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
        }

        fn grain(uv: vec2f, time: f32) -> f32 {
          let noise = hash(uv * 1000.0 + vec2f(time * 100.0, time * 73.0));
          return (noise - 0.5) * 2.0;
        }

        // VHS scanlines
        fn scanlines(uv: vec2f, time: f32) -> f32 {
          let scanline = sin(uv.y * 800.0 + time * 10.0) * 0.04;
          let scanline2 = sin(uv.y * 200.0 - time * 5.0) * 0.02;
          return 1.0 - abs(scanline) - abs(scanline2);
        }

        @fragment
        fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
          // Clamp UV to valid range
          let uv = clamp(input.uv, vec2f(0.0), vec2f(1.0));

          // Sample scene and bloom
          var color = textureSample(sceneTexture, texSampler, uv).rgb;
          let bloom = textureSample(bloomTexture, texSampler, uv).rgb;

          // Add subtle bloom only (scene already has tone mapping + gamma)
          color = color + bloom * settings.bloomIntensity;

          // Vignette
          let vignetteUV = uv * (1.0 - uv);
          let vignette = saturate(vignetteUV.x * vignetteUV.y * 15.0);
          let vignetteAmount = saturate(pow(vignette, settings.vignetteIntensity));
          color = color * mix(0.5, 1.0, vignetteAmount);

          // Film grain (very subtle)
          let grainNoise = grain(uv, settings.time);
          color = color + vec3f(grainNoise * settings.grainIntensity);

          // Subtle scanlines for VHS effect
          let scanlineEffect = scanlines(uv, settings.time);
          color = color * (0.97 + scanlineEffect * 0.03);

          // No additional tone mapping or gamma - scene handles that
          return vec4f(color, 1.0);
        }
      `,
    });

    this.compositePipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.compositeBindGroupLayout] }),
      vertex: {
        module: compositeShader,
        entryPoint: 'vertexMain',
        buffers: [vertexBufferLayout],
      },
      fragment: {
        module: compositeShader,
        entryPoint: 'fragmentMain',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  private createRenderTargets() {
    // Scene render target (HDR)
    this.sceneTexture = this.device.createTexture({
      size: [this.width, this.height],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.sceneTextureView = this.sceneTexture.createView();

    // Bright extraction target (half resolution for performance)
    const halfWidth = Math.max(1, Math.floor(this.width / 2));
    const halfHeight = Math.max(1, Math.floor(this.height / 2));

    this.brightTexture = this.device.createTexture({
      size: [halfWidth, halfHeight],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.brightTextureView = this.brightTexture.createView();

    // Blur ping-pong textures
    this.blurTextureA = this.device.createTexture({
      size: [halfWidth, halfHeight],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.blurTextureViewA = this.blurTextureA.createView();

    this.blurTextureB = this.device.createTexture({
      size: [halfWidth, halfHeight],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.blurTextureViewB = this.blurTextureB.createView();
  }

  private createBindGroups() {
    // Bright extraction: reads scene texture
    this.brightExtractBindGroup = this.device.createBindGroup({
      layout: this.textureBindGroupLayout,
      entries: [
        { binding: 0, resource: this.linearSampler },
        { binding: 1, resource: this.sceneTextureView },
        { binding: 2, resource: { buffer: this.settingsBuffer } },
      ],
    });

    // Horizontal blur: reads bright texture
    this.blurHBindGroup = this.device.createBindGroup({
      layout: this.textureBindGroupLayout,
      entries: [
        { binding: 0, resource: this.linearSampler },
        { binding: 1, resource: this.brightTextureView },
        { binding: 2, resource: { buffer: this.settingsBuffer } },
      ],
    });

    // Vertical blur: reads blurA
    this.blurVBindGroup = this.device.createBindGroup({
      layout: this.textureBindGroupLayout,
      entries: [
        { binding: 0, resource: this.linearSampler },
        { binding: 1, resource: this.blurTextureViewA },
        { binding: 2, resource: { buffer: this.settingsBuffer } },
      ],
    });

    // Composite: reads scene + blurB (final bloom)
    this.compositeBindGroup = this.device.createBindGroup({
      layout: this.compositeBindGroupLayout,
      entries: [
        { binding: 0, resource: this.linearSampler },
        { binding: 1, resource: this.sceneTextureView },
        { binding: 2, resource: this.blurTextureViewB },
        { binding: 3, resource: { buffer: this.settingsBuffer } },
      ],
    });
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;

    // Destroy old textures
    this.sceneTexture.destroy();
    this.brightTexture.destroy();
    this.blurTextureA.destroy();
    this.blurTextureB.destroy();

    // Recreate
    this.createRenderTargets();
    this.createBindGroups();
  }

  getSceneTextureView(): GPUTextureView {
    return this.sceneTextureView;
  }

  getSceneTexture(): GPUTexture {
    return this.sceneTexture;
  }

  /**
   * Render post-processing effects
   * @param commandEncoder The command encoder
   * @param outputView The final output texture view (canvas)
   * @param time Current time in seconds
   */
  render(commandEncoder: GPUCommandEncoder, outputView: GPUTextureView, time: number) {
    // Update time for animated effects
    this.updateSettings({ time });

    // === Pass 1: Extract bright pixels ===
    const brightPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: this.brightTextureView,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    brightPass.setPipeline(this.brightExtractPipeline);
    brightPass.setBindGroup(0, this.brightExtractBindGroup);
    brightPass.setVertexBuffer(0, this.quadVertexBuffer);
    brightPass.draw(3);
    brightPass.end();

    // === Pass 2: Horizontal blur ===
    const blurHPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: this.blurTextureViewA,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    blurHPass.setPipeline(this.blurHorizontalPipeline);
    blurHPass.setBindGroup(0, this.blurHBindGroup);
    blurHPass.setVertexBuffer(0, this.quadVertexBuffer);
    blurHPass.draw(3);
    blurHPass.end();

    // === Pass 3: Vertical blur ===
    const blurVPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: this.blurTextureViewB,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    blurVPass.setPipeline(this.blurVerticalPipeline);
    blurVPass.setBindGroup(0, this.blurVBindGroup);
    blurVPass.setVertexBuffer(0, this.quadVertexBuffer);
    blurVPass.draw(3);
    blurVPass.end();

    // === Pass 4: Second blur pass for more spread ===
    // Recreate bind groups for ping-pong
    const blurH2BindGroup = this.device.createBindGroup({
      layout: this.textureBindGroupLayout,
      entries: [
        { binding: 0, resource: this.linearSampler },
        { binding: 1, resource: this.blurTextureViewB },
        { binding: 2, resource: { buffer: this.settingsBuffer } },
      ],
    });

    const blurH2Pass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: this.blurTextureViewA,
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    blurH2Pass.setPipeline(this.blurHorizontalPipeline);
    blurH2Pass.setBindGroup(0, blurH2BindGroup);
    blurH2Pass.setVertexBuffer(0, this.quadVertexBuffer);
    blurH2Pass.draw(3);
    blurH2Pass.end();

    // === Pass 5: Second vertical blur ===
    const blurV2Pass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: this.blurTextureViewB,
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    blurV2Pass.setPipeline(this.blurVerticalPipeline);
    blurV2Pass.setBindGroup(0, this.blurVBindGroup);
    blurV2Pass.setVertexBuffer(0, this.quadVertexBuffer);
    blurV2Pass.draw(3);
    blurV2Pass.end();

    // === Final Pass: Composite ===
    const compositePass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: outputView,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    compositePass.setPipeline(this.compositePipeline);
    compositePass.setBindGroup(0, this.compositeBindGroup);
    compositePass.setVertexBuffer(0, this.quadVertexBuffer);
    compositePass.draw(3);
    compositePass.end();
  }
}
