import { useState, useEffect, useCallback } from 'react';
import type { PlayerState } from '../../types';
import type { AudioTrack, SubtitleTrack } from './VHSPlayer';
import styles from './VHSControls.module.css';

interface VHSControlsProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
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
  // Audio track props
  audioTrack: AudioTrack;
  onAudioTrackChange: (track: AudioTrack) => void;
  subtitleTrack: SubtitleTrack;
  onSubtitleTrackChange: (lang: Exclude<SubtitleTrack, 'off'>) => void;
  hasVF: boolean;
  hasVO: boolean;
  hasSubtitlesFr: boolean;
  hasSubtitlesEn: boolean;
}

/**
 * Barre de contrôle locale (lecture sur l'appareil, pas de cast).
 *
 * Disposition en deux coins, sans compteurs : le transport VCR occupe le coin
 * bas-gauche, le volume puis les sélecteurs de version le coin bas-droit. Le
 * cast / AirPlay / miroir et le retour au vidéoclub vivent dans le chrome haut
 * de `VHSPlayer` — ils ne dépendent pas de la lecture locale.
 */
export function VHSControls({
  videoRef,
  playerState,
  onStateChange,
  onStop,
  onEject,
  ffSpeed,
  onFFCycle,
  onRWCycle,
  onRewindToStart,
  onResumeFromRW,
  audioTrack,
  onAudioTrackChange,
  subtitleTrack,
  onSubtitleTrackChange,
  hasVF,
  hasVO,
  hasSubtitlesFr,
  hasSubtitlesEn,
}: VHSControlsProps) {
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleVolumeChange = () => {
      setVolume(video.volume);
      setIsMuted(video.muted);
    };

    video.addEventListener('volumechange', handleVolumeChange);

    return () => video.removeEventListener('volumechange', handleVolumeChange);
  }, [videoRef]);

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

      {/* ===== Bas droite : sélecteurs de version puis volume ===== */}
      <div className={styles.optionsBlock}>
        {/* Track selector */}
        <div className={styles.trackControls}>
          {(hasVF || hasVO) && (
            <div className={styles.trackSelector}>
              {/* Unavailable version: greyed + a clear "indisponible" label instead of a dead disabled
                  button (a disabled button swallows the tap with no feedback on mobile). onClick is
                  guarded so an unavailable version can't be selected. */}
              <button
                onClick={() => hasVF && onAudioTrackChange('vf')}
                className={`${styles.trackBtn} ${audioTrack === 'vf' ? styles.trackActive : ''}`}
                style={!hasVF ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                aria-disabled={!hasVF}
                title={hasVF ? 'Version Française [V]' : 'VF indisponible pour ce film'}
              >
                VF
              </button>
              <button
                onClick={() => hasVO && onAudioTrackChange('vo')}
                className={`${styles.trackBtn} ${audioTrack === 'vo' ? styles.trackActive : ''}`}
                style={!hasVO ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                aria-disabled={!hasVO}
                title={hasVO ? 'Version Originale [V]' : 'VO indisponible pour ce film'}
              >
                VO
              </button>
              {hasVF !== hasVO && (
                <span style={{ fontSize: '0.62rem', opacity: 0.7, alignSelf: 'center', marginLeft: 6, letterSpacing: '0.3px', whiteSpace: 'nowrap' }}>
                  {hasVF ? 'VO' : 'VF'} indisponible
                </span>
              )}
            </div>
          )}
          {/* Une langue absente n'a pas de bouton du tout : contrairement à VF/VO, l'absence de
              sous-titres n'a rien à expliquer à l'utilisateur — il n'a pas payé pour eux. */}
          {hasSubtitlesFr && (
            <button
              onClick={() => onSubtitleTrackChange('fr')}
              className={`${styles.trackBtn} ${styles.trackBtnAlone} ${subtitleTrack === 'fr' ? styles.trackActive : ''}`}
              title="Sous-titres français [T]"
            >
              STFR
            </button>
          )}
          {hasSubtitlesEn && (
            <button
              onClick={() => onSubtitleTrackChange('en')}
              className={`${styles.trackBtn} ${styles.trackBtnAlone} ${subtitleTrack === 'en' ? styles.trackActive : ''}`}
              title="Sous-titres anglais [T]"
            >
              STEN
            </button>
          )}
        </div>

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
