// Le parcours du retour d'une K7 à la borne, partagé par « Mon compte » et la proposition faite à l'arrivée
// (spec 2026-11-26-borne-retour-k7-design, §§ 4.3 et 4.4) : la question, le retour, puis le message de fin
// (crédit, exemplaires, critique).
import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../api';
import { castOwnsFilm } from '../../cast/cast-machine';
import { useStore } from '../../store';
import type { Film } from '../../types';
import { parseServerDate } from '../../utils/server-date';
import { readAsked, rememberAsked, returnConfirmText, returnDoneText, returnPromptCandidate, returnPromptKey, returnPromptText, returnReviewOffer } from './kiosk-account-logic';
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
  /** Le film en cours de rembobinage : le retour l'arrête, la question le dit. */
  rewindingId?: number | null;
}

/** Le titre à afficher : le catalogue, puis l'historique, puis le texte que `rentalRows` emploie déjà. */
function titleOf(films: Film[], filmId: number): string {
  return films.find((f) => f.id === filmId)?.title ?? useStore.getState().rentalHistory.find((h) => h.filmId === filmId)?.title ?? 'Titre indisponible';
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

export function useKioskReturn({ films, onNotice, onReview, beforeReturn, rewindingId }: KioskReturnOptions) {
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
            ? { label: 'Écrire ma critique', onPress: () => { close(); onReview(filmId); } }
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
      const title = titleOf(films, filmId);
      onNotice({
        ...returnConfirmText({ title, rentedAt, nowMs: Date.now(), onTv, rewinding: rewindingId === filmId }),
        primary: { label: 'Rendre', onPress: () => void startReturn(filmId) },
        secondary: { label: 'Annuler', onPress: () => onNotice(null) },
      });
    },
    [returningId, films, onNotice, startReturn, rewindingId],
  );

  return { returningId, askReturn, startReturn };
}

interface ReturnPromptOptions {
  /** La borne est au repos : accueil passé, connecté, rien d'ouvert (calculé par `KioskView`). */
  active: boolean;
  startReturn: (filmId: number) => void | Promise<void>;
  onNotice: (notice: KioskNoticeSpec | null) => void;
  films: Film[];
}

/**
 * La proposition faite à l'arrivée : à la première fois que la borne est au repos, on relit le compte puis on pose la
 * question une seule fois pour cette ouverture, sur la location vue à 80 % et jamais proposée.
 */
export function useReturnPrompt({ active, startReturn, onNotice, films }: ReturnPromptOptions): void {
  const fetchMe = useStore((state) => state.fetchMe);
  const evaluated = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const latest = useRef({ startReturn, onNotice, films });
  latest.current = { startReturn, onNotice, films };

  useEffect(() => {
    if (!active || evaluated.current) return;
    evaluated.current = true;
    void (async () => {
      await fetchMe();
      // Le visiteur a ouvert autre chose pendant la relecture : on réévaluera à son prochain repos.
      if (!activeRef.current) {
        evaluated.current = false;
        return;
      }
      const state = useStore.getState();
      const userId = state.authUser?.id;
      if (userId === undefined) return;
      let storage: Storage | null = null;
      try {
        storage = typeof window === 'undefined' ? null : window.localStorage;
      } catch {
        storage = null;
      }
      const candidate = returnPromptCandidate(state.rentals, readAsked(storage), userId, castOwnsFilm(state.cast));
      if (!candidate) return;
      rememberAsked(storage, returnPromptKey(userId, candidate.filmId, candidate.rentedAt));
      const { startReturn: start, onNotice: notify, films: catalogue } = latest.current;
      const review = reviewStateFor(candidate.filmId, new Set(state.userReviews.map((r) => r.film_id)), state.reviewEligibility);
      notify({
        ...returnPromptText({ title: titleOf(catalogue, candidate.filmId), rentedAt: candidate.rentedAt, nowMs: Date.now(), rewound: candidate.rewindClaimed, review }),
        primary: { label: 'Rendre la K7', onPress: () => void start(candidate.filmId) },
        secondary: { label: 'Plus tard', onPress: () => notify(null) },
      });
    })();
  }, [active, fetchMe]);
}
