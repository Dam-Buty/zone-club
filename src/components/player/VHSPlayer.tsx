import { useRef, useState, useEffect, useCallback } from 'react';
import { useStore } from '../../store';
import { VHSEffects } from './VHSEffects';
import { VHSControls } from './VHSControls';
import { RentalTimer } from '../ui/RentalTimer';
import type { PlayerState } from '../../types';
import styles from './VHSPlayer.module.css';

export type AudioTrack = 'vf' | 'vo';

export function VHSPlayer() {
  const { isPlayerOpen, currentPlayingFilm, closePlayer, getRental, films } = useStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playerState, setPlayerState] = useState<PlayerState>('paused');
  const [showEndMessage, setShowEndMessage] = useState(false);
  const [audioTrack, setAudioTrack] = useState<AudioTrack>('vf');
  const [showSubtitles, setShowSubtitles] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);

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
    // Fallback to whatever is available
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

  // Keyboard controls
  useEffect(() => {
    if (!isPlayerOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (video.paused) {
            video.play();
            setPlayerState('playing');
          } else {
            video.pause();
            setPlayerState('paused');
          }
          break;
        case 'ArrowLeft':
          video.currentTime -= 10;
          break;
        case 'ArrowRight':
          video.currentTime += 10;
          break;
        case 'f':
          document.documentElement.requestFullscreen();
          break;
        case 'm':
          video.muted = !video.muted;
          break;
        case 'v':
          // Toggle VF/VO
          if (hasVF && hasVO) {
            handleAudioTrackChange(audioTrack === 'vf' ? 'vo' : 'vf');
          }
          break;
        case 's':
          // Toggle subtitles
          if (hasSubtitles) {
            setShowSubtitles(prev => !prev);
          }
          break;
        case 'Escape':
          closePlayer();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlayerOpen, closePlayer, hasVF, hasVO, hasSubtitles, audioTrack, handleAudioTrackChange]);

  // Handle video end
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleEnded = () => {
      setShowEndMessage(true);
      setTimeout(() => setShowEndMessage(false), 3000);
    };

    video.addEventListener('ended', handleEnded);
    return () => video.removeEventListener('ended', handleEnded);
  }, []);

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
        onPlay={() => setPlayerState('playing')}
        onPause={() => setPlayerState('paused')}
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
        Votre navigateur ne supporte pas la lecture vidéo.
      </video>

      <VHSEffects playerState={playerState} />

      <div className={styles.rentalTimer}>
        <RentalTimer expiresAt={rental.expiresAt} />
      </div>

      {showEndMessage && (
        <div className={styles.endMessage}>
          BE KIND<br />REWIND
        </div>
      )}

      <VHSControls
        videoRef={videoRef}
        playerState={playerState}
        onStateChange={setPlayerState}
        onClose={closePlayer}
        audioTrack={audioTrack}
        onAudioTrackChange={handleAudioTrackChange}
        showSubtitles={showSubtitles}
        onSubtitlesToggle={() => setShowSubtitles(prev => !prev)}
        hasVF={hasVF}
        hasVO={hasVO}
        hasSubtitles={hasSubtitles}
      />
    </div>
  );
}
