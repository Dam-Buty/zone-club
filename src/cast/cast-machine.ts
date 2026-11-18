// Machine à états du Cast (docs/superpowers/specs/2026-11-18-cast-refonte-design.md, § 5.2 et 5.2 bis).
//
// Une seule fonction pure, (état, événement) → état + effets à lancer, décide de tout ce que fait le Cast. Le
// service (cast-service.ts) traduit les rappels du SDK en événements et exécute les effets ; la tranche du
// store publie l'état ; le lecteur ne fait plus que lire et demander. Avant elle, cinq effets React et deux
// gestionnaires écrivaient le même état et se contredisaient : télécommande qui n'obéit plus (D1), attente
// sans fin (D2), délai qui court pendant le choix de l'appareil (D3), fin du film jamais vue (D4).
//
// Aucun import de valeur : Node la charge telle quelle dans les tests (tests/domain/cast-machine.test.mjs).

/** Délais (ms). Aucun pendant le choix de l'appareil : le visiteur y prend le temps qu'il veut (D3). */
export const CAST_CONNECT_TIMEOUT_MS = 20000;
export const CAST_LOAD_TIMEOUT_MS = 20000;
/** Accusé d'une commande (lecture, saut, volume) attendu par le service avant de la déclarer perdue. */
export const CAST_ACK_TIMEOUT_MS = 5000;
/** Réponse à une demande de statut (GET_STATUS) ; au-delà, la liaison est perdue. */
export const CAST_STATUS_TIMEOUT_MS = 5000;
/** Cadence de surveillance : statut demandé à la TV et position envoyée au serveur. */
export const CAST_REPORT_EVERY_MS = 10000;

/** Fin sans signal FINISHED : au-delà de 95 % de la dernière durée connue, le film est vu (spec § 5.1). */
const END_RATIO = 0.95;

export type CastPhase = 'idle' | 'choosing' | 'connecting' | 'loading' | 'remote' | 'ended' | 'lost';
export type CastNotice = 'stopped_elsewhere' | 'tv_error' | 'rental_over' | 'connect_failed' | 'load_failed' | 'unavailable' | 'no_source';
export interface CastMediaRequest { url: string; title: string; startAt: number; subtitles: { id: number; url: string; language: 'fr' | 'en'; label: string }[]; activeSubtitleId: number | null }
export interface CastState {
  phase: CastPhase;
  available: boolean | null;      // null tant que le SDK n'a pas répondu
  connected: boolean;             // séance ouverte avec un appareil
  deviceName: string | null;
  /**
   * Film demandé, joué, fini ou perdu. Au repos, seulement le film mémorisé dont le Cast court peut-être
   * encore (page rechargée), sinon null : un film arrêté ou jamais parti est oublié, pour qu'une séance
   * retrouvée plus tard n'aille pas relire sa location et annoncer un arrêt qui n'a pas eu lieu. Le message et
   * la reprise locale portent leur propre film.
   */
  filmId: number | null;
  tracked: boolean;               // faux pour une prévisualisation /admin : aucun appel serveur
  position: number; duration: number; paused: boolean; volume: number;
  /**
   * Vrai dès que `position` a été lue sur la TV (statut) ou donnée par le serveur pour ce film. Faux après un
   * rechargement tant que ni l'une ni l'autre n'est arrivée : 0 n'y veut rien dire, et la machine n'envoie
   * alors aucune position (null) au lecteur ni au serveur.
   */
  positionKnown: boolean;
  busy: boolean;                  // une commande attend son accusé
  stopping: boolean;              // arrêt demandé : les statuts tardifs sont ignorés
  notice: { code: CastNotice; filmId: number | null; deviceName: string | null } | null;
  /** À reprendre en local. `position` null : inconnue, le lecteur reprend à la position de la location. */
  resume: { filmId: number; position: number | null; play: boolean } | null;
  /** Média demandé, gardé entre le sélecteur et le chargement ; null dès que la TV a pris le film ou au repos. */
  media: CastMediaRequest | null;
}
export type CastCommand = { kind: 'toggle' } | { kind: 'seekBy'; seconds: number } | { kind: 'volume'; level: number };
export type CastEvent =
  | { type: 'SDK_READY'; hasSession: boolean; rememberedFilmId: number | null } | { type: 'SDK_UNAVAILABLE' }
  | { type: 'REQUEST_CAST'; filmId: number; tracked: boolean; media: CastMediaRequest }
  | { type: 'PICKER_CANCELLED' } | { type: 'PICKER_FAILED' }
  | { type: 'SESSION_STARTING'; deviceName: string | null }
  | { type: 'SESSION_STARTED'; deviceName: string | null; resumed: boolean }
  | { type: 'SESSION_ENDED' }
  | { type: 'LOAD_FAILED' }
  // `preview` : lu dans customData.preview — le média a été lancé par une prévisualisation /admin.
  | { type: 'MEDIA_STATUS'; filmId: number | null; playerState: 'PLAYING' | 'PAUSED' | 'BUFFERING' | 'IDLE'; idleReason: 'FINISHED' | 'CANCELLED' | 'INTERRUPTED' | 'ERROR' | null; position: number; duration: number; volume: number; preview: boolean }
  | { type: 'NO_MEDIA' } | { type: 'STATUS_FAILED' }
  | { type: 'POSITION'; position: number }
  // `watchPosition` : la position notée par le serveur sur la location.
  | { type: 'RENTAL_STATE'; filmId: number; exists: boolean; watchProgress: number; watchPosition: number }
  | { type: 'RENTAL_GONE'; filmId: number }
  | { type: 'COMMAND'; command: CastCommand }
  | { type: 'COMMAND_DONE' } | { type: 'COMMAND_FAILED' }
  | { type: 'TIMEOUT'; timer: 'connect' | 'load' }
  | { type: 'TICK' } | { type: 'PAGE_VISIBLE' } | { type: 'PAGE_HIDDEN' }
  | { type: 'USER_CANCEL' } | { type: 'USER_STOP' } | { type: 'USER_TO_PHONE' } | { type: 'USER_RETRY' } | { type: 'USER_DISMISS' } | { type: 'RESUME_TAKEN' };
