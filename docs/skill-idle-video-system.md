# Skill: Idle Video System (React + Suspense)

## Summary

Système de vidéo d'inactivité qui se déclenche automatiquement après un délai sans interaction utilisateur, avec lazy loading via React Suspense.

---

## Architecture

### Composants

```
src/
├── hooks/
│   └── useIdleDetection.ts    # Hook détection inactivité
└── components/exterior/
    ├── IdleVideo.tsx          # Composant vidéo lazy-loaded
    └── IdleVideo.module.css   # Styles avec fade in/out
```

---

## Hook: useIdleDetection

Détecte l'inactivité utilisateur basée sur les événements DOM.

```typescript
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
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    if (isIdleRef.current) {
      isIdleRef.current = false;
      setIsIdle(false);
      onActive?.();
    }

    timeoutRef.current = window.setTimeout(() => {
      isIdleRef.current = true;
      setIsIdle(true);
      onIdle?.();
    }, idleTimeout);
  }, [idleTimeout, onIdle, onActive]);

  useEffect(() => {
    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'];

    resetTimer();
    events.forEach((event) => {
      document.addEventListener(event, resetTimer, { passive: true });
    });

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      events.forEach((event) => {
        document.removeEventListener(event, resetTimer);
      });
    };
  }, [resetTimer]);

  return { isIdle, resetTimer };
}
```

---

## Composant: IdleVideo

Vidéo avec preload automatique et contrôle de lecture.

```typescript
interface IdleVideoProps {
  src: string;
  isPlaying: boolean;
  onVideoEnd?: () => void;
  onVideoReady?: () => void;
  onUserInteraction?: () => void;
}
```

### Fonctionnalités
- **Preload**: `video.load()` au montage
- **Event `canplaythrough`**: Notifie quand vidéo prête
- **Play/Pause**: Contrôlé via prop `isPlaying`
- **Interruption**: Click/mouvement arrête la vidéo
- **Fade in/out**: Transition CSS 0.8s

---

## Intégration avec Lazy Loading

```typescript
import { Suspense, lazy } from 'react';

// Lazy load
const IdleVideo = lazy(() =>
  import('./IdleVideo').then((module) => ({ default: module.IdleVideo }))
);

// Usage
<Suspense fallback={null}>
  <IdleVideo
    src="/videoclubvideo.mp4"
    isPlaying={isVideoPlaying}
    onVideoReady={handleVideoReady}
    onVideoEnd={handleVideoEnd}
    onUserInteraction={handleVideoInteraction}
  />
</Suspense>
```

---

## CSS: Fade Transition

```css
.videoContainer {
  position: fixed;
  inset: 0;
  z-index: 100;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.8s ease-in-out;
  background: black;
}

.videoContainer.visible {
  opacity: 1;
  pointer-events: auto;
  cursor: pointer;
}

.video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
```

---

## Flow Complet

```
1. Page chargée
   └─> IdleVideo lazy-loaded en arrière-plan
   └─> video.load() commence le preload

2. Video prête (canplaythrough)
   └─> onVideoReady() → isVideoReady = true

3. Utilisateur inactif 10 secondes
   └─> onIdle() vérifie isVideoReady
   └─> Si prêt: isVideoPlaying = true
   └─> Video fade in + lecture

4. Utilisateur interagit (ou video termine)
   └─> onUserInteraction() / onVideoEnd()
   └─> isVideoPlaying = false
   └─> Video fade out + pause

5. Retour à l'étape 3 (timer reset)
```

---

## Paramètres Configurables

| Paramètre | Valeur | Description |
|-----------|--------|-------------|
| `IDLE_TIMEOUT` | 10000ms | Délai avant vidéo |
| `transition` | 0.8s | Durée fade in/out |
| `preload` | "auto" | Stratégie preload |

---

## Checklist

- [ ] Vidéo dans `public/` (ex: `videoclubvideo.mp4`)
- [ ] Hook useIdleDetection importé
- [ ] IdleVideo lazy-loaded avec Suspense
- [ ] Callbacks: onVideoReady, onVideoEnd, onUserInteraction
- [ ] État: isVideoReady, isVideoPlaying
- [ ] CSS avec z-index élevé pour overlay
