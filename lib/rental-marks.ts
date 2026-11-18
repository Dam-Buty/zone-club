// Dates d'une location que l'écran « Mon compte » et la règle des critiques lisent
// (docs/superpowers/specs/2026-11-17-borne-mon-compte-design.md, § 4 et § 6).
//
// La base est passée en paramètre et ce module n'importe aucune valeur : il est chargé tel quel par Node
// dans les tests, sur une base en mémoire.

type Db = { prepare(sql: string): { run(...args: unknown[]): { changes: number } } };

/**
 * Note le premier lancement d'une location — seulement si elle n'a encore AUCUNE progression. Une location
 * déjà entamée au déploiement reste sans lancement noté (on ne peut pas le reconstituer) : la garde de temps
 * des critiques ne s'y applique pas, plutôt que d'imposer d'attendre à nouveau 80 % de la durée à quelqu'un
 * qui a presque fini. Vrai si la date a été posée.
 */
export function markWatchStarted(database: Db, rentalId: number): boolean {
  const res = database
    .prepare("UPDATE rentals SET watch_started_at = datetime('now') WHERE id = ? AND watch_started_at IS NULL AND COALESCE(watch_progress, 0) = 0 AND COALESCE(watch_position, 0) = 0")
    .run(rentalId);
  return res.changes > 0;
}
