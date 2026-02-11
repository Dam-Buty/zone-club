import { useEffect, useRef, useState, useCallback } from 'react';

interface UseIdleDetectionOptions {
  idleTimeout: number;  // Time in ms before considered idle
  onIdle?: () => void;
  onActive?: () => void;
}

export function useIdleDetection({ idleTimeout, onIdle, onActive }: UseIdleDetectionOptions) {
  const [isIdle, setIsIdle] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const isIdleRef = useRef(false);

  const resetTimer = useCallback(() => {
    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // If was idle, trigger onActive
    if (isIdleRef.current) {
      isIdleRef.current = false;
      setIsIdle(false);
      onActive?.();
    }

    // Set new timeout
    timeoutRef.current = window.setTimeout(() => {
      isIdleRef.current = true;
      setIsIdle(true);
      onIdle?.();
    }, idleTimeout);
  }, [idleTimeout, onIdle, onActive]);

  useEffect(() => {
    // Events that reset the idle timer
    const events = [
      'mousedown',
      'mousemove',
      'keydown',
      'scroll',
      'touchstart',
      'click',
    ];

    // Start initial timer
    resetTimer();

    // Add event listeners
    events.forEach((event) => {
      document.addEventListener(event, resetTimer, { passive: true });
    });

    return () => {
      // Cleanup
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      events.forEach((event) => {
        document.removeEventListener(event, resetTimer);
      });
    };
  }, [resetTimer]);

  return { isIdle, resetTimer };
}
