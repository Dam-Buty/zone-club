// Crochets de la borne sortis de sa coque (KioskView) : le bonus qui attend, la fin d'une location, et les deux gardes
// de la vidéo de distribution. Batterie de tests du 25/11/2026.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCredits, useStore } from '../../store';
import { bonusLine, nextRentalEnd } from './kiosk-account-logic';
import { filmTapSkips } from './kiosk-distribution-logic';
import { allFilms } from './kiosk-logic';

/** Durée pendant laquelle l'écran reste au-dessus du calque de la vidéo après sa fin : son fondu (280 ms) et une marge. */
export const FILM_FADE_HOLD_MS = 340;

/**
 * Le montant du bonus de la semaine qui attend, ou null. Son état dépend du solde : il est relu à chaque fois que le
 * solde bouge (location, retour, critique).
 */
export function useWaitingBonus(): number | null {
  const isAuthenticated = useStore((state) => state.isAuthenticated);
  const credits = useCredits();
  const refreshWeeklyBonus = useStore((state) => state.refreshWeeklyBonus);
  const line = bonusLine(useStore((state) => state.weeklyBonusStatus));
  useEffect(() => {
    if (isAuthenticated) void refreshWeeklyBonus();
  }, [isAuthenticated, credits, refreshWeeklyBonus]);
  return isAuthenticated && line.state === 'available' ? line.amount : null;
}

/**
 * À la fin de la vidéo, son calque s'efface en fondu (280 ms) : l'écran de la borne reste AU-DESSUS de lui pendant ce
 * temps. Rendu dessous tout de suite, il laissait voir un instant l'écran filmé de la dernière image — la fiche d'un
 * autre film.
 */
export function useLiftHold(filmPlaying: boolean): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (filmPlaying) {
      setHeld(true);
      return;
    }
    const id = window.setTimeout(() => setHeld(false), FILM_FADE_HOLD_MS);
    return () => window.clearTimeout(id);
  }, [filmPlaying]);
  return filmPlaying || held;
}

/** Un appui passe la vidéo — sauf le second appui d'un double appui sur « Louer », qui tombait sur elle. */
export function useFilmTap(filmPlaying: boolean, skip: () => void): () => void {
  const startedAtRef = useRef<number | null>(null);
  useEffect(() => {
    startedAtRef.current = filmPlaying ? performance.now() : null;
  }, [filmPlaying]);
  return useCallback(() => {
    if (filmTapSkips(startedAtRef.current, performance.now())) skip();
  }, [skip]);
}

/**
 * La fin d'une location pendant que la borne est ouverte. À l'échéance le compte est relu (le serveur ne rend plus
 * cette location), puis `onEnded` est appelé avec le film et son titre. Sans cela « REGARDER » restait affiché sur un
 * film qui ne se lançait plus, sans un mot.
 */
export function useRentalEnd(onEnded: (filmId: number, title: string | undefined) => void): void {
  const rentals = useStore((state) => state.rentals);
  const fetchMe = useStore((state) => state.fetchMe);
  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onEndedRef.current = onEnded;
  });
  // Chaque échéance n'est traitée qu'une fois : si le serveur rendait encore la location, on ne relirait pas en boucle.
  const handledRef = useRef(new Set<string>());
  useEffect(() => {
    const next = nextRentalEnd(rentals, Date.now());
    if (!next || handledRef.current.has(`${next.filmId}:${next.at}`)) return;
    const id = window.setTimeout(() => {
      handledRef.current.add(`${next.filmId}:${next.at}`);
      void fetchMe().then(() => {
        // Prolongée entre-temps, ou relecture en panne (la location est toujours là) : rien à dire.
        if (useStore.getState().getRental(next.filmId)) return;
        onEndedRef.current(next.filmId, allFilms(useStore.getState().films).find((f) => f.id === next.filmId)?.title);
      });
    }, Math.min(Math.max(0, next.at - Date.now()) + 1500, 2_000_000_000));
    return () => window.clearTimeout(id);
  }, [rentals, fetchMe]);
}