export type CastEffect =
  | { type: 'OPEN_PICKER' } | { type: 'LOAD_MEDIA'; filmId: number; media: CastMediaRequest }
  | { type: 'REQUEST_STATUS' } | { type: 'SEND_COMMAND'; command: CastCommand; position: number; paused: boolean }
  | { type: 'STOP_AND_END_SESSION' }
  | { type: 'START_TIMER'; timer: 'connect' | 'load'; ms: number } | { type: 'CLEAR_TIMER'; timer: 'connect' | 'load' }
  | { type: 'SERVER_OPEN'; filmId: number; position: number; duration: number | null }
  | { type: 'SERVER_REPORT'; filmId: number; position: number; duration: number | null }
  | { type: 'SERVER_CLOSE'; filmId: number; position: number | null; finished: boolean }
  | { type: 'READ_RENTAL'; filmId: number } | { type: 'REMEMBER_FILM'; filmId: number | null };
export type CastView = 'local' | 'choosing' | 'connecting' | 'loading' | 'remote' | 'ended' | 'lost' | 'other-on-tv';

export const initialCastState: CastState = {
  phase: 'idle', available: null, connected: false, deviceName: null, filmId: null,
  // Le suivi est fixé par la demande faite ici, ou, pour un film retrouvé sur la TV, par son média
  // (`preview`). Un film mémorisé est toujours suivi : seul un film suivi est mémorisé.
  tracked: true,
  position: 0, duration: 0, paused: false, volume: 1, positionKnown: false, busy: false, stopping: false,
  notice: null, resume: null, media: null,
};

type Step = { state: CastState; effects: CastEffect[] };
type MediaStatus = Extract<CastEvent, { type: 'MEDIA_STATUS' }>;
type CommandEvent = Extract<CastEvent, { type: 'COMMAND' | 'COMMAND_DONE' | 'COMMAND_FAILED' }>;
type WatchEvent = Extract<CastEvent, { type: 'TICK' | 'PAGE_VISIBLE' | 'PAGE_HIDDEN' | 'USER_RETRY' }>;

