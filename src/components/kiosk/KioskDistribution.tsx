import { useEffect, useId, useRef, useState } from 'react';
import { useStore } from '../../store';
import { appleAirPlay } from '../../utils/cast-on-open';
import { readyUntilText, tvMeansLabel, watchHereLabel } from './kiosk-logic';
import styles from './KioskPanels.module.css';

// La distribution de la K7 après « LOUER » confirmé
// (docs/superpowers/specs/2026-11-17-borne-distribution-k7-design.md). Livraison 1 : l'attente du
// serveur, puis le panneau « Votre K7 est prête ». La livraison 2 insérera ici, entre les deux,
// l'animation du robot.

/** Pendant l'appel au serveur. Sans bouton : l'enregistrement d'une location ne s'annule pas. */
export function KioskWaiting() {
  return (
    <div className={styles.kNoticeScrim}>
      <div className={styles.kNotice} role="status">
        <p className={styles.kNoticeTitle}>Veuillez patienter</p>
        <p className={styles.kNoticeBody}>Location en cours…</p>
        <div className={styles.kWaitBar} aria-hidden="true" />
      </div>
    </div>
  );
}

interface KioskReadyProps {
  /** Titre du film loué ; « Titre indisponible » si le catalogue chargé ne le connaît pas. */
  title: string;
  /** Échéance de la location (ms) ; `null` si le magasin ne la connaît pas encore. */
  expiresAt: number | null;
  onWatch: () => void;
  onTv: () => void;
  onAccount: () => void;
  /** « Plus tard » : fermer sans rien lancer — le panneau ne doit jamais enfermer le visiteur. */
  onLater: () => void;
}

/** Où regarder et comment, lus sur l'appareil (pointeur, petit côté de l'écran, AirPlay). */
function readWatchLabels(): { here: string; tv: string } {
  if (typeof window === 'undefined') return { here: watchHereLabel({ coarsePointer: false, shortSide: 1080 }), tv: tvMeansLabel(false) };
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const shortSide = Math.min(window.screen.width, window.screen.height);
  const airPlay = typeof HTMLVideoElement !== 'undefined' && appleAirPlay(navigator.userAgent, HTMLVideoElement.prototype as { webkitShowPlaybackTargetPicker?: unknown });
  return { here: watchHereLabel({ coarsePointer, shortSide }), tv: tvMeansLabel(airPlay) };
}

/** Pictogrammes dessinés (aucun glyphe tiré d'une police) : un téléphone, une télé. */
function HereIcon() {
  return (
    <svg className={styles.kReadyIcon} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6.5" y="2.5" width="11" height="19" rx="2" />
      <path d="M10.5 18.5h3" />
    </svg>
  );
}
function TvIcon() {
  return (
    <svg className={styles.kReadyIcon} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2.5" y="4.5" width="19" height="13" rx="1.5" />
      <path d="M8 21h8M12 17.5V21" />
    </svg>
  );
}

/** La K7 est distribuée : où la regarder — ici, ou sur la télé — et un lien vers « Mon compte ». */
export function KioskReady({ title, expiresAt, onWatch, onTv, onAccount, onLater }: KioskReadyProps) {
  const titleId = useId();
  const watchRef = useRef<HTMLButtonElement>(null);
  const [labels] = useState(readWatchLabels);
  const startCast = useStore((state) => state.startCast);

  useEffect(() => {
    watchRef.current?.focus();
    // Le service du Cast démarre maintenant, SDK chargé et initialisé, pour que l'appui sur « Sur ma télé » ouvre
    // le sélecteur pendant que le navigateur tient encore cet appui pour un geste de l'utilisateur.
    startCast();
  }, [startCast]);

  return (
    <div className={styles.kNoticeScrim}>
      <div className={styles.kNotice} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId} className={styles.kNoticeTitle}>Votre K7 est prête</h2>
        <p className={styles.kReadyFilm}>{title}</p>
        {expiresAt !== null && <p className={styles.kNoticeBody}>{readyUntilText(expiresAt)}</p>}
        <p className={styles.kReadyQuestion}>Où voulez-vous regarder ?</p>
        <button ref={watchRef} type="button" className={`${styles.kNoticeBtn} ${styles.kNoticeBtnPrimary} ${styles.kReadyChoice}`} onClick={onWatch}>
          <HereIcon />
          <span className={styles.kReadyChoiceText}>
            <span>{labels.here}</span>
            <small>le film démarre ici</small>
          </span>
        </button>
        <button type="button" className={`${styles.kNoticeBtn} ${styles.kReadyChoice}`} onClick={onTv}>
          <TvIcon />
          <span className={styles.kReadyChoiceText}>
            <span>Sur ma télé</span>
            <small>{labels.tv}</small>
          </span>
        </button>
        <div className={styles.kReadyLinks}>
          <button type="button" className={styles.kReadyLink} onClick={onLater}>
            Plus tard
          </button>
          <button type="button" className={styles.kReadyLink} onClick={onAccount}>
            Mon compte ›
          </button>
        </div>
      </div>
    </div>
  );
}
