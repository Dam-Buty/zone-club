import { useEffect, useRef, useState, useCallback } from 'react';
import styles from './IdleVideo.module.css';

interface IdleVideoProps {
  src: string;
  isPlaying: boolean;
  onVideoEnd?: () => void;
  onVideoReady?: () => void;
  onUserInteraction?: () => void;
}

export function IdleVideo({
  src,
  isPlaying,
  onVideoEnd,
  onVideoReady,
  onUserInteraction,
}: IdleVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  // Preload video
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleCanPlayThrough = () => {
      setIsLoaded(true);
      onVideoReady?.();
    };

    const handleEnded = () => {
      setIsVisible(false);
      onVideoEnd?.();
    };

    video.addEventListener('canplaythrough', handleCanPlayThrough);
    video.addEventListener('ended', handleEnded);

    // Start preloading
    video.load();

    return () => {
      video.removeEventListener('canplaythrough', handleCanPlayThrough);
      video.removeEventListener('ended', handleEnded);
    };
  }, [src, onVideoReady, onVideoEnd]);

  // Play/pause based on isPlaying prop
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isLoaded) return;

    if (isPlaying) {
      // Fade in and play
      setIsVisible(true);
      video.currentTime = 0;
      video.play().catch(console.error);
    } else {
      // Stop and hide
      video.pause();
      video.currentTime = 0;
      setIsVisible(false);
    }
  }, [isPlaying, isLoaded]);

  // Handle user interaction to stop video
  const handleInteraction = useCallback(() => {
    if (isVisible) {
      onUserInteraction?.();
    }
  }, [isVisible, onUserInteraction]);

  return (
    <div
      className={`${styles.videoContainer} ${isVisible ? styles.visible : ''}`}
      onClick={handleInteraction}
      onMouseMove={handleInteraction}
      onKeyDown={handleInteraction}
    >
      <video
        ref={videoRef}
        className={styles.video}
        src={src}
        muted
        playsInline
        preload="auto"
      />
    </div>
  );
}
