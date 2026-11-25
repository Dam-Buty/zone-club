'use client';

import { useStore } from '../../store';
import type { VideoClubState } from '../../store';
import { castNoticeView, castOtherFilmText } from '../../cast/cast-labels';
import styles from './CastNotices.module.css';

// Les deux lignes que le lecteur pose sous son en-tête quand le film se regarde ici et que le Cast a quelque chose à
// dire : son message (arrêt venu d'ailleurs, échec, location terminée…) et le bandeau d'un autre film en cours sur la
// TV (docs/superpowers/specs/2026-11-18-cast-refonte-design.md, § 5.2 bis et 5.4). Elles lisent la tranche `cast` du
// magasin ; les demandes au Cast (réessayer, remplacer) restent au lecteur, qui les fait partir dans la pile de l'appui.

/** Titre du film que joue la TV : catalogue chargé, sinon l'historique (la borne ne charge pas tous les rayons). */
function tvFilmTitle(s: VideoClubState): string | null {
  const id = s.cast.filmId;
  if (id === null) return null;
  return Object.values(s.films).flat().find((f) => f.id === id)?.title
    ?? s.rentalHistory.find((h) => h.filmId === id)?.title
    ?? null;
}

/** Le message du Cast pour ce film (ou sans film), fermable. « Cast indisponible » n'est pas ici : c'est un panneau. */
export function CastNoticeLine({ filmId, onRetry }: { filmId: number; onRetry: () => void }) {
  const notice = useStore((s) => s.cast.notice);
  const castDismiss = useStore((s) => s.castDismiss);
  if (!notice || (notice.filmId !== null && notice.filmId !== filmId)) return null;
  const shown = castNoticeView(notice.code, notice.deviceName);
  if (shown.mirroring) return null;

  return (
    <div className={styles.line} role="status">
      <span className={styles.text}>{shown.text}</span>
      {shown.retry && (
        <button type="button" className={styles.action} onClick={onRetry}>
          Réessayer
        </button>
      )}
      <button type="button" className={styles.close} onClick={castDismiss} aria-label="Fermer le message">
        ✕
      </button>
    </div>
  );
}

/**
 * Un autre film passe sur la TV : on le dit, et « Regarder sur TV » du lecteur demande d'abord s'il faut le remplacer
 * (`confirming`). « Oui » est l'appui qui lance le Cast : le lecteur y appelle `castFilm` directement.
 */
export function OtherFilmBanner({ confirming, onConfirm, onCancel }: { confirming: boolean; onConfirm: () => void; onCancel: () => void }) {
  const title = useStore(tvFilmTitle);
  const deviceName = useStore((s) => s.cast.deviceName);
  const text = castOtherFilmText(title, deviceName);

  return (
    <div className={styles.line} role="status">
      <span className={styles.text}>{confirming ? text.confirm : text.banner}</span>
      {confirming && (
        <>
          <button type="button" className={styles.action} onClick={onConfirm}>
            Oui
          </button>
          <button type="button" className={styles.action} onClick={onCancel}>
            Non
          </button>
        </>
      )}
    </div>
  );
}
