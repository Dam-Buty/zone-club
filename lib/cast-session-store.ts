// Séances de Cast tenues par le serveur (docs/superpowers/specs/2026-11-18-cast-refonte-design.md).
//
// Une séance dit « ce visiteur regarde ce film sur la TV, il finira vers telle heure » : c'est ce qui
// permet au vérificateur de noter la location vue téléphone éteint (lib/cast-completion.ts). Trois
// défauts mesurés ici : le POST était refusé (400) quand le téléphone ne connaissait pas encore la durée
// du film ; deux séances naissaient à 30 ms d'écart ; une séance menée à son terme n'était jamais close.
// D'où : la durée du film en base sert de repli, une séance ouverte se met à jour au lieu de se doubler,
// et la fin (vue ou arrêt) la clôt.
//
// La base et les deux fonctions de lib/ dont on dépend arrivent en paramètres et ce module n'importe
// aucune valeur : il est chargé tel quel par Node dans les tests, sur une base en mémoire.

type Statement = {
  get(...args: unknown[]): unknown;
  run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  all(...args: unknown[]): unknown[];
};
export type Db = { prepare(sql: string): Statement };

export type CastSessionSummary = {
  id: number;
  rental_id: number;
  duration_seconds: number;
  estimated_end_at: string;
};

type Report = {
  userId: number;
  filmId: number;
  position: number;
  durationSeconds?: number | null;
};

/** Aucun film ne dure plus d'un jour : au-delà, la valeur reçue est une erreur, pas une durée. */
const MAX_SECONDS = 24 * 3600;

/** Une durée n'est utilisable que finie, strictement positive et vraisemblable — sinon on passe à la suivante. */
function usableDuration(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_SECONDS ? value : null;
}

/** Une position négative, absente, NaN ou infinie vaut 0 ; au-delà d'un jour, elle est plafonnée. */
function boundedPosition(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(value, MAX_SECONDS) : 0;
}

/** Fin estimée = maintenant + ce qui reste du film. Toujours une date ISO valide (les entrées sont bornées). */
function estimatedEnd(durationSeconds: number, position: number): string {
  return new Date(Date.now() + Math.max(0, durationSeconds - position) * 1000).toISOString();
}

type OpenSession = { id: number; rental_id: number | null; duration_seconds: number };

/** La séance ouverte (non close) de ce visiteur pour ce film : la plus récente. */
function findOpenSession(db: Db, userId: number, filmId: number): OpenSession | undefined {
  return db
    .prepare('SELECT id, rental_id, duration_seconds FROM cast_sessions WHERE user_id = ? AND film_id = ? AND ended = 0 ORDER BY id DESC LIMIT 1')
    .get(userId, filmId) as OpenSession | undefined;
}

function activeRentalId(db: Db, userId: number, filmId: number): number | null {
  const row = db
    .prepare('SELECT id FROM rentals WHERE user_id = ? AND film_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1')
    .get(userId, filmId) as { id: number } | undefined;
  return row ? row.id : null;
}

/** Vrai si le visiteur a une location active de ce film (ce qui sépare « pas de location » de « durée inconnue »). */
export function hasActiveRental(db: Db, userId: number, filmId: number): boolean {
  return activeRentalId(db, userId, filmId) !== null;
}

/**
 * Durée à retenir, par ordre de confiance : celle que le téléphone vient d'envoyer (il lit la vraie durée
 * du média sur la TV), puis celle déjà notée sur la séance (une correction passée ne se perd pas à l'envoi
 * suivant), puis celle du film en base. `null` si aucune n'est utilisable.
 */
function resolveDuration(db: Db, i: Report, open: OpenSession | undefined): number | null {
  const received = usableDuration(i.durationSeconds);
  if (received !== null) return received;
  const noted = usableDuration(open?.duration_seconds);
  if (noted !== null) return noted;
  const film = db.prepare('SELECT duration_sec FROM films WHERE id = ?').get(i.filmId) as { duration_sec: number | null } | undefined;
  return usableDuration(film?.duration_sec);
}

/**
 * Ouvre la séance de Cast du visiteur pour ce film, ou met à jour celle qui est déjà ouverte (jamais deux
 * en même temps). `null` s'il n'a pas de location active de ce film, ou si aucune durée n'existe — ni
 * reçue, ni sur la séance, ni `films.duration_sec`. Note aussi le premier lancement de la location : un
 * film lancé directement sur la TV compte comme lancé (garde de temps des critiques).
 */
