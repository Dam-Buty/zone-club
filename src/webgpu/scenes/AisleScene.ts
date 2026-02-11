import { mat4, vec3 } from 'gl-matrix';
import { Camera } from '../core/Camera';
import { createPlane, createCeiling, createBox, createCassette, createVerticalPlane, type Mesh } from '../core/Geometry';
import { TextureLoader } from '../core/TextureLoader';
import { PostProcessing } from '../rendering/PostProcessing';

interface SceneObject {
  mesh: Mesh;
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  modelMatrix: mat4;
  color: [number, number, number, number];
  emissive: number;
  filmId?: number;
}

interface TexturedObject {
  mesh: Mesh;
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  modelMatrix: mat4;
  texture: GPUTexture;
  bindGroup: GPUBindGroup;
  emissive: number;
  filmId?: number;
}

// Film data for cassettes
interface FilmData {
  id: number;
  title: string;
  poster_path: string | null;
}

export class AisleScene {
  private device: GPUDevice;
  private _format: GPUTextureFormat;
  private camera: Camera;
  private objects: SceneObject[] = [];
  private texturedObjects: TexturedObject[] = [];
  private textureLoader: TextureLoader;

  // Uniforms
  private uniformBuffer: GPUBuffer;
  private uniformBindGroup!: GPUBindGroup;

  // Pipelines
  private colorPipeline!: GPURenderPipeline;
  private texturePipeline!: GPURenderPipeline;
  private textureBindGroupLayout!: GPUBindGroupLayout;
  private depthTexture!: GPUTexture;
  private sampler!: GPUSampler;

  // Post-processing
  private postProcessing!: PostProcessing;

  // Interaction
  hoveredCassette: number | null = null;
  private canvas: HTMLCanvasElement;

  // Film data
  private filmData: Map<number, FilmData> = new Map();

  constructor(device: GPUDevice, context: GPUCanvasContext, format: GPUTextureFormat) {
    this.device = device;
    this._format = format;
    this.canvas = context.canvas as HTMLCanvasElement;
    this.camera = new Camera(this.canvas.width / this.canvas.height);
    this.textureLoader = new TextureLoader(device);

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
    this.postProcessing = new PostProcessing(device, format, this.canvas.width, this.canvas.height);
    this.buildScene();
    this.setupControls();

    // Load film data and cassette textures
    this.loadFilmData();
  }

  private createPipelines(device: GPUDevice, _format: GPUTextureFormat) {
    // === COLOR PIPELINE (for untextured objects) ===
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

      // === NOISE FUNCTIONS FOR PROCEDURAL TEXTURES ===
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
        for (var i = 0; i < 4; i = i + 1) {
          value = value + amplitude * noise2D(pos);
          pos = pos * 2.0;
          amplitude = amplitude * 0.5;
        }
        return value;
      }

      // Wood grain texture
      fn woodTexture(p: vec2f, baseColor: vec3f) -> vec3f {
        let grain = sin(p.x * 30.0 + noise2D(p * 5.0) * 8.0) * 0.5 + 0.5;
        let rings = sin(length(p * 10.0) + noise2D(p * 2.0) * 3.0) * 0.5 + 0.5;
        let variation = fbm(p * 8.0) * 0.3;
        let wood = mix(baseColor * 0.7, baseColor * 1.2, grain * 0.5 + rings * 0.3 + variation);
        return wood;
      }

      // Concrete/wall texture
      fn concreteTexture(p: vec2f, baseColor: vec3f) -> vec3f {
        let noise1 = fbm(p * 15.0);
        let noise2 = fbm(p * 30.0) * 0.5;
        let cracks = smoothstep(0.4, 0.5, fbm(p * 8.0 + vec2f(42.0, 17.0)));
        var concrete = baseColor * (0.85 + noise1 * 0.2 + noise2 * 0.1);
        concrete = mix(concrete, concrete * 0.7, cracks * 0.3);
        // Stains
        let stain = smoothstep(0.6, 0.8, fbm(p * 3.0));
        concrete = mix(concrete, concrete * vec3f(0.9, 0.85, 0.8), stain * 0.2);
        return concrete;
      }

      // Tile texture with grout
      fn tileTexture(p: vec2f, baseColor: vec3f) -> vec3f {
        let tileSize = 2.0;
        let tilePos = fract(p * tileSize);
        let tileId = floor(p * tileSize);

        // Grout lines
        let groutWidth = 0.04;
        let groutX = smoothstep(0.0, groutWidth, tilePos.x) * (1.0 - smoothstep(1.0 - groutWidth, 1.0, tilePos.x));
        let groutY = smoothstep(0.0, groutWidth, tilePos.y) * (1.0 - smoothstep(1.0 - groutWidth, 1.0, tilePos.y));
        let grout = groutX * groutY;

        // Tile color variation per tile
        let tileVariation = hash2(tileId) * 0.15 - 0.075;

        // Surface imperfections
        let scratches = fbm(p * 50.0) * 0.1;
        let dirt = fbm(p * 10.0 + vec2f(100.0, 50.0)) * 0.08;

        var tileColor = baseColor * (1.0 + tileVariation);
        tileColor = tileColor * (1.0 - scratches - dirt);

        // Grout color (darker)
        let groutColor = vec3f(0.15, 0.14, 0.13);

        return mix(groutColor, tileColor, grout);
      }

      // Ceiling tile texture (acoustic panels)
      fn ceilingTexture(p: vec2f, baseColor: vec3f) -> vec3f {
        let panelSize = 1.5;
        let panelPos = fract(p * panelSize);
        let panelId = floor(p * panelSize);

        // Panel grid
        let edgeWidth = 0.02;
        let edgeX = smoothstep(0.0, edgeWidth, panelPos.x) * (1.0 - smoothstep(1.0 - edgeWidth, 1.0, panelPos.x));
        let edgeY = smoothstep(0.0, edgeWidth, panelPos.y) * (1.0 - smoothstep(1.0 - edgeWidth, 1.0, panelPos.y));
        let panel = edgeX * edgeY;

        // Acoustic holes pattern
        let holePattern = sin(panelPos.x * 40.0) * sin(panelPos.y * 40.0);
        let holes = smoothstep(0.3, 0.5, holePattern) * 0.15;

        // Variation
        let variation = hash2(panelId) * 0.1 - 0.05;

        var ceilingColor = baseColor * (1.0 + variation);
        ceilingColor = ceilingColor * (1.0 - holes);

        // Metal frame
        let frameColor = vec3f(0.3, 0.3, 0.32);
        return mix(frameColor, ceilingColor, panel);
      }

      // Brick wall texture
      fn brickTexture(p: vec2f, baseColor: vec3f) -> vec3f {
        let brickSize = vec2f(1.0, 0.5);
        let offset = step(1.0, (floor(p.y / brickSize.y) % 2.0)) * 0.5;
        let brickPos = fract(vec2f(p.x / brickSize.x + offset, p.y / brickSize.y));
        let brickId = floor(vec2f(p.x / brickSize.x + offset, p.y / brickSize.y));

        // Mortar
        let mortarWidth = 0.08;
        let mortarX = smoothstep(0.0, mortarWidth, brickPos.x) * (1.0 - smoothstep(1.0 - mortarWidth, 1.0, brickPos.x));
        let mortarY = smoothstep(0.0, mortarWidth, brickPos.y) * (1.0 - smoothstep(1.0 - mortarWidth, 1.0, brickPos.y));
        let brick = mortarX * mortarY;

        // Brick color variation
        let brickVariation = hash2(brickId) * 0.3 - 0.15;
        let brickNoise = fbm(p * 20.0) * 0.1;

        var brickColor = baseColor * (1.0 + brickVariation + brickNoise);

        // Mortar color
        let mortarColor = vec3f(0.6, 0.58, 0.55);

        return mix(mortarColor, brickColor, brick);
      }

      // Carpet texture
      fn carpetTexture(p: vec2f, baseColor: vec3f) -> vec3f {
        let fiberNoise = fbm(p * 100.0) * 0.15;
        let patternNoise = fbm(p * 5.0) * 0.1;
        let wear = smoothstep(0.3, 0.7, fbm(p * 2.0 + vec2f(50.0, 30.0))) * 0.15;
        return baseColor * (1.0 + fiberNoise + patternNoise - wear);
      }

