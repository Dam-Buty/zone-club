// Validation d'une lecture en échec envoyée par le navigateur, et résumé de son navigateur.
//
// Fichier volontairement sans import de valeur : il est chargé tel quel par les tests (node --test, retrait de
// types natif), et le client en importe le type. Il ne sait rien de la base.
//
// Ce qui est accepté ici est ce qui sera stocké. SEULS les champs ci-dessous sont lus : une adresse de diffusion,
// un chemin de fichier ou tout autre champ glissé dans le corps n'est jamais recopié — l'adresse d'une location
// est son secret, elle ne doit figurer dans aucune trace.

import type { VersionAudio, VersionSubtitle } from '../src/utils/version-choice';

/** Taille maximale du corps accepté par la route, en octets : cinq champs courts n'en demandent pas plus. */
export const PLAYBACK_FAILURE_MAX_BODY_BYTES = 1024;

export type PlaybackPlace = 'device' | 'tv';
/** `error` : le lecteur a signalé une erreur ; `timeout` : rien n'est venu à temps ; `tv_load` : la télé n'a pas chargé le média. */
export type PlaybackFailureKind = 'error' | 'timeout' | 'tv_load';

export interface PlaybackFailure {
  /** L'identifiant INTERNE du film (`films.id`, celui de la location et de `currentPlayingFilm`), jamais son `tmdb_id`. */
  filmId: number;
  audio: VersionAudio;
  subtitle: VersionSubtitle;
  place: PlaybackPlace;
  kind: PlaybackFailureKind;
  /** Où en était la lecture, en secondes ; `null` quand on ne le sait pas. */
  position: number | null;
}

const AUDIOS: readonly VersionAudio[] = ['vf', 'vo'];
const SUBTITLES: readonly VersionSubtitle[] = ['off', 'fr', 'en'];
const PLACES: readonly PlaybackPlace[] = ['device', 'tv'];
const KINDS: readonly PlaybackFailureKind[] = ['error', 'timeout', 'tv_load'];

/** Aucun film ne dure plus d'un jour : au-delà, la valeur reçue est une erreur, pas une position. */
const MAX_POSITION_SECONDS = 24 * 3600;

function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | null {
  return allowed.find((x) => x === value) ?? null;
}

/** Rend la trace nettoyée, ou `null` si l'entrée n'en est pas une. Une position inutilisable ne refuse pas la trace : elle devient `null`. */
export function parsePlaybackFailure(json: unknown): PlaybackFailure | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;

  const filmId = o.filmId;
  if (typeof filmId !== 'number' || !Number.isSafeInteger(filmId) || filmId < 1) return null;
  const audio = oneOf(AUDIOS, o.audio);
  const subtitle = oneOf(SUBTITLES, o.subtitle);
  const place = oneOf(PLACES, o.place);
  const kind = oneOf(KINDS, o.kind);
  if (!audio || !subtitle || !place || !kind) return null;

  const p = o.position;
  const position = typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= MAX_POSITION_SECONDS ? p : null;

  return { filmId, audio, subtitle, place, kind, position };
}

// --- Navigateur ---------------------------------------------------------------------------------------------------

/** Longueur maximale du résumé stocké. */
const BROWSER_MAX_CHARS = 40;
/** Un en-tête User-Agent réel tient en moins de 300 caractères : au-delà, on ne lit pas plus loin. */
const USER_AGENT_READ_CHARS = 512;

// Du plus précis au plus général : Edge, Opera et Samsung Internet portent aussi « Chrome/ », Chrome et Firefox sur
// iOS portent « Safari/ » et « Version/ ».
const BROWSERS: readonly [name: string, pattern: RegExp][] = [
  ['Edge', /\bEdg(?:e|A|iOS)?\/(\d{1,4})/],
  ['Opera', /\bOPR\/(\d{1,4})/],
  ['Samsung Internet', /\bSamsungBrowser\/(\d{1,4})/],
  ['Firefox', /\b(?:Firefox|FxiOS)\/(\d{1,4})/],
  ['Chrome', /\b(?:Chrome|CriOS)\/(\d{1,4})/],
  ['Safari', /\bVersion\/(\d{1,4})[\s\S]*\bSafari\//],
];

// Android avant Linux (un téléphone Android se dit aussi Linux) ; iOS avant macOS (iPhone dit « like Mac OS X »).
const SYSTEMS: readonly [name: string, pattern: RegExp][] = [
  ['Android', /\bAndroid\b/],
  ['iOS', /\b(?:iPhone|iPad|iPod)\b/],
  ['Windows', /\bWindows\b/],
  ['macOS', /\bMacintosh\b/],
  ['ChromeOS', /\bCrOS\b/],
  ['Linux', /\bLinux\b/],
];

/**
 * Le navigateur et le système, en quelques mots (« Chrome 157 · Android »), pour une liste d'administration.
 * Rien du texte reçu n'est recopié : seuls des noms fixes et des chiffres sortent. « inconnu » quand rien n'est reconnu.
 */
export function briefBrowser(userAgent: string | null): string {
  const ua = (userAgent ?? '').slice(0, USER_AGENT_READ_CHARS);
  const parts: string[] = [];
  for (const [name, pattern] of BROWSERS) {
    const m = pattern.exec(ua);
    if (m) {
      parts.push(`${name} ${m[1]}`);
      break;
    }
  }
  for (const [name, pattern] of SYSTEMS) {
    if (pattern.test(ua)) {
      parts.push(name);
      break;
    }
  }
  return parts.length === 0 ? 'inconnu' : parts.join(' · ').slice(0, BROWSER_MAX_CHARS);
}