export function castReduce(state: CastState, event: CastEvent): Step {
  switch (event.type) {
    case 'SDK_UNAVAILABLE': return { state: toIdle(state, { available: false }), effects: [] };
    case 'SDK_READY': return onSdkReady(state, event);
    case 'REQUEST_CAST': return onRequest(state, event);
    case 'PICKER_CANCELLED': return state.phase === 'choosing' ? { state: toIdle(state), effects: [] } : unchanged(state);
    // La promesse du sélecteur rejette aussi quand la séance échoue APRÈS le choix de l'appareil.
    case 'PICKER_FAILED':
      return state.phase === 'choosing' || state.phase === 'connecting' ? failRequest(state, 'connect_failed', true) : unchanged(state);
    case 'SESSION_STARTING': return onSessionStarting(state, event);
    case 'SESSION_STARTED': return onSessionStarted(state, event);
    case 'SESSION_ENDED': return onSessionEnded(state);
    case 'LOAD_FAILED': return state.phase === 'loading' ? failRequest(state, 'load_failed', true) : unchanged(state);
    case 'TIMEOUT': return onTimeout(state, event.timer);
    case 'MEDIA_STATUS': return onMediaStatus(state, event);
    case 'NO_MEDIA': return onNoMedia(state);
    case 'STATUS_FAILED': return onStatusFailed(state);
    case 'POSITION': return state.phase === 'remote' ? { state: { ...state, position: event.position }, effects: [] } : unchanged(state);
    case 'RENTAL_STATE': return onRentalState(state, event);
    case 'RENTAL_GONE': return onRentalGone(state, event.filmId);
    case 'COMMAND': case 'COMMAND_DONE': case 'COMMAND_FAILED': return onCommand(state, event);
    case 'TICK': case 'PAGE_VISIBLE': case 'PAGE_HIDDEN': case 'USER_RETRY': return onWatch(state, event);
    case 'USER_CANCEL': return onCancel(state);
    case 'USER_STOP': return leaveTv(state, false);
    case 'USER_TO_PHONE': return leaveTv(state, true);
    case 'USER_DISMISS': return onDismiss(state);
    case 'RESUME_TAKEN': return { state: { ...state, resume: null }, effects: [] };
  }
}

/**
 * Ce que le lecteur de `filmId` doit montrer. `other-on-tv` : la TV est prise (ou en passe de l'être) par un
 * autre film — lecteur local normal, avec le bandeau « … est en cours sur … ».
 */
export function castView(state: CastState, filmId: number | null): CastView {
  if (state.phase === 'idle') return 'local';
  if (filmId !== null && state.filmId === filmId) return state.phase;
  switch (state.phase) {
    case 'connecting': case 'loading': case 'remote': case 'lost': return 'other-on-tv';
    // Le sélecteur n'a encore rien mis sur la TV ; un film terminé ne l'occupe plus.
    case 'choosing': case 'ended': return 'local';
  }
}

