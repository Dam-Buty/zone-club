// Le fil entre la machine du Cast et le SDK de Google (docs/superpowers/specs/2026-11-18-cast-refonte-design.md, § 5.1).
//
// Ce que le service envoie à la TV (la source, la demande de chargement) et ce qu'il comprend de ce qu'elle
// répond (un statut de lecture → un événement de la machine). Tiré du service pour être testé sans SDK : ce
// qu'une TV dit mal (identifiant douteux, état inconnu, durée remise à zéro) ne doit jamais devenir une
// valeur fausse dans l'état.
//
// Aucun import de valeur : Node le charge tel quel dans les tests (tests/domain/cast-wire.test.mjs).

import type { CastEvent, CastMediaRequest } from './cast-machine';

type MediaStatus = Extract<CastEvent, { type: 'MEDIA_STATUS' }>;

/** Données du `chrome.cast.media.LoadRequest` ; le service les recopie dans les objets du SDK. */
export interface CastLoadData {
  contentId: string;
  contentType: 'video/mp4';
  title: string;
  /**
   * Relu sur chaque statut de la TV : c'est ainsi qu'une page rechargée reconnaît le film en cours (F2).
   * `preview` : prévisualisation /admin, jamais suivie sur le serveur.
   */
  customData: { filmId: number; preview?: true };
  currentTime: number;
  autoplay: true;
  tracks: { trackId: number; trackContentId: string; language: string; name: string }[];
  activeTrackIds: number[];
}

/**
 * Ce que le service lit d'un statut de lecture : un `chrome.cast.media.Media` du SDK (horloge `getEstimatedTime`),
 * ou une entrée brute de la réponse à GET_STATUS (`currentTime`), seule source après un rechargement tant que le
 * SDK n'a pas recréé son objet (F2).
 */
export interface CastMediaLike {
  playerState?: string;
  idleReason?: string | null;
  media?: { duration?: number | null; customData?: unknown } | null;
  getEstimatedTime?: () => number;
  currentTime?: number;
}

/** La piste demandée, sinon l'autre, sinon l'adresse de la location ; une adresse vide n'est pas une source. */
export function castSourceFor(
  rental: { videoUrl?: string; streamingUrls?: { vf: string | null; vo: string | null } } | null | undefined,
  audio: 'vf' | 'vo',
): string | null {
  const urls = rental?.streamingUrls;
  const other = audio === 'vf' ? 'vo' : 'vf';
  return urls?.[audio] || urls?.[other] || rental?.videoUrl || null;
}

/** Ce que la tranche du magasin lit d'une location pour lancer le Cast : où la prendre et d'où reprendre. */
export interface CastRentalLike {
  videoUrl?: string;
  streamingUrls?: { vf: string | null; vo: string | null };
  watchProgress: number;             // 0-100
  watchPosition: number;             // secondes
}

/** Titre envoyé à la TV quand le catalogue chargé ne connaît pas le film. */
const CAST_FALLBACK_TITLE = 'Zone Club';

/**
 * D'où le film part. Un départ demandé prime, même 0 ; sinon la position de la location, et 0 pour une location
 * vue jusqu'au bout (100 %) : « Regarder sur TV » d'un film fini le reprend au début, pas à sa dernière seconde.
 * Une valeur illisible (NaN, négative) vaut « pas demandée » ou « pas de position » : jamais un départ faux.
 */
export function castStartAt(rental: Pick<CastRentalLike, 'watchProgress' | 'watchPosition'> | null | undefined, asked: number | undefined): number {
  if (typeof asked === 'number' && Number.isFinite(asked) && asked >= 0) return asked;
  if (!rental || rental.watchProgress >= 100) return 0;
  return Number.isFinite(rental.watchPosition) && rental.watchPosition > 0 ? rental.watchPosition : 0;
}

/**
 * La piste de sous-titres à activer au chargement. Un choix du visiteur est honoré tel quel : « off » coupe, une
 * langue absente ne donne rien (jamais une autre à sa place). Sans choix, comme le lecteur d'avant : le français
 * s'il existe, sinon la première langue disponible, sinon aucune.
 */
export function castSubtitleId(subtitles: CastMediaRequest['subtitles'], asked: 'off' | 'fr' | 'en' | undefined): number | null {
  if (asked === 'off') return null;
  if (asked !== undefined) return subtitles.find((track) => track.language === asked)?.id ?? null;
  return (subtitles.find((track) => track.language === 'fr') ?? subtitles[0])?.id ?? null;
}

/**
 * Le média que la machine garde entre le sélecteur et le chargement. Rien sans source : la location n'a aucune
 * piste lisible, il n'y a rien à envoyer à la TV et la tranche le dit au visiteur. `subtitle` : le choix du visiteur,
 * absent s'il n'en a pas fait (voir castSubtitleId).
 */
