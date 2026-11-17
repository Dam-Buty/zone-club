// Suivi par le serveur d'un film regardé sur la TV
// (docs/superpowers/specs/2026-11-17-cast-suivi-serveur-design.md).
//
// Pendant un Cast, seul le téléphone suivait la progression, et seulement lecteur ouvert et écran
// allumé. Or une fois le film lancé on doit pouvoir fermer l'application (Rusmir). Quand une séance de
// Cast atteint son heure de fin estimée, le serveur note donc la location comme vue — ce qui rend le
// rembobinage possible (`claimRewindCredit` exige 80 %). Estimation par l'horloge : le serveur ne voit
// pas la TV (pause, avance rapide, arrêt) ; le téléphone corrige quand il est là.
//
// La base est passée en paramètre et ce module n'importe aucune valeur : il est chargé tel quel par
// Node dans les tests, sur une base en mémoire.

type Statement = { get(...args: unknown[]): unknown; run(...args: unknown[]): unknown };
type Db = { prepare(sql: string): Statement };

/**
 * Note vue la location d'une séance de Cast finie : 100 %, position remise au début, date de fin de
 * visionnage posée si elle ne l'était pas. Même si la location a expiré entre-temps (l'historique doit
 * dire vrai). Sans `rental_id`, la location la plus récente du visiteur pour ce film. Rejouable sans
 * effet. Vrai si une location a été trouvée.
 */
export function completeCastRental(database: Db, session: { rental_id: number | null; user_id: number; film_id: number }): boolean {
  const id =
    session.rental_id ??
    (database.prepare('SELECT id FROM rentals WHERE user_id = ? AND film_id = ? ORDER BY id DESC LIMIT 1').get(session.user_id, session.film_id) as
      | { id: number }
      | undefined)?.id;
  if (id === undefined || id === null) return false;
  database
    .prepare("UPDATE rentals SET watch_progress = 100, watch_position = 0, watch_completed_at = COALESCE(watch_completed_at, datetime('now')) WHERE id = ?")
    .run(id);
  return true;
}
