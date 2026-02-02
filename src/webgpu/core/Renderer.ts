import basicShaderCode from '../shaders/basic.wgsl?raw';
import neonShaderCode from '../shaders/neon.wgsl?raw';
import vhsShaderCode from '../shaders/vhs.wgsl?raw';

export interface RenderObject {
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  indexCount: number;
  texture: GPUTexture;
  modelMatrix: Float32Array;
}

export class Renderer {
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private format: GPUTextureFormat;

  private _basicPipeline!: GPURenderPipeline;
  private _neonPipeline!: GPURenderPipeline;
  private _vhsPipeline!: GPURenderPipeline;

  private _uniformBuffer!: GPUBuffer;
  private sampler!: GPUSampler;

  private renderTexture!: GPUTexture;
  private _renderTextureView!: GPUTextureView;

  private startTime = Date.now();

  constructor(device: GPUDevice, context: GPUCanvasContext, format: GPUTextureFormat) {
    this.device = device;
    this.context = context;
    this.format = format;
    this.initialize();
  }

  private initialize() {
    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
    });

    this._uniformBuffer = this.device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.createRenderTexture();
    this.createBasicPipeline();
    this.createPostProcessPipelines();
  }

  private createRenderTexture() {
    const canvas = this.context.canvas as HTMLCanvasElement;
    this.renderTexture = this.device.createTexture({
      size: [canvas.width, canvas.height],
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this._renderTextureView = this.renderTexture.createView();
  }

  private createBasicPipeline() {
    const shaderModule = this.device.createShaderModule({
      code: basicShaderCode,
    });

    this._basicPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: 'vertexMain',
        buffers: [{
          arrayStride: 32,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x2' },
            { shaderLocation: 2, offset: 20, format: 'float32x3' },
          ],
        }],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [{ format: this.format }],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'back',
      },
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: 'depth24plus',
      },
    });
  }

  private createPostProcessPipelines() {
    const neonModule = this.device.createShaderModule({ code: neonShaderCode });
    this._neonPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: neonModule, entryPoint: 'vertexMain' },
      fragment: {
        module: neonModule,
        entryPoint: 'fragmentMain',
        targets: [{ format: this.format }],
      },
    });

    const vhsModule = this.device.createShaderModule({ code: vhsShaderCode });
    this._vhsPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: vhsModule, entryPoint: 'vertexMain' },
      fragment: {
        module: vhsModule,
        entryPoint: 'fragmentMain',
        targets: [{ format: this.format }],
      },
    });
  }

  resize() {
    this.renderTexture.destroy();
    this.createRenderTexture();
  }

  getTime(): number {
    return (Date.now() - this.startTime) / 1000;
  }

  get deviceRef(): GPUDevice {
    return this.device;
  }

  get samplerRef(): GPUSampler {
    return this.sampler;
  }

  // Getters for pipelines (to be used in future 3D implementation)
  get basicPipeline(): GPURenderPipeline {
    return this._basicPipeline;
  }

  get neonPipeline(): GPURenderPipeline {
    return this._neonPipeline;
  }

  get vhsPipeline(): GPURenderPipeline {
    return this._vhsPipeline;
  }

  get uniformBuffer(): GPUBuffer {
    return this._uniformBuffer;
  }

  get renderTextureView(): GPUTextureView {
    return this._renderTextureView;
  }
}
