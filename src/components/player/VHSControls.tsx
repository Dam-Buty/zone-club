import { useState, useEffect, useCallback } from 'react';
import type { PlayerState } from '../../types';
import type { AudioTrack } from './VHSPlayer';
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
  // Audio track props
  audioTrack: AudioTrack;
  onAudioTrackChange: (track: AudioTrack) => void;
  showSubtitles: boolean;
  onSubtitlesToggle: () => void;
  hasVF: boolean;
  hasVO: boolean;
  hasSubtitles: boolean;
  onCast: () => void;
  onAirPlay: () => void;
  onMirroringHelp: () => void;
  isCastReady: boolean;
  hasCastDevices: boolean;
  isCastConnected: boolean;
  isCastConnecting: boolean;
  isAirPlaySupported: boolean;
  isAirPlayAvailable: boolean;
  isAirPlayConnected: boolean;
  remoteError: string | null;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// VHS tape counter style (0000–9999)
function formatTapeCounter(currentTime: number, duration: number): string {
  if (duration <= 0) return '0000';
  const ratio = currentTime / duration;
  return String(Math.floor(ratio * 9999)).padStart(4, '0');
}

export function VHSControls({
  videoRef,
  playerState,
  onStateChange,
  onStop,
  onEject,
  ffSpeed,
  onFFCycle,
  onRWCycle,
  audioTrack,
  onAudioTrackChange,
  showSubtitles,
  onSubtitlesToggle,
  hasVF,
  hasVO,
  hasSubtitles,
  onCast,
  onAirPlay,
  onMirroringHelp,
  isCastReady,
  hasCastDevices,
  isCastConnected,
  isCastConnecting,
  isAirPlaySupported,
  isAirPlayAvailable,
  isAirPlayConnected,
  remoteError,
}: VHSControlsProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
    const handleDurationChange = () => setDuration(video.duration);
    const handleVolumeChange = () => {
      setVolume(video.volume);
      setIsMuted(video.muted);
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('durationchange', handleDurationChange);
    video.addEventListener('volumechange', handleVolumeChange);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('durationchange', handleDurationChange);
      video.removeEventListener('volumechange', handleVolumeChange);
    };
  }, [videoRef]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    // Reset playback rate when pressing play
    video.playbackRate = 1;

    if (playerState === 'playing') {
      video.pause();
      onStateChange('paused');
    } else {
      video.play();
      onStateChange('playing');
    }
  }, [videoRef, playerState, onStateChange]);

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
      {/* VCR transport buttons — inspired by Toshiba W602 layout */}
      <div className={styles.vcrPanel}>
        {/* Left: brand + tape counter */}
        <div className={styles.vcrLeft}>
          <div className={styles.tapeCounter}>
            <span className={styles.tapeCounterLabel}>COUNTER</span>
            <span className={styles.tapeCounterValue}>{formatTapeCounter(currentTime, duration)}</span>
          </div>
          <div className={styles.timeDisplay}>
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>
        </div>

        {/* Center: VCR transport buttons */}
        <div className={styles.vcrTransport}>
          <button onClick={onRWCycle} className={`${styles.vcrBtn} ${playerState === 'rewinding' ? styles.vcrBtnActive : ''}`} title="Rembobiner [←]">
            <span className={styles.vcrIcon}>◀◀</span>
            <span className={styles.vcrLabel}>REW</span>
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
            <span className={styles.vcrIcon}>■</span>
            <span className={styles.vcrLabel}>STOP</span>
          </button>
          <button onClick={onEject} className={`${styles.vcrBtn} ${styles.vcrEjectBtn}`} title="Éjecter [E / ESC]">
            <span className={styles.vcrIcon}>⏏</span>
            <span className={styles.vcrLabel}>EJECT</span>
          </button>
        </div>

        {/* Right: state + volume + options */}
        <div className={styles.vcrRight}>
          {/* State indicator */}
          {stateLabel && (
            <div className={`${styles.stateIndicator} ${(playerState === 'fastforwarding' || playerState === 'rewinding') ? styles.stateFF : ''}`}>
              {stateLabel}
            </div>
          )}

          {/* Track selector */}
          <div className={styles.trackControls}>
            {(hasVF || hasVO) && (
              <div className={styles.trackSelector}>
                <button
                  onClick={() => onAudioTrackChange('vf')}
                  className={`${styles.trackBtn} ${audioTrack === 'vf' ? styles.trackActive : ''}`}
                  disabled={!hasVF}
                  title="Version Française [V]"
                >
                  VF
                </button>
                <button
                  onClick={() => onAudioTrackChange('vo')}
                  className={`${styles.trackBtn} ${audioTrack === 'vo' ? styles.trackActive : ''}`}
                  disabled={!hasVO}
                  title="Version Originale [V]"
                >
                  VO
                </button>
              </div>
            )}
            {hasSubtitles && (
              <button
                onClick={onSubtitlesToggle}
                className={`${styles.trackBtn} ${showSubtitles ? styles.trackActive : ''}`}
                title="Sous-titres français [T]"
              >
                STFR
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
          </div>

          <button onClick={toggleFullscreen} className={styles.vcrSmallBtn} title="Plein écran [F]">
            ⛶
          </button>

          <div className={styles.remoteControls}>
            <button
              onClick={onCast}
              className={`${styles.remoteBtn} ${isCastConnected ? styles.remoteBtnActive : ''}`}
              title={isCastConnected ? 'Casting actif' : isCastReady ? 'Google Cast' : 'Google Cast indisponible'}
            >
              {isCastConnected ? 'CAST ON' : isCastConnecting ? 'CAST…' : hasCastDevices ? 'CAST' : 'CAST ?'}
            </button>
            <button
              onClick={onAirPlay}
              className={`${styles.remoteBtn} ${isAirPlayConnected ? styles.remoteBtnActive : ''}`}
              title={isAirPlayConnected ? 'AirPlay actif' : isAirPlaySupported ? 'AirPlay' : 'AirPlay indisponible'}
            >
              {isAirPlayConnected ? 'AIRPLAY ON' : isAirPlayAvailable ? 'AIRPLAY' : 'AIRPLAY ?'}
            </button>
            <button onClick={onMirroringHelp} className={styles.remoteBtn} title="Mode miroir (fallback)">
              MIROIR
            </button>
          </div>
        </div>
      </div>
      {remoteError && <div className={styles.remoteError}>{remoteError}</div>}
    </div>
  );
}
