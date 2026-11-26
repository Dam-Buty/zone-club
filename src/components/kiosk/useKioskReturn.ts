// Le parcours du retour d'une K7 à la borne, partagé par « Mon compte » et la proposition faite à l'arrivée
// (spec 2026-11-26-borne-retour-k7-design, §§ 4.3 et 4.4) : la question, le retour, puis le message de fin
// (crédit, exemplaires, critique).
import { useCallback, useState } from 'react';
import api from '../../api';
import { castOwnsFilm } from '../../cast/cast-machine';
import { useStore } from '../../store';
import type { Film } from '../../types';
import { parseServerDate } from '../../utils/server-date';
import { returnConfirmText, returnDoneText, returnReviewOffer } from './kiosk-account-logic';
import { copyLines } from './kiosk-copies';
import { reviewStateFor } from './kiosk-logic';
import type { KioskNoticeSpec } from './KioskNotice';

interface KioskReturnOptions {
  /** Le catalogue : titre et identifiant TMDB du film rendu. */
  films: Film[];
  onNotice: (notice: KioskNoticeSpec | null) => void;
  onReview: (filmId: number) => void;
  /** Appelé avant le retour (la tâche 7 y arrête un rembobinage en cours). */
  beforeReturn?: (filmId: number) => void;
}

/** Les exemplaires du film après le retour, une ligne chacun ; `undefined` si le détail est inconnu (jamais bloquant). */
async function copiesAfterReturn(tmdbId: number | undefined): Promise<string[] | undefined> {
  if (tmdbId === undefined) return undefined;
  try {
    const film = await api.films.getById(tmdbId);
    if (!film?.rental_status) return undefined;
    const lines = copyLines({
      stock: film.rental_status.stock,
      returns: (film.rental_status.active_returns ?? []).map((r) => ({ atMs: parseServerDate(r.expires_at), mine: r.mine })),
    });
    return lines?.map((c) => `n° ${c.n} · ${c.text}`);
  } catch {
    return undefined;
  }
}

export function useKioskReturn({ films, onNotice, onReview, beforeReturn }: KioskReturnOptions) {
  const returnFilm = useStore((state) => state.returnFilm);
  const fetchMe = useStore((state) => state.fetchMe);
  const castDismiss = useStore((state) => state.castDismiss);
  const [returningId, setReturningId] = useState<number | null>(null);

  const startReturn = useCallback(
    async (filmId: number) => {
      const onTv = castOwnsFilm(useStore.getState().cast) === filmId;
      onNotice(null);
      beforeReturn?.(filmId);
      setReturningId(filmId);
      let result: Awaited<ReturnType<typeof returnFilm>>;
      let lines: string[] | undefined;
      try {
        result = await returnFilm(filmId);
        // L'historique et les exemplaires, ensemble : la K7 rendue passe dans l'historique, et une copie se libère.
        const tmdbId = films.find((f) => f.id === filmId)?.tmdb_id;
        [, lines] = await Promise.all([fetchMe(), result ? copiesAfterReturn(tmdbId) : Promise.resolve(undefined)]);
      } finally {
        setReturningId(null);
      }
      const close = () => {
        onNotice(null);
        // La TV arrêtée laisse « Location terminée » : notre message vient de le dire, inutile de le répéter.
        const said = useStore.getState().cast.notice;
        if (result && said?.code === 'rental_over' && said.filmId === filmId) castDismiss();
      };
      const done = returnDoneText(result, onTv);
      // La critique : relue après fetchMe, le retour change ce que le serveur permet.
      const offer = result
        ? returnReviewOffer(reviewStateFor(filmId, new Set(useStore.getState().userReviews.map((r) => r.film_id)), useStore.getState().reviewEligibility))
        : null;
      const body = offer?.kind === 'later' ? [done.body, offer.reason].filter(Boolean).join(' ') : done.body;
      onNotice({
        title: done.title,
        body,
        lines,
        primary:
          offer?.kind === 'write'
            ? { label: 'Écrire ma critique', onPress: () => { onNotice(null); onReview(filmId); } }
            : { label: 'Fermer', onPress: close },
        secondary: offer?.kind === 'write' ? { label: 'Fermer', onPress: close } : undefined,
      });
    },
    [films, onNotice, onReview, beforeReturn, returnFilm, fetchMe, castDismiss],
  );

  const askReturn = useCallback(
    (filmId: number) => {
      if (returningId !== null) return;
      const state = useStore.getState();
      const onTv = castOwnsFilm(state.cast) === filmId;
      const rentedAt = state.rentals.find((r) => r.filmId === filmId)?.rentedAt ?? null;
      const title = films.find((f) => f.id === filmId)?.title ?? '';
      onNotice({
        ...returnConfirmText({ title, rentedAt, nowMs: Date.now(), onTv }),
        primary: { label: 'Rendre', onPress: () => void startReturn(filmId) },
        secondary: { label: 'Annuler', onPress: () => onNotice(null) },
      });
    },
    [returningId, films, onNotice, startReturn],
  );

  return { returningId, askReturn, startReturn };
}
