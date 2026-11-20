import { useEffect, useRef, type RefObject } from 'react';

// La vie de l'élément <video> du lecteur (docs/superpowers/specs/2026-11-19-versions-et-erreurs-de-lecture-design.md,
// § 4.3 b). L'élément est remonté à chaque autre piste audio et à chaque « Réessayer » (sa `key`) : tout ce qui
// l'écoute suit cette key, sinon la fin du film n'ouvrait plus « BE KIND REWIND » après un changement de version, et un
// changement fait avant la première image repartait de zéro. Les trois effets dépendent de `videoKey`.

/**
 * `videoKey` : la key de l'élément <video> (piste, adresse, essai). `resumeAt` : où reprend un élément qui n'a encore
 * rien joué — la position de la location, le début pour une location vue à 100 % (swapResumeTime, sans élément
 * précédent). `onEnded` : la fin du film, sur l'élément courant.
 */
export function useVideoLifecycle(i: {
  videoRef: RefObject<HTMLVideoElement | null>;
  videoKey: string;
  resumeAt: number;
  onEnded(): void;
}): void {
  const { videoRef, videoKey, resumeAt, onEnded } = i;

  // Fin du film : l'écouteur est posé sur chaque nouvel élément.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.addEventListener('ended', onEnded);
    return () => video.removeEventListener('ended', onEnded);
  }, [videoRef, videoKey, onEnded]);

  // Reprise à l'ouverture — et sur chaque nouvel élément qui n'a pas déjà sa position : à la première lecture possible,
  // un élément encore au début part de la reprise de la location. Une position relue après l'ouverture (fetchMe) réarme
  // l'écouteur.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !(resumeAt > 0)) return;
    const resume = () => {
      if (video.currentTime < 1) video.currentTime = resumeAt;
    };
    video.addEventListener('canplay', resume, { once: true });
    return () => video.removeEventListener('canplay', resume);
  }, [videoRef, videoKey, resumeAt]);

  // Position rétablie après un remontage. Un élément qui s'en va laisse sa seconde ; le suivant la reprend dès ses
  // métadonnées, s'il est encore sous 1 s — ou la reprise de la location si elle est plus loin (changement fait avant
  // la première image) : la plus grande des deux, comme swapResumeTime, dont `resumeAt` est déjà le résultat sans
  // élément précédent. Un élément remplacé avant d'avoir repris transmet la seconde qu'il devait reprendre (deux
  // changements rapides ne perdent pas la position). `resumeAt` est lu à l'arrivée des métadonnées, pas à la pose.
  const resumeAtRef = useRef(resumeAt);
  useEffect(() => {
    resumeAtRef.current = resumeAt;
  });
  const leftRef = useRef<{ element: HTMLVideoElement; time: number } | null>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const left = leftRef.current;
    let carried = left !== null && left.element !== video ? left.time : null;
    const restore = () => {
      if (carried === null) return;
      const at = Math.max(carried, resumeAtRef.current);
      carried = null;
      if (video.currentTime < 1 && at > 0) video.currentTime = at;
    };
    if (carried !== null) {
      // Des métadonnées déjà là (fichier en cache) n'attendent pas un événement passé.
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) restore();
      else video.addEventListener('loadedmetadata', restore, { once: true });
    }
    return () => {
      video.removeEventListener('loadedmetadata', restore);
      leftRef.current = { element: video, time: carried ?? video.currentTime };
    };
  }, [videoRef, videoKey]);
}
