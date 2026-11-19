import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useStore } from '../../store';
import { VHSEffects } from './VHSEffects';
import { VHSControls } from './VHSControls';
import { CastPanels } from './CastPanels';
import { CastNoticeLine, OtherFilmBanner } from './CastNotices';
import { RentalTimer } from '../ui/RentalTimer';
import api, { type ReviewsResponse } from '../../api';
import type { PlayerState } from '../../types';
import { castView } from '../../cast/cast-machine';
import { CAST_UNAVAILABLE_TEXT, castDeviceLabel, castNoticeView } from '../../cast/cast-labels';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useBackGuard } from '../../hooks/useBackGuard';
import { buildCastSubtitleTracks, activeSubtitleId } from '../../utils/cast-subtitles';
import { appleAirPlay, rewindPromptFor } from '../../utils/cast-on-open';
import { REVIEW_MIN_LENGTH, REVIEW_RATING_LABELS } from '../../utils/review-rules';
import styles from './VHSPlayer.module.css';
import castStyles from './CastPanels.module.css';

const MIN_CONTENT_LENGTH = REVIEW_MIN_LENGTH;

export type AudioTrack = 'vf' | 'vo';

/**
 * Piste de sous-titres affichée. Le pipeline média extrait FR et EN séparément
 * (`subtitle_fr_vtt` / `subtitle_en_vtt`) et la location les expose toutes les deux ;
 * les deux peuvent manquer indépendamment, d'où un état à trois valeurs plutôt qu'un booléen.
 */
export type SubtitleTrack = 'off' | 'fr' | 'en';

const SUBTITLE_LABELS: Record<Exclude<SubtitleTrack, 'off'>, { button: string; label: string; title: string }> = {
  fr: { button: 'STFR', label: 'Français', title: 'Sous-titres français [T]' },
  en: { button: 'STEN', label: 'English', title: 'Sous-titres anglais [T]' },
};

