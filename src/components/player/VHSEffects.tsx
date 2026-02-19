import { useEffect, useRef } from 'react';
import type { PlayerState } from '../../types';
import styles from './VHSEffects.module.css';

interface VHSEffectsProps {
  playerState: PlayerState;
  intensity?: number;
}

export function VHSEffects({ playerState, intensity = 1 }: VHSEffectsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Scanlines (always present)
      ctx.fillStyle = `rgba(0, 0, 0, ${0.03 * intensity})`;
      for (let y = 0; y < canvas.height; y += 2) {
        ctx.fillRect(0, y, canvas.width, 1);
      }

      // Film grain
      const grainIntensity = playerState === 'paused' ? 0.08 : 0.03;
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * 255 * grainIntensity * intensity;
        data[i] += noise;
        data[i + 1] += noise;
        data[i + 2] += noise;
      }
      ctx.putImageData(imageData, 0, 0);

      // Tracking lines (on pause)
      if (playerState === 'paused') {
        const time = Date.now() / 100;
        for (let i = 0; i < 3; i++) {
          const y = ((time * 50 + i * 100) % canvas.height);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
          ctx.fillRect(0, y, canvas.width, 2 + Math.random() * 3);
        }
      }

      // Enhanced distortion for FF/RW — thick horizontal bars + color fringing
      if (playerState === 'rewinding' || playerState === 'fastforwarding') {
        const time = Date.now() / 50;

        // Thick horizontal tracking bars (VHS tracking artifact)
        for (let i = 0; i < 20; i++) {
          const y = ((time * 80 + i * 50) % canvas.height);
          ctx.fillStyle = `rgba(255, 255, 255, ${0.05 + Math.random() * 0.1})`;
          ctx.fillRect(0, y, canvas.width, 2 + Math.random() * 8);
        }

        // Color fringing (horizontal cyan/magenta shift)
        ctx.fillStyle = 'rgba(0, 255, 255, 0.03)';
        ctx.fillRect(Math.random() * 20, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(255, 0, 255, 0.02)';
        ctx.fillRect(-(Math.random() * 15), 0, canvas.width, canvas.height);

        // Horizontal displacement bars (sections of image shifted)
        for (let i = 0; i < 5; i++) {
          const y = Math.random() * canvas.height;
          const h = 1 + Math.random() * 4;
          const shift = (Math.random() - 0.5) * 20;
          ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
          ctx.fillRect(shift, y, canvas.width, h);
        }
      }

      animationId = requestAnimationFrame(render);
    };

    render();

    return () => cancelAnimationFrame(animationId);
  }, [playerState, intensity]);

  return (
    <canvas
      ref={canvasRef}
      className={styles.overlay}
      width={1920}
      height={1080}
    />
  );
}
