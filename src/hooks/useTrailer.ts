import { useEffect, useState, type RefObject } from 'react';
import api, { type TrailerStatusResponse } from '../api';

// La bande-annonce d'un film, sans publicité (Rusmir, 17/11/2026 : « on veut la bande-annonce sans
// pub, point ») : le serveur la récupère une fois chez Allociné et la garde (lib/trailers.ts), et elle
// est jouée par un simple lecteur vidéo. Partagé par la fiche de la borne et la fiche K7 du vidéoclub.
//
// Préchargée dès l'ouverture de la fiche (Rusmir, 25/11/2026 : « lorsqu'on clique sur la fiche du film
// la bande-annonce se précharge de manière à être prête le plus tôt possible ») : l'état est demandé à
// l'ouverture — ce qui lance la récupération côté serveur si besoin —, et dès qu'elle est prête, le
// lecteur est monté, caché, avec preload="auto" : le téléphone la télécharge pendant qu'on lit la fiche.

/** null : pas encore de réponse ; 'error' : le serveur ne répond pas, ou la préparation dure trop. */
export type TrailerState = TrailerStatusResponse | 'error' | null;

/** Relevés de l'état pendant la préparation : toutes les deux secondes, deux minutes au plus. */
const TRAILER_POLL_MS = 2000;
const TRAILER_POLL_MAX = 60;

/** Où en est la bande-annonce du film `tmdbId` (null : aucun film) ; relevé tant qu'elle se prépare. */
export function useTrailerStatus(tmdbId: number | null): TrailerState {
  const [status, setStatus] = useState<{ id: number; value: TrailerStatusResponse | 'error' } | null>(null);
  useEffect(() => {
    if (tmdbId === null) return;
    let cancelled = false;
    let timer = 0;
    let tries = 0;
    const poll = () => {
      api.films.getTrailerStatus(tmdbId).then(
        (value) => {
          if (cancelled) return;
          if (value.state === 'preparing' && ++tries >= TRAILER_POLL_MAX) {
            setStatus({ id: tmdbId, value: 'error' });
            return;
          }
          setStatus({ id: tmdbId, value });
          if (value.state === 'preparing') timer = window.setTimeout(poll, TRAILER_POLL_MS);
        },
        () => {
          if (!cancelled) setStatus({ id: tmdbId, value: 'error' });
        },
      );
    };
    poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [tmdbId]);
  return tmdbId !== null && status?.id === tmdbId ? status.value : null;
}

/** Vrai quand le fichier de la bande-annonce peut être joué. */
export function trailerReady(state: TrailerState): state is { state: 'ready'; lang: 'vf' | 'vost' | 'vo' } {
  return state !== null && state !== 'error' && state.state === 'ready';
}

/** Adresse du fichier de la bande-annonce (servi par plages d'octets). */
export function trailerUrl(tmdbId: number): string {
  return `/api/films/${tmdbId}/trailer`;
}

/** Ce que la fiche affiche à la place du lecteur, ou null quand le lecteur est là. */
export function trailerNotice(state: TrailerState, broken: boolean): string | null {
  if (state === null || (state !== 'error' && state.state === 'preparing')) return 'Préparation de la bande-annonce…';
  if (state !== 'error' && state.state === 'none') return 'Pas de bande-annonce pour ce film.';
  if (!trailerReady(state) || broken) return 'La bande-annonce n’a pas pu être récupérée. Réessayez plus tard.';
  return null;
}

/** Le lecteur, monté caché pour se précharger, joue quand `playing` est vrai et se tait sinon. */
export function useTrailerPlayback(video: RefObject<HTMLVideoElement | null>, playing: boolean): void {
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    if (!playing) {
      el.pause();
      return;
    }
    // Lecture refusée (son sans geste récent) : le lecteur garde ses commandes, un appui la lance.
    el.play().catch(() => {});
  }, [video, playing]);
}
