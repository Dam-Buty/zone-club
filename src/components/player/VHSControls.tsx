import { useState, useEffect, useRef } from 'react';
import type { PlayerState } from '../../types';
import type { AudioTrack } from './VHSPlayer';
import styles from './VHSControls.module.css';

interface VHSControlsProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  playerState: PlayerState;
  onStateChange: (state: PlayerState) => void;
  onClose: () => void;
  // Audio track props
  audioTrack: AudioTrack;
  onAudioTrackChange: (track: AudioTrack) => void;
  showSubtitles: boolean;
  onSubtitlesToggle: () => void;
  hasVF: boolean;
  hasVO: boolean;
  hasSubtitles: boolean;
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

export function VHSControls({
  videoRef,
  playerState,
  onStateChange,
  onClose,
  audioTrack,
  onAudioTrackChange,
  showSubtitles,
  onSubtitlesToggle,
  hasVF,
  hasVO,
  hasSubtitles,
}: VHSControlsProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const progressRef = useRef<HTMLDivElement>(null);

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

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (playerState === 'playing') {
      video.pause();
      onStateChange('paused');
    } else {
      video.play();
      onStateChange('playing');
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    const progress = progressRef.current;
    if (!video || !progress) return;

    const rect = progress.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    video.currentTime = percent * duration;
    onStateChange('seeking');
    setTimeout(() => onStateChange(video.paused ? 'paused' : 'playing'), 300);
  };

  const skip = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(duration, video.currentTime + seconds));
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (video) {
      video.volume = parseFloat(e.target.value);
    }
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className={styles.controls}>
      <div className={styles.progress} ref={progressRef} onClick={handleSeek}>
        <div className={styles.progressFill} style={{ width: `${progress}%` }} />
        <div className={styles.progressHead} style={{ left: `${progress}%` }} />
      </div>

      <div className={styles.buttons}>
        <div className={styles.left}>
          <button onClick={() => skip(-10)} className={styles.btn} title="Reculer 10s">
            <span className={styles.btnIcon}>&#x23EE;</span>
          </button>
          <button
            onClick={() => { onStateChange('rewinding'); skip(-30); }}
            className={styles.btn}
            title="Reculer 30s"
          >
            <span className={styles.btnIcon}>&#x25C0;&#x25C0;</span>
          </button>
          <button onClick={togglePlay} className={`${styles.btn} ${styles.playBtn}`}>
            <span className={styles.btnIcon}>
              {playerState === 'playing' ? '\u23F8' : '\u25B6'}
            </span>
          </button>
          <button
            onClick={() => { onStateChange('fastforwarding'); skip(30); }}
            className={styles.btn}
            title="Avancer 30s"
          >
            <span className={styles.btnIcon}>&#x25B6;&#x25B6;</span>
          </button>
          <button onClick={() => skip(10)} className={styles.btn} title="Avancer 10s">
            <span className={styles.btnIcon}>&#x23ED;</span>
          </button>
        </div>

        <div className={styles.time}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>

        <div className={styles.center}>
          {/* Audio track selector */}
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

          {/* Subtitles toggle */}
          {hasSubtitles && (
            <button
              onClick={onSubtitlesToggle}
              className={`${styles.trackBtn} ${showSubtitles ? styles.trackActive : ''}`}
              title="Sous-titres français [S]"
            >
              STFR
            </button>
          )}
        </div>

        <div className={styles.right}>
          <button onClick={toggleMute} className={styles.btn} title={isMuted ? 'Activer son' : 'Couper son'}>
            <span className={styles.btnIcon}>{isMuted ? '\uD83D\uDD07' : '\uD83D\uDD0A'}</span>
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
          <button onClick={toggleFullscreen} className={styles.btn} title="Plein écran [F]">
            <span className={styles.btnIcon}>&#x26F6;</span>
          </button>
          <button onClick={onClose} className={styles.btn} title="Fermer [ESC]">
            <span className={styles.btnIcon}>&#x2715;</span>
          </button>
        </div>
      </div>
    </div>
  );
}
