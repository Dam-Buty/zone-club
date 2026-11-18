import { useEffect, useMemo, useState } from 'react';
import { useCredits, useStore } from '../../store';
import type { Film } from '../../types';
import { KioskPoster } from './KioskBrowse';
import { accountHistoryRows, creditsLabel, dayLabel, rentalRows, reviewStateFor, type KioskReviewState } from './kiosk-logic';
import styles from './KioskPanels.module.css';

// « Mon compte » : ouvert par « Compte » à tout moment, sans avoir à louer d'abord
// (docs/superpowers/specs/2026-11-17-borne-mon-compte-design.md, § 4). Crédits, locations en cours, tout
// l'historique avec le rembobinage, le retour anticipé et la critique de chaque film.

interface KioskAccountProps {
  /** Tout le catalogue, sans doublon : jaquettes et titres. */
  films: Film[];
  onWatch: (filmId: number) => void;
  onReview: (filmId: number) => void;
  onLogout: () => void;
  onBack: () => void;
}

/** Coche ou croix dessinées (aucun glyphe tiré d'une police de secours). */
function Mark({ ok }: { ok: boolean }) {
  return (
    <svg className={ok ? styles.kMarkOk : styles.kMarkNo} viewBox="0 0 12 12" aria-hidden="true">
      {ok ? <path d="M2 6.5 5 9.5 10.5 3" /> : <path d="M3 3l6 6M9 3 3 9" />}
    </svg>
  );
}

function ReviewLine({ state, onWrite }: { state: KioskReviewState; onWrite: () => void }) {
  if (state.kind === 'publiée') {
    return (
      <span className={styles.kAccountFact}>
        <Mark ok /> Critique publiée
      </span>
    );
  }
  if (state.kind === 'possible') {
    return (
      <button type="button" className={`${styles.kNoticeBtn} ${styles.kAccountReview}`} onClick={onWrite}>
        Écrire ma critique · +1 crédit
      </button>
    );
  }
  return <span className={styles.kAccountReason}>{state.reason}</span>;
}

export function KioskAccount({ films, onWatch, onReview, onLogout, onBack }: KioskAccountProps) {
  const authUser = useStore((state) => state.authUser);
  const rentals = useStore((state) => state.rentals);
  const history = useStore((state) => state.rentalHistory);
  const userReviews = useStore((state) => state.userReviews);
  const eligibility = useStore((state) => state.reviewEligibility);
  const fetchMe = useStore((state) => state.fetchMe);
  const credits = useCredits();

  // Les données du compte sont relues à l'ouverture : un retour, un rembobinage ou une critique faits
  // ailleurs (vidéoclub, autre appareil, serveur à la fin d'un Cast) doivent s'y voir.
  useEffect(() => {
    void fetchMe();
  }, [fetchMe]);

  // Le temps restant des locations en cours se recalcule une fois par minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const reviewed = useMemo(() => new Set(userReviews.map((r) => r.film_id)), [userReviews]);
  const current = useMemo(() => rentalRows(rentals, films, now), [rentals, films, now]);
  const past = useMemo(() => accountHistoryRows(history, reviewed, eligibility), [history, reviewed, eligibility]);
  const filmById = useMemo(() => new Map(films.map((f) => [f.id, f])), [films]);

  return (
    <div className={`${styles.kSearchPane} ${styles.kAccount}`}>
      <button type="button" className={styles.kAuthBack} onClick={onBack}>
        Retour
      </button>
      <h2 className={styles.kRentalsTitle}>Mon compte</h2>
      <p className={styles.kAccountWho}>
        <span>{authUser?.username ?? ''}</span>
        <span className={styles.kAccountCredits}>{creditsLabel(credits)}</span>
      </p>

      <div className={styles.kSearchResults}>
        <h3 className={styles.kAccountSection}>En cours</h3>
        {current.length === 0 && <p className={styles.kSearchHint}>Aucune location en cours.</p>}
        <div role="list">
          {current.map((row) => {
            const film = filmById.get(row.filmId);
            return (
              <div key={row.filmId} role="listitem" className={`${styles.kSearchRow} ${styles.kAccountRow}`}>
                {film && <KioskPoster film={film} size="w185" className={styles.kSearchPoster} />}
                <span className={styles.kSearchText}>
                  <span className={styles.kSearchTitle}>{row.title}</span>
                  <span className={styles.kSearchMeta}>{row.timeLeft}</span>
                  <ReviewLine state={reviewStateFor(row.filmId, reviewed, eligibility)} onWrite={() => onReview(row.filmId)} />
                </span>
                <button type="button" className={`${styles.kNoticeBtn} ${styles.kNoticeBtnPrimary} ${styles.kRentalWatch}`} onClick={() => onWatch(row.filmId)}>
                  Regarder
                </button>
              </div>
            );
          })}
        </div>

        <h3 className={styles.kAccountSection}>Historique</h3>
        {past.length === 0 && <p className={styles.kSearchHint}>Aucune location terminée.</p>}
        <div role="list">
          {past.map((row, i) => {
            const film = filmById.get(row.filmId);
            const end = row.end.atMs === null ? 'terminée' : `${row.end.kind} le ${dayLabel(row.end.atMs)}`;
            return (
              <div key={`${row.filmId}-${i}`} role="listitem" className={`${styles.kSearchRow} ${styles.kAccountRow}`}>
                {film && <KioskPoster film={film} size="w185" className={styles.kSearchPoster} />}
                <span className={styles.kSearchText}>
                  <span className={styles.kSearchTitle}>{row.title}</span>
                  <span className={styles.kSearchMeta}>{end}</span>
                  <span className={styles.kAccountFact}>
                    <Mark ok={row.rewound} /> {row.rewound ? 'Rembobiné · +1 crédit' : 'Pas rembobiné'}
                  </span>
                  <span className={styles.kAccountFact}>
                    <Mark ok={row.returnedEarly} /> {row.returnedEarly ? 'Rendu en avance · +1 crédit' : 'Pas rendu en avance'}
                  </span>
                  <ReviewLine state={row.review} onWrite={() => onReview(row.filmId)} />
                </span>
              </div>
            );
          })}
        </div>

        <button type="button" className={`${styles.kNoticeBtn} ${styles.kAccountLogout}`} onClick={onLogout}>
          Se déconnecter
        </button>
      </div>
    </div>
  );
}
