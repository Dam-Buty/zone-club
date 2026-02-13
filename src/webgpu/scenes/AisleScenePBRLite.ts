/**
 * AisleScenePBRLite - Simplified PBR Scene for debugging
 *
 * This is a minimal version to test the core rendering pipeline:
 * 1. G-Buffer pass (geometry to MRT)
 * 2. Lighting pass (PBR deferred shading)
 * 3. Direct output to canvas (no post-processing)
 */

import { mat4, vec3 } from 'gl-matrix';
import { Camera } from '../core/Camera';
import { createPlane, createBox, createVerticalPlane, type Mesh } from '../core/Geometry';
import { GBuffer } from '../rendering/GBuffer';

import gbufferShaderSource from '../shaders/gbuffer.wgsl';
import pbrLightingShaderSource from '../shaders/pbr-lighting.wgsl';

// Simple material
interface SimpleMaterial {
  albedo: [number, number, number];
  metallic: number;
  roughness: number;
  emissive: [number, number, number];
  emissiveIntensity: number;
}

// Scene object
interface SceneObject {
  mesh: Mesh;
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  modelMatrix: mat4;
  normalMatrix: mat4;
  material: SimpleMaterial;
  materialBuffer: GPUBuffer;
  materialBindGroup: GPUBindGroup;
  modelBuffer: GPUBuffer;
  modelBindGroup: GPUBindGroup;
}

// Point light
interface PointLight {
  position: [number, number, number];
  color: [number, number, number];
  intensity: number;
  radius: number;
}

export class AisleScenePBRLite {
  private device: GPUDevice;
  private format: GPUTextureFormat;
  private camera: Camera;
  private canvas: HTMLCanvasElement;

  // Scene
  private objects: SceneObject[] = [];
  private pointLights: PointLight[] = [];

  // G-Buffer
  private gBuffer!: GBuffer;

  // Pipelines
  private gbufferPipeline!: GPURenderPipeline;
  private lightingPipeline!: GPURenderPipeline;

  // Bind groups
  private cameraUniformBuffer!: GPUBuffer;
  private cameraBindGroup!: GPUBindGroup;
  private cameraBindGroupLayout!: GPUBindGroupLayout;
  private modelBindGroupLayout!: GPUBindGroupLayout;
  private materialBindGroupLayout!: GPUBindGroupLayout;

  // Lighting
  private lightingUniformBuffer!: GPUBuffer;
  private pointLightsBuffer!: GPUBuffer;
  private lightingBindGroup!: GPUBindGroup;

  // HDR output
  private hdrTexture!: GPUTexture;
  private hdrTextureView!: GPUTextureView;

  // Simple output pipeline (HDR to screen)
  private outputPipeline!: GPURenderPipeline;
  private outputBindGroupLayout!: GPUBindGroupLayout;
  private outputSampler!: GPUSampler;

  constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat
  ) {
    console.log('[PBRLite] Constructor start');
    this.device = device;
    this.format = format;
    this.canvas = context.canvas as HTMLCanvasElement;

    // Validate dimensions
    const width = Math.max(1, this.canvas.width);
    const height = Math.max(1, this.canvas.height);
    console.log('[PBRLite] Dimensions:', width, 'x', height);

    this.camera = new Camera(width / height);

    // Create G-Buffer
    console.log('[PBRLite] Creating GBuffer...');
    this.gBuffer = new GBuffer(device, width, height);

    // Create pipelines
    console.log('[PBRLite] Creating pipelines...');
    this.createGBufferPipeline();
    this.createLightingPipeline();
    this.createOutputPipeline();
    this.createHDRTarget(width, height);

    // Build simple scene
    console.log('[PBRLite] Building scene...');
    this.buildScene();
    this.setupLights();
    this.setupControls();

    console.log('[PBRLite] Constructor complete');
  }

  private createGBufferPipeline(): void {
    // Camera bind group layout
    this.cameraBindGroupLayout = this.device.createBindGroupLayout({
      label: 'Camera Bind Group Layout',
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      }],
    });

    // Model bind group layout
    this.modelBindGroupLayout = this.device.createBindGroupLayout({
      label: 'Model Bind Group Layout',
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'uniform' },
      }],
    });

    // Material bind group layout
    this.materialBindGroupLayout = this.device.createBindGroupLayout({
      label: 'Material Bind Group Layout',
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      }],
    });

    // Camera uniform buffer
    this.cameraUniformBuffer = this.device.createBuffer({
      label: 'Camera Uniform Buffer',
      size: 208,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.cameraBindGroup = this.device.createBindGroup({
      layout: this.cameraBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.cameraUniformBuffer } }],
    });

    // Shader module
    const gbufferModule = this.device.createShaderModule({
      label: 'G-Buffer Shader',
      code: gbufferShaderSource,
    });

    // Pipeline
    this.gbufferPipeline = this.device.createRenderPipeline({
      label: 'G-Buffer Pipeline',
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [
          this.cameraBindGroupLayout,
          this.modelBindGroupLayout,
          this.materialBindGroupLayout,
        ],
      }),
      vertex: {
        module: gbufferModule,
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
        module: gbufferModule,
        entryPoint: 'fragmentMain',
        targets: [
          { format: 'rgba8unorm' },    // Albedo
          { format: 'rgba16float' },   // Normal
          { format: 'rgba8unorm' },    // Material
          { format: 'rgba16float' },   // Emissive
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: {
        format: 'depth32float',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });
  }

  private createLightingPipeline(): void {
    // Lighting uniform buffer
    this.lightingUniformBuffer = this.device.createBuffer({
      label: 'Lighting Uniform Buffer',
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Point lights buffer
    this.pointLightsBuffer = this.device.createBuffer({
      label: 'Point Lights Buffer',
      size: 32 * 32,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    const lightingBindGroupLayout = this.device.createBindGroupLayout({
      label: 'Lighting Bind Group Layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ],
    });

    this.lightingBindGroup = this.device.createBindGroup({
      layout: lightingBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.lightingUniformBuffer } },
        { binding: 1, resource: { buffer: this.pointLightsBuffer } },
      ],
    });

    const lightingModule = this.device.createShaderModule({
      label: 'PBR Lighting Shader',
      code: pbrLightingShaderSource,
    });

    this.lightingPipeline = this.device.createRenderPipeline({
      label: 'PBR Lighting Pipeline',
      layout: this.device.createPipelineLayout({
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
        targets: [{ format: 'rgba16float' }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  private createOutputPipeline(): void {
    this.outputSampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });

    this.outputBindGroupLayout = this.device.createBindGroupLayout({
      label: 'Output Bind Group Layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ],
    });

    const outputShader = this.device.createShaderModule({
      label: 'Output Shader',
      code: `
        @group(0) @binding(0) var texSampler: sampler;
        @group(0) @binding(1) var hdrTexture: texture_2d<f32>;

        struct VertexOutput {
          @builtin(position) position: vec4f,
          @location(0) uv: vec2f,
        }

        @vertex
        fn vertexMain(@builtin(vertex_index) vi: u32) -> VertexOutput {
          var out: VertexOutput;
          let x = f32((vi << 1u) & 2u);
          let y = f32(vi & 2u);
          out.position = vec4f(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
          out.uv = vec2f(x, 1.0 - y);
          return out;
        }

        @fragment
        fn fragmentMain(in: VertexOutput) -> @location(0) vec4f {
          var color = textureSample(hdrTexture, texSampler, in.uv).rgb;
          // Simple Reinhard tone mapping
          color = color / (color + vec3f(1.0));
          // Gamma correction
          color = pow(color, vec3f(1.0 / 2.2));
          return vec4f(color, 1.0);
        }
      `,
    });

    this.outputPipeline = this.device.createRenderPipeline({
      label: 'Output Pipeline',
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.outputBindGroupLayout],
      }),
      vertex: {
        module: outputShader,
        entryPoint: 'vertexMain',
      },
      fragment: {
        module: outputShader,
        entryPoint: 'fragmentMain',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  private createHDRTarget(width: number, height: number): void {
    this.hdrTexture = this.device.createTexture({
      label: 'HDR Render Target',
      size: [width, height],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.hdrTextureView = this.hdrTexture.createView();
  }

  private addObject(
    mesh: Mesh,
    position: vec3,
    material: SimpleMaterial,
    scale: vec3 = vec3.fromValues(1, 1, 1),
    rotation?: { axis: vec3; angle: number }
  ): void {
    const vertexBuffer = this.device.createBuffer({
      size: mesh.vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(vertexBuffer, 0, mesh.vertices);

    const indexBuffer = this.device.createBuffer({
      size: mesh.indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(indexBuffer, 0, mesh.indices);

    const modelMatrix = mat4.create();
    mat4.translate(modelMatrix, modelMatrix, position);
    if (rotation) {
      mat4.rotate(modelMatrix, modelMatrix, rotation.angle, rotation.axis);
    }
    mat4.scale(modelMatrix, modelMatrix, scale);

    const normalMatrix = mat4.create();
    mat4.invert(normalMatrix, modelMatrix);
    mat4.transpose(normalMatrix, normalMatrix);

    const modelBuffer = this.device.createBuffer({
      size: 128,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const modelData = new Float32Array(32);
    modelData.set(modelMatrix as Float32Array, 0);
    modelData.set(normalMatrix as Float32Array, 16);
    this.device.queue.writeBuffer(modelBuffer, 0, modelData);

    const modelBindGroup = this.device.createBindGroup({
      layout: this.modelBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: modelBuffer } }],
    });

    // Material buffer (64 bytes)
    const materialBuffer = this.device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const matData = new Float32Array(16);
    matData[0] = material.albedo[0];
    matData[1] = material.albedo[1];
    matData[2] = material.albedo[2];
    matData[3] = 1.0;
    matData[4] = material.metallic;
    matData[5] = material.roughness;
    matData[6] = 1.0; // AO
    matData[7] = 0.0;
    matData[8] = material.emissive[0] * material.emissiveIntensity;
    matData[9] = material.emissive[1] * material.emissiveIntensity;
    matData[10] = material.emissive[2] * material.emissiveIntensity;
    matData[11] = material.emissiveIntensity;
    this.device.queue.writeBuffer(materialBuffer, 0, matData);

    const materialBindGroup = this.device.createBindGroup({
      layout: this.materialBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: materialBuffer } }],
    });

    this.objects.push({
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
    });
  }

  private buildScene(): void {
    // Floor (checkered pattern simulated with dark color)
    const floor = createPlane(10, 15, 5, 7);
    this.addObject(floor, vec3.fromValues(0, 0, 0), {
      albedo: [0.2, 0.2, 0.2],
      metallic: 0.0,
      roughness: 0.8,
      emissive: [0, 0, 0],
      emissiveIntensity: 0,
    });

    // Ceiling
    const ceiling = createPlane(10, 15, 2, 3);
    this.addObject(
      ceiling,
      vec3.fromValues(0, 3.5, 0),
      { albedo: [0.4, 0.4, 0.42], metallic: 0, roughness: 0.9, emissive: [0,0,0], emissiveIntensity: 0 },
      vec3.fromValues(1, -1, 1)
    );

    // Walls
    const wallMat: SimpleMaterial = { albedo: [0.9, 0.88, 0.85], metallic: 0, roughness: 0.85, emissive: [0,0,0], emissiveIntensity: 0 };

    // Back wall
    const backWall = createVerticalPlane(10, 4);
    this.addObject(backWall, vec3.fromValues(0, 1.75, -7.5), wallMat);

    // Left wall
    const leftWall = createVerticalPlane(15, 4);
    this.addObject(leftWall, vec3.fromValues(-5, 1.75, 0), wallMat, vec3.fromValues(1, 1, 1), { axis: vec3.fromValues(0, 1, 0), angle: Math.PI / 2 });

    // Right wall
    const rightWall = createVerticalPlane(15, 4);
    this.addObject(rightWall, vec3.fromValues(5, 1.75, 0), wallMat, vec3.fromValues(1, 1, 1), { axis: vec3.fromValues(0, 1, 0), angle: -Math.PI / 2 });

    // Counter
    const counterMat: SimpleMaterial = { albedo: [0.4, 0.25, 0.15], metallic: 0, roughness: 0.6, emissive: [0,0,0], emissiveIntensity: 0 };
    const counter = createBox(3, 1, 0.8);
    this.addObject(counter, vec3.fromValues(0, 0.5, 6), counterMat);

    // Neon accent (emissive)
    const neonMat: SimpleMaterial = { albedo: [1, 0, 0.5], metallic: 0, roughness: 0.5, emissive: [1, 0, 0.5], emissiveIntensity: 3.0 };
    const neonStrip = createBox(0.05, 0.05, 6);
    this.addObject(neonStrip, vec3.fromValues(-1.2, 0.02, 0), neonMat);
    this.addObject(neonStrip, vec3.fromValues(1.2, 0.02, 0), { ...neonMat, albedo: [0, 1, 1], emissive: [0, 1, 1] });

    console.log('[PBRLite] Scene built with', this.objects.length, 'objects');
  }

  private setupLights(): void {
    // Ceiling lights
    for (let z = -5; z <= 4; z += 3) {
      this.pointLights.push({ position: [0, 3.3, z], color: [1, 0.95, 0.9], intensity: 2.0, radius: 6 });
    }

    // Neon accent lights
    this.pointLights.push({ position: [-1.2, 0.1, 0], color: [1, 0.2, 0.6], intensity: 2.0, radius: 4 });
    this.pointLights.push({ position: [1.2, 0.1, 0], color: [0, 1, 1], intensity: 2.0, radius: 4 });

    console.log('[PBRLite] Lights:', this.pointLights.length);
  }

  private setupControls(): void {
    this.canvas.addEventListener('click', () => this.canvas.requestPointerLock());

    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === this.canvas) {
        this.camera.onMouseMove(e.movementX, e.movementY);
      }
    });

    const keys: Record<string, boolean> = {};
    document.addEventListener('keydown', (e) => { keys[e.key.toLowerCase()] = true; });
    document.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

    const moveSpeed = 0.08;
    const update = () => {
      if (keys['w'] || keys['arrowup']) this.camera.moveForward(moveSpeed);
      if (keys['s'] || keys['arrowdown']) this.camera.moveForward(-moveSpeed);
      if (keys['a'] || keys['arrowleft']) this.camera.moveRight(-moveSpeed);
      if (keys['d'] || keys['arrowright']) this.camera.moveRight(moveSpeed);
      requestAnimationFrame(update);
    };
    update();
  }

  private updateCameraUniforms(): void {
    const data = new Float32Array(52);
    data.set(this.camera.getViewProjectionMatrix(), 0);
    data.set(this.camera.getViewMatrix(), 16);
    data.set(this.camera.getProjectionMatrix(), 32);
    const camPos = this.camera.getPosition();
    data[48] = camPos[0];
    data[49] = camPos[1];
    data[50] = camPos[2];
    this.device.queue.writeBuffer(this.cameraUniformBuffer, 0, data);
  }

  private updateLightingUniforms(): void {
    const data = new Float32Array(64);
    const camPos = this.camera.getPosition();
    data[0] = camPos[0];
    data[1] = camPos[1];
    data[2] = camPos[2];

    // Inverse view-projection
    const invViewProj = mat4.create();
    mat4.invert(invViewProj, this.camera.getViewProjectionMatrix() as mat4);
    data.set(invViewProj as Float32Array, 4);

    // Directional light
    data[20] = 0.2; data[21] = 0.8; data[22] = 0.3; data[23] = 0;
    data[24] = 1.0; data[25] = 0.95; data[26] = 0.9; data[27] = 0.3;

    // Ambient
    data[28] = 0.03; data[29] = 0.03; data[30] = 0.05; data[31] = 0;
    data[32] = 0.02; data[33] = 0.02; data[34] = 0.03; data[35] = 0.5;

    // Num point lights
    data[36] = this.pointLights.length;

    this.device.queue.writeBuffer(this.lightingUniformBuffer, 0, data);

    // Point lights
    const lightData = new Float32Array(this.pointLights.length * 8);
    for (let i = 0; i < this.pointLights.length; i++) {
      const light = this.pointLights[i];
      const o = i * 8;
      lightData[o] = light.position[0];
      lightData[o + 1] = light.position[1];
      lightData[o + 2] = light.position[2];
      lightData[o + 3] = light.radius;
      lightData[o + 4] = light.color[0];
      lightData[o + 5] = light.color[1];
      lightData[o + 6] = light.color[2];
      lightData[o + 7] = light.intensity;
    }
    this.device.queue.writeBuffer(this.pointLightsBuffer, 0, lightData);
  }

  resize(width: number, height: number): void {
    this.camera.setAspect(width / height);
    this.gBuffer.resize(width, height);
    this.hdrTexture.destroy();
    this.createHDRTarget(width, height);
  }

  render(context: GPUCanvasContext): void {
    this.updateCameraUniforms();
    this.updateLightingUniforms();

    const commandEncoder = this.device.createCommandEncoder();

    // G-Buffer pass
    const gbufferPass = commandEncoder.beginRenderPass(this.gBuffer.getRenderPassDescriptor());
    gbufferPass.setPipeline(this.gbufferPipeline);
    gbufferPass.setBindGroup(0, this.cameraBindGroup);

    for (const obj of this.objects) {
      gbufferPass.setBindGroup(1, obj.modelBindGroup);
      gbufferPass.setBindGroup(2, obj.materialBindGroup);
      gbufferPass.setVertexBuffer(0, obj.vertexBuffer);
      gbufferPass.setIndexBuffer(obj.indexBuffer, 'uint16');
      gbufferPass.drawIndexed(obj.mesh.indices.length);
    }
    gbufferPass.end();

    // Lighting pass
    const lightingPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: this.hdrTextureView,
        clearValue: { r: 0.02, g: 0.02, b: 0.05, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    lightingPass.setPipeline(this.lightingPipeline);
    lightingPass.setBindGroup(0, this.gBuffer.getReadBindGroup());
    lightingPass.setBindGroup(1, this.lightingBindGroup);
    lightingPass.draw(3);
    lightingPass.end();

    // Output pass (HDR to screen with tone mapping)
    const outputBindGroup = this.device.createBindGroup({
      layout: this.outputBindGroupLayout,
      entries: [
        { binding: 0, resource: this.outputSampler },
        { binding: 1, resource: this.hdrTextureView },
      ],
    });

    const outputPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    outputPass.setPipeline(this.outputPipeline);
    outputPass.setBindGroup(0, outputBindGroup);
    outputPass.draw(3);
    outputPass.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }
}
