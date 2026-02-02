import { mat4, vec3 } from 'gl-matrix';
import { Camera } from '../core/Camera';
import { createPlane, createBox, createVerticalPlane, type Mesh } from '../core/Geometry';
import { TextureLoader } from '../core/TextureLoader';
import { PostProcessing } from '../rendering/PostProcessing';
import { createNeonTubePath } from '../objects/NeonTube';

interface SceneObject {
  mesh: Mesh;
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  modelMatrix: mat4;
  color: [number, number, number, number];
  emissive: number;
  isGlass?: boolean;
  isGround?: boolean;
}

interface TexturedObject {
  mesh: Mesh;
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  modelMatrix: mat4;
  texture: GPUTexture;
  bindGroup: GPUBindGroup;
  emissive: number;
}

// Film data for window posters
interface FilmData {
  id: number;
  title: string;
  poster_path: string | null;
}

export class ExteriorScene {
  private device: GPUDevice;
  private _format: GPUTextureFormat;
  private camera: Camera;
  private objects: SceneObject[] = [];
  private glassObjects: SceneObject[] = [];
  private texturedObjects: TexturedObject[] = [];
  private textureLoader: TextureLoader;

  // Uniforms
  private uniformBuffer: GPUBuffer;
  private uniformBindGroup!: GPUBindGroup;

  // Pipelines
  private colorPipeline!: GPURenderPipeline;
  private texturePipeline!: GPURenderPipeline;
  private glassPipeline!: GPURenderPipeline;
  private textureBindGroupLayout!: GPUBindGroupLayout;
  private depthTexture!: GPUTexture;
  private sampler!: GPUSampler;

  // Post-processing
  private postProcessing!: PostProcessing;

  // Canvas reference
  private canvas: HTMLCanvasElement;

  // Film data
  private filmData: Map<number, FilmData> = new Map();

  // Scene transition callback
  onEnterStore?: () => void;

  // Door proximity (for UI display)
  isNearDoor: boolean = true; // Always near door in static view

  // Manager animation state
  private managerSwayPhase = 0;

  // Prevent accidental click on first interaction
  private hasInteracted = false;

