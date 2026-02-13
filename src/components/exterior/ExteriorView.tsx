import { useEffect, useRef, useState, useCallback, Suspense, lazy } from 'react';
import { ExteriorScene } from '../../webgpu/ExteriorScene';
import { useIdleDetection } from '../../hooks/useIdleDetection';
import styles from './ExteriorView.module.css';

// Lazy load the video component
const IdleVideo = lazy(() =>
  import('./IdleVideo').then((module) => ({ default: module.IdleVideo }))
);

const IDLE_TIMEOUT = 10000; // 10 seconds
const TARGET_ASPECT_RATIO = 5632 / 3072; // ~1.833

interface ExteriorViewProps {
  onEnter: () => void;
}

export function ExteriorView({ onEnter }: ExteriorViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ExteriorScene | null>(null);
  const [isHoveringDoor, setIsHoveringDoor] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Content area dimensions (for hotspot positioning)
  const [contentArea, setContentArea] = useState({ width: '100%', height: '100%', top: '0', left: '0' });

  // Video state
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);

  // Handle idle state
  const handleIdle = useCallback(() => {
    if (isVideoReady && !isTransitioning) {
      setIsVideoPlaying(true);
    }
  }, [isVideoReady, isTransitioning]);

  const handleActive = useCallback(() => {
    setIsVideoPlaying(false);
  }, []);

  // Idle detection hook
  const { isIdle } = useIdleDetection({
    idleTimeout: IDLE_TIMEOUT,
    onIdle: handleIdle,
    onActive: handleActive,
  });

  // Video callbacks
  const handleVideoReady = useCallback(() => {
    setIsVideoReady(true);
  }, []);

  const handleVideoEnd = useCallback(() => {
    setIsVideoPlaying(false);
  }, []);

  const handleVideoInteraction = useCallback(() => {
    setIsVideoPlaying(false);
  }, []);

  // Calculate content area based on aspect ratio and window size
  const updateContentArea = useCallback(() => {
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    const windowAspect = windowWidth / windowHeight;

    let width: number, height: number, top: number, left: number;

    if (windowAspect > TARGET_ASPECT_RATIO) {
      // Pillarbox (black bars on sides)
      height = windowHeight;
      width = windowHeight * TARGET_ASPECT_RATIO;
      top = 0;
      left = (windowWidth - width) / 2;
    } else {
      // Letterbox (black bars top/bottom)
      width = windowWidth;
      height = windowWidth / TARGET_ASPECT_RATIO;
      top = (windowHeight - height) / 2;
      left = 0;
    }

    setContentArea({
      width: `${width}px`,
      height: `${height}px`,
      top: `${top}px`,
      left: `${left}px`,
    });
  }, []);

  // Initialize WebGL scene and content area
  useEffect(() => {
    if (!containerRef.current) return;

    // Create the exterior scene
    sceneRef.current = new ExteriorScene(containerRef.current);

    // Calculate initial content area
    updateContentArea();

    // Update on resize
    window.addEventListener('resize', updateContentArea);

    return () => {
      sceneRef.current?.dispose();
      sceneRef.current = null;
      window.removeEventListener('resize', updateContentArea);
    };
  }, [updateContentArea]);

  const handleEnterClick = () => {
    setIsTransitioning(true);
    // Fade out then trigger scene change
    setTimeout(() => {
      onEnter();
    }, 600);
  };

  return (
    <div className={`${styles.container} ${isTransitioning ? styles.fadeOut : ''}`}>
      {/* WebGL Canvas Container */}
      <div ref={containerRef} className={styles.canvasContainer} />

      {/* Content area wrapper for hotspot positioning */}
      <div
        className={styles.contentArea}
        style={{
          width: contentArea.width,
          height: contentArea.height,
          top: contentArea.top,
          left: contentArea.left,
        }}
      >
        {/* Floating indicator above door */}
        <div className={styles.doorIndicator}>
          <span className={styles.doorIndicatorText}>PUSH</span>
          <span className={styles.doorIndicatorArrow}>&#9660;</span>
        </div>

        {/* Door hotspot */}
        <button
          className={`${styles.doorHotspot} ${isHoveringDoor ? styles.doorHover : ''}`}
          onMouseEnter={() => setIsHoveringDoor(true)}
          onMouseLeave={() => setIsHoveringDoor(false)}
          onClick={handleEnterClick}
          aria-label="Entrer dans le vidéoclub"
        >
          <span className={styles.enterText}>Click pour entrer</span>
        </button>
      </div>

      {/* Idle Video - Lazy loaded with Suspense */}
      <Suspense fallback={null}>
        <IdleVideo
          src="/videoclubvideo.mp4"
          isPlaying={isVideoPlaying}
          onVideoReady={handleVideoReady}
          onVideoEnd={handleVideoEnd}
          onUserInteraction={handleVideoInteraction}
        />
      </Suspense>

      {/* Transition overlay */}
      {isTransitioning && <div className={styles.transitionOverlay} />}
    </div>
  );
}
