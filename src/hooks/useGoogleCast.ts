import { useCallback, useEffect, useRef, useState } from 'react';

const GOOGLE_CAST_SDK_URL = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';

type CastState = 'NO_DEVICES_AVAILABLE' | 'NOT_CONNECTED' | 'CONNECTING' | 'CONNECTED' | 'UNKNOWN';

// Remote player state from Cast SDK
export type RemotePlayerState = 'IDLE' | 'PLAYING' | 'PAUSED' | 'BUFFERING' | 'UNKNOWN';

interface CastMediaMetadata {
  title?: string;
}

interface CastMediaInfo {
  streamType?: string;
  metadata?: CastMediaMetadata;
}

interface CastLoadRequest {
  autoplay: boolean;
  currentTime: number;
}

interface CastSession {
  loadMedia: (request: CastLoadRequest) => Promise<void>;
  getCastDevice?: () => { friendlyName?: string };
}

interface CastContextInstance {
  setOptions: (options: { receiverApplicationId: string; autoJoinPolicy: string }) => void;
  getCastState?: () => string;
  addEventListener: (eventType: string, handler: (event: { castState?: string }) => void) => void;
  removeEventListener: (eventType: string, handler: (event: { castState?: string }) => void) => void;
  getCurrentSession: () => CastSession | null;
  requestSession: () => Promise<void>;
}

// RemotePlayer / RemotePlayerController interfaces (Cast SDK)
interface RemotePlayer {
  currentTime: number;
  duration: number;
  isPaused: boolean;
  playerState: string | null;
  isMediaLoaded: boolean;
  isConnected: boolean;
  volumeLevel: number;
  isMuted: boolean;
}

interface RemotePlayerController {
  addEventListener: (eventType: string, handler: () => void) => void;
  removeEventListener: (eventType: string, handler: () => void) => void;
  playOrPause: () => void;
  stop: () => void;
  seek: () => void;
  setVolumeLevel: () => void;
  muteOrUnmute: () => void;
}

interface RemotePlayerChangedEventType {
  CURRENT_TIME_CHANGED: string;
  DURATION_CHANGED: string;
  IS_PAUSED_CHANGED: string;
  PLAYER_STATE_CHANGED: string;
  IS_MEDIA_LOADED_CHANGED: string;
  IS_CONNECTED_CHANGED: string;
  VOLUME_LEVEL_CHANGED: string;
  IS_MUTED_CHANGED: string;
}

interface CastFrameworkNamespace {
  CastContext: {
    getInstance: () => CastContextInstance;
  };
  CastContextEventType: {
    CAST_STATE_CHANGED: string;
  };
  RemotePlayer: new () => RemotePlayer;
  RemotePlayerController: new (player: RemotePlayer) => RemotePlayerController;
  RemotePlayerEventType: RemotePlayerChangedEventType;
}

interface CastNamespace {
  framework: CastFrameworkNamespace;
}

interface ChromeCastNamespace {
  AutoJoinPolicy: {
    ORIGIN_SCOPED: string;
  };
  media: {
    DEFAULT_MEDIA_RECEIVER_APP_ID: string;
    StreamType: {
      BUFFERED: string;
    };
    MediaInfo: new (url: string, contentType: string) => CastMediaInfo;
    GenericMediaMetadata: new () => CastMediaMetadata;
    LoadRequest: new (mediaInfo: CastMediaInfo) => CastLoadRequest;
  };
}

interface CastGlobals {
  cast?: CastNamespace;
  chrome?: { cast?: ChromeCastNamespace };
  __onGCastApiAvailable?: (isAvailable: boolean) => void;
}

interface UseGoogleCastOptions {
  enabled: boolean;
  receiverApplicationId?: string;
}

interface CastMediaInput {
  url: string;
  title: string;
  currentTime: number;
  autoplay: boolean;
}

interface CastResult {
  ok: boolean;
  error?: string;
}

let castSdkPromise: Promise<boolean> | null = null;

function getCastGlobals(): CastGlobals {
  return window as typeof window & CastGlobals;
}

function normalizeCastState(rawState: string | undefined): CastState {
  if (!rawState) return 'UNKNOWN';
  if (rawState === 'NO_DEVICES_AVAILABLE') return 'NO_DEVICES_AVAILABLE';
  if (rawState === 'NOT_CONNECTED') return 'NOT_CONNECTED';
  if (rawState === 'CONNECTING') return 'CONNECTING';
  if (rawState === 'CONNECTED') return 'CONNECTED';
  return 'UNKNOWN';
}

function normalizePlayerState(raw: string | null): RemotePlayerState {
  if (!raw) return 'UNKNOWN';
  if (raw === 'IDLE') return 'IDLE';
  if (raw === 'PLAYING') return 'PLAYING';
  if (raw === 'PAUSED') return 'PAUSED';
  if (raw === 'BUFFERING') return 'BUFFERING';
  return 'UNKNOWN';
}

