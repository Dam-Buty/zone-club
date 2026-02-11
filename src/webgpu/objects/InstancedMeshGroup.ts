/**
 * InstancedMeshGroup - GPU Instancing for efficient rendering of many identical meshes
 *
 * This class enables rendering thousands of instances with a single draw call,
 * dramatically reducing CPU overhead from ~3000 draw calls to just 1.
 *
 * Instance buffer format (80 bytes per instance, 16-byte aligned):
 * - mat4x4 transform     (16 floats, 64 bytes) - offset 0
 * - float  textureIndex  (1 float, 4 bytes)    - offset 64
 * - float  userData      (1 float, 4 bytes)    - offset 68
 * - vec2   _padding      (2 floats, 8 bytes)   - offset 72
 *
 * Total: 80 bytes = 20 floats per instance
 */

import { mat4 } from 'gl-matrix';
import type { Mesh } from '../core/Geometry';

/**
 * Data for a single instance
 */
export interface InstanceData {
  /** Model transform matrix (mat4x4 = 16 floats) */
  transform: Float32Array;
  /** Index into texture atlas for this instance */
  textureIndex: number;
  /** Custom user data (e.g., filmId for cassettes) */
  userData?: number;
}

/** Number of floats per instance in the GPU buffer */
const FLOATS_PER_INSTANCE = 20;
/** Bytes per instance (20 floats * 4 bytes) */
const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4; // 80 bytes
/** Default maximum number of instances */
const DEFAULT_MAX_INSTANCES = 4000;

/**
 * Manages a group of instanced meshes for efficient GPU rendering.
 *
 * Usage:
 * ```typescript
 * const group = new InstancedMeshGroup(device, cassetteMesh, 4000);
 *
 * // Add instances
 * const transform = mat4.create();
 * mat4.translate(transform, transform, [x, y, z]);
 * const index = group.addInstance(transform, textureIndex, filmId);
 *
 * // In render loop
 * group.uploadInstances();
 * pass.setVertexBuffer(0, group.getVertexBuffer());
 * pass.setVertexBuffer(1, group.getInstanceBuffer());
 * pass.setIndexBuffer(group.getIndexBuffer(), 'uint16');
 * pass.drawIndexed(group.getIndexCount(), group.getInstanceCount());
 * ```
 */
export class InstancedMeshGroup {
  private device: GPUDevice;
  private mesh: Mesh;

  private vertexBuffer: GPUBuffer;
  private indexBuffer: GPUBuffer;
  private instanceBuffer: GPUBuffer;

  private instances: InstanceData[] = [];
  private maxInstances: number;
  private dirty: boolean = true;

  // CPU-side instance data buffer for efficient updates
  private instanceDataArray: Float32Array;

  /**
   * Create a new instanced mesh group
   * @param device - WebGPU device
   * @param mesh - The mesh geometry to instance
   * @param maxInstances - Maximum number of instances (default: 4000)
   */
  constructor(device: GPUDevice, mesh: Mesh, maxInstances: number = DEFAULT_MAX_INSTANCES) {
    this.device = device;
    this.mesh = mesh;
    this.maxInstances = maxInstances;

    // Create vertex buffer
    this.vertexBuffer = device.createBuffer({
      size: mesh.vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      label: 'InstancedMeshGroup-vertexBuffer',
    });
    device.queue.writeBuffer(this.vertexBuffer, 0, mesh.vertices.buffer);

    // Create index buffer
    this.indexBuffer = device.createBuffer({
      size: mesh.indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      label: 'InstancedMeshGroup-indexBuffer',
    });
    device.queue.writeBuffer(this.indexBuffer, 0, mesh.indices.buffer);

    // Create instance buffer with max capacity
    this.instanceBuffer = device.createBuffer({
      size: BYTES_PER_INSTANCE * maxInstances,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      label: 'InstancedMeshGroup-instanceBuffer',
    });

    // Pre-allocate CPU-side buffer for instance data
    this.instanceDataArray = new Float32Array(FLOATS_PER_INSTANCE * maxInstances);
  }

