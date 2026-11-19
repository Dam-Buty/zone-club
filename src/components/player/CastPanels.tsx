'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useStore } from '../../store';
import { CAST_ACK_TIMEOUT_MS, CAST_STATUS_TIMEOUT_MS, castView } from '../../cast/cast-machine';
import {
  CAST_CHOOSING_TEXT, NO_VOLUME_GESTURE, castBackLabel, castDeviceLabel, castWaitingParts, continueHereLabel, formatCastTime,
  volumeDragged, volumeSettle, volumeShown,
} from '../../cast/cast-labels';
import type { VolumeGesture } from '../../cast/cast-labels';
import { watchHereLabel } from '../kiosk/kiosk-logic';
import styles from './CastPanels.module.css';

// Ce que le visiteur voit pendant qu'un film passe par le Cast : l'attente (sélecteur, connexion, lancement), la
// télécommande, la liaison perdue (docs/superpowers/specs/2026-11-18-cast-refonte-design.md, § 5.2 et 5.5).
//
// Ces panneaux LISENT la tranche `cast` du magasin et DEMANDENT par ses actions : aucun état du Cast n'est tenu ici,
// et aucun n'est écrit. Le lecteur les monte par-dessus sa vidéo (tâche 6) ; `castView` dit lequel s'affiche.

export interface CastPanelsProps {
  /** Le film du lecteur : `castView` compare la machine à lui (un autre film sur la TV n'affiche rien ici). */
  filmId: number;
  /** Titre affiché sur la télécommande et sur l'écran verrouillé. */
  title: string;
  /** « Retour » de la télécommande, « Fermer » de la liaison perdue : quitter le lecteur, la TV continue. */
  onBack: () => void;
  /** Les boutons STFR / STEN du lecteur (un `<button>` par langue), ou null sans sous-titres : le panneau pose la rangée. */
  subtitles: ReactNode;
  /** Jaquette montrée sur l'écran verrouillé, si le lecteur en a une. */
  posterUrl?: string;
}

/** Où regarder ici, lu sur l'appareil comme la borne le fait (pointeur, petit côté de l'écran). */
function readHereLabel(): ReturnType<typeof watchHereLabel> {
  if (typeof window === 'undefined') return watchHereLabel({ coarsePointer: false, shortSide: 1080 });
  return watchHereLabel({
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    shortSide: Math.min(window.screen.width, window.screen.height),
  });
}

/**
 * Commandes de l'écran verrouillé et notification média d'Android, tant que la télécommande est affichée : lecture et
 * pause basculent la TV, « stop » l'arrête. Retirées dès que la télécommande disparaît.
 */
function useLockScreenControls(active: boolean, title: string, posterUrl: string | undefined): void {
  const castToggle = useStore((s) => s.castToggle);
  const castStop = useStore((s) => s.castStop);

  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title || 'Zone Club',
        artist: 'Zone Club',
        artwork: posterUrl ? [{ src: posterUrl, sizes: '200x300', type: 'image/jpeg' }] : [],
      });
    } catch {
      // Une affiche dont l'adresse est refusée lève ici : l'écran verrouillé s'en passe, la télécommande reste.
    }
    try {
      navigator.mediaSession.setActionHandler('play', castToggle);
      navigator.mediaSession.setActionHandler('pause', castToggle);
      navigator.mediaSession.setActionHandler('stop', castStop);
    } catch {
      // Un navigateur qui ne connaît pas une de ces actions la refuse : la télécommande de l'écran verrouillé est un
      // confort, son absence ne doit pas faire tomber le panneau.
    }
    return () => {
      try {
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('stop', null);
      } catch {
        // Même refus qu'à la pose.
      }
      navigator.mediaSession.metadata = null;
    };
  }, [active, title, posterUrl, castToggle, castStop]);
}

/** Le sélecteur est ouvert, ou la télé se connecte, ou le film se lance : on attend, et on peut annuler. */
function WaitingPanel({ phase, deviceName }: { phase: 'choosing' | 'connecting' | 'loading'; deviceName: string | null }) {
  const castCancel = useStore((s) => s.castCancel);
  const parts = phase === 'choosing' ? null : castWaitingParts(phase, deviceName);

  return (
    <div className={styles.castingOverlay}>
      <div className={styles.awaitingIcon}>
        <span className={styles.awaitingRing} />
        <span className={styles.awaitingDish} role="img" aria-label="satellite">📡</span>
      </div>
      <div className={styles.castingTitle}>
        {parts === null ? (
          CAST_CHOOSING_TEXT
        ) : (
          <>
            {parts.before}
            {parts.named ? <span className={styles.awaitingDeviceName}>{parts.device}</span> : parts.device}
            <span className={styles.awaitingDots}>{parts.after}</span>
          </>
        )}
      </div>
      <button type="button" className={styles.awaitingCancelBtn} onClick={castCancel}>
        Annuler
      </button>
    </div>
  );
}

