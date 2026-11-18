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
