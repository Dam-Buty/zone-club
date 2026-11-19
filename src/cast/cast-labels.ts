// Les mots des panneaux du Cast (src/components/player/CastPanels.tsx, ActiveCastIndicator.tsx) et les décisions de
// libellé qui se prennent sans React. Testé tel quel dans tests/domain/cast-labels.test.mjs.
//
// Imports de type uniquement : Node charge ce module sans transformation dans les tests.
import type { CastNotice, CastPhase } from './cast-machine';

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

/** Sous-titre du panneau « recopie d'écran » quand le navigateur n'a pas de Cast : la seule raison de l'ouvrir d'office. */
export const CAST_UNAVAILABLE_TEXT = "Le Cast n'est pas disponible sur ce navigateur.";

/**
 * Ce que le lecteur montre pour un message du Cast (`cast.notice`) : une ligne sous son en-tête, avec « Réessayer » quand
 * un nouvel essai a un sens (`retry`) ; ou, Cast absent du navigateur (`mirroring`), le panneau « recopie d'écran » avec
 * ce texte pour sous-titre. Un échec de connexion n'est pas une absence de Cast : il garde sa ligne (D7).
 */
export function castNoticeView(code: CastNotice, deviceName: string | null): { text: string; retry: boolean; mirroring: boolean } {
  const tv = castDeviceLabel(deviceName);
  switch (code) {
    case 'stopped_elsewhere': return { text: `La diffusion sur ${tv} s'est arrêtée`, retry: false, mirroring: false };
    case 'tv_error': return { text: "La télé n'a pas pu lire le film", retry: true, mirroring: false };
    case 'rental_over': return { text: 'Location terminée', retry: false, mirroring: false };
    case 'connect_failed': return { text: `Impossible de joindre ${tv}`, retry: true, mirroring: false };
    case 'load_failed': return { text: `Le film n'a pas pu démarrer sur ${tv}`, retry: true, mirroring: false };
    case 'no_source': return { text: "Ce film n'a pas de source vidéo à envoyer sur la télé", retry: false, mirroring: false };
    case 'unavailable': return { text: CAST_UNAVAILABLE_TEXT, retry: false, mirroring: true };
  }
}

/**
 * La TV joue un autre film que celui du lecteur : le bandeau qui le dit, et la question posée avant de le remplacer.
 * Titre inconnu (la borne ne charge pas tous les rayons) : « Un film », en minuscule au milieu de la question.
 */
export function castOtherFilmText(title: string | null, deviceName: string | null): { banner: string; confirm: string } {
  const tv = castDeviceLabel(deviceName);
  const named = title !== null && title.trim() !== '' ? title.trim() : null;
  return {
    banner: `${named ?? 'Un film'} est en cours sur ${tv}`,
    confirm: `Remplacer ${named ?? 'un film'} sur ${tv} ?`,
  };
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

/**
 * Ce que dessine la puce flottante selon la phase : un point (`live` vert qui clignote, `warn` orange fixe, ou aucun)
 * et si la puce « respire ». Le vert et la respiration disent « la télécommande est vivante » : ils ne vont qu'à
 * `remote` ; à `lost` la TV ne répond pas (orange, immobile) ; à `ended` il n'y a plus rien de vivant.
 */
export function castChipLook(phase: CastPhase): { dot: 'live' | 'warn' | null; pulse: boolean } {
  switch (phase) {
    case 'remote': return { dot: 'live', pulse: true };
    case 'lost': return { dot: 'warn', pulse: false };
    case 'ended': case 'idle': case 'choosing': case 'connecting': case 'loading': return { dot: null, pulse: false };
  }
}

// ---------------------------------------------------------------------------------------------------------
// Curseur de volume : le pouce suit le doigt, la commande part une fois, au relâchement
// ---------------------------------------------------------------------------------------------------------
//
// Un curseur contrôlé par le seul volume de la TV revient en arrière sous le doigt : la TV n'accuse qu'après la
// commande, et la machine ne prend qu'une commande à la fois (une valeur envoyée pendant le geste en fait perdre le
// reste). Le geste garde donc sa valeur ici, et la TV ne reçoit que la dernière.

/** Volume demandé par le doigt (`pending`) et doigt levé ou non (`released`). `pending` null : aucun geste en cours. */
export interface VolumeGesture { pending: number | null; released: boolean }
export const NO_VOLUME_GESTURE: VolumeGesture = { pending: null, released: false };

/** Écart sous lequel deux volumes sont le même : le pas du curseur n'est pas celui de la TV (0,28 n'est pas un pas de 0,05). */
const SAME_VOLUME = 0.005;

/** Le doigt a bougé : c'est sa valeur qui compte, rien n'est encore envoyé. */
export function volumeDragged(level: number): VolumeGesture {
  return { pending: level, released: false };
}

/**
 * La valeur du curseur : celle du doigt (`draft`, prise quand la TV était à `base`) tant que la TV n'a pas répondu,
 * sinon celle de la TV. Une TV dont le volume a changé depuis le geste a répondu : le curseur ne reste jamais sur une
 * valeur qu'elle n'a pas.
 */
export function volumeShown(draft: { level: number; base: number } | null, tvVolume: number): number {
  return draft !== null && draft.base === tvVolume ? draft.level : tvVolume;
}

/**
 * Que faire du geste maintenant ? À appeler quand le doigt se lève (`release`, pour chacun des événements qui le disent :
 * pointerup, touchend, keyup, blur…) et quand une commande en vol retombe. Rend le geste qui reste, la valeur à envoyer
 * à la TV (au plus une par geste : le geste est vidé en l'envoyant, les événements suivants ne renvoient rien), et si
 * le curseur doit rendre la main à la TV (relâché sur le volume qu'elle a déjà : il n'y a rien à envoyer, rien à attendre).
 * Doigt encore posé, ou commande en vol : on attend, la valeur est gardée et la dernière demandée gagne.
 */
export function volumeSettle(
  gesture: VolumeGesture,
  now: { release: boolean; busy: boolean; tvVolume: number },
): { gesture: VolumeGesture; send: number | null; clear: boolean } {
  const level = gesture.pending;
  if (level === null) return { gesture, send: null, clear: false };
  const held: VolumeGesture = { pending: level, released: gesture.released || now.release };
  if (!held.released || now.busy) return { gesture: held, send: null, clear: false };
  if (Math.abs(level - now.tvVolume) < SAME_VOLUME) return { gesture: NO_VOLUME_GESTURE, send: null, clear: true };
  return { gesture: NO_VOLUME_GESTURE, send: level, clear: false };
}
