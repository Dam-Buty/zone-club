import { useEffect, useState } from 'react';

interface WebGPUContext {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  canvas: HTMLCanvasElement;
}

export function useWebGPU(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const [gpuContext, setGpuContext] = useState<WebGPUContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function initWebGPU() {
      const canvas = canvasRef.current;
      if (!canvas) {
        setError('Canvas not found');
        setIsLoading(false);
        return;
      }

      if (!navigator.gpu) {
        setError('WebGPU not supported in this browser');
        setIsLoading(false);
        return;
      }

      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
          setError('No GPU adapter found');
          setIsLoading(false);
          return;
        }

        const device = await adapter.requestDevice();
        const context = canvas.getContext('webgpu');
        if (!context) {
          setError('Could not get WebGPU context');
          setIsLoading(false);
          return;
        }

        const format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({
          device,
          format,
          alphaMode: 'premultiplied',
        });

        setGpuContext({ device, context, format, canvas });
        setIsLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'WebGPU initialization failed');
        setIsLoading(false);
      }
    }

    initWebGPU();
  }, [canvasRef]);

  return { gpuContext, error, isLoading };
}
