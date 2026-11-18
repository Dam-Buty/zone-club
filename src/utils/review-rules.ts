// Règles d'une critique, partagées par le serveur (lib/reviews.ts), le vidéoclub, le lecteur, Michel et la
// borne. Aucun import de valeur : chargé tel quel par Node dans les tests.
//
// Rusmir, 17-18/11/2026 : « on en demande trop » (500 → 144 caractères) ; « on ne peut pas juste écrire
// scén ou jeu, il faut dire scénario et jeu d'acteurs ».

/** Longueur minimale d'une critique, en caractères. */
export const REVIEW_MIN_LENGTH = 144;

/** Intitulés des trois notes d'une critique, en entier. */
export const REVIEW_RATING_LABELS = {
  direction: 'Réalisation',
  screenplay: 'Scénario',
  acting: "Jeu d'acteurs",
} as const;

/**
 * Ce qui manque pour publier une critique, ou `null` si elle est publiable. Le bouton « PUBLIER » de la borne ne
 * se grise jamais : il dit ceci.
 */
export function reviewFormCheck(i: { length: number; ratings: readonly [number, number, number] }): string | null {
  const missing = REVIEW_MIN_LENGTH - i.length;
  if (missing > 0) return `Encore ${missing} caractère${missing > 1 ? 's' : ''}`;
  if (i.ratings.some((r) => !(r >= 1 && r <= 5))) return 'Donnez les trois notes';
  return null;
}
