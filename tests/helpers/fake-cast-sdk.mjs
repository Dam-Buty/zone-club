// Faux Web Sender SDK de Google Cast, pour faire tourner src/cast/cast-service.ts sous Node
// (tests/domain/cast-service.test.mjs). Il ne simule que ce dont le service se sert, avec les comportements
// mesurés sur le Pixel 9a le 18/11/2026 que les tests rejouent : séance reprise sans objet média, réponse brute à
// GET_STATUS, envoi qui lève sur une liaison morte, fin de film où RemotePlayer est remis à zéro.

export const MEDIA_NAMESPACE = 'urn:x-cast:com.google.cast.media';
const SESSION_STATE_CHANGED = 'sessionstatechanged';
const CAST_STATE_CHANGED = 'caststatechanged';
const MEDIA_SESSION = 'mediasession';
const VOLUME_LEVEL_CHANGED = 'volumelevelchanged';

const on = (map, type, fn) => { (map[type] ??= []).push(fn); };
const emit = (map, type, data) => { for (const fn of map[type] ?? []) fn(data); };

/**
 * Pose `window`, `document` et, si `sdk`, `cast.framework` et `chrome.cast` sur `globalThis`. Sans SDK, le
 * chargeur pose sa balise de script : `fake.scripts[0].onerror()` simule un navigateur sans Cast.
 */
