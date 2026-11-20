import { useEffect, useRef, type RefObject } from 'react';
import { leavingTime, resumeSeek } from '../../utils/video-swap';

// La vie de l'élément <video> du lecteur (docs/superpowers/specs/2026-11-19-versions-et-erreurs-de-lecture-design.md,
// § 4.3 b). L'élément est remonté à chaque autre piste audio et à chaque « Réessayer » (sa `key`) : tout ce qui
// l'écoute suit cette key, sinon la fin du film n'ouvrait plus « BE KIND REWIND » après un changement de version, et un
// changement fait avant la première image repartait de zéro. Les trois effets dépendent de `videoKey`. Où placer un
// élément se décide dans src/utils/video-swap.ts (resumeSeek, leavingTime), testé : ce crochet ne fait qu'écouter.

/**
 * `videoKey` : la key de l'élément <video> (piste, adresse, essai). `rentalPosition` : la position enregistrée de la
 * location, telle quelle ; la règle de fin (les 10 dernières secondes du fichier) se lit sur la durée de l'élément, que
 * seul l'élément connaît. `onEnded` : la fin du film, sur l'élément courant.
 */
export function useVideoLifecycle(i: {
  videoRef: RefObject<HTMLVideoElement | null>;
  videoKey: string;
  rentalPosition: number;
  onEnded(): void;
}): void {
  const { videoRef, videoKey, rentalPosition, onEnded } = i;

  // Fin du film : l'écouteur est posé sur chaque nouvel élément.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.addEventListener('ended', onEnded);
    return () => video.removeEventListener('ended', onEnded);
  }, [videoRef, videoKey, onEnded]);

  // Reprise à l'ouverture — et sur chaque nouvel élément qui n'a pas déjà sa position : à la première lecture possible,
  // un élément encore au début part de la position de la location (aucun élément précédent). Une position relue après
  // l'ouverture (fetchMe) réarme l'écouteur.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const resume = () => {
      const at = resumeSeek({ currentTime: video.currentTime, elementTime: 0, rentalPosition, duration: video.duration });
      if (at !== null) video.currentTime = at;
    };
    video.addEventListener('canplay', resume, { once: true });
    return () => video.removeEventListener('canplay', resume);
  }, [videoRef, videoKey, rentalPosition]);

  // Position rétablie après un remontage. Un élément qui s'en va laisse sa seconde (leavingTime) ; le suivant la reprend
  // dès ses métadonnées (resumeSeek). La position de la location est lue à l'arrivée des métadonnées, pas à la pose.
  const rentalPositionRef = useRef(rentalPosition);
  useEffect(() => {
    rentalPositionRef.current = rentalPosition;
  });
  const leftRef = useRef<{ element: HTMLVideoElement; time: number } | null>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const left = leftRef.current;
    // La seconde que cet élément doit encore reprendre : celle de l'élément qu'il remplace (null à l'ouverture).
    let pending = left !== null && left.element !== video ? left.time : null;
    const restore = () => {
      if (pending === null) return;
      const at = resumeSeek({ currentTime: video.currentTime, elementTime: pending, rentalPosition: rentalPositionRef.current, duration: video.duration });
      pending = null;
      if (at !== null) video.currentTime = at;
    };
    if (pending !== null) {
      // Des métadonnées déjà là (fichier en cache) n'attendent pas un événement passé.
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) restore();
      else video.addEventListener('loadedmetadata', restore, { once: true });
    }
    return () => {
      video.removeEventListener('loadedmetadata', restore);
      leftRef.current = { element: video, time: leavingTime({ pending, currentTime: video.currentTime }) };
    };
  }, [videoRef, videoKey]);
}