  /**
   * Add a new instance to the group
   * @param transform - The model transform matrix (mat4)
   * @param textureIndex - Index into the texture atlas
   * @param userData - Optional custom data (e.g., filmId)
   * @returns The index of the newly added instance
   * @throws Error if maximum instances exceeded
   */
  addInstance(transform: mat4, textureIndex: number, userData: number = 0): number {
    if (this.instances.length >= this.maxInstances) {
      throw new Error(
        `InstancedMeshGroup: Maximum instances (${this.maxInstances}) exceeded. ` +
        `Consider increasing maxInstances in constructor.`
      );
    }

    const index = this.instances.length;

    // Store a copy of the transform to avoid reference issues
    const transformCopy = new Float32Array(16);
    transformCopy.set(transform as Float32Array);

    this.instances.push({
      transform: transformCopy,
      textureIndex,
      userData,
    });

    this.dirty = true;
    return index;
  }

  /**
   * Update an existing instance's transform
   * @param index - The instance index
   * @param transform - New transform matrix
   */
  updateInstance(index: number, transform: mat4): void {
    if (index < 0 || index >= this.instances.length) {
      console.warn(`InstancedMeshGroup: Invalid instance index ${index}`);
      return;
    }

    this.instances[index].transform.set(transform as Float32Array);
    this.dirty = true;
  }

  /**
   * Update an existing instance's texture index
   * @param index - The instance index
   * @param textureIndex - New texture index
   */
  updateInstanceTexture(index: number, textureIndex: number): void {
    if (index < 0 || index >= this.instances.length) {
      console.warn(`InstancedMeshGroup: Invalid instance index ${index}`);
      return;
    }

    this.instances[index].textureIndex = textureIndex;
    this.dirty = true;
  }

  /**
   * Remove an instance by swapping with the last instance (O(1) removal)
   * @param index - The instance index to remove
   * @returns The new index of the instance that was moved (or -1 if nothing moved)
   */
  removeInstance(index: number): number {
    if (index < 0 || index >= this.instances.length) {
      console.warn(`InstancedMeshGroup: Invalid instance index ${index}`);
      return -1;
    }

    const lastIndex = this.instances.length - 1;

    if (index !== lastIndex) {
      // Swap with last element for O(1) removal
      this.instances[index] = this.instances[lastIndex];
    }

    this.instances.pop();
    this.dirty = true;

    // Return the index of the moved instance (if any)
    return index !== lastIndex ? index : -1;
  }

  /**
   * Get the current number of instances
   */
  getInstanceCount(): number {
    return this.instances.length;
  }

  /**
   * Upload instance data to GPU if dirty
   * Call this once per frame before rendering
   */
  uploadInstances(): void {
    if (!this.dirty || this.instances.length === 0) {
      return;
    }

    // Pack instance data into the pre-allocated array
    for (let i = 0; i < this.instances.length; i++) {
      const instance = this.instances[i];
      const offset = i * FLOATS_PER_INSTANCE;

      // Copy transform matrix (16 floats)
      this.instanceDataArray.set(instance.transform, offset);

      // textureIndex at offset 16
      this.instanceDataArray[offset + 16] = instance.textureIndex;

      // userData at offset 17
      this.instanceDataArray[offset + 17] = instance.userData ?? 0;

      // Padding at offset 18, 19 (already initialized to 0)
      this.instanceDataArray[offset + 18] = 0;
      this.instanceDataArray[offset + 19] = 0;
    }

    // Upload only the used portion of the buffer
    const usedFloats = this.instances.length * FLOATS_PER_INSTANCE;
    this.device.queue.writeBuffer(
      this.instanceBuffer,
      0,
      this.instanceDataArray.buffer,
      0,
      usedFloats * 4 // Convert float count to bytes
    );

    this.dirty = false;
  }

