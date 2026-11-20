// « Cette version ne se lance pas » (docs/superpowers/specs/2026-11-19-versions-et-erreurs-de-lecture-design.md, § 5.1
// et § 5.3) : quand le lecteur l'annonce, ce qu'il écrit, ce qu'il propose, et la trace qu'il envoie. Fonctions pures,
// imports relatifs avec leur extension : chargées telles quelles par Node dans les tests.
import { otherVersion, versionName } from './version-choice.ts';
import type { VersionChoice, VersionOffer } from './version-choice.ts';
import type { PlaybackFailure } from '../../lib/playback-failure-parse.ts';

/** Délai « rien ne vient » : la lecture est voulue depuis 15 s et la vidéo n'a toujours pas ses métadonnées. */
export const PLAYBACK_START_TIMEOUT_MS = 15000;

/** Une lecture qui ne démarre pas sur l'appareil : erreur nette du navigateur, ou rien n'est venu à temps. */
export type DeviceFailureKind = 'error' | 'timeout';

/**
 * Le délai court-il ? Seulement quand la lecture est voulue (la vidéo partirait d'elle-même : jamais sous l'invite
 * « Regarder sur TV ? », pendant un Cast ni sous « BE KIND REWIND »), que les métadonnées ne sont pas là, et qu'aucun
 * échec n'est déjà affiché.
 */
export function startTimerArmed(i: { wanted: boolean; hasMetadata: boolean; failed: boolean }): boolean {
  return i.wanted && !i.hasMetadata && !i.failed;
}

/** Ce qu'un élément <video> a signalé. `element` l'identifie : sa source et l'essai (« Réessayer » en monte un autre). */
export interface VideoSignals { element: string; error: boolean; metadata: boolean; timeout: boolean }

/**
 * Les signaux de l'élément `element`. Ceux d'un élément précédent (autre version, « Réessayer ») ne comptent jamais pour
 * lui : sans cela, l'erreur de l'élément en panne s'affichait encore au premier rendu du suivant, et partait en trace.
 */
export function signalsFor(seen: VideoSignals | null, element: string): VideoSignals {
  if (seen !== null && seen.element === element) return seen;
  return { element, error: false, metadata: false, timeout: false };
}

/** L'échec affiché : aucun tant que la lecture n'est pas voulue (une erreur vue entre-temps attend), l'erreur nette d'abord. */
export function shownFailure(wanted: boolean, s: VideoSignals): DeviceFailureKind | null {
  if (!wanted) return null;
  if (s.error) return 'error';
  return s.timeout ? 'timeout' : null;
}

export interface FailurePanel {
  heading: string;
  line: string;
  /** L'autre version à essayer, à la même position ; null quand le film n'en a pas d'autre. */
  tryOther: { label: string; version: VersionChoice } | null;
}

/** Le panneau : « Cette version ne se lance pas », le titre et la version, et « Essayer en … » si une autre existe. */
export function failurePanel(i: { title: string; version: VersionChoice; offer: VersionOffer }): FailurePanel {
  const name = versionName(i.version);
  const other = otherVersion(i.offer, i.version);
  return {
    heading: 'Cette version ne se lance pas',
    line: i.title ? `${i.title} · ${name}` : name,
    tryOther: other ? { label: `Essayer en ${versionName(other)}`, version: other } : null,
  };
}

/**
 * La trace d'un échec affiché sur l'appareil. Position : où en était la vidéo, ou, à zéro (rien joué), celle de la
 * location ; inconnue → null. Rien pour une prévisualisation de /admin (pas une location). Les six champs nommés
 * seulement : jamais l'adresse du fichier, qui est le secret de la location.
 */
export function failureTrace(i: {
  filmId: number | null;
  preview: boolean;
  version: VersionChoice;
  kind: DeviceFailureKind;
  currentTime: number;
  savedPosition: number | null | undefined;
}): PlaybackFailure | null {
  if (i.filmId === null || i.preview) return null;
  const position = i.currentTime > 0 ? i.currentTime : (i.savedPosition ?? null);
  return { filmId: i.filmId, audio: i.version.audio, subtitle: i.version.subtitle, place: 'device', kind: i.kind, position };
}
