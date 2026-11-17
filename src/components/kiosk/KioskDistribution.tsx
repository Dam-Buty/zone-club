import { useEffect, useId, useRef } from 'react';
import { preloadCastSdk } from '../../hooks/useGoogleCast';
import { readyUntilText } from './kiosk-logic';
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
  onRentals: () => void;
  /** « Plus tard » : fermer sans rien lancer — le panneau ne doit jamais enfermer le visiteur. */
  onLater: () => void;
}

/** La K7 est distribuée : regarder tout de suite, l'envoyer sur la TV, ou voir ses locations. */
export function KioskReady({ title, expiresAt, onWatch, onTv, onRentals, onLater }: KioskReadyProps) {
  const titleId = useId();
  const watchRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    watchRef.current?.focus();
    // Le SDK du Cast se charge maintenant, pour que l'appui sur « Sur la TV » ouvre le sélecteur
    // pendant que le navigateur tient encore cet appui pour un geste de l'utilisateur.
    void preloadCastSdk();
  }, []);

  return (
    <div className={styles.kNoticeScrim}>
      <div className={styles.kNotice} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId} className={styles.kNoticeTitle}>Votre K7 est prête</h2>
        <p className={styles.kReadyFilm}>{title}</p>
        {expiresAt !== null && <p className={styles.kNoticeBody}>{readyUntilText(expiresAt)}</p>}
        <div className={styles.kNoticeActions}>
          <button type="button" className={styles.kNoticeBtn} onClick={onTv}>
            Sur la TV
          </button>
          <button ref={watchRef} type="button" className={`${styles.kNoticeBtn} ${styles.kNoticeBtnPrimary}`} onClick={onWatch}>
            Regarder
          </button>
        </div>
        <div className={styles.kReadyLinks}>
          <button type="button" className={styles.kReadyLink} onClick={onLater}>
            Plus tard
          </button>
          <button type="button" className={styles.kReadyLink} onClick={onRentals}>
            Mes locations ›
          </button>
        </div>
      </div>
    </div>
  );
}
