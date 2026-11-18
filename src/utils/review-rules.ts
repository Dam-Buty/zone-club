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
