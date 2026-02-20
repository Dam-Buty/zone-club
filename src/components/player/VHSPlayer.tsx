import { useRef, useState, useEffect, useCallback } from 'react';
import { useStore } from '../../store';
import { VHSEffects } from './VHSEffects';
import { VHSControls } from './VHSControls';
import { RentalTimer } from '../ui/RentalTimer';
import api, { type ReviewsResponse } from '../../api';
import type { PlayerState } from '../../types';
import styles from './VHSPlayer.module.css';

const MIN_CONTENT_LENGTH = 500;

export type AudioTrack = 'vf' | 'vo';

// Rewind state machine
type RewindPhase = 'none' | 'prompt' | 'rewinding' | 'complete';

export function VHSPlayer() {
  const { isPlayerOpen, currentPlayingFilm, closePlayer, getRental, films, fetchMe, isAuthenticated, addCredits } = useStore();
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
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;

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
        // Don't transition to complete if user is writing a review
        if (reviewContentRef.current.length > 0) {
          setRewindProgress(100);
          return;
        }
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

  // Transition to complete when rewind done + review finished or cleared
  useEffect(() => {
    if (rewindPhase !== 'rewinding' || rewindProgress < 100) return;
    if (reviewContent.length > 0 && !reviewSuccess) return;
    // Small delay after success so user sees the confirmation
    const delay = reviewSuccess ? 2000 : 0;
    const timer = setTimeout(() => {
      setRewindPhase('complete');
      if (currentPlayingFilm) {
        api.rentals.claimRewind(currentPlayingFilm)
          .then(() => { fetchMe(); })
          .catch(() => {});
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [rewindPhase, rewindProgress, reviewContent, reviewSuccess, currentPlayingFilm, fetchMe]);

  // Reset state when player closes/opens
  useEffect(() => {
    if (!isPlayerOpen) {
      stopRW();
      setFfSpeed(0);
      setPlayerState('paused');
      setShowBlueScreen(false);
      setRewindPhase('none');
      setRewindProgress(0);
      // Reset review state
      setReviewContent('');
      setRatingDirection(3);
      setRatingScreenplay(3);
      setRatingActing(3);
      setReviewError(null);
      setReviewSuccess(false);
      setReviewData(null);
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

      {/* ===== Rewind Animation + Review ===== */}
      {rewindPhase === 'rewinding' && (
        <div className={styles.rewindOverlay} style={{ justifyContent: 'flex-start', paddingTop: '3vh' }}>
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
          <div className={styles.rewindLabel}>REMBOBINAGE EN COURS...</div>

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
