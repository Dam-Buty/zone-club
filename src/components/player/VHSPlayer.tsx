import { useRef, useState, useEffect, useCallback } from 'react';
import { useStore } from '../../store';
import { VHSEffects } from './VHSEffects';
import { VHSControls } from './VHSControls';
import { RentalTimer } from '../ui/RentalTimer';
import api from '../../api';
import type { PlayerState } from '../../types';
import styles from './VHSPlayer.module.css';

export type AudioTrack = 'vf' | 'vo';

// Rewind state machine
type RewindPhase = 'none' | 'prompt' | 'rewinding' | 'complete';

export function VHSPlayer() {
  const { isPlayerOpen, currentPlayingFilm, closePlayer, getRental, films, fetchMe } = useStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playerState, setPlayerState] = useState<PlayerState>('paused');
  const [audioTrack, setAudioTrack] = useState<AudioTrack>('vf');
  const [showSubtitles, setShowSubtitles] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [showBlueScreen, setShowBlueScreen] = useState(false);

  // FF/RW state
  const [ffSpeed, setFfSpeed] = useState(0); // 0=off, 2=x2, 4=x4
  const rwIntervalRef = useRef<number | null>(null);
  const rwSpeedRef = useRef(0);

  // Rewind animation state
  const [rewindPhase, setRewindPhase] = useState<RewindPhase>('none');
  const [rewindProgress, setRewindProgress] = useState(0);
  const rewindStartRef = useRef(0);
  const rewindRafRef = useRef<number | null>(null);

  const rental = currentPlayingFilm ? getRental(currentPlayingFilm) : null;
  const streamingUrls = rental?.streamingUrls;

  // Get film title for display
  const allFilms = Object.values(films).flat();
  const currentFilm = allFilms.find(f => f.id === currentPlayingFilm);

  // Determine available tracks
  const hasVF = !!streamingUrls?.vf;
  const hasVO = !!streamingUrls?.vo;
  const hasSubtitles = !!streamingUrls?.subtitles;

  // Get current video URL based on selected track
  const getVideoUrl = useCallback(() => {
    if (!streamingUrls) return rental?.videoUrl || '';
    if (audioTrack === 'vf' && hasVF) return streamingUrls.vf!;
    if (audioTrack === 'vo' && hasVO) return streamingUrls.vo!;
    return streamingUrls.vf || streamingUrls.vo || rental?.videoUrl || '';
  }, [streamingUrls, audioTrack, hasVF, hasVO, rental?.videoUrl]);

  // Handle audio track change - preserve current time
  const handleAudioTrackChange = useCallback((newTrack: AudioTrack) => {
    const video = videoRef.current;
    if (video) {
      setCurrentTime(video.currentTime);
    }
    setAudioTrack(newTrack);
  }, []);

  // Restore playback position after track change
  useEffect(() => {
    const video = videoRef.current;
    if (video && currentTime > 0) {
      video.currentTime = currentTime;
      if (playerState === 'playing') {
        video.play().catch(() => {});
      }
    }
  }, [audioTrack]);

  // ===== FF/RW Logic =====

  // Stop any active rewind interval
  const stopRW = useCallback(() => {
    if (rwIntervalRef.current !== null) {
      clearInterval(rwIntervalRef.current);
      rwIntervalRef.current = null;
    }
    rwSpeedRef.current = 0;
  }, []);

  // FF cycle: off → x2 → x4 → off
  const handleFFCycle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    // Stop any active rewind first
    stopRW();

    const nextSpeed = ffSpeed === 0 ? 2 : ffSpeed === 2 ? 4 : 0;
    setFfSpeed(nextSpeed);

    if (nextSpeed > 0) {
      video.playbackRate = nextSpeed;
      if (video.paused) video.play();
      setPlayerState('fastforwarding');
      setShowBlueScreen(false);
    } else {
      video.playbackRate = 1;
      setPlayerState(video.paused ? 'paused' : 'playing');
    }
  }, [ffSpeed, stopRW]);

  // RW cycle: off → x2 → x4 → off
  // HTML5 video doesn't support negative playbackRate, so we use an interval
  const handleRWCycle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    // Reset FF
    video.playbackRate = 1;

    const currentRWSpeed = rwSpeedRef.current;
    const nextSpeed = currentRWSpeed === 0 ? 2 : currentRWSpeed === 2 ? 4 : 0;

    // Stop existing interval
    stopRW();

    setFfSpeed(nextSpeed);

    if (nextSpeed > 0) {
      rwSpeedRef.current = nextSpeed;
      video.pause();
      setPlayerState('rewinding');
      setShowBlueScreen(false);

      // Manual rewind via interval (60fps)
      rwIntervalRef.current = window.setInterval(() => {
        const v = videoRef.current;
        if (!v) return;
        v.currentTime = Math.max(0, v.currentTime - rwSpeedRef.current * (1 / 30));
        if (v.currentTime <= 0) {
          stopRW();
          setFfSpeed(0);
          setPlayerState('paused');
        }
      }, 1000 / 30);
    } else {
      setPlayerState(video.paused ? 'paused' : 'playing');
    }
  }, [stopRW]);

  // Stop button: pause + reset to 0 + blue screen
  const handleStop = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    stopRW();
    video.pause();
    video.currentTime = 0;
    video.playbackRate = 1;
    setFfSpeed(0);
    setPlayerState('paused');
    setShowBlueScreen(true);
  }, [stopRW]);

  // Eject: close player
  const handleEject = useCallback(() => {
    stopRW();
    if (rewindRafRef.current !== null) {
      cancelAnimationFrame(rewindRafRef.current);
    }
    closePlayer();
  }, [closePlayer, stopRW]);

  // Clean up intervals on unmount
  useEffect(() => {
    return () => {
      stopRW();
      if (rewindRafRef.current !== null) {
        cancelAnimationFrame(rewindRafRef.current);
      }
    };
  }, [stopRW]);

  // ===== Keyboard Controls (VCR style) =====
  useEffect(() => {
    if (!isPlayerOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          // Reset speed modes
          stopRW();
          video.playbackRate = 1;
          setFfSpeed(0);
          if (video.paused) {
            video.play();
            setPlayerState('playing');
            setShowBlueScreen(false);
          } else {
            video.pause();
            setPlayerState('paused');
          }
          break;
        case 'ArrowRight':
          e.preventDefault();
          handleFFCycle();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handleRWCycle();
          break;
        case 's':
        case 'S':
          handleStop();
          break;
        case 'e':
        case 'E':
          handleEject();
          break;
        case 'f':
        case 'F':
          if (document.fullscreenElement) {
            document.exitFullscreen();
          } else {
            document.documentElement.requestFullscreen();
          }
          break;
        case 'm':
        case 'M':
          video.muted = !video.muted;
          break;
        case 'v':
        case 'V':
          if (hasVF && hasVO) {
            handleAudioTrackChange(audioTrack === 'vf' ? 'vo' : 'vf');
          }
          break;
        case 't':
        case 'T':
          if (hasSubtitles) {
            setShowSubtitles(prev => !prev);
          }
          break;
        case 'Escape':
          handleEject();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlayerOpen, handleEject, handleStop, handleFFCycle, handleRWCycle, hasVF, hasVO, hasSubtitles, audioTrack, handleAudioTrackChange, stopRW]);

  // ===== Watch Progress Reporting (every 30s) =====
  useEffect(() => {
    if (!isPlayerOpen || !currentPlayingFilm) return;

    const interval = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.duration === 0 || video.paused) return;

      const progress = Math.round((video.currentTime / video.duration) * 100);
      api.rentals.updateProgress(currentPlayingFilm, progress).catch(() => {});
    }, 30000);

    return () => clearInterval(interval);
  }, [isPlayerOpen, currentPlayingFilm]);

  // ===== End of Film — Rewind Prompt =====
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleEnded = () => {
      stopRW();
      setFfSpeed(0);
      // Send final progress (100%)
      if (currentPlayingFilm) {
        api.rentals.updateProgress(currentPlayingFilm, 100).catch(() => {});
      }
      setRewindPhase('prompt');
    };

    video.addEventListener('ended', handleEnded);
    return () => video.removeEventListener('ended', handleEnded);
  }, [currentPlayingFilm, stopRW]);

  // ===== Rewind Animation =====
  const startRewind = useCallback(() => {
    setRewindPhase('rewinding');
    setRewindProgress(0);
    rewindStartRef.current = performance.now();

    const video = videoRef.current;
    const filmDuration = video?.duration || 7200;
    // Rewind duration: 2-3 min proportional to film length
    const rewindDurationMs = Math.max(120000, Math.min(180000, filmDuration * 20));

    const animate = () => {
      const elapsed = performance.now() - rewindStartRef.current;
      const progress = Math.min(100, (elapsed / rewindDurationMs) * 100);
      setRewindProgress(progress);

      if (progress >= 100) {
        setRewindPhase('complete');
        // Claim rewind credit
        if (currentPlayingFilm) {
          api.rentals.claimRewind(currentPlayingFilm)
            .then(() => { fetchMe(); })
            .catch(() => {});
        }
        return;
      }

      rewindRafRef.current = requestAnimationFrame(animate);
    };

    rewindRafRef.current = requestAnimationFrame(animate);
  }, [currentPlayingFilm, fetchMe]);

  // Reset state when player closes/opens
  useEffect(() => {
    if (!isPlayerOpen) {
      stopRW();
      setFfSpeed(0);
      setPlayerState('paused');
      setShowBlueScreen(false);
      setRewindPhase('none');
      setRewindProgress(0);
    }
  }, [isPlayerOpen, stopRW]);

  if (!isPlayerOpen || !rental) return null;

  const videoUrl = getVideoUrl();

  return (
    <div className={styles.player}>
      {/* Film title header */}
      {currentFilm && (
        <div className={styles.header}>
          <span className={styles.filmTitle}>{currentFilm.title}</span>
          <span className={styles.trackIndicator}>
            {audioTrack.toUpperCase()}
            {showSubtitles && hasSubtitles && ' + STFR'}
          </span>
        </div>
      )}

      {/* Video element with key to force reload on track change */}
      <video
        key={`${audioTrack}-${videoUrl}`}
        ref={videoRef}
        className={styles.video}
        autoPlay
        onPlay={() => { setPlayerState('playing'); setShowBlueScreen(false); }}
        onPause={() => {
          // Don't override rewinding state
          if (playerState !== 'rewinding') setPlayerState('paused');
        }}
      >
        <source src={videoUrl} type="video/mp4" />
        {showSubtitles && hasSubtitles && streamingUrls?.subtitles && (
          <track
            kind="subtitles"
            src={streamingUrls.subtitles}
            srcLang="fr"
            label="Français"
            default
          />
        )}
      </video>

      <VHSEffects playerState={playerState} />

      {/* Blue screen (stop state) */}
      {showBlueScreen && (
        <div className={styles.blueScreen}>
          <div className={styles.blueScreenText}>NO SIGNAL</div>
        </div>
      )}

      <div className={styles.rentalTimer}>
        <RentalTimer expiresAt={rental.expiresAt} />
      </div>

      {/* ===== Rewind Prompt (film ended) ===== */}
      {rewindPhase === 'prompt' && (
        <div className={styles.rewindOverlay}>
          <div className={styles.rewindPromptText}>
            BE KIND<br />REWIND
          </div>
          <div className={styles.rewindButtons}>
            <button onClick={startRewind} className={styles.rewindBtn}>
              ◀◀ REMBOBINER
            </button>
            <button onClick={handleEject} className={styles.ejectRewindBtn}>
              ⏏ ÉJECTER SANS REMBOBINER
            </button>
          </div>
        </div>
      )}

      {/* ===== Rewind Animation ===== */}
      {rewindPhase === 'rewinding' && (
        <div className={styles.rewindOverlay}>
          <div className={styles.rewindTapeCounter}>
            {String(Math.floor((100 - rewindProgress) * 72)).padStart(4, '0')}
          </div>
          <div className={styles.rewindBarContainer}>
            <div className={styles.rewindBarFill} style={{ width: `${rewindProgress}%` }} />
          </div>
          <div className={styles.rewindLabel}>REMBOBINAGE EN COURS...</div>
        </div>
      )}

      {/* ===== Rewind Complete ===== */}
      {rewindPhase === 'complete' && (
        <div className={styles.rewindOverlay}>
          <div className={styles.rewindCompleteIcon}>✓</div>
          <div className={styles.creditMessage}>MERCI ! +1 CRÉDIT</div>
          <button onClick={handleEject} className={styles.rewindBtn}>
            ⏏ ÉJECTER
          </button>
        </div>
      )}

      {/* VCR Controls — only show when not in rewind sequence */}
      {rewindPhase === 'none' && (
        <VHSControls
          videoRef={videoRef}
          playerState={playerState}
          onStateChange={setPlayerState}
          onClose={closePlayer}
          onStop={handleStop}
          onEject={handleEject}
          ffSpeed={ffSpeed}
          onFFCycle={handleFFCycle}
          onRWCycle={handleRWCycle}
          audioTrack={audioTrack}
          onAudioTrackChange={handleAudioTrackChange}
          showSubtitles={showSubtitles}
          onSubtitlesToggle={() => setShowSubtitles(prev => !prev)}
          hasVF={hasVF}
          hasVO={hasVO}
          hasSubtitles={hasSubtitles}
        />
      )}
    </div>
  );
}