/** Échec d'une bascule de sous-titres sur la TV : montré dans la télécommande, effacé quand on la quitte. */
const TV_SUBTITLE_ERROR = 'Sous-titres indisponibles sur la TV.';

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
  const playerFrom = useStore(state => state.playerFrom);
  const playerAsk = useStore(state => state.playerAsk);
  // Le Cast se LIT dans la tranche du magasin et se DEMANDE par ses actions : le lecteur n'en écrit rien. Des valeurs
  // simples (la vue de ce film, le message, la reprise) : la position qui avance chaque seconde ne redessine pas le lecteur.
  const view = useStore(state => castView(state.cast, state.currentPlayingFilm));
  const castNotice = useStore(state => state.cast.notice);
  const castResume = useStore(state => state.cast.resume);
  const castAvailable = useStore(state => state.cast.available);
  const tvDeviceName = useStore(state => (state.cast.connected ? castDeviceLabel(state.cast.deviceName) : null));
  const startCast = useStore(state => state.startCast);
  const castFilm = useStore(state => state.castFilm);
  const castToggle = useStore(state => state.castToggle);
  const castDismiss = useStore(state => state.castDismiss);
  const castSubtitle = useStore(state => state.castSubtitle);
  const takeCastResume = useStore(state => state.takeCastResume);
  // La TV a ce film, ou le prend : les panneaux du Cast couvrent le lecteur.
  const remoteActive = view !== 'local' && view !== 'other-on-tv' && view !== 'ended';
  // La TV a ce film, le prend, ou vient de le finir : la vidéo locale se tait (jamais sur les deux écrans, et jamais
  // sous « BE KIND REWIND »).
  const tvOwnsFilm = view !== 'local' && view !== 'other-on-tv';
  // Le message du Cast pour ce film (ou sans film). « Cast indisponible » est un panneau, pas une ligne.
  const noticeHere = castNotice && (castNotice.filmId === null || castNotice.filmId === currentPlayingFilm) ? castNotice : null;
  const castMissing = noticeHere !== null && castNoticeView(noticeHere.code, null).mirroring;
  // Le lancement vers la TV vient d'échouer : le visiteur choisit (réessayer, ou regarder ici), rien ne part seul.
  const castFailedHere = noticeHere !== null && (noticeHere.code === 'connect_failed' || noticeHere.code === 'load_failed');
  const isMobile = useIsMobile();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playerState, setPlayerState] = useState<PlayerState>('paused');
  const [audioTrack, setAudioTrack] = useState<AudioTrack>('vf');
  const [subtitleTrack, setSubtitleTrack] = useState<SubtitleTrack>('fr');
  const [currentTime, setCurrentTime] = useState(0);
  const [showBlueScreen, setShowBlueScreen] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [showMirroringHelp, setShowMirroringHelp] = useState(false);
  const [mirroringContext, setMirroringContext] = useState<'generic' | 'cast' | 'airplay'>('generic');
  const [isAirPlaySupported, setIsAirPlaySupported] = useState(false);
  const [isAirPlayAvailable, setIsAirPlayAvailable] = useState(false);
  const [isAirPlayConnected, setIsAirPlayConnected] = useState(false);
  // « Regarder sur TV ? » à l'ouverture : sur mobile, quand la TV n'a pas déjà ce film, si l'appelant la demande ou si le
  // dernier lancement vers la TV a échoué. Calculée dès le premier rendu (le lecteur est monté à chaque ouverture) : la
  // vidéo locale ne part pas avant elle.
  const [showMobileRemotePrompt, setShowMobileRemotePrompt] = useState(() => isMobile && view === 'local' && (playerAsk || castFailedHere));
  // « Regarder sur TV » alors qu'un autre film passe sur la TV : la question « Remplacer … ? » est posée.
  const [confirmReplace, setConfirmReplace] = useState(false);

  // Push notification state.
  // ⚠️ Rien ne lit ces états et rien n'appelle handleEnablePushNotifications plus bas : c'est le SEUL
  // chemin d'abonnement Web Push du client, donc la table push_subscriptions ne peut pas se remplir et
  // la notification « film terminé sur la TV » n'a personne à qui parler. Le backend (VAPID, lib/push.ts,
  // nettoyage des 410/404) est complet — il manque le bouton qui déclenche l'abonnement.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- feature non branchée, voir ci-dessus
  const [pushSubscribed, setPushSubscribed] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- idem
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
  // Film dont la location a été relue sur le serveur depuis l'ouverture du lecteur (voir l'effet
  // « Film already finished at opening »).
  const [rentalFreshFor, setRentalFreshFor] = useState<number | null>(null);
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

  const rental = currentPlayingFilm ? getRental(currentPlayingFilm) : null;
  const streamingUrls = rental?.streamingUrls;

  // Get film title for display. La page admin ouvre un film qui n'est pas
  // forcément dans le cache d'un rayon : `previewFilm` est alors la seule source.
  const previewFilm = useStore(state => state.previewFilm);
  const allFilms = Object.values(films).flat();
  const currentFilm = previewFilm?.id === currentPlayingFilm
    ? previewFilm
    : allFilms.find(f => f.id === currentPlayingFilm);

  // Determine available tracks
  const hasVF = !!streamingUrls?.vf;
  const hasVO = !!streamingUrls?.vo;
  const hasSubtitlesFr = !!streamingUrls?.subtitles;
  const hasSubtitlesEn = !!streamingUrls?.subtitles_en;

  // Un <track> distant (sous-domaine storage) n'est chargé que si l'élément
  // <video> est en mode CORS : le navigateur refuse la piste sans l'attribut
  // `crossOrigin`, et il le fait silencieusement (le bouton STFR paraît actif,
  // aucun texte n'apparaît). On le déduit des URLs de sous-titres — pas de la
  // piste sélectionnée, pour ne pas changer l'attribut en cours de lecture. Le
  // seed sert ses sous-titres en same-origin et archive.org ne renvoie pas
  // `Access-Control-Allow-Origin` sur sa réponse finale : forcer crossOrigin
  // casserait la vidéo de seed.
  const hasRemoteSubtitles =
    /^https?:\/\//i.test(streamingUrls?.subtitles ?? '') ||
    /^https?:\/\//i.test(streamingUrls?.subtitles_en ?? '');
  // Ordre d'affichage et de cycle clavier : FR d'abord, EN ensuite, et seulement ce qui existe.
  const availableSubtitles = useMemo(
    () => (['fr', 'en'] as const).filter(lang => (lang === 'fr' ? hasSubtitlesFr : hasSubtitlesEn)),
    [hasSubtitlesFr, hasSubtitlesEn]
  );

  // Pistes que la TV peut charger (adresses absolues seulement, voir cast-subtitles) : les boutons STFR/STEN de la
  // télécommande. La tranche du magasin les déclare elle-même au lancement.
  const castSubtitles = useMemo(
    () => buildCastSubtitleTracks(streamingUrls),
    [streamingUrls]
  );

  // Snap the selected audio track to a version that ACTUALLY exists for this rental. A film can be VF-only
  // (e.g. The Big Short) or VO-only; without this the player keeps the default 'vf' and getVideoUrl
  // silently serves the other version → UI says one thing, audio is another. Here we make the selection
  // honest so the controls + the served stream agree.
  useEffect(() => {
    if (!streamingUrls) return;
    if (audioTrack === 'vf' && !hasVF && hasVO) setAudioTrack('vo');
    else if (audioTrack === 'vo' && !hasVO && hasVF) setAudioTrack('vf');
  }, [streamingUrls, hasVF, hasVO, audioTrack]);

  // Même principe pour les sous-titres : le défaut est FR, mais un film peut n'avoir que l'EN (ou rien).
  // On ne retombe QUE depuis une langue absente — 'off' est un choix explicite de l'utilisateur et ne doit
  // jamais être réactivé tout seul.
  useEffect(() => {
    if (!streamingUrls || subtitleTrack === 'off') return;
    if (!availableSubtitles.includes(subtitleTrack)) {
      setSubtitleTrack(availableSubtitles[0] ?? 'off');
    }
  }, [streamingUrls, availableSubtitles, subtitleTrack]);

  // Sous-titres choisis par le visiteur pendant que la TV joue ce film (boutons STFR/STEN, touche T) : la TV suit sans
  // recharger le film. Seulement sur son geste : au lancement, la TV a reçu le choix d'ici avec le film, et le recalage
  // automatique d'une langue absente n'est pas un choix.
  const subtitleToTv = useCallback((next: SubtitleTrack) => {
    if (view !== 'remote' || castSubtitles.length === 0) return;
    void castSubtitle(activeSubtitleId(castSubtitles, next)).then(ok => {
      setRemoteError(ok ? null : TV_SUBTITLE_ERROR);
    });
  }, [view, castSubtitles, castSubtitle]);

  // Hors de la télécommande, son message d'échec des sous-titres n'a plus d'objet : il ne reparaît pas dans l'en-tête.
  useEffect(() => {
    if (view !== 'remote') setRemoteError(prev => (prev === TV_SUBTITLE_ERROR ? null : prev));
  }, [view]);

  // Get current video URL based on selected track
  const getVideoUrl = useCallback(() => {
    if (!streamingUrls) return rental?.videoUrl || '';
    if (audioTrack === 'vf' && hasVF) return streamingUrls.vf!;
    if (audioTrack === 'vo' && hasVO) return streamingUrls.vo!;
    return streamingUrls.vf || streamingUrls.vo || rental?.videoUrl || '';
  }, [streamingUrls, audioTrack, hasVF, hasVO, rental?.videoUrl]);

  // Check if 80%+ of the film has been watched locally (sur la TV, c'est le service qui suit la fin)
  const hasReachedMilestone = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.duration) return false;
    return video.currentTime / video.duration >= 0.8;
  }, []);

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

  // Bouton STFR/STEN : cliquer la langue active la coupe, cliquer l'autre bascule dessus.
  const handleSubtitleTrackChange = useCallback((lang: Exclude<SubtitleTrack, 'off'>) => {
    const next: SubtitleTrack = subtitleTrack === lang ? 'off' : lang;
    setSubtitleTrack(next);
    subtitleToTv(next);
  }, [subtitleTrack, subtitleToTv]);

  // Touche T : off → FR → EN → off, en ne s'arrêtant que sur les langues réellement présentes.
  const cycleSubtitleTrack = useCallback(() => {
    const cycle: SubtitleTrack[] = ['off', ...availableSubtitles];
    const next = cycle[(cycle.indexOf(subtitleTrack) + 1) % cycle.length] ?? 'off';
    setSubtitleTrack(next);
    subtitleToTv(next);
  }, [availableSubtitles, subtitleTrack, subtitleToTv]);

  // Restore playback position after track change
  useEffect(() => {
    const video = videoRef.current;
    if (video && currentTime > 0) {
      video.currentTime = currentTime;
      if (playerState === 'playing') {
        video.play().catch(() => {});
      }
    }
    // Volontairement déclenché par le seul changement de piste : ajouter currentTime relancerait un
    // seek à chaque timeupdate, et playerState ferait rejouer la vidéo à chaque pause.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioTrack]);

  // Aligner explicitement les textTracks du <video> sur la sélection. L'attribut `default` d'un <track>
  // inséré APRÈS le parse n'est pas honoré de façon fiable (la piste reste en mode 'disabled') ; avec une
  // seule langue le symptôme était intermittent, avec deux il devient un « je clique STEN et rien ne
  // change ». `addtrack` couvre le cas où la piste est montée après ce rendu (remount du <video> sur
  // changement VF/VO).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const tracks = video.textTracks;
    const applySelection = () => {
      for (const track of Array.from(tracks)) {
        track.mode = subtitleTrack !== 'off' && track.language === subtitleTrack ? 'showing' : 'disabled';
      }
    };
    applySelection();
    tracks.addEventListener('addtrack', applySelection);
    return () => tracks.removeEventListener('addtrack', applySelection);
  }, [subtitleTrack, videoUrl]);

  // Multi-device sync: refresh rental data on player open so seek picks up
  // progress made elsewhere (other browser/device, or background cast).
  // Non-blocking: local seek effect below uses current store value immediately;
  // when fetchMe resolves with a newer watchPosition, that effect re-runs.
  useEffect(() => {
    if (!isPlayerOpen) {
      setRentalFreshFor(null);
      return;
    }
    const film = currentPlayingFilm;
    void fetchMe().finally(() => setRentalFreshFor(film));
  }, [isPlayerOpen, currentPlayingFilm, fetchMe]);

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
  }, [stopRW, currentPlayingFilm, hasReachedMilestone, rental?.rewindClaimed, updateRentalProgress]);

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
  }, [closePlayer, stopRW, currentPlayingFilm, hasReachedMilestone, rental?.rewindClaimed, updateRentalProgress]);

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

  // La proposition « BE KIND REWIND » se ferme en éjectant (bouton, Échap, fin du rembobinage). Film fini sur la TV :
  // la machine l'oublie aussi, plus de puce « Film terminé ». Le lecteur se ferme d'abord : son dernier enregistrement
  // voit encore le film terminé et n'écrase pas les 100 % notés par le service.
  const ejectAfterPrompt = useCallback(() => {
    closePlayer();
    if (view === 'ended') castDismiss();
  }, [closePlayer, castDismiss, view]);

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
      ejectAfterPrompt();
    } else {
      setPlayerState('paused');
      setShowBlueScreen(true);
    }
  }, [pendingEject, ejectAfterPrompt]);

  // ===== Keyboard Controls (VCR style) =====
  useEffect(() => {
    if (!isPlayerOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;

      // Pendant un Cast, le clavier ne touche plus la vidéo locale : Échap et E referment le lecteur et la TV
      // continue ; Espace pilote la TV, T change ses sous-titres.
      if (remoteActive) {
        if (e.key === 'Escape' || e.key === 'e' || e.key === 'E') {
          closePlayer();
        } else if (e.key === ' ' && view === 'remote') {
          e.preventDefault();
          castToggle();
        } else if ((e.key === 't' || e.key === 'T') && availableSubtitles.length > 0) {
          cycleSubtitleTrack();
        }
        return;
      }

      // Block most keys during rewind-to-start or rewind flow (only Escape allowed)
      if (rewindingToStart) {
        if (e.key === 'Escape') handleEject();
        return;
      }
      if (rewindPhase !== 'none') {
        if (e.key === 'Escape') {
          if (rewindPhase === 'prompt') {
            if (pendingEject) {
              ejectAfterPrompt();
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
          if (playerState === 'rewinding' || playerState === 'fastforwarding') {
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
          if (availableSubtitles.length > 0) {
            cycleSubtitleTrack();
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
  }, [isPlayerOpen, playerState, rewindingToStart, rewindPhase, pendingEject, closePlayer, closeRewindModal, ejectAfterPrompt, handleEject, handleStop, handleFFCycle, handleRWCycle, handleRewindToStart, resumePlayFromRW, hasVF, hasVO, availableSubtitles, cycleSubtitleTrack, audioTrack, handleAudioTrackChange, stopRW, remoteActive, view, castToggle]);

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

  // « Regarder sur TV » : la demande part DANS le gestionnaire de l'appui (le sélecteur d'appareils exige son
  // activation), avec la version, les sous-titres et la position d'ici. La machine du Cast décide du reste.
  const sendToTv = useCallback(() => {
    if (currentPlayingFilm === null) return;
    setRemoteError(null);
    castFilm(currentPlayingFilm, {
      audio: audioTrack,
      subtitle: subtitleTrack,
      startAt: Math.max(videoRef.current?.currentTime || 0, rental?.watchPosition || 0),
    });
  }, [currentPlayingFilm, castFilm, audioTrack, subtitleTrack, rental?.watchPosition]);

  const handleWatchOnTV = useCallback(() => {
    // D'abord la vidéo d'ici se tait, quelle que soit la suite (Cast, AirPlay, message, confirmation) : sans pause(),
    // un élément qui n'a encore rien joué garde sa lecture automatique armée, et partirait seul sous un message.
    videoRef.current?.pause();
    setShowMobileRemotePrompt(false);
    // Appareils Apple : le SDK Cast y est bloqué, la TV passe par AirPlay (règle lue sur l'élément, voir appleAirPlay).
    if (typeof navigator !== 'undefined' && appleAirPlay(navigator.userAgent, videoRef.current as AirPlayVideoElement | null)) {
      handleAirPlayPicker();
      return;
    }
    // Un autre film passe sur la TV : il n'est remplacé qu'après confirmation (« Oui » relance la demande).
    if (view === 'other-on-tv') {
      setConfirmReplace(true);
      return;
    }
    sendToTv();
  }, [handleAirPlayPicker, view, sendToTv]);

  // « Continuer sur smartphone » : le visiteur a choisi ici, la lecture part maintenant (jamais avant sa réponse).
  const handleWatchHere = useCallback(() => {
    setShowMobileRemotePrompt(false);
    void videoRef.current?.play().catch(() => {});
  }, []);

  // ===== Le Cast vu du lecteur : chaque effet lit la machine, aucun n'écrit son état =====

  // Filet de sécurité : /admin monte le lecteur hors de l'application. Le service ne s'initialise qu'une fois, quel
  // que soit le premier à le demander.
  useEffect(() => {
    startCast();
  }, [startCast]);

  // La TV prend ce film (sélecteur, connexion, lancement, télécommande, liaison perdue) ou vient de le finir : la vidéo
  // locale se tait — jamais le film sur les deux écrans, jamais sous « BE KIND REWIND » ; l'invite n'a plus d'objet.
  useEffect(() => {
    if (!tvOwnsFilm) return;
    stopRW();
    setFfSpeed(0);
    const video = videoRef.current;
    if (video) {
      video.playbackRate = 1;
      video.pause();
    }
    setPlayerState('paused');
    setShowMobileRemotePrompt(false);
  }, [tvOwnsFilm, stopRW]);

  // Lancement vers la TV raté pour ce film, même vu à l'ouverture du lecteur, même au bureau : la vidéo d'ici ne part
  // pas d'elle-même. pause() désarme aussi la lecture automatique d'un élément qui n'a encore rien joué.
  useEffect(() => {
    if (castFailedHere) videoRef.current?.pause();
  }, [castFailedHere, videoUrl]);

  // La question « Remplacer … ? » tombe avec son bandeau : elle ne reparaît pas d'elle-même au film suivant sur la TV.
  useEffect(() => {
    if (view !== 'other-on-tv') setConfirmReplace(false);
  }, [view]);

  // La TV joue ce film : la proposition de rembobinage faite à l'ouverture (fin estimée trop tôt par le serveur, film
  // en pause sur la TV) cède la place à la télécommande, qu'elle couvrirait.
  useEffect(() => {
    if (remoteActive && rewindPhase === 'prompt' && !pendingEject) setRewindPhase('none');
  }, [remoteActive, rewindPhase, pendingEject]);

  // Le Cast rend la main à ce téléphone (« Arrêter », « Continuer sur ce téléphone », arrêt venu d'ailleurs) : reprise
  // à la position de la TV (inconnue : celle de la location), lecture seulement si le visiteur l'a demandée.
  useEffect(() => {
    const video = videoRef.current;
    if (!castResume || castResume.filmId !== currentPlayingFilm || !video) return;
    const taken = takeCastResume(currentPlayingFilm);
    if (!taken) return;
    video.currentTime = taken.position ?? rental?.watchPosition ?? 0;
    if (taken.play) void video.play().catch(() => {});
    else video.pause();
  }, [castResume, currentPlayingFilm, takeCastResume, rental?.watchPosition]);

  // L'invite revient quand le film n'est pas parti sur la TV : une attente (sélecteur, connexion, lancement) qui
  // retombe sur « local » — sélecteur refermé, « Annuler », connexion ou lancement raté (`connect_failed` et
  // `load_failed` arrivent toujours ainsi). La vidéo reste en pause jusqu'à la réponse.
  const viewBeforeRef = useRef(view);
  useEffect(() => {
    const before = viewBeforeRef.current;
    viewBeforeRef.current = view;
    const fellBack = before === 'choosing' || before === 'connecting' || before === 'loading';
    if (isMobile && view === 'local' && fellBack) setShowMobileRemotePrompt(true);
  }, [view, isMobile]);

  // « Cast indisponible » ouvre le panneau « recopie d'écran », qui le dit.
  useEffect(() => {
    if (castMissing) openMirroringFallback('cast');
  }, [castMissing, openMirroringFallback]);

  // Push notification subscription handler — aucun appelant, voir la note sur pushSubscribed en haut
  // du composant.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

  // ===== Watch Progress Reporting (every 10s) =====
  // Lecture locale seulement : pendant un Cast la vidéo d'ici est en pause, et c'est le service qui tient la position.
  useEffect(() => {
    if (!isPlayerOpen || !currentPlayingFilm) return;

    const interval = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.duration === 0 || video.paused) return;

      const progress = Math.round((video.currentTime / video.duration) * 100);
      updateRentalProgress(currentPlayingFilm, progress, video.currentTime).catch(() => {});

    }, 10000);

    return () => clearInterval(interval);
  }, [isPlayerOpen, currentPlayingFilm, updateRentalProgress]);

  // ===== Flush position on player close =====
  //
  // The 10s save loop above can miss the final position if the user closes
  // the player mid-interval. This ref captures the latest snapshot-saver
  // closure on every render, and the useEffect cleanup invokes it when
  // isPlayerOpen flips false (or the component unmounts), guaranteeing one
  // final write to rental.watchPosition.
  const flushPositionRef = useRef<(() => void) | null>(null);
  flushPositionRef.current = () => {
    // Seule la lecture d'ici s'enregistre ici. La TV a le film, ou vient de le finir : le service tient la position, et
    // la vidéo locale, en pause depuis, écraserait la sienne (voire les 100 % d'une fin vue sur la TV).
    if (!currentPlayingFilm || tvOwnsFilm) return;
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
  }, [currentPlayingFilm, stopRW, rental?.rewindClaimed, closePlayer, updateRentalProgress]);

  // ===== BE KIND REWIND : fin vue par la TV, ou film déjà fini à l'ouverture =====
  // Une seule décision (rewindPromptFor). Fin vue par la TV : ÉJECTER, ou la sortie si le rembobinage est déjà
  // réclamé. Film vu jusqu'au bout ailleurs (fin de lecture, fin estimée d'un Cast, téléphone éteint) : proposé une
  // fois par ouverture et par film, et « NON MERCI » laisse revoir le film (pendingEject faux).
  const rewindOfferedForRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isPlayerOpen || !currentPlayingFilm) {
      rewindOfferedForRef.current = null;
      return;
    }
    if (!rental) return;
    // Une proposition est déjà affichée (fin de lecture, STOP, fin du Cast) : on ne s'en mêle pas.
    if (rewindPhase !== 'none') {
      rewindOfferedForRef.current = currentPlayingFilm;
      return;
    }
    const decision = rewindPromptFor({
      tv: view === 'ended' ? 'ended' : remoteActive ? 'busy' : 'free',
      offered: rewindOfferedForRef.current === currentPlayingFilm,
      fresh: rentalFreshFor === currentPlayingFilm,
      watchProgress: rental.watchProgress ?? 0,
      rewindClaimed: !!rental.rewindClaimed,
    });
    // Données pas encore relues, ou la TV a ce film : on décidera plus tard (si le Cast s'arrête, la vue redevient
    // locale et l'effet repasse ; s'il finit, la vue passe à « ended »).
    if (decision === 'wait') return;
    rewindOfferedForRef.current = currentPlayingFilm;
    if (decision === 'skip') return;
    if (decision === 'close') {
      ejectAfterPrompt();
      return;
    }
    videoRef.current?.pause();
    setPlayerState('paused');
    setPendingEject(decision === 'eject');
    setRewindPhase('prompt');
  }, [isPlayerOpen, currentPlayingFilm, rental, view, remoteActive, rentalFreshFor, rewindPhase, ejectAfterPrompt]);

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
      setConfirmReplace(false);
      setRewindPhase('none');
      setRewindProgress(0);
      setPendingEject(false);
      setRewindCredited(false);
      // Rien du Cast ici : la TV continue sans le lecteur, et le service la suit (voir src/cast/).
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
  }, [isPlayerOpen, stopRW, setReviewContent]);

  // ===== Overlay auto-hide (4s inactivity) =====
  const resetIdleTimer = useCallback(() => {
    setOverlayVisible(true);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      setOverlayVisible(false);
    }, 4000);
  }, []);

  // Une ligne du Cast est sous l'en-tête (message, bandeau d'un autre film, question « Remplacer … ? ») : l'en-tête ne se
  // masque pas, « Réessayer », « Oui », « Non » et ✕ restent visibles et actifs sans bouger la souris.
  const castLineShown = view === 'other-on-tv' || (noticeHere !== null && !castMissing);

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
      if (checkPortraitMobile() || remoteActive || castLineShown) disableAutoHide();
      else enableAutoHide();
    };

    apply();
    window.addEventListener('resize', apply);

    return () => {
      window.removeEventListener('resize', apply);
      disableAutoHide();
    };
  }, [isPlayerOpen, rewindPhase, rewindingToStart, resetIdleTimer, isMobile, remoteActive, castLineShown]);

  if (!isPlayerOpen || !rental) return null;
  const connectedTvLabel = tvDeviceName || (isAirPlayConnected ? 'TV AirPlay connectée' : null);

  // STFR / STEN de la télécommande (les pistes que la TV sait charger), et l'échec d'une bascule, qui sans eux
  // resterait muet : les commandes VHS sont démontées pendant le Cast.
  const castSubtitleRow = castSubtitles.length === 0 ? null : (
    <>
      {castSubtitles.map(track => {
        const isActive = activeSubtitleId(castSubtitles, subtitleTrack) === track.id;
        return (
          <button
            key={track.id}
            type="button"
            className={`${castStyles.nowPlayingSecondaryBtn} ${isActive ? castStyles.nowPlayingSubtitleBtnActive : ''}`}
            aria-pressed={isActive}
            onClick={() => handleSubtitleTrackChange(track.language)}
          >
            {track.language === 'fr' ? 'STFR' : 'STEN'}
          </button>
        );
      })}
      {remoteError && <div className={castStyles.nowPlayingError} role="alert">{remoteError}</div>}
    </>
  );

  return (
    <div className={styles.player} style={!overlayVisible && rewindPhase === 'none' ? { cursor: 'none' } : undefined}>
      {/* Chrome haut en trois colonnes : retour (à la borne ou au vidéoclub,
          selon l'origine) à gauche, titre (avec le timer de location) au
          centre, cast / AirPlay / miroir empilés à droite ; dessous, les
          lignes du Cast. Masqué quand la TV a ce film : les panneaux du Cast
          occupent alors tout l'écran et portent leurs propres actions. */}
      {!remoteActive && (
        <div className={styles.header} style={{
          opacity: overlayVisible ? 1 : 0,
          transition: 'opacity 0.4s',
          pointerEvents: overlayVisible ? 'auto' : 'none',
        }}>
          <div className={styles.headerLeft}>
            <button
              type="button"
              className={styles.backToStoreBtn}
              onClick={handleEject}
              title={playerFrom === 'kiosk' ? 'Retourner à la borne [Échap]' : 'Retourner dans le vidéoclub [Échap]'}
            >
              <span aria-hidden="true">←</span> {playerFrom === 'kiosk' ? 'RETOUR À LA BORNE' : 'RETOUR VIDÉOCLUB'}
            </button>
          </div>

          <div className={styles.headerCenter}>
            {currentFilm && <span className={styles.filmTitle}>{currentFilm.title}</span>}
            <div className={styles.rentalTimer}>
              <RentalTimer expiresAt={rental.expiresAt} />
            </div>
          </div>

          <div className={styles.headerRight}>
            <div className={styles.castStack}>
              <button
                type="button"
                onClick={handleWatchOnTV}
                className={`${styles.castStackBtn} ${tvDeviceName ? styles.castStackBtnActive : ''}`}
                title={
                  tvDeviceName
                    ? `Connecté à ${tvDeviceName}`
                    : castAvailable === null
                      ? 'Google Cast en cours de chargement…'
                      : castAvailable
                        ? 'Google Cast'
                        : 'Google Cast indisponible sur ce navigateur'
                }
                style={castAvailable === null && !tvDeviceName ? { opacity: 0.5, cursor: 'wait' } : undefined}
              >
                {tvDeviceName ? 'CAST ON' : castAvailable === null ? 'CAST…' : castAvailable ? 'CAST' : 'CAST ?'}
              </button>
              <button
                type="button"
                onClick={handleAirPlayPicker}
                className={`${styles.castStackBtn} ${isAirPlayConnected ? styles.castStackBtnActive : ''}`}
                title={isAirPlayConnected ? 'AirPlay actif' : isAirPlaySupported ? 'AirPlay' : 'AirPlay indisponible'}
              >
                {isAirPlayConnected ? 'AIRPLAY ON' : isAirPlayAvailable ? 'AIRPLAY' : 'AIRPLAY ?'}
              </button>
              <button
                type="button"
                onClick={() => openMirroringFallback('generic')}
                className={styles.castStackBtn}
                title="Mode miroir (fallback)"
              >
                MIROIR
              </button>
            </div>
            {remoteError && <div className={styles.castError}>{remoteError}</div>}
          </div>

          {view === 'other-on-tv' && (
            <OtherFilmBanner
              confirming={confirmReplace}
              onConfirm={() => {
                setConfirmReplace(false);
                sendToTv();
              }}
              onCancel={() => setConfirmReplace(false)}
            />
          )}
          <CastNoticeLine filmId={rental.filmId} onRetry={sendToTv} />
        </div>
      )}

      {/* Video element with key to force reload on track change. La vidéo
          locale ne part d'elle-même que si la TV n'a pas ce film, que
          l'invite « Regarder sur TV ? » a eu sa réponse et qu'aucun lancement
          vers la TV ne vient d'échouer : jamais le film sur les deux écrans,
          jamais de lecture lancée d'office sous l'invite ou sous un message. */}
      <video
        key={`${audioTrack}-${videoUrl}`}
        ref={videoRef}
        className={styles.video}
        crossOrigin={hasRemoteSubtitles ? 'anonymous' : undefined}
        autoPlay={view === 'local' && !showMobileRemotePrompt && rewindPhase === 'none' && !castFailedHere}
        playsInline
        onPlay={() => {
          // La TV a ce film, le prend ou vient de le finir : la vidéo locale ne joue pas en même temps.
          if (tvOwnsFilm) {
            videoRef.current?.pause();
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
            playerState !== 'fastforwarding'
          ) {
            setPlayerState('paused');
            // Persist the local pause position. Without this, the 10s save loop
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
        {/* Une seule piste montée à la fois, avec `default` pour qu'elle s'affiche : swapper le `src`
            d'un <track> déjà monté ne rafraîchit pas la textTrack côté navigateur, alors qu'un
            démontage/remontage (via la key) est le chemin que le toggle on/off empruntait déjà. */}
        {subtitleTrack !== 'off' && (
          <track
            key={subtitleTrack}
            kind="subtitles"
            src={(subtitleTrack === 'fr' ? streamingUrls?.subtitles : streamingUrls?.subtitles_en) ?? undefined}
            srcLang={subtitleTrack}
            label={SUBTITLE_LABELS[subtitleTrack].label}
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

      {/* Le Cast de ce film : attente (sélecteur, connexion, lancement), télécommande ou liaison perdue. Rien en
          lecture locale, ni pour un autre film sur la TV ou un film fini : bandeau et « BE KIND REWIND » sont au lecteur. */}
      <CastPanels
        filmId={rental.filmId}
        title={currentFilm?.title ?? ''}
        onBack={closePlayer}
        subtitles={castSubtitleRow}
        posterUrl={currentFilm?.poster_path ? `/api/poster/w200${currentFilm.poster_path}` : undefined}
      />

      {showMobileRemotePrompt && rewindPhase === 'none' && !remoteActive && (
        <div className={styles.mobileRemotePrompt}>
          <div className={styles.mobileRemotePromptTitle}>Regarder sur TV ?</div>
          <div className={styles.mobileRemotePromptText}>
            {connectedTvLabel
              ? `TV connectée: ${connectedTvLabel}`
              : 'Caster/AirPlay disponible si votre TV est sur le même Wi-Fi.'}
          </div>
          <div className={styles.mobileRemotePromptActions}>
            <button className={styles.mobileRemotePrimaryBtn} onClick={handleWatchOnTV}>
              {connectedTvLabel ? `Regarder sur ${connectedTvLabel}` : 'Regarder sur TV'}
            </button>
            <button className={styles.mobileRemoteSecondaryBtn} onClick={handleWatchHere}>
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
              <button onClick={ejectAfterPrompt} className={styles.ejectRewindBtn}>
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
                    { label: REVIEW_RATING_LABELS.direction, value: ratingDirection, setter: setRatingDirection },
                    { label: REVIEW_RATING_LABELS.screenplay, value: ratingScreenplay, setter: setRatingScreenplay },
                    { label: REVIEW_RATING_LABELS.acting, value: ratingActing, setter: setRatingActing },
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
                    placeholder={`Votre critique (au moins ${MIN_CONTENT_LENGTH} caractères)…`}
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
              <div className={styles.mirroringContextHint}>{CAST_UNAVAILABLE_TEXT}</div>
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
            <button
              className={styles.mirroringCloseBtn}
              onClick={() => {
                setShowMirroringHelp(false);
                // Le message « Cast indisponible » est lu : la machine l'oublie.
                if (castMissing) castDismiss();
              }}
            >
              FERMER
            </button>
          </div>
        </div>
      )}

      {/* VCR Controls — only show when not in rewind sequence AND when the TV
          doesn't have this film (the Cast panels above carry their own
          controls; rendering both produced the duplicate-UI bug). */}
      {rewindPhase === 'none' && !rewindingToStart && !remoteActive && (
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
          subtitleTrack={subtitleTrack}
          onSubtitleTrackChange={handleSubtitleTrackChange}
          hasVF={hasVF}
          hasVO={hasVO}
          hasSubtitlesFr={hasSubtitlesFr}
          hasSubtitlesEn={hasSubtitlesEn}
        />
        </div>
      )}
    </div>
  );
}
