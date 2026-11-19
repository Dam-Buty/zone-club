import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { readText } from '../helpers/repo.mjs';
import { completeCastRental } from '../../lib/cast-completion.ts';
import { markWatchStarted } from '../../lib/rental-marks.ts';
import { openCastSession, reportCastSession, closeCastSession, hasActiveRental } from '../../lib/cast-session-store.ts';

// Séances de Cast tenues par le serveur (docs/superpowers/specs/2026-11-18-cast-refonte-design.md) :
// sans durée obligatoire, sans doublon, closes à la fin.
const ROOT = process.cwd();

function freshDb({ filmDuration = 6840 } = {}) {
  const db = new Database(':memory:');
  db.exec(readFileSync(path.join(ROOT, 'lib/schema.sql'), 'utf-8'));
  // watch_started_at et cast_sessions sont créées par des migrations de lib/db.ts (pas par schema.sql) :
  // mêmes définitions ici.
  db.exec('ALTER TABLE rentals ADD COLUMN watch_started_at DATETIME');
  db.exec(`CREATE TABLE cast_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, film_id INTEGER NOT NULL,
    rental_id INTEGER, started_at DATETIME DEFAULT CURRENT_TIMESTAMP, duration_seconds REAL NOT NULL, last_position REAL DEFAULT 0,
    estimated_end_at DATETIME NOT NULL, notified INTEGER DEFAULT 0, ended INTEGER DEFAULT 0)`);
  const u = db.prepare("INSERT INTO users (username, password_hash, recovery_phrase_hash) VALUES ('t', 'x', 'y')").run().lastInsertRowid;
  const f = db.prepare("INSERT INTO films (tmdb_id, title, duration_sec) VALUES (1, 'Get Out', ?)").run(filmDuration).lastInsertRowid;
  const rent = (extra = {}) => {
    const r = { progress: 30, position: 812, active: 1, ...extra };
    return db.prepare(`INSERT INTO rentals (user_id, film_id, symlink_uuid, expires_at, is_active, watch_progress, watch_position)
      VALUES (?, ?, lower(hex(randomblob(8))), datetime('now', '+1 day'), ?, ?, ?)`).run(u, f, r.active, r.progress, r.position).lastInsertRowid;
  };
  const rental = (id) => db.prepare('SELECT watch_progress, watch_position, watch_completed_at, watch_started_at FROM rentals WHERE id = ?').get(id);
  const sessions = () => db.prepare('SELECT * FROM cast_sessions ORDER BY id').all();
  return { db, u, f, rent, rental, sessions };
}

// Les dépendances sont les vraies fonctions de lib/ ; `started` compte les lancements notés.
function makeDeps() {
  const started = [];
  return {
    started,
    deps: {
      markWatchStarted: (db, rentalId) => { started.push(rentalId); return markWatchStarted(db, rentalId); },
      completeCastRental,
    },
  };
}

