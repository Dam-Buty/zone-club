/**
 * TextureAtlas - Manages a texture atlas for efficient poster rendering
 *
 * Groups multiple poster textures into a single GPU texture to reduce
 * draw calls and texture binding overhead.
 */

export interface AtlasSlot {
  index: number;
  // UV coordinates normalized (0-1)
  u0: number;  // left
  v0: number;  // top
  u1: number;  // right
  v1: number;  // bottom
}

export class TextureAtlas {
  private device: GPUDevice;
  private texture: GPUTexture;
  private textureView: GPUTextureView;

  // Atlas configuration
  private atlasSize: number;
  private slotWidth: number;
  private slotHeight: number;
  private cols: number;
  private rows: number;
  private nextSlot: number;
  private capacity: number;

  /**
   * Create a new texture atlas
   * @param device - WebGPU device
   * @param atlasSize - Size of the atlas texture (default 4096)
   * @param slotWidth - Width of each slot (default 256)
   * @param slotHeight - Height of each slot (default 384 for VHS aspect ratio)
   */
  constructor(
    device: GPUDevice,
    atlasSize: number = 4096,
    slotWidth: number = 256,
    slotHeight: number = 384
  ) {
    this.device = device;
    this.atlasSize = atlasSize;
    this.slotWidth = slotWidth;
    this.slotHeight = slotHeight;
    this.nextSlot = 0;

    // Calculate grid dimensions
    this.cols = Math.floor(atlasSize / slotWidth);
    this.rows = Math.floor(atlasSize / slotHeight);
    this.capacity = this.cols * this.rows;

    // Create the atlas texture
    this.texture = device.createTexture({
      size: [atlasSize, atlasSize],
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });

    this.textureView = this.texture.createView();

    // Initialize atlas with a dark background
    this.clearAtlasTexture();
  }

  /**
   * Clear the atlas texture to a dark color
   */
  private clearAtlasTexture(): void {
    // Create a dark background color (VHS style)
    const clearColor = new Uint8Array(this.atlasSize * this.atlasSize * 4);
    for (let i = 0; i < clearColor.length; i += 4) {
      clearColor[i] = 26;      // R - dark grey
      clearColor[i + 1] = 26;  // G
      clearColor[i + 2] = 26;  // B
      clearColor[i + 3] = 255; // A
    }

    this.device.queue.writeTexture(
      { texture: this.texture },
      clearColor,
      { bytesPerRow: this.atlasSize * 4 },
      [this.atlasSize, this.atlasSize]
    );
  }

  /**
   * Add an image to the atlas
   * @param imageBitmap - The image to add
   * @returns The slot with UV coordinates, or null if atlas is full
   */
  async addImage(imageBitmap: ImageBitmap): Promise<AtlasSlot | null> {
    if (!this.hasSpace()) {
      console.warn('TextureAtlas: Atlas is full, cannot add more images');
      return null;
    }

    // Calculate position in the atlas
    const col = this.nextSlot % this.cols;
    const row = Math.floor(this.nextSlot / this.cols);
    const x = col * this.slotWidth;
    const y = row * this.slotHeight;

    // Resize image if necessary
    let sourceImage: ImageBitmap = imageBitmap;
    if (imageBitmap.width !== this.slotWidth || imageBitmap.height !== this.slotHeight) {
      sourceImage = await this.resizeImage(imageBitmap, this.slotWidth, this.slotHeight);
    }

    // Copy image to atlas
    this.device.queue.copyExternalImageToTexture(
      { source: sourceImage },
      { texture: this.texture, origin: [x, y] },
      [this.slotWidth, this.slotHeight]
    );

    // Calculate normalized UV coordinates
    const slot: AtlasSlot = {
      index: this.nextSlot,
      u0: x / this.atlasSize,
      v0: y / this.atlasSize,
      u1: (x + this.slotWidth) / this.atlasSize,
      v1: (y + this.slotHeight) / this.atlasSize,
    };

    this.nextSlot++;
    return slot;
  }

  /**
   * Add an image from URL
   * @param url - The URL of the image to load
   * @returns The slot with UV coordinates, or null if loading fails or atlas is full
   */
  async addImageFromURL(url: string): Promise<AtlasSlot | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`TextureAtlas: Failed to fetch image: ${url}`);
        return null;
      }

      const blob = await response.blob();
      const imageBitmap = await createImageBitmap(blob);
      return this.addImage(imageBitmap);
    } catch (error) {
      console.warn(`TextureAtlas: Error loading image from URL: ${url}`, error);
      return null;
    }
  }

  /**
   * Get UV coordinates for a slot index
   * @param index - The slot index
   * @returns The slot with UV coordinates, or null if index is invalid
   */
  getSlotUV(index: number): AtlasSlot | null {
    if (index < 0 || index >= this.nextSlot) {
      return null;
    }

    const col = index % this.cols;
    const row = Math.floor(index / this.cols);
    const x = col * this.slotWidth;
    const y = row * this.slotHeight;

    return {
      index,
      u0: x / this.atlasSize,
      v0: y / this.atlasSize,
      u1: (x + this.slotWidth) / this.atlasSize,
      v1: (y + this.slotHeight) / this.atlasSize,
    };
  }

  /**
   * Get the GPU texture
   */
  getTexture(): GPUTexture {
    return this.texture;
  }

  /**
   * Get texture view
   */
  getTextureView(): GPUTextureView {
    return this.textureView;
  }

  /**
   * Get total capacity
   */
  getCapacity(): number {
    return this.capacity;
  }

  /**
   * Get used slots count
   */
  getUsedSlots(): number {
    return this.nextSlot;
  }

  /**
   * Check if atlas has space
   */
  hasSpace(): boolean {
    return this.nextSlot < this.capacity;
  }

  /**
   * Get atlas configuration info
   */
  getInfo(): {
    atlasSize: number;
    slotWidth: number;
    slotHeight: number;
    cols: number;
    rows: number;
    capacity: number;
    usedSlots: number;
  } {
    return {
      atlasSize: this.atlasSize,
      slotWidth: this.slotWidth,
      slotHeight: this.slotHeight,
      cols: this.cols,
      rows: this.rows,
      capacity: this.capacity,
      usedSlots: this.nextSlot,
    };
  }

  /**
   * Clear the atlas (reset to empty)
   */
  clear(): void {
    this.nextSlot = 0;
    this.clearAtlasTexture();
  }

  /**
   * Destroy GPU resources
   */
  destroy(): void {
    this.texture.destroy();
  }

  /**
   * Resize an image to fit the slot dimensions
   * @param source - The source image
   * @param targetWidth - Target width
   * @param targetHeight - Target height
   * @returns A resized ImageBitmap
   */
  private async resizeImage(
    source: ImageBitmap,
    targetWidth: number,
    targetHeight: number
  ): Promise<ImageBitmap> {
    // Use createImageBitmap with resize options for efficient GPU-accelerated resizing
    return createImageBitmap(source, {
      resizeWidth: targetWidth,
      resizeHeight: targetHeight,
      resizeQuality: 'high',
    });
  }
}