/**
 * Curseur de volume : le pouce suit le doigt, et la TV ne reçoit qu'une commande, au relâchement (`volumeSettle`). Un
 * curseur qui n'afficherait que le volume de la TV reviendrait en arrière sous le doigt le temps de l'accusé. La valeur
 * du doigt s'affiche jusqu'à ce que la TV réponde (son volume change) ou, à défaut, jusqu'à l'échéance des accusés : le
 * curseur ne reste jamais sur une valeur que la TV n'a pas.
 */
function VolumeRow({ tvVolume, busy }: { tvVolume: number; busy: boolean }) {
  const castVolume = useStore((s) => s.castVolume);
  const [draft, setDraft] = useState<{ level: number; base: number } | null>(null);
  const gesture = useRef<VolumeGesture>(NO_VOLUME_GESTURE);
  const giveUp = useRef<number | undefined>(undefined);

  const run = useCallback(
    (release: boolean) => {
      const step = volumeSettle(gesture.current, { release, busy, tvVolume });
      gesture.current = step.gesture;
      if (step.clear) setDraft(null);
      if (step.send === null) return;
      castVolume(step.send);
      window.clearTimeout(giveUp.current);
      giveUp.current = window.setTimeout(() => setDraft(null), CAST_ACK_TIMEOUT_MS);
    },
    [busy, tvVolume, castVolume],
  );
  // Une commande en vol qui retombe : la valeur relâchée pendant ce temps part maintenant.
  useEffect(() => {
    if (!busy) run(false);
  }, [busy, run]);
  useEffect(() => () => window.clearTimeout(giveUp.current), []);

  // Pointeur, toucher, clavier, focus : l'un ou l'autre lève le geste, et les suivants ne renvoient rien.
  const release = () => run(true);

  return (
    <div className={`${styles.nowPlayingVolumeRow}${busy ? ` ${styles.nowPlayingBusy}` : ''}`}>
      <span aria-hidden="true">🔉</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={volumeShown(draft, tvVolume)}
        onChange={(e) => {
          const level = Number(e.target.value);
          window.clearTimeout(giveUp.current);
          gesture.current = volumeDragged(level);
          setDraft({ level, base: tvVolume });
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onTouchEnd={release}
        onKeyUp={release}
        onBlur={release}
        className={styles.nowPlayingVolumeSlider}
        aria-label="Volume TV"
        aria-busy={busy}
      />
    </div>
  );
}

/** La TV joue : la télécommande dit l'état réel de la TV, et obéit une commande à la fois. */
function RemotePanel({ title, onBack, subtitles }: Pick<CastPanelsProps, 'title' | 'onBack' | 'subtitles'>) {
  const cast = useStore((s) => s.cast);
  const playerFrom = useStore((s) => s.playerFrom);
  const castToggle = useStore((s) => s.castToggle);
  const castSeekBy = useStore((s) => s.castSeekBy);
  const castStop = useStore((s) => s.castStop);
  const castToPhone = useStore((s) => s.castToPhone);
  const [here] = useState(readHereLabel);

  // Une commande attend l'accusé de la TV : les boutons le disent (aria-busy), s'estompent, et ignorent l'appui. Ils
  // restent de vrais boutons — sur mobile, un bouton grisé par le navigateur avalerait le toucher sans rien dire.
  const busy = cast.busy;
  const dim = busy ? ` ${styles.nowPlayingBusy}` : '';
  const press = (action: () => void) => () => {
    if (busy) return;
    action();
  };
  const percent = cast.duration > 0 ? Math.min(100, (cast.position / cast.duration) * 100) : 0;

  return (
    <div className={styles.castingOverlay}>
      <div className={styles.nowPlayingHeader}>
        <div className={styles.nowPlayingDeviceChip}>{castDeviceLabel(cast.deviceName)}</div>
        {title && <div className={styles.nowPlayingFilmTitle}>{title}</div>}
      </div>

      <div className={styles.castingTimer}>
        {formatCastTime(cast.position)} / {formatCastTime(cast.duration)}
      </div>
      {cast.duration > 0 && (
        <>
          <div className={styles.castingBarContainer}>
            <div className={styles.castingBarFill} style={{ width: `${percent}%` }} />
          </div>
          <div className={styles.castingPercent}>{Math.round(percent)}%</div>
        </>
      )}

      <div className={styles.nowPlayingTransport}>
        <button
          type="button"
          className={`${styles.nowPlayingBtn}${dim}`}
          aria-busy={busy}
          onClick={press(() => castSeekBy(-15))}
          aria-label="Reculer de 15 secondes"
        >
          −15s
        </button>
        <button
          type="button"
          className={`${styles.nowPlayingBtn} ${styles.nowPlayingBtnPrimary}${dim}`}
          aria-busy={busy}
          onClick={press(castToggle)}
          aria-label={cast.paused ? 'Lecture' : 'Pause'}
        >
          {cast.paused ? '▶' : '⏸'}
        </button>
        <button
          type="button"
          className={`${styles.nowPlayingBtn}${dim}`}
          aria-busy={busy}
          onClick={press(() => castSeekBy(15))}
          aria-label="Avancer de 15 secondes"
        >
          +15s
        </button>
      </div>

      <VolumeRow tvVolume={cast.volume} busy={busy} />

      {/* Sans ces boutons, changer de langue pendant le Cast serait impossible au doigt sur mobile. */}
      {subtitles != null && subtitles !== false && <div className={styles.nowPlayingSubtitleRow}>{subtitles}</div>}

      <div className={styles.nowPlayingSecondary}>
        <button type="button" className={styles.nowPlayingSecondaryBtn} onClick={onBack}>
          {castBackLabel(playerFrom)}
        </button>
        <button type="button" className={styles.nowPlayingSecondaryBtn} onClick={castToPhone}>
          {here}
        </button>
        <button type="button" className={`${styles.nowPlayingSecondaryBtn} ${styles.nowPlayingStopBtn}`} onClick={castStop}>
          <span aria-hidden="true">⏹</span> Arrêter
        </button>
      </div>
    </div>
  );
}

/** La TV ne répond plus (la séance serveur reste ouverte, elle joue peut-être encore) : trois issues, jamais une impasse. */
function LostPanel({ onBack }: Pick<CastPanelsProps, 'onBack'>) {
  const castRetry = useStore((s) => s.castRetry);
  const castToPhone = useStore((s) => s.castToPhone);
  const [here] = useState(readHereLabel);

  // « Réessayer » ne change rien à l'écran tant que la TV se tait : le bouton dit qu'il a entendu (aria-busy, estompé)
  // et ignore les appuis suivants, le temps que la TV ait pu répondre. Le panneau disparaît si elle répond.
  const [retrying, setRetrying] = useState(false);
  const retryTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(retryTimer.current), []);
  const retry = () => {
    if (retrying) return;
    setRetrying(true);
    castRetry();
    retryTimer.current = window.setTimeout(() => setRetrying(false), CAST_STATUS_TIMEOUT_MS);
  };

  return (
    <div className={styles.castingOverlay}>
      <div className={styles.castingTitle} role="alert">
        La télé ne répond plus
      </div>
      <div className={styles.lostActions}>
        <button
          type="button"
          className={`${styles.nowPlayingSecondaryBtn} ${styles.lostBtn} ${styles.lostBtnPrimary}${retrying ? ` ${styles.nowPlayingBusy}` : ''}`}
          aria-busy={retrying}
          onClick={retry}
        >
          Réessayer
        </button>
        <button type="button" className={`${styles.nowPlayingSecondaryBtn} ${styles.lostBtn}`} onClick={castToPhone}>
          {continueHereLabel(here)}
        </button>
        <button type="button" className={`${styles.nowPlayingSecondaryBtn} ${styles.lostBtn}`} onClick={onBack}>
          Fermer
        </button>
      </div>
    </div>
  );
}

/**
 * Le panneau du Cast de `filmId`, ou rien : lecteur local normal (`local`), film d'une autre TV (`other-on-tv`, le
 * lecteur montre son bandeau), film terminé (`ended`, « BE KIND REWIND » est au lecteur).
 */
export function CastPanels({ filmId, title, onBack, subtitles, posterUrl }: CastPanelsProps) {
  const cast = useStore((s) => s.cast);
  const view = castView(cast, filmId);
  useLockScreenControls(view === 'remote', title, posterUrl);

  switch (view) {
    case 'choosing':
    case 'connecting':
    case 'loading':
      return <WaitingPanel phase={view} deviceName={cast.deviceName} />;
    case 'remote':
      return <RemotePanel title={title} onBack={onBack} subtitles={subtitles} />;
    case 'lost':
      return <LostPanel onBack={onBack} />;
    case 'local':
    case 'other-on-tv':
    case 'ended':
      return null;
  }
}
