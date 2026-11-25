// Service Cast : un seul SDK pour toute l'application (docs/superpowers/specs/2026-11-18-cast-refonte-design.md, § 5.1).
//
// La seule partie impure du Cast. Il charge le Web Sender SDK de Google une fois et l'initialise une fois, traduit
// ce que dit le SDK en événements de la machine (cast-machine.ts), la fait tourner, et exécute les effets qu'elle
// rend. Il vit autant que la page : lecteur fermé, la TV reste suivie et le serveur informé.
//
// Ce que fait le SDK sur l'appareil (Pixel 9a, Chrome 157, récepteur standard, mesuré le 18/11/2026) :
// - un second appel d'initialisation coupe sans bruit le canal des commandes : le SDK se dit connecté, le temps
//   estimé avance, la TV n'obéit plus (D1). D'où un seul appel, ici ;
// - après un rechargement la séance est reprise en quelques millisecondes, mais sans média : GET_STATUS sur le
//   canal média le fait revenir en moins d'une seconde (F2) ;
// - sur une liaison morte, l'envoi lève InvalidStateError dans le SDK même : chaque appel au SDK est gardé ;
// - fin du film : la séance média dit IDLE / FINISHED et meurt, sa durée encore lisible, quand RemotePlayer a
//   déjà tout remis à zéro (F3, D4) ;
// - le sélecteur refermé rejette 'cancel' ; appelé sur une séance existante, il ouvre une fenêtre native
//   « Arrêter la diffusion » ; la fin de séance avec arrêt libère la TV ;
// - Chrome gèle une page cachée après 60 s et la reprend au retour (`resume`). Au retour la liaison de la page est
//   coupée (« Presentation connection is disconnected ») alors que le SDK se dit connecté, séance et objet média à
//   l'appui : tout envoi lève, et rien ne revient seul (30 s d'essais refusés). `chrome.cast.requestSessionById`
//   rejoint la séance sans fenêtre native : un NOUVEL objet de séance, où un envoi repasse 370 ms après — mais
//   SESSION_RESUMED n'est pas toujours annoncé (mesuré le 21/11/2026). D'où statusSendFailed : reprise demandée,
//   puis la demande de statut réessayée toutes les CAST_REJOIN_RETRY_MS sur la séance courante ;
// - sur une séance NEUVE (la TV lance l'application), le chargement se dit réglé avant d'avoir eu lieu : objet média
//   provisoire (IDLE) annoncé 86 ms après l'envoi puis abandonné, promesse réglée sans objet média ; la TV charge
//   le film 2 s plus tard et le SDK crée alors un autre objet, sans MEDIA_SESSION (mesuré le 21/11/2026). D'où
//   lookForMedia : sur un signal de RemotePlayer, et chaque seconde pendant le chargement.
//
// Règle : tout `catch` mène à un événement de la machine, aucune erreur avalée sans état. Deux exceptions
// voulues : un port serveur d'écriture qui rejette (l'envoi suivant rattrape ; une relecture de location qui rejette,
// elle, le dit : RENTAL_UNREAD) et un message illisible sur le canal média (le délai de la demande de statut conclut).

// Imports avec l'extension : Node charge ce fichier tel quel devant un faux SDK (tests/domain/cast-service.test.mjs).
import {
  castReduce, initialCastState, CAST_ACK_TIMEOUT_MS, CAST_REPORT_EVERY_MS, CAST_STATUS_TIMEOUT_MS,
} from './cast-machine.ts';
import type { CastCommand, CastEffect, CastEvent, CastMediaRequest, CastState } from './cast-machine.ts';
import { loadRequestData, mediaStatusEvent } from './cast-wire.ts';
import type { CastLoadData, CastMediaLike } from './cast-wire.ts';
import { __resetCastSdkForTests, castNamespaces, loadCastSdk } from './cast-sdk.ts';
import type {
  CafCastSession, CafChromeCast, CafContext, CafContextEvent, CafFramework, CafLoadRequest, CafMedia,
  CafRemotePlayer, CafRemotePlayerController,
} from './cast-sdk.ts';

/** Ce que le service demande au reste de l'application (la tranche du store les branche sur l'API et sur lui). */
export interface CastPorts {
  serverOpen(filmId: number, position: number, duration: number | null): Promise<unknown>;
  serverReport(filmId: number, position: number, duration: number | null): Promise<unknown>;
  serverClose(filmId: number, position: number | null, finished: boolean): Promise<unknown>;
  readRental(filmId: number): Promise<{ exists: boolean; watchProgress: number; watchPosition: number }>;
  remember(filmId: number | null): void;
  remembered(): number | null;
}

const MEDIA_NAMESPACE = 'urn:x-cast:com.google.cast.media';
/** Après l'initialisation, une séance se reprend en quelques ms (F2) : passé ce délai, `hasSession` est définitif. */
export const CAST_RESUME_SETTLE_MS = 500;
/** Position de la télécommande : au plus une fois par seconde (spec § 5.3). */
const POSITION_EVERY_MS = 1000;
/** Pendant le chargement, la séance est relue à cette cadence : son objet média peut arriver sans annonce. */
export const CAST_LOAD_LOOK_EVERY_MS = 1000;
/** Séance redemandée après un envoi impossible : la demande de statut est réessayée à cette cadence. */
export const CAST_REJOIN_RETRY_MS = 500;

