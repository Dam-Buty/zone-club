// Le Web Sender SDK de Google Cast, vu du service (cast-service.ts) : ses types, réduits à ce que le service
// appelle, et le chargement du script (une balise marquée : si elle est déjà posée, on attend la même).
//
// Les membres sont écrits en propriétés (`nom: (…) => …`) : la garde « un seul appel d'initialisation du SDK
// dans src/ » compte les parenthèses ouvrantes après son nom (tests/domain/cast-service-wiring.test.mjs).

import type { CastMediaLike } from './cast-wire.ts';

const GOOGLE_CAST_SDK_URL = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
/** Au-delà, le navigateur n'a pas de Cast (Firefox, Safari) : le SDK ne se déclarera jamais. */
const CAST_SDK_LOAD_TIMEOUT_MS = 8000;

type OnSuccess = () => void;
type OnError = (error: unknown) => void;

/** `chrome.cast.media.Media` : la séance média, qui porte les commandes avec accusé et la fin du film (F3). */
export interface CafMedia extends CastMediaLike {
  mediaSessionId?: number;
  activeTrackIds?: number[] | null;
  getEstimatedTime: () => number;
  addUpdateListener: (listener: (isAlive: boolean) => void) => void;
  play: (request: null, onSuccess: OnSuccess, onError: OnError) => void;
  pause: (request: null, onSuccess: OnSuccess, onError: OnError) => void;
  seek: (request: CafSeekRequest, onSuccess: OnSuccess, onError: OnError) => void;
  editTracksInfo: (request: object, onSuccess: OnSuccess, onError: OnError) => Promise<void> | void;
}

/** `cast.framework.CastSession`. Les promesses rejettent avec un `chrome.cast.ErrorCode`. */
export interface CafCastSession {
  getCastDevice: () => { friendlyName?: string } | null;
  getMediaSession: () => CafMedia | null;
  loadMedia: (request: CafLoadRequest) => Promise<unknown>;
  sendMessage: (namespace: string, data: object) => Promise<unknown>;
  addMessageListener: (namespace: string, listener: (namespace: string, message: unknown) => void) => void;
  addEventListener: (type: string, handler: (event: { mediaSession?: CafMedia | null }) => void) => void;
  setVolume: (level: number) => Promise<unknown>;
}

/** Données des événements CAST_STATE_CHANGED et SESSION_STATE_CHANGED du contexte. */
export interface CafContextEvent {
  castState?: string;
  sessionState?: string;
  session?: CafCastSession | null;
}

/** `cast.framework.CastContext`. `requestSession` rejette `'cancel'` quand le visiteur referme le sélecteur. */
export interface CafContext {
  setOptions: (options: { receiverApplicationId: string; autoJoinPolicy: string }) => void;
  getCurrentSession: () => CafCastSession | null;
  getSessionState?: () => string;
  requestSession: () => Promise<unknown>;
  endCurrentSession: (stopCasting: boolean) => void;
  addEventListener: (type: string, handler: (event: CafContextEvent) => void) => void;
}

/** `cast.framework.RemotePlayer` : le service n'en lit que le volume du récepteur. */
export interface CafRemotePlayer {
  volumeLevel: number;
}

export interface CafRemotePlayerController {
  addEventListener: (type: string, handler: () => void) => void;
}

export interface CafFramework {
  CastContext: { getInstance: () => CafContext };
  CastContextEventType: { CAST_STATE_CHANGED: string; SESSION_STATE_CHANGED: string };
  SessionEventType: { MEDIA_SESSION: string };
  RemotePlayer: new () => CafRemotePlayer;
  RemotePlayerController: new (player: CafRemotePlayer) => CafRemotePlayerController;
  RemotePlayerEventType: { VOLUME_LEVEL_CHANGED: string; IS_MEDIA_LOADED_CHANGED: string; PLAYER_STATE_CHANGED: string };
}

export interface CafTrack {
  trackContentId: string;
  trackContentType: string;
  subtype: string;
  name: string;
  language: string;
  customData: null;
}

export interface CafMediaInfo {
  streamType?: string;
  metadata?: { title?: string };
  customData?: unknown;
  tracks?: CafTrack[];
}

export interface CafLoadRequest {
  autoplay: boolean;
  currentTime: number;
  activeTrackIds?: number[];
}

export interface CafSeekRequest {
  currentTime?: number;
}

export interface CafChromeCast {
  AutoJoinPolicy: { ORIGIN_SCOPED: string };
  media: {
    DEFAULT_MEDIA_RECEIVER_APP_ID: string;
    StreamType: { BUFFERED: string };
    TrackType: { TEXT: string };
    TextTrackType: { SUBTITLES: string };
    MediaInfo: new (contentId: string, contentType: string) => CafMediaInfo;
    GenericMediaMetadata: new () => { title?: string };
    Track: new (trackId: number, trackType: string) => CafTrack;
    LoadRequest: new (mediaInfo: CafMediaInfo) => CafLoadRequest;
    SeekRequest: new () => CafSeekRequest;
    EditTracksInfoRequest: new (activeTrackIds: number[]) => object;
  };
}

interface CastGlobals {
  cast?: { framework?: CafFramework };
  chrome?: { cast?: CafChromeCast };
  __onGCastApiAvailable?: (isAvailable: boolean) => void;
}

function castGlobals(): CastGlobals {
  return window as typeof window & CastGlobals;
}

/** Les deux espaces de noms du SDK, ou null s'il n'est pas (encore) là. */
export function castNamespaces(): { framework: CafFramework; chromeCast: CafChromeCast } | null {
  if (typeof window === 'undefined') return null;
  const globals = castGlobals();
  const framework = globals.cast?.framework;
  const chromeCast = globals.chrome?.cast;
  return framework && chromeCast ? { framework, chromeCast } : null;
}

let castSdkPromise: Promise<boolean> | null = null;

/** Réservé aux tests : oublie le chargement passé (appelé par la remise à neuf du service). */
export function __resetCastSdkForTests(): void {
  castSdkPromise = null;
}

/** Charge le script du SDK une fois ; vrai quand il s'est déclaré disponible. Ne rejette jamais. */
export function loadCastSdk(): Promise<boolean> {
  if (castSdkPromise) return castSdkPromise;

  castSdkPromise = new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve(false);
      return;
    }
    if (castNamespaces()) {
      resolve(true);
      return;
    }

    const globals = castGlobals();
    const timeout = window.setTimeout(() => resolve(castNamespaces() !== null), CAST_SDK_LOAD_TIMEOUT_MS);

    const previousCallback = globals.__onGCastApiAvailable;
    globals.__onGCastApiAvailable = (isAvailable: boolean) => {
      if (typeof previousCallback === 'function') previousCallback(isAvailable);
      window.clearTimeout(timeout);
      resolve(isAvailable);
    };

    if (document.querySelector('script[data-google-cast-sdk="true"]')) return;

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
      if (castNamespaces()) {
        window.clearTimeout(timeout);
        resolve(true);
      }
    };
    document.head.appendChild(script);
  });

  return castSdkPromise;
}
