/**
 * MASK GENERATOR - VideoClub Storefront
 * =====================================
 * Analyzes the storefront image and generates a mask texture where:
 * - Red channel: Neon areas (255=full neon, 200=letter O, 150=letter B, 100=Open24/7)
 * - Green channel: Glass/window areas (255=glass)
 * - Blue channel: Metal frame areas (255=metal)
 * - Alpha: Reserved for future use
 */

import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INPUT_PATH = path.join(__dirname, '../public/storefront.jpeg');
const OUTPUT_PATH = path.join(__dirname, '../public/storefront-mask.png');

// Color detection thresholds - balanced
const NEON_PURPLE = {
  // Purple neon tubes
  minR: 100, maxR: 255,
  minG: 0, maxG: 130,
  minB: 150, maxB: 255,
  minBrightness: 120
};

const NEON_PINK = {
  // Pink neon (Open 24/7)
  minR: 180, maxR: 255,
  minG: 50, maxG: 180,
  minB: 150, maxB: 255,
  minBrightness: 140
};

async function generateMask() {
  console.log('Loading storefront image...');

  const image = sharp(INPUT_PATH);
  const metadata = await image.metadata();
  const { width, height } = metadata;

  console.log(`Image size: ${width}x${height}`);

  // Get raw pixel data
  const { data, info } = await image
    .raw()
    .toBuffer({ resolveWithObject: true });

  console.log('Analyzing pixels...');

  // Create mask buffer (RGBA)
  const maskData = Buffer.alloc(width * height * 4);

  // Statistics
  let neonPixels = 0;
  let glassPixels = 0;
  let metalPixels = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * info.channels;
      const dstIdx = (y * width + x) * 4;

      const r = data[srcIdx];
      const g = data[srcIdx + 1];
      const b = data[srcIdx + 2];

      const brightness = (r + g + b) / 3;
      const normalizedX = x / width;
      const normalizedY = y / height;

      let redChannel = 0;   // Neon
      let greenChannel = 0; // Glass
      let blueChannel = 0;  // Metal

      // ========== NEON DETECTION ==========

      // Check for purple neon (VIDEOCLUB sign)
      const isPurpleNeon = (
        r >= NEON_PURPLE.minR && r <= NEON_PURPLE.maxR &&
        g >= NEON_PURPLE.minG && g <= NEON_PURPLE.maxG &&
        b >= NEON_PURPLE.minB && b <= NEON_PURPLE.maxB &&
        brightness >= NEON_PURPLE.minBrightness &&
        b > g && // Blue must be stronger than green
        (r + b) > g * 2 // Purple characteristic
      );

      // Check for pink neon (Open 24/7)
      const isPinkNeon = (
        r >= NEON_PINK.minR && r <= NEON_PINK.maxR &&
        g >= NEON_PINK.minG && g <= NEON_PINK.maxG &&
        b >= NEON_PINK.minB && b <= NEON_PINK.maxB &&
        brightness >= NEON_PINK.minBrightness &&
        r > b // Pink has more red than blue
      );

      // VIDEOCLUB sign - top portion of the image
      if (isPurpleNeon && normalizedY < 0.22) {
        // Determine which letter based on X position
        if (normalizedX >= 0.42 && normalizedX <= 0.52) {
          redChannel = 200; // Letter O
        } else if (normalizedX >= 0.80 && normalizedX <= 0.92) {
          redChannel = 150; // Letter B
        } else {
          redChannel = 255; // Other letters
        }
        neonPixels++;
      } else if (isPinkNeon && normalizedX < 0.20 && normalizedY > 0.18 && normalizedY < 0.32) {
        // Open 24/7 sign
        redChannel = 100;
        neonPixels++;
      }
      // No glow/spill - only actual neon

      // ========== GLASS DETECTION ==========

      // Glass areas show the interior - warmer colors, medium brightness
      // Also detect by position (we know where windows are roughly)

      const isInDoorArea = (
        normalizedX >= 0.01 && normalizedX <= 0.20 &&
        normalizedY >= 0.28 && normalizedY <= 0.85
      );

      const isInMainWindowArea = (
        normalizedX >= 0.22 && normalizedX <= 0.99 &&
        normalizedY >= 0.18 && normalizedY <= 0.85
      );

      // Glass shows interior - check for interior characteristics
      // Interior has warm light, shelves, posters
      const hasInteriorColor = (
        brightness > 40 && brightness < 240 && // Not too dark, not blown out
        !(isPurpleNeon || isPinkNeon) // Not neon
      );

      if ((isInDoorArea || isInMainWindowArea) && hasInteriorColor) {
        // Check if it's not part of the metal frame
        const isNotFrame = !(
          // Vertical divider
          (normalizedX >= 0.19 && normalizedX <= 0.23) ||
          // Door frame
          (normalizedX >= 0.00 && normalizedX <= 0.02) ||
          // Right edge
          (normalizedX >= 0.98)
        );

        if (isNotFrame) {
          greenChannel = 255;
          glassPixels++;
        }
      }

      // ========== METAL DETECTION ==========

      // Metal frames are dark, low saturation
      const saturation = Math.max(r, g, b) - Math.min(r, g, b);
      const isDark = brightness < 60;
      const isLowSaturation = saturation < 40;

      // Metal frame positions
      const isTopFrame = normalizedY >= 0.16 && normalizedY <= 0.19;
      const isBottomFrame = normalizedY >= 0.84 && normalizedY <= 0.87;
      const isVerticalDivider = normalizedX >= 0.19 && normalizedX <= 0.22 && normalizedY > 0.18 && normalizedY < 0.85;
      const isLeftEdge = normalizedX <= 0.02 && normalizedY > 0.18;
      const isRightEdge = normalizedX >= 0.98 && normalizedY > 0.18;

      if ((isTopFrame || isBottomFrame || isVerticalDivider || isLeftEdge || isRightEdge) && isDark) {
        blueChannel = 255;
        metalPixels++;
      } else if (isDark && isLowSaturation && normalizedY > 0.15 && normalizedY < 0.88) {
        // Other dark metal-like areas
        blueChannel = 128;
      }

      // ========== GROUND DETECTION ==========
      // Ground is at the bottom - mark it in a special way
      // We'll use a combination: low green + some blue for wet ground

      if (normalizedY > 0.86) {
        greenChannel = 50; // Low glass value indicates ground
        // Ground can reflect, mark it
        if (brightness < 80) {
          blueChannel = Math.max(blueChannel, 100); // Ground has some metallic reflection
        }
      }

      // Write to mask
      maskData[dstIdx] = redChannel;
      maskData[dstIdx + 1] = greenChannel;
      maskData[dstIdx + 2] = blueChannel;
      maskData[dstIdx + 3] = 255; // Alpha
    }
  }

  console.log(`Detected: ${neonPixels} neon, ${glassPixels} glass, ${metalPixels} metal pixels`);

  // Create mask image with blur for soft edges
  console.log('Generating mask image with soft edges...');

  // First create the raw mask
  const rawMask = await sharp(maskData, {
    raw: {
      width,
      height,
      channels: 4
    }
  }).png().toBuffer();

  // Apply Gaussian blur to soften edges (sigma based on image size)
  const blurSigma = Math.max(width, height) / 300; // Adaptive blur

  await sharp(rawMask)
    .blur(blurSigma)
    .png()
    .toFile(OUTPUT_PATH);

  console.log(`Mask saved to: ${OUTPUT_PATH}`);

  // Also create a visualization version for debugging
  const vizPath = path.join(__dirname, '../public/storefront-mask-viz.png');

  // Create a more visible version for debugging
  const vizData = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const srcIdx = i * 4;
    // Boost colors for visibility
    vizData[srcIdx] = Math.min(255, maskData[srcIdx] * 1.5);     // Red (neon)
    vizData[srcIdx + 1] = Math.min(255, maskData[srcIdx + 1]);   // Green (glass)
    vizData[srcIdx + 2] = Math.min(255, maskData[srcIdx + 2] * 2); // Blue (metal)
    vizData[srcIdx + 3] = 255;
  }

  await sharp(vizData, {
    raw: { width, height, channels: 4 }
  })
    .png()
    .toFile(vizPath);

  console.log(`Visualization saved to: ${vizPath}`);
}

generateMask().catch(console.error);
