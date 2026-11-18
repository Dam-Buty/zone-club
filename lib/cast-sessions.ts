import { db } from "./db";
import { completeCastRental, findFinishedCastSessions } from "./cast-completion";
import {
  closeCastSession,
  hasActiveRental,
  openCastSession,
  reportCastSession,
  type CastSessionSummary,
} from "./cast-session-store";
import { markWatchStarted } from "./rental-marks";

// Enveloppe fine : la logique des séances vit dans cast-session-store.ts (testée sur une base en mémoire) ;
// ici on lui passe la vraie base et les deux fonctions de lib/ dont elle dépend.

interface CastSession {
  id: number;
  user_id: number;
  film_id: number;
  rental_id: number | null;
  started_at: string;
  duration_seconds: number;
  last_position: number;
  estimated_end_at: string;
  notified: number;
  ended: number;
}

/** Issue d'une ouverture : le POST répond 200 sans séance quand il n'y a pas de location, 400 quand la durée manque partout. */
export type CastSessionOpening =
  | { status: "opened"; session: CastSessionSummary }
  | { status: "no-rental" }
  | { status: "unknown-duration" };

export function createCastSession(
  userId: number,
  filmId: number,
  currentPosition: number,
  durationSeconds?: number | null,
): CastSessionOpening {
  const session = openCastSession(
    db,
    { userId, filmId, position: currentPosition, durationSeconds },
    { markWatchStarted },
  );
  if (session) return { status: "opened", session };
  // `null` n'a que deux causes : pas de location active, ou aucune durée (ni reçue, ni en base).
  return hasActiveRental(db, userId, filmId)
    ? { status: "unknown-duration" }
    : { status: "no-rental" };
}

export function updateCastSession(
  userId: number,
  filmId: number,
  currentPosition: number,
  durationSeconds?: number | null,
): boolean {
  return reportCastSession(
    db,
    { userId, filmId, position: currentPosition, durationSeconds },
    { markWatchStarted },
  );
}

export function endCastSession(
  userId: number,
  filmId: number,
  opts: { position?: number | null; finished?: boolean } = {},
): void {
  closeCastSession(
    db,
    { userId, filmId, position: opts.position, finished: opts.finished === true },
    { completeCastRental },
  );
}

export function getExpiredUnnotifiedSessions(): (CastSession & {
  film_title: string;
})[] {
  // La requête vit dans cast-completion.ts, testée sur une base en mémoire (comparaison de dates normalisée).
  return findFinishedCastSessions(db) as (CastSession & { film_title: string })[];
}

export function markSessionNotified(sessionId: number): void {
  db.prepare("UPDATE cast_sessions SET notified = 1 WHERE id = ?").run(
    sessionId,
  );
}
