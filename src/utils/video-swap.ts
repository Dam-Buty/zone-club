// Où reprend un film (docs/superpowers/specs/2026-11-19-versions-et-erreurs-de-lecture-design.md, § 4.3 b). La vidéo du
// lecteur est remontée à chaque autre piste audio et à chaque « Réessayer » : un nouvel élément <video> remplace
// l'ancien. Une seule règle décide aux trois endroits — la reprise à l'ouverture, la position rétablie après un
// remontage (useVideoLifecycle) et le départ sur la télé (`startAt` de « Regarder sur TV ») : le téléphone et la télé ne
// peuvent pas se contredire. Fonctions pures, sans import : chargées telles quelles par Node dans les tests.

/**
 * Une position enregistrée dans les 10 dernières secondes du fichier est la fin du film (ou un enregistrement arrondi
 * juste avant la fin) : le film repart du début, sinon il finirait aussitôt et « BE KIND REWIND » reviendrait. La règle
 * se lit sur la durée du fichier, jamais sur la progression : celle-ci ne redescend jamais (serveur et magasin), et une
 * location vue à 100 % puis revue jusqu'à 200 s doit reprendre à 200 s.
 */
export const RESUME_END_MARGIN_S = 10;

/** Une position lisible et positive, sinon 0. */
function seconds(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Où reprend un élément (ou la télé) : la plus grande des deux positions — celle de l'élément qu'il remplace (en cours de
 * film, elle est en avance sur la location, enregistrée toutes les 10 s ; 0 à l'ouverture) et celle de la location (un
 * changement fait avant la première image ne repart pas de zéro). La position de la location ne compte pas quand elle est
 * dans les `RESUME_END_MARGIN_S` dernières secondes du fichier. Durée inconnue (pas encore de métadonnées) : la position
 * enregistrée est reprise.
 */
export function swapResumeTime(i: { elementTime: number; rentalPosition: number; duration: number | null }): number {
  const saved = seconds(i.rentalPosition);
  const duration = i.duration !== null && Number.isFinite(i.duration) && i.duration > 0 ? i.duration : null;
  const rental = duration !== null && saved >= duration - RESUME_END_MARGIN_S ? 0 : saved;
  return Math.max(seconds(i.elementTime), rental);
}

/**
 * Ce que le lecteur fait d'un élément qui peut se placer (métadonnées, ou première lecture possible) : la seconde où le
 * mettre, ou null pour ne pas y toucher — il a déjà sa position (1 s ou plus : jamais un saut sous les pieds du
 * visiteur), ou il n'y a rien à reprendre. `elementTime` : la seconde transmise par l'élément remplacé, 0 à l'ouverture.
 */
export function resumeSeek(i: { currentTime: number; elementTime: number; rentalPosition: number; duration: number | null }): number | null {
  if (!(i.currentTime < 1)) return null;
  const at = swapResumeTime(i);
  return at > 0 ? at : null;
}

/**
 * Ce qu'un élément qui s'en va transmet au suivant : la seconde qu'il devait encore reprendre (`pending`, remplacé avant
 * ses métadonnées — deux changements rapides ne perdent pas la position), sinon la sienne.
 */
export function leavingTime(i: { pending: number | null; currentTime: number }): number {
  return i.pending ?? i.currentTime;
}