type PhaseTimer = 'connect' | 'load';
type ServerEffect = Extract<CastEffect, { type: 'SERVER_OPEN' | 'SERVER_REPORT' | 'SERVER_CLOSE' }>;
interface Sdk {
  framework: CafFramework;
  chromeCast: CafChromeCast;
  context: CafContext;
  player: CafRemotePlayer;
  controller: CafRemotePlayerController;
}

let ports: CastPorts | null = null;
let state: CastState = initialCastState;
const listeners = new Set<(s: CastState) => void>();
const queue: CastEvent[] = [];
let dispatching = false;

let sdk: Sdk | null = null;
/** Le délai de reprise de séance est écoulé : SDK_READY peut partir (voir sdkReadyDue). */
let settled = false;
/** La séance média courante : commandes, position, sous-titres. Null quand la TV n'a pas de média connu. */
let media: CafMedia | null = null;
let watchedSessions = new WeakSet<CafCastSession>();
let watchedMedia = new WeakSet<CafMedia>();
/** Séances média finies : la séance peut les garder, avec leur dernier état — jamais reprises (lookForMedia). */
let deadMedia = new WeakSet<CafMedia>();

const phaseTimers: Partial<Record<PhaseTimer, ReturnType<typeof setTimeout>>> = {};
/** Échéance de la demande de statut en attente ; null : aucune demande sans réponse. */
let statusDeadline: ReturnType<typeof setTimeout> | null = null;
let statusRequestId = 0;
/**
 * Reprise de la séance pour la demande de statut en attente : demandée, ou déjà faite. Une seule par demande —
 * une séance rejointe dont l'envoi lève encore conclut à la liaison perdue, sans boucle.
 */
let rejoin: 'none' | 'asked' | 'done' = 'none';
let rejoinLoop: ReturnType<typeof setInterval> | null = null;
let tickLoop: ReturnType<typeof setInterval> | null = null;
let positionLoop: ReturnType<typeof setInterval> | null = null;
let loadLoop: ReturnType<typeof setInterval> | null = null;
let serverQueue: Promise<unknown> = Promise.resolve();

// ---------------------------------------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------------------------------------

/**
 * Démarre le service, une fois pour toute la page : les appels suivants ne font rien (la borne, le vidéoclub et
 * le lecteur de /admin le demandent tous). Charge le SDK, l'initialise, pose ses écouteurs pour la vie de la page.
 */
export function initCast(p: CastPorts): void {
  if (ports) return;
  ports = p;
  if (typeof window === 'undefined') return;
  listenToPage();
  void loadCastSdk().then((loaded) => {
    if (loaded) setUpSdk();
    else sdkMissing();
  });
}

export function getCastState(): CastState {
  return state;
}

/** Appelé à chaque changement d'état (pas à l'abonnement : lire getCastState). Rend la fonction de désabonnement. */
export function subscribeCast(listener: (s: CastState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Charge le script du SDK sans démarrer le service (8 s au plus). */
export function preloadCastSdk(): Promise<boolean> {
  return loadCastSdk();
}

/**
 * Réservé aux tests (tests/domain/cast-service.test.mjs) : remet le service dans l'état d'une page neuve. Le
 * service est un module unique ; sans cela, chaque cas hériterait du précédent.
 */
export function __resetCastForTests(): void {
  clearPhaseTimer('connect');
  clearPhaseTimer('load');
  clearStatusDeadline();
  if (tickLoop !== null) clearInterval(tickLoop);
  if (positionLoop !== null) clearInterval(positionLoop);
  if (loadLoop !== null) clearInterval(loadLoop);
  tickLoop = null;
  positionLoop = null;
  loadLoop = null;
  ports = null;
  state = initialCastState;
  listeners.clear();
  queue.length = 0;
  dispatching = false;
  sdk = null;
  settled = false;
  media = null;
  watchedSessions = new WeakSet<CafCastSession>();
  watchedMedia = new WeakSet<CafMedia>();
  deadMedia = new WeakSet<CafMedia>();
  statusRequestId = 0;
  serverQueue = Promise.resolve();
  __resetCastSdkForTests();
}

export function sendCast(event: CastEvent): void {
  // Un effet peut lever un événement pendant qu'on exécute ceux d'un pas (échec synchrone du SDK) : il attend son
  // tour, pour que les effets de chaque pas s'exécutent tous, dans l'ordre, sur l'état qui les a produits.
  queue.push(event);
  if (dispatching) return;
  dispatching = true;
  try {
    for (let next = queue.shift(); next; next = queue.shift()) {
      apply(next);
      if (queue.length === 0 && sdkReadyDue()) queue.push(sdkReadyEvent());
    }
  } finally {
    dispatching = false;
  }
}

/**
 * Bascule les sous-titres sur la TV sans recharger le film (`null` les coupe). Vrai quand la TV a accusé
 * réception ; faux sans média, sur refus ou sans réponse — la liaison est alors revérifiée.
 */
export function setCastSubtitle(trackId: number | null): Promise<boolean> {
  const current = media;
  const chromeCast = sdk?.chromeCast;
  if (!current || !chromeCast) return Promise.resolve(false);
  if ((current.activeTrackIds?.[0] ?? null) === trackId) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let done = false;
    const deadline = setTimeout(() => finish(false), CAST_ACK_TIMEOUT_MS);
    function finish(ok: boolean): void {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      if (!ok) requestStatus();
      resolve(ok);
    }
    try {
      const request = new chromeCast.media.EditTracksInfoRequest(trackId === null ? [] : [trackId]);
      // Documenté avec des rappels ; selon les versions la CAF rend aussi une promesse : on accepte les deux.
      const pending = current.editTracksInfo(request, () => finish(true), () => finish(false));
      if (pending && typeof pending.then === 'function') pending.then(() => finish(true), () => finish(false));
    } catch {
      finish(false);
    }
  });
}

