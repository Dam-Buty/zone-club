import { useEffect, useRef } from 'react';
import styles from './ExteriorEffects.module.css';

// Neon positions (percentages relative to image)
// These will need adjustment based on the actual image
const NEON_CONFIG = {
  videoclub: {
    // Full "VIDEOCLUB" text area
    x: 0.22, // 22% from left
    y: 0.02, // 2% from top
    width: 0.56, // 56% width
    height: 0.12, // 12% height
    color: { r: 147, g: 51, b: 234 }, // Purple #9333EA
  },
  // Individual letter positions for O and B (approximate)
  letterO: {
    x: 0.41, // Position of O in VIDEOCLUB
    y: 0.02,
    width: 0.06,
    height: 0.12,
  },
  letterB: {
    x: 0.72, // Position of B in VIDEOCLUB
    y: 0.02,
    width: 0.06,
    height: 0.12,
  },
  open247: {
    x: 0.02, // Left side
    y: 0.30, // Below neon sign
    width: 0.12,
    height: 0.08,
    color: { r: 236, g: 72, b: 153 }, // Pink #EC4899
  },
};

// Cycle duration in milliseconds
const CYCLE_DURATION = 45000; // 45 seconds

export function ExteriorEffects() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const startTimeRef = useRef<number>(Date.now());
  // Random phase offset for B so it's desynchronized from O
  const bPhaseOffset = useRef<number>(Math.random() * Math.PI * 2);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    resize();
    window.addEventListener('resize', resize);

    const animate = () => {
      const elapsed = Date.now() - startTimeRef.current;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw main VIDEOCLUB glow (constant for all letters except O and B)
      drawNeonGlow(ctx, canvas, NEON_CONFIG.videoclub, 1.0);

      // Calculate O modulation: 100% -> 10% -> 100% over 45s
      const oPhase = (elapsed / CYCLE_DURATION) * Math.PI * 2;
      const oIntensity = 0.1 + 0.9 * ((Math.cos(oPhase) + 1) / 2);

      // Calculate B modulation: same pattern but with phase offset
      const bPhase = (elapsed / CYCLE_DURATION) * Math.PI * 2 + bPhaseOffset.current;
      const bIntensity = 0.1 + 0.9 * ((Math.cos(bPhase) + 1) / 2);

      // Draw O and B with their individual intensities
      // We draw a darker overlay when intensity is low to simulate dimming
      drawLetterDim(ctx, canvas, NEON_CONFIG.letterO, 1 - oIntensity, NEON_CONFIG.videoclub.color);
      drawLetterDim(ctx, canvas, NEON_CONFIG.letterB, 1 - bIntensity, NEON_CONFIG.videoclub.color);

      // Draw Open 24/7 glow (constant with slight flicker)
      const flickerIntensity = 0.9 + Math.sin(elapsed * 0.01) * 0.05 + Math.sin(elapsed * 0.023) * 0.03;
      drawNeonGlow(ctx, canvas, NEON_CONFIG.open247, flickerIntensity);

      // Draw occasional car reflection
      drawCarReflection(ctx, canvas, elapsed);

      // Draw subtle interior light variation
      drawInteriorGlow(ctx, canvas, elapsed);

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationRef.current);
    };
  }, []);

  return <canvas ref={canvasRef} className={styles.effectsCanvas} />;
}

function drawNeonGlow(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  config: { x: number; y: number; width: number; height: number; color: { r: number; g: number; b: number } },
  intensity: number
) {
  const x = config.x * canvas.width;
  const y = config.y * canvas.height;
  const w = config.width * canvas.width;
  const h = config.height * canvas.height;

  const centerX = x + w / 2;
  const centerY = y + h / 2;
  const radius = Math.max(w, h) * 1.2;

  const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);

  const { r, g, b } = config.color;
  const alpha = 0.4 * intensity;

  gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha})`);
  gradient.addColorStop(0.3, `rgba(${r}, ${g}, ${b}, ${alpha * 0.5})`);
  gradient.addColorStop(0.6, `rgba(${r}, ${g}, ${b}, ${alpha * 0.2})`);
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(x - radius, y - radius, w + radius * 2, h + radius * 2);
}

function drawLetterDim(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  config: { x: number; y: number; width: number; height: number },
  dimAmount: number,
  color: { r: number; g: number; b: number }
) {
  if (dimAmount <= 0) return;

  const x = config.x * canvas.width;
  const y = config.y * canvas.height;
  const w = config.width * canvas.width;
  const h = config.height * canvas.height;

  // When dimming, we reduce the glow in that area
  // by drawing a dark gradient to cancel out the base glow
  const centerX = x + w / 2;
  const centerY = y + h / 2;
  const radius = Math.max(w, h) * 1.5;

  const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);

  // Dim the area by reducing brightness
  const { r, g, b } = color;
  const dimAlpha = dimAmount * 0.35;

  gradient.addColorStop(0, `rgba(0, 0, 0, ${dimAlpha})`);
  gradient.addColorStop(0.5, `rgba(0, 0, 0, ${dimAlpha * 0.3})`);
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(x - radius, y - radius, w + radius * 2, h + radius * 2);

  // Add a subtle colored glow based on remaining intensity
  const glowAlpha = (1 - dimAmount) * 0.15;
  if (glowAlpha > 0) {
    const glowGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius * 0.8);
    glowGradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${glowAlpha})`);
    glowGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glowGradient;
    ctx.fillRect(x - radius, y - radius, w + radius * 2, h + radius * 2);
  }
}

function drawCarReflection(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, elapsed: number) {
  // Car passes every ~8 seconds
  const cycleTime = 8000;
  const position = (elapsed % cycleTime) / cycleTime;

  // Only draw when "car" is in view (position 0.2 to 0.8)
  if (position < 0.1 || position > 0.9) return;

  const normalizedPos = (position - 0.1) / 0.8;
  const x = normalizedPos * canvas.width * 1.4 - canvas.width * 0.2;

  // Window area (where reflections would appear)
  const windowTop = canvas.height * 0.32;
  const windowBottom = canvas.height * 0.75;
  const windowHeight = windowBottom - windowTop;

  // Create a vertical light streak
  const gradient = ctx.createLinearGradient(x - 80, 0, x + 80, 0);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
  gradient.addColorStop(0.3, 'rgba(255, 255, 220, 0.03)');
  gradient.addColorStop(0.5, 'rgba(255, 255, 200, 0.06)');
  gradient.addColorStop(0.7, 'rgba(255, 255, 220, 0.03)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(x - 80, windowTop, 160, windowHeight);
}

function drawInteriorGlow(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, elapsed: number) {
  // Subtle pulsing of the warm interior light visible through left window
  const pulse = 0.85 + Math.sin(elapsed * 0.001) * 0.1 + Math.sin(elapsed * 0.0017) * 0.05;

  // Left window area (where interior is visible)
  const windowX = canvas.width * 0.02;
  const windowY = canvas.height * 0.32;
  const windowW = canvas.width * 0.18;
  const windowH = canvas.height * 0.45;

  const centerX = windowX + windowW / 2;
  const centerY = windowY + windowH / 2;
  const radius = Math.max(windowW, windowH) * 0.8;

  const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
  const alpha = 0.08 * pulse;

  gradient.addColorStop(0, `rgba(255, 180, 100, ${alpha})`);
  gradient.addColorStop(0.5, `rgba(255, 180, 100, ${alpha * 0.3})`);
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(windowX, windowY, windowW, windowH);
}
