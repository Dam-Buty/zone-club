/**
 * MASK GENERATOR - Combine manual material mask + auto neon detection
 *
 * Input:
 * - material-videoclub.jpeg: Manual mask (green=glass, blue=metal)
 * - storefront.jpeg: Original image (for neon detection)
 *
 * Output:
 * - storefront-mask.png: Combined mask
 *   - Red channel: Neon (auto-detected from purple/pink)
 *   - Green channel: Glass (from manual mask green areas)
 *   - Blue channel: Metal (from manual mask blue areas)
 */

import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORIGINAL_PATH = path.join(__dirname, '../public/storefront.jpeg');
const MANUAL_MASK_PATH = path.join(__dirname, '../material-videoclub.jpeg');
const OUTPUT_PATH = path.join(__dirname, '../public/storefront-mask.png');

// Neon detection thresholds (worked well before)
const NEON_PURPLE = {
  minR: 100, maxR: 255,
  minG: 0, maxG: 130,
  minB: 150, maxB: 255,
  minBrightness: 120
};

const NEON_PINK = {
  minR: 180, maxR: 255,
  minG: 50, maxG: 180,
  minB: 150, maxB: 255,
  minBrightness: 140
};

async function generateMask() {
  console.log('Loading images...');

  // Load original image for neon detection
  const originalImage = sharp(ORIGINAL_PATH);
  const originalMeta = await originalImage.metadata();
  const { width, height } = originalMeta;

  const { data: originalData } = await originalImage
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Load manual mask and resize to match original
  const { data: manualData } = await sharp(MANUAL_MASK_PATH)
    .resize(width, height)
    .raw()
    .toBuffer({ resolveWithObject: true });

  console.log(`Image size: ${width}x${height}`);
  console.log('Processing pixels...');

  // Create output mask (RGBA)
  const maskData = Buffer.alloc(width * height * 4);

  let neonPixels = 0;
  let glassPixels = 0;
  let metalPixels = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3;
      const outIdx = (y * width + x) * 4;

      // Original image colors (for neon detection)
      const origR = originalData[idx];
      const origG = originalData[idx + 1];
      const origB = originalData[idx + 2];
      const origBrightness = (origR + origG + origB) / 3;

      // Manual mask colors
      const maskR = manualData[idx];
      const maskG = manualData[idx + 1];
      const maskB = manualData[idx + 2];

      const normalizedX = x / width;
      const normalizedY = y / height;

      let redChannel = 0;   // Neon
      let greenChannel = 0; // Glass
      let blueChannel = 0;  // Metal

      // ========== NEON DETECTION (from original) ==========
      const isPurpleNeon = (
        origR >= NEON_PURPLE.minR && origR <= NEON_PURPLE.maxR &&
        origG >= NEON_PURPLE.minG && origG <= NEON_PURPLE.maxG &&
        origB >= NEON_PURPLE.minB && origB <= NEON_PURPLE.maxB &&
        origBrightness >= NEON_PURPLE.minBrightness &&
        origB > origG &&
        (origR + origB) > origG * 2
      );

      const isPinkNeon = (
        origR >= NEON_PINK.minR && origR <= NEON_PINK.maxR &&
        origG >= NEON_PINK.minG && origG <= NEON_PINK.maxG &&
        origB >= NEON_PINK.minB && origB <= NEON_PINK.maxB &&
        origBrightness >= NEON_PINK.minBrightness &&
        origR > origB
      );

      if (isPurpleNeon && normalizedY < 0.22) {
        // VIDEOCLUB letters
        if (normalizedX >= 0.42 && normalizedX <= 0.52) {
          redChannel = 200; // Letter O
        } else if (normalizedX >= 0.80 && normalizedX <= 0.92) {
          redChannel = 150; // Letter B
        } else {
          redChannel = 255;
        }
        neonPixels++;
      } else if (isPinkNeon && normalizedX < 0.20 && normalizedY > 0.18 && normalizedY < 0.32) {
        // Open 24/7
        redChannel = 100;
        neonPixels++;
      }

      // ========== GLASS DETECTION (from manual mask - green areas) ==========
      // Green is dominant when G > R and G > B
      if (maskG > 100 && maskG > maskR * 1.2 && maskG > maskB * 1.2) {
        greenChannel = 255;
        glassPixels++;
      }

      // ========== METAL DETECTION (from manual mask - blue areas) ==========
      // Blue is dominant when B > R and B > G
      if (maskB > 100 && maskB > maskR * 1.2 && maskB > maskG * 1.0) {
        blueChannel = 255;
        metalPixels++;
      }

      // Write to mask
      maskData[outIdx] = redChannel;
      maskData[outIdx + 1] = greenChannel;
      maskData[outIdx + 2] = blueChannel;
      maskData[outIdx + 3] = 255;
    }
  }

  console.log(`Detected: ${neonPixels} neon, ${glassPixels} glass, ${metalPixels} metal pixels`);

  // Apply slight blur for soft edges
  console.log('Generating mask with soft edges...');

  const rawMask = await sharp(maskData, {
    raw: { width, height, channels: 4 }
  }).png().toBuffer();

  const blurSigma = Math.max(width, height) / 400;

  await sharp(rawMask)
    .blur(blurSigma)
    .png()
    .toFile(OUTPUT_PATH);

  console.log(`Mask saved to: ${OUTPUT_PATH}`);

  // Visualization
  const vizPath = path.join(__dirname, '../public/storefront-mask-viz.png');
  await sharp(rawMask)
    .blur(blurSigma)
    .png()
    .toFile(vizPath);

  console.log(`Visualization saved to: ${vizPath}`);
}

generateMask().catch(console.error);
