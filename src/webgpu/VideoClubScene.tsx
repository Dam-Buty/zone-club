console.log('[VideoClub] Module loading...');
import { useEffect, useRef, useState } from 'react';
console.log('[VideoClub] React imported');
import { AisleScenePBR } from './scenes/AisleScenePBR';
console.log('[VideoClub] AisleScenePBR imported');

interface VideoClubSceneProps {
  onCassetteClick?: (filmId: number) => void;
}

// Using PBR deferred rendering with full logging
export function VideoClubScene({ onCassetteClick: _onCassetteClick }: VideoClubSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const interiorSceneRef = useRef<AisleScenePBR | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [initProgress, setInitProgress] = useState<string>('');
  const deviceRef = useRef<GPUDevice | null>(null);
  const formatRef = useRef<GPUTextureFormat | null>(null);
  const contextRef = useRef<GPUCanvasContext | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let animationId: number;
    let isDestroyed = false;

    console.log('[VideoClub] ========== COMPONENT MOUNTED ==========');
    console.log('[VideoClub] Window size:', window.innerWidth, 'x', window.innerHeight);
    console.log('[VideoClub] Device pixel ratio:', window.devicePixelRatio);

    // Set canvas size BEFORE initializing WebGPU
    const setCanvasSize = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = Math.floor(window.innerWidth * dpr);
      const height = Math.floor(window.innerHeight * dpr);
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      console.log(`[VideoClub] Canvas size set to ${width}x${height} (dpr: ${dpr})`);
      return { width, height };
    };

    // Set initial size
    const initialSize = setCanvasSize();
    console.log('[VideoClub] Initial canvas size:', initialSize);

    const init = async () => {
      const initStart = performance.now();

      // Check WebGPU support
      setInitProgress('Checking WebGPU support...');
      console.log('[VideoClub] Checking WebGPU support...');
      if (!navigator.gpu) {
        setError('WebGPU non supporté. Utilise Chrome 113+ ou Edge 113+');
        return;
      }
      console.log('[VideoClub] WebGPU supported');

      try {
        // Request adapter
        setInitProgress('Requesting GPU adapter...');
        console.log('[VideoClub] Requesting GPU adapter...');
        const adapterStart = performance.now();
        const adapter = await navigator.gpu.requestAdapter({
          powerPreference: 'high-performance',
        });
        console.log(`[VideoClub] Adapter obtained in ${(performance.now() - adapterStart).toFixed(2)}ms`);

        if (!adapter) {
          setError('Impossible de trouver un GPU compatible WebGPU');
          return;
        }

        // Log adapter info (if available - not all browsers support this)
        try {
          if ('requestAdapterInfo' in adapter) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const adapterInfo = await (adapter as any).requestAdapterInfo();
            console.log('[VideoClub] Adapter info:', {
              vendor: adapterInfo.vendor,
              architecture: adapterInfo.architecture,
              device: adapterInfo.device,
              description: adapterInfo.description,
            });
          } else {
            console.log('[VideoClub] Adapter info not available in this browser');
          }
        } catch (e) {
          console.log('[VideoClub] Could not get adapter info:', e);
        }

        // Log adapter limits
        console.log('[VideoClub] Adapter limits:', {
          maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
          maxTextureArrayLayers: adapter.limits.maxTextureArrayLayers,
          maxBindGroups: adapter.limits.maxBindGroups,
          maxBufferSize: adapter.limits.maxBufferSize,
          maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        });

        // Request device
        setInitProgress('Requesting GPU device...');
        console.log('[VideoClub] Requesting GPU device...');
        const deviceStart = performance.now();
        const device = await adapter.requestDevice({
          requiredFeatures: [],
          requiredLimits: {
            maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
            maxTextureArrayLayers: adapter.limits.maxTextureArrayLayers,
          },
        });
        console.log(`[VideoClub] Device obtained in ${(performance.now() - deviceStart).toFixed(2)}ms`);

        // Add device lost handler
        device.lost.then((info) => {
          console.error('[VideoClub] GPU device lost!', info.message, info.reason);
          setError(`GPU device lost: ${info.message}`);
        });

        // Add uncaptured error handler
        device.onuncapturederror = (event) => {
          console.error('[VideoClub] Uncaptured WebGPU error:', event.error);
        };

        deviceRef.current = device;

        // Ensure canvas has correct size before context configuration
        setInitProgress('Configuring canvas...');
        const { width, height } = setCanvasSize();

        const context = canvas.getContext('webgpu') as GPUCanvasContext;
        if (!context) {
          setError('Failed to get WebGPU context');
          return;
        }
        contextRef.current = context;

        const format = navigator.gpu.getPreferredCanvasFormat();
        formatRef.current = format;
        console.log('[VideoClub] Preferred canvas format:', format);

        context.configure({
          device,
          format,
          alphaMode: 'premultiplied',
        });
        console.log('[VideoClub] Canvas context configured');

        // Create PBR scene
        setInitProgress('Creating PBR scene...');
        console.log('[VideoClub] Creating AisleScenePBR...');
        const sceneStart = performance.now();

        try {
          // DIAGNOSTIC: Disable ALL heavy features to isolate the freeze
          console.log('[VideoClub] Creating scene with MINIMAL features...');
          interiorSceneRef.current = new AisleScenePBR(device, context, format, {
            enableShadows: false,    // DISABLED
            enableSSAO: false,       // DISABLED
            enableBloom: false,      // DISABLED
            fxaaEnabled: false,      // DISABLED
            shadowMapSize: 512,      // Reduced
          });
          console.log(`[VideoClub] AisleScenePBR created in ${(performance.now() - sceneStart).toFixed(2)}ms`);

          // Resize to current canvas size
          console.log('[VideoClub] Resizing scene to', width, 'x', height);
          interiorSceneRef.current.resize(width, height);
        } catch (err) {
          console.error('[VideoClub] Failed to create AisleScenePBR:', err);
          throw err;
        }

        if (isDestroyed) {
          console.log('[VideoClub] Component was destroyed during init, cleaning up');
          interiorSceneRef.current?.destroy();
          return;
        }

        setIsReady(true);
        setInitProgress('');

        const totalInitTime = performance.now() - initStart;
        console.log(`[VideoClub] ========== INITIALIZATION COMPLETE ==========`);
        console.log(`[VideoClub] Total init time: ${totalInitTime.toFixed(2)}ms`);

        // Render loop with error handling
        let lastFrameTime = performance.now();
        let frameCount = 0;

        const render = () => {
          if (isDestroyed) return;

          const now = performance.now();
          const deltaTime = now - lastFrameTime;
          lastFrameTime = now;
          frameCount++;

          // Warn if frame time is too long
          if (deltaTime > 100 && frameCount > 1) {
            console.warn(`[VideoClub] Long frame gap: ${deltaTime.toFixed(2)}ms`);
          }

          try {
            if (interiorSceneRef.current) {
              interiorSceneRef.current.render(context);
            }
          } catch (err) {
            console.error('[VideoClub] Render error:', err);
            setError(`Render error: ${err}`);
            return;
          }

          animationId = requestAnimationFrame(render);
        };

        console.log('[VideoClub] Starting render loop...');
        render();

      } catch (err) {
        console.error('[VideoClub] Initialization error:', err);
        setError(`Erreur WebGPU: ${err}`);
      }
    };

    init();

    // Handle resize with proper pixel ratio
    const handleResize = () => {
      if (canvas && !isDestroyed) {
        const dpr = window.devicePixelRatio || 1;
        const width = Math.floor(window.innerWidth * dpr);
        const height = Math.floor(window.innerHeight * dpr);
        canvas.width = width;
        canvas.height = height;
        canvas.style.width = `${window.innerWidth}px`;
        canvas.style.height = `${window.innerHeight}px`;

        if (interiorSceneRef.current) {
          console.log(`[VideoClub] Resize to ${width}x${height}`);
          interiorSceneRef.current.resize(width, height);
        }
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      console.log('[VideoClub] Component unmounting...');
      isDestroyed = true;
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', handleResize);

      if (interiorSceneRef.current) {
        console.log('[VideoClub] Destroying scene...');
        interiorSceneRef.current.destroy();
        interiorSceneRef.current = null;
      }
      console.log('[VideoClub] Cleanup complete');
    };
  }, []);

  if (error) {
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        background: '#0a0a0f',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#ff2d95',
        fontFamily: 'Orbitron, sans-serif',
        textAlign: 'center',
        padding: '2rem',
      }}>
        <h1 style={{ fontSize: '2rem', textShadow: '0 0 20px #ff2d95' }}>
          ERREUR WEBGPU
        </h1>
        <p style={{ marginTop: '1rem', color: 'white' }}>{error}</p>
        <p style={{ marginTop: '1rem', color: '#888', fontSize: '0.8rem' }}>
          Vérifiez la console pour plus de détails
        </p>
      </div>
    );
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{
          position: 'fixed',
          inset: 0,
          width: '100%',
          height: '100%',
        }}
      />

      {/* Loading progress */}
      {!isReady && !error && initProgress && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: '#0a0a0f',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#00fff7',
          fontFamily: 'Orbitron, sans-serif',
          textAlign: 'center',
        }}>
          <h1 style={{ fontSize: '1.5rem', textShadow: '0 0 20px #00fff7' }}>
            LOADING...
          </h1>
          <p style={{ marginTop: '1rem', color: '#888' }}>{initProgress}</p>
        </div>
      )}

      {/* Scene indicator */}
      {isReady && (
        <div style={{
          position: 'fixed',
          top: '1rem',
          left: '1rem',
          padding: '0.5rem 1rem',
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          borderRadius: '4px',
          color: '#00fff7',
          fontFamily: 'Orbitron, sans-serif',
          fontSize: '0.75rem',
          textShadow: '0 0 8px #00fff7',
          zIndex: 10,
        }}>
          VIDEO CLUB PBR
        </div>
      )}

      {/* Controls help */}
      {isReady && (
        <div style={{
          position: 'fixed',
          bottom: '2rem',
          left: '50%',
          transform: 'translateX(-50%)',
          color: '#00fff7',
          fontFamily: 'Orbitron, sans-serif',
          fontSize: '0.875rem',
          textShadow: '0 0 10px #00fff7',
          textAlign: 'center',
          pointerEvents: 'none',
        }}>
          <p>CLICK pour capturer la souris | WASD pour se déplacer</p>
          <p style={{ marginTop: '0.5rem', opacity: 0.7 }}>ESC pour libérer la souris</p>
        </div>
      )}
    </>
  );
}