test('CAST SÉANCE: sans durée reçue, celle du film en base', () => {
  const { db, u, f, rent } = freshDb({ filmDuration: 6840 });
  const { deps } = makeDeps();
  const r = rent();
  const s = openCastSession(db, { userId: u, filmId: f, position: 0 }, deps);
  assert.equal(s.duration_seconds, 6840);
  assert.equal(s.rental_id, r);
});
test('CAST SÉANCE: aucune durée nulle part → null', () => {
  const { db, u, f, rent, sessions } = freshDb({ filmDuration: null });
  const { deps } = makeDeps();
  rent();
  assert.equal(openCastSession(db, { userId: u, filmId: f, position: 0, durationSeconds: 0 }, deps), null);
  assert.equal(sessions().length, 0);
});
test('CAST SÉANCE: sans location active → null, aucune ligne', () => {
  const { db, u, f } = freshDb({ filmDuration: 6840 });
  const { deps } = makeDeps();
  assert.equal(openCastSession(db, { userId: u, filmId: f, position: 0 }, deps), null);
  assert.equal(db.prepare('SELECT count(*) n FROM cast_sessions').get().n, 0);
});
test('CAST SÉANCE: une location rendue (inactive) n\'ouvre pas de séance', () => {
  const { db, u, f, rent } = freshDb({ filmDuration: 6840 });
  const { deps } = makeDeps();
  rent({ active: 0 });
  assert.equal(hasActiveRental(db, u, f), false);
  assert.equal(openCastSession(db, { userId: u, filmId: f, position: 0 }, deps), null);
});
test('CAST SÉANCE: une seconde ouverture met à jour la même ligne', () => {
  const { db, u, f, rent } = freshDb({ filmDuration: 6840 }); rent();
  const { deps } = makeDeps();
  const a = openCastSession(db, { userId: u, filmId: f, position: 0 }, deps);
  const b = openCastSession(db, { userId: u, filmId: f, position: 120, durationSeconds: 596.5 }, deps);
  assert.equal(b.id, a.id);
  assert.equal(b.duration_seconds, 596.5);
  assert.equal(db.prepare('SELECT count(*) n FROM cast_sessions WHERE ended = 0').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) n FROM cast_sessions').get().n, 1);
});
test('CAST SÉANCE: le téléphone corrige la durée, la fin estimée suit', () => {
  const { db, u, f, rent } = freshDb({ filmDuration: 6840 }); rent();
  const { deps } = makeDeps();
  openCastSession(db, { userId: u, filmId: f, position: 0 }, deps);
  reportCastSession(db, { userId: u, filmId: f, position: 500, durationSeconds: 596.5 }, deps);
  const s = db.prepare('SELECT duration_seconds d, last_position p, estimated_end_at e FROM cast_sessions').get();
  assert.equal(s.d, 596.5); assert.equal(s.p, 500);
  const left = (Date.parse(s.e) - Date.now()) / 1000;
  assert.ok(left > 90 && left < 100, `reste ${left}`);
});
test('CAST SÉANCE: un envoi de position sans durée garde la durée corrigée, pas celle du film', () => {
  const { db, u, f, rent } = freshDb({ filmDuration: 6840 }); rent();
  const { deps } = makeDeps();
  openCastSession(db, { userId: u, filmId: f, position: 0, durationSeconds: 596.5 }, deps);
  assert.equal(reportCastSession(db, { userId: u, filmId: f, position: 200 }, deps), true);
  const s = db.prepare('SELECT duration_seconds d, last_position p FROM cast_sessions').get();
  assert.equal(s.d, 596.5);
  assert.equal(s.p, 200);
});
test('CAST SÉANCE: un envoi de position sans séance ouverte en rouvre une', () => {
  const { db, u, f, rent, sessions } = freshDb({ filmDuration: 6840 });
  const { deps } = makeDeps();
  const r = rent();
  assert.equal(reportCastSession(db, { userId: u, filmId: f, position: 1000 }, deps), true);
  const open = db.prepare('SELECT * FROM cast_sessions WHERE ended = 0').all();
  assert.equal(open.length, 1);
  assert.equal(open[0].rental_id, r);
  assert.equal(open[0].last_position, 1000);
  assert.equal(open[0].duration_seconds, 6840);
  assert.equal(sessions().length, 1);
});
test('CAST SÉANCE: un envoi de position sans location ni séance ne crée rien', () => {
  const { db, u, f, sessions } = freshDb({ filmDuration: 6840 });
  const { deps } = makeDeps();
  assert.equal(reportCastSession(db, { userId: u, filmId: f, position: 10 }, deps), false);
  assert.equal(sessions().length, 0);
});
test('CAST SÉANCE: entrées bornées', () => {
  const { db, u, f, rent } = freshDb({ filmDuration: 6840 }); rent();
  const { deps } = makeDeps();
  const isoOk = (s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s) && !Number.isNaN(Date.parse(s));
  // position négative → 0
  const a = openCastSession(db, { userId: u, filmId: f, position: -5 }, deps);
  assert.equal(db.prepare('SELECT last_position p FROM cast_sessions WHERE id = ?').get(a.id).p, 0);
  assert.ok(isoOk(a.estimated_end_at));
  // position NaN → 0
  reportCastSession(db, { userId: u, filmId: f, position: NaN }, deps);
  assert.equal(db.prepare('SELECT last_position p FROM cast_sessions WHERE id = ?').get(a.id).p, 0);
  // position infinie ou absente → 0
  reportCastSession(db, { userId: u, filmId: f, position: Infinity }, deps);
  assert.equal(db.prepare('SELECT last_position p FROM cast_sessions WHERE id = ?').get(a.id).p, 0);
  // durée -1 ou NaN : on garde la durée connue (celle du film), jamais la valeur reçue
  for (const bad of [-1, NaN, Infinity, 0, '600', null]) {
    const s = openCastSession(db, { userId: u, filmId: f, position: 0, durationSeconds: bad }, deps);
    assert.equal(s.duration_seconds, 6840, `durée reçue ${String(bad)}`);
    assert.ok(isoOk(s.estimated_end_at), `fin estimée valide pour ${String(bad)}`);
  }
  // durée absurde : refusée, la fin estimée reste une date valide
  const huge = openCastSession(db, { userId: u, filmId: f, position: 0, durationSeconds: 1e300 }, deps);
  assert.equal(huge.duration_seconds, 6840);
  assert.ok(isoOk(huge.estimated_end_at));
  // position au-delà de la durée : fin estimée = maintenant, pas dans le passé lointain
  const past = openCastSession(db, { userId: u, filmId: f, position: 99999 }, deps);
  assert.ok(isoOk(past.estimated_end_at));
  assert.ok(Math.abs(Date.parse(past.estimated_end_at) - Date.now()) < 5000);
  // jamais plus d'une séance ouverte au bout de tout cela
  assert.equal(db.prepare('SELECT count(*) n FROM cast_sessions WHERE ended = 0').get().n, 1);
});
test('CAST SÉANCE: l\'ouverture note le lancement d\'une location encore intacte', () => {
  const { db, u, f, rent, rental } = freshDb({ filmDuration: 6840 });
  const { deps, started } = makeDeps();
  const r = rent({ progress: 0, position: 0 });
  assert.equal(rental(r).watch_started_at, null);
  openCastSession(db, { userId: u, filmId: f, position: 0 }, deps);
  assert.ok(rental(r).watch_started_at, 'lancement noté');
  assert.deepEqual(started, [r]);
});
test('CAST SÉANCE: fin vue par le téléphone = location à 100 %, position 0, séance close', () => {
  const { db, u, f, rent, rental } = freshDb({ filmDuration: 6840 });
  const { deps } = makeDeps();
  const r = rent();
  openCastSession(db, { userId: u, filmId: f, position: 6000 }, deps);
  assert.equal(rental(r).watch_progress, 30);
  closeCastSession(db, { userId: u, filmId: f, finished: true }, deps);
  const after = rental(r);
  assert.equal(after.watch_progress, 100);
  assert.equal(after.watch_position, 0);
  assert.ok(after.watch_completed_at);
  const s = db.prepare('SELECT ended FROM cast_sessions').get();
  assert.equal(s.ended, 1);
});
test('CAST SÉANCE: fin vue par le téléphone alors que le vérificateur a déjà clos la séance : location notée quand même', () => {
  const { db, u, f, rent, rental } = freshDb({ filmDuration: 6840 });
  const { deps } = makeDeps();
  const r = rent();
  openCastSession(db, { userId: u, filmId: f, position: 6000 }, deps);
  db.prepare('UPDATE cast_sessions SET ended = 1').run();
  closeCastSession(db, { userId: u, filmId: f, finished: true }, deps);
  assert.equal(rental(r).watch_progress, 100);
});
test('CAST SÉANCE: arrêt en cours de film = séance close, location intacte, position notée', () => {
  const { db, u, f, rent, rental } = freshDb({ filmDuration: 6840 });
  const { deps } = makeDeps();
  const r = rent();
  openCastSession(db, { userId: u, filmId: f, position: 100 }, deps);
  closeCastSession(db, { userId: u, filmId: f, finished: false, position: 300 }, deps);
  const s = db.prepare('SELECT ended, last_position p FROM cast_sessions').get();
  assert.equal(s.ended, 1);
  assert.equal(s.p, 300);
  const after = rental(r);
  assert.equal(after.watch_progress, 30);
  assert.equal(after.watch_position, 812);
  assert.equal(after.watch_completed_at, null);
});
test('CAST SÉANCE: arrêt sans position ni séance ouverte : rien ne casse, rien ne change', () => {
  const { db, u, f, rent, rental, sessions } = freshDb({ filmDuration: 6840 });
  const { deps } = makeDeps();
  const r = rent();
  closeCastSession(db, { userId: u, filmId: f, finished: false }, deps);
  assert.equal(sessions().length, 0);
  assert.equal(rental(r).watch_progress, 30);
  // une séance ouverte, arrêtée sans position : la dernière position connue reste
  openCastSession(db, { userId: u, filmId: f, position: 100 }, deps);
  closeCastSession(db, { userId: u, filmId: f, finished: false, position: null }, deps);
  const s = db.prepare('SELECT ended, last_position p FROM cast_sessions').get();
  assert.equal(s.ended, 1);
  assert.equal(s.p, 100);
});
test('CAST SÉANCE: une séance close n\'est plus mise à jour : une nouvelle séance s\'ouvre', () => {
  const { db, u, f, rent, sessions } = freshDb({ filmDuration: 6840 });
  const { deps } = makeDeps();
  rent();
  const a = openCastSession(db, { userId: u, filmId: f, position: 0 }, deps);
  closeCastSession(db, { userId: u, filmId: f, finished: false, position: 50 }, deps);
  const b = openCastSession(db, { userId: u, filmId: f, position: 50 }, deps);
  assert.notEqual(b.id, a.id);
  assert.equal(sessions().length, 2);
  assert.equal(db.prepare('SELECT count(*) n FROM cast_sessions WHERE ended = 0').get().n, 1);
});