  constructor(device: GPUDevice, context: GPUCanvasContext, format: GPUTextureFormat) {
    this.device = device;
    this._format = format;
    this.canvas = context.canvas as HTMLCanvasElement;

    this.textureLoader = new TextureLoader(device);

    // STATIC CAMERA - Fixed cinematic view of storefront
    this.camera = new Camera(this.canvas.width / this.canvas.height);
    // Position camera to perfectly frame the storefront like the reference image
    // Camera needs to be far enough to see entire facade (~14m wide) + neon sign at top
    this.camera.position = vec3.fromValues(0, 2.5, 18); // Centered, eye level, good distance back
    this.camera.yaw = -90; // Looking toward -Z (the store)
    this.camera.pitch = 0; // Level view
    this.camera.fov = Math.PI / 2.8; // Slightly wider FOV to capture more
    this.camera.updateProjection();
    this.camera.updateView();

    this.uniformBuffer = device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
    });

    this.createPipelines(device, format);
    this.createDepthTexture();

    // Configure post-processing for cinematic night scene
    this.postProcessing = new PostProcessing(device, format, this.canvas.width, this.canvas.height);
    this.postProcessing.updateSettings({
      bloomThreshold: 0.6,     // Higher threshold - only bright neon should bloom
      bloomIntensity: 0.35,    // Moderate bloom
      vignetteIntensity: 0.25, // Subtle vignette
      grainIntensity: 0.01,    // Subtle film grain
      exposure: 0.9,           // Slightly darker for night scene
    });

    this.buildScene();
    this.setupControls();

    // Load film data for window posters
    this.loadFilmData();
  }

  private createPipelines(device: GPUDevice, format: GPUTextureFormat) {
    // === MAIN SHADER - Night exterior with wet ground, neon, rain ===
    const colorShaderCode = `
      struct Uniforms {
        viewProjection: mat4x4f,
        time: f32,
        cameraPos: vec3f,
      }

      struct VertexInput {
        @location(0) position: vec3f,
        @location(1) uv: vec2f,
        @location(2) normal: vec3f,
      }

      struct InstanceInput {
        @location(3) modelCol0: vec4f,
        @location(4) modelCol1: vec4f,
        @location(5) modelCol2: vec4f,
        @location(6) modelCol3: vec4f,
        @location(7) color: vec4f,
        @location(8) emissive: f32,
      }

      struct VertexOutput {
        @builtin(position) position: vec4f,
        @location(0) uv: vec2f,
        @location(1) normal: vec3f,
        @location(2) worldPos: vec3f,
        @location(3) color: vec4f,
        @location(4) emissive: f32,
      }

      @group(0) @binding(0) var<uniform> uniforms: Uniforms;

      // === NOISE FUNCTIONS ===
      fn hash2(p: vec2f) -> f32 {
        return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
      }

      fn hash3(p: vec3f) -> f32 {
        return fract(sin(dot(p, vec3f(127.1, 311.7, 74.7))) * 43758.5453);
      }

      fn noise2D(p: vec2f) -> f32 {
        let i = floor(p);
        let f = fract(p);
        let u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash2(i + vec2f(0.0, 0.0)), hash2(i + vec2f(1.0, 0.0)), u.x),
          mix(hash2(i + vec2f(0.0, 1.0)), hash2(i + vec2f(1.0, 1.0)), u.x),
          u.y
        );
      }

      fn fbm(p: vec2f) -> f32 {
        var value = 0.0;
        var amplitude = 0.5;
        var pos = p;
        for (var i = 0; i < 5; i = i + 1) {
          value = value + amplitude * noise2D(pos);
          pos = pos * 2.0;
          amplitude = amplitude * 0.5;
        }
        return value;
      }

      // Neon flicker - realistic gas discharge effect
      fn neonFlicker(time: f32, seed: f32) -> f32 {
        let base = 0.88;
        let fast = sin(time * 15.0 + seed * 10.0) * 0.04;
        let medium = sin(time * 6.0 + seed * 5.0) * 0.05;
        let slow = sin(time * 1.5 + seed) * 0.03;
        // Occasional flicker dip
        let flickerPhase = fract(time * 0.12 + seed * 0.7);
        let dip = smoothstep(0.0, 0.08, flickerPhase) * smoothstep(0.15, 0.08, flickerPhase) * 0.25;
        return base + fast + medium + slow - dip;
      }

      // Street light flicker
      fn streetLightFlicker(time: f32, seed: f32) -> f32 {
        let base = 0.85;
        let flicker = sin(time * 3.0 + seed * 20.0) * 0.08;
        let pulse = sin(time * 0.5 + seed) * 0.05;
        return base + flicker + pulse;
      }

      // Point light with attenuation
      fn pointLight(lightPos: vec3f, lightColor: vec3f, intensity: f32, worldPos: vec3f, normal: vec3f, viewDir: vec3f, roughness: f32) -> vec3f {
        let lightDir = lightPos - worldPos;
        let distance = length(lightDir);
        let L = normalize(lightDir);
        let N = normalize(normal);

        // Quadratic attenuation
        let attenuation = intensity / (1.0 + 0.07 * distance + 0.02 * distance * distance);

        // Diffuse
        let diff = max(dot(N, L), 0.0);

        // Specular (Blinn-Phong)
        let H = normalize(L + viewDir);
        let shininess = mix(8.0, 128.0, 1.0 - roughness);
        let spec = pow(max(dot(N, H), 0.0), shininess) * (1.0 - roughness) * 0.5;

        return lightColor * attenuation * (diff + spec);
      }

      // Brick texture
      fn brickPattern(p: vec2f) -> f32 {
        let brickSize = vec2f(0.8, 0.3);
        let offset = step(1.0, (floor(p.y / brickSize.y) % 2.0)) * 0.5;
        let brickPos = fract(vec2f(p.x / brickSize.x + offset, p.y / brickSize.y));
        let mortarWidth = 0.06;
        let mortarX = smoothstep(0.0, mortarWidth, brickPos.x) * (1.0 - smoothstep(1.0 - mortarWidth, 1.0, brickPos.x));
        let mortarY = smoothstep(0.0, mortarWidth, brickPos.y) * (1.0 - smoothstep(1.0 - mortarWidth, 1.0, brickPos.y));
        return mortarX * mortarY;
      }

      @vertex
      fn vertexMain(vert: VertexInput, inst: InstanceInput) -> VertexOutput {
        let model = mat4x4f(inst.modelCol0, inst.modelCol1, inst.modelCol2, inst.modelCol3);
        let worldPos = model * vec4f(vert.position, 1.0);

        var output: VertexOutput;
        output.position = uniforms.viewProjection * worldPos;
        output.uv = vert.uv;
        output.normal = (model * vec4f(vert.normal, 0.0)).xyz;
        output.worldPos = worldPos.xyz;
        output.color = inst.color;
        output.emissive = inst.emissive;
        return output;
      }

      @fragment
      fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
        let N = normalize(input.normal);
        let viewDir = normalize(uniforms.cameraPos - input.worldPos);
        let time = uniforms.time;

        var baseColor = input.color.rgb;
        var roughness = 0.8;

        // === NIGHT AMBIENT (very dark) ===
        let skyColor = vec3f(0.008, 0.008, 0.018);
        let groundColor = vec3f(0.003, 0.003, 0.008);
        let hemisphereBlend = N.y * 0.5 + 0.5;
        var ambient = mix(groundColor, skyColor, hemisphereBlend) * 0.15;

        var lighting = ambient;

        // Neon flicker values
        let neonFlick = neonFlicker(time, 0.0);
        let neonColor = vec3f(0.5, 0.12, 0.95); // Purple/violet

        // === MAIN NEON SIGN LIGHTING ===
        // Sign is at Y=4.8 to 6.2 (H=1.4), spanning ~9m wide
        // Multiple point lights along the sign
        for (var i = -4; i <= 4; i = i + 1) {
          let lightX = f32(i) * 1.0;
          let neonLightPos = vec3f(lightX, 5.5, 0.8);
          lighting = lighting + pointLight(neonLightPos, neonColor * neonFlick, 4.0, input.worldPos, N, viewDir, roughness);
        }

        // Neon glow spill downward onto facade
        lighting = lighting + pointLight(vec3f(0.0, 5.0, 1.5), neonColor * neonFlick, 3.0, input.worldPos, N, viewDir, roughness);

        // === INTERIOR WARM LIGHTS (visible through windows) ===
        let interiorWarm = vec3f(1.0, 0.85, 0.6);
        // Left window interior - reduced intensity
        lighting = lighting + pointLight(vec3f(-3.5, 2.2, -1.5), interiorWarm, 2.5, input.worldPos, N, viewDir, roughness);
        // Right window interior
        lighting = lighting + pointLight(vec3f(3.5, 2.2, -1.5), interiorWarm, 2.5, input.worldPos, N, viewDir, roughness);
        // Door/center interior
        lighting = lighting + pointLight(vec3f(0.0, 2.5, -2.0), interiorWarm, 2.0, input.worldPos, N, viewDir, roughness);
        // Back of store
        lighting = lighting + pointLight(vec3f(0.0, 2.8, -4.0), interiorWarm * 0.7, 1.5, input.worldPos, N, viewDir, roughness);

        // === STREET LIGHTS (background) - dim ===
        let streetLightColor = vec3f(1.0, 0.9, 0.7);
        let streetFlick1 = streetLightFlicker(time, 1.0);
        let streetFlick2 = streetLightFlicker(time, 2.0);
        lighting = lighting + pointLight(vec3f(-12.0, 6.0, 10.0), streetLightColor * streetFlick1, 1.5, input.worldPos, N, viewDir, roughness);
        lighting = lighting + pointLight(vec3f(12.0, 6.0, 10.0), streetLightColor * streetFlick2, 1.5, input.worldPos, N, viewDir, roughness);

        // === WET GROUND WITH NEON REFLECTIONS ===
        if (N.y > 0.9 && input.worldPos.y < 0.1) {
          // Wet asphalt base - very dark
          baseColor = vec3f(0.025, 0.025, 0.03);
          roughness = 0.2; // Very reflective when wet

          // Puddle variation using noise
          let puddleNoise = fbm(input.worldPos.xz * 0.8);
          let isPuddle = smoothstep(0.42, 0.58, puddleNoise);
          roughness = mix(0.3, 0.1, isPuddle);

          // === PLANAR REFLECTION OF NEON SIGN ===
          // Sign is at Y=5.0 to 6.2, spanning ~9m wide (-4.5 to +4.5)
          let signY = 5.6;
          let reflectedSignY = -signY; // Mirror across Y=0

          // Calculate reflection based on view angle and distance to reflected sign
          let toReflectedSign = vec3f(input.worldPos.x, reflectedSignY, 0.5) - input.worldPos;
          let reflectDist = length(toReflectedSign);

          // Fresnel - more reflection at grazing angles
          let fresnel = pow(1.0 - max(dot(viewDir, N), 0.0), 5.0);

          // Neon reflection intensity based on distance and position
          let signHalfWidth = 5.0;
          let inSignRange = smoothstep(signHalfWidth + 2.0, signHalfWidth - 2.0, abs(input.worldPos.x));
          let reflectionFalloff = 1.0 / (1.0 + reflectDist * 0.08);

          // Stretched reflection (wet surface distortion)
          let distortion = noise2D(input.worldPos.xz * 2.5 + vec2f(time * 0.15, 0.0)) * 0.25;
          let stretchedReflect = inSignRange * reflectionFalloff * (1.0 + distortion);

          // Apply neon reflection - strong purple glow
          let neonReflection = neonColor * neonFlick * stretchedReflect * 2.5;
          let reflectionStrength = mix(0.4, 0.85, isPuddle) * fresnel;

          lighting = lighting + neonReflection * reflectionStrength;

          // Interior light reflections (warm spots on wet ground) - subtle
          let warmReflect = interiorWarm * 0.15 * fresnel;
          let leftWarmDist = length(input.worldPos.xz - vec2f(-3.5, 4.0));
          let rightWarmDist = length(input.worldPos.xz - vec2f(3.5, 4.0));
          lighting = lighting + warmReflect / (1.0 + leftWarmDist * 0.4);
          lighting = lighting + warmReflect / (1.0 + rightWarmDist * 0.4);

          // Subtle rain ripple effect
          let ripple = sin(length(input.worldPos.xz * 6.0) - time * 2.5) * 0.015;
          lighting = lighting + vec3f(ripple * fresnel);

          // Asphalt texture variation
          let asphaltNoise = fbm(input.worldPos.xz * 12.0) * 0.12;
          baseColor = baseColor * (1.0 - asphaltNoise);
        }

        // === FACADE SURFACES ===
        // Upper brick wall
        if (input.worldPos.y > 3.8 && input.worldPos.z > -0.3 && input.worldPos.z < 0.3) {
          let brickUV = vec2f(input.worldPos.x * 0.5, input.worldPos.y * 0.5);
          let brick = brickPattern(brickUV);
          let brickColor = mix(vec3f(0.12, 0.08, 0.06), vec3f(0.18, 0.12, 0.1), brick);
          let brickVariation = hash2(floor(brickUV * 4.0)) * 0.15;
          baseColor = brickColor * (1.0 - brickVariation);
        }

        // Dark facade panels
        if (abs(N.z) > 0.9 && input.worldPos.z > -0.2 && input.worldPos.z < 0.2 && input.worldPos.y < 3.8) {
          let panelNoise = fbm(vec2f(input.worldPos.x, input.worldPos.y) * 3.0) * 0.08;
          baseColor = baseColor * (1.0 - panelNoise);
          // Subtle metallic sheen on black panels
          let metallic = pow(max(dot(reflect(-viewDir, N), vec3f(0.0, 1.0, 0.5)), 0.0), 32.0) * 0.1;
          lighting = lighting + vec3f(metallic);
        }

        // Window frames - slight metallic
        if (input.color.r < 0.1 && input.color.g < 0.1 && input.color.b < 0.15) {
          roughness = 0.4;
          let metalSheen = pow(max(dot(reflect(-viewDir, N), vec3f(0.2, 0.8, 0.3)), 0.0), 16.0) * 0.15;
          lighting = lighting + vec3f(metalSheen);
        }

        var finalColor = baseColor * lighting;

        // === EMISSIVE OBJECTS (Neon tubes, signs) ===
        if (input.emissive > 0.1) {
          let flickerValue = neonFlicker(time, input.worldPos.x * 0.3 + input.worldPos.y * 0.2);

          // Core emissive glow
          let emissiveColor = input.color.rgb * input.emissive * flickerValue;

          // Bloom contribution (brighter center)
          let bloomIntensity = smoothstep(0.5, 3.0, input.emissive);
          let bloom = emissiveColor * bloomIntensity * 0.8;

          // Outer glow halo
          let halo = emissiveColor * 0.3;

          finalColor = emissiveColor + bloom + halo;
        }

        // === NIGHT ATMOSPHERIC FOG ===
        let distFromCamera = length(input.worldPos - uniforms.cameraPos);
        let fogColor = vec3f(0.012, 0.012, 0.025); // Dark blue fog
        let fogDensity = 1.0 - exp(-distFromCamera * 0.015);
        let fogAmount = smoothstep(0.0, 1.0, fogDensity) * 0.35;
        finalColor = mix(finalColor, fogColor, fogAmount);

        // === TONE MAPPING (ACES Filmic) ===
        let a = 2.51;
        let b = 0.03;
        let c = 2.43;
        let d = 0.59;
        let e = 0.14;
        finalColor = saturate((finalColor * (a * finalColor + b)) / (finalColor * (c * finalColor + d) + e));

        // === GAMMA CORRECTION ===
        finalColor = pow(finalColor, vec3f(1.0 / 2.2));

        return vec4f(finalColor, input.color.a);
      }
    `;

    const colorModule = device.createShaderModule({ code: colorShaderCode });

    const uniformBindGroupLayout = device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      }],
    });

    this.uniformBindGroup = device.createBindGroup({
      layout: uniformBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });

    this.colorPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [uniformBindGroupLayout] }),
      vertex: {
        module: colorModule,
        entryPoint: 'vertexMain',
        buffers: [
          {
            arrayStride: 32,
            stepMode: 'vertex',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x2' },
              { shaderLocation: 2, offset: 20, format: 'float32x3' },
            ],
          },
          {
            arrayStride: 84,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 3, offset: 0, format: 'float32x4' },
              { shaderLocation: 4, offset: 16, format: 'float32x4' },
              { shaderLocation: 5, offset: 32, format: 'float32x4' },
              { shaderLocation: 6, offset: 48, format: 'float32x4' },
              { shaderLocation: 7, offset: 64, format: 'float32x4' },
              { shaderLocation: 8, offset: 80, format: 'float32' },
            ],
          },
        ],
      },
      fragment: {
        module: colorModule,
        entryPoint: 'fragmentMain',
        targets: [{ format: 'rgba16float' }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
    });

    // === TEXTURE PIPELINE (for movie posters) ===
    const textureShaderCode = `
      struct Uniforms {
        viewProjection: mat4x4f,
        time: f32,
        cameraPos: vec3f,
      }

      struct VertexInput {
        @location(0) position: vec3f,
        @location(1) uv: vec2f,
        @location(2) normal: vec3f,
      }

      struct PushConstants {
        model: mat4x4f,
        emissive: f32,
      }

      struct VertexOutput {
        @builtin(position) position: vec4f,
        @location(0) uv: vec2f,
        @location(1) normal: vec3f,
        @location(2) worldPos: vec3f,
        @location(3) emissive: f32,
      }

      @group(0) @binding(0) var<uniform> uniforms: Uniforms;
      @group(1) @binding(0) var texSampler: sampler;
      @group(1) @binding(1) var texImage: texture_2d<f32>;
      @group(1) @binding(2) var<uniform> objectData: PushConstants;

      fn pointLight(lightPos: vec3f, lightColor: vec3f, intensity: f32, worldPos: vec3f, normal: vec3f, viewDir: vec3f) -> vec3f {
        let lightDir = lightPos - worldPos;
        let distance = length(lightDir);
        let L = normalize(lightDir);
        let N = normalize(normal);
        let attenuation = intensity / (1.0 + 0.07 * distance + 0.02 * distance * distance);
        let diff = max(dot(N, L), 0.0);
        let H = normalize(L + viewDir);
        let spec = pow(max(dot(N, H), 0.0), 32.0) * 0.2;
        return lightColor * attenuation * (diff + spec);
      }

      @vertex
      fn vertexMain(vert: VertexInput) -> VertexOutput {
        let worldPos = objectData.model * vec4f(vert.position, 1.0);

        var output: VertexOutput;
        output.position = uniforms.viewProjection * worldPos;
        output.uv = vert.uv;
        output.normal = (objectData.model * vec4f(vert.normal, 0.0)).xyz;
        output.worldPos = worldPos.xyz;
        output.emissive = objectData.emissive;
        return output;
      }

      @fragment
      fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
        var texColor = textureSample(texImage, texSampler, input.uv);
        let N = normalize(input.normal);
        let viewDir = normalize(uniforms.cameraPos - input.worldPos);

        // Warm interior ambient
        var ambient = vec3f(0.08, 0.06, 0.04);

        // Interior lights illuminating posters
        let interiorWarm = vec3f(1.0, 0.85, 0.6);
        var lighting = ambient;

        // Multiple interior light sources
        lighting = lighting + pointLight(vec3f(-3.5, 2.5, -1.0), interiorWarm, 5.0, input.worldPos, N, viewDir);
        lighting = lighting + pointLight(vec3f(3.5, 2.5, -1.0), interiorWarm, 5.0, input.worldPos, N, viewDir);
        lighting = lighting + pointLight(vec3f(0.0, 3.0, -2.0), interiorWarm, 4.0, input.worldPos, N, viewDir);

        // Slight neon spill on posters
        let neonPurple = vec3f(0.3, 0.1, 0.5);
        lighting = lighting + pointLight(vec3f(0.0, 4.5, 1.0), neonPurple, 2.0, input.worldPos, N, viewDir);

        var finalColor = texColor.rgb * lighting;

        // Emissive for glowing signs
        if (input.emissive > 0.0) {
          let emissiveColor = texColor.rgb * input.emissive;
          finalColor = finalColor + emissiveColor;
        }

        // ACES tone mapping
        let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
        finalColor = saturate((finalColor * (a * finalColor + b)) / (finalColor * (c * finalColor + d) + e));

        // Gamma
        finalColor = pow(finalColor, vec3f(1.0 / 2.2));

        return vec4f(finalColor, texColor.a);
      }
    `;

    const textureModule = device.createShaderModule({ code: textureShaderCode });

    this.textureBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });

    this.texturePipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [uniformBindGroupLayout, this.textureBindGroupLayout],
      }),
      vertex: {
        module: textureModule,
        entryPoint: 'vertexMain',
        buffers: [{
          arrayStride: 32,
          stepMode: 'vertex',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x2' },
            { shaderLocation: 2, offset: 20, format: 'float32x3' },
          ],
        }],
      },
      fragment: {
        module: textureModule,
        entryPoint: 'fragmentMain',
        targets: [{ format: 'rgba16float' }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
    });

    // === GLASS PIPELINE with rain drops ===
    const glassShaderCode = `
      struct Uniforms {
        viewProjection: mat4x4f,
        time: f32,
        cameraPos: vec3f,
      }

      struct VertexInput {
        @location(0) position: vec3f,
        @location(1) uv: vec2f,
        @location(2) normal: vec3f,
      }

      struct InstanceInput {
        @location(3) modelCol0: vec4f,
        @location(4) modelCol1: vec4f,
        @location(5) modelCol2: vec4f,
        @location(6) modelCol3: vec4f,
        @location(7) color: vec4f,
        @location(8) emissive: f32,
      }

      struct VertexOutput {
        @builtin(position) position: vec4f,
        @location(0) uv: vec2f,
        @location(1) normal: vec3f,
        @location(2) worldPos: vec3f,
        @location(3) color: vec4f,
      }

      @group(0) @binding(0) var<uniform> uniforms: Uniforms;

      fn hash2(p: vec2f) -> f32 {
        return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
      }

      fn noise2D(p: vec2f) -> f32 {
        let i = floor(p);
        let f = fract(p);
        let u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash2(i), hash2(i + vec2f(1.0, 0.0)), u.x),
          mix(hash2(i + vec2f(0.0, 1.0)), hash2(i + vec2f(1.0, 1.0)), u.x),
          u.y
        );
      }

      // Rain drop pattern
      fn rainDrops(uv: vec2f, time: f32) -> f32 {
        var drops = 0.0;

        // Multiple layers of rain drops at different scales
        for (var i = 0; i < 3; i = i + 1) {
          let scale = 15.0 + f32(i) * 8.0;
          let speed = 0.5 + f32(i) * 0.3;
          let dropUV = uv * scale + vec2f(f32(i) * 3.7, -time * speed);

          let cellID = floor(dropUV);
          let cellUV = fract(dropUV) - 0.5;

          // Random offset for each cell
          let randOffset = vec2f(hash2(cellID), hash2(cellID + vec2f(17.0, 31.0))) - 0.5;
          let dropPos = cellUV - randOffset * 0.3;

          // Drop shape (elongated vertically for streaks)
          let dropDist = length(dropPos * vec2f(1.0, 0.3));
          let drop = smoothstep(0.15, 0.05, dropDist);

          // Fade based on pseudo-random
          let dropAlpha = step(0.7 - f32(i) * 0.15, hash2(cellID + vec2f(100.0, 200.0)));
          drops = drops + drop * dropAlpha * (0.5 - f32(i) * 0.12);
        }

        return saturate(drops);
      }

      @vertex
      fn vertexMain(vert: VertexInput, inst: InstanceInput) -> VertexOutput {
        let model = mat4x4f(inst.modelCol0, inst.modelCol1, inst.modelCol2, inst.modelCol3);
        let worldPos = model * vec4f(vert.position, 1.0);

        var output: VertexOutput;
        output.position = uniforms.viewProjection * worldPos;
        output.uv = vert.uv;
        output.normal = (model * vec4f(vert.normal, 0.0)).xyz;
        output.worldPos = worldPos.xyz;
        output.color = inst.color;
        return output;
      }

      @fragment
      fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
        let N = normalize(input.normal);
        let viewDir = normalize(uniforms.cameraPos - input.worldPos);
        let time = uniforms.time;

        // Fresnel for glass reflection
        let fresnel = pow(1.0 - max(dot(viewDir, N), 0.0), 3.5);

        // Glass tint (slight blue-green)
        let glassTint = vec3f(0.9, 0.95, 1.0);

        // Neon reflection on glass (purple tint)
        let neonReflect = vec3f(0.2, 0.08, 0.35) * fresnel;

        // Rain drops on glass
        let rainUV = vec2f(input.worldPos.x * 0.5, input.worldPos.y * 0.8);
        let drops = rainDrops(rainUV, time);

        // Drops create bright highlights
        let dropHighlight = drops * 0.4 * vec3f(0.8, 0.85, 1.0);

        // Interior glow visible through glass
        let interiorGlow = vec3f(0.12, 0.08, 0.04) * (1.0 - fresnel);

        // Combine
        var glassColor = glassTint * 0.03 + neonReflect + dropHighlight + interiorGlow;

        // Glass transparency
        let alpha = 0.15 + fresnel * 0.3 + drops * 0.2;

        return vec4f(glassColor, alpha);
      }
    `;

    const glassModule = device.createShaderModule({ code: glassShaderCode });

    this.glassPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [uniformBindGroupLayout] }),
      vertex: {
        module: glassModule,
        entryPoint: 'vertexMain',
        buffers: [
          {
            arrayStride: 32,
            stepMode: 'vertex',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x2' },
              { shaderLocation: 2, offset: 20, format: 'float32x3' },
            ],
          },
          {
            arrayStride: 84,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 3, offset: 0, format: 'float32x4' },
              { shaderLocation: 4, offset: 16, format: 'float32x4' },
              { shaderLocation: 5, offset: 32, format: 'float32x4' },
              { shaderLocation: 6, offset: 48, format: 'float32x4' },
              { shaderLocation: 7, offset: 64, format: 'float32x4' },
              { shaderLocation: 8, offset: 80, format: 'float32' },
            ],
          },
        ],
      },
      fragment: {
        module: glassModule,
        entryPoint: 'fragmentMain',
        targets: [{
          format: 'rgba16float',
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { depthWriteEnabled: false, depthCompare: 'less', format: 'depth24plus' },
    });
  }

  private createDepthTexture() {
    this.depthTexture = this.device.createTexture({
      size: [this.canvas.width, this.canvas.height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  private createBuffer(mesh: Mesh): { vertexBuffer: GPUBuffer; indexBuffer: GPUBuffer } {
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

    return { vertexBuffer, indexBuffer };
  }

  private addObject(
    mesh: Mesh,
    position: vec3,
    color: [number, number, number, number],
    emissive: number = 0,
    scale: vec3 = vec3.fromValues(1, 1, 1),
  ): SceneObject {
    const { vertexBuffer, indexBuffer } = this.createBuffer(mesh);

    const modelMatrix = mat4.create();
    mat4.translate(modelMatrix, modelMatrix, position);
    mat4.scale(modelMatrix, modelMatrix, scale);

    const obj: SceneObject = { mesh, vertexBuffer, indexBuffer, modelMatrix, color, emissive };
    this.objects.push(obj);
    return obj;
  }

  private addGlassObject(
    mesh: Mesh,
    position: vec3,
    color: [number, number, number, number],
    scale: vec3 = vec3.fromValues(1, 1, 1),
  ): SceneObject {
    const { vertexBuffer, indexBuffer } = this.createBuffer(mesh);

    const modelMatrix = mat4.create();
    mat4.translate(modelMatrix, modelMatrix, position);
    mat4.scale(modelMatrix, modelMatrix, scale);

    const obj: SceneObject = { mesh, vertexBuffer, indexBuffer, modelMatrix, color, emissive: 0, isGlass: true };
    this.glassObjects.push(obj);
    return obj;
  }

  private addTexturedObject(
    mesh: Mesh,
    position: vec3,
    texture: GPUTexture,
    emissive: number = 0,
    scale: vec3 = vec3.fromValues(1, 1, 1),
  ): TexturedObject {
    const { vertexBuffer, indexBuffer } = this.createBuffer(mesh);

    const modelMatrix = mat4.create();
    mat4.translate(modelMatrix, modelMatrix, position);
    mat4.scale(modelMatrix, modelMatrix, scale);

    const objectBuffer = this.device.createBuffer({
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const bindGroup = this.device.createBindGroup({
      layout: this.textureBindGroupLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: texture.createView() },
        { binding: 2, resource: { buffer: objectBuffer } },
      ],
    });

    const obj: TexturedObject = { mesh, vertexBuffer, indexBuffer, modelMatrix, texture, bindGroup, emissive };
    this.texturedObjects.push(obj);
    return obj;
  }

  private async loadFilmData() {
    const API_KEY = import.meta.env.VITE_TMDB_API_KEY;
    if (!API_KEY) {
      console.warn('TMDB API key not found, using placeholder posters');
      this.buildPlaceholderPosters();
      return;
    }

    // Films matching the reference image layout
    const posterFilms = [
      // Left window - top row
      { id: 348, title: 'Alien' },
      { id: 78, title: 'Blade Runner' },
      // Left window - bottom row
      { id: 82856, title: 'The Mandalorian' },
      { id: 545611, title: 'Everything Everywhere All at Once' },
      // Right window - top row
      { id: 680, title: 'Pulp Fiction' },
      { id: 603, title: 'The Matrix' },
      // Right window - bottom row
      { id: 496243, title: 'Parasite' },
      { id: 438631, title: 'Dune' },
    ];

    for (const film of posterFilms) {
      try {
        const res = await fetch(`https://api.themoviedb.org/3/movie/${film.id}?api_key=${API_KEY}&language=fr-FR`);
        if (res.ok) {
          const data = await res.json();
          this.filmData.set(data.id, {
            id: data.id,
            title: data.title,
            poster_path: data.poster_path,
          });
        }
      } catch (e) {
        console.warn(`Failed to load film ${film.id}`, e);
      }
    }

    this.buildWindowPosters();
  }

  private buildPlaceholderPosters() {
    // Create placeholder colored rectangles if no API key
    const posterMesh = createVerticalPlane(1.0, 1.5);
    const colors: [number, number, number, number][] = [
      [0.2, 0.3, 0.1, 1], [0.1, 0.2, 0.3, 1],
      [0.3, 0.2, 0.1, 1], [0.2, 0.1, 0.3, 1],
      [0.3, 0.1, 0.2, 1], [0.1, 0.3, 0.2, 1],
      [0.2, 0.2, 0.2, 1], [0.15, 0.15, 0.2, 1],
    ];

    // Left window posters
    const leftPositions = [
      [-4.6, 2.8, -0.08], [-3.2, 2.8, -0.08],
      [-4.6, 1.2, -0.08], [-3.2, 1.2, -0.08],
    ];

    leftPositions.forEach((pos, i) => {
      this.addObject(posterMesh, vec3.fromValues(pos[0], pos[1], pos[2]), colors[i], 0.05);
    });

    // Right window posters
    const rightPositions = [
      [3.2, 2.8, -0.08], [4.6, 2.8, -0.08],
      [3.2, 1.2, -0.08], [4.6, 1.2, -0.08],
    ];

    rightPositions.forEach((pos, i) => {
      this.addObject(posterMesh, vec3.fromValues(pos[0], pos[1], pos[2]), colors[i + 4], 0.05);
    });
  }

  private async buildWindowPosters() {
    const posterMesh = createVerticalPlane(1.0, 1.5);
    const films = Array.from(this.filmData.values());

    if (films.length === 0) {
      this.buildPlaceholderPosters();
      return;
    }

    // Poster positions matching reference layout
    const posterPositions = [
      // Left window - 2x2 grid
      { x: -4.6, y: 2.8, z: -0.08 }, // Top left
      { x: -3.2, y: 2.8, z: -0.08 }, // Top right
      { x: -4.6, y: 1.2, z: -0.08 }, // Bottom left
      { x: -3.2, y: 1.2, z: -0.08 }, // Bottom right
      // Right window - 2x2 grid
      { x: 3.2, y: 2.8, z: -0.08 },  // Top left
      { x: 4.6, y: 2.8, z: -0.08 },  // Top right
      { x: 3.2, y: 1.2, z: -0.08 },  // Bottom left
      { x: 4.6, y: 1.2, z: -0.08 },  // Bottom right
    ];

    for (let i = 0; i < Math.min(films.length, posterPositions.length); i++) {
      const film = films[i];
      const pos = posterPositions[i];

      if (film.poster_path) {
        try {
          const posterUrl = `https://image.tmdb.org/t/p/w342${film.poster_path}`;
          const texture = await this.textureLoader.loadFromURL(posterUrl);
          this.addTexturedObject(posterMesh, vec3.fromValues(pos.x, pos.y, pos.z), texture, 0.08);
        } catch {
          // Fallback to colored rectangle
          this.addObject(posterMesh, vec3.fromValues(pos.x, pos.y, pos.z), [0.2, 0.15, 0.25, 1], 0.05);
        }
      }
    }
  }

  private buildScene() {
    // === WET GROUND / PAVEMENT ===
    const ground = createPlane(40, 40, 1, 1);
    this.addObject(ground, vec3.fromValues(0, 0, 10), [0.05, 0.05, 0.06, 1]);

    // Sidewalk (slightly raised, lighter)
    const sidewalk = createPlane(16, 5, 1, 1);
    this.addObject(sidewalk, vec3.fromValues(0, 0.03, 1.5), [0.08, 0.08, 0.09, 1]);

    // === STORE FACADE ===
    this.buildFacade();

    // === NEON SIGN "VIDEOCLUB" ===
    this.buildNeonSign();

    // === GLASS WINDOWS WITH FRAMES ===
    this.buildWindows();

    // === VISIBLE INTERIOR ===
    this.buildInterior();

    // === MANAGER CHARACTER ===
    this.buildManager();

    // === INTERIOR SIGNS (VHS, etc.) ===
    this.buildInteriorSigns();

    // === BACKGROUND ELEMENTS ===
    this.buildBackground();
  }

  private buildFacade() {
    const facadeColor: [number, number, number, number] = [0.02, 0.02, 0.025, 1];
    const frameColor: [number, number, number, number] = [0.05, 0.05, 0.06, 1];

    // Main facade back wall
    const backWall = createVerticalPlane(14, 5.5);
    this.addObject(backWall, vec3.fromValues(0, 2.75, -0.2), facadeColor);

    // Upper facade (above windows) - brick texture area
    const upperFacade = createBox(14, 1.2, 0.5);
    this.addObject(upperFacade, vec3.fromValues(0, 4.9, 0), [0.08, 0.05, 0.04, 1]);

    // Fascia board (sign mounting area)
    const fascia = createBox(12, 0.8, 0.3);
    this.addObject(fascia, vec3.fromValues(0, 4.6, 0.15), [0.015, 0.015, 0.02, 1]);

    // === LEFT WINDOW AREA ===
    // Left pillar
    const leftPillar = createBox(0.6, 4.3, 0.4);
    this.addObject(leftPillar, vec3.fromValues(-6.3, 2.15, 0), facadeColor);

    // Left window frame - vertical left
    const leftFrameL = createBox(0.12, 3.4, 0.15);
    this.addObject(leftFrameL, vec3.fromValues(-5.6, 2.0, 0.08), frameColor);

    // Left window frame - vertical right (separator)
    const leftFrameR = createBox(0.12, 3.4, 0.15);
    this.addObject(leftFrameR, vec3.fromValues(-2.4, 2.0, 0.08), frameColor);

    // Left window frame - horizontal top
    const leftFrameT = createBox(3.4, 0.12, 0.15);
    this.addObject(leftFrameT, vec3.fromValues(-4.0, 3.75, 0.08), frameColor);

    // Left window frame - horizontal bottom
    const leftFrameB = createBox(3.4, 0.12, 0.15);
    this.addObject(leftFrameB, vec3.fromValues(-4.0, 0.35, 0.08), frameColor);

    // Left window sill
    const leftSill = createBox(3.6, 0.15, 0.25);
    this.addObject(leftSill, vec3.fromValues(-4.0, 0.25, 0.12), [0.06, 0.06, 0.07, 1]);

    // === CENTER DOOR AREA ===
    // Left of door pillar
    const doorPillarL = createBox(0.5, 4.3, 0.4);
    this.addObject(doorPillarL, vec3.fromValues(-1.1, 2.15, 0), facadeColor);

    // Right of door pillar
    const doorPillarR = createBox(0.5, 4.3, 0.4);
    this.addObject(doorPillarR, vec3.fromValues(1.1, 2.15, 0), facadeColor);

    // Door frame
    const doorFrameTop = createBox(1.5, 0.1, 0.12);
    this.addObject(doorFrameTop, vec3.fromValues(0, 2.75, 0.1), [0.1, 0.1, 0.12, 1]);

    const doorFrameL = createBox(0.08, 2.75, 0.12);
    this.addObject(doorFrameL, vec3.fromValues(-0.7, 1.375, 0.1), [0.1, 0.1, 0.12, 1]);

    const doorFrameR = createBox(0.08, 2.75, 0.12);
    this.addObject(doorFrameR, vec3.fromValues(0.7, 1.375, 0.1), [0.1, 0.1, 0.12, 1]);

    // Door handle
    const doorHandle = createBox(0.06, 0.25, 0.06);
    this.addObject(doorHandle, vec3.fromValues(0.5, 1.3, 0.18), [0.6, 0.55, 0.35, 1], 0.3);

    // === RIGHT WINDOW AREA ===
    // Right pillar
    const rightPillar = createBox(0.6, 4.3, 0.4);
    this.addObject(rightPillar, vec3.fromValues(6.3, 2.15, 0), facadeColor);

    // Right window frame - vertical left (separator)
    const rightFrameL = createBox(0.12, 3.4, 0.15);
    this.addObject(rightFrameL, vec3.fromValues(2.4, 2.0, 0.08), frameColor);

    // Right window frame - vertical right
    const rightFrameR = createBox(0.12, 3.4, 0.15);
    this.addObject(rightFrameR, vec3.fromValues(5.6, 2.0, 0.08), frameColor);

    // Right window frame - horizontal top
    const rightFrameT = createBox(3.4, 0.12, 0.15);
    this.addObject(rightFrameT, vec3.fromValues(4.0, 3.75, 0.08), frameColor);

    // Right window frame - horizontal bottom
    const rightFrameB = createBox(3.4, 0.12, 0.15);
    this.addObject(rightFrameB, vec3.fromValues(4.0, 0.35, 0.08), frameColor);

    // Right window sill
    const rightSill = createBox(3.6, 0.15, 0.25);
    this.addObject(rightSill, vec3.fromValues(4.0, 0.25, 0.12), [0.06, 0.06, 0.07, 1]);
  }

  private buildNeonSign() {
    // Create photorealistic VIDEOCLUB neon letters using tubular geometry
    // Reference image: Large purple neon ~10m wide, letters ~1.2m tall

    const neonColor: [number, number, number, number] = [0.5, 0.1, 1.0, 1]; // Purple neon
    const signY = 5.0; // Height above ground
    const signZ = 0.5; // In front of facade

    const H = 1.2; // Letter height
    const tubeRadius = 0.045; // Neon tube radius (~4.5cm)
    const emissive = 12.0; // Strong glow for neon

    // Define letter paths - each letter is an array of connected paths
    // Each path is an array of [x, y, z] points relative to letter origin
    const letterPaths: { [key: string]: [number, number, number][][] } = {
      'V': [
        [[0, H, 0], [0.4, 0, 0], [0.8, H, 0]] // V shape
      ],
      'I': [
        [[0.15, 0, 0], [0.15, H, 0]] // Vertical line
      ],
      'D': [
        [[0, 0, 0], [0, H, 0]], // Left vertical
        [[0, H, 0], [0.5, H, 0], [0.7, H*0.8, 0], [0.7, H*0.2, 0], [0.5, 0, 0], [0, 0, 0]] // D curve
      ],
      'E': [
        [[0, 0, 0], [0, H, 0]], // Left vertical
        [[0, H, 0], [0.6, H, 0]], // Top horizontal
        [[0, H*0.5, 0], [0.5, H*0.5, 0]], // Middle horizontal
        [[0, 0, 0], [0.6, 0, 0]] // Bottom horizontal
      ],
      'O': [
        [[0.1, 0, 0], [0.6, 0, 0], [0.7, H*0.15, 0], [0.7, H*0.85, 0], [0.6, H, 0],
         [0.1, H, 0], [0, H*0.85, 0], [0, H*0.15, 0], [0.1, 0, 0]] // O oval
      ],
      'C': [
        [[0.6, H*0.15, 0], [0.5, 0, 0], [0.1, 0, 0], [0, H*0.15, 0], [0, H*0.85, 0],
         [0.1, H, 0], [0.5, H, 0], [0.6, H*0.85, 0]] // C curve
      ],
      'L': [
        [[0, H, 0], [0, 0, 0], [0.55, 0, 0]] // L shape
      ],
      'U': [
        [[0, H, 0], [0, H*0.15, 0], [0.1, 0, 0], [0.55, 0, 0], [0.65, H*0.15, 0], [0.65, H, 0]] // U shape
      ],
      'B': [
        [[0, 0, 0], [0, H, 0]], // Left vertical
        [[0, H, 0], [0.45, H, 0], [0.55, H*0.85, 0], [0.55, H*0.6, 0], [0.45, H*0.5, 0], [0, H*0.5, 0]], // Top bump
        [[0, H*0.5, 0], [0.5, H*0.5, 0], [0.6, H*0.35, 0], [0.6, H*0.15, 0], [0.5, 0, 0], [0, 0, 0]] // Bottom bump
      ]
    };

    const letterWidths: { [key: string]: number } = {
      'V': 0.8, 'I': 0.3, 'D': 0.75, 'E': 0.65, 'O': 0.75,
      'C': 0.65, 'L': 0.6, 'U': 0.7, 'B': 0.65
    };

    const word = 'VIDEOCLUB';
    const spacing = 0.2;

    // Calculate total width
    let totalWidth = 0;
    for (let i = 0; i < word.length; i++) {
      totalWidth += letterWidths[word[i]];
      if (i < word.length - 1) totalWidth += spacing;
    }

    // Create each letter
    let xOffset = -totalWidth / 2;

    for (const char of word) {
      const paths = letterPaths[char];
      for (const path of paths) {
        // Transform path to world coordinates
        const worldPath: [number, number, number][] = path.map(([x, y, z]) => [
          x + xOffset,
          y + signY,
          z + signZ
        ]);

        try {
          const tubeMesh = createNeonTubePath(worldPath, tubeRadius, 8);
          this.addObject(tubeMesh, vec3.fromValues(0, 0, 0), neonColor, emissive);
        } catch (e) {
          console.warn(`Failed to create tube for letter ${char}:`, e);
        }
      }
      xOffset += letterWidths[char] + spacing;
    }

    // Dark backing panel behind the sign
    const backingPanel = createBox(totalWidth + 1.2, H + 0.8, 0.2);
    this.addObject(backingPanel, vec3.fromValues(0, signY + H/2, signZ - 0.2), [0.015, 0.015, 0.02, 1]);

    // Subtle glow underline
    const underlinePath: [number, number, number][] = [
      [-totalWidth/2 - 0.3, signY - 0.2, signZ],
      [totalWidth/2 + 0.3, signY - 0.2, signZ]
    ];
    try {
      const underlineMesh = createNeonTubePath(underlinePath, tubeRadius * 0.6, 6);
      this.addObject(underlineMesh, vec3.fromValues(0, 0, 0), [0.35, 0.08, 0.7, 1], 6.0);
    } catch (e) {
      console.warn('Failed to create underline:', e);
    }
  }

  private buildWindows() {
    // Left window glass
    const leftGlass = createVerticalPlane(3.0, 3.3);
    this.addGlassObject(leftGlass, vec3.fromValues(-4.0, 2.05, 0.02), [0.9, 0.95, 1.0, 0.2]);

    // Right window glass
    const rightGlass = createVerticalPlane(3.0, 3.3);
    this.addGlassObject(rightGlass, vec3.fromValues(4.0, 2.05, 0.02), [0.9, 0.95, 1.0, 0.2]);

    // Door glass
    const doorGlass = createVerticalPlane(1.2, 2.6);
    this.addGlassObject(doorGlass, vec3.fromValues(0, 1.35, 0.06), [0.85, 0.9, 1.0, 0.25]);
  }

  private buildInterior() {
    // Interior floor (blue carpet like Blockbuster)
    const interiorFloor = createPlane(12, 8, 1, 1);
    this.addObject(interiorFloor, vec3.fromValues(0, 0.01, -4), [0.1, 0.25, 0.5, 1]);

    // Interior back wall (yellow/cream)
    const backWall = createVerticalPlane(12, 4);
    const backWallObj = this.addObject(backWall, vec3.fromValues(0, 2, -7.5), [0.7, 0.6, 0.2, 1]);
    mat4.rotateY(backWallObj.modelMatrix, backWallObj.modelMatrix, Math.PI);

    // Interior side walls
    const leftInteriorWall = createVerticalPlane(8, 4);
    const leftWallObj = this.addObject(leftInteriorWall, vec3.fromValues(-6, 2, -4), [0.65, 0.55, 0.2, 1]);
    mat4.rotateY(leftWallObj.modelMatrix, leftWallObj.modelMatrix, Math.PI / 2);

    const rightInteriorWall = createVerticalPlane(8, 4);
    const rightWallObj = this.addObject(rightInteriorWall, vec3.fromValues(6, 2, -4), [0.65, 0.55, 0.2, 1]);
    mat4.rotateY(rightWallObj.modelMatrix, rightWallObj.modelMatrix, -Math.PI / 2);

    // Interior ceiling
    const ceiling = createPlane(12, 8, 1, 1);
    const ceilingObj = this.addObject(ceiling, vec3.fromValues(0, 3.8, -4), [0.75, 0.65, 0.25, 1]);
    mat4.rotateX(ceilingObj.modelMatrix, ceilingObj.modelMatrix, Math.PI);

    // === SHELVING UNITS ===
    const shelfColor: [number, number, number, number] = [0.05, 0.05, 0.07, 1];

    // Left window shelves (visible from outside)
    for (let i = 0; i < 4; i++) {
      const shelfY = 0.5 + i * 0.7;
      const shelf = createBox(2.8, 0.04, 0.3);
      this.addObject(shelf, vec3.fromValues(-4.0, shelfY, -0.5), shelfColor);

      // VHS cassettes on shelves (colored boxes)
      for (let j = 0; j < 8; j++) {
        const cassetteX = -5.2 + j * 0.35;
        const cassetteMesh = createBox(0.12, 0.18, 0.02);
        const cassetteColor: [number, number, number, number] = [
          0.1 + Math.random() * 0.2,
          0.1 + Math.random() * 0.15,
          0.15 + Math.random() * 0.2,
          1
        ];
        this.addObject(cassetteMesh, vec3.fromValues(cassetteX, shelfY + 0.12, -0.4), cassetteColor, 0.02);
      }
    }

    // Right window shelves
    for (let i = 0; i < 4; i++) {
      const shelfY = 0.5 + i * 0.7;
      const shelf = createBox(2.8, 0.04, 0.3);
      this.addObject(shelf, vec3.fromValues(4.0, shelfY, -0.5), shelfColor);

      // VHS cassettes
      for (let j = 0; j < 8; j++) {
        const cassetteX = 2.8 + j * 0.35;
        const cassetteMesh = createBox(0.12, 0.18, 0.02);
        const cassetteColor: [number, number, number, number] = [
          0.1 + Math.random() * 0.2,
          0.1 + Math.random() * 0.15,
          0.15 + Math.random() * 0.2,
          1
        ];
        this.addObject(cassetteMesh, vec3.fromValues(cassetteX, shelfY + 0.12, -0.4), cassetteColor, 0.02);
      }
    }

    // Center aisle shelving (visible through door)
    for (let side of [-1.8, 1.8]) {
      for (let i = 0; i < 5; i++) {
        const shelfY = 0.5 + i * 0.6;
        const shelf = createBox(0.8, 0.04, 2.5);
        this.addObject(shelf, vec3.fromValues(side, shelfY, -4), shelfColor);
      }

      // Vertical supports
      const support = createBox(0.06, 3.2, 0.06);
      this.addObject(support, vec3.fromValues(side, 1.6, -2.8), shelfColor);
      this.addObject(support, vec3.fromValues(side, 1.6, -5.2), shelfColor);
    }

    // Counter
    const counter = createBox(3, 0.9, 0.8);
    this.addObject(counter, vec3.fromValues(0, 0.45, -5.5), [0.2, 0.12, 0.08, 1]);

    // Counter top (lighter)
    const counterTop = createBox(3.1, 0.05, 0.85);
    this.addObject(counterTop, vec3.fromValues(0, 0.925, -5.5), [0.3, 0.2, 0.15, 1]);

    // Cash register
    const register = createBox(0.35, 0.2, 0.3);
    this.addObject(register, vec3.fromValues(-0.8, 1.05, -5.4), [0.12, 0.12, 0.15, 1]);

    // Register screen (glowing)
    const registerScreen = createBox(0.2, 0.08, 0.02);
    this.addObject(registerScreen, vec3.fromValues(-0.8, 1.2, -5.25), [0.2, 0.5, 0.3, 1], 0.8);
  }

  private buildManager() {
    // Simplified manager figure behind counter
    const managerX = 0.5;
    const managerZ = -5.8;

    // Body (torso)
    const torso = createBox(0.4, 0.6, 0.25);
    this.addObject(torso, vec3.fromValues(managerX, 1.3, managerZ), [0.7, 0.2, 0.3, 1]); // Red/maroon shirt

    // Head
    const head = createBox(0.22, 0.26, 0.2);
    this.addObject(head, vec3.fromValues(managerX, 1.78, managerZ), [0.85, 0.7, 0.55, 1]); // Skin tone

    // Hair
    const hair = createBox(0.24, 0.1, 0.22);
    this.addObject(hair, vec3.fromValues(managerX, 1.95, managerZ), [0.15, 0.1, 0.08, 1]); // Dark hair

    // Arms
    const leftArm = createBox(0.1, 0.45, 0.1);
    this.addObject(leftArm, vec3.fromValues(managerX - 0.28, 1.15, managerZ), [0.7, 0.2, 0.3, 1]);

    const rightArm = createBox(0.1, 0.45, 0.1);
    this.addObject(rightArm, vec3.fromValues(managerX + 0.28, 1.15, managerZ), [0.7, 0.2, 0.3, 1]);

    // Hands
    const leftHand = createBox(0.08, 0.1, 0.06);
    this.addObject(leftHand, vec3.fromValues(managerX - 0.28, 0.88, managerZ), [0.85, 0.7, 0.55, 1]);

    const rightHand = createBox(0.08, 0.1, 0.06);
    this.addObject(rightHand, vec3.fromValues(managerX + 0.28, 0.88, managerZ), [0.85, 0.7, 0.55, 1]);
  }

  private buildInteriorSigns() {
    // VHS glowing sign (visible through door)
    const vhsSign = createBox(0.5, 0.25, 0.04);
    this.addObject(vhsSign, vec3.fromValues(-0.3, 2.2, -3.5), [1.0, 0.3, 0.3, 1], 2.0);

    // "manager" sign text placeholder
    const managerSign = createBox(0.6, 0.15, 0.03);
    this.addObject(managerSign, vec3.fromValues(0.5, 2.3, -5.0), [0.9, 0.8, 0.3, 1], 1.5);

    // Ceiling lights (fluorescent tubes)
    const lightFixture = createBox(1.5, 0.08, 0.15);
    const lightTube = createBox(1.4, 0.04, 0.08);

    for (let z = -2; z >= -6; z -= 2) {
      this.addObject(lightFixture, vec3.fromValues(0, 3.75, z), [0.2, 0.2, 0.22, 1]);
      this.addObject(lightTube, vec3.fromValues(0, 3.7, z), [1.0, 0.95, 0.85, 1], 1.2);
    }
  }

  private buildBackground() {
    // Street lamp posts
    const lampPostColor: [number, number, number, number] = [0.08, 0.08, 0.1, 1];
    const lampLightColor: [number, number, number, number] = [1.0, 0.9, 0.7, 1];

    // Left street lamp
    const leftPost = createBox(0.15, 5, 0.15);
    this.addObject(leftPost, vec3.fromValues(-10, 2.5, 6), lampPostColor);
    const leftLampHead = createBox(0.4, 0.3, 0.25);
    this.addObject(leftLampHead, vec3.fromValues(-10, 5.15, 6), lampPostColor);
    const leftLight = createBox(0.25, 0.15, 0.15);
    this.addObject(leftLight, vec3.fromValues(-10, 5.0, 6), lampLightColor, 1.5);

    // Right street lamp
    const rightPost = createBox(0.15, 5, 0.15);
    this.addObject(rightPost, vec3.fromValues(10, 2.5, 6), lampPostColor);
    const rightLampHead = createBox(0.4, 0.3, 0.25);
    this.addObject(rightLampHead, vec3.fromValues(10, 5.15, 6), lampPostColor);
    const rightLight = createBox(0.25, 0.15, 0.15);
    this.addObject(rightLight, vec3.fromValues(10, 5.0, 6), lampLightColor, 1.5);

    // Adjacent building walls (simple dark shapes)
    const leftBuilding = createVerticalPlane(6, 6);
    const leftBuildObj = this.addObject(leftBuilding, vec3.fromValues(-10, 3, 0), [0.04, 0.04, 0.05, 1]);
    mat4.rotateY(leftBuildObj.modelMatrix, leftBuildObj.modelMatrix, Math.PI * 0.1);

    const rightBuilding = createVerticalPlane(6, 6);
    const rightBuildObj = this.addObject(rightBuilding, vec3.fromValues(10, 3, 0), [0.04, 0.04, 0.05, 1]);
    mat4.rotateY(rightBuildObj.modelMatrix, rightBuildObj.modelMatrix, -Math.PI * 0.1);

    // Sky backdrop (very dark)
    const skyBackdrop = createVerticalPlane(50, 15);
    this.addObject(skyBackdrop, vec3.fromValues(0, 7.5, -15), [0.01, 0.01, 0.02, 1]);
  }

  private setupControls() {
    // STATIC CAMERA - Only allow Enter key to transition
    // No mouse look or WASD movement

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key.toLowerCase() === 'e') {
        this.enterStore();
      }
    });

    // Click anywhere to enter
    this.canvas.addEventListener('click', () => {
      this.enterStore();
    });
  }

  private enterStore() {
    if (this.onEnterStore) {
      this.onEnterStore();
    }
  }

  resize(width: number, height: number) {
    this.camera.setAspect(width / height);
    this.depthTexture.destroy();
    this.depthTexture = this.device.createTexture({
      size: [width, height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.postProcessing.resize(width, height);
  }

  render(context: GPUCanvasContext) {
    const time = performance.now() / 1000;

    // Update uniforms
    const uniformData = new Float32Array(24);
    uniformData.set(this.camera.getViewProjectionMatrix(), 0);
    uniformData[16] = time;
    const camPos = this.camera.getPosition();
    uniformData[20] = camPos[0];
    uniformData[21] = camPos[1];
    uniformData[22] = camPos[2];
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

    const commandEncoder = this.device.createCommandEncoder();

    // Render to HDR texture
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: this.postProcessing.getSceneTextureView(),
        clearValue: { r: 0.005, g: 0.005, b: 0.012, a: 1 }, // Very dark night sky
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    // === Render opaque objects ===
    renderPass.setPipeline(this.colorPipeline);
    renderPass.setBindGroup(0, this.uniformBindGroup);

    this.objects.forEach((obj) => {
      const instanceData = new Float32Array(21);
      instanceData.set(obj.modelMatrix as Float32Array, 0);
      instanceData[16] = obj.color[0];
      instanceData[17] = obj.color[1];
      instanceData[18] = obj.color[2];
      instanceData[19] = obj.color[3];
      instanceData[20] = obj.emissive;

      const instanceBuffer = this.device.createBuffer({
        size: instanceData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(instanceBuffer, 0, instanceData);

      renderPass.setVertexBuffer(0, obj.vertexBuffer);
      renderPass.setVertexBuffer(1, instanceBuffer);
      renderPass.setIndexBuffer(obj.indexBuffer, 'uint16');
      renderPass.drawIndexed(obj.mesh.indices.length, 1);
    });

    // === Render textured objects ===
    renderPass.setPipeline(this.texturePipeline);
    renderPass.setBindGroup(0, this.uniformBindGroup);

    this.texturedObjects.forEach((obj) => {
      const objectData = new Float32Array(20);
      objectData.set(obj.modelMatrix as Float32Array, 0);
      objectData[16] = obj.emissive;

      const objectBuffer = this.device.createBuffer({
        size: 80,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(objectBuffer, 0, objectData);

      const bindGroup = this.device.createBindGroup({
        layout: this.textureBindGroupLayout,
        entries: [
          { binding: 0, resource: this.sampler },
          { binding: 1, resource: obj.texture.createView() },
          { binding: 2, resource: { buffer: objectBuffer } },
        ],
      });

      renderPass.setBindGroup(1, bindGroup);
      renderPass.setVertexBuffer(0, obj.vertexBuffer);
      renderPass.setIndexBuffer(obj.indexBuffer, 'uint16');
      renderPass.drawIndexed(obj.mesh.indices.length, 1);
    });

    // === Render glass (transparent, last) ===
    renderPass.setPipeline(this.glassPipeline);
    renderPass.setBindGroup(0, this.uniformBindGroup);

    this.glassObjects.forEach((obj) => {
      const instanceData = new Float32Array(21);
      instanceData.set(obj.modelMatrix as Float32Array, 0);
      instanceData[16] = obj.color[0];
      instanceData[17] = obj.color[1];
      instanceData[18] = obj.color[2];
      instanceData[19] = obj.color[3];
      instanceData[20] = 0;

      const instanceBuffer = this.device.createBuffer({
        size: instanceData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(instanceBuffer, 0, instanceData);

      renderPass.setVertexBuffer(0, obj.vertexBuffer);
      renderPass.setVertexBuffer(1, instanceBuffer);
      renderPass.setIndexBuffer(obj.indexBuffer, 'uint16');
      renderPass.drawIndexed(obj.mesh.indices.length, 1);
    });

    renderPass.end();

    // Apply post-processing
    const outputView = context.getCurrentTexture().createView();
    this.postProcessing.render(commandEncoder, outputView, time);

    this.device.queue.submit([commandEncoder.finish()]);
  }

  getCamera(): Camera {
    return this.camera;
  }
}
