import { useRef, useState, useEffect, useCallback } from 'react';
import { useStore } from '../../store';
import { VHSEffects } from './VHSEffects';
import { VHSControls } from './VHSControls';
import { RentalTimer } from '../ui/RentalTimer';
import api, { type ReviewsResponse } from '../../api';
import type { PlayerState } from '../../types';
import { useGoogleCast, preloadCastSdk } from '../../hooks/useGoogleCast';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useBackGuard } from '../../hooks/useBackGuard';
import styles from './VHSPlayer.module.css';

const MIN_CONTENT_LENGTH = 500;

function formatCastTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export type AudioTrack = 'vf' | 'vo';

// Rewind state machine
type RewindPhase = 'none' | 'prompt' | 'rewinding';

type AirPlayVideoElement = HTMLVideoElement & {
  webkitShowPlaybackTargetPicker?: () => void;
  webkitCurrentPlaybackTargetIsWireless?: boolean;
};

export function VHSPlayer() {
  const isPlayerOpen = useStore(state => state.isPlayerOpen);
  const currentPlayingFilm = useStore(state => state.currentPlayingFilm);
  const closePlayer = useStore(state => state.closePlayer);
  useBackGuard(isPlayerOpen, closePlayer);
  const getRental = useStore(state => state.getRental);
  const films = useStore(state => state.films);
  const fetchMe = useStore(state => state.fetchMe);
  const updateRentalProgress = useStore(state => state.updateRentalProgress);
  const isAuthenticated = useStore(state => state.isAuthenticated);
  const addCredits = useStore(state => state.addCredits);
  const setActiveCastFilmId = useStore(state => state.setActiveCastFilmId);
  const activeCastFilmId = useStore(state => state.activeCastFilmId);
  const endCast = useStore(state => state.endCast);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playerState, setPlayerState] = useState<PlayerState>('paused');
  const [audioTrack, setAudioTrack] = useState<AudioTrack>('vf');
  const [showSubtitles, setShowSubtitles] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [showBlueScreen, setShowBlueScreen] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [showMirroringHelp, setShowMirroringHelp] = useState(false);
  const [mirroringContext, setMirroringContext] = useState<'generic' | 'cast' | 'airplay'>('generic');
  const [isAirPlaySupported, setIsAirPlaySupported] = useState(false);
  const [isAirPlayAvailable, setIsAirPlayAvailable] = useState(false);
  const [isAirPlayConnected, setIsAirPlayConnected] = useState(false);
  const [showMobileRemotePrompt, setShowMobileRemotePrompt] = useState(false);

  // Push notification state
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushPromptDismissed, setPushPromptDismissed] = useState(false);

  // Overlay auto-hide (4s inactivity)
  const [overlayVisible, setOverlayVisible] = useState(true);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // FF/RW state
  const [ffSpeed, setFfSpeed] = useState(0); // 0=off, 2=x2, 4=x4
  const rwIntervalRef = useRef<number | null>(null);
  const rwSpeedRef = useRef(0);
  const rwCleanupRef = useRef<(() => void) | null>(null);
  // Guard flag to prevent onPause/onPlay handlers from interfering during FF/RW→play transition
  const isTransitioningRef = useRef(false);

  // Rewind animation state (end-of-film rewind)
  const [rewindPhase, setRewindPhase] = useState<RewindPhase>('none');
  const [rewindProgress, setRewindProgress] = useState(0);
  const rewindStartRef = useRef(0);
  const rewindRafRef = useRef<number | null>(null);
  const [pendingEject, setPendingEject] = useState(false);
  const [rewindCredited, setRewindCredited] = useState(false);

  // Rewind-to-start state (⏮ button)
  const [rewindingToStart, setRewindingToStart] = useState(false);
  const [rewindToStartProgress, setRewindToStartProgress] = useState(0);
  const [rewindToStartCounter, setRewindToStartCounter] = useState(0);
  const rewindToStartRafRef = useRef<number | null>(null);

  // Inline review state (during rewind)
  const [reviewContent, setReviewContentState] = useState('');
  const reviewContentRef = useRef('');
  const setReviewContent = useCallback((v: string) => {
    reviewContentRef.current = v;
    setReviewContentState(v);
  }, []);
  const [ratingDirection, setRatingDirection] = useState(3);
  const [ratingScreenplay, setRatingScreenplay] = useState(3);
  const [ratingActing, setRatingActing] = useState(3);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewSuccess, setReviewSuccess] = useState(false);
  const [reviewData, setReviewData] = useState<ReviewsResponse | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);

  const {
    isReady: isCastReady,
    castState,
    hasDevices: hasCastDevices,
    isConnected: isCastConnected,
    connectedDeviceName: castDeviceName,
    castMedia,
    remoteCurrentTime: remoteCastTime,
    remoteDuration: remoteCastDuration,
    remoteIsPaused: remoteCastPaused,
    remotePlayerState: remoteCastPlayerState,
    remoteIsMediaLoaded: remoteCastMediaLoaded,
    remotePlayOrPause,
    remoteStop,
    remoteSeek,
    remoteSetVolume,
    getRemoteCurrentTime,
  } = useGoogleCast({
    enabled: isPlayerOpen,
    receiverApplicationId: process.env.NEXT_PUBLIC_GOOGLE_CAST_APP_ID,
  });

  // Track film info for cast session
  const castFilmIdRef = useRef<number | null>(null);
  const castDurationRef = useRef(0);
  // Preserve last known remote position (SDK resets to 0 on disconnect before we can read it)
  const lastKnownCastTimeRef = useRef(0);
  if (remoteCastTime > 0) lastKnownCastTimeRef.current = remoteCastTime;
  const isMobile = useIsMobile();

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

  // Check if 80%+ of the film has been watched (local or remote)
  const hasReachedMilestone = useCallback(() => {
    if (playerState === 'casting') {
      if (!remoteCastDuration || remoteCastDuration <= 0) return false;
      return getRemoteCurrentTime() / remoteCastDuration >= 0.8;
    }
    const video = videoRef.current;
    if (!video || !video.duration) return false;
    return video.currentTime / video.duration >= 0.8;
  }, [playerState, remoteCastDuration, getRemoteCurrentTime]);

  const openMirroringFallback = useCallback((context: 'generic' | 'cast' | 'airplay' = 'generic') => {
    setMirroringContext(context);
    setShowMirroringHelp(true);
  }, []);

  const videoUrl = getVideoUrl();

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

  // Multi-device sync: refresh rental data on player open so seek picks up
  // progress made elsewhere (other browser/device, or background cast).
  // Non-blocking: local seek effect below uses current store value immediately;
  // when fetchMe resolves with a newer watchPosition, that effect re-runs.
  useEffect(() => {
    if (!isPlayerOpen) return;
    fetchMe();
  }, [isPlayerOpen, fetchMe]);

  // Resume from saved position when player opens
  useEffect(() => {
    if (!isPlayerOpen || !rental?.watchPosition) return;
    const video = videoRef.current;
    if (!video) return;

    const handleCanPlay = () => {
      if (rental.watchPosition > 0 && video.currentTime < 1) {
        video.currentTime = rental.watchPosition;
      }
    };

    video.addEventListener('canplay', handleCanPlay, { once: true });
    return () => video.removeEventListener('canplay', handleCanPlay);
  }, [isPlayerOpen, rental?.watchPosition]);

  // ===== Auto-detect existing cast session on player open =====
  //
  // Two paths into casting mode:
  //   1) SDK confirms an active receiver session (isCastConnected &&
  //      remoteCastMediaLoaded) → go straight to 'casting'.
  //   2) Store-side `activeCastFilmId` matches the film just opened, but
  //      the SDK hasn't republished its events yet (typical of close +
  //      reopen — the cast is live on the TV but the SDK takes a moment
  //      to fire CAST_STATE_CHANGED). Show 'awaitingCast' meanwhile. The
  //      SDK-confirmation effect below will promote to 'casting' once
  //      events catch up; the timeout effect below will give up after 6s.
  useEffect(() => {
    if (!isPlayerOpen) return;
    if (playerState === 'casting' || playerState === 'awaitingCast') return;

    const sdkSeesCast = isCastConnected && remoteCastMediaLoaded;
    const storeKnowsCast =
      activeCastFilmId !== null && activeCastFilmId === currentPlayingFilm;

    if (sdkSeesCast) {
      const video = videoRef.current;
      if (video && !video.paused) video.pause();
      setPlayerState('casting');
      if (!storeKnowsCast) setActiveCastFilmId(currentPlayingFilm);
      castFilmIdRef.current = currentPlayingFilm ?? null;
      castDurationRef.current = remoteCastDuration || video?.duration || 0;
      if (currentPlayingFilm) {
        api.castSessions
          .create(currentPlayingFilm, castDurationRef.current, getRemoteCurrentTime())
          .catch(() => {});
      }
      return;
    }

    if (storeKnowsCast) {
      const video = videoRef.current;
      if (video && !video.paused) video.pause();
      setPlayerState('awaitingCast');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally triggers only on reconnect signals
  }, [isPlayerOpen, isCastConnected, remoteCastMediaLoaded, activeCastFilmId, currentPlayingFilm]);

  // ===== Awaiting-cast safety timeout =====
  // If we entered 'awaitingCast' on reopen but the SDK never confirms the
  // session (TV powered off mid-cast, network change, etc.) we don't want
  // to leave the user staring at "Connexion à la TV…" forever. After 6s
  // without confirmation, drop the cast tracking and let the user retry.
  useEffect(() => {
    if (playerState !== 'awaitingCast') return;
    const timer = setTimeout(() => {
      // Re-check freshest state inside timer; the cast may have just
      // confirmed and we'd otherwise wipe a valid casting state.
      const stillAwaiting = playerState === 'awaitingCast';
      const sdkConfirmed = isCastConnected && remoteCastMediaLoaded;
      if (stillAwaiting && !sdkConfirmed) {
        endCast();
        setPlayerState('paused');
      }
    }, 6000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally tied to awaitingCast entry only
  }, [playerState]);

  // ===== FF/RW Logic =====

  // Stop any active rewind RAF loop + clean up seeked listener
  const stopRW = useCallback(() => {
    if (rwIntervalRef.current !== null) {
      cancelAnimationFrame(rwIntervalRef.current);
      rwIntervalRef.current = null;
    }
    rwCleanupRef.current?.();
    rwCleanupRef.current = null;
    rwSpeedRef.current = 0;
  }, []);

  // Resume play after RW/FF — pause first for clean decoder state
  const resumePlayFromRW = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    // Set transition flag to suppress onPause/onPlay event handlers
    isTransitioningRef.current = true;

    stopRW();
    video.pause(); // Pause first — needed for FF where video is still playing at high speed
    video.playbackRate = 1;
    setFfSpeed(0);
    setShowBlueScreen(false);

    // Force seek to nearest keyframe, then wait for decoder
    const pos = video.currentTime;
    video.currentTime = pos;

    const resume = () => {
      video.play().then(() => {
        isTransitioningRef.current = false;
        setPlayerState('playing');
      }).catch(() => {
        isTransitioningRef.current = false;
        setPlayerState('paused');
      });
    };

    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      resume();
    };
    video.addEventListener('seeked', onSeeked, { once: true });

    // Unconditional fallback if seeked never fires (already at exact position)
    setTimeout(() => {
      video.removeEventListener('seeked', onSeeked);
      if (isTransitioningRef.current) {
        resume();
      }
    }, 500);
  }, [stopRW]);

  // FF cycle: off → x2 → x4 → off
  const handleFFCycle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    // Stop any active rewind first
    stopRW();

    const nextSpeed = ffSpeed === 0 ? 2 : ffSpeed === 2 ? 4 : 0;

    if (nextSpeed > 0) {
      setFfSpeed(nextSpeed);
      video.playbackRate = nextSpeed;
      if (video.paused) video.play();
      setPlayerState('fastforwarding');
      setShowBlueScreen(false);
    } else {
      // Returning to normal — use proper resync
      resumePlayFromRW();
    }
  }, [ffSpeed, stopRW, resumePlayFromRW]);

  // RW cycle: off → x2 → x4 → off
  // Seek-chained reverse: seek → wait for seeked → seek again (as fast as decoder allows)
  const handleRWCycle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    // Reset FF
    video.playbackRate = 1;

    const currentRWSpeed = rwSpeedRef.current;
    const nextSpeed = currentRWSpeed === 0 ? 2 : currentRWSpeed === 2 ? 4 : 0;

    // Stop existing loop
    stopRW();

    setFfSpeed(nextSpeed);

    if (nextSpeed > 0) {
      rwSpeedRef.current = nextSpeed;
      video.pause();
      setPlayerState('rewinding');
      setShowBlueScreen(false);

      let lastSeekTs = performance.now();

      const seekNext = () => {
        const v = videoRef.current;
        if (!v || rwSpeedRef.current === 0) return;

        const now = performance.now();
        const elapsed = (now - lastSeekTs) / 1000;
        const step = rwSpeedRef.current * Math.max(elapsed, 0.1);
        const newTime = Math.max(0, v.currentTime - step);
        lastSeekTs = now;

        if (newTime <= 0) {
          v.currentTime = 0;
          stopRW();
          setFfSpeed(0);
          setPlayerState('paused');
          return;
        }

        v.currentTime = newTime;
        // seeked event will chain the next seek
      };

      const onSeeked = () => {
        if (rwSpeedRef.current === 0) return;
        rwIntervalRef.current = requestAnimationFrame(seekNext);
      };

      video.addEventListener('seeked', onSeeked);
      rwCleanupRef.current = () => video.removeEventListener('seeked', onSeeked);

      // Kick off first seek
      rwIntervalRef.current = requestAnimationFrame(seekNext);
    } else {
      resumePlayFromRW();
    }
  }, [stopRW, resumePlayFromRW]);

  // Stop button: save position + pause + blue screen (or rewind prompt at 80%+)
  const handleStop = useCallback(() => {
    // Casting mode: stop remote, save position, show rewind or blue screen
    if (playerState === 'casting') {
      const remoteTime = getRemoteCurrentTime();
      if (currentPlayingFilm && remoteCastDuration > 0) {
        const progress = Math.round((remoteTime / remoteCastDuration) * 100);
        updateRentalProgress(currentPlayingFilm, progress, remoteTime).catch(() => {});
      }
      remoteStop();
      setActiveCastFilmId(null);
      if (currentPlayingFilm) {
        api.castSessions.end(currentPlayingFilm).catch(() => {});
      }
      if (hasReachedMilestone() && !rental?.rewindClaimed) {
        setPendingEject(false);
        setRewindPhase('prompt');
      } else {
        setPlayerState('paused');
        setShowBlueScreen(true);
      }
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    // Save current position before stopping
    if (currentPlayingFilm && video.duration > 0) {
      const progress = Math.round((video.currentTime / video.duration) * 100);
      updateRentalProgress(currentPlayingFilm, progress, video.currentTime).catch(() => {});
    }

    stopRW();
    video.pause();
    video.playbackRate = 1;
    setFfSpeed(0);

    // At 80%+ and not yet rewound → rewind prompt
    if (hasReachedMilestone() && !rental?.rewindClaimed) {
      setPendingEject(false);
      setRewindPhase('prompt');
    } else {
      setPlayerState('paused');
      setShowBlueScreen(true);
    }
  }, [stopRW, currentPlayingFilm, hasReachedMilestone, rental?.rewindClaimed, playerState, getRemoteCurrentTime, remoteCastDuration, remoteStop, setActiveCastFilmId]);

  // Rewind to start (⏮) — simulates VHS tape rewind with proportional duration
  const handleRewindToStart = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.currentTime < 1 || rewindingToStart) return;

    stopRW();
    video.pause();
    video.playbackRate = 1;
    setFfSpeed(0);
    setPlayerState('rewinding');
    setShowBlueScreen(false);
    setRewindingToStart(true);

    const startTime = video.currentTime;
    const startCounter = Math.floor((startTime / (video.duration || 1)) * 9999);
    // Proportional: 2 min (120s) for full film, minimum 1s
    const rewindDurationMs = Math.max(1000, (startTime / (video.duration || 1)) * 120000);
    const animStart = performance.now();

    const animate = () => {
      const elapsed = performance.now() - animStart;
      const t = Math.min(1, elapsed / rewindDurationMs);
      const remaining = startTime * (1 - t);
      video.currentTime = remaining;
      setRewindToStartProgress(t * 100);
      setRewindToStartCounter(Math.floor(startCounter * (1 - t)));

      if (t >= 1) {
        video.currentTime = 0;
        setRewindingToStart(false);
        setRewindToStartProgress(0);
        setRewindToStartCounter(0);
        setPlayerState('paused');
        return;
      }
      rewindToStartRafRef.current = requestAnimationFrame(animate);
    };

    rewindToStartRafRef.current = requestAnimationFrame(animate);
  }, [rewindingToStart, stopRW]);

  // Mobile ghost-click guard: when openPlayer fires from a touchstart on the
  // seated TV menu (OK button), the synthesized click event arrives ~50-100ms
  // later — by which time VHSPlayer has mounted and its eject button is at the
  // same screen coordinate. That click then fires handleEject which closes the
  // player immediately. We block eject for the first 500ms after mount to
  // swallow the ghost click without blocking legitimate user-initiated ejects.
  const mountedAtRef = useRef(performance.now());
  useEffect(() => {
    if (isPlayerOpen) mountedAtRef.current = performance.now();
  }, [isPlayerOpen]);

  // Eject: save position + close player (or rewind prompt at 80%+)
  const handleEject = useCallback(() => {
    if (performance.now() - mountedAtRef.current < 500) {
      // Likely a ghost click from the touchstart that opened the player.
      return;
    }
    // Casting mode: save remote position, stop cast
    if (playerState === 'casting') {
      const remoteTime = getRemoteCurrentTime();
      if (currentPlayingFilm && remoteCastDuration > 0) {
        const progress = Math.round((remoteTime / remoteCastDuration) * 100);
        updateRentalProgress(currentPlayingFilm, progress, remoteTime).catch(() => {});
      }
      remoteStop();
      if (hasReachedMilestone() && !rental?.rewindClaimed) {
        setPendingEject(true);
        setRewindPhase('prompt');
      } else {
        closePlayer();
      }
      return;
    }

    const video = videoRef.current;
    if (video && currentPlayingFilm && video.duration > 0) {
      const progress = Math.round((video.currentTime / video.duration) * 100);
      updateRentalProgress(currentPlayingFilm, progress, video.currentTime).catch(() => {});
    }
    stopRW();

    // At 80%+ and not yet rewound → rewind prompt before ejecting
    if (hasReachedMilestone() && !rental?.rewindClaimed) {
      const v = videoRef.current;
      if (v) v.pause();
      setPendingEject(true);
      setRewindPhase('prompt');
    } else {
      if (rewindRafRef.current !== null) {
        cancelAnimationFrame(rewindRafRef.current);
      }
      if (rewindToStartRafRef.current !== null) {
        cancelAnimationFrame(rewindToStartRafRef.current);
      }
      setRewindingToStart(false);
      closePlayer();
    }
  }, [closePlayer, stopRW, currentPlayingFilm, hasReachedMilestone, rental?.rewindClaimed, playerState, getRemoteCurrentTime, remoteCastDuration, remoteStop]);

  // Clean up intervals on unmount
  useEffect(() => {
    return () => {
      stopRW();
      if (rewindRafRef.current !== null) {
        cancelAnimationFrame(rewindRafRef.current);
      }
      if (rewindToStartRafRef.current !== null) {
        cancelAnimationFrame(rewindToStartRafRef.current);
      }
    };
  }, [stopRW]);

  // Dismiss rewind prompt without rewinding (STOP flow → blue screen)
  const dismissRewindPrompt = useCallback(() => {
    setRewindPhase('none');
    setPlayerState('paused');
    setShowBlueScreen(true);
  }, []);

  // Close rewind modal (during or after rewind)
  const closeRewindModal = useCallback(() => {
    if (rewindRafRef.current !== null) {
      cancelAnimationFrame(rewindRafRef.current);
      rewindRafRef.current = null;
    }
    setRewindPhase('none');
    setRewindProgress(0);
    setRewindCredited(false);
    if (pendingEject) {
      closePlayer();
    } else {
      setPlayerState('paused');
      setShowBlueScreen(true);
    }
  }, [pendingEject, closePlayer]);

  // ===== Keyboard Controls (VCR style) =====
  useEffect(() => {
    if (!isPlayerOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;

      // Block most keys during rewind-to-start or rewind flow (only Escape allowed)
      if (rewindingToStart) {
        if (e.key === 'Escape') handleEject();
        return;
      }
      if (rewindPhase !== 'none') {
        if (e.key === 'Escape') {
          if (rewindPhase === 'prompt') {
            if (pendingEject) {
              closePlayer();
            } else {
              setRewindPhase('none');
              setPlayerState('paused');
              setShowBlueScreen(true);
            }
          } else if (rewindPhase === 'rewinding') {
            closeRewindModal();
          }
        }
        return;
      }

      const video = videoRef.current;
      if (!video) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (playerState === 'casting') {
            remotePlayOrPause();
          } else if (playerState === 'rewinding' || playerState === 'fastforwarding') {
            resumePlayFromRW();
          } else if (video.paused) {
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
        case 'F': {
          const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
          const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
          if (document.fullscreenElement || doc.webkitFullscreenElement) {
            (document.exitFullscreen || doc.webkitExitFullscreen)?.call(document);
          } else {
            (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
          }
          break;
        }
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
        case 'r':
        case 'R':
          handleRewindToStart();
          break;
        case 'Escape':
          handleEject();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlayerOpen, playerState, rewindingToStart, rewindPhase, pendingEject, closePlayer, closeRewindModal, handleEject, handleStop, handleFFCycle, handleRWCycle, handleRewindToStart, resumePlayFromRW, hasVF, hasVO, hasSubtitles, audioTrack, handleAudioTrackChange, stopRW, remotePlayOrPause]);

  // ===== Remote playback (AirPlay) =====
  useEffect(() => {
    if (!isPlayerOpen) return;

    const video = videoRef.current as AirPlayVideoElement | null;
    if (!video) return;

    video.setAttribute('x-webkit-airplay', 'allow');
    video.setAttribute('airplay', 'allow');
    (video as HTMLVideoElement & { disableRemotePlayback?: boolean }).disableRemotePlayback = false;

    const supportsAirPlay = typeof video.webkitShowPlaybackTargetPicker === 'function';
    setIsAirPlaySupported(supportsAirPlay);
    setIsAirPlayAvailable(supportsAirPlay);
    setIsAirPlayConnected(Boolean(video.webkitCurrentPlaybackTargetIsWireless));

    const handleAvailability = (event: Event) => {
      const availability = (event as Event & { availability?: string }).availability;
      setIsAirPlayAvailable(availability === 'available');
    };

    const handleWirelessChange = () => {
      setIsAirPlayConnected(Boolean(video.webkitCurrentPlaybackTargetIsWireless));
    };

    video.addEventListener('webkitplaybacktargetavailabilitychanged', handleAvailability as EventListener);
    video.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', handleWirelessChange as EventListener);

    return () => {
      video.removeEventListener('webkitplaybacktargetavailabilitychanged', handleAvailability as EventListener);
      video.removeEventListener('webkitcurrentplaybacktargetiswirelesschanged', handleWirelessChange as EventListener);
    };
  }, [isPlayerOpen, videoUrl]);

  const handleCastCurrentVideo = useCallback(async () => {
    setRemoteError(null);

    if (!videoUrl) {
      setRemoteError('Aucune source vidéo disponible pour Google Cast.');
      return;
    }

    // Pause local video immediately AND enter the awaiting state so the
    // UI swaps from "playing locally" to "connecting to TV…" before the
    // SDK device picker even opens. Without this transition the user
    // sees a paused phone player with no indication that something is
    // happening — which is what produced the "the cast didn't work,
    // film still plays on phone" report.
    const video = videoRef.current;
    const wasPlaying = Boolean(video && !video.paused);
    if (video && wasPlaying) video.pause();
    setPlayerState('awaitingCast');

    // Force-resolve the SDK. Idempotent — instant if already loaded (the
    // preloadCastSdk() call on couch-sit warms the cache, see InteriorScene).
    const sdkReady = await preloadCastSdk();
    if (!sdkReady) {
      setRemoteError('Google Cast indisponible sur ce navigateur.');
      openMirroringFallback('cast');
      setPlayerState(wasPlaying ? 'playing' : 'paused');
      if (video && wasPlaying) void video.play().catch(() => {});
      return;
    }

    // Fallback to rental.watchPosition if local video hasn't seeked yet (canplay
    // race when user clicks Cast before <video> reaches its resume position).
    const startTime = Math.max(video?.currentTime || 0, rental?.watchPosition || 0);
    const result = await castMedia({
      url: videoUrl,
      title: currentFilm?.title || 'Zone Club',
      currentTime: startTime,
      autoplay: true,
    });

    if (!result.ok) {
      setRemoteError(result.error || 'Impossible de lancer Google Cast.');
      openMirroringFallback('cast');
      setPlayerState(wasPlaying ? 'playing' : 'paused');
      if (video && wasPlaying) void video.play().catch(() => {});
      return;
    }

    // Cast confirmed — switch to casting mode. Local already paused above
    // (and autoplay is gated by playerState below in the <video> element).
    setPlayerState('casting');
    setActiveCastFilmId(currentPlayingFilm);
    castFilmIdRef.current = currentPlayingFilm ?? null;
    castDurationRef.current = video?.duration || 0;
    if (currentPlayingFilm) {
      api.castSessions.create(currentPlayingFilm, video?.duration || 0, startTime).catch(() => {});
      if (video && video.duration > 0) {
        const progress = Math.round((startTime / video.duration) * 100);
        updateRentalProgress(currentPlayingFilm, progress, startTime).catch(() => {});
      }
    }
  }, [videoUrl, castMedia, currentFilm?.title, openMirroringFallback, currentPlayingFilm, setActiveCastFilmId, rental?.watchPosition, updateRentalProgress]);

  // Switch playback back to the phone without terminating the receiver
  // session via the user-facing Stop flow (which triggers the eject + rewind
  // prompt). Saves the current cast position, seeks the local <video> to it,
  // calls remoteStop (which the SDK uses to free the receiver) and lets the
  // disconnect useEffect resume local playback.
  const handleSwitchToPhone = useCallback(() => {
    const remoteTime = getRemoteCurrentTime();
    if (currentPlayingFilm && remoteCastDuration > 0) {
      const progress = Math.round((remoteTime / remoteCastDuration) * 100);
      updateRentalProgress(currentPlayingFilm, progress, remoteTime).catch(() => {});
      api.castSessions.end(currentPlayingFilm).catch(() => {});
    }
    // Seed lastKnownCastTimeRef so the disconnect resume logic picks up
    // the right position even if the SDK has already started resetting state.
    if (remoteTime > 0) lastKnownCastTimeRef.current = remoteTime;
    remoteStop();
    endCast();
  }, [getRemoteCurrentTime, currentPlayingFilm, remoteCastDuration, remoteStop, endCast, updateRentalProgress]);

  const handleAirPlayPicker = useCallback(() => {
    setRemoteError(null);

    const video = videoRef.current as AirPlayVideoElement | null;
    if (!video || typeof video.webkitShowPlaybackTargetPicker !== 'function') {
      setRemoteError('AirPlay indisponible sur ce navigateur.');
      openMirroringFallback('airplay');
      return;
    }

    if (!isAirPlayAvailable && !isAirPlayConnected) {
      setRemoteError('Aucun appareil AirPlay détecté sur le même réseau.');
      openMirroringFallback('airplay');
      return;
    }

    video.webkitShowPlaybackTargetPicker();
  }, [isAirPlayAvailable, isAirPlayConnected, openMirroringFallback]);

  const handleWatchOnTVFromPrompt = useCallback(() => {
    setShowMobileRemotePrompt(false);

    // Apple devices: Cast SDK is blocked by Apple — go straight to AirPlay.
    const isApple = typeof navigator !== 'undefined' && /(iPad|iPhone|iPod|Macintosh)/.test(navigator.userAgent);
    if (isApple && isAirPlaySupported) {
      handleAirPlayPicker();
      return;
    }

    // Everywhere else: try Cast. handleCastCurrentVideo handles SDK loading
    // (awaits preloadCastSdk), pauses local immediately, resumes local on
    // failure, and falls back to the mirroring help if the SDK can't load.
    // We no longer gate on isCastReady/hasCastDevices because those state
    // flags lag the actual SDK readiness — letting requestSession() decide
    // is more robust to race conditions.
    void handleCastCurrentVideo();
  }, [isAirPlaySupported, handleCastCurrentVideo, handleAirPlayPicker]);

  // Push notification subscription handler
  const handleEnablePushNotifications = useCallback(async () => {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;

      const reg = await navigator.serviceWorker.ready;
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) return;

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKey,
      });

      await api.pushSubscribe.subscribe(subscription.toJSON() as PushSubscriptionJSON);
      setPushSubscribed(true);
    } catch {
      // Permission denied or push not supported
    }
  }, []);

  // Mobile prompt when player opens
  useEffect(() => {
    if (isPlayerOpen && isMobile) {
      setShowMobileRemotePrompt(true);
      return;
    }
    setShowMobileRemotePrompt(false);
  }, [isPlayerOpen, isMobile]);

  // ===== Watch Progress Reporting (every 30s) =====
  useEffect(() => {
    if (!isPlayerOpen || !currentPlayingFilm) return;

    const interval = setInterval(() => {
      // Casting mode: report remote position
      if (playerState === 'casting' && remoteCastMediaLoaded && remoteCastDuration > 0) {
        const remoteTime = getRemoteCurrentTime();
        const progress = Math.round((remoteTime / remoteCastDuration) * 100);
        updateRentalProgress(currentPlayingFilm, progress, remoteTime).catch(() => {});
        api.castSessions.updatePosition(currentPlayingFilm, remoteTime).catch(() => {});
        return;
      }

      // Local mode
      const video = videoRef.current;
      if (!video || video.duration === 0 || video.paused) return;

      const progress = Math.round((video.currentTime / video.duration) * 100);
      updateRentalProgress(currentPlayingFilm, progress, video.currentTime).catch(() => {});

    }, 10000);

    return () => clearInterval(interval);
  }, [isPlayerOpen, currentPlayingFilm, playerState, remoteCastMediaLoaded, remoteCastDuration, getRemoteCurrentTime]);

  // ===== Flush position on player close =====
  //
  // The 10s save loop above can miss the final position if the user closes
  // the player mid-interval — especially in the local-paused → cast → close
  // flow, where the pause skips the local save branch entirely. This ref
  // captures the latest snapshot-saver closure on every render, and the
  // useEffect cleanup invokes it when isPlayerOpen flips false (or the
  // component unmounts), guaranteeing one final write to rental.watchPosition.
  const flushPositionRef = useRef<(() => void) | null>(null);
  flushPositionRef.current = () => {
    if (!currentPlayingFilm) return;
    if (playerState === 'casting' && lastKnownCastTimeRef.current > 0 && castDurationRef.current > 0) {
      const progress = Math.round((lastKnownCastTimeRef.current / castDurationRef.current) * 100);
      updateRentalProgress(currentPlayingFilm, progress, lastKnownCastTimeRef.current).catch(() => {});
      return;
    }
    const v = videoRef.current;
    if (v && v.duration > 0) {
      const progress = Math.round((v.currentTime / v.duration) * 100);
      updateRentalProgress(currentPlayingFilm, progress, v.currentTime).catch(() => {});
    }
  };
  useEffect(() => {
    if (!isPlayerOpen) return;
    return () => { flushPositionRef.current?.(); };
  }, [isPlayerOpen]);

  // ===== Page Visibility API (background resilience during cast) =====
  useEffect(() => {
    if (playerState !== 'casting' || !currentPlayingFilm) return;

    const handleVisibility = () => {
      if (document.hidden) {
        // App going to background — save snapshot
        const remoteTime = getRemoteCurrentTime();
        if (remoteCastDuration > 0) {
          const progress = Math.round((remoteTime / remoteCastDuration) * 100);
          updateRentalProgress(currentPlayingFilm, progress, remoteTime).catch(() => {});
        }
      }
      // On visible: Cast SDK auto-reconnects (ORIGIN_SCOPED).
      // RemotePlayer reflects current receiver state automatically.
      // If remoteCastPlayerState is IDLE, the film-ended useEffect handles it.
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [playerState, currentPlayingFilm, getRemoteCurrentTime, remoteCastDuration]);

  // ===== MediaSession API (lock screen controls during cast) =====
  useEffect(() => {
    if (playerState !== 'casting' || !('mediaSession' in navigator)) return;

    const posterUrl = currentFilm?.poster_path
      ? `/api/poster/w200${currentFilm.poster_path}`
      : undefined;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentFilm?.title || 'Zone Club',
      artist: 'Zone Club',
      artwork: posterUrl ? [{ src: posterUrl, sizes: '200x300', type: 'image/jpeg' }] : [],
    });

    navigator.mediaSession.setActionHandler('play', remotePlayOrPause);
    navigator.mediaSession.setActionHandler('pause', remotePlayOrPause);
    navigator.mediaSession.setActionHandler('stop', remoteStop);

    return () => {
      navigator.mediaSession.setActionHandler('play', null);
      navigator.mediaSession.setActionHandler('pause', null);
      navigator.mediaSession.setActionHandler('stop', null);
      navigator.mediaSession.metadata = null;
    };
  }, [playerState, currentFilm?.title, currentFilm?.poster_path, remotePlayOrPause, remoteStop]);

  // ===== End of Film — Rewind Prompt =====
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleEnded = () => {
      stopRW();
      setFfSpeed(0);
      // Send final progress (100%) + reset position to 0
      if (currentPlayingFilm) {
        updateRentalProgress(currentPlayingFilm, 100, 0).catch(() => {});
      }
      // Same flow as eject — pendingEject=true since film ended
      if (!rental?.rewindClaimed) {
        setPendingEject(true);
        setRewindPhase('prompt');
      } else {
        closePlayer();
      }
    };

    video.addEventListener('ended', handleEnded);
    return () => video.removeEventListener('ended', handleEnded);
  }, [currentPlayingFilm, stopRW, rental?.rewindClaimed, closePlayer]);

  // ===== Remote Film Ended / Stopped Detection =====
  // IDLE can mean film finished OR manual stop on receiver — distinguish by position
  const prevRemoteCastPlayerStateRef = useRef(remoteCastPlayerState);
  useEffect(() => {
    const prev = prevRemoteCastPlayerStateRef.current;
    prevRemoteCastPlayerStateRef.current = remoteCastPlayerState;

    if (playerState !== 'casting') return;
    if (remoteCastPlayerState === 'IDLE' && prev !== 'IDLE' && prev !== 'UNKNOWN') {
      const remoteTime = getRemoteCurrentTime();
      const isNearEnd = remoteCastDuration > 0 && remoteTime / remoteCastDuration >= 0.95;

      // End cast session tracking
      setActiveCastFilmId(null);
      if (currentPlayingFilm) {
        api.castSessions.end(currentPlayingFilm).catch(() => {});
      }

      if (isNearEnd) {
        // Film finished — existing rewind prompt flow
        if (currentPlayingFilm) {
          updateRentalProgress(currentPlayingFilm, 100, 0).catch(() => {});
        }
        if (!rental?.rewindClaimed) {
          setPendingEject(true);
          setRewindPhase('prompt');
        } else {
          closePlayer();
        }
      } else {
        // Manual stop on receiver — save position, stay paused
        if (currentPlayingFilm && remoteCastDuration > 0) {
          const progress = Math.round((remoteTime / remoteCastDuration) * 100);
          updateRentalProgress(currentPlayingFilm, progress, remoteTime).catch(() => {});
        }
        const video = videoRef.current;
        if (video) {
          video.currentTime = remoteTime > 0 ? remoteTime : video.currentTime;
        }
        setPlayerState('paused');
      }
    }
  }, [remoteCastPlayerState, playerState, currentPlayingFilm, rental?.rewindClaimed, closePlayer, remoteCastDuration, getRemoteCurrentTime, setActiveCastFilmId]);

  // Track whether the SDK has EVER reported a connected cast session in
  // this player mount. Without this gate, the disconnect handler below
  // fires immediately on re-mount with `isCastConnected=false` and tears
  // down a legitimately active receiver-side session before the SDK has
  // had a chance to re-publish its CAST_STATE_CHANGED event. The gate
  // ensures we only handle TRANSITIONS from connected→disconnected, not
  // the initial unmounted-yet state.
  const wasCastConnectedRef = useRef(false);
  useEffect(() => {
    if (isCastConnected) wasCastConnectedRef.current = true;
  }, [isCastConnected]);

  // ===== Unexpected Cast Disconnect — Resume Local =====
  useEffect(() => {
    if (!wasCastConnectedRef.current) return;
    if (!isCastConnected && playerState === 'casting') {
      // Cast disconnected — end session
      endCast();
      if (castFilmIdRef.current) {
        api.castSessions.end(castFilmIdRef.current).catch(() => {});
      }

      // Use lastKnownCastTimeRef (SDK resets remoteTime to 0 on disconnect)
      const savedTime = lastKnownCastTimeRef.current;
      const duration = castDurationRef.current;
      const isNearEnd = duration > 0 && savedTime / duration >= 0.95;

      if (isNearEnd) {
        // Film likely finished on receiver before disconnect (e.g. TV turned off after film ended)
        if (currentPlayingFilm) {
          updateRentalProgress(currentPlayingFilm, 100, 0).catch(() => {});
        }
        if (!rental?.rewindClaimed) {
          setPendingEject(true);
          setRewindPhase('prompt');
        } else {
          closePlayer();
        }
      } else {
        // Mid-film disconnect — resume local from last known position
        const video = videoRef.current;
        if (video) {
          if (savedTime > 0) video.currentTime = savedTime;
          video.play().then(() => {
            setPlayerState('playing');
          }).catch(() => {
            setPlayerState('paused');
          });
        } else {
          setPlayerState('paused');
        }
      }

      lastKnownCastTimeRef.current = 0;
    }
  }, [isCastConnected, playerState, setActiveCastFilmId, currentPlayingFilm, rental?.rewindClaimed, closePlayer]);

  // ===== Rewind Animation =====
  const startRewind = useCallback(() => {
    setRewindPhase('rewinding');
    setRewindProgress(0);
    setRewindCredited(false);
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
        // Claim rewind credit inline — no phase transition
        setRewindCredited(true);
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

  // Load review eligibility when rewind starts
  useEffect(() => {
    if (rewindPhase === 'rewinding' && currentPlayingFilm && isAuthenticated) {
      setReviewLoading(true);
      api.reviews.getByFilm(currentPlayingFilm).then((data) => {
        setReviewData(data);
        setReviewLoading(false);
      }).catch(() => {
        setReviewLoading(false);
      });
    }
  }, [rewindPhase, currentPlayingFilm, isAuthenticated]);

  // Submit review during rewind
  const handleReviewSubmit = useCallback(async () => {
    if (!currentPlayingFilm || !isAuthenticated) return;
    if (reviewContent.length < MIN_CONTENT_LENGTH) {
      setReviewError(`Minimum ${MIN_CONTENT_LENGTH} caractères (${reviewContent.length}/${MIN_CONTENT_LENGTH})`);
      return;
    }
    setReviewSubmitting(true);
    setReviewError(null);
    try {
      await api.reviews.create(currentPlayingFilm, {
        content: reviewContent,
        rating_direction: ratingDirection,
        rating_screenplay: ratingScreenplay,
        rating_acting: ratingActing,
      });
      setReviewSuccess(true);
      addCredits(1);
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : 'Erreur lors de la publication');
    } finally {
      setReviewSubmitting(false);
    }
  }, [currentPlayingFilm, isAuthenticated, reviewContent, ratingDirection, ratingScreenplay, ratingActing, addCredits]);



  // Reset state when player closes/opens
  useEffect(() => {
    if (!isPlayerOpen) {
      stopRW();
      setFfSpeed(0);
      setPlayerState('paused');
      setShowBlueScreen(false);
      setRemoteError(null);
      setShowMirroringHelp(false);
      setMirroringContext('generic');
      setIsAirPlaySupported(false);
      setIsAirPlayAvailable(false);
      setIsAirPlayConnected(false);
      setShowMobileRemotePrompt(false);
      setRewindPhase('none');
      setRewindProgress(0);
      setPendingEject(false);
      setRewindCredited(false);
      castFilmIdRef.current = null;
      castDurationRef.current = 0;
      lastKnownCastTimeRef.current = 0;
      // Important: do NOT end the cast session here. The receiver on the TV
      // continues playing independent of whether the phone player overlay is
      // open, and the next openPlayer call reads activeCastFilmId to enter
      // remote-control mode automatically. Calling castSessions.end here is
      // what made closing the player wipe the cast tracking and forced users
      // to manually re-cast on reopen.
      // Reset review state
      setReviewContent('');
      setRatingDirection(3);
      setRatingScreenplay(3);
      setRatingActing(3);
      setReviewError(null);
      setReviewSuccess(false);
      setReviewData(null);
      // Reset rewind-to-start
      if (rewindToStartRafRef.current !== null) cancelAnimationFrame(rewindToStartRafRef.current);
      setRewindingToStart(false);
      setRewindToStartProgress(0);
      setRewindToStartCounter(0);
      // Reset overlay
      setOverlayVisible(true);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    }
  }, [isPlayerOpen, stopRW]);

  // ===== Overlay auto-hide (4s inactivity) =====
  const resetIdleTimer = useCallback(() => {
    setOverlayVisible(true);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      setOverlayVisible(false);
    }, 4000);
  }, []);

  useEffect(() => {
    if (!isPlayerOpen || rewindPhase !== 'none' || rewindingToStart) return;

    // Portrait mobile: VCR remote sits below the video and is always visible.
    // Auto-hide doesn't make sense there — it's not floating over the video.
    const checkPortraitMobile = () => isMobile && window.innerHeight > window.innerWidth;

    const onActivity = () => resetIdleTimer();
    let listenersActive = false;

    const enableAutoHide = () => {
      if (listenersActive) return;
      listenersActive = true;
      window.addEventListener('mousemove', onActivity);
      window.addEventListener('touchstart', onActivity);
      window.addEventListener('keydown', onActivity);
      resetIdleTimer();
    };

    const disableAutoHide = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      setOverlayVisible(true);
      if (!listenersActive) return;
      listenersActive = false;
      window.removeEventListener('mousemove', onActivity);
      window.removeEventListener('touchstart', onActivity);
      window.removeEventListener('keydown', onActivity);
    };

    const apply = () => {
      // Always keep controls visible during cast — the remote buttons are the
      // primary UI the user needs (play/pause/stop on the TV). Letting them
      // fade out after 4s of inactivity leaves only the info overlay visible,
      // which feels like "no controls at all" to the user.
      if (checkPortraitMobile() || playerState === 'casting') disableAutoHide();
      else enableAutoHide();
    };

    apply();
    window.addEventListener('resize', apply);

    return () => {
      window.removeEventListener('resize', apply);
      disableAutoHide();
    };
  }, [isPlayerOpen, rewindPhase, rewindingToStart, resetIdleTimer, isMobile, playerState]);

  if (!isPlayerOpen || !rental) return null;
  const connectedTvLabel = castDeviceName || (isAirPlayConnected ? 'TV AirPlay connectée' : null);

  return (
    <div className={styles.player} style={!overlayVisible && rewindPhase === 'none' ? { cursor: 'none' } : undefined}>
      {/* Film title header */}
      {currentFilm && (
        <div className={styles.header} style={{
          opacity: overlayVisible ? 1 : 0,
          transition: 'opacity 0.4s',
          pointerEvents: overlayVisible ? 'auto' : 'none',
        }}>
          <span className={styles.filmTitle}>{currentFilm.title}</span>
          <span className={styles.trackIndicator}>
            {audioTrack.toUpperCase()}
            {showSubtitles && hasSubtitles && ' + STFR'}
          </span>
        </div>
      )}

      {/* Video element with key to force reload on track change.
          autoPlay is gated by playerState so that when we're casting or
          awaiting the cast device, the <video> doesn't fire its own play
          event after a remount — which would race with the cast handoff
          and produce "film plays on phone AND TV" or restart from start
          on player reopen during an active cast. */}
      <video
        key={`${audioTrack}-${videoUrl}`}
        ref={videoRef}
        className={styles.video}
        autoPlay={playerState !== 'casting' && playerState !== 'awaitingCast'}
        playsInline
        onPlay={() => {
          // Ignore play events while we're handing off to the cast device —
          // the receiver is the canonical playback target, not the local
          // <video>. Without this guard, an autoplay-triggered play event
          // would flip playerState back to 'playing' and break the casting UI.
          if (playerState === 'casting' || playerState === 'awaitingCast') {
            const v = videoRef.current;
            if (v && !v.paused) v.pause();
            return;
          }
          if (!isTransitioningRef.current) {
            setPlayerState('playing');
            setShowBlueScreen(false);
          }
        }}
        onPause={() => {
          // Don't override rewinding/fastforwarding state or transition in progress
          if (
            !isTransitioningRef.current &&
            playerState !== 'rewinding' &&
            playerState !== 'fastforwarding' &&
            playerState !== 'casting' &&
            playerState !== 'awaitingCast'
          ) {
            setPlayerState('paused');
            // Persist the local pause position. Without this, the 30s save loop
            // bails on `video.paused` (see watch-progress useEffect), so a user
            // who pauses then switches to cast loses the pre-pause timestamp.
            const v = videoRef.current;
            if (v && currentPlayingFilm && v.duration > 0) {
              const progress = Math.round((v.currentTime / v.duration) * 100);
              updateRentalProgress(currentPlayingFilm, progress, v.currentTime).catch(() => {});
            }
          }
        }}
      >
        {/* Don't emit <source src=""> — browsers fire `error` on the video
            element which cascades into closePlayer paths and unmounts the
            whole player. */}
        {videoUrl && <source src={videoUrl} type="video/mp4" />}
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

      {/* Awaiting-cast overlay — radio-wave pulse + animated dots. The
          satellite dish tilts while three concentric rings emanate from it,
          producing a visceral "signal en cours" feedback. If the SDK has
          already published the receiver's friendlyName we surface it in a
          pill so the user sees exactly which device they're connecting to. */}
      {playerState === 'awaitingCast' && rewindPhase === 'none' && (
        <div className={styles.castingOverlay}>
          <div className={styles.awaitingIcon}>
            <span className={styles.awaitingRing} />
            <span className={styles.awaitingDish} role="img" aria-label="satellite">📡</span>
          </div>
          <div className={styles.castingTitle}>
            Connexion à{' '}
            {castDeviceName ? (
              <span className={styles.awaitingDeviceName}>{castDeviceName}</span>
            ) : (
              'ta TV'
            )}
            <span className={styles.awaitingDots} aria-hidden="true">
              <span>.</span><span>.</span><span>.</span>
            </span>
          </div>
          <div style={{ fontSize: '0.85rem', opacity: 0.7, marginTop: '0.5rem', textAlign: 'center', padding: '0 1.5rem' }}>
            Choisis ton appareil dans la fenêtre Google Cast.
          </div>
          <button
            type="button"
            className={styles.awaitingCancelBtn}
            onClick={() => {
              endCast();
              setPlayerState('paused');
            }}
          >
            Annuler
          </button>
        </div>
      )}

      {/* Now Playing — unified cast control surface. Replaces the old
          split "info overlay on top + VHS remote duplicate below". Header
          identifies the receiver + film title, then the timeline, then a
          three-button transport row, then secondary actions (switch back
          to phone, stop the cast). Volume slider only renders when the
          SDK has reported a media-loaded state — before that, the receiver
          isn't actually responding to volume changes yet. */}
      {playerState === 'casting' && rewindPhase === 'none' && (
        <div className={styles.castingOverlay}>
          <div className={styles.nowPlayingHeader}>
            <div className={styles.nowPlayingDeviceChip}>
              {castDeviceName || (isAirPlayConnected ? 'AirPlay' : 'TV')}
            </div>
            {currentFilm && (
              <div className={styles.nowPlayingFilmTitle}>{currentFilm.title}</div>
            )}
          </div>

          <div className={styles.castingTimer} style={{ marginTop: 18 }}>
            {formatCastTime(remoteCastTime)} / {formatCastTime(remoteCastDuration)}
          </div>
          {remoteCastDuration > 0 && (
            <>
              <div className={styles.castingBarContainer}>
                <div
                  className={styles.castingBarFill}
                  style={{ width: `${Math.min(100, (remoteCastTime / remoteCastDuration) * 100)}%` }}
                />
              </div>
              <div className={styles.castingPercent}>
                {Math.round((remoteCastTime / remoteCastDuration) * 100)}%
              </div>
            </>
          )}

          <div className={styles.nowPlayingTransport}>
            <button
              type="button"
              className={styles.nowPlayingBtn}
              onClick={() => {
                const t = Math.max(0, getRemoteCurrentTime() - 15);
                remoteSeek(t);
              }}
              aria-label="Reculer de 15 secondes"
            >
              −15s
            </button>
            <button
              type="button"
              className={`${styles.nowPlayingBtn} ${styles.nowPlayingBtnPrimary}`}
              onClick={remotePlayOrPause}
              aria-label={remoteCastPaused ? 'Lecture' : 'Pause'}
            >
              {remoteCastPaused ? '▶' : '⏸'}
            </button>
            <button
              type="button"
              className={styles.nowPlayingBtn}
              onClick={() => {
                const max = remoteCastDuration > 0 ? remoteCastDuration : Infinity;
                const t = Math.min(max, getRemoteCurrentTime() + 15);
                remoteSeek(t);
              }}
              aria-label="Avancer de 15 secondes"
            >
              +15s
            </button>
          </div>

          {remoteCastMediaLoaded && (
            <div className={styles.nowPlayingVolumeRow}>
              <span aria-hidden="true">🔉</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                defaultValue={1}
                onChange={(e) => remoteSetVolume(Number(e.target.value))}
                className={styles.nowPlayingVolumeSlider}
                aria-label="Volume TV"
              />
            </div>
          )}

          <div className={styles.nowPlayingSecondary}>
            <button
              type="button"
              className={styles.nowPlayingSecondaryBtn}
              onClick={handleSwitchToPhone}
            >
              📱 Sur le tel
            </button>
            <button
              type="button"
              className={`${styles.nowPlayingSecondaryBtn} ${styles.nowPlayingStopBtn}`}
              onClick={handleStop}
            >
              ⏹ Arrêter
            </button>
          </div>
        </div>
      )}

      <div className={styles.rentalTimer} style={{
        opacity: overlayVisible ? 1 : 0,
        transition: 'opacity 0.4s',
        pointerEvents: overlayVisible ? 'auto' : 'none',
      }}>
        <RentalTimer expiresAt={rental.expiresAt} />
      </div>

      {showMobileRemotePrompt && rewindPhase === 'none' && playerState !== 'casting' && playerState !== 'awaitingCast' && (
        <div className={styles.mobileRemotePrompt}>
          <div className={styles.mobileRemotePromptTitle}>Regarder sur TV ?</div>
          <div className={styles.mobileRemotePromptText}>
            {connectedTvLabel
              ? `TV connectée: ${connectedTvLabel}`
              : 'Caster/AirPlay disponible si votre TV est sur le même Wi-Fi.'}
          </div>
          <div className={styles.mobileRemotePromptActions}>
            <button className={styles.mobileRemotePrimaryBtn} onClick={handleWatchOnTVFromPrompt}>
              {connectedTvLabel ? `Regarder sur ${connectedTvLabel}` : 'Regarder sur TV'}
            </button>
            <button className={styles.mobileRemoteSecondaryBtn} onClick={() => setShowMobileRemotePrompt(false)}>
              Continuer sur smartphone
            </button>
          </div>
        </div>
      )}

      {/* ===== Rewind to Start Overlay ===== */}
      {rewindingToStart && (
        <div className={styles.rewindOverlay}>
          <div className={styles.reelContainer}>
            <svg viewBox="0 0 200 80" className={styles.reelSvg}>
              <circle
                cx="50" cy="40"
                r={8 + (rewindToStartProgress / 100) * 22}
                fill="none"
                stroke="#00fff7"
                strokeWidth="2"
                opacity="0.9"
              />
              <circle cx="50" cy="40" r="5" fill="#00fff7" opacity="0.3" />
              <circle
                cx="150" cy="40"
                r={30 - (rewindToStartProgress / 100) * 22}
                fill="none"
                stroke="#00fff7"
                strokeWidth="2"
                opacity="0.9"
              />
              <circle cx="150" cy="40" r="5" fill="#00fff7" opacity="0.3" />
              <line
                x1={50 + 8 + (rewindToStartProgress / 100) * 22}
                y1="40"
                x2={150 - 30 + (rewindToStartProgress / 100) * 22}
                y2="40"
                stroke="#00fff7"
                strokeWidth="1"
                opacity="0.4"
              />
            </svg>
          </div>
          <div className={styles.rewindTapeCounter}>
            {String(rewindToStartCounter).padStart(4, '0')}
          </div>
          <div className={styles.rewindBarContainer}>
            <div className={styles.rewindBarFill} style={{ width: `${rewindToStartProgress}%` }} />
          </div>
          <div className={styles.rewindLabel}>REMBOBINAGE...</div>
        </div>
      )}

      {/* ===== Rewind Prompt (STOP/EJECT at 80%+ or film ended) ===== */}
      {rewindPhase === 'prompt' && (
        <div className={styles.rewindOverlay}>
          <div className={styles.rewindPromptText}>
            BE KIND<br />REWIND
          </div>
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.9rem', marginBottom: 16, fontFamily: "'Orbitron', monospace", letterSpacing: 1 }}>
            {pendingEject ? 'Rembobiner avant de partir ? +1 crédit' : 'Rembobiner pour +1 crédit ?'}
          </div>
          <div className={styles.rewindButtons}>
            <button onClick={startRewind} className={styles.rewindBtn}>
              ◀◀ REMBOBINER
            </button>
            {pendingEject ? (
              <button onClick={closePlayer} className={styles.ejectRewindBtn}>
                ⏏ ÉJECTER
              </button>
            ) : (
              <button onClick={dismissRewindPrompt} className={styles.ejectRewindBtn}>
                NON MERCI
              </button>
            )}
          </div>
        </div>
      )}

      {/* ===== Rewind Animation + Review Modal ===== */}
      {rewindPhase === 'rewinding' && (
        <div className={styles.rewindOverlay} style={{ justifyContent: 'flex-start', paddingTop: '3vh' }}>
          {/* Close button */}
          <button
            onClick={closeRewindModal}
            style={{
              position: 'absolute',
              top: 16,
              right: 20,
              background: 'none',
              border: '1px solid rgba(255,255,255,0.3)',
              color: 'rgba(255,255,255,0.7)',
              fontSize: '1.4rem',
              cursor: 'pointer',
              width: 36,
              height: 36,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 4,
              zIndex: 10,
            }}
            title="Fermer"
          >
            ✕
          </button>

          {/* VHS Reel Animation */}
          <div className={styles.reelContainer}>
            <svg viewBox="0 0 200 80" className={styles.reelSvg}>
              {/* Left reel (growing) */}
              <circle
                cx="50" cy="40"
                r={8 + (rewindProgress / 100) * 22}
                fill="none"
                stroke="#00fff7"
                strokeWidth="2"
                opacity="0.9"
              />
              <circle cx="50" cy="40" r="5" fill="#00fff7" opacity="0.3" />
              {/* Right reel (shrinking) */}
              <circle
                cx="150" cy="40"
                r={30 - (rewindProgress / 100) * 22}
                fill="none"
                stroke="#00fff7"
                strokeWidth="2"
                opacity="0.9"
              />
              <circle cx="150" cy="40" r="5" fill="#00fff7" opacity="0.3" />
              {/* Tape line */}
              <line
                x1={50 + 8 + (rewindProgress / 100) * 22}
                y1="40"
                x2={150 - 30 + (rewindProgress / 100) * 22}
                y2="40"
                stroke="#00fff7"
                strokeWidth="1"
                opacity="0.4"
              />
            </svg>
          </div>

          {/* Time counter + progress */}
          <div className={styles.rewindTapeCounter} style={{ fontSize: '1.8rem' }}>
            {String(Math.floor((100 - rewindProgress) * 72)).padStart(4, '0')}
          </div>
          <div className={styles.rewindBarContainer}>
            <div className={styles.rewindBarFill} style={{ width: `${rewindProgress}%` }} />
          </div>
          <div className={styles.rewindLabel}>
            {rewindCredited ? 'REMBOBINAGE TERMINÉ' : 'REMBOBINAGE EN COURS...'}
          </div>

          {/* Credit claimed message */}
          {rewindCredited && (
            <div className={styles.rewindReviewSuccess} style={{ marginTop: 8, marginBottom: 4 }}>
              <span>✓</span> MERCI ! <span className={styles.rewindCreditBonus}>+1 CRÉDIT</span>
            </div>
          )}

          {/* Review form */}
          <div className={styles.rewindReviewSection}>
            {!isAuthenticated ? (
              <div className={styles.rewindReviewHint}>
                Connectez-vous pour critiquer ce film pendant le rembobinage
              </div>
            ) : reviewLoading ? (
              <div className={styles.rewindReviewHint}>CHARGEMENT...</div>
            ) : reviewSuccess ? (
              <div className={styles.rewindReviewSuccess}>
                <span>✓</span> CRITIQUE PUBLIEE ! <span className={styles.rewindCreditBonus}>+1 CREDIT</span>
              </div>
            ) : reviewData && !reviewData.canReview.allowed ? (
              <div className={styles.rewindReviewHint}>
                {reviewData.canReview.reason || 'Vous ne pouvez pas critiquer ce film.'}
              </div>
            ) : (
              <>
                <div className={styles.rewindReviewTitle}>CRITIQUER CE FILM</div>
                {/* Ratings row */}
                <div className={styles.rewindRatingsRow}>
                  {[
                    { label: 'RÉAL', value: ratingDirection, setter: setRatingDirection },
                    { label: 'SCÉN', value: ratingScreenplay, setter: setRatingScreenplay },
                    { label: 'JEU', value: ratingActing, setter: setRatingActing },
                  ].map(({ label, value, setter }) => (
                    <div key={label} className={styles.rewindRatingGroup}>
                      <span className={styles.rewindRatingLabel}>{label}</span>
                      <div className={styles.rewindStars}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            type="button"
                            className={`${styles.rewindStar} ${n <= value ? styles.rewindStarActive : ''}`}
                            onClick={() => setter(n)}
                          >
                            ★
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {/* Textarea */}
                <div className={styles.rewindTextareaWrap}>
                  <textarea
                    className={styles.rewindTextarea}
                    value={reviewContent}
                    onChange={(e) => setReviewContent(e.target.value)}
                    placeholder="Votre critique (min. 500 caractères)..."
                    rows={4}
                  />
                  <span className={`${styles.rewindCharCount} ${reviewContent.length >= MIN_CONTENT_LENGTH ? styles.rewindCharValid : ''}`}>
                    {reviewContent.length}/{MIN_CONTENT_LENGTH}
                  </span>
                </div>
                {reviewError && <div className={styles.rewindReviewError}>{reviewError}</div>}
                <button
                  className={styles.rewindSubmitBtn}
                  onClick={handleReviewSubmit}
                  disabled={reviewSubmitting || reviewContent.length < MIN_CONTENT_LENGTH}
                >
                  {reviewSubmitting ? 'PUBLICATION...' : 'PUBLIER (+1 CREDIT)'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {showMirroringHelp && (
        <div className={styles.mirroringOverlay}>
          <div className={styles.mirroringPanel}>
            <div className={styles.mirroringTitle}>MODE MIROIR (FALLBACK)</div>
            {mirroringContext === 'cast' && (
              <div className={styles.mirroringContextHint}>
                Google Cast n&apos;est pas disponible, utilisez la recopie d&apos;écran.
              </div>
            )}
            {mirroringContext === 'airplay' && (
              <div className={styles.mirroringContextHint}>
                AirPlay n&apos;est pas disponible, utilisez la recopie d&apos;écran.
              </div>
            )}
            <div className={styles.mirroringSteps}>
              <strong>Android (Chrome)</strong>
              <span>1. Ouvre le menu Chrome (⋮) puis Caster.</span>
              <span>2. Sélectionne ta TV ou Chromecast.</span>
              <span>3. Si besoin: Sources &gt; Caster l&apos;écran.</span>
            </div>
            <div className={styles.mirroringSteps}>
              <strong>iPhone / iPad</strong>
              <span>1. Ouvre le Centre de contrôle.</span>
              <span>2. Appuie sur Recopie de l&apos;écran.</span>
              <span>3. Sélectionne Apple TV ou la Smart TV compatible.</span>
            </div>
            <div className={styles.mirroringFootnote}>
              Téléphone/tablette et TV doivent être sur le même réseau Wi-Fi.
            </div>
            <button className={styles.mirroringCloseBtn} onClick={() => setShowMirroringHelp(false)}>
              FERMER
            </button>
          </div>
        </div>
      )}

      {/* VCR Controls — only show when not in rewind sequence AND not
          casting (the Now Playing panel above provides cast-specific
          controls; rendering both produced the duplicate-UI bug). */}
      {rewindPhase === 'none' && !rewindingToStart && playerState !== 'casting' && playerState !== 'awaitingCast' && (
        <div style={{
          opacity: overlayVisible ? 1 : 0,
          transition: 'opacity 0.4s',
          pointerEvents: overlayVisible ? 'auto' : 'none',
        }}>
        <VHSControls
          videoRef={videoRef}
          playerState={playerState}
          onStateChange={setPlayerState}
          onStop={handleStop}
          onEject={handleEject}
          ffSpeed={ffSpeed}
          onFFCycle={handleFFCycle}
          onRWCycle={handleRWCycle}
          onRewindToStart={handleRewindToStart}
          onResumeFromRW={resumePlayFromRW}
          audioTrack={audioTrack}
          onAudioTrackChange={handleAudioTrackChange}
          showSubtitles={showSubtitles}
          onSubtitlesToggle={() => setShowSubtitles(prev => !prev)}
          hasVF={hasVF}
          hasVO={hasVO}
          hasSubtitles={hasSubtitles}
          onCast={handleCastCurrentVideo}
          onAirPlay={handleAirPlayPicker}
          onMirroringHelp={() => openMirroringFallback('generic')}
          isCastReady={isCastReady}
          hasCastDevices={hasCastDevices}
          isCastConnected={isCastConnected}
          isCastConnecting={castState === 'CONNECTING'}
          isAirPlaySupported={isAirPlaySupported}
          isAirPlayAvailable={isAirPlayAvailable}
          isAirPlayConnected={isAirPlayConnected}
          remoteError={remoteError}
          isCasting={false /* casting renders the Now Playing panel above; VHSControls is local-only here */}
          remoteCastTime={remoteCastTime}
          remoteCastDuration={remoteCastDuration}
          remoteCastPaused={remoteCastPaused}
          onRemotePlayOrPause={remotePlayOrPause}
          onRemoteStop={handleStop}
        />
        </div>
      )}
    </div>
  );
}