export function castMediaRequest(i: {
  rental: CastRentalLike | null | undefined;
  audio: 'vf' | 'vo';
  title: string | null | undefined;
  startAt?: number;
  subtitles: CastMediaRequest['subtitles'];
  subtitle?: 'off' | 'fr' | 'en';
}): CastMediaRequest | null {
  const url = castSourceFor(i.rental, i.audio);
  if (!url) return null;
  return {
    url,
    title: i.title?.trim() || CAST_FALLBACK_TITLE,
    startAt: castStartAt(i.rental, i.startAt),
    subtitles: i.subtitles,
    activeSubtitleId: castSubtitleId(i.subtitles, i.subtitle),
  };
}

/**
 * La location du film qui est sur la TV vient-elle de disparaître (échéance, retour) ? Rend ce film, sinon null.
 * Elle a disparu seulement si elle ÉTAIT dans la liste d'avant et n'est plus dans celle d'après : avant la première
 * réponse du serveur la liste est vide, et un film qui n'a jamais été là n'a pas disparu. Une prévisualisation /admin
 * (`tracked` faux) n'a pas de location : celle, réelle, du même film qui s'éteint ne l'arrête pas.
 */
export function rentalGoneFilm(i: {
  owned: number | null;
  tracked: boolean;
  before: readonly { filmId: number }[];
  after: readonly { filmId: number }[];
}): number | null {
  const { owned } = i;
  if (owned === null || !i.tracked) return null;
  const had = i.before.some((r) => r.filmId === owned);
  const has = i.after.some((r) => r.filmId === owned);
  return had && !has ? owned : null;
}

/**
 * Au-delà, un appel au serveur est abandonné (il continue en tâche de fond, sa réponse est perdue). Le service range
 * tous ses appels dans UNE file, chacun après la fin du précédent : un port qui ne se règle jamais la bloquerait
 * pour toute la vie de la page.
 */
export const CAST_SERVER_GIVE_UP_MS = 10000;

/**
 * Un appel qui se règle toujours : sa réponse, ou `fallback` s'il échoue, lève ou dépasse CAST_SERVER_GIVE_UP_MS.
 * Les erreurs s'arrêtent ici (le prochain envoi rattrape ; voir « Règle » du service). Une réponse tardive est perdue.
 */
export function settle<T>(call: () => Promise<T>, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), CAST_SERVER_GIVE_UP_MS);
    const done = (value: T): void => {
      clearTimeout(timer);
      resolve(value);
    };
    try {
      call().then(done, () => done(fallback));
    } catch {
      done(fallback);
    }
  });
}

export function loadRequestData(filmId: number, media: CastMediaRequest, tracked: boolean): CastLoadData {
  const tracks = media.subtitles.map((s) => ({ trackId: s.id, trackContentId: s.url, language: s.language, name: s.label }));
  // Une piste active absente des pistes déclarées : le récepteur refuserait le chargement entier.
  const active = media.activeSubtitleId;
  const activeTrackIds = active !== null && tracks.some((t) => t.trackId === active) ? [active] : [];
  return {
    contentId: media.url,
    contentType: 'video/mp4',
    title: media.title,
    customData: tracked ? { filmId } : { filmId, preview: true },
    currentTime: Number.isFinite(media.startAt) && media.startAt > 0 ? media.startAt : 0,
    autoplay: true,
    tracks,
    activeTrackIds,
  };
}

/**
 * Statut d'une séance média → événement. `volume` vient du récepteur (le volume est celui de la TV, pas du
 * média). En fin de film le SDK remet sa durée à zéro au même instant (D4) : il faut donc lire l'objet média
 * lui-même, dont la durée reste lisible, et une durée absente vaut 0 (« inconnue » pour la machine).
 */
export function mediaStatusEvent(media: CastMediaLike | null, volume: number): CastEvent {
  if (!media) return { type: 'NO_MEDIA' };
  const custom = media.media?.customData;
  const playerState = playerStateOf(media.playerState);
  return {
    type: 'MEDIA_STATUS',
    filmId: filmIdOf(custom),
    playerState,
    idleReason: playerState === 'IDLE' ? idleReasonOf(media.idleReason) : null,
    position: finiteOrZero(typeof media.getEstimatedTime === 'function' ? media.getEstimatedTime() : media.currentTime),
    duration: finiteOrZero(media.media?.duration),
    volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1,
    preview: isRecord(custom) && custom.preview === true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Seul un entier positif est un film d'ici ; tout le reste est un média que nous n'avons pas lancé. */
function filmIdOf(custom: unknown): number | null {
  const id = isRecord(custom) ? custom.filmId : undefined;
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
}

/** Un état inconnu (LOADING…) est une attente : il ne conclut rien, ni lecture ni arrêt. */
function playerStateOf(raw: string | undefined): MediaStatus['playerState'] {
  return raw === 'PLAYING' || raw === 'PAUSED' || raw === 'IDLE' ? raw : 'BUFFERING';
}

function idleReasonOf(raw: string | null | undefined): MediaStatus['idleReason'] {
  return raw === 'FINISHED' || raw === 'CANCELLED' || raw === 'INTERRUPTED' || raw === 'ERROR' ? raw : null;
}

/** Position ou durée lisible, sinon 0 (illisible, négative, absente). */
function finiteOrZero(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}
