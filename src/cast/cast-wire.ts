// Le fil entre la machine du Cast et le SDK de Google (docs/superpowers/specs/2026-11-18-cast-refonte-design.md, § 5.1).
//
// Ce que le service envoie à la TV (la source, la demande de chargement) et ce qu'il comprend de ce qu'elle
// répond (un statut de lecture → un événement de la machine). Tiré du service pour être testé sans SDK : ce
// qu'une TV dit mal (identifiant douteux, état inconnu, durée remise à zéro) ne doit jamais devenir une
// valeur fausse dans l'état.
//
// Un seul import de valeur, la règle de reprise de l'appareil (video-swap.ts), avec son extension : Node le charge tel
// quel dans les tests (tests/domain/cast-wire.test.mjs).

import type { CastEvent, CastMediaRequest } from './cast-machine';
import { swapResumeTime } from '../utils/video-swap.ts';

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

/**
 * L'adresse de la piste demandée, ou rien. Jamais l'autre piste ni l'adresse générique de la location à sa place : la
 * version envoyée à la télé est décidée en amont (decideVersion, qui ne rend que des pistes offertes) ; la remplacer ici
 * jouerait en silence une autre langue que celle annoncée. Une adresse vide n'est pas une source.
 */
export function castSourceFor(
  rental: { streamingUrls?: { vf: string | null; vo: string | null } } | null | undefined,
  audio: 'vf' | 'vo',
): string | null {
  return rental?.streamingUrls?.[audio] || null;
}

/** Ce que la tranche du magasin lit d'une location pour lancer le Cast : où la prendre et d'où reprendre. */
export interface CastRentalLike {
  streamingUrls?: { vf: string | null; vo: string | null };
  /** La position enregistrée (secondes). La progression n'entre pas dans le départ : elle ne redescend jamais. */
  watchPosition: number;
}

/** Titre envoyé à la TV quand le catalogue chargé ne connaît pas le film. */
const CAST_FALLBACK_TITLE = 'Zone Club';

/**
 * D'où le film part. Un départ demandé prime, même 0 (le lecteur le calcule par la même règle, sur la durée de sa
 * vidéo). Sinon la règle de reprise de l'appareil (swapResumeTime, sans élément précédent) : la position de la location,
 * quel que soit le pourcentage (la progression ne redescend jamais : un film fini puis revu jusqu'à 200 s reprend à
 * 200 s) ; elle vaut le début seulement si la durée du fichier est connue (`duration`) et qu'elle est dans ses 10
 * dernières secondes. Durée inconnue (null) : la position est reprise telle quelle. Une valeur illisible (NaN,
 * négative) vaut « pas demandée » ou « pas de position » : jamais un départ faux.
 */
export function castStartAt(rental: Pick<CastRentalLike, 'watchPosition'> | null | undefined, asked: number | undefined, duration: number | null): number {
  if (typeof asked === 'number' && Number.isFinite(asked) && asked >= 0) return asked;
  return swapResumeTime({ elementTime: 0, rentalPosition: rental?.watchPosition ?? 0, duration });
}

/**
 * La piste de sous-titres à activer au chargement : celle de la version décidée, telle quelle. « off » coupe, une
 * langue absente ne donne rien (jamais une autre à sa place). Plus de défaut : la version arrive toujours décidée
 * (decideVersion), sous-titres compris — un français choisi d'office ici contredirait une VF demandée sans sous-titres.
 */
export function castSubtitleId(subtitles: CastMediaRequest['subtitles'], asked: 'off' | 'fr' | 'en'): number | null {
  if (asked === 'off') return null;
  return subtitles.find((track) => track.language === asked)?.id ?? null;
}

/**
 * Le média que la machine garde entre le sélecteur et le chargement. Rien sans source : la location n'a pas la piste
 * de la version décidée, il n'y a rien à envoyer à la TV et la tranche le dit au visiteur. `audio` et `subtitle` : la
 * version décidée (voir castSourceFor et castSubtitleId), tous deux obligatoires.
 */
export function castMediaRequest(i: {
  rental: CastRentalLike | null | undefined;
  audio: 'vf' | 'vo';
  title: string | null | undefined;
  startAt?: number;
  subtitles: CastMediaRequest['subtitles'];
  subtitle: 'off' | 'fr' | 'en';
}): CastMediaRequest | null {
  const url = castSourceFor(i.rental, i.audio);
  if (!url) return null;
  return {
    url,
    title: i.title?.trim() || CAST_FALLBACK_TITLE,
    // Sans départ demandé (« Sur ma télé » de la borne), la durée du FICHIER n'est pas connue ici : le client n'a que la
    // durée TMDB (`runtime`), qui n'est pas celle du fichier (fichiers tronqués, versions longues). La position est
    // reprise telle quelle — même dans les 10 dernières secondes : l'un des trois écarts entre la télé et le téléphone
    // (les deux autres : « Regarder sur TV » avant les métadonnées, et takeCastResume ; voir src/utils/video-swap.ts).
    startAt: castStartAt(i.rental, i.startAt, null),
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