function loadCastSdk(): Promise<boolean> {
  if (castSdkPromise) return castSdkPromise;

  castSdkPromise = new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve(false);
      return;
    }

    const globals = getCastGlobals();
    if (globals.cast?.framework && globals.chrome?.cast) {
      resolve(true);
      return;
    }

    const timeout = window.setTimeout(() => {
      resolve(Boolean(globals.cast?.framework && globals.chrome?.cast));
    }, 8000);

    const previousCallback = globals.__onGCastApiAvailable;
    globals.__onGCastApiAvailable = (isAvailable: boolean) => {
      if (typeof previousCallback === 'function') previousCallback(isAvailable);
      window.clearTimeout(timeout);
      resolve(isAvailable);
    };

    const existingScript = document.querySelector<HTMLScriptElement>('script[data-google-cast-sdk="true"]');
    if (existingScript) return;

    const script = document.createElement('script');
    script.src = GOOGLE_CAST_SDK_URL;
    script.async = true;
    script.defer = true;
    script.dataset.googleCastSdk = 'true';
    script.onerror = () => {
      window.clearTimeout(timeout);
      resolve(false);
    };
    script.onload = () => {
      if (globals.cast?.framework && globals.chrome?.cast) {
        window.clearTimeout(timeout);
        resolve(true);
      }
    };
    document.head.appendChild(script);
  });

  return castSdkPromise;
}

