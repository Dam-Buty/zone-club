// Les mots des panneaux du Cast (src/components/player/CastPanels.tsx, ActiveCastIndicator.tsx) et les décisions de
// libellé qui se prennent sans React. Testé tel quel dans tests/domain/cast-labels.test.mjs.
//
// Imports de type uniquement : Node charge ce module sans transformation dans les tests.
import type { CastPhase } from './cast-machine';

/**
 * Ce que dit un texte qui nomme la télé quand son nom est inconnu : juste après un rechargement de page, `deviceName`
 * est null tant que la séance n'a pas redonné son appareil. Un seul endroit, pour que « Connexion à … », « Lancement
 * du film sur … » et « La diffusion sur … s'est arrêtée » disent tous la même chose.
 */
export function castDeviceLabel(deviceName: string | null): string {
  return isNamed(deviceName) ? deviceName : 'la télé';
}

function isNamed(deviceName: string | null): deviceName is string {
  return deviceName !== null && deviceName.trim() !== '';
}

/** Phrase du sélecteur d'appareils ouvert : aucun appareil n'est encore choisi, il n'y a pas de nom à dire. */
export const CAST_CHOOSING_TEXT = 'Choisis ton appareil dans la fenêtre Google Cast.';

/**
 * « Connexion à {nom}… » ou « Lancement du film sur {nom}… », en trois morceaux : `device` se met en pastille quand le
 * nom est connu (`named`), la phrase entière est `before + device + after`.
 */
export function castWaitingParts(
  phase: 'connecting' | 'loading',
  deviceName: string | null,
): { before: string; device: string; after: string; named: boolean } {
  return {
    before: phase === 'connecting' ? 'Connexion à ' : 'Lancement du film sur ',
    device: castDeviceLabel(deviceName),
    after: '…',
    named: isNamed(deviceName),
  };
}

/**
 * Le mot de droite de la puce flottante, ou null quand la TV n'a aucun film à signaler. Doit rester d'accord avec
 * `castOwnsFilm` (cast-machine.ts) : un libellé exactement quand la machine désigne un film (voir le test).
 */
export function castChipLabel(phase: CastPhase): string | null {
  switch (phase) {
    case 'remote': return 'TÉLÉCOMMANDE';
    case 'lost': return 'LA TÉLÉ NE RÉPOND PLUS';
    case 'ended': return 'FILM TERMINÉ';
    case 'idle': case 'choosing': case 'connecting': case 'loading': return null;
  }
}

/**
 * « Continuer sur ce téléphone » (ou « … cette tablette », « … cet ordinateur ») : le libellé de `watchHereLabel`
 * (kiosk-logic.ts, « Sur ce téléphone »…), repris tel quel après « Continuer » pour que l'appareil se dise une seule fois.
 */
export function continueHereLabel(here: string): string {
  return `Continuer ${here.charAt(0).toLowerCase()}${here.slice(1)}`;
}

/** Le retour de la télécommande : la TV continue de jouer, le visiteur retourne là d'où il est venu. */
export function castBackLabel(from: 'kiosk' | 'store'): string {
  return from === 'kiosk' ? '← Retour à la borne' : '← Retour au vidéoclub';
}

/** « 4:07 », « 1:02:05 ». Un temps que la TV n'a pas donné (NaN, négatif) s'affiche 0:00. */
export function formatCastTime(seconds: number): string {
  const whole = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = Math.floor(whole % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