// Le vérificateur ne laisse pas la séance qu'il vient de compléter ouverte : sinon elle est retrouvée
// à chaque passage et la notification n'a aucune garde de fin (statique, comme ses voisins).
test('CAST SÉANCE: le vérificateur clôt la séance qu\'il complète', () => {
  const src = readText(path.join(ROOT, 'lib/cast-session-checker.ts'));
  const complete = src.indexOf('completeCastRental(');
  const close = src.search(/UPDATE cast_sessions SET ended = 1 WHERE id = \?/);
  const push = src.indexOf('sendPushNotification(');
  assert.ok(complete !== -1 && close !== -1 && push !== -1, 'les trois appels existent');
  assert.ok(complete < close, 'close après la location notée');
  assert.ok(close < push, 'close avant la notification');
});

// Le module ne tire aucune valeur : Node le charge tel quel dans ce test, et la base lui est passée.
test('CAST SÉANCE: le module du serveur n\'importe aucune valeur', () => {
  const src = readText(path.join(ROOT, 'lib/cast-session-store.ts'));
  assert.doesNotMatch(src, /^\s*import\s+(?!type\b)/m, 'import de valeur');
  assert.doesNotMatch(src, /\brequire\(/, 'require');
  assert.doesNotMatch(src, /^\s*export\s+(\*|\{[^}]*\})\s+from\b/m, 'réexport de valeur');
});

