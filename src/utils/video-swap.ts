// Où reprend un film (docs/superpowers/specs/2026-11-19-versions-et-erreurs-de-lecture-design.md, § 4.3 b). La vidéo du
// lecteur est remontée à chaque autre piste audio et à chaque « Réessayer » : un nouvel élément <video> remplace
// l'ancien. Une seule règle décide partout où un film reprend : la reprise à l'ouverture et la position rétablie après un
// remontage (useVideoLifecycle), le départ sur la télé depuis le lecteur (`startAt` de « Regarder sur TV », avec la
// durée de sa vidéo) et depuis la borne (castStartAt de cast-wire, « Sur ma télé »). Trois écarts restent entre le
// téléphone et la télé : (1) « Sur ma télé » de la borne — le client ne connaît pas la durée du fichier (seulement la
// durée TMDB, qui n'est pas celle du fichier) : une position enregistrée dans les 10 dernières secondes part telle quelle
// sur la télé, alors que le téléphone repart du début ; (2) « Regarder sur TV » touché avant les métadonnées de la vidéo
// d'ici (`sendToTv`) — durée inconnue aussi, même conséquence ; (3) la reprise venue de la télé (`takeCastResume`) place
// la vidéo d'ici à la position de la télé (inconnue : celle de la location) sans passer par cette règle. Fonctions
// pures, sans import : chargées telles quelles par Node dans les tests.

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

/**
 * La seconde que reprend un nouvel élément, transmise par celui qu'il remplace (`left`, rangée avec son film) : la
 * sienne pour le même film (autre version, « Réessayer ») ; un autre film l'ignore et part de sa propre location
 * (0 : rien de transmis). Sans cela, le film suivant ouvert dans le lecteur partait à la seconde du précédent.
 */
export function handedOverTime(left: { filmId: number | null; time: number } | null, filmId: number | null): number {
  return left !== null && filmId !== null && left.filmId === filmId ? left.time : 0;
}
