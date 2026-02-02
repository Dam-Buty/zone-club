/**
 * Render Pipeline Orchestrator
 *
 * Manages the rendering passes for both forward and deferred rendering.
 * Acts as the central coordinator for:
 * - G-Buffer pass (geometry data collection)
 * - Shadow pass (placeholder)
 * - Lighting pass (deferred shading)
 * - Post-process pass (placeholder)
 *
 * The useDeferredRendering flag allows switching between:
 * - Forward rendering: traditional single-pass rendering
 * - Deferred rendering: multi-pass with G-Buffer
 */

import { GBuffer } from './GBuffer';

export class RenderPipeline {
  // Device stored for future use (shadow maps, post-processing)
  private _device: GPUDevice;
  private format: GPUTextureFormat;
  private gBuffer: GBuffer;

  // Flag to switch between forward and deferred rendering
  private useDeferredRendering: boolean = false;

  constructor(device: GPUDevice, format: GPUTextureFormat, width: number, height: number) {
    this._device = device;
    this.format = format;

    // Initialize G-Buffer for deferred rendering
    this.gBuffer = new GBuffer(device, width, height);
  }

  /**
   * Enable or disable deferred rendering
   * When disabled, the pipeline uses traditional forward rendering
   */
  setDeferredRendering(enabled: boolean): void {
    this.useDeferredRendering = enabled;

    if (enabled) {
      console.log('[RenderPipeline] Deferred rendering enabled');
    } else {
      console.log('[RenderPipeline] Forward rendering enabled');
    }
  }

  /**
   * Check if deferred rendering is currently enabled
   */
  isDeferredRenderingEnabled(): boolean {
    return this.useDeferredRendering;
  }

  /**
   * Resize all render resources (G-Buffer, shadow maps, etc.)
   */
  resize(width: number, height: number): void {
    this.gBuffer.resize(width, height);
  }

  /**
   * Get the G-Buffer instance
   */
  getGBuffer(): GBuffer {
    return this.gBuffer;
  }

  /**
   * Get the render pass descriptor for writing to the G-Buffer
   * Used in the geometry pass of deferred rendering
   */
  getGBufferRenderPassDescriptor(): GPURenderPassDescriptor {
    return this.gBuffer.getRenderPassDescriptor();
  }

  /**
   * Get the bind group for reading G-Buffer textures
   * Used in the lighting pass of deferred rendering
   */
  getGBufferReadBindGroup(): GPUBindGroup {
    return this.gBuffer.getReadBindGroup();
  }

  /**
   * Get the bind group layout for reading G-Buffer textures
   * Used when creating pipelines that need to sample the G-Buffer
   */
  getGBufferReadBindGroupLayout(): GPUBindGroupLayout {
    return this.gBuffer.getReadBindGroupLayout();
  }

  /**
   * Get the output format (for creating compatible pipelines)
   */
  getFormat(): GPUTextureFormat {
    return this.format;
  }

  /**
   * Get the GPU device (for creating additional resources)
   */
  getDevice(): GPUDevice {
    return this._device;
  }

  /**
   * Placeholder for shadow pass
   * Will be implemented later with shadow mapping
   */
  beginShadowPass(): void {
    console.log('[RenderPipeline] Shadow pass not implemented');
  }

  /**
   * Placeholder for post-process pass
   * Will be implemented later with bloom, tone mapping, etc.
   */
  beginPostProcessPass(): void {
    console.log('[RenderPipeline] Post-process not implemented');
  }

  /**
   * Release all GPU resources
   */
  destroy(): void {
    this.gBuffer.destroy();
  }
}
