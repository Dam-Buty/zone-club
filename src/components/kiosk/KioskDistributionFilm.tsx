import { useState } from 'react';
import {
  boxStyle,
  displayLines,
  fallbackSpineSrc,
  fallbackWearSrc,
  overlayVisible,
  spineSrc,
  wearLevel,
  type Arret,
  type DistributionFilm,
} from './kiosk-distribution-logic';
import type { DistributionFilmPlayer } from './useDistributionFilm';
import styles from './KioskDistributionFilm.module.css';

// La distribution filmée de la K7 (livraison 2 — docs/superpowers/specs/2026-11-17-borne-distribution-k7-design.md,
// § 12) : la vidéo du robot, la même pour tous les films, et ce que la page pose dessus pendant l'arrêt sur la fente —
// la tranche du film loué (image préparée par la fabrique : usure de son année et éclairage déjà cuits) et le texte de
// l'afficheur. Aucun dessin ici : des images et du texte en composition normale, comme partout dans la borne.
//
// La balise <video> reste montée tant que la borne l'est (le crochet doit la trouver à la réponse du serveur) ; rien
// ne se voit hors de la phase « film ». Un appui n'importe où passe au panneau « Votre K7 est prête ».

interface KioskDistributionFilmProps {
  film: DistributionFilm;
  arret: Arret;
  player: DistributionFilmPlayer;
  /** La vidéo est à l'écran (phase « film » de la borne). */
  active: boolean;
  /** Le film loué ; `null` hors de la phase « film ». */
  rented: { title: string; tmdbId: number | null; year: number | null } | null;
}

export function KioskDistributionFilm({ film, arret, player, active, rented }: KioskDistributionFilmProps) {
  // Tranche préparée introuvable pour ce film : on passe au repli (titre écrit ici, usure posée par-dessus).
  const [missing, setMissing] = useState<number | null>(null);
  const shown = active && player.phase === 'playing';
  const overlays = shown && rented !== null && overlayVisible(player.timeMs, arret);
  const level = wearLevel(rented?.year);
  const prepared = rented !== null && rented.tmdbId !== null && missing !== rented.tmdbId;
  const [line1, line2] = displayLines(rented?.title ?? '');

  return (
    <div
      className={`${styles.film} ${shown ? styles.filmShown : ''}`}
      style={{ '--film-ratio': `${film.largeur} / ${film.hauteur}` } as React.CSSProperties}
      aria-hidden={!shown}
      onClick={shown ? player.skip : undefined}
    >
      <div className={styles.stage}>
        <video ref={player.videoRef} className={styles.video} src={player.src ?? undefined} playsInline preload="auto" width={film.largeur} height={film.hauteur} />

        {overlays && rented !== null && (
          <>
            <div className={styles.display} style={boxStyle(arret.afficheur)} role="status">
              <span>{line1}</span>
              <span>{line2}</span>
            </div>
            <div className={styles.spine} style={boxStyle(arret.tranche)}>
              {prepared && rented.tmdbId !== null ? (
                <img src={spineSrc(rented.tmdbId)} alt={rented.title} draggable={false} onError={() => setMissing(rented.tmdbId)} />
              ) : (
                <>
                  <img src={fallbackSpineSrc(level)} alt="" draggable={false} />
                  <span className={styles.spineTitle}>{rented.title}</span>
                  <img src={fallbackWearSrc(level)} alt="" draggable={false} />
                </>
              )}
            </div>
          </>
        )}

        {shown && player.muted && (
          <span className={styles.mutedSign} role="img" aria-label="Son coupé">
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
              <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
              <path d="M16 9l5 6m0-6l-5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
            </svg>
          </span>
        )}
      </div>
    </div>
  );
}
