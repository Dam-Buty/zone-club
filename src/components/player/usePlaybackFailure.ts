import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
  PLAYBACK_START_TIMEOUT_MS, shownFailure, signalsFor, startTimerArmed,
  type DeviceFailureKind, type VideoSignals,
} from '../../utils/playback-failure';

/**
 * La vidéo locale ne se lance pas : erreur nette du navigateur, ou rien ne vient pendant PLAYBACK_START_TIMEOUT_MS
 * alors que la lecture est voulue (`wanted` : les conditions de localAutoPlay). Rien ne s'affiche tant que la vidéo est
 * tenue à l'arrêt exprès (invite « Regarder sur TV ? », Cast, « BE KIND REWIND ») : une erreur vue pendant ce temps
 * attend que la lecture soit voulue. `onFailure` est appelé une fois par échec affiché.
 *
 * `videoKey` identifie la source (piste et adresse) ; `attempt` entre dans la `key` de l'élément <video> : « Réessayer »
 * (`retry`) le remonte. Chaque élément a ses propres signaux (signalsFor) : rien du précédent ne compte pour lui.
 */
export function usePlaybackFailure(i: {
  videoRef: RefObject<HTMLVideoElement | null>;
  videoKey: string;
  wanted: boolean;
  onFailure(kind: DeviceFailureKind): void;
}): { failure: DeviceFailureKind | null; retry(): void; attempt: number } {
  const { videoRef, videoKey, wanted, onFailure } = i;
  const [attempt, setAttempt] = useState(0);
  const element = `${videoKey}#${attempt}`;
  const [seen, setSeen] = useState<VideoSignals | null>(null);
  const signals = signalsFor(seen, element);
  const mark = useCallback((on: string, patch: Partial<Omit<VideoSignals, 'element'>>) => {
    setSeen((prev) => ({ ...signalsFor(prev, on), ...patch }));
  }, []);

  // Écouteurs posés au montage de l'élément, avant que le navigateur ait pu signaler quoi que ce soit (effet de mise en
  // page, synchrone). Capture : l'erreur d'un <source> ne remonte pas, mais se capture sur <video> ; celle d'un <track>
  // (sous-titres) n'empêche pas le film de jouer et ne compte pas.
  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onError = (e: Event) => {
      if (e.target === video || e.target instanceof HTMLSourceElement) mark(element, { error: true });
    };
    const onMetadata = () => mark(element, { metadata: true });
    video.addEventListener('error', onError, true);
    video.addEventListener('loadedmetadata', onMetadata);
    return () => {
      video.removeEventListener('error', onError, true);
      video.removeEventListener('loadedmetadata', onMetadata);
    };
  }, [videoRef, element, mark]);

  const failure = shownFailure(wanted, signals);
  const armed = startTimerArmed({ wanted, hasMetadata: signals.metadata, failed: failure !== null });

  // Le délai repart de zéro à chaque nouvel élément, et chaque fois que la lecture redevient voulue.
  useEffect(() => {
    if (!armed || !videoRef.current) return;
    const timer = setTimeout(() => mark(element, { timeout: true }), PLAYBACK_START_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [armed, videoRef, element, mark]);

  // Une trace par échec affiché : un panneau masqué puis réaffiché (Cast ouvert puis abandonné) ne la renvoie pas.
  const reportedRef = useRef<string | null>(null);
  useEffect(() => {
    if (failure === null || reportedRef.current === element) return;
    reportedRef.current = element;
    onFailure(failure);
  }, [failure, element, onFailure]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { failure, retry, attempt };
}