// ---------------------------------------------------------------------------------------------------------
// La machine
// ---------------------------------------------------------------------------------------------------------

/**
 * Trace de recette, inerte tant que personne ne pose `window.__castTrace = []` dans la console (ou par CDP) : chaque
 * pas de la machine, et ce que le SDK rend au chargement. Ni adresse ni contenu d'événement : des noms et des numéros.
 * C'est elle qui a montré, sur le Pixel, où la réalité du SDK quittait nos hypothèses (voir l'en-tête).
 */
function traceSink(): unknown[] | null {
  const sink = (globalThis as { __castTrace?: unknown }).__castTrace;
  return Array.isArray(sink) ? sink : null;
}

function trace(what: string, detail?: () => unknown): void {
  traceSink()?.push({ at: new Date().toISOString().slice(11, 23), what, detail: detail?.() });
}

function apply(event: CastEvent): void {
  const step = castReduce(state, event);
  const from = state.phase;
  trace(event.type, () => ({ from, to: step.state.phase, filmId: step.state.filmId, notice: step.state.notice?.code ?? null, effects: step.effects.map((e) => e.type) }));
  if (step.state !== state) {
    state = step.state;
    for (const listener of [...listeners]) {
      try {
        listener(state);
      } catch (error) {
        // Pas une panne du Cast : elle remonte au navigateur, hors de cette pile, sans priver la machine des effets
        // de ce pas (un chargement sans son délai resterait en attente pour toujours).
        setTimeout(() => {
          throw error;
        }, 0);
      }
    }
  }
  for (const effect of step.effects) runEffect(effect);
  syncLoops();
}

/**
 * SDK_READY part une fois la reprise de séance tranchée (`hasSession` définitif, F2), et seulement au repos : la
 * machine l'ignore ailleurs et `available` resterait inconnu. Une demande faite avant (SDK à peine chargé) le
 * reporte donc au prochain retour au repos.
 */
function sdkReadyDue(): boolean {
  return settled && state.available === null && state.phase === 'idle';
}

function sdkReadyEvent(): CastEvent {
  const session = currentSession();
  if (session) watchSession(session);
  // La séance reprise avant SDK_READY a été retenue (voir fromTv) : son appareil n'est nommé que par cet événement.
  return { type: 'SDK_READY', hasSession: session !== null, deviceName: deviceNameOf(session), rememberedFilmId: rememberedFilm() };
}

/**
 * Ce que dit la TV. Avant SDK_READY, au repos, il est retenu : SDK_READY le résume (`hasSession`) et sa demande
 * de statut ramène le reste — sinon la machine quitterait le repos et ignorerait SDK_READY. Un statut
 * (`MEDIA_STATUS`, `NO_MEDIA`) qui part vers la machine répond à la demande de statut en attente : l'échéance
 * n'est levée qu'ici, jamais sur une réponse dont la machine n'aurait rien reçu.
 */
function fromTv(event: CastEvent): void {
  if (state.available === null && state.phase === 'idle') return;
  if (event.type === 'MEDIA_STATUS' || event.type === 'NO_MEDIA') clearStatusDeadline();
  sendCast(event);
}