      // Metal texture
      fn metalTexture(p: vec2f, baseColor: vec3f) -> vec3f {
        let brushed = sin(p.x * 200.0 + noise2D(p * 50.0) * 2.0) * 0.05;
        let scratches = fbm(p * 80.0) * 0.08;
        let spots = smoothstep(0.7, 0.8, fbm(p * 15.0)) * 0.1;
        return baseColor * (1.0 + brushed - scratches - spots);
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

      // Point light calculation with attenuation
      fn pointLight(lightPos: vec3f, lightColor: vec3f, intensity: f32, worldPos: vec3f, normal: vec3f, viewDir: vec3f, roughness: f32) -> vec3f {
        let lightDir = lightPos - worldPos;
        let distance = length(lightDir);
        let L = normalize(lightDir);
        let N = normalize(normal);

        // Attenuation (inverse square with linear falloff)
        let attenuation = intensity / (1.0 + 0.09 * distance + 0.032 * distance * distance);

        // Diffuse (Lambertian)
        let diff = max(dot(N, L), 0.0);

        // Specular (Blinn-Phong)
        let H = normalize(L + viewDir);
        let shininess = mix(8.0, 64.0, 1.0 - roughness);
        let spec = pow(max(dot(N, H), 0.0), shininess) * (1.0 - roughness);

        return lightColor * attenuation * (diff + spec * 0.5);
      }

      @fragment
      fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
        let N = normalize(input.normal);
        let viewDir = normalize(uniforms.cameraPos - input.worldPos);

        // Material properties based on color brightness
        let brightness = dot(input.color.rgb, vec3f(0.299, 0.587, 0.114));
        let roughness = mix(0.7, 0.95, brightness); // Darker = shinier
        let metallic = select(0.0, 0.3, brightness < 0.2);

        // === AMBIENT LIGHTING (bright commercial store) ===
        // Strong warm ambient for well-lit retail store
        let skyColor = vec3f(0.45, 0.42, 0.38); // Bright warm
        let groundColor = vec3f(0.25, 0.28, 0.35); // Reflected blue from floor
        let hemisphereBlend = N.y * 0.5 + 0.5;
        var ambient = mix(groundColor, skyColor, hemisphereBlend);

        // Subtle ambient occlusion (less aggressive)
        let aoFactor = smoothstep(0.0, 1.5, input.worldPos.y) * 0.15 + 0.85;
        ambient = ambient * aoFactor;

        // === MAIN DIRECTIONAL LIGHTS (overhead fluorescent) ===
        let mainLight = normalize(vec3f(0.0, 1.0, 0.2));
        let mainColor = vec3f(1.0, 0.98, 0.94); // Bright white fluorescent
        let mainDiff = max(dot(N, mainLight), 0.0);
        let mainH = normalize(mainLight + viewDir);
        let mainSpec = pow(max(dot(N, mainH), 0.0), 32.0) * (1.0 - roughness) * 0.4;

        let fillLight = normalize(vec3f(0.3, 0.5, 0.8));
        let fillColor = vec3f(0.9, 0.92, 0.95); // Cool white fill
        let fillDiff = max(dot(N, fillLight), 0.0) * 0.5;

        var lighting = ambient;
        lighting = lighting + mainColor * (mainDiff * 0.7 + mainSpec);
        lighting = lighting + fillColor * fillDiff;

        // === CEILING FLUORESCENT LIGHTS (commercial store) ===
        // Main central row of lights
        for (var i = -5; i <= 5; i = i + 1) {
          let lightZ = f32(i) * 2.8;
          lighting = lighting + pointLight(
            vec3f(0.0, 3.4, lightZ),
            vec3f(1.0, 0.98, 0.94), 5.0,
            input.worldPos, N, viewDir, roughness
          );
        }

        // Side rows of lights
        for (var i = -4; i <= 4; i = i + 1) {
          let lightZ = f32(i) * 3.2;
          // Left side lights
          lighting = lighting + pointLight(
            vec3f(-5.0, 3.4, lightZ),
            vec3f(1.0, 0.98, 0.94), 3.5,
            input.worldPos, N, viewDir, roughness
          );
          // Right side lights
          lighting = lighting + pointLight(
            vec3f(5.0, 3.4, lightZ),
            vec3f(1.0, 0.98, 0.94), 3.5,
            input.worldPos, N, viewDir, roughness
          );
        }

        // Subtle accent lighting near shelves (very subtle color, mostly white)
        lighting = lighting + pointLight(vec3f(-2.5, 2.0, input.worldPos.z), vec3f(1.0, 0.95, 0.9), 1.0, input.worldPos, N, viewDir, roughness);
        lighting = lighting + pointLight(vec3f(2.5, 2.0, input.worldPos.z), vec3f(1.0, 0.95, 0.9), 1.0, input.worldPos, N, viewDir, roughness);

        // Sign area lighting
        lighting = lighting + pointLight(vec3f(0.0, 3.3, -14.0), vec3f(1.0, 0.98, 0.92), 4.0, input.worldPos, N, viewDir, roughness);

        // === APPLY PROCEDURAL TEXTURES BASED ON SURFACE TYPE ===
        var baseColor = input.color.rgb;
        let texCoordXZ = vec2f(input.worldPos.x, input.worldPos.z);
        let texCoordXY = vec2f(input.worldPos.x, input.worldPos.y);
        let texCoordYZ = vec2f(input.worldPos.y, input.worldPos.z);

        // FLOOR (horizontal surface at ground level) - BLACK/WHITE CHECKERED (90s style)
        if (N.y > 0.9 && input.worldPos.y < 0.1) {
          // Checkerboard pattern - larger tiles for 90s video store look
          let tileSize = 0.8; // 80cm tiles
          let tileX = floor(input.worldPos.x / tileSize);
          let tileZ = floor(input.worldPos.z / tileSize);
          let isBlack = ((i32(tileX) + i32(tileZ)) % 2) == 0;

          // Base colors for tiles
          let blackTile = vec3f(0.08, 0.08, 0.1);
          let whiteTile = vec3f(0.92, 0.92, 0.9);
          var tileColor = select(whiteTile, blackTile, isBlack);

          // Add subtle tile variation and wear
          let tilePos = fract(vec2f(input.worldPos.x, input.worldPos.z) / tileSize);
          let tileVariation = hash2(vec2f(tileX, tileZ)) * 0.08 - 0.04;
          tileColor = tileColor * (1.0 + tileVariation);

          // Grout lines between tiles
          let groutWidth = 0.015;
          let groutX = smoothstep(0.0, groutWidth, tilePos.x) * (1.0 - smoothstep(1.0 - groutWidth, 1.0, tilePos.x));
          let groutZ = smoothstep(0.0, groutWidth, tilePos.y) * (1.0 - smoothstep(1.0 - groutWidth, 1.0, tilePos.y));
          let groutMask = groutX * groutZ;
          let groutColor = vec3f(0.35, 0.35, 0.33);
          tileColor = mix(groutColor, tileColor, groutMask);

          // Slight scuff marks and wear
          let scuffs = fbm(texCoordXZ * 12.0) * 0.06;
          baseColor = tileColor * (1.0 - scuffs);

          // Floor reflection (glossy tiles)
          let reflectDir = reflect(-viewDir, N);
          let envColor = mix(vec3f(0.1, 0.1, 0.12), vec3f(0.25, 0.25, 0.28), reflectDir.y * 0.5 + 0.5);
          let fresnel = pow(1.0 - max(dot(viewDir, N), 0.0), 4.0) * 0.2;
          baseColor = mix(baseColor, baseColor + envColor, fresnel);
        }
        // CEILING (horizontal surface at top) - GRAY INDUSTRIAL with neon lighting
        else if (N.y < -0.9 && input.worldPos.y > 3.0) {
          // Industrial gray ceiling with acoustic panel texture
          let ceilingBase = vec3f(0.45, 0.45, 0.48); // Industrial gray
          baseColor = ceilingTexture(texCoordXZ * 0.5, ceilingBase);
        }
        // WALLS (vertical surfaces) - WHITE clean walls
        else if (abs(N.y) < 0.1) {
          // White wall base color
          let wallWhite = vec3f(0.95, 0.95, 0.93); // Clean white

          // Back wall - white
          if (input.worldPos.z < -14.0) {
            baseColor = concreteTexture(texCoordXY * 0.5, wallWhite);
            // Subtle wear
            let chips = smoothstep(0.7, 0.75, fbm(texCoordXY * 4.0));
            baseColor = mix(baseColor, baseColor * 0.95, chips * 0.15);
          }
          // Side walls - white
          else if (abs(input.worldPos.x) > 9.0) {
            baseColor = concreteTexture(texCoordYZ * 0.5, wallWhite);
            // Subtle texture variation
            let variation = fbm(texCoordYZ * 3.0) * 0.05;
            baseColor = baseColor * (1.0 - variation);
          }
          // Front wall - white
          else if (input.worldPos.z > 14.0) {
            baseColor = concreteTexture(texCoordXY * 0.5, wallWhite);
          }
          // Shelf backs and furniture - keep original darker color for contrast
          else if (input.color.r < 0.2 && input.color.g < 0.2) {
            // Dark metal shelving
            baseColor = metalTexture(texCoordYZ * 5.0, input.color.rgb);
          }
        }
        // SHELVES AND FURNITURE (horizontal wood surfaces)
        else if (N.y > 0.9 && input.worldPos.y > 0.3 && input.worldPos.y < 3.5) {
          // Wood shelves
          if (input.color.r > 0.1 && input.color.g < input.color.r) {
            baseColor = woodTexture(texCoordXZ * 3.0, input.color.rgb * 1.2);
            // Varnish shine
            let varnish = pow(max(dot(reflect(-viewDir, N), vec3f(0.0, 1.0, 0.0)), 0.0), 16.0) * 0.2;
            baseColor = baseColor + vec3f(varnish);
          }
        }
        // COUNTER TOP
        else if (N.y > 0.9 && input.worldPos.y > 0.9 && input.worldPos.y < 1.2 && input.worldPos.z > 11.0) {
          // Laminate counter with wood grain
          baseColor = woodTexture(texCoordXZ * 4.0, vec3f(0.4, 0.28, 0.18));
          // Glossy laminate finish
          let gloss = pow(max(dot(reflect(-viewDir, N), vec3f(0.3, 0.9, 0.3)), 0.0), 32.0) * 0.3;
          baseColor = baseColor + vec3f(gloss);
          // Ring stains from cups
          let stain1 = 1.0 - smoothstep(0.08, 0.1, length(texCoordXZ - vec2f(-0.5, 12.2)));
          let stain2 = 1.0 - smoothstep(0.06, 0.08, length(texCoordXZ - vec2f(0.3, 11.9)));
          baseColor = baseColor * (1.0 - (stain1 + stain2) * 0.15);
        }
        // METAL SURFACES (cash register, fixtures)
        else if (brightness < 0.2 && input.emissive < 0.1) {
          baseColor = metalTexture(texCoordXZ * 10.0, input.color.rgb);
        }

        var finalColor = baseColor * lighting;

        // === EMISSIVE OBJECTS (Neons, signs) ===
        if (input.emissive > 0.1) {
          // Neon glow with flicker
          let flicker = sin(uniforms.time * 8.0 + input.worldPos.x) * 0.03
                      + sin(uniforms.time * 13.0 + input.worldPos.z) * 0.02
                      + sin(uniforms.time * 3.0) * 0.01;
          let flickerMult = 0.95 + flicker;

          // Bloom simulation (oversaturate emissive)
          let emissiveColor = input.color.rgb * input.emissive * flickerMult;
          let bloom = emissiveColor * smoothstep(0.5, 2.0, input.emissive) * 0.5;

          finalColor = finalColor + emissiveColor + bloom;

          // Glow halo effect
          if (input.emissive > 1.5) {
            finalColor = finalColor * 1.1;
          }
        }

        // === LIGHT ATMOSPHERIC FOG (depth cue only) ===
        let distFromCamera = length(input.worldPos - uniforms.cameraPos);
        let fogColor = vec3f(0.92, 0.90, 0.85); // Light warm fog (store haze)
        let fogDensity = 1.0 - exp(-distFromCamera * 0.015);
        let fogAmount = smoothstep(0.0, 1.0, fogDensity) * 0.25;
        finalColor = mix(finalColor, fogColor, fogAmount);

        // === VERY SUBTLE VIGNETTE (almost none) ===
        let viewAngle = dot(viewDir, vec3f(0.0, 0.0, -1.0));
        let vignette = smoothstep(0.1, 0.9, abs(viewAngle)) * 0.05 + 0.95;
        finalColor = finalColor * vignette;

        // === TONE MAPPING (simple Reinhard) ===
        finalColor = finalColor / (finalColor + vec3f(1.0));

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

    // === TEXTURE PIPELINE (for cassettes and signs) ===
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

      // Point light for textured objects
      fn texPointLight(lightPos: vec3f, lightColor: vec3f, intensity: f32, worldPos: vec3f, normal: vec3f, viewDir: vec3f) -> vec3f {
        let lightDir = lightPos - worldPos;
        let distance = length(lightDir);
        let L = normalize(lightDir);
        let N = normalize(normal);
        let attenuation = intensity / (1.0 + 0.09 * distance + 0.032 * distance * distance);
        let diff = max(dot(N, L), 0.0);
        let H = normalize(L + viewDir);
        let spec = pow(max(dot(N, H), 0.0), 16.0) * 0.3;
        return lightColor * attenuation * (diff + spec);
      }

      @fragment
      fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
        var texColor = textureSample(texImage, texSampler, input.uv);
        let N = normalize(input.normal);
        let viewDir = normalize(uniforms.cameraPos - input.worldPos);

        // === AMBIENT LIGHTING ===
        let skyColor = vec3f(0.03, 0.03, 0.06);
        let groundColor = vec3f(0.01, 0.01, 0.02);
        let hemisphereBlend = N.y * 0.5 + 0.5;
        var ambient = mix(groundColor, skyColor, hemisphereBlend);

        // === DIRECTIONAL LIGHTS ===
        let mainLight = normalize(vec3f(0.2, 0.8, 0.3));
        let mainColor = vec3f(0.9, 0.85, 0.8);
        let mainDiff = max(dot(N, mainLight), 0.0);
        let mainH = normalize(mainLight + viewDir);
        let mainSpec = pow(max(dot(N, mainH), 0.0), 32.0) * 0.2;

        let fillLight = normalize(vec3f(-0.5, 0.3, -0.4));
        let fillColor = vec3f(0.4, 0.5, 0.7);
        let fillDiff = max(dot(N, fillLight), 0.0) * 0.25;

        var lighting = ambient;
        lighting = lighting + mainColor * (mainDiff * 0.3 + mainSpec);
        lighting = lighting + fillColor * fillDiff;

        // === NEON POINT LIGHTS ===
        lighting = lighting + texPointLight(vec3f(-2.0, 0.1, input.worldPos.z), vec3f(1.0, 0.18, 0.58), 2.0, input.worldPos, N, viewDir);
        lighting = lighting + texPointLight(vec3f(2.0, 0.1, input.worldPos.z), vec3f(0.0, 1.0, 0.97), 2.0, input.worldPos, N, viewDir);

        // Ceiling lights
        for (var i = -4; i <= 3; i = i + 1) {
          let lightZ = f32(i) * 3.0;
          lighting = lighting + texPointLight(vec3f(0.0, 3.8, lightZ), vec3f(1.0, 0.95, 0.85), 2.5, input.worldPos, N, viewDir);
        }

        // Corner neons
        lighting = lighting + texPointLight(vec3f(-9.5, 1.75, -14.5), vec3f(1.0, 0.18, 0.58), 3.0, input.worldPos, N, viewDir);
        lighting = lighting + texPointLight(vec3f(9.5, 1.75, -14.5), vec3f(0.0, 1.0, 0.97), 3.0, input.worldPos, N, viewDir);

        // === APPLY LIGHTING ===
        var finalColor = texColor.rgb * lighting;

        // === EMISSIVE (for neon signs) ===
        if (input.emissive > 0.0) {
          let flicker = sin(uniforms.time * 8.0 + input.worldPos.x * 2.0) * 0.04
                      + sin(uniforms.time * 13.0) * 0.02 + 0.96;

          let emissiveColor = texColor.rgb * input.emissive * flicker;
          let bloom = emissiveColor * smoothstep(0.5, 2.0, input.emissive) * 0.4;
          finalColor = finalColor + emissiveColor + bloom;
        }

        // === ATMOSPHERIC FOG ===
        let distFromCamera = length(input.worldPos - uniforms.cameraPos);
        let fogColor = vec3f(0.02, 0.015, 0.04);
        let fogDensity = 1.0 - exp(-distFromCamera * 0.025);
        let fogAmount = smoothstep(0.0, 1.0, fogDensity) * 0.5;
        finalColor = mix(finalColor, fogColor, fogAmount);

        // === TONE MAPPING ===
        finalColor = finalColor / (finalColor + vec3f(1.0));

        // === GAMMA CORRECTION ===
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

  private addTexturedObject(
    mesh: Mesh,
    position: vec3,
    texture: GPUTexture,
    emissive: number = 0,
    scale: vec3 = vec3.fromValues(1, 1, 1),
    filmId?: number
  ): TexturedObject {
    const { vertexBuffer, indexBuffer } = this.createBuffer(mesh);

    const modelMatrix = mat4.create();
    mat4.translate(modelMatrix, modelMatrix, position);
    mat4.scale(modelMatrix, modelMatrix, scale);

    // Create uniform buffer for this object
    const objectBuffer = this.device.createBuffer({
      size: 80, // mat4 (64) + emissive (4) + padding (12)
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

    const obj: TexturedObject = {
      mesh, vertexBuffer, indexBuffer, modelMatrix, texture, bindGroup, emissive, filmId
    };
    this.texturedObjects.push(obj);
    return obj;
  }

  private async loadFilmData() {
    const API_KEY = process.env.NEXT_PUBLIC_TMDB_API_KEY;
    if (!API_KEY) return;

    // Film IDs to load
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

    // Create cassette textures with poster images
    this.buildTexturedCassettes();
    this.buildTexturedSigns();
  }

  private async buildTexturedCassettes() {
    const cassetteMesh = createCassette();
    const filmIds = Array.from(this.filmData.keys());
    let filmIndex = 0;

    // === CENTRAL GONDOLA (K7 on both sides) ===
    // Room: 10m x 15m, gondola 5m long centered at z=-1
    const gondolaX = 0;
    const gondolaZ = -1;
    const gondolaLength = 5;

    for (const side of ['left', 'right'] as const) {
      const direction = side === 'left' ? -1 : 1;
      const xOffset = gondolaX + direction * 0.08;

      // 6 levels of shelves
      for (let level = 0; level < 6; level++) {
        const y = 0.15 + level * 0.22;

        // Fill the gondola length with cassettes (~25 per row)
        for (let i = 0; i < 25; i++) {
          const z = gondolaZ - gondolaLength / 2 + 0.3 + i * 0.18;
          const filmId = filmIds[filmIndex % filmIds.length];
          const film = this.filmData.get(filmId);

          if (film) {
            const posterUrl = film.poster_path
              ? `https://image.tmdb.org/t/p/w185${film.poster_path}`
              : null;

            const texture = await this.textureLoader.createCassettePosterTexture(posterUrl, film.title);
            const cassettePos = vec3.fromValues(xOffset, y + 0.1, z);
            const obj = this.addTexturedObject(cassetteMesh, cassettePos, texture, 0, vec3.fromValues(1, 1, 1), filmId);

            // Rotate cassette to face outward from gondola
            mat4.rotateY(obj.modelMatrix, obj.modelMatrix, direction > 0 ? -Math.PI / 2 : Math.PI / 2);
          }
          filmIndex++;
        }
      }
    }

    // === WALL SHELVES ===
    await this.buildWallCassettes(cassetteMesh, filmIds, filmIndex);
  }

  private async buildWallCassettes(
    cassetteMesh: { vertices: Float32Array; indices: Uint16Array },
    filmIds: number[],
    startIndex: number
  ) {
    let filmIndex = startIndex;
    // Room: 10m x 15m, walls at +/-5 (x) and +/-7.5 (z)

    // === BACK WALL (facing into the store, z=-7.5) ===
    for (let level = 0; level < 7; level++) {
      const y = 0.18 + level * 0.23;

      for (let i = 0; i < 45; i++) {
        const x = -4 + i * 0.18;
        const filmId = filmIds[filmIndex % filmIds.length];
        const film = this.filmData.get(filmId);

        if (film) {
          const posterUrl = film.poster_path
            ? `https://image.tmdb.org/t/p/w185${film.poster_path}`
            : null;

          const texture = await this.textureLoader.createCassettePosterTexture(posterUrl, film.title);
          const cassettePos = vec3.fromValues(x, y + 0.1, -7.15);
          this.addTexturedObject(cassetteMesh, cassettePos, texture, 0, vec3.fromValues(1, 1, 1), filmId);
        }
        filmIndex++;
      }
    }

    // === LEFT WALL (facing right, x=-5) ===
    for (let level = 0; level < 7; level++) {
      const y = 0.18 + level * 0.23;

      for (let i = 0; i < 50; i++) {
        const z = -6 + i * 0.18;
        const filmId = filmIds[filmIndex % filmIds.length];
        const film = this.filmData.get(filmId);

        if (film) {
          const posterUrl = film.poster_path
            ? `https://image.tmdb.org/t/p/w185${film.poster_path}`
            : null;

          const texture = await this.textureLoader.createCassettePosterTexture(posterUrl, film.title);
          const cassettePos = vec3.fromValues(-4.65, y + 0.1, z);
          const obj = this.addTexturedObject(cassetteMesh, cassettePos, texture, 0, vec3.fromValues(1, 1, 1), filmId);
          mat4.rotateY(obj.modelMatrix, obj.modelMatrix, Math.PI / 2);
        }
        filmIndex++;
      }
    }

    // === RIGHT WALL (facing left, x=5) ===
    for (let level = 0; level < 7; level++) {
      const y = 0.18 + level * 0.23;

      for (let i = 0; i < 50; i++) {
        const z = -6 + i * 0.18;
        const filmId = filmIds[filmIndex % filmIds.length];
        const film = this.filmData.get(filmId);

        if (film) {
          const posterUrl = film.poster_path
            ? `https://image.tmdb.org/t/p/w185${film.poster_path}`
            : null;

          const texture = await this.textureLoader.createCassettePosterTexture(posterUrl, film.title);
          const cassettePos = vec3.fromValues(4.65, y + 0.1, z);
          const obj = this.addTexturedObject(cassetteMesh, cassettePos, texture, 0, vec3.fromValues(1, 1, 1), filmId);
          mat4.rotateY(obj.modelMatrix, obj.modelMatrix, -Math.PI / 2);
        }
        filmIndex++;
      }
    }
  }

  private buildTexturedSigns() {
    // Main "VIDEOCLUB" sign on back wall (adjusted for 4m ceiling)
    const signMesh = createVerticalPlane(2.5, 0.7);

    const videoTexture = this.textureLoader.createTextTexture('VIDEO', {
      width: 256,
      height: 128,
      fontSize: 72,
      color: '#ff2d95',
      glowColor: '#ff2d95',
      backgroundColor: '#0a0a0f',
    });
    // Room: 10m x 15m, back wall at z=-7.5
    this.addTexturedObject(signMesh, vec3.fromValues(-1.2, 2.6, -7.35), videoTexture, 2.5);

    const clubTexture = this.textureLoader.createTextTexture('CLUB', {
      width: 256,
      height: 128,
      fontSize: 72,
      color: '#00fff7',
      glowColor: '#00fff7',
      backgroundColor: '#0a0a0f',
    });
    this.addTexturedObject(signMesh, vec3.fromValues(1.2, 2.6, -7.35), clubTexture, 2.5);

    // Genre signs above central gondola (gondola at z=-1, length 5m)
    const genreSignMesh = createVerticalPlane(1.0, 0.3);
    const gondolaGenres = [
      { text: 'ACTION', color: '#ff2d95', z: -3 },
      { text: 'SCI-FI', color: '#00ccff', z: -1 },
      { text: 'COMEDIE', color: '#ffcc00', z: 1 },
    ];

    gondolaGenres.forEach(genre => {
      const texture = this.textureLoader.createTextTexture(genre.text, {
        width: 256,
        height: 64,
        fontSize: 36,
        color: genre.color,
        glowColor: genre.color,
        backgroundColor: '#1a1a2a',
      });
      // Hanging sign above gondola
      this.addTexturedObject(genreSignMesh, vec3.fromValues(0, 1.65, genre.z), texture, 1.8);
    });

    // Wall genre signs (left wall at x=-5)
    const wallGenreSignMesh = createVerticalPlane(0.9, 0.3);
    const leftWallGenres = [
      { text: 'DRAME', color: '#b026ff', z: -4 },
      { text: 'CLASSIQUES', color: '#00ff66', z: 0 },
      { text: 'THRILLER', color: '#ff6600', z: 3 },
    ];

    leftWallGenres.forEach(genre => {
      const texture = this.textureLoader.createTextTexture(genre.text, {
        width: 256,
        height: 64,
        fontSize: 32,
        color: genre.color,
        glowColor: genre.color,
        backgroundColor: '#1a1a2a',
      });
      const sign = this.addTexturedObject(wallGenreSignMesh, vec3.fromValues(-4.85, 2.1, genre.z), texture, 1.5);
      mat4.rotateY(sign.modelMatrix, sign.modelMatrix, Math.PI / 2);
    });

    // Wall genre signs (right wall at x=5)
    const rightWallGenres = [
      { text: 'ROMANCE', color: '#ff66b2', z: -4 },
      { text: 'AVENTURE', color: '#33ff99', z: 0 },
      { text: 'ANIMATION', color: '#ff9933', z: 3 },
    ];

    rightWallGenres.forEach(genre => {
      const texture = this.textureLoader.createTextTexture(genre.text, {
        width: 256,
        height: 64,
        fontSize: 32,
        color: genre.color,
        glowColor: genre.color,
        backgroundColor: '#1a1a2a',
      });
      const sign = this.addTexturedObject(wallGenreSignMesh, vec3.fromValues(4.85, 2.1, genre.z), texture, 1.5);
      mat4.rotateY(sign.modelMatrix, sign.modelMatrix, -Math.PI / 2);
    });

    // "OPEN" sign near entrance (front wall at z=7.5)
    const openTexture = this.textureLoader.createTextTexture('OPEN', {
      width: 128,
      height: 64,
      fontSize: 40,
      color: '#00ff66',
      glowColor: '#00ff66',
      backgroundColor: '#0a0a0f',
    });
    const openSignMesh = createVerticalPlane(0.8, 0.28);
    this.addTexturedObject(openSignMesh, vec3.fromValues(-3, 2.3, 7.35), openTexture, 3.0);

    // "NOUVEAUTÉS" sign above back wall shelves (back wall at z=-7.5)
    const nouveautesTexture = this.textureLoader.createTextTexture('NOUVEAUTÉS', {
      width: 256,
      height: 64,
      fontSize: 32,
      color: '#ffd700',
      glowColor: '#ffd700',
      backgroundColor: '#1a1a2a',
    });
    const nouveautesMesh = createVerticalPlane(1.8, 0.4);
    this.addTexturedObject(nouveautesMesh, vec3.fromValues(0, 2.0, -7.3), nouveautesTexture, 2.0);
  }

  private buildScene() {
    // === ROOM STRUCTURE (90s Video Club Style) ===
    // Room dimensions: 10m x 15m (scaled down to match floor plan)
    const roomWidth = 10;
    const roomDepth = 15;
    const ceilingHeight = 3.5;

    // Floor - checkered pattern is rendered in shader, base color is gray
    const floor = createPlane(roomWidth, roomDepth, 5, 8);
    this.addObject(floor, vec3.fromValues(0, 0, 0), [0.5, 0.5, 0.5, 1]);

    // Ceiling - industrial gray
    const ceiling = createCeiling(roomWidth, roomDepth, 2, 3);
    this.addObject(ceiling, vec3.fromValues(0, ceilingHeight, 0), [0.45, 0.45, 0.48, 1]);

    // Ceiling trim/border - industrial dark gray
    const trimColor: [number, number, number, number] = [0.25, 0.25, 0.28, 1];
    const ceilingTrimFront = createBox(roomWidth, 0.15, 0.06);
    this.addObject(ceilingTrimFront, vec3.fromValues(0, ceilingHeight - 0.1, -roomDepth / 2), trimColor);
    this.addObject(ceilingTrimFront, vec3.fromValues(0, ceilingHeight - 0.1, roomDepth / 2), trimColor);
    const ceilingTrimSide = createBox(0.06, 0.15, roomDepth);
    this.addObject(ceilingTrimSide, vec3.fromValues(-roomWidth / 2, ceilingHeight - 0.1, 0), trimColor);
    this.addObject(ceilingTrimSide, vec3.fromValues(roomWidth / 2, ceilingHeight - 0.1, 0), trimColor);

    // Walls - white
    const wallColor: [number, number, number, number] = [0.95, 0.95, 0.93, 1];

    // Back wall (fond)
    const backWall = createVerticalPlane(roomWidth, ceilingHeight + 0.5);
    this.addObject(backWall, vec3.fromValues(0, ceilingHeight / 2, -roomDepth / 2), wallColor);

    // Left wall (étagères murales)
    const leftWall = createVerticalPlane(roomDepth, ceilingHeight + 0.5);
    const leftWallObj = this.addObject(leftWall, vec3.fromValues(-roomWidth / 2, ceilingHeight / 2, 0), wallColor);
    mat4.rotateY(leftWallObj.modelMatrix, leftWallObj.modelMatrix, Math.PI / 2);

    // Right wall (étagères murales)
    const rightWall = createVerticalPlane(roomDepth, ceilingHeight + 0.5);
    const rightWallObj = this.addObject(rightWall, vec3.fromValues(roomWidth / 2, ceilingHeight / 2, 0), wallColor);
    mat4.rotateY(rightWallObj.modelMatrix, rightWallObj.modelMatrix, -Math.PI / 2);

    // Front wall (entrée à gauche, comptoir zone à droite)
    const frontWall = createVerticalPlane(roomWidth, ceilingHeight + 0.5);
    this.addObject(frontWall, vec3.fromValues(0, ceilingHeight / 2, roomDepth / 2), wallColor);

    // === CENTRAL GONDOLA (1.5m height, K7 on both sides) ===
    this.buildCentralGondola();

    // === WALL SHELVES (left, back, right walls) ===
    this.buildWallShelves();

    // === COUNTER (bottom right, near entrance) ===
    this.buildCounter();

    // === LIGHTING ===
    this.buildNeonDecorations();
    this.buildCeilingLights();

    // Decorative elements
    this.buildDecorations();
  }

  // === CENTRAL GONDOLA ===
  // Double-sided shelf unit in the center of the store (~1.5m height)
  // K7 cassettes on both sides, accessible from both aisles
  private buildCentralGondola() {
    const metalBlack: [number, number, number, number] = [0.08, 0.08, 0.1, 1];
    const gondolaX = 0; // Centered
    const gondolaLength = 5; // 5m long (scaled down)
    const gondolaHeight = 1.5; // 1.5m height as specified
    const gondolaZ = -1; // Position in store
    const shelfDepth = 0.12;
    const shelfTilt = 0.12;

    // Central spine (vertical panel between the two sides)
    const spinePanel = createBox(0.04, gondolaHeight, gondolaLength);
    this.addObject(spinePanel, vec3.fromValues(gondolaX, gondolaHeight / 2, gondolaZ), metalBlack);

    // Build shelves on BOTH sides of the gondola
    for (const side of ['left', 'right'] as const) {
      const direction = side === 'left' ? -1 : 1;
      const shelfX = gondolaX + direction * 0.1;

      // 6 levels of shelves (fits 1.5m height)
      for (let level = 0; level < 6; level++) {
        const y = 0.12 + level * 0.23;

        // Shelf panel - tilted slightly back
        const shelfMesh = createBox(shelfDepth, 0.015, gondolaLength);
        const shelfObj = this.addObject(shelfMesh, vec3.fromValues(shelfX, y, gondolaZ), metalBlack);
        mat4.rotateZ(shelfObj.modelMatrix, shelfObj.modelMatrix, direction * shelfTilt);

        // Front lip to hold cassettes
        const lipMesh = createBox(0.015, 0.05, gondolaLength);
        const lipX = shelfX + direction * 0.06;
        const lipObj = this.addObject(lipMesh, vec3.fromValues(lipX, y + 0.025, gondolaZ), metalBlack);
        mat4.rotateZ(lipObj.modelMatrix, lipObj.modelMatrix, direction * shelfTilt);
      }
    }

    // Vertical support posts along the gondola
    const postMesh = createBox(0.04, gondolaHeight, 0.04);
    for (let i = 0; i < 4; i++) {
      const z = gondolaZ - gondolaLength / 2 + 0.5 + i * 1.5;
      this.addObject(postMesh, vec3.fromValues(gondolaX, gondolaHeight / 2, z), metalBlack);
    }

    // Top rail
    const topRail = createBox(0.28, 0.04, gondolaLength);
    this.addObject(topRail, vec3.fromValues(gondolaX, gondolaHeight - 0.02, gondolaZ), metalBlack);

    // Bottom rail
    const bottomRail = createBox(0.28, 0.03, gondolaLength);
    this.addObject(bottomRail, vec3.fromValues(gondolaX, 0.015, gondolaZ), metalBlack);

    // End caps
    const endCapMesh = createBox(0.28, gondolaHeight, 0.04);
    this.addObject(endCapMesh, vec3.fromValues(gondolaX, gondolaHeight / 2, gondolaZ - gondolaLength / 2), metalBlack);
    this.addObject(endCapMesh, vec3.fromValues(gondolaX, gondolaHeight / 2, gondolaZ + gondolaLength / 2), metalBlack);
  }

  // === WALL SHELVES ===
  // Shelves mounted on left, back, and right walls
  // Room: 10m wide x 15m deep, walls at +/-5 (x) and +/-7.5 (z)
  private buildWallShelves() {
    const metalBlack: [number, number, number, number] = [0.08, 0.08, 0.1, 1];
    const shelfDepth = 0.12;
    const shelfTilt = 0.1;
    const shelfHeight = 1.8;
    const backZ = -7.5;
    const sideX = 5;

    // === BACK WALL SHELVES ===
    const backPanel = createBox(9, shelfHeight, 0.02);
    this.addObject(backPanel, vec3.fromValues(0, shelfHeight / 2 + 0.1, backZ + 0.02), metalBlack);

    for (let level = 0; level < 7; level++) {
      const y = 0.15 + level * 0.24;

      const shelfMesh = createBox(9, 0.015, shelfDepth);
      const shelfObj = this.addObject(shelfMesh, vec3.fromValues(0, y, backZ + 0.18), metalBlack);
      mat4.rotateX(shelfObj.modelMatrix, shelfObj.modelMatrix, -shelfTilt);

      const lipMesh = createBox(9, 0.05, 0.015);
      const lipObj = this.addObject(lipMesh, vec3.fromValues(0, y + 0.025, backZ + 0.25), metalBlack);
      mat4.rotateX(lipObj.modelMatrix, lipObj.modelMatrix, -shelfTilt);
    }

    // Vertical dividers for back wall
    const dividerMesh = createBox(0.03, shelfHeight, 0.10);
    for (let i = 0; i < 6; i++) {
      const x = -4 + i * 1.6;
      this.addObject(dividerMesh, vec3.fromValues(x, shelfHeight / 2 + 0.1, backZ + 0.18), metalBlack);
    }

    // === LEFT WALL SHELVES ===
    const leftPanel = createBox(0.02, shelfHeight, 10);
    this.addObject(leftPanel, vec3.fromValues(-sideX + 0.02, shelfHeight / 2 + 0.1, -1), metalBlack);

    for (let level = 0; level < 7; level++) {
      const y = 0.15 + level * 0.24;

      const shelfMesh = createBox(shelfDepth, 0.015, 10);
      const shelfObj = this.addObject(shelfMesh, vec3.fromValues(-sideX + 0.18, y, -1), metalBlack);
      mat4.rotateZ(shelfObj.modelMatrix, shelfObj.modelMatrix, shelfTilt);

      const lipMesh = createBox(0.015, 0.05, 10);
      const lipObj = this.addObject(lipMesh, vec3.fromValues(-sideX + 0.25, y + 0.025, -1), metalBlack);
      mat4.rotateZ(lipObj.modelMatrix, lipObj.modelMatrix, shelfTilt);
    }

    // === RIGHT WALL SHELVES ===
    const rightPanel = createBox(0.02, shelfHeight, 10);
    this.addObject(rightPanel, vec3.fromValues(sideX - 0.02, shelfHeight / 2 + 0.1, -1), metalBlack);

    for (let level = 0; level < 7; level++) {
      const y = 0.15 + level * 0.24;

      const shelfMesh = createBox(shelfDepth, 0.015, 10);
      const shelfObj = this.addObject(shelfMesh, vec3.fromValues(sideX - 0.18, y, -1), metalBlack);
      mat4.rotateZ(shelfObj.modelMatrix, shelfObj.modelMatrix, -shelfTilt);

      const lipMesh = createBox(0.015, 0.05, 10);
      const lipObj = this.addObject(lipMesh, vec3.fromValues(sideX - 0.25, y + 0.025, -1), metalBlack);
      mat4.rotateZ(lipObj.modelMatrix, lipObj.modelMatrix, -shelfTilt);
    }

    // Top rails
    const topRailBack = createBox(9, 0.04, 0.04);
    this.addObject(topRailBack, vec3.fromValues(0, shelfHeight + 0.08, backZ + 0.15), metalBlack);

    const topRailLeft = createBox(0.04, 0.04, 10);
    this.addObject(topRailLeft, vec3.fromValues(-sideX + 0.15, shelfHeight + 0.08, -1), metalBlack);

    const topRailRight = createBox(0.04, 0.04, 10);
    this.addObject(topRailRight, vec3.fromValues(sideX - 0.15, shelfHeight + 0.08, -1), metalBlack);
  }

  // Counter positioned at bottom-right (right side when entering)
  // Room: 10m x 15m, front wall at z=7.5
  private buildCounter() {
    const counterX = 3; // Right side
    const counterZ = 5; // Near entrance

    // Main counter body (wood/laminate)
    const counterBody = createBox(2, 1, 0.7);
    this.addObject(counterBody, vec3.fromValues(counterX, 0.5, counterZ), [0.35, 0.25, 0.15, 1]);

    // Counter top (laminate surface)
    const counterTop = createBox(2.1, 0.05, 0.8);
    this.addObject(counterTop, vec3.fromValues(counterX, 1.03, counterZ), [0.45, 0.35, 0.25, 1]);

    // Front decorative panel
    const frontPanel = createBox(2, 0.04, 0.04);
    this.addObject(frontPanel, vec3.fromValues(counterX, 0.5, counterZ - 0.38), [0.2, 0.2, 0.22, 1]);

    // L-extension towards the wall
    const sideCounter = createBox(0.7, 1, 1.2);
    this.addObject(sideCounter, vec3.fromValues(counterX + 1.2, 0.5, counterZ + 0.9), [0.35, 0.25, 0.15, 1]);

    const sideCounterTop = createBox(0.8, 0.05, 1.3);
    this.addObject(sideCounterTop, vec3.fromValues(counterX + 1.2, 1.03, counterZ + 0.9), [0.45, 0.35, 0.25, 1]);

    // Cash register
    const registerBase = createBox(0.35, 0.12, 0.25);
    this.addObject(registerBase, vec3.fromValues(counterX - 0.4, 1.09, counterZ), [0.12, 0.12, 0.14, 1]);
    const registerScreen = createBox(0.18, 0.08, 0.02);
    this.addObject(registerScreen, vec3.fromValues(counterX - 0.4, 1.25, counterZ - 0.14), [0.15, 0.45, 0.25, 1], 0.6);

    // Computer monitor on counter
    const monitorBase = createBox(0.2, 0.02, 0.15);
    this.addObject(monitorBase, vec3.fromValues(counterX + 0.4, 1.04, counterZ), [0.1, 0.1, 0.12, 1]);
    const monitorScreen = createBox(0.35, 0.28, 0.03);
    this.addObject(monitorScreen, vec3.fromValues(counterX + 0.4, 1.22, counterZ + 0.04), [0.05, 0.05, 0.08, 1]);
    const monitorDisplay = createBox(0.3, 0.23, 0.01);
    this.addObject(monitorDisplay, vec3.fromValues(counterX + 0.4, 1.22, counterZ + 0.02), [0.1, 0.15, 0.3, 1], 0.4);

    // Back shelf behind counter
    const backShelf = createBox(1.5, 1.6, 0.2);
    this.addObject(backShelf, vec3.fromValues(counterX + 0.8, 1.3, counterZ + 1.8), [0.28, 0.2, 0.12, 1]);

    // Build the manager behind the counter
    this.buildManager();
  }

  private buildManager() {
    // Manager positioned behind the counter (right side of store)
    const managerX = 3.5;
    const managerZ = 6;
    const scale = 1.0; // Normal scale

    // === LEGS (with jeans) ===
    const legMesh = createBox(0.15 * scale, 0.45 * scale, 0.15 * scale);
    this.addObject(legMesh, vec3.fromValues(managerX - 0.12 * scale, 0.22 * scale, managerZ), [0.2, 0.25, 0.4, 1]); // left leg (jeans)
    this.addObject(legMesh, vec3.fromValues(managerX + 0.12 * scale, 0.22 * scale, managerZ), [0.2, 0.25, 0.4, 1]); // right leg

    // Shoes
    const shoeMesh = createBox(0.16 * scale, 0.06 * scale, 0.22 * scale);
    this.addObject(shoeMesh, vec3.fromValues(managerX - 0.12 * scale, 0.03 * scale, managerZ - 0.03 * scale), [0.15, 0.1, 0.08, 1]);
    this.addObject(shoeMesh, vec3.fromValues(managerX + 0.12 * scale, 0.03 * scale, managerZ - 0.03 * scale), [0.15, 0.1, 0.08, 1]);

    // Belt
    const beltMesh = createBox(0.42 * scale, 0.05 * scale, 0.18 * scale);
    this.addObject(beltMesh, vec3.fromValues(managerX, 0.47 * scale, managerZ), [0.1, 0.08, 0.05, 1]);

    // Belt buckle
    const buckleMesh = createBox(0.06 * scale, 0.04 * scale, 0.02 * scale);
    this.addObject(buckleMesh, vec3.fromValues(managerX, 0.47 * scale, managerZ - 0.09 * scale), [0.8, 0.7, 0.2, 1], 0.5);

    // === TORSO (Hawaiian shirt) ===
    const torsoMesh = createBox(0.45 * scale, 0.5 * scale, 0.22 * scale);
    this.addObject(torsoMesh, vec3.fromValues(managerX, 0.75 * scale, managerZ), [0.85, 0.2, 0.35, 1]); // Magenta/pink shirt

    // Shirt collar
    const collarMesh = createBox(0.35 * scale, 0.06 * scale, 0.15 * scale);
    this.addObject(collarMesh, vec3.fromValues(managerX, 0.98 * scale, managerZ - 0.04 * scale), [0.9, 0.25, 0.4, 1]);

    // Shirt pattern - palm leaves / tropical
    const patternMesh1 = createBox(0.12 * scale, 0.15 * scale, 0.01 * scale);
    this.addObject(patternMesh1, vec3.fromValues(managerX - 0.12 * scale, 0.7 * scale, managerZ - 0.115 * scale), [0.1, 0.6, 0.3, 1], 0.2);
    this.addObject(patternMesh1, vec3.fromValues(managerX + 0.1 * scale, 0.8 * scale, managerZ - 0.115 * scale), [1, 0.85, 0.2, 1], 0.2);
    this.addObject(patternMesh1, vec3.fromValues(managerX, 0.6 * scale, managerZ - 0.115 * scale), [0, 0.8, 0.8, 1], 0.2);

    // === ARMS ===
    // Upper arms (shirt sleeves)
    const upperArmMesh = createBox(0.12 * scale, 0.2 * scale, 0.12 * scale);
    this.addObject(upperArmMesh, vec3.fromValues(managerX - 0.28 * scale, 0.88 * scale, managerZ), [0.85, 0.2, 0.35, 1]);
    this.addObject(upperArmMesh, vec3.fromValues(managerX + 0.28 * scale, 0.88 * scale, managerZ), [0.85, 0.2, 0.35, 1]);

    // Forearms (skin)
    const forearmMesh = createBox(0.1 * scale, 0.25 * scale, 0.1 * scale);
    this.addObject(forearmMesh, vec3.fromValues(managerX - 0.28 * scale, 0.62 * scale, managerZ), [0.87, 0.68, 0.55, 1]);
    this.addObject(forearmMesh, vec3.fromValues(managerX + 0.28 * scale, 0.62 * scale, managerZ), [0.87, 0.68, 0.55, 1]);

    // Hands
    const handMesh = createBox(0.1 * scale, 0.12 * scale, 0.06 * scale);
    this.addObject(handMesh, vec3.fromValues(managerX - 0.28 * scale, 0.44 * scale, managerZ), [0.87, 0.68, 0.55, 1]);
    this.addObject(handMesh, vec3.fromValues(managerX + 0.28 * scale, 0.44 * scale, managerZ), [0.87, 0.68, 0.55, 1]);

    // === NECK ===
    const neckMesh = createBox(0.12 * scale, 0.08 * scale, 0.1 * scale);
    this.addObject(neckMesh, vec3.fromValues(managerX, 1.04 * scale, managerZ), [0.87, 0.68, 0.55, 1]);

    // === HEAD ===
    const headMesh = createBox(0.28 * scale, 0.3 * scale, 0.25 * scale);
    this.addObject(headMesh, vec3.fromValues(managerX, 1.24 * scale, managerZ), [0.87, 0.68, 0.55, 1]);

    // === HAIR (80s mullet style) ===
    // Top hair
    const topHairMesh = createBox(0.3 * scale, 0.1 * scale, 0.26 * scale);
    this.addObject(topHairMesh, vec3.fromValues(managerX, 1.42 * scale, managerZ), [0.12, 0.08, 0.04, 1]);

    // Front hair (bangs)
    const bangsMesh = createBox(0.26 * scale, 0.08 * scale, 0.06 * scale);
    this.addObject(bangsMesh, vec3.fromValues(managerX, 1.38 * scale, managerZ - 0.14 * scale), [0.12, 0.08, 0.04, 1]);

    // Side hair (volume - 80s style)
    const sideHairMesh = createBox(0.08 * scale, 0.22 * scale, 0.2 * scale);
    this.addObject(sideHairMesh, vec3.fromValues(managerX - 0.17 * scale, 1.28 * scale, managerZ), [0.12, 0.08, 0.04, 1]);
    this.addObject(sideHairMesh, vec3.fromValues(managerX + 0.17 * scale, 1.28 * scale, managerZ), [0.12, 0.08, 0.04, 1]);

    // Back hair (mullet!)
    const mulletMesh = createBox(0.24 * scale, 0.25 * scale, 0.08 * scale);
    this.addObject(mulletMesh, vec3.fromValues(managerX, 1.22 * scale, managerZ + 0.15 * scale), [0.12, 0.08, 0.04, 1]);

    // === FACE ===
    // Eyebrows
    const eyebrowMesh = createBox(0.08 * scale, 0.02 * scale, 0.02 * scale);
    this.addObject(eyebrowMesh, vec3.fromValues(managerX - 0.07 * scale, 1.32 * scale, managerZ - 0.125 * scale), [0.12, 0.08, 0.04, 1]);
    this.addObject(eyebrowMesh, vec3.fromValues(managerX + 0.07 * scale, 1.32 * scale, managerZ - 0.125 * scale), [0.12, 0.08, 0.04, 1]);

    // Eyes (white)
    const eyeMesh = createBox(0.055 * scale, 0.05 * scale, 0.02 * scale);
    this.addObject(eyeMesh, vec3.fromValues(managerX - 0.07 * scale, 1.26 * scale, managerZ - 0.125 * scale), [0.95, 0.95, 0.95, 1]);
    this.addObject(eyeMesh, vec3.fromValues(managerX + 0.07 * scale, 1.26 * scale, managerZ - 0.125 * scale), [0.95, 0.95, 0.95, 1]);

    // Irises
    const irisMesh = createBox(0.03 * scale, 0.04 * scale, 0.01 * scale);
    this.addObject(irisMesh, vec3.fromValues(managerX - 0.07 * scale, 1.26 * scale, managerZ - 0.135 * scale), [0.3, 0.5, 0.3, 1]); // Green eyes
    this.addObject(irisMesh, vec3.fromValues(managerX + 0.07 * scale, 1.26 * scale, managerZ - 0.135 * scale), [0.3, 0.5, 0.3, 1]);

    // Pupils
    const pupilMesh = createBox(0.015 * scale, 0.025 * scale, 0.005 * scale);
    this.addObject(pupilMesh, vec3.fromValues(managerX - 0.07 * scale, 1.26 * scale, managerZ - 0.14 * scale), [0.05, 0.05, 0.05, 1]);
    this.addObject(pupilMesh, vec3.fromValues(managerX + 0.07 * scale, 1.26 * scale, managerZ - 0.14 * scale), [0.05, 0.05, 0.05, 1]);

    // Nose
    const noseMesh = createBox(0.05 * scale, 0.08 * scale, 0.07 * scale);
    this.addObject(noseMesh, vec3.fromValues(managerX, 1.2 * scale, managerZ - 0.14 * scale), [0.82, 0.62, 0.48, 1]);

    // Mustache (thick 80s style)
    const mustacheMesh = createBox(0.16 * scale, 0.04 * scale, 0.04 * scale);
    this.addObject(mustacheMesh, vec3.fromValues(managerX, 1.12 * scale, managerZ - 0.13 * scale), [0.12, 0.08, 0.04, 1]);

    // Mouth
    const mouthMesh = createBox(0.08 * scale, 0.02 * scale, 0.02 * scale);
    this.addObject(mouthMesh, vec3.fromValues(managerX, 1.08 * scale, managerZ - 0.125 * scale), [0.7, 0.35, 0.35, 1]);

    // Chin
    const chinMesh = createBox(0.12 * scale, 0.06 * scale, 0.08 * scale);
    this.addObject(chinMesh, vec3.fromValues(managerX, 1.04 * scale, managerZ - 0.1 * scale), [0.85, 0.66, 0.52, 1]);

    // Ears
    const earMesh = createBox(0.04 * scale, 0.08 * scale, 0.03 * scale);
    this.addObject(earMesh, vec3.fromValues(managerX - 0.15 * scale, 1.22 * scale, managerZ), [0.85, 0.65, 0.5, 1]);
    this.addObject(earMesh, vec3.fromValues(managerX + 0.15 * scale, 1.22 * scale, managerZ), [0.85, 0.65, 0.5, 1]);

    // === ACCESSORIES ===
    // Name tag
    const nameTagMesh = createBox(0.15 * scale, 0.08 * scale, 0.01 * scale);
    this.addObject(nameTagMesh, vec3.fromValues(managerX + 0.1 * scale, 0.88 * scale, managerZ - 0.115 * scale), [1, 1, 0.85, 1]);

    // Watch on left wrist
    const watchMesh = createBox(0.06 * scale, 0.04 * scale, 0.08 * scale);
    this.addObject(watchMesh, vec3.fromValues(managerX - 0.28 * scale, 0.52 * scale, managerZ), [0.3, 0.3, 0.35, 1], 0.3);

    // Gold chain necklace
    const chainMesh = createBox(0.2 * scale, 0.02 * scale, 0.02 * scale);
    this.addObject(chainMesh, vec3.fromValues(managerX, 0.96 * scale, managerZ - 0.1 * scale), [0.9, 0.75, 0.2, 1], 0.8);
  }

  // Neon decorations for 90s video club aesthetic
  // Room: 10m x 15m, back wall at z=-7.5
  private buildNeonDecorations() {
    // "VIDEOCLUB" neon sign on back wall (pink/magenta)
    const signBorder = createBox(4, 0.05, 0.04);
    this.addObject(signBorder, vec3.fromValues(0, 2.8, -7.35), [1, 0.2, 0.6, 1], 3.5);
    this.addObject(signBorder, vec3.fromValues(0, 2.2, -7.35), [1, 0.2, 0.6, 1], 3.5);

    const vBorder = createBox(0.05, 0.6, 0.04);
    this.addObject(vBorder, vec3.fromValues(-2, 2.5, -7.35), [1, 0.2, 0.6, 1], 3.5);
    this.addObject(vBorder, vec3.fromValues(2, 2.5, -7.35), [1, 0.2, 0.6, 1], 3.5);

    // Floor guide strips along aisles (subtle)
    const floorStrip = createBox(0.02, 0.02, 10);
    // Left aisle
    this.addObject(floorStrip, vec3.fromValues(-2.5, 0.01, -1), [0.8, 0.2, 0.5, 1], 1.5);
    // Right aisle
    this.addObject(floorStrip, vec3.fromValues(2.5, 0.01, -1), [0.2, 0.8, 0.9, 1], 1.5);

    // Corner accent neons
    const cornerNeon = createBox(0.04, 3.3, 0.04);
    this.addObject(cornerNeon, vec3.fromValues(-4.9, 1.65, -7.4), [1, 0.25, 0.65, 1], 2.5);
    this.addObject(cornerNeon, vec3.fromValues(4.9, 1.65, -7.4), [0.2, 0.9, 1, 1], 2.5);

    // Accent strip above central gondola
    const gondolaStrip = createBox(0.03, 0.03, 5);
    this.addObject(gondolaStrip, vec3.fromValues(0, 1.55, -1), [0.9, 0.85, 0.2, 1], 1.8);
  }

  // Industrial neon tube lighting on 3.5m ceiling
  // Room: 10m x 15m
  private buildCeilingLights() {
    const ceilingHeight = 3.45; // Just below 3.5m ceiling
    const lightTube = createBox(0.08, 0.04, 1.5);
    const lightFixture = createBox(0.2, 0.06, 1.7);

    // Main row of lights down the center (industrial fluorescent)
    for (let z = -6; z <= 5; z += 2.2) {
      this.addObject(lightFixture, vec3.fromValues(0, ceilingHeight, z), [0.2, 0.2, 0.22, 1]);
      this.addObject(lightTube, vec3.fromValues(0, ceilingHeight - 0.04, z), [0.98, 1.0, 1.0, 1], 1.5);
    }

    // Side rows of lights (left and right aisles)
    for (let z = -5; z <= 4; z += 2.5) {
      // Left aisle lights
      this.addObject(lightFixture, vec3.fromValues(-2.8, ceilingHeight, z), [0.2, 0.2, 0.22, 1]);
      this.addObject(lightTube, vec3.fromValues(-2.8, ceilingHeight - 0.04, z), [0.98, 1.0, 1.0, 1], 1.2);
      // Right aisle lights
      this.addObject(lightFixture, vec3.fromValues(2.8, ceilingHeight, z), [0.2, 0.2, 0.22, 1]);
      this.addObject(lightTube, vec3.fromValues(2.8, ceilingHeight - 0.04, z), [0.98, 1.0, 1.0, 1], 1.2);
    }

    // Counter area lighting (brighter)
    this.addObject(lightFixture, vec3.fromValues(3, ceilingHeight, 5), [0.2, 0.2, 0.22, 1]);
    this.addObject(lightTube, vec3.fromValues(3, ceilingHeight - 0.04, 5), [1.0, 0.98, 0.95, 1], 1.8);
  }

  // Decorations - simplified, no barriers/queue posts
  // Room: 10m x 15m, front wall at z=7.5
  private buildDecorations() {
    // Plant near entrance (left side)
    const potMesh = createBox(0.25, 0.3, 0.25);
    this.addObject(potMesh, vec3.fromValues(-2, 0.15, 6), [0.5, 0.32, 0.18, 1]);
    const plantMesh = createBox(0.4, 0.5, 0.4);
    this.addObject(plantMesh, vec3.fromValues(-2, 0.55, 6), [0.15, 0.45, 0.2, 1]);

    // Trash bin near entrance
    this.addObject(createBox(0.3, 0.5, 0.3), vec3.fromValues(-3.5, 0.25, 6), [0.12, 0.12, 0.14, 1]);

    // Return box on counter
    this.addObject(createBox(0.4, 0.15, 0.25), vec3.fromValues(2.5, 1.1, 5), [0.6, 0.15, 0.15, 1]);

    // Floor mat at entrance
    const matMesh = createPlane(1.8, 1.2, 1, 1);
    this.addObject(matMesh, vec3.fromValues(-2.5, 0.01, 7), [0.18, 0.08, 0.08, 1]);

    // Promotional standee near entrance
    const standeeMesh = createBox(0.4, 1.3, 0.12);
    this.addObject(standeeMesh, vec3.fromValues(-1.5, 0.65, 5.5), [0.4, 0.35, 0.3, 1]);
  }

  private setupControls() {
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

    // Render scene to HDR texture (for post-processing)
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: this.postProcessing.getSceneTextureView(),
        clearValue: { r: 0.02, g: 0.02, b: 0.04, a: 1 },
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

    // === Render color objects ===
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
      // Update object uniform buffer
      const objectData = new Float32Array(20);
      objectData.set(obj.modelMatrix as Float32Array, 0);
      objectData[16] = obj.emissive;

      const objectBuffer = this.device.createBuffer({
        size: 80,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(objectBuffer, 0, objectData);

      // Create new bind group with updated buffer
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

    renderPass.end();

    // Apply post-processing (bloom, tone mapping, vignette, grain) and output to canvas
    const outputView = context.getCurrentTexture().createView();
    this.postProcessing.render(commandEncoder, outputView, time);

    this.device.queue.submit([commandEncoder.finish()]);
  }

  getCamera(): Camera {
    return this.camera;
  }
}