export function openCastSession(
  db: Db,
  i: Report,
  deps: { markWatchStarted(db: Db, rentalId: number): unknown },
): CastSessionSummary | null {
  const rentalId = activeRentalId(db, i.userId, i.filmId);
  if (rentalId === null) return null;
  const open = findOpenSession(db, i.userId, i.filmId);
  const duration = resolveDuration(db, i, open);
  if (duration === null) return null;
  const position = boundedPosition(i.position);
  const end = estimatedEnd(duration, position);

  // Recherche puis écriture d'une traite, sans attente entre les deux : deux envois rapprochés ne peuvent
  // pas chacun croire qu'il n'y a pas de séance.
  let id: number;
  if (open) {
    db.prepare('UPDATE cast_sessions SET rental_id = ?, duration_seconds = ?, last_position = ?, estimated_end_at = ? WHERE id = ?')
      .run(rentalId, duration, position, end, open.id);
    id = open.id;
  } else {
    id = Number(
      db
        .prepare('INSERT INTO cast_sessions (user_id, film_id, rental_id, duration_seconds, last_position, estimated_end_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(i.userId, i.filmId, rentalId, duration, position, end).lastInsertRowid,
    );
  }
  deps.markWatchStarted(db, rentalId);
  return { id, rental_id: rentalId, duration_seconds: duration, estimated_end_at: end };
}

/**
 * Position (et durée corrigée, si le téléphone en envoie une) de la séance ouverte ; la fin estimée suit.
 * Sans séance ouverte — close entre-temps, ou jamais ouverte parce que le premier envoi s'est perdu — elle
 * en ouvre une, aux mêmes règles que `openCastSession`. Vrai si une séance existe à l'issue de l'appel.
 */
export function reportCastSession(
  db: Db,
  i: Report,
  deps: { markWatchStarted(db: Db, rentalId: number): unknown },
): boolean {
  const open = findOpenSession(db, i.userId, i.filmId);
  if (!open) return openCastSession(db, i, deps) !== null;
  const duration = resolveDuration(db, i, open);
  if (duration === null) return false;
  const position = boundedPosition(i.position);
  db.prepare('UPDATE cast_sessions SET duration_seconds = ?, last_position = ?, estimated_end_at = ? WHERE id = ?')
    .run(duration, position, estimatedEnd(duration, position), open.id);
  return true;
}

type Completion = { completeCastRental(db: Db, session: { rental_id: number | null; user_id: number; film_id: number }): boolean };

/**
 * Vrai si la fin estimée de la séance est passée. `estimated_end_at` est en ISO (« T ») : la comparaison passe par
 * `datetime()` des deux côtés, sinon une séance finie le jour même ne l'est qu'après minuit UTC (voir cast-completion).
 */
function isDue(db: Db, sessionId: number): boolean {
  return db.prepare("SELECT 1 FROM cast_sessions WHERE id = ? AND datetime(estimated_end_at) <= datetime('now')").get(sessionId) !== undefined;
}

/**
 * Clôt la séance ouverte du visiteur pour ce film. `finished` : le téléphone a vu le film se terminer sur
 * la TV — la location est notée vue (100 %, position 0), même si le vérificateur a déjà clos la séance
 * (l'opération est rejouable). Sans `finished` (arrêt en cours de film), la location n'est pas touchée :
 * seule la dernière position connue est notée sur la séance, si on la donne — SAUF si la fin estimée de la séance
 * est passée : le vérificateur l'aurait notée vue à son prochain passage (toutes les 60 s), et le téléphone qui revient
 * dans la minute, ne voyant pas encore 100 %, concluait à un arrêt et empêchait toute complétion. Elle vaut une fin.
 */
export function closeCastSession(
  db: Db,
  i: { userId: number; filmId: number; position?: number | null; finished: boolean },
  deps: Completion,
): void {
  const open = findOpenSession(db, i.userId, i.filmId);
  if (i.finished || (open !== undefined && isDue(db, open.id))) {
    deps.completeCastRental(db, { rental_id: open?.rental_id ?? null, user_id: i.userId, film_id: i.filmId });
  }
  if (typeof i.position === 'number' && Number.isFinite(i.position)) {
    db.prepare('UPDATE cast_sessions SET ended = 1, last_position = ? WHERE user_id = ? AND film_id = ? AND ended = 0')
      .run(boundedPosition(i.position), i.userId, i.filmId);
  } else {
    db.prepare('UPDATE cast_sessions SET ended = 1 WHERE user_id = ? AND film_id = ? AND ended = 0').run(i.userId, i.filmId);
  }
}

/**
 * Le visiteur se déconnecte : toutes ses séances ouvertes sont closes, sans rien noter sur ses locations (la TV a été
 * arrêtée, rien n'a été vu). Appelé par la route de déconnexion AVANT d'effacer le cookie : le DELETE que le
 * téléphone envoie en arrêtant la TV peut arriver après, sans cookie (401), et l'onglet a pu être fermé ou la
 * déconnexion venir d'un autre appareil. Sans cela, le vérificateur passerait la location à 100 % à l'heure de fin
 * estimée. Rend le nombre de séances closes ; rejouable.
 */
export function closeOpenCastSessions(db: Db, userId: number): number {
  return db.prepare('UPDATE cast_sessions SET ended = 1 WHERE user_id = ? AND ended = 0').run(userId).changes;
}

/**
 * Les séances ouvertes de ce visiteur dont la fin estimée est passée : la location est notée vue (100 %, position 0)
 * et la séance close — ce que le vérificateur ferait à son prochain passage. Appelé par `GET /api/me` AVANT de lire
 * les locations : le téléphone qui revient juste après la fin du film lit 100 % et propose « BE KIND REWIND », au lieu
 * de conclure à un arrêt. Rend le nombre de séances complétées ; rejouable.
 */
export function completeDueCastSessions(db: Db, userId: number, deps: Completion): number {
  const due = db
    .prepare("SELECT id, rental_id, film_id FROM cast_sessions WHERE user_id = ? AND ended = 0 AND datetime(estimated_end_at) <= datetime('now')")
    .all(userId) as { id: number; rental_id: number | null; film_id: number }[];
  for (const s of due) {
    deps.completeCastRental(db, { rental_id: s.rental_id, user_id: userId, film_id: s.film_id });
    db.prepare('UPDATE cast_sessions SET ended = 1 WHERE id = ?').run(s.id);
  }
  return due.length;
}