  /**
   * Get the vertex buffer for rendering
   */
  getVertexBuffer(): GPUBuffer {
    return this.vertexBuffer;
  }

  /**
   * Get the index buffer for rendering
   */
  getIndexBuffer(): GPUBuffer {
    return this.indexBuffer;
  }

  /**
   * Get the instance buffer for rendering
   */
  getInstanceBuffer(): GPUBuffer {
    return this.instanceBuffer;
  }

  /**
   * Get the number of indices in the mesh
   */
  getIndexCount(): number {
    return this.mesh.indices.length;
  }

  /**
   * Get the underlying mesh
   */
  getMesh(): Mesh {
    return this.mesh;
  }

  /**
   * Get instance data by index
   * @param index - The instance index
   * @returns The instance data or undefined if index is invalid
   */
  getInstance(index: number): InstanceData | undefined {
    if (index < 0 || index >= this.instances.length) {
      return undefined;
    }
    return this.instances[index];
  }

  /**
   * Find instances by userData value
   * @param userData - The userData value to search for
   * @returns Array of instance indices with matching userData
   */
  findInstancesByUserData(userData: number): number[] {
    const result: number[] = [];
    for (let i = 0; i < this.instances.length; i++) {
      if (this.instances[i].userData === userData) {
        result.push(i);
      }
    }
    return result;
  }

  /**
   * Clear all instances
   */
  clear(): void {
    this.instances = [];
    this.dirty = true;
  }

  /**
   * Check if the instance buffer needs updating
   */
  isDirty(): boolean {
    return this.dirty;
  }

  /**
   * Force mark as dirty (useful after external modifications)
   */
  markDirty(): void {
    this.dirty = true;
  }

  /**
   * Get the maximum number of instances this group can hold
   */
  getMaxInstances(): number {
    return this.maxInstances;
  }

  /**
   * Destroy GPU resources
   */
  destroy(): void {
    this.vertexBuffer.destroy();
    this.indexBuffer.destroy();
    this.instanceBuffer.destroy();
    this.instances = [];
  }
}

/**
 * Vertex buffer layout for the mesh (per-vertex data)
 * Use this when creating a render pipeline
 */
export const VERTEX_BUFFER_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: 32, // 8 floats * 4 bytes
  stepMode: 'vertex',
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },  // position
    { shaderLocation: 1, offset: 12, format: 'float32x2' }, // uv
    { shaderLocation: 2, offset: 20, format: 'float32x3' }, // normal
  ],
};

/**
 * Instance buffer layout (per-instance data)
 * Use this when creating a render pipeline
 */
export const INSTANCE_BUFFER_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: 80, // 20 floats * 4 bytes
  stepMode: 'instance',
  attributes: [
    { shaderLocation: 3, offset: 0, format: 'float32x4' },  // transform col 0
    { shaderLocation: 4, offset: 16, format: 'float32x4' }, // transform col 1
    { shaderLocation: 5, offset: 32, format: 'float32x4' }, // transform col 2
    { shaderLocation: 6, offset: 48, format: 'float32x4' }, // transform col 3
    { shaderLocation: 7, offset: 64, format: 'float32' },   // textureIndex
    { shaderLocation: 8, offset: 68, format: 'float32' },   // userData
  ],
};

/**
 * Combined vertex buffer layouts for pipeline creation
 * Example usage:
 * ```typescript
 * const pipeline = device.createRenderPipeline({
 *   vertex: {
 *     module: shaderModule,
 *     entryPoint: 'vertexMain',
 *     buffers: INSTANCED_VERTEX_BUFFER_LAYOUTS,
 *   },
 *   // ...
 * });
 * ```
 */
export const INSTANCED_VERTEX_BUFFER_LAYOUTS: GPUVertexBufferLayout[] = [
  VERTEX_BUFFER_LAYOUT,
  INSTANCE_BUFFER_LAYOUT,
];
