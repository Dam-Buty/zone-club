// Les règles de location qui doivent valoir PARTOUT (serveur, vidéoclub 3D, tutoriel, borne). Aucun import : Node la
// charge telle quelle dans les tests, et le serveur comme le navigateur la lisent.

/** Rendue dans ce délai après la location, une K7 rapporte 1 crédit. */
export const EARLY_RETURN_HOURS = 8;
export const EARLY_RETURN_MS = EARLY_RETURN_HOURS * 3_600_000;

/** Borne comprise : rendue pile à 8 h, elle rapporte encore le crédit. */
export function isEarlyReturn(rentedAtMs: number, nowMs: number): boolean {
  return nowMs - rentedAtMs <= EARLY_RETURN_MS;
}

/** Exemplaires d'un film : 2 pour une nouveauté, 1 pour tout autre. */
export const COPIES_NOUVEAUTE = 2;
export const COPIES_AUTRE = 1;

export function copiesForFilm(isNouveaute: boolean | number | null | undefined): number {
  return isNouveaute ? COPIES_NOUVEAUTE : COPIES_AUTRE;
}