export function useGoogleCast({ enabled, receiverApplicationId }: UseGoogleCastOptions) {
  const [isReady, setIsReady] = useState(false);
  const [castState, setCastState] = useState<CastState>('UNKNOWN');
  const [connectedDeviceName, setConnectedDeviceName] = useState<string | null>(null);

  // Remote player state — throttled to avoid re-render storm
  const [remoteCurrentTime, setRemoteCurrentTime] = useState(0);
  const [remoteDuration, setRemoteDuration] = useState(0);
  const [remoteIsPaused, setRemoteIsPaused] = useState(true);
  const [remotePlayerState, setRemotePlayerState] = useState<RemotePlayerState>('UNKNOWN');
  const [remoteIsMediaLoaded, setRemoteIsMediaLoaded] = useState(false);

  // Refs for RemotePlayer instances (persist across renders)
  const remotePlayerRef = useRef<RemotePlayer | null>(null);
  const remoteControllerRef = useRef<RemotePlayerController | null>(null);

  // Throttle ref for currentTime (fires ~1/s from Cast SDK)
  const remoteTimeRef = useRef(0);
  const throttleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let isCancelled = false;
    let cleanupListener: (() => void) | null = null;
    let cleanupRemote: (() => void) | null = null;

    loadCastSdk().then((loaded) => {
      if (isCancelled || !loaded) return;

      const globals = getCastGlobals();
      const cast = globals.cast;
      const chromeCast = globals.chrome?.cast;
      if (!cast?.framework || !chromeCast) return;

      const context = cast.framework.CastContext.getInstance();
      context.setOptions({
        receiverApplicationId: receiverApplicationId || chromeCast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: chromeCast.AutoJoinPolicy.ORIGIN_SCOPED,
      });

      setIsReady(true);
      setCastState(normalizeCastState(context.getCastState?.()));
      const initialDeviceName = context.getCurrentSession?.()?.getCastDevice?.()?.friendlyName || null;
      setConnectedDeviceName(initialDeviceName);

      // ===== RemotePlayer Setup =====
      const player = new cast.framework.RemotePlayer();
      const controller = new cast.framework.RemotePlayerController(player);
      remotePlayerRef.current = player;
      remoteControllerRef.current = controller;

      const eventTypes = cast.framework.RemotePlayerEventType;

      // Throttled currentTime: store in ref, flush to state every 1s
      const onCurrentTimeChanged = () => {
        remoteTimeRef.current = player.currentTime;
      };

      throttleTimerRef.current = setInterval(() => {
        setRemoteCurrentTime(remoteTimeRef.current);
      }, 1000);

      const onDurationChanged = () => setRemoteDuration(player.duration);
      const onIsPausedChanged = () => setRemoteIsPaused(player.isPaused);
      const onPlayerStateChanged = () => setRemotePlayerState(normalizePlayerState(player.playerState));
      const onIsMediaLoadedChanged = () => setRemoteIsMediaLoaded(player.isMediaLoaded);
      const onIsConnectedChanged = () => {
        if (!player.isConnected) {
          // Reset remote state on disconnect
          setRemoteIsMediaLoaded(false);
          setRemotePlayerState('UNKNOWN');
          setRemoteDuration(0);
          setRemoteCurrentTime(0);
          remoteTimeRef.current = 0;
        }
      };

      controller.addEventListener(eventTypes.CURRENT_TIME_CHANGED, onCurrentTimeChanged);
      controller.addEventListener(eventTypes.DURATION_CHANGED, onDurationChanged);
      controller.addEventListener(eventTypes.IS_PAUSED_CHANGED, onIsPausedChanged);
      controller.addEventListener(eventTypes.PLAYER_STATE_CHANGED, onPlayerStateChanged);
      controller.addEventListener(eventTypes.IS_MEDIA_LOADED_CHANGED, onIsMediaLoadedChanged);
      controller.addEventListener(eventTypes.IS_CONNECTED_CHANGED, onIsConnectedChanged);

      cleanupRemote = () => {
        controller.removeEventListener(eventTypes.CURRENT_TIME_CHANGED, onCurrentTimeChanged);
        controller.removeEventListener(eventTypes.DURATION_CHANGED, onDurationChanged);
        controller.removeEventListener(eventTypes.IS_PAUSED_CHANGED, onIsPausedChanged);
        controller.removeEventListener(eventTypes.PLAYER_STATE_CHANGED, onPlayerStateChanged);
        controller.removeEventListener(eventTypes.IS_MEDIA_LOADED_CHANGED, onIsMediaLoadedChanged);
        controller.removeEventListener(eventTypes.IS_CONNECTED_CHANGED, onIsConnectedChanged);
        if (throttleTimerRef.current) clearInterval(throttleTimerRef.current);
      };

      // Read initial remote state if already connected
      if (player.isMediaLoaded) {
        setRemoteCurrentTime(player.currentTime);
        setRemoteDuration(player.duration);
        setRemoteIsPaused(player.isPaused);
        setRemotePlayerState(normalizePlayerState(player.playerState));
        setRemoteIsMediaLoaded(true);
        remoteTimeRef.current = player.currentTime;
      }

      const handleStateChange = (event: { castState?: string }) => {
        const nextState = normalizeCastState(event.castState);
        setCastState(nextState);
        const deviceName = context.getCurrentSession?.()?.getCastDevice?.()?.friendlyName || null;
        setConnectedDeviceName(nextState === 'CONNECTED' ? deviceName : null);
      };

      context.addEventListener(cast.framework.CastContextEventType.CAST_STATE_CHANGED, handleStateChange);
      cleanupListener = () => {
        context.removeEventListener(cast.framework.CastContextEventType.CAST_STATE_CHANGED, handleStateChange);
      };
    });

    return () => {
      isCancelled = true;
      cleanupListener?.();
      cleanupRemote?.();
      remotePlayerRef.current = null;
      remoteControllerRef.current = null;
      if (throttleTimerRef.current) clearInterval(throttleTimerRef.current);
    };
  }, [enabled, receiverApplicationId]);

  const castMedia = useCallback(async ({ url, title, currentTime, autoplay }: CastMediaInput): Promise<CastResult> => {
    const globals = getCastGlobals();
    const cast = globals.cast;
    const chromeCast = globals.chrome?.cast;

    if (!cast?.framework || !chromeCast) {
      return { ok: false, error: 'Google Cast indisponible sur ce navigateur.' };
    }

    try {
      const context = cast.framework.CastContext.getInstance();
      let session = context.getCurrentSession();

      if (!session) {
        await context.requestSession();
        session = context.getCurrentSession();
      }

      if (!session) {
        return { ok: false, error: 'Aucune session Cast active.' };
      }

      const mediaInfo = new chromeCast.media.MediaInfo(url, 'video/mp4');
      mediaInfo.streamType = chromeCast.media.StreamType.BUFFERED;
      const metadata = new chromeCast.media.GenericMediaMetadata();
      metadata.title = title;
      mediaInfo.metadata = metadata;

      const request = new chromeCast.media.LoadRequest(mediaInfo);
      request.autoplay = autoplay;
      request.currentTime = Math.max(0, currentTime);

      await session.loadMedia(request);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Impossible de caster la vidéo.';
      return { ok: false, error: message };
    }
  }, []);

  // Remote controls — mutate RemotePlayer fields then call controller methods
  const remotePlayOrPause = useCallback(() => {
    remoteControllerRef.current?.playOrPause();
  }, []);

  const remoteStop = useCallback(() => {
    remoteControllerRef.current?.stop();
  }, []);

  const remoteSeek = useCallback((time: number) => {
    const player = remotePlayerRef.current;
    if (player) {
      player.currentTime = time;
      remoteControllerRef.current?.seek();
    }
  }, []);

  const remoteSetVolume = useCallback((level: number) => {
    const player = remotePlayerRef.current;
    if (player) {
      player.volumeLevel = level;
      remoteControllerRef.current?.setVolumeLevel();
    }
  }, []);

  // Get latest remote time from ref (for non-rendering reads)
  const getRemoteCurrentTime = useCallback(() => remoteTimeRef.current, []);

  return {
    isReady,
    castState,
    hasDevices: castState === 'NOT_CONNECTED' || castState === 'CONNECTING' || castState === 'CONNECTED',
    isConnected: castState === 'CONNECTED',
    connectedDeviceName,
    castMedia,
    // Remote state
    remoteCurrentTime,
    remoteDuration,
    remoteIsPaused,
    remotePlayerState,
    remoteIsMediaLoaded,
    // Remote controls
    remotePlayOrPause,
    remoteStop,
    remoteSeek,
    remoteSetVolume,
    getRemoteCurrentTime,
  };
}
