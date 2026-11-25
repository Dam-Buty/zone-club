import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { readText } from '../helpers/repo.mjs';
import { completeCastRental } from '../../lib/cast-completion.ts';

// Suivi serveur d'un film regardé sur la TV (spec 2026-11-17-cast-suivi-serveur) : téléphone éteint,
// la séance de Cast arrive à sa fin estimée, le serveur note la location vue.
function freshDb() {
  const db = new Database(':memory:');
  db.exec(readFileSync(path.join(process.cwd(), 'lib/schema.sql'), 'utf-8'));
  // cast_sessions est créée par une migration de lib/db.ts (pas par schema.sql) : mêmes colonnes ici.
  db.exec(`CREATE TABLE cast_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, film_id INTEGER NOT NULL,
    rental_id INTEGER, started_at DATETIME DEFAULT CURRENT_TIMESTAMP, duration_seconds REAL NOT NULL, last_position REAL DEFAULT 0,
    estimated_end_at DATETIME NOT NULL, notified INTEGER DEFAULT 0, ended INTEGER DEFAULT 0)`);
  const u = db.prepare("INSERT INTO users (username, password_hash, recovery_phrase_hash) VALUES ('t', 'x', 'y')").run().lastInsertRowid;
  const f = db.prepare("INSERT INTO films (tmdb_id, title) VALUES (1, 'Get Out')").run().lastInsertRowid;
  const rent = (extra = {}) => {
    const r = { progress: 30, position: 812, active: 1, expires: "datetime('now', '+1 day')", completed: null, ...extra };
    return db.prepare(`INSERT INTO rentals (user_id, film_id, symlink_uuid, expires_at, is_active, watch_progress, watch_position, watch_completed_at)
      VALUES (?, ?, lower(hex(randomblob(8))), ${r.expires}, ?, ?, ?, ?)`).run(u, f, r.active, r.progress, r.position, r.completed).lastInsertRowid;
  };
  const row = (id) => db.prepare('SELECT watch_progress, watch_position, watch_completed_at FROM rentals WHERE id = ?').get(id);
  return { db, u, f, rent, row };
}

test('CAST SERVEUR: la séance finie note sa location vue, même expirée', () => {
  const { db, u, f, rent, row } = freshDb();
  const r1 = rent({ active: 0, expires: "datetime('now', '-1 hour')" });
  assert.equal(completeCastRental(db, { rental_id: r1, user_id: u, film_id: f }), true);
  const r = row(r1);
  assert.equal(r.watch_progress, 100);
  assert.equal(r.watch_position, 0);
  assert.ok(r.watch_completed_at);
});
test('CAST SERVEUR: sans rental_id, la location la plus récente du visiteur pour ce film', () => {
  const { db, u, f, rent, row } = freshDb();
  const rOld = rent();
  const rNew = rent();
  assert.equal(completeCastRental(db, { rental_id: null, user_id: u, film_id: f }), true);
  assert.equal(row(rNew).watch_progress, 100);
  assert.equal(row(rOld).watch_progress, 30);
});
test('CAST SERVEUR: idempotent — watch_completed_at garde sa première date', () => {
  const { db, u, f, rent, row } = freshDb();
  const r1 = rent({ completed: '2026-01-01 00:00:00' });
  completeCastRental(db, { rental_id: r1, user_id: u, film_id: f });
  completeCastRental(db, { rental_id: r1, user_id: u, film_id: f });
  assert.equal(row(r1).watch_completed_at, '2026-01-01 00:00:00');
  assert.equal(row(r1).watch_progress, 100);
});
test('CAST SERVEUR: aucune location → false, rien ne casse', () => {
  const { db, u } = freshDb();
  assert.equal(completeCastRental(db, { rental_id: null, user_id: u, film_id: 99999 }), false);
});
test('CAST SERVEUR: le vérificateur note la location avant la notification, sans en dépendre', () => {
  const src = readText(path.join(process.cwd(), 'lib/cast-session-checker.ts'));
  const at = src.indexOf('completeCastRental(');
  assert.ok(at !== -1 && at < src.indexOf('sendPushNotification('), 'notée avant la notification');
  const before = src.slice(Math.max(0, at - 120), at);
  assert.match(before, /try\s*\{\s*$/, 'son propre try : un échec de l\'un n\'annule pas l\'autre');
});

// La fin estimée est écrite en ISO (« 2026-11-17T21:04:05.000Z ») : comparée en chaîne à
// datetime('now') (« 2026-11-17 21:05:00 »), une séance finie le jour même n'était jamais trouvée
// avant minuit UTC — le « T » passe après l'espace.
test('CAST SERVEUR: une séance finie le jour même est trouvée tout de suite', async () => {
  const { findFinishedCastSessions } = await import('../../lib/cast-completion.ts');
  const { db, u, f } = freshDb();
  const iso = (ms) => new Date(Date.now() + ms).toISOString();
  const add = (end, extra = '') => db.prepare(`INSERT INTO cast_sessions (user_id, film_id, rental_id, duration_seconds, last_position, estimated_end_at${extra ? ', ' + extra.split('=')[0] : ''})
    VALUES (?, ?, NULL, 3600, 0, ?${extra ? ', ' + extra.split('=')[1] : ''})`).run(u, f, end).lastInsertRowid;
  const done = add(iso(-2000));
  add(iso(+3_600_000));
  add(iso(-2000), 'ended=1');
  add(iso(-2000), 'notified=1');
  const found = findFinishedCastSessions(db);
  assert.deepEqual(found.map((s) => s.id), [done]);
  assert.equal(found[0].film_title, 'Get Out');
});
test('CAST SERVEUR: si la location ne peut être notée, la séance n\'est pas notifiée (rejouée au passage suivant)', () => {
  const src = readText(path.join(process.cwd(), 'lib/cast-session-checker.ts'));
  const at = src.indexOf('completeCastRental(');
  const catchBlock = src.slice(src.indexOf('catch', at), src.indexOf('catch', at) + 200);
  assert.match(catchBlock, /continue;/, 'pas de notification tant que la location n\'est pas notée');
});
