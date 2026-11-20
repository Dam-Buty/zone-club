// La vidéo du lecteur est remontée à chaque autre piste audio et à chaque « Réessayer » : un nouvel élément <video>
// remplace l'ancien (docs/superpowers/specs/2026-11-19-versions-et-erreurs-de-lecture-design.md, § 4.3 b). Où il
// reprend se décide ici. Fonction pure, sans import : chargée telle quelle par Node dans les tests.

/** Une position lisible et positive, sinon 0. */
function seconds(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Où reprend le nouvel élément : la plus grande des deux positions — celle de l'élément qu'il remplace (en cours de
 * film, elle est en avance sur la location, enregistrée toutes les 10 s) et celle de la location (un changement fait
 * avant la première image ne repart pas de zéro). Une location vue à 100 % ne compte plus : sa position est la fin du
 * film, ou périmée — le film repart du début, ou de la seconde que l'élément montrait (on revoit un film fini).
 */
export function swapResumeTime(i: { elementTime: number; rentalPosition: number; rentalProgress: number }): number {
  const rental = i.rentalProgress >= 100 ? 0 : seconds(i.rentalPosition);
  return Math.max(seconds(i.elementTime), rental);
}