// La route ne rejette plus un POST sans durée : le serveur retombe sur celle du film, et ne répond 400
// que si elle est introuvable partout.
test('CAST SÉANCE: la route ne demande plus la durée et dit « Durée du film inconnue » quand elle manque partout', () => {
  const src = readText(path.join(ROOT, 'app/api/cast-sessions/route.ts'));
  assert.doesNotMatch(src, /!filmId\s*\|\|\s*!durationSeconds/, 'plus de durée obligatoire');
  assert.match(src, /Durée du film inconnue/);
  assert.match(src, /status: 400/);
  const del = src.slice(src.indexOf('export async function DELETE'));
  assert.match(del, /finished/, 'DELETE lit finished');
  assert.match(del, /currentPosition/, 'DELETE lit currentPosition');
});

// Relecture finale, A2 : se déconnecter pendant un Cast laissait la séance serveur ouverte (le DELETE du téléphone
// partait après l'effacement du cookie : 401), et le vérificateur passait la location à 100 % à l'heure de fin
// estimée alors que la TV avait été arrêtée. La déconnexion clôt elle-même les séances du visiteur, avant d'effacer
// le cookie — ce qui couvre aussi l'onglet fermé puis la déconnexion depuis un autre appareil.
test('CAST SÉANCE A2: la déconnexion clôt toutes les séances ouvertes du visiteur, locations intactes', async () => {
  const { closeOpenCastSessions } = await import('../../lib/cast-session-store.ts');
  const { db, u, f, rent, rental, sessions } = freshDb({ filmDuration: 6840 });
  const { deps } = makeDeps();
  const r = rent();
  // Un second film du même visiteur, et la séance d'un autre visiteur sur le même film.
  const f2 = db.prepare("INSERT INTO films (tmdb_id, title, duration_sec) VALUES (2, 'Us', 6960)").run().lastInsertRowid;
  const r2 = db.prepare(`INSERT INTO rentals (user_id, film_id, symlink_uuid, expires_at, is_active, watch_progress, watch_position)
    VALUES (?, ?, 'u2', datetime('now', '+1 day'), 1, 55, 3000)`).run(u, f2).lastInsertRowid;
  const other = db.prepare("INSERT INTO users (username, password_hash, recovery_phrase_hash) VALUES ('o', 'x', 'y')").run().lastInsertRowid;
  db.prepare(`INSERT INTO rentals (user_id, film_id, symlink_uuid, expires_at, is_active, watch_progress, watch_position)
    VALUES (?, ?, 'o1', datetime('now', '+1 day'), 1, 10, 600)`).run(other, f);
  openCastSession(db, { userId: u, filmId: f, position: 100 }, deps);
  openCastSession(db, { userId: u, filmId: f2, position: 200 }, deps);
  openCastSession(db, { userId: other, filmId: f, position: 300 }, deps);
  assert.equal(closeOpenCastSessions(db, u), 2, 'deux séances closes');
  const byUser = (id) => sessions().filter((s) => s.user_id === id).map((s) => s.ended);
  assert.deepEqual(byUser(u), [1, 1], 'celles du visiteur sont closes');
  assert.deepEqual(byUser(other), [0], 'celle d\'un autre visiteur reste ouverte');
  // Ni fin notée, ni position touchée : la TV a été arrêtée, rien n'a été vu.
  assert.equal(rental(r).watch_progress, 30); assert.equal(rental(r).watch_position, 812); assert.equal(rental(r).watch_completed_at, null);
  assert.equal(rental(r2).watch_progress, 55); assert.equal(rental(r2).watch_position, 3000);
  // Rejouable, et sans séance rien ne casse.
  assert.equal(closeOpenCastSessions(db, u), 0);
});

test('CAST SÉANCE A2: la route de déconnexion clôt les séances AVANT d\'effacer le cookie', () => {
  const src = readText(path.join(ROOT, 'app/api/auth/logout/route.ts'));
  const close = src.indexOf('endAllCastSessions(');
  const cookie = src.indexOf("cookieStore.set('session'");
  assert.ok(close > 0, 'la route clôt les séances du visiteur');
  assert.ok(cookie > close, 'avant d\'effacer le cookie');
  assert.ok(src.includes('getUserFromSession('), 'le visiteur est lu sur son cookie');
  // Une base en panne ne doit pas empêcher de se déconnecter.
  const guarded = src.slice(src.lastIndexOf('try {', close), cookie);
  assert.ok(guarded.includes('catch'), 'la clôture est gardée');
  const wrapper = readText(path.join(ROOT, 'lib/cast-sessions.ts'));
  assert.ok(/export function endAllCastSessions\(/.test(wrapper) && wrapper.includes('closeOpenCastSessions('), 'l\'enveloppe passe la vraie base');
});
