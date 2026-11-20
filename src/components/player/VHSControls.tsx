import { useState, useEffect, useCallback, useRef } from 'react';
import type { PlayerState } from '../../types';
import styles from './VHSControls.module.css';

interface VHSControlsProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** La key de l'élément <video> : il est remonté à chaque autre version et à chaque « Réessayer ». */
  videoKey: string;
  playerState: PlayerState;
  onStateChange: (state: PlayerState) => void;
  onStop: () => void;
  onEject: () => void;
  // FF/RW
  ffSpeed: number; // 0=off, 2=x2, 4=x4
  onFFCycle: () => void;
  onRWCycle: () => void;
  onRewindToStart: () => void;
  onResumeFromRW: () => void;
  /** Le nom de la version qui joue (« VF », « VOSTFR »…), montré sur le bouton « Version ». */
  versionLabel: string;
  /** Le bouton « Version » : la liste des versions de ce film (spec 2026-11-19-versions-et-erreurs-de-lecture, § 4.3 b). */
  onOpenVersion(): void;
}

/**
 * Barre de contrôle locale (lecture sur l'appareil, pas de cast).
 *
 * Disposition en deux coins, sans compteurs : le transport VCR occupe le coin
 * bas-gauche, le bouton « Version » puis le volume le coin bas-droit. Le
 * cast / AirPlay / miroir et le retour au vidéoclub vivent dans le chrome haut
 * de `VHSPlayer` — ils ne dépendent pas de la lecture locale.
 */
export function VHSControls({
  videoRef,
  videoKey,
  playerState,
  onStateChange,
  onStop,
  onEject,
  ffSpeed,
  onFFCycle,
  onRWCycle,
  onRewindToStart,
  onResumeFromRW,
  versionLabel,
  onOpenVersion,
}: VHSControlsProps) {
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  // Le volume et le muet suivent l'élément courant. Un nouvel élément (autre version, « Réessayer ») reprend ceux que
  // laisse le précédent : sans cela il repartait à plein volume, son coupé levé, sous un curseur qui disait l'inverse.
  const levelRef = useRef<{ volume: number; muted: boolean } | null>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const left = levelRef.current;
    if (left) {
      video.volume = left.volume;
      video.muted = left.muted;
    }

    const handleVolumeChange = () => {
      setVolume(video.volume);
      setIsMuted(video.muted);
    };

    video.addEventListener('volumechange', handleVolumeChange);

    return () => {
      video.removeEventListener('volumechange', handleVolumeChange);
      levelRef.current = { volume: video.volume, muted: video.muted };
    };
  }, [videoRef, videoKey]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (playerState === 'rewinding' || playerState === 'fastforwarding') {
      onResumeFromRW();
      return;
    }

    if (playerState === 'playing') {
      video.pause();
      onStateChange('paused');
    } else {
      video.playbackRate = 1;
      video.play();
      onStateChange('playing');
    }
  }, [videoRef, playerState, onStateChange, onResumeFromRW]);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
  }, [videoRef]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (video) {
      video.volume = parseFloat(e.target.value);
    }
  }, [videoRef]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  }, []);

  // State indicator text
  const stateLabel = (() => {
    if (playerState === 'fastforwarding') return `FF x${ffSpeed}`;
    if (playerState === 'rewinding') return `REW x${ffSpeed}`;
    if (playerState === 'paused') return 'PAUSE';
    if (playerState === 'playing') return 'PLAY';
    return '';
  })();

  return (
    <div className={styles.controls}>
      {/* ===== Bas gauche : état + transport VCR ===== */}
      <div className={styles.transportBlock}>
        {stateLabel && (
          <div className={`${styles.stateIndicator} ${(playerState === 'fastforwarding' || playerState === 'rewinding') ? styles.stateFF : ''}`}>
            {stateLabel}
          </div>
        )}
        <div className={styles.vcrTransport}>
          <button onClick={onRewindToStart} className={styles.vcrBtn} title="Rembobiner au début [R]">
            <span className={styles.vcrIcon}>⏮</span>
            <span className={styles.vcrLabel}>REW</span>
          </button>
          <button onClick={onRWCycle} className={`${styles.vcrBtn} ${playerState === 'rewinding' ? styles.vcrBtnActive : ''}`} title="Rembobiner [←]">
            <span className={styles.vcrIcon}>◀◀</span>
            <span className={styles.vcrLabel}>BACK</span>
          </button>
          <button onClick={togglePlay} className={`${styles.vcrBtn} ${styles.vcrPlayBtn} ${playerState === 'playing' ? styles.vcrBtnActive : ''}`} title="Lecture [Espace]">
            <span className={styles.vcrIcon}>▶</span>
            <span className={styles.vcrLabel}>PLAY</span>
          </button>
          <button onClick={onFFCycle} className={`${styles.vcrBtn} ${playerState === 'fastforwarding' ? styles.vcrBtnActive : ''}`} title="Avance rapide [→]">
            <span className={styles.vcrIcon}>▶▶</span>
            <span className={styles.vcrLabel}>FF</span>
          </button>
          <button onClick={onStop} className={styles.vcrBtn} title="Stop [S]">
            <span className={styles.vcrIcon} style={{ fontSize: '1.4rem' }}>■</span>
            <span className={styles.vcrLabel}>STOP</span>
          </button>
          <button onClick={onEject} className={`${styles.vcrBtn} ${styles.vcrEjectBtn}`} title="Éjecter [E / ESC]">
            <span className={styles.vcrIcon}>⏏</span>
            <span className={styles.vcrLabel}>EJECT</span>
          </button>
        </div>
      </div>

      {/* ===== Bas droite : la version puis le volume ===== */}
      <div className={styles.optionsBlock}>
        {/* Un seul bouton : la version qui joue, et un appui ouvre la liste des versions de ce film. Une version absente
            y est écrite avec sa raison — jamais un bouton grisé. Les touches V (piste) et T (sous-titres) restent. */}
        <button type="button" onClick={onOpenVersion} className={styles.versionBtn} title="Changer de version [V : piste, T : sous-titres]">
          <span className={styles.versionBtnLabel}>Version</span>
          <span className={styles.versionBtnValue}>{versionLabel}</span>
        </button>

        {/* Volume */}
        <div className={styles.volumeGroup}>
          <button onClick={toggleMute} className={styles.vcrSmallBtn} title={isMuted ? 'Activer son' : 'Couper son [M]'}>
            {isMuted ? '🔇' : '🔊'}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
            className={styles.volumeSlider}
            aria-label="Volume"
          />
          <button onClick={toggleFullscreen} className={styles.vcrSmallBtn} title="Plein écran [F]">
            ⛶
          </button>
        </div>
      </div>
    </div>
  );
}
