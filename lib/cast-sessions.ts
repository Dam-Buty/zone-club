import { db } from "./db";
import { findFinishedCastSessions } from "./cast-completion";
import { markWatchStarted } from "./rental-marks";

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

export function createCastSession(
  userId: number,
  filmId: number,
  durationSeconds: number,
  currentPosition: number,
): CastSession {
  // End any existing active session for this user+film
  db.prepare(
    "UPDATE cast_sessions SET ended = 1 WHERE user_id = ? AND film_id = ? AND ended = 0",
  ).run(userId, filmId);

  const remainingSeconds = Math.max(0, durationSeconds - currentPosition);
  const estimatedEndAt = new Date(
    Date.now() + remainingSeconds * 1000,
  ).toISOString();

  // Find active rental
  const rental = db
    .prepare(
      "SELECT id FROM rentals WHERE user_id = ? AND film_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1",
    )
    .get(userId, filmId) as { id: number } | undefined;

  // Un film lancé directement sur la TV compte comme lancé (garde de temps des critiques).
  if (rental) markWatchStarted(db, rental.id);

  const result = db
    .prepare(
      `INSERT INTO cast_sessions (user_id, film_id, rental_id, duration_seconds, last_position, estimated_end_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      filmId,
      rental?.id ?? null,
      durationSeconds,
      currentPosition,
      estimatedEndAt,
    );

  return db
    .prepare("SELECT * FROM cast_sessions WHERE id = ?")
    .get(result.lastInsertRowid) as CastSession;
}

export function updateCastSession(
  userId: number,
  filmId: number,
  currentPosition: number,
): void {
  const session = db
    .prepare(
      "SELECT * FROM cast_sessions WHERE user_id = ? AND film_id = ? AND ended = 0 ORDER BY id DESC LIMIT 1",
    )
    .get(userId, filmId) as CastSession | undefined;

  if (!session) return;

  const remainingSeconds = Math.max(
    0,
    session.duration_seconds - currentPosition,
  );
  const estimatedEndAt = new Date(
    Date.now() + remainingSeconds * 1000,
  ).toISOString();

  db.prepare(
    "UPDATE cast_sessions SET last_position = ?, estimated_end_at = ? WHERE id = ?",
  ).run(currentPosition, estimatedEndAt, session.id);
}

export function endCastSession(userId: number, filmId: number): void {
  db.prepare(
    "UPDATE cast_sessions SET ended = 1 WHERE user_id = ? AND film_id = ? AND ended = 0",
  ).run(userId, filmId);
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