/** Film à signaler par la puce, lecteur fermé : la TV le joue, ne répond plus, ou vient de le finir. */
export function castOwnsFilm(state: CastState): number | null {
  switch (state.phase) {
    case 'remote': case 'lost': case 'ended': return state.filmId;
    case 'idle': case 'choosing': case 'connecting': case 'loading': return null;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Briques communes
// ---------------------------------------------------------------------------------------------------------

const unchanged = (state: CastState): Step => ({ state, effects: [] });
const durationOrNull = (duration: number): number | null => (duration > 0 ? duration : null);
const nearEnd = (state: CastState): boolean => state.duration > 0 && state.position >= END_RATIO * state.duration;
/** Position à transmettre (reprise locale, clôture serveur) : null quand la machine n'en connaît aucune. */
const knownPosition = (state: CastState): number | null => (state.positionKnown ? state.position : null);

/**
 * À poser dans le même pas que STOP_AND_END_SESSION : la séance se ferme. Plus connectée, une nouvelle
 * demande repasse par le sélecteur au lieu de charger sur une séance mourante ; arrêt demandé, les statuts
 * tardifs de l'ancien média n'ouvrent rien.
 */
const closingSession = { connected: false, stopping: true } satisfies Partial<CastState>;

/** Effets serveur (SERVER_*, READ_RENTAL, REMEMBER_FILM) : jamais pour une prévisualisation /admin. */
function ifTracked(state: CastState, ...effects: CastEffect[]): CastEffect[] {
  return state.tracked ? effects : [];
}

function clearTimerOf(phase: CastPhase): CastEffect[] {
  if (phase === 'connecting') return [{ type: 'CLEAR_TIMER', timer: 'connect' }];
  if (phase === 'loading') return [{ type: 'CLEAR_TIMER', timer: 'load' }];
  return [];
}

/** Retour au repos : le film y est oublié (voir `CastState.filmId`), aucune commande n'attend plus. */
function toIdle(state: CastState, patch: Partial<CastState> = {}): CastState {
  return { ...state, phase: 'idle', filmId: null, media: null, busy: false, ...patch };
}

function load(filmId: number, media: CastMediaRequest): CastEffect[] {
  return [{ type: 'LOAD_MEDIA', filmId, media }, { type: 'START_TIMER', timer: 'load', ms: CAST_LOAD_TIMEOUT_MS }];
}

/** Ce que dit un statut de lecture. Une durée absente (0) ne remplace pas la dernière connue du même film. */
function tvFields(state: CastState, e: MediaStatus, sameFilm: boolean): Pick<CastState, 'position' | 'positionKnown' | 'duration' | 'paused' | 'volume'> {
  return {
    position: e.position,
    positionKnown: true,
    duration: e.duration > 0 ? e.duration : sameFilm ? state.duration : 0,
    paused: e.playerState === 'PAUSED',
    volume: e.volume,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Issues : les arrivées que plusieurs événements partagent
// ---------------------------------------------------------------------------------------------------------

/** Lancement raté (appareil injoignable, film refusé, délai dépassé) : repos, message et « Réessayer ». */
function failRequest(state: CastState, code: 'connect_failed' | 'load_failed', clearTimer: boolean): Step {
  return {
    state: toIdle(state, { notice: { code, filmId: state.filmId, deviceName: state.deviceName } }),
    effects: clearTimer ? clearTimerOf(state.phase) : [],
  };
}

/**
 * La TV joue `filmId` : télécommande. `opening` : c'est le film qu'on vient de charger (séance serveur
 * ouverte) ; sinon on l'a retrouvé — page rechargée, liaison revenue — et on reprend son suivi.
 */
function enterRemote(state: CastState, e: MediaStatus, filmId: number, opening: boolean): Step {
  // Un film demandé ici, ou déjà le nôtre (liaison perdue puis revenue), garde son propre suivi. Un film
  // retrouvé sans demande d'ici (page rechargée, lancé ailleurs) est suivi sauf si son média se dit
  // prévisualisation — sinon un /admin rechargé suivrait l'aperçu sur une vraie location.
  const ours = opening || (state.phase === 'lost' && filmId === state.filmId);
  const next: CastState = {
    ...state,
    ...tvFields(state, e, filmId === state.filmId),
    phase: 'remote', filmId, media: null, busy: false,
    tracked: ours ? state.tracked : !e.preview,
    // Un échec annoncé ou une reprise locale de CE film ne sont plus vrais : jamais le film sur les deux écrans.
    notice: state.notice?.filmId === filmId ? null : state.notice,
    resume: state.resume?.filmId === filmId ? null : state.resume,
  };
  const at = { filmId, position: next.position, duration: durationOrNull(next.duration) };
  const effects: CastEffect[] = opening ? [{ type: 'CLEAR_TIMER', timer: 'load' }] : [];
  effects.push(...ifTracked(next, opening ? { type: 'SERVER_OPEN', ...at } : { type: 'SERVER_REPORT', ...at }, { type: 'REMEMBER_FILM', filmId }));
  return { state: next, effects };
}

/**
 * Fin du film sur la TV (F3) : la location est vue, la séance serveur close. La durée gardée est celle d'avant
 * la remise à zéro du SDK (D4) ; la position revient à 0, comme celle de la location (100 %, position 0). Le
 * film reste mémorisé jusqu'au rembobinage ou à l'éjection : c'est lui qui fait la puce « Film terminé ». La
 * séance avec la TV reste ouverte pour le film suivant.
 */
function finish(state: CastState, filmId: number): Step {
  return {
    state: { ...state, phase: 'ended', position: 0, busy: false, media: null },
    effects: ifTracked(state, { type: 'SERVER_CLOSE', filmId, position: null, finished: true }),
  };
}

/**
 * Le film s'est arrêté sans que le visiteur le demande ici : télécommande de la TV, notification d'Android,
 * menu Cast de Chrome, erreur de lecture, séance finie. Repos avec un message, lecteur EN PAUSE à la dernière
 * position connue — le visiteur n'est peut-être plus devant son téléphone, la lecture locale n'est jamais
 * relancée d'office. `closeAt` : position notée sur la séance serveur ; null quand la nôtre est périmée ou
 * inconnue.
 */
function interrupted(state: CastState, filmId: number, code: 'stopped_elsewhere' | 'tv_error', closeAt: number | null): Step {
  return {
    state: toIdle(state, {
      notice: { code, filmId, deviceName: state.deviceName },
      resume: { filmId, position: knownPosition(state), play: false },
    }),
    effects: ifTracked(state, { type: 'SERVER_CLOSE', filmId, position: closeAt, finished: false }, { type: 'REMEMBER_FILM', filmId: null }),
  };
}

/**
 * La location a disparu (échéance, retour, compte déconnecté) : la TV s'arrête, la séance se termine, une
 * ligne « Location terminée » reste. Pas de reprise locale : il n'y a plus rien à reprendre.
 */
function rentalOver(state: CastState, filmId: number): Step {
  return {
    state: toIdle(state, {
      ...closingSession,
      notice: { code: 'rental_over', filmId, deviceName: state.deviceName },
      resume: state.resume?.filmId === filmId ? null : state.resume,
    }),
    effects: [
      ...clearTimerOf(state.phase),
      { type: 'STOP_AND_END_SESSION' },
      ...ifTracked(state, { type: 'SERVER_CLOSE', filmId, position: null, finished: false }, { type: 'REMEMBER_FILM', filmId: null }),
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------
// SDK, demande et séance
// ---------------------------------------------------------------------------------------------------------

function onSdkReady(state: CastState, e: Extract<CastEvent, { type: 'SDK_READY' }>): Step {
  if (state.phase !== 'idle') return unchanged(state);
  // Le film mémorisé arrive sans position : ni la TV ni le serveur n'ont encore parlé.
  const next: CastState = { ...state, available: true, connected: e.hasSession, filmId: e.rememberedFilmId, positionKnown: false };
  // Une séance reprise dit elle-même ce qu'elle joue (F2) ; sans séance, seul le serveur sait si le film
  // mémorisé a fini ou s'est arrêté pendant que la page dormait.
  if (e.hasSession) return { state: next, effects: [{ type: 'REQUEST_STATUS' }] };
  if (e.rememberedFilmId !== null) return { state: next, effects: ifTracked(next, { type: 'READ_RENTAL', filmId: e.rememberedFilmId }) };
  return { state: next, effects: [] };
}

function onRequest(state: CastState, e: Extract<CastEvent, { type: 'REQUEST_CAST' }>): Step {
  switch (state.phase) {
    case 'choosing': case 'connecting': case 'loading':
      return unchanged(state);                                  // double appui : la première demande suit son cours
    case 'remote': case 'lost':
      return e.filmId === state.filmId ? unchanged(state) : startRequest(state, e);
    case 'idle': case 'ended':
      return startRequest(state, e);
  }
}

function startRequest(state: CastState, e: Extract<CastEvent, { type: 'REQUEST_CAST' }>): Step {
  if (state.available === false) {
    return { state: { ...state, notice: { code: 'unavailable', filmId: e.filmId, deviceName: null } }, effects: [] };
  }
  const released = releaseFilm(state);
  const next: CastState = {
    ...state,
    filmId: e.filmId, tracked: e.tracked, media: e.media,
    // Position demandée, pas encore confirmée par la TV.
    position: e.media.startAt, positionKnown: false, duration: 0, paused: false, busy: false,
    stopping: false, notice: null, resume: null,
  };
  // Séance déjà ouverte : chargement direct. Jamais le sélecteur sur une séance existante (fenêtre native, D7).
  if (state.connected) return { state: { ...next, phase: 'loading' }, effects: [...released, ...load(e.filmId, e.media)] };
  return { state: { ...next, phase: 'choosing' }, effects: [...released, { type: 'OPEN_PICKER' }] };
}

/** Le film que la nouvelle demande remplace : sa séance serveur est close à sa position, il n'est plus mémorisé. */
function releaseFilm(state: CastState): CastEffect[] {
  const filmId = state.filmId;
  if (filmId === null) return [];
  switch (state.phase) {
    case 'remote': case 'lost':
      return ifTracked(state, { type: 'SERVER_CLOSE', filmId, position: knownPosition(state), finished: false }, { type: 'REMEMBER_FILM', filmId: null });
    case 'ended':
      return ifTracked(state, { type: 'REMEMBER_FILM', filmId: null });
    case 'idle': case 'choosing': case 'connecting': case 'loading':
      return [];
  }
}

function onSessionStarting(state: CastState, e: Extract<CastEvent, { type: 'SESSION_STARTING' }>): Step {
  if (state.phase !== 'choosing') return unchanged(state);
  // Appareil choisi : le délai ne court qu'à partir d'ici (D3).
  return {
    state: { ...state, phase: 'connecting', deviceName: e.deviceName },
    effects: [{ type: 'START_TIMER', timer: 'connect', ms: CAST_CONNECT_TIMEOUT_MS }],
  };
}

function onSessionStarted(state: CastState, e: Extract<CastEvent, { type: 'SESSION_STARTED' }>): Step {
  const connected: CastState = { ...state, connected: true, deviceName: e.deviceName ?? state.deviceName };
  switch (state.phase) {
    case 'choosing': case 'connecting':
      if (state.filmId === null || state.media === null) return failRequest(state, 'load_failed', true);
      return {
        state: { ...connected, phase: 'loading' },
        effects: [{ type: 'CLEAR_TIMER', timer: 'connect' }, ...load(state.filmId, state.media)],
      };
    case 'idle':
      // Séance reprise (rechargement) ou ouverte ailleurs (menu Cast de Chrome) : on demande à la TV ce
      // qu'elle joue (F2). Une nouvelle séance solde l'arrêt demandé sur l'ancienne.
      return { state: { ...connected, stopping: false }, effects: [{ type: 'REQUEST_STATUS' }] };
    case 'loading': case 'remote': case 'lost': case 'ended':
      // Le SDK fait foi pour la connexion : sans elle, le Cast suivant rouvrirait le sélecteur sur une
      // séance existante (fenêtre native parasite, D7).
      return { state: connected, effects: [] };
  }
}

function onSessionEnded(state: CastState): Step {
  switch (state.phase) {
    case 'remote': case 'lost':
      if (state.filmId === null) return unchanged(state);
      return interrupted({ ...state, connected: false }, state.filmId, 'stopped_elsewhere', knownPosition(state));
    case 'idle': case 'choosing': case 'connecting': case 'loading': case 'ended':
      return { state: { ...state, connected: false, stopping: false }, effects: [] };
  }
}

function onTimeout(state: CastState, timer: 'connect' | 'load'): Step {
  if (timer === 'connect' && state.phase === 'connecting') return failRequest(state, 'connect_failed', false);
  if (timer === 'load' && state.phase === 'loading') return failRequest(state, 'load_failed', false);
  return unchanged(state);                                      // délai périmé
}

// ---------------------------------------------------------------------------------------------------------
// Ce que dit la TV
// ---------------------------------------------------------------------------------------------------------

function onMediaStatus(state: CastState, e: MediaStatus): Step {
  const filmId = e.filmId;
  if (filmId === null) return unchanged(state);                // média que nous n'avons pas lancé
  const idle = e.playerState === 'IDLE';
  if (!idle && state.stopping) return unchanged(state);         // statut tardif d'un film qu'on a arrêté
  switch (state.phase) {
    case 'loading':
      // Seul le film demandé, en lecture, conclut le chargement : l'ancien média de la TV peut encore
      // parler (IDLE « interrompu », dernier statut de lecture) avant d'être remplacé.
      return !idle && filmId === state.filmId ? enterRemote(state, e, filmId, true) : unchanged(state);
    case 'idle':
      return idle ? unchanged(state) : enterRemote(state, e, filmId, false);
    case 'remote': case 'lost':
      if (filmId !== state.filmId) return idle ? unchanged(state) : replacedOnTv(state, e, filmId);
      if (idle) return onTvIdle(state, filmId, e.idleReason);
      if (state.phase === 'lost') return enterRemote(state, e, filmId, false);
      return { state: { ...state, ...tvFields(state, e, true), busy: false }, effects: [] };
    case 'choosing': case 'connecting': case 'ended':
      return unchanged(state);
  }
}

function onTvIdle(state: CastState, filmId: number, reason: MediaStatus['idleReason']): Step {
  switch (reason) {
    case 'FINISHED': return finish(state, filmId);
    case 'ERROR': return interrupted(state, filmId, 'tv_error', knownPosition(state));
    case 'CANCELLED': case 'INTERRUPTED': case null: return interrupted(state, filmId, 'stopped_elsewhere', knownPosition(state));
  }
}

/** Un autre film a pris la TV (lancé depuis un autre appareil) : le nôtre s'est arrêté, on suit le nouveau. */
function replacedOnTv(state: CastState, e: MediaStatus, filmId: number): Step {
  if (state.filmId === null) return enterRemote(state, e, filmId, false);
  const left = interrupted(state, state.filmId, 'stopped_elsewhere', knownPosition(state));
  const taken = enterRemote(left.state, e, filmId, false);
  return { state: taken.state, effects: [...left.effects, ...taken.effects] };
}

function onNoMedia(state: CastState): Step {
  const filmId = state.filmId;
  if (filmId === null) return unchanged(state);
  switch (state.phase) {
    case 'idle':
      // Film mémorisé et plus rien sur la TV : seul le serveur sait s'il a fini (fin estimée) ou non.
      return { state, effects: ifTracked(state, { type: 'READ_RENTAL', filmId }) };
    case 'remote':
      // Le SDK a remis durée et position à zéro sans dire FINISHED : on juge sur les dernières connues (D4).
      return nearEnd(state) ? finish(state, filmId) : noMediaLeft(state, filmId);
    case 'lost':
      return noMediaLeft(state, filmId);
    case 'choosing': case 'connecting': case 'loading': case 'ended':
      return unchanged(state);
  }
}

/** Plus de média sur la TV, fin non établie : la location dit si le film a été vu. */
function noMediaLeft(state: CastState, filmId: number): Step {
  if (state.tracked) return { state, effects: [{ type: 'READ_RENTAL', filmId }] };
  // Prévisualisation : pas de location à relire, la machine tranche avec ce qu'elle sait.
  return nearEnd(state) ? finish(state, filmId) : interrupted(state, filmId, 'stopped_elsewhere', knownPosition(state));
}

function onStatusFailed(state: CastState): Step {
  switch (state.phase) {
    case 'remote':
      // La TV ne répond plus : on le dit, sans clore la séance serveur — elle joue sans doute encore (D1).
      return { state: { ...state, phase: 'lost' }, effects: [] };
    case 'idle':
      // Page rechargée, film mémorisé, et la TV ne répond pas : même écran, plutôt que de laisser le lecteur
      // repartir en local pendant que la TV joue peut-être.
      return state.filmId === null ? unchanged(state) : { state: { ...state, phase: 'lost' }, effects: [] };
    case 'choosing': case 'connecting': case 'loading': case 'ended': case 'lost':
      return unchanged(state);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Ce que dit le serveur
// ---------------------------------------------------------------------------------------------------------

function onRentalState(state: CastState, e: Extract<CastEvent, { type: 'RENTAL_STATE' }>): Step {
  if (e.filmId !== state.filmId) return unchanged(state);
  switch (state.phase) {
    case 'remote': case 'lost': case 'idle': {
      if (!e.exists) return rentalOver(state, e.filmId);
      // Vue jusqu'au bout : fin vue par la TV avant un gel de la page, ou fin estimée par le serveur.
      if (e.watchProgress >= 100) return { state: { ...state, phase: 'ended', position: 0, busy: false, media: null }, effects: [] };
      // Arrêtée en route pendant notre absence. La reprise locale part de la dernière position non nulle que la
      // machine a lue sur la TV ; sinon (page rechargée) de celle du serveur, désormais connue. La séance
      // serveur est close sans position : le serveur garde la sienne.
      const known = state.positionKnown && state.position > 0 ? state : { ...state, position: e.watchPosition, positionKnown: true };
      return interrupted(known, e.filmId, 'stopped_elsewhere', null);
    }
    case 'choosing': case 'connecting': case 'loading': case 'ended':
      return unchanged(state);
  }
}

function onRentalGone(state: CastState, filmId: number): Step {
  if (filmId !== state.filmId) return unchanged(state);
  switch (state.phase) {
    case 'remote': case 'lost': case 'loading':
      return rentalOver(state, filmId);
    case 'ended':
      // Film déjà fini : plus de puce « Film terminé » pour une location qui n'existe plus. La TV reste à
      // son accueil, rien à arrêter.
      return { state: toIdle(state), effects: ifTracked(state, { type: 'REMEMBER_FILM', filmId: null }) };
    case 'idle': case 'choosing': case 'connecting':
      return unchanged(state);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Télécommande et surveillance
// ---------------------------------------------------------------------------------------------------------

function onCommand(state: CastState, e: CommandEvent): Step {
  if (state.phase !== 'remote') return unchanged(state);
  switch (e.type) {
    case 'COMMAND':
      // Une commande à la fois : tant que la TV n'a pas accusé réception, les appuis sont ignorés.
      if (state.busy) return unchanged(state);
      return {
        state: { ...state, busy: true },
        effects: [{ type: 'SEND_COMMAND', command: e.command, position: state.position, paused: state.paused }],
      };
    case 'COMMAND_DONE':
      return { state: { ...state, busy: false }, effects: [] };
    case 'COMMAND_FAILED':
      // Échec ou silence : on ne devine pas l'état de la TV, on le lui redemande ; sans réponse, liaison perdue.
      return { state: { ...state, busy: false }, effects: [{ type: 'REQUEST_STATUS' }] };
  }
}

function onWatch(state: CastState, e: WatchEvent): Step {
  const filmId = state.filmId;
  if (filmId === null) return unchanged(state);
  if (state.phase === 'lost') {
    // On redemande à la TV, sans rapporter au serveur une position qu'elle n'a pas confirmée.
    return e.type === 'PAGE_HIDDEN' ? unchanged(state) : { state, effects: [{ type: 'REQUEST_STATUS' }] };
  }
  if (state.phase !== 'remote') return unchanged(state);
  const report: CastEffect = { type: 'SERVER_REPORT', filmId, position: state.position, duration: durationOrNull(state.duration) };
  switch (e.type) {
    case 'TICK': return { state, effects: [{ type: 'REQUEST_STATUS' }, ...ifTracked(state, report)] };
    // Chrome gèle la page 60 s après son passage en arrière-plan : la position part avant.
    case 'PAGE_HIDDEN': return { state, effects: ifTracked(state, report) };
    case 'PAGE_VISIBLE': return { state, effects: [{ type: 'REQUEST_STATUS' }] };
    case 'USER_RETRY': return unchanged(state);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Gestes du visiteur
// ---------------------------------------------------------------------------------------------------------

function onCancel(state: CastState): Step {
  switch (state.phase) {
    case 'choosing': case 'connecting':
      return { state: toIdle(state), effects: clearTimerOf(state.phase) };
    case 'loading':
      // Le film part peut-être déjà sur la TV : on arrête tout, et ses statuts tardifs sont ignorés — sinon
      // la télécommande réapparaîtrait juste après l'annulation.
      return { state: toIdle(state, closingSession), effects: [...clearTimerOf('loading'), { type: 'STOP_AND_END_SESSION' }] };
    case 'idle': case 'remote': case 'lost': case 'ended':
      return unchanged(state);
  }
}

/**
 * « Arrêter » (`play` faux) ou « Sur ce téléphone » (`play` vrai) : la TV s'arrête ET la séance se termine (la
 * TV revient à son accueil). La séance serveur est close à la position connue — sinon le vérificateur
 * noterait la location vue en plein visionnage local. Les statuts tardifs sont ignorés jusqu'à la fin de séance.
 * Position inconnue (page rechargée, la TV n'a encore rien dit) : null des deux côtés — le lecteur reprend à
 * la position de la location, le serveur garde la sienne.
 */
function leaveTv(state: CastState, play: boolean): Step {
  const filmId = state.filmId;
  if (filmId === null || (state.phase !== 'remote' && state.phase !== 'lost')) return unchanged(state);
  const position = knownPosition(state);
  return {
    state: toIdle(state, { ...closingSession, resume: { filmId, position, play } }),
    effects: [
      { type: 'STOP_AND_END_SESSION' },
      ...ifTracked(state, { type: 'SERVER_CLOSE', filmId, position, finished: false }, { type: 'REMEMBER_FILM', filmId: null }),
    ],
  };
}

function onDismiss(state: CastState): Step {
  // Rembobiné ou éjecté : le film terminé est oublié, plus de puce « Film terminé ».
  if (state.phase === 'ended') return { state: toIdle(state), effects: ifTracked(state, { type: 'REMEMBER_FILM', filmId: null }) };
  return { state: { ...state, notice: null }, effects: [] };
}