export function installFakeCastSdk({ sdk = true } = {}) {
  const calls = { setOptions: [], requestSession: 0, endCurrentSession: [], sendMessage: [], loadMedia: [], commands: [], setVolume: [] };
  const docListeners = {};
  const scripts = [];
  globalThis.window = globalThis;
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener: (type, fn) => on(docListeners, type, fn),
    querySelector: () => null,
    createElement: () => ({ dataset: {} }),
    head: { appendChild: (element) => { scripts.push(element); } },
  };
  delete globalThis.__onGCastApiAvailable;
  delete globalThis.cast;
  delete globalThis.chrome;

  let nextMediaSessionId = 1;
  const fake = {
    calls,
    scripts,
    context: null,
    player: null,
    controller: null,
    /** Page cachée ou affichée (visibilitychange), ou reprise après un gel (resume). */
    setVisibility(visibility) {
      globalThis.document.visibilityState = visibility;
      emit(docListeners, 'visibilitychange');
    },
    getStatusCount: () => calls.sendMessage.filter((m) => m.data?.type === 'GET_STATUS').length,

    makeSession(friendlyName = 'Salon') {
      const listeners = {};
      const messageListeners = [];
      const session = {
        mediaSession: null,
        sendMessageImpl: () => Promise.resolve(),
        loadMediaImpl: () => Promise.resolve(),
        setVolumeImpl: () => Promise.resolve(),
        getCastDevice: () => ({ friendlyName }),
        getMediaSession: () => session.mediaSession,
        loadMedia: (request) => { calls.loadMedia.push(request); return session.loadMediaImpl(request); },
        sendMessage: (namespace, data) => { calls.sendMessage.push({ namespace, data }); return session.sendMessageImpl(namespace, data); },
        addMessageListener: (namespace, fn) => { messageListeners.push({ namespace, fn }); },
        addEventListener: (type, fn) => on(listeners, type, fn),
        setVolume: (level) => { calls.setVolume.push(level); return session.setVolumeImpl(level); },
        /** Réponse du récepteur sur le canal média, telle que le SDK la remet (chaîne JSON). */
        reply(message) {
          for (const { namespace, fn } of messageListeners) if (namespace === MEDIA_NAMESPACE) fn(namespace, JSON.stringify(message));
        },
        /** Le SDK annonce une séance média (chargée ici, retrouvée, lancée ailleurs). */
        announceMedia(media) {
          session.mediaSession = media;
          emit(listeners, MEDIA_SESSION, { mediaSession: media });
        },
      };
      return session;
    },

    makeMedia({ filmId, playerState = 'PLAYING', currentTime = 10, duration = 600, preview = false } = {}) {
      const updateListeners = [];
      const media = {
        mediaSessionId: nextMediaSessionId++,
        playerState,
        idleReason: null,
        currentTime,
        activeTrackIds: [],
        media: { duration, customData: preview ? { filmId, preview: true } : { filmId } },
        /** Réponse aux commandes : 'ok', 'error', ou 'silent' (ni succès ni échec). */
        answer: 'ok',
        getEstimatedTime: () => media.currentTime,
        addUpdateListener: (fn) => { updateListeners.push(fn); },
        play: (_request, ok, ko) => command('play', media, ok, ko),
        pause: (_request, ok, ko) => command('pause', media, ok, ko),
        seek: (request, ok, ko) => command('seek', media, ok, ko, request.currentTime),
        editTracksInfo: (request, ok, ko) => command('editTracksInfo', media, ok, ko, request.activeTrackIds),
        /** Statut reçu du récepteur pour cet objet ; `isAlive` faux : la séance média est finie. */
        update(patch, isAlive = true) {
          Object.assign(media, patch);
          for (const fn of updateListeners) fn(isAlive);
        },
      };
      return media;
    },
  };

  function command(kind, media, ok, ko, value) {
    calls.commands.push(value === undefined ? kind : [kind, value]);
    if (media.answer === 'ok') ok();
    else if (media.answer === 'error') ko({ code: 'session_error' });
  }

  if (!sdk) return fake;

  const contextListeners = {};
  const context = {
    session: null,
    sessionState: 'NO_SESSION',
    requestSessionImpl: () => new Promise(() => {}),
    setOptions: (options) => { calls.setOptions.push(options); },
    getCurrentSession: () => context.session,
    getSessionState: () => context.sessionState,
    requestSession: () => { calls.requestSession += 1; return context.requestSessionImpl(); },
    /**
     * Comme le vrai : la séance passe par SESSION_ENDING tout de suite (getSessionState le dit), puis SESSION_ENDED
     * quand le récepteur a répondu (ici au tour suivant de la file des promesses). Sans séance, rien.
     */
    endCurrentSession: (stopCasting) => {
      calls.endCurrentSession.push(stopCasting);
      const ending = context.session;
      if (!ending) return;
      context.emitSession('SESSION_ENDING', ending);
      Promise.resolve().then(() => {
        if (context.session === ending) context.emitSession('SESSION_ENDED', ending);
      });
    },
    addEventListener: (type, fn) => on(contextListeners, type, fn),
    /** Séance présente avant l'initialisation : page rechargée pendant un Cast. */
    resume(session) {
      context.session = session;
      context.sessionState = 'SESSION_RESUMED';
    },
    emitSession(sessionState, session = context.session) {
      context.sessionState = sessionState;
      if (sessionState === 'SESSION_ENDED') context.session = null;
      emit(contextListeners, SESSION_STATE_CHANGED, { sessionState, session });
    },
    emitCastState(castState) {
      emit(contextListeners, CAST_STATE_CHANGED, { castState });
    },
  };
  fake.context = context;

  class RemotePlayer {
    constructor() {
      this.volumeLevel = 1;
      this.currentTime = 0;
      this.duration = 0;
      fake.player = this;
    }
  }
  class RemotePlayerController {
    constructor(player) {
      this.player = player;
      this.listeners = {};
      fake.controller = this;
    }
    addEventListener(type, fn) { on(this.listeners, type, fn); }
    /** Le récepteur annonce un nouveau volume. */
    setVolume(level) {
      this.player.volumeLevel = level;
      emit(this.listeners, VOLUME_LEVEL_CHANGED);
    }
  }

  globalThis.cast = {
    framework: {
      CastContext: { getInstance: () => context },
      CastContextEventType: { CAST_STATE_CHANGED, SESSION_STATE_CHANGED },
      SessionEventType: { MEDIA_SESSION },
      RemotePlayer,
      RemotePlayerController,
      RemotePlayerEventType: { VOLUME_LEVEL_CHANGED },
    },
  };
  globalThis.chrome = {
    cast: {
      AutoJoinPolicy: { ORIGIN_SCOPED: 'origin_scoped' },
      media: {
        DEFAULT_MEDIA_RECEIVER_APP_ID: 'CC1AD845',
        StreamType: { BUFFERED: 'BUFFERED' },
        TrackType: { TEXT: 'TEXT' },
        TextTrackType: { SUBTITLES: 'SUBTITLES' },
        MediaInfo: class { constructor(contentId, contentType) { this.contentId = contentId; this.contentType = contentType; } },
        GenericMediaMetadata: class {},
        Track: class { constructor(trackId, trackType) { this.trackId = trackId; this.type = trackType; } },
        LoadRequest: class { constructor(media) { this.media = media; } },
        SeekRequest: class {},
        EditTracksInfoRequest: class { constructor(activeTrackIds) { this.activeTrackIds = activeTrackIds; } },
      },
    },
  };
  return fake;
}
