import { useEffect, useRef, type RefObject } from 'react';
import { handedOverTime, leavingTime, resumeSeek } from '../../utils/video-swap';

// La vie de l'élément <video> du lecteur (docs/superpowers/specs/2026-11-19-versions-et-erreurs-de-lecture-design.md,
// § 4.3 b). L'élément est remonté à chaque autre piste audio et à chaque « Réessayer » (sa `key`) : tout ce qui
// l'écoute suit cette key, sinon la fin du film n'ouvrait plus « BE KIND REWIND » après un changement de version, et un
// changement fait avant la première image repartait de zéro. Les deux effets dépendent de `videoKey`. Où placer un
// élément se décide dans src/utils/video-swap.ts (resumeSeek, leavingTime, handedOverTime), testé : ce crochet ne fait
// qu'écouter.

/**
 * `videoKey` : la key de l'élément <video> (piste, adresse, essai). `filmId` : le film qu'il joue. `rentalPosition` : la
 * position enregistrée de la location, telle quelle ; la règle de fin (les 10 dernières secondes du fichier) se lit sur
 * la durée de l'élément, que seul l'élément connaît. `onEnded` : la fin du film, sur l'élément courant.
 */
export function useVideoLifecycle(i: {
  videoRef: RefObject<HTMLVideoElement | null>;
  videoKey: string;
  filmId: number | null;
  rentalPosition: number;
  onEnded(): void;
}): void {
  const { videoRef, videoKey, filmId, rentalPosition, onEnded } = i;

  // Fin du film : l'écouteur est posé sur chaque nouvel élément.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.addEventListener('ended', onEnded);
    return () => video.removeEventListener('ended', onEnded);
  }, [videoRef, videoKey, onEnded]);

  // La place de chaque nouvel élément, une seule fois, dès ses métadonnées — à l'ouverture comme après un remontage. Pas
  // au `canplay` : entre les métadonnées et la première lecture possible (longue sur une liaison lente, sans fin quand
  // la vidéo est retenue), la durée est connue et quitter le lecteur enregistrait la position 0. Une sauvegarde ne
  // réarme rien : après ⏮, l'élément n'est plus ramené à la position enregistrée. La position de la location est lue à
  // l'arrivée des métadonnées, pas à la pose ; une position rendue plus tard (fetchMe) ne déplace plus un élément placé.
  const rentalPositionRef = useRef(rentalPosition);
  useEffect(() => {
    rentalPositionRef.current = rentalPosition;
  });
  // La seconde que laisse l'élément qui s'en va, rangée avec son film : le suivant la reprend s'il joue le même film.
  const leftRef = useRef<{ filmId: number | null; time: number } | null>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // La seconde que cet élément doit encore reprendre : celle de l'élément qu'il remplace pour ce film, sinon 0.
    let pending: number | null = handedOverTime(leftRef.current, filmId);
    const place = () => {
      if (pending === null) return;
      const at = resumeSeek({ currentTime: video.currentTime, elementTime: pending, rentalPosition: rentalPositionRef.current, duration: video.duration });
      pending = null;
      if (at !== null) video.currentTime = at;
    };
    // Des métadonnées déjà là (fichier en cache) n'attendent pas un événement passé.
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) place();
    else video.addEventListener('loadedmetadata', place, { once: true });
    return () => {
      video.removeEventListener('loadedmetadata', place);
      leftRef.current = { filmId, time: leavingTime({ pending, currentTime: video.currentTime }) };
    };
  }, [videoRef, videoKey, filmId]);
}