function runEffect(effect: CastEffect): void {
  switch (effect.type) {
    case 'OPEN_PICKER': openPicker(); return;
    case 'LOAD_MEDIA': loadMedia(effect.filmId, effect.media); return;
    case 'REQUEST_STATUS': requestStatus(); return;
    case 'SEND_COMMAND': sendCommand(effect.command, effect.position, effect.paused); return;
    case 'STOP_AND_END_SESSION': stopAndEndSession(); return;
    case 'START_TIMER': startPhaseTimer(effect.timer, effect.ms); return;
    case 'CLEAR_TIMER': clearPhaseTimer(effect.timer); return;
    case 'SERVER_OPEN': case 'SERVER_REPORT': case 'SERVER_CLOSE': toServer(effect); return;
    case 'READ_RENTAL': readRental(effect.filmId); return;
    case 'REMEMBER_FILM': rememberFilm(effect.filmId); return;
    default: {
      // Un effet ajouté à la machine sans son cas ici ne compile pas : il ne serait jamais exécuté.
      const unhandled: never = effect;
      return unhandled;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------
// Le SDK : initialisation unique, puis ce qu'il dit
// ---------------------------------------------------------------------------------------------------------

function setUpSdk(): void {
  const found = castNamespaces();
  if (!found) {
    sdkMissing();
    return;
  }
  const { framework, chromeCast } = found;
  try {
    const context = framework.CastContext.getInstance();
    // Le seul appel du dépôt (D1, voir l'en-tête).
    context.setOptions({
      receiverApplicationId: process.env.NEXT_PUBLIC_GOOGLE_CAST_APP_ID || chromeCast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
      autoJoinPolicy: chromeCast.AutoJoinPolicy.ORIGIN_SCOPED,
    });
    const player = new framework.RemotePlayer();
    const controller = new framework.RemotePlayerController(player);
    sdk = { framework, chromeCast, context, player, controller };
    context.addEventListener(framework.CastContextEventType.SESSION_STATE_CHANGED, onSessionState);
    context.addEventListener(framework.CastContextEventType.CAST_STATE_CHANGED, onCastState);
    controller.addEventListener(framework.RemotePlayerEventType.VOLUME_LEVEL_CHANGED, onVolumeChanged);
    // RemotePlayer ne sert ici que de SIGNAL (jamais de source, D4) : « quelque chose a changé, relis la séance ».
    controller.addEventListener(framework.RemotePlayerEventType.IS_MEDIA_LOADED_CHANGED, lookForMedia);
    controller.addEventListener(framework.RemotePlayerEventType.PLAYER_STATE_CHANGED, lookForMedia);
  } catch {
    sdk = null;
    sdkMissing();
    return;
  }
  setTimeout(() => {
    settled = true;
    if (sdkReadyDue()) sendCast(sdkReadyEvent());
  }, CAST_RESUME_SETTLE_MS);
}

/**
 * Le SDK ne viendra pas. Une demande l'attendait pour ouvrir le sélecteur : elle échoue d'abord (« Impossible de
 * joindre… », « Réessayer »), puis le Cast est marqué indisponible — sinon elle disparaîtrait sans un mot.
 */
function sdkMissing(): void {
  if (state.phase === 'choosing') sendCast({ type: 'PICKER_FAILED' });
  sendCast({ type: 'SDK_UNAVAILABLE' });
}

function currentSession(): CafCastSession | null {
  if (!sdk) return null;
  try {
    return sdk.context.getCurrentSession();
  } catch {
    return null;                                     // chaque appelant en tire son événement (échec, hasSession)
  }
}

function deviceNameOf(session: CafCastSession | null): string | null {
  try {
    return session?.getCastDevice()?.friendlyName || null;
  } catch {
    return null;                                     // l'événement part sans nom d'appareil
  }
}

function rememberedFilm(): number | null {
  try {
    return ports?.remembered() ?? null;
  } catch {
    return null;                                     // SDK_READY part sans film mémorisé
  }
}

function onSessionState(event: CafContextEvent): void {
  const session = event.session ?? currentSession();
  switch (event.sessionState) {
    case 'SESSION_STARTING':
      fromTv({ type: 'SESSION_STARTING', deviceName: deviceNameOf(session) });
      return;
    case 'SESSION_STARTED': case 'SESSION_RESUMED':
      if (session) watchSession(session);
      fromTv({ type: 'SESSION_STARTED', deviceName: deviceNameOf(session), resumed: event.sessionState === 'SESSION_RESUMED' });
      // La séance rejointe après un envoi impossible, quand le SDK l'annonce : la demande de statut repart aussitôt.
      if (rejoin === 'asked') retryStatus();
      return;
    case 'SESSION_ENDED':
      onSessionEnded();
      return;
    // SESSION_START_FAILED : le rejet de requestSession le dit déjà, et lui seul distingue le sélecteur refermé
    // (« cancel », un geste du visiteur) d'une panne. SESSION_ENDING : la fin arrive avec SESSION_ENDED.
  }
}

/**
 * Fin de séance. En `connecting` ou `loading`, la machine attendrait son délai de 20 s : le visiteur apprend
 * tout de suite que la connexion ou le lancement a échoué.
 */
function onSessionEnded(): void {
  media = null;
  const phase = state.phase;
  fromTv({ type: 'SESSION_ENDED' });
  if (phase === 'connecting') sendCast({ type: 'PICKER_FAILED' });
  if (phase === 'loading') sendCast({ type: 'LOAD_FAILED' });
}

/** Appareil choisi dans le sélecteur : filet si SESSION_STARTING manque (la machine ignore le second des deux). */
function onCastState(event: CafContextEvent): void {
  if (event.castState === 'CONNECTING') fromTv({ type: 'SESSION_STARTING', deviceName: deviceNameOf(currentSession()) });
}

/** Le volume est celui du récepteur, pas du média : on rafraîchit le statut du média connu. */
function onVolumeChanged(): void {
  if (media) reportMedia(media);
}

function receiverVolume(): number {
  const level = sdk?.player.volumeLevel;
  return typeof level === 'number' ? level : 1;
}

/** Écouteurs propres à une séance (un objet par séance), posés une fois chacune. */
function watchSession(session: CafCastSession): void {
  if (!sdk || watchedSessions.has(session)) return;
  watchedSessions.add(session);
  try {
    session.addEventListener(sdk.framework.SessionEventType.MEDIA_SESSION, (event) => adoptMedia(event.mediaSession ?? null));
    session.addMessageListener(MEDIA_NAMESPACE, (_namespace, message) => onMediaMessage(session, message));
  } catch {
    sendCast({ type: 'STATUS_FAILED' });             // sans ces écouteurs, on n'entend plus la TV
  }
}

/**
 * Une séance média (chargée ici, retrouvée par GET_STATUS, lancée ailleurs) devient la courante : elle porte les
 * commandes et la fin du film. Écoutée une fois — marquée seulement si l'écouteur a pu être posé —, rapportée.
 */
function adoptMedia(next: CafMedia | null): void {
  if (!next) return;
  media = next;
  if (!watchedMedia.has(next)) {
    try {
      next.addUpdateListener((isAlive) => onMediaUpdate(next, isAlive));
    } catch {
      sendCast({ type: 'STATUS_FAILED' });
      return;
    }
    watchedMedia.add(next);
  }
  reportMedia(next);
}

/**
 * Chaque statut d'une séance média. Seule la courante parle : un ancien objet (film remplacé, séance arrêtée) peut
 * encore se dire en lecture ou mourir, et ce n'est plus vrai de la TV. Fin du film (F3) : IDLE / FINISHED, séance
 * morte, durée encore lisible sur l'objet. La courante qui meurt sans dire IDLE n'a plus de média à montrer.
 */
function onMediaUpdate(updated: CafMedia, isAlive: boolean): void {
  if (!isAlive) deadMedia.add(updated);
  if (updated !== media) return;
  if (!isAlive) media = null;
  if (!isAlive && updated.playerState !== 'IDLE') {
    fromTv({ type: 'NO_MEDIA' });
    return;
  }
  reportMedia(updated);
}

/** MEDIA_STATUS tiré de l'objet média lui-même, jamais de RemotePlayer (remis à zéro en fin de film, D4). */
function reportMedia(from: CafMedia): void {
  let event: CastEvent;
  try {
    event = mediaStatusEvent(from, receiverVolume());
  } catch {
    event = { type: 'STATUS_FAILED' };              // objet média illisible : la liaison est à vérifier
  }
  fromTv(event);
}

/**
 * La séance média que le SDK tient pour `session`. Pas encore d'objet : MEDIA_SESSION l'annoncera. Une séance qui
 * n'est plus la courante (finie entre la réponse et ce tour) ne parle plus : son dernier « en lecture » rouvrirait
 * la télécommande juste après « La diffusion… s'est arrêtée ».
 */
function adoptSessionMedia(session: CafCastSession): void {
  if (session !== currentSession()) return;
  let found: CafMedia | null;
  try {
    found = session.getMediaSession();
  } catch {
    fromTv({ type: 'STATUS_FAILED' });
    return;
  }
  if (found && !deadMedia.has(found)) adoptMedia(found);
}

/**
 * La séance tient-elle un objet média que nous ne suivons pas encore ? Un objet au repos ne dit rien de neuf (le
 * provisoire d'un chargement, le dernier d'un film fini) : seul un objet en lecture est repris.
 */
function lookForMedia(): void {
  const session = currentSession();
  if (!session) return;
  let found: CafMedia | null;
  try {
    found = session.getMediaSession();
  } catch {
    return;                                          // séance illisible : le délai du chargement ou le TICK concluront
  }
  if (found && found !== media && !deadMedia.has(found) && found.playerState !== 'IDLE') adoptMedia(found);
}

/**
 * Réponse à GET_STATUS sur le canal média, lue telle quelle : après un rechargement le SDK n'a pas encore d'objet
 * média (F2), seule la réponse brute dit ce que joue la TV. Liste vide : plus de média. Sinon, sa première entrée
 * fait le statut ; l'objet du SDK, quand il existe, est repris au tour suivant pour les commandes et la fin du
 * film. Seule une réponse attendue compte : hors demande, la séance média courante parle.
 */
function onMediaMessage(session: CafCastSession, message: unknown): void {
  if (statusDeadline === null) return;
  const status = mediaStatusList(message);
  if (status === null) return;                       // autre message ou illisible : l'échéance tranchera
  if (status.length === 0) {
    media = null;
    fromTv({ type: 'NO_MEDIA' });
    return;
  }
  const entry = statusEntry(status[0]);
  if (entry === null) return;                        // entrée illisible : l'échéance tranchera
  fromTv(mediaStatusEvent(entry, receiverVolume()));
  setTimeout(() => adoptSessionMedia(session), 0);
}

/**
 * Une entrée brute du statut. Le récepteur peut omettre `media` quand il n'a pas changé : on reprend celui de la
 * séance média courante, si c'est la même.
 */
function statusEntry(entry: unknown): CastMediaLike | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const raw = entry as CastMediaLike & { mediaSessionId?: unknown };
  const sameMedia = media !== null && raw.mediaSessionId !== undefined && raw.mediaSessionId === media.mediaSessionId;
  if ((raw.media === undefined || raw.media === null) && sameMedia) return { ...raw, media: media?.media };
  return raw;
}

function mediaStatusList(message: unknown): unknown[] | null {
  let data = message;
  if (typeof message === 'string') {
    try {
      data = JSON.parse(message);
    } catch {
      return null;                                   // voir l'appelant : l'échéance de la demande conclut
    }
  }
  if (typeof data !== 'object' || data === null) return null;
  const { type, status } = data as { type?: unknown; status?: unknown };
  return type === 'MEDIA_STATUS' && Array.isArray(status) ? status : null;
}

// ---------------------------------------------------------------------------------------------------------
// Effets vers la TV
// ---------------------------------------------------------------------------------------------------------

/**
 * OPEN_PICKER. SDK prêt : requestSession dans la pile même de l'appui, sans rien attendre avant — une activation
 * perdue et Chrome refuse le sélecteur. SDK pas encore là : on l'attend, au risque d'avoir perdu l'activation (le
 * visiteur a alors « Réessayer ») ; SDK absent → PICKER_FAILED.
 */
function openPicker(): void {
  if (sdk) {
    pickDevice(sdk);
    return;
  }
  void loadCastSdk().then(() => {
    if (state.phase !== 'choosing') return;          // demande annulée pendant le chargement
    if (sdk) pickDevice(sdk);
    else sendCast({ type: 'PICKER_FAILED' });
  });
}

function pickDevice(ready: Sdk): void {
  // Jamais le sélecteur sur une séance existante : Chrome ouvrirait sa fenêtre « Arrêter la diffusion » (D7).
  const session = currentSession();
  if (session) {
    joinSession(ready, session);
    return;
  }
  try {
    ready.context.requestSession().then(
      confirmSession,
      (reason: unknown) => sendCast({ type: reason === 'cancel' ? 'PICKER_CANCELLED' : 'PICKER_FAILED' }),
    );
  } catch {
    sendCast({ type: 'PICKER_FAILED' });
  }
}

/** Une séance existe déjà (reprise à l'instant, ou restée ouverte) : le film part dessus. */
function joinSession(ready: Sdk, session: CafCastSession): void {
  let sessionState: string | undefined;
  try {
    sessionState = ready.context.getSessionState?.();
  } catch {
    sessionState = undefined;                        // inconnu : on tente la séance, le chargement tranchera
  }
  // En train de se fermer (« Arrêter » à l'instant) : on ne charge pas dessus ; « Réessayer » repartira du
  // sélecteur une fois la TV libérée.
  if (sessionState === 'SESSION_ENDING') {
    sendCast({ type: 'PICKER_FAILED' });
    return;
  }
  watchSession(session);
  sendCast({ type: 'SESSION_STARTED', deviceName: deviceNameOf(session), resumed: true });
}

/** Le sélecteur a rendu une séance. SESSION_STATE_CHANGED l'annonce ; filet si l'événement manque. */
function confirmSession(): void {
  if (state.phase !== 'choosing' && state.phase !== 'connecting') return;
  const session = currentSession();
  if (!session) {
    sendCast({ type: 'PICKER_FAILED' });
    return;
  }
  watchSession(session);
  sendCast({ type: 'SESSION_STARTED', deviceName: deviceNameOf(session), resumed: false });
}

/** LOAD_MEDIA : le film part sur la séance ouverte ; le premier statut de lecture conclut. */
function loadMedia(filmId: number, request: CastMediaRequest): void {
  const session = currentSession();
  if (!sdk || !session) {
    sendCast({ type: 'LOAD_FAILED' });
    return;
  }
  try {
    // `tracked` n'est pas dans l'effet : c'est celui de la demande en cours, posé par le pas qui l'a émis.
    const load = buildLoadRequest(sdk.chromeCast, loadRequestData(filmId, request, state.tracked));
    session.loadMedia(load).then(
      () => {
        trace('loadMedia réglé', () => ({ media: mediaStateOf(session) }));
        adoptSessionMedia(session);
      },
      () => sendCast({ type: 'LOAD_FAILED' }),
    );
  } catch {
    sendCast({ type: 'LOAD_FAILED' });
  }
}

/** Pour la trace : l'état de l'objet média de la séance au moment où le chargement se dit réglé. */
function mediaStateOf(session: CafCastSession): string {
  try {
    return session.getMediaSession()?.playerState ?? 'aucun';
  } catch {
    return 'illisible';
  }
}

function buildLoadRequest(chromeCast: CafChromeCast, data: CastLoadData): CafLoadRequest {
  const m = chromeCast.media;
  const info = new m.MediaInfo(data.contentId, data.contentType);
  info.streamType = m.StreamType.BUFFERED;
  const metadata = new m.GenericMediaMetadata();
  metadata.title = data.title;
  info.metadata = metadata;
  info.customData = data.customData;
  // WebVTT side-loadés : le récepteur standard ne lit que les pistes texte. Déclarer des pistes impose le CORS au
  // MP4 comme au VTT (le stockage l'envoie sur les deux).
  if (data.tracks.length > 0) {
    info.tracks = data.tracks.map((t) => {
      const track = new m.Track(t.trackId, m.TrackType.TEXT);
      track.trackContentId = t.trackContentId;
      track.trackContentType = 'text/vtt';
      track.subtype = m.TextTrackType.SUBTITLES;
      track.name = t.name;
      track.language = t.language;
      track.customData = null;
      return track;
    });
  }
  const load = new m.LoadRequest(info);
  load.autoplay = data.autoplay;
  load.currentTime = data.currentTime;
  load.activeTrackIds = data.activeTrackIds;
  return load;
}

/**
 * REQUEST_STATUS : GET_STATUS sur le canal média (F2). La réponse revient par onMediaMessage ou par la séance
 * média ; silence au-delà de CAST_STATUS_TIMEOUT_MS → STATUS_FAILED ; exception ou rejet → statusSendFailed.
 */
function requestStatus(): void {
  const session = currentSession();
  if (!session) {
    sendCast({ type: 'STATUS_FAILED' });
    return;
  }
  watchSession(session);
  // L'échéance court depuis la plus ancienne demande restée sans réponse.
  statusDeadline ??= setTimeout(statusFailed, CAST_STATUS_TIMEOUT_MS);
  statusRequestId += 1;
  try {
    session.sendMessage(MEDIA_NAMESPACE, { type: 'GET_STATUS', requestId: statusRequestId }).then(undefined, () => {
      // Rejet tardif d'une demande déjà répondue : rien à conclure.
      if (statusDeadline !== null) statusSendFailed(session);
    });
  } catch {
    statusSendFailed(session);
  }
}

/**
 * La demande de statut n'a pas pu partir. Cas mesuré : la page revient d'un gel, sa liaison est coupée et le SDK ne
 * le sait pas (voir l'en-tête). On rejoint la séance par son identifiant, une fois par demande, puis la demande est
 * réessayée (retryStatus) jusqu'à ce qu'un envoi passe ; sinon l'échéance de la demande conclut à la liaison perdue,
 * et le TICK suivant retentera. Sans identifiant, sans cette fonction du SDK, ou envoi encore refusé après la
 * reprise : liaison perdue.
 */
function statusSendFailed(session: CafCastSession): void {
  if (rejoin === 'asked') return;                    // reprise en route
  if (rejoin === 'none' && askRejoin(session)) {
    rejoin = 'asked';
    statusDeadline ??= setTimeout(statusFailed, CAST_STATUS_TIMEOUT_MS);
    rejoinLoop ??= setInterval(retryStatus, CAST_REJOIN_RETRY_MS);
    trace('séance redemandée');
    return;
  }
  statusFailed();
}

/**
 * La demande de statut, renvoyée sur la séance courante — après la reprise c'est un autre objet. L'envoi lève
 * encore : la reprise n'a pas abouti, on réessaiera. Il passe : la réponse ou l'échéance concluront, et un refus
 * tardif de cet envoi conclut à la liaison perdue (`done`).
 */
function retryStatus(): void {
  if (rejoin !== 'asked') return;                    // un tour déjà programmé quand l'envoi est passé
  const session = currentSession();
  if (!session) return;
  watchSession(session);
  statusRequestId += 1;
  try {
    // Accepté : la reprise est faite, la réponse ou l'échéance concluront. Refusé (la séance rejointe n'est pas
    // encore la courante) : le tour suivant réessaie.
    session.sendMessage(MEDIA_NAMESPACE, { type: 'GET_STATUS', requestId: statusRequestId }).then(() => {
      if (rejoin !== 'asked') return;
      stopRejoinLoop();
      rejoin = 'done';
      trace('séance rejointe');
    }, () => undefined);
  } catch {
    // Liaison encore coupée : le prochain tour réessaie, l'échéance borne l'attente.
  }
}

function stopRejoinLoop(): void {
  if (rejoinLoop !== null) clearInterval(rejoinLoop);
  rejoinLoop = null;
}

function askRejoin(session: CafCastSession): boolean {
  try {
    const id = session.getSessionId?.();
    if (!id || !sdk || typeof sdk.chromeCast.requestSessionById !== 'function') return false;
    sdk.chromeCast.requestSessionById(id);
    return true;
  } catch {
    return false;                                    // l'appelant conclut : liaison perdue
  }
}

function clearStatusDeadline(): void {
  if (statusDeadline !== null) clearTimeout(statusDeadline);
  statusDeadline = null;
  rejoin = 'none';
  stopRejoinLoop();
}

function statusFailed(): void {
  clearStatusDeadline();
  sendCast({ type: 'STATUS_FAILED' });
}

/**
 * SEND_COMMAND par la séance média (lecture, pause, saut) ou par la séance (volume, celui du récepteur). Accusé →
 * COMMAND_DONE ; refus, exception ou silence au-delà de CAST_ACK_TIMEOUT_MS → COMMAND_FAILED.
 */
function sendCommand(command: CastCommand, position: number, paused: boolean): void {
  const ack = commandAck();
  const current = media;
  try {
    switch (command.kind) {
      case 'toggle':
        if (!current) return ack.failed();
        if (paused) current.play(null, ack.done, ack.failed);
        else current.pause(null, ack.done, ack.failed);
        return;
      case 'seekBy': {
        if (!current || !sdk) return ack.failed();
        const seek = new sdk.chromeCast.media.SeekRequest();
        const target = Math.max(0, position + command.seconds);
        seek.currentTime = state.duration > 0 ? Math.min(target, state.duration) : target;
        current.seek(seek, ack.done, ack.failed);
        return;
      }
      case 'volume': {
        const session = currentSession();
        if (!session) return ack.failed();
        session.setVolume(Math.min(1, Math.max(0, command.level))).then(ack.done, ack.failed);
        return;
      }
    }
  } catch {
    ack.failed();
  }
}

/** Un accusé par commande : le premier verdict compte, l'échéance est toujours levée. */
function commandAck(): { done: () => void; failed: () => void } {
  let settledAck = false;
  const deadline = setTimeout(() => verdict('COMMAND_FAILED'), CAST_ACK_TIMEOUT_MS);
  function verdict(type: 'COMMAND_DONE' | 'COMMAND_FAILED'): void {
    if (settledAck) return;
    settledAck = true;
    clearTimeout(deadline);
    sendCast({ type });
  }
  return { done: () => verdict('COMMAND_DONE'), failed: () => verdict('COMMAND_FAILED') };
}

/**
 * STOP_AND_END_SESSION : la TV s'arrête et revient à son accueil. Jamais d'exception vers l'appelant ; si le SDK
 * refuse (liaison morte), la séance est tenue pour finie : on ne s'en servira plus.
 */
function stopAndEndSession(): void {
  media = null;
  if (!sdk) {
    sendCast({ type: 'SESSION_ENDED' });
    return;
  }
  try {
    sdk.context.endCurrentSession(true);
  } catch {
    sendCast({ type: 'SESSION_ENDED' });
  }
}

function startPhaseTimer(timer: PhaseTimer, ms: number): void {
  clearPhaseTimer(timer);
  phaseTimers[timer] = setTimeout(() => {
    delete phaseTimers[timer];
    sendCast({ type: 'TIMEOUT', timer });
  }, ms);
}

function clearPhaseTimer(timer: PhaseTimer): void {
  const id = phaseTimers[timer];
  if (id !== undefined) clearTimeout(id);
  delete phaseTimers[timer];
}

// ---------------------------------------------------------------------------------------------------------
// Effets vers le serveur, par les ports
// ---------------------------------------------------------------------------------------------------------

/**
 * Appels au serveur en file : dans l'ordre d'émission, chacun après la fin du précédent — une position ne PART pas
 * après la clôture qui la suit, ni une lecture de location avant l'écriture qui la précède. (Sur le fil, un appel
 * abandonné après 10 s par `settle` peut encore aboutir plus tard : la file ordonne les envois, pas les arrivées.) Un
 * port d'écriture qui rejette est ignoré, voulu : l'envoi suivant (10 s) rattrape ; une relecture, voir readRental.
 */
function viaServer(call: (p: CastPorts) => Promise<unknown>): void {
  const p = ports;
  if (!p) return;
  serverQueue = serverQueue.then(() => call(p)).catch(() => undefined);
}

function toServer(effect: ServerEffect): void {
  viaServer((p) => {
    switch (effect.type) {
      case 'SERVER_OPEN': return p.serverOpen(effect.filmId, effect.position, effect.duration);
      case 'SERVER_REPORT': return p.serverReport(effect.filmId, effect.position, effect.duration);
      case 'SERVER_CLOSE': return p.serverClose(effect.filmId, effect.position, effect.finished);
    }
  });
}

/**
 * READ_RENTAL. Une relecture impossible (le port rejette : réseau, compte déconnecté) le dit à la machine : au repos,
 * aucune autre relecture ne repartirait, et le film mémorisé resterait « attendu » pour la vie de la page (B9).
 */
function readRental(filmId: number): void {
  viaServer(async (p) => {
    let read: Awaited<ReturnType<CastPorts['readRental']>>;
    try {
      read = await p.readRental(filmId);
    } catch {
      sendCast({ type: 'RENTAL_UNREAD', filmId });
      return;
    }
    sendCast({ type: 'RENTAL_STATE', filmId, exists: read.exists, watchProgress: read.watchProgress, watchPosition: read.watchPosition });
  });
}

function rememberFilm(filmId: number | null): void {
  try {
    ports?.remember(filmId);
  } catch {
    // Port qui échoue : ignoré, comme les ports serveur (voir viaServer).
  }
}

// ---------------------------------------------------------------------------------------------------------
// Surveillance : cadence, position, page
// ---------------------------------------------------------------------------------------------------------

function pageVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

/**
 * TICK toutes les CAST_REPORT_EVERY_MS en `remote` ou `lost`, POSITION chaque seconde en `remote` ; page visible.
 * En `loading`, la séance est relue chaque seconde (lookForMedia), page visible ou non.
 */
function syncLoops(): void {
  const visible = pageVisible();
  const watching = state.phase === 'remote' || state.phase === 'lost';
  tickLoop = keepLoop(tickLoop, visible && watching, CAST_REPORT_EVERY_MS, () => sendCast({ type: 'TICK' }));
  positionLoop = keepLoop(positionLoop, visible && state.phase === 'remote', POSITION_EVERY_MS, sendPosition);
  loadLoop = keepLoop(loadLoop, state.phase === 'loading', CAST_LOAD_LOOK_EVERY_MS, lookForMedia);
}

function keepLoop(
  loop: ReturnType<typeof setInterval> | null, wanted: boolean, ms: number, run: () => void,
): ReturnType<typeof setInterval> | null {
  if (wanted) return loop ?? setInterval(run, ms);
  if (loop !== null) clearInterval(loop);
  return null;
}

/** Position lue sur l'horloge de la séance média ; rien si elle n'a pas bougé (pause). */
function sendPosition(): void {
  if (!media) return;
  let position: number;
  try {
    position = media.getEstimatedTime();
  } catch {
    requestStatus();                                 // horloge illisible : la TV dira où elle en est
    return;
  }
  if (Number.isFinite(position) && position >= 0 && position !== state.position) sendCast({ type: 'POSITION', position });
}

function listenToPage(): void {
  document.addEventListener('visibilitychange', () => {
    const visible = document.visibilityState !== 'hidden';
    sendCast({ type: visible ? 'PAGE_VISIBLE' : 'PAGE_HIDDEN' });
    if (visible) probeLink();
  });
  // Page gelée (cachée depuis 60 s) puis reprise : la TV a pu finir ou s'arrêter entre-temps.
  document.addEventListener('resume', () => {
    sendCast({ type: 'PAGE_VISIBLE' });
    probeLink();
  });
}

/**
 * Au retour de la page, hors télécommande (là, PAGE_VISIBLE demande déjà le statut) : une séance restée ouverte —
 * film fini, film arrêté ailleurs — a pu perdre sa liaison pendant le gel (F6). Sans cette sonde le film suivant
 * partirait sur la liaison morte et « Réessayer » aussi, sans jamais repasser par le sélecteur. Un envoi qui lève :
 * la séance est redemandée. Rien d'autre n'en dépend : ni échéance, ni événement.
 */
function probeLink(): void {
  if (state.phase === 'remote' || state.phase === 'lost' || statusDeadline !== null) return;
  const session = currentSession();
  if (!session) return;
  try {
    session.sendMessage(MEDIA_NAMESPACE, { type: 'GET_STATUS', requestId: ++statusRequestId }).then(undefined, () => undefined);
  } catch {
    if (askRejoin(session)) trace('séance redemandée (sonde)');
  }
}
