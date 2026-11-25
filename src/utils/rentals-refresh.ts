// Relecture des locations par le magasin (`refreshRentals`, src/store/index.ts), demandée par le Cast quand une séance
// se clôt ou qu'il faut savoir ce qu'est devenu un film. `fetchMe` ne convient pas : sur un échec, quel qu'il soit, il
// pose « non connecté » — une panne réseau, au moment où le réseau est le plus fragile, faisait demander à la borne
// de se reconnecter alors que le cookie était valide (relecture finale de la refonte du Cast, A4).
//
// Aucun import : chargé tel quel par Node dans les tests (tests/domain/cast-store.test.mjs).

/**
 * Ce que fait la relecture de la réponse du profil :
 * - `write` : réponse reçue pour le compte connecté — les locations (et l'historique qui vient avec) sont écrites ;
 * - `logged-out` : 401, le visiteur est réellement déconnecté — `fetchMe` le constate, comme partout ailleurs ;
 * - `keep` : panne réseau ou erreur du serveur, ou compte changé pendant l'appel (déconnexion à l'instant) — rien
 *   n'est écrit : la réponse d'un ancien compte ne doit pas remplir les locations du suivant.
 *
 * `failedStatus` : absent quand la réponse est arrivée ; `null` sans statut HTTP (réseau). `accountBefore` : le compte
 * connecté au départ de l'appel, `accountNow` à son retour (null : aucun, ou pas encore lu au chargement de la page —
 * la réponse du serveur fait alors foi).
 */
export function rentalsRefreshOutcome(i: {
  failedStatus?: number | null;
  accountBefore: number | null;
  accountNow: number | null;
  responseAccount: number | null;
}): 'write' | 'logged-out' | 'keep' {
  if (i.failedStatus !== undefined) return i.failedStatus === 401 ? 'logged-out' : 'keep';
  if (i.accountBefore !== null && (i.accountNow !== i.accountBefore || i.responseAccount !== i.accountBefore)) return 'keep';
  return 'write';
}
