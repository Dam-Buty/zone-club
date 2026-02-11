export class TextureLoader {
  private device: GPUDevice;
  private textureCache: Map<string, GPUTexture> = new Map();

  constructor(device: GPUDevice) {
    this.device = device;
  }

  // Load texture from URL (for TMDB posters)
  async loadFromURL(url: string): Promise<GPUTexture> {
    if (this.textureCache.has(url)) {
      return this.textureCache.get(url)!;
    }

    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const imageBitmap = await createImageBitmap(blob);

      const texture = this.device.createTexture({
        size: [imageBitmap.width, imageBitmap.height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });

      this.device.queue.copyExternalImageToTexture(
        { source: imageBitmap },
        { texture },
        [imageBitmap.width, imageBitmap.height]
      );

      this.textureCache.set(url, texture);
      return texture;
    } catch (error) {
      console.warn(`Failed to load texture: ${url}`, error);
      return this.createPlaceholderTexture();
    }
  }

  // Create text texture using Canvas
  createTextTexture(text: string, options: {
    width?: number;
    height?: number;
    fontSize?: number;
    fontFamily?: string;
    color?: string;
    backgroundColor?: string;
    glowColor?: string;
  } = {}): GPUTexture {
    const {
      width = 256,
      height = 64,
      fontSize = 32,
      fontFamily = 'Arial Black, sans-serif',
      color = '#ffffff',
      backgroundColor = '#0a0a0f',
      glowColor,
    } = options;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    // Clear canvas completely
    ctx.clearRect(0, 0, width, height);

    // Draw background
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);

    // Text settings
    ctx.font = `bold ${fontSize}px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Glow effect - draw multiple layers for stronger glow
    if (glowColor) {
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 20;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      // Draw glow layer
      ctx.fillStyle = glowColor;
      ctx.globalAlpha = 0.3;
      ctx.fillText(text, width / 2, height / 2);
      ctx.globalAlpha = 1.0;
    }

    // Draw main text
    ctx.shadowBlur = glowColor ? 10 : 0;
    ctx.shadowColor = glowColor || 'transparent';
    ctx.fillStyle = color;
    ctx.fillText(text, width / 2, height / 2);

    // Convert to texture
    const imageData = ctx.getImageData(0, 0, width, height);
    const texture = this.device.createTexture({
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    this.device.queue.writeTexture(
      { texture },
      imageData.data,
      { bytesPerRow: width * 4 },
      [width, height]
    );

    return texture;
  }

  // Create a solid color texture
  createColorTexture(r: number, g: number, b: number, a: number = 255): GPUTexture {
    const texture = this.device.createTexture({
      size: [1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    this.device.queue.writeTexture(
      { texture },
      new Uint8Array([r, g, b, a]),
      { bytesPerRow: 4 },
      [1, 1]
    );

    return texture;
  }

  // Placeholder texture (magenta/black checkerboard)
  createPlaceholderTexture(): GPUTexture {
    const size = 64;
    const data = new Uint8Array(size * size * 4);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const checker = ((x >> 3) + (y >> 3)) % 2;
        if (checker) {
          data[i] = 255;     // R
          data[i + 1] = 0;   // G
          data[i + 2] = 255; // B
        } else {
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
        }
        data[i + 3] = 255; // A
      }
    }

    const texture = this.device.createTexture({
      size: [size, size],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    this.device.queue.writeTexture(
      { texture },
      data,
      { bytesPerRow: size * 4 },
      [size, size]
    );

    return texture;
  }

  // Create VHS cassette poster texture with label
  async createCassettePosterTexture(posterUrl: string | null, title: string): Promise<GPUTexture> {
    const width = 128;
    const height = 200; // VHS box aspect ratio (portrait format)

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    // Dark background with VHS-style border
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, width, height);

    // Border effect
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, width - 4, height - 4);

    // Try to load poster image
    if (posterUrl) {
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = reject;
          img.src = posterUrl;
        });
        // Draw poster in the top area
        ctx.drawImage(img, 6, 6, width - 12, height - 50);
      } catch {
        // Draw placeholder pattern
        this.drawPlaceholderPattern(ctx, 6, 6, width - 12, height - 50);
      }
    } else {
      this.drawPlaceholderPattern(ctx, 6, 6, width - 12, height - 50);
    }

    // VHS label at bottom
    ctx.fillStyle = '#f5f5dc';
    ctx.fillRect(6, height - 42, width - 12, 36);

    // Label border
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 1;
    ctx.strokeRect(6, height - 42, width - 12, 36);

    // Title text
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const truncatedTitle = title.length > 16 ? title.substring(0, 14) + '...' : title;
    ctx.fillText(truncatedTitle, width / 2, height - 24);

    // "VHS" marker
    ctx.font = 'bold 8px Arial';
    ctx.fillStyle = '#666';
    ctx.fillText('VHS', width / 2, height - 10);

    // Convert to texture
    const imageData = ctx.getImageData(0, 0, width, height);
    const texture = this.device.createTexture({
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    this.device.queue.writeTexture(
      { texture },
      imageData.data,
      { bytesPerRow: width * 4 },
      [width, height]
    );

    return texture;
  }

  private drawPlaceholderPattern(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    // Gradient background
    const gradient = ctx.createLinearGradient(x, y, x, y + h);
    gradient.addColorStop(0, '#2a2a4a');
    gradient.addColorStop(1, '#1a1a2a');
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, w, h);

    // Film reel icon
    ctx.fillStyle = '#444';
    const cx = x + w / 2;
    const cy = y + h / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 25, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(cx, cy, 10, 0, Math.PI * 2);
    ctx.fill();
  }
}
