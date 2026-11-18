import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { readText } from '../helpers/repo.mjs';
import { markWatchStarted } from '../../lib/rental-marks.ts';

// « Mon compte » (spec 2026-11-17-borne-mon-compte, § 4 et § 6) : une location garde l'heure de son premier
// lancement (garde de temps des critiques), sa date de retour et sa date d'expiration.
const ROOT = process.cwd();
function freshDb() {
  const db = new Database(':memory:');
  db.exec(readFileSync(path.join(ROOT, 'lib/schema.sql'), 'utf-8'));
  // Colonnes ajoutées par les migrations de lib/db.ts (absentes de schema.sql).
  for (const sql of ['ALTER TABLE rentals ADD COLUMN watch_started_at DATETIME', 'ALTER TABLE rentals ADD COLUMN returned_at DATETIME',
    'ALTER TABLE rentals ADD COLUMN expired_at DATETIME']) {
    try { db.exec(sql); } catch { /* déjà là */ }
  }
  const u = db.prepare("INSERT INTO users (username, password_hash, recovery_phrase_hash) VALUES ('t', 'x', 'y')").run().lastInsertRowid;
  const f = db.prepare("INSERT INTO films (tmdb_id, title) VALUES (1, 'Get Out')").run().lastInsertRowid;
  const rent = (progress = 0, position = 0, started = null) => db.prepare(`INSERT INTO rentals (user_id, film_id, symlink_uuid, expires_at, watch_progress, watch_position, watch_started_at)
    VALUES (?, ?, lower(hex(randomblob(8))), datetime('now', '+1 day'), ?, ?, ?)`).run(u, f, progress, position, started).lastInsertRowid;
  const started = (id) => db.prepare('SELECT watch_started_at FROM rentals WHERE id = ?').get(id).watch_started_at;
  return { db, rent, started };
}

test('LOCATION: le premier lancement est noté sur une location vierge', () => {
  const { db, rent, started } = freshDb();
  const id = rent();
  assert.equal(markWatchStarted(db, id), true);
  assert.ok(started(id));
});
test('LOCATION: une location déjà entamée (avant le déploiement) ne reçoit pas de lancement', () => {
  const { db, rent, started } = freshDb();
  const id = rent(30, 812);
  assert.equal(markWatchStarted(db, id), false);
  assert.equal(started(id), null);
});
test('LOCATION: le lancement déjà noté ne bouge plus', () => {
  const { db, rent, started } = freshDb();
  const id = rent(0, 0, '2026-01-01 00:00:00');
  assert.equal(markWatchStarted(db, id), false);
  assert.equal(started(id), '2026-01-01 00:00:00');
});
test('LOCATION: les migrations, le retour, l\'expiration et le Cast posent leurs dates', () => {
  const dbSrc = readText(path.join(ROOT, 'lib/db.ts'));
  for (const col of ['watch_started_at', 'returned_at', 'expired_at']) assert.ok(dbSrc.includes(`ADD COLUMN ${col} DATETIME`), col);
  const rentals = readText(path.join(ROOT, 'lib/rentals.ts'));
  const upd = rentals.slice(rentals.indexOf('export function updateWatchProgress'), rentals.indexOf('const EXTENSION_HOURS'));
  assert.ok(upd.indexOf('markWatchStarted(') !== -1 && upd.indexOf('markWatchStarted(') < upd.indexOf('SET watch_position'), 'lancement noté avant la position');
  const ret = rentals.slice(rentals.indexOf('export async function returnFilm'), rentals.indexOf('export function createReturnRequest'));
  assert.match(ret, /returned_at = datetime\('now'\)/);
  const clean = rentals.slice(rentals.indexOf('export async function cleanupExpiredRentals'));
  assert.match(clean, /expired_at = expires_at/);
  const cast = readText(path.join(ROOT, 'lib/cast-sessions.ts'));
  assert.ok(cast.includes('markWatchStarted('), 'le Cast note aussi le lancement');
});
