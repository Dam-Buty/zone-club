import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store';
import type { Film } from '../../types';
import { KioskPoster } from './KioskBrowse';
import { rentalRows } from './kiosk-logic';
import styles from './KioskPanels.module.css';

// « Mes locations » : les locations en cours, la plus proche de son échéance d'abord, avec le temps
// qui reste (docs/superpowers/specs/2026-11-17-borne-distribution-k7-design.md, § 7). Le rendu d'une
// K7 par la fente n'y est pas : il appartient à la tranche c.

interface KioskRentalsProps {
  /** Tout le catalogue, sans doublon : il donne le titre et la jaquette de chaque location. */
  films: Film[];
  onWatch: (filmId: number) => void;
  onBack: () => void;
}

export function KioskRentals({ films, onWatch, onBack }: KioskRentalsProps) {
  const rentals = useStore((state) => state.rentals);
  // Le temps restant se recalcule une fois par minute : c'est sa précision.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const rows = useMemo(() => rentalRows(rentals, films, now), [rentals, films, now]);

  return (
    <div className={styles.kSearchPane}>
      <button type="button" className={styles.kAuthBack} onClick={onBack}>
        Retour
      </button>
      <h2 className={styles.kRentalsTitle}>Mes locations</h2>

      <div className={styles.kSearchResults} role="list">
        {rows.length === 0 && <p className={styles.kSearchHint}>Aucune location en cours.</p>}
        {rows.map((row) => {
          const film = films.find((f) => f.id === row.filmId);
          return (
            <div key={row.filmId} role="listitem" className={styles.kSearchRow}>
              {film && <KioskPoster film={film} size="w185" className={styles.kSearchPoster} />}
              <span className={styles.kSearchText}>
                <span className={styles.kSearchTitle}>{row.title}</span>
                <span className={styles.kSearchMeta}>{row.timeLeft}</span>
              </span>
              <button type="button" className={`${styles.kNoticeBtn} ${styles.kNoticeBtnPrimary} ${styles.kRentalWatch}`} onClick={() => onWatch(row.filmId)}>
                Regarder
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
