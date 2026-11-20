import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { readText } from '../helpers/repo.mjs';
import { readVersionPref, writeVersionPref, parseVersionPrefBody } from '../../lib/version-pref.ts';

// La version préférée du compte (docs/superpowers/specs/2026-11-19-versions-et-erreurs-de-lecture-design.md, § 4.2) :
// un réglage que le visiteur fait lui-même dans « Mon compte », jamais déduit par l'application. Deux colonnes sur
// `users`, nulles = « Automatique ». PATCH /api/me/version l'écrit, GET /api/me la rend. Une préférence illisible en
// base vaut « Automatique », jamais une exception.
const ROOT = process.cwd();

function freshDb() {
  const db = new Database(':memory:');
  db.exec(readFileSync(path.join(ROOT, 'lib/schema.sql'), 'utf-8'));
  const user = (name) => db.prepare("INSERT INTO users (username, password_hash, recovery_phrase_hash) VALUES (?, 'x', 'y')").run(name).lastInsertRowid;
  const columns = (id) => db.prepare('SELECT pref_audio, pref_subtitle FROM users WHERE id = ?').get(id);
  const setColumns = (id, audio, subtitle) => db.prepare('UPDATE users SET pref_audio = ?, pref_subtitle = ? WHERE id = ?').run(audio, subtitle, id);
  return { db, user, columns, setColumns, u: user('visiteur') };
}

// Les six couples : les cinq de la liste (VF, VOSTFR, VO, puis les deux d'« Autres versions »), et le sixième, sans
// ligne dans la liste, que seule la touche T du lecteur atteint.
const COUPLES = [
  ['VF', { audio: 'vf', subtitle: 'off' }],
  ['VOSTFR', { audio: 'vo', subtitle: 'fr' }],
  ['VO', { audio: 'vo', subtitle: 'off' }],
  ['VF sous-titrée', { audio: 'vf', subtitle: 'fr' }],
  ['VO, sous-titres anglais', { audio: 'vo', subtitle: 'en' }],
  ['VF · sous-titres anglais', { audio: 'vf', subtitle: 'en' }],
];

// ---------- Lecture et écriture en base ----------

test('VERSION PRÉFÉRÉE: un compte qui n\'a rien réglé est en « Automatique » (null), colonnes nulles', () => {
  const { db, u, columns } = freshDb();
  assert.deepEqual(columns(u), { pref_audio: null, pref_subtitle: null });
  assert.equal(readVersionPref(db, u), null);
});

test('VERSION PRÉFÉRÉE: une préférence écrite se relit telle quelle, pour chacun des six couples', () => {
  const { db, u, columns } = freshDb();
  for (const [name, pref] of COUPLES) {
    writeVersionPref(db, u, pref);
    assert.deepEqual(columns(u), { pref_audio: pref.audio, pref_subtitle: pref.subtitle }, `colonnes pour ${name}`);
    assert.deepEqual(readVersionPref(db, u), pref, `relue : ${name}`);
  }
});

test('VERSION PRÉFÉRÉE: régler la préférence d\'un visiteur ne touche pas celle d\'un autre', () => {
  const { db, u, user, columns } = freshDb();
  const other = user('autre');
  writeVersionPref(db, other, { audio: 'vf', subtitle: 'fr' });
  writeVersionPref(db, u, { audio: 'vo', subtitle: 'fr' });
  assert.deepEqual(readVersionPref(db, other), { audio: 'vf', subtitle: 'fr' });
  writeVersionPref(db, u, null);
  assert.deepEqual(columns(other), { pref_audio: 'vf', pref_subtitle: 'fr' }, 'l\'autre compte garde sa préférence');
});

test('VERSION PRÉFÉRÉE: null (« Automatique ») remet les deux colonnes à NULL', () => {
  const { db, u, columns } = freshDb();
  writeVersionPref(db, u, { audio: 'vo', subtitle: 'fr' });
  assert.deepEqual(columns(u), { pref_audio: 'vo', pref_subtitle: 'fr' });
  writeVersionPref(db, u, null);
  assert.deepEqual(columns(u), { pref_audio: null, pref_subtitle: null });
  assert.equal(readVersionPref(db, u), null);
});

test('VERSION PRÉFÉRÉE: préférence partielle — une colonne nulle et pas l\'autre → « Automatique », sans lever', () => {
  const { db, u, setColumns } = freshDb();
  for (const [audio, subtitle] of [['vo', null], [null, 'fr'], ['vf', null], [null, 'off']]) {
    setColumns(u, audio, subtitle);
    let read;
    assert.doesNotThrow(() => { read = readVersionPref(db, u); }, `${audio} / ${subtitle}`);
    assert.equal(read, null, `${audio} / ${subtitle} → Automatique`);
  }
});

test('VERSION PRÉFÉRÉE: préférence partielle — une valeur inconnue en base → « Automatique », sans lever', () => {
  const { db, u, setColumns } = freshDb();
  const unreadable = [['xx', 'fr'], ['vo', 'xx'], ['xx', 'xx'], ['VF', 'off'], ['vo', 'FR'], ['', 'off'], ['vf', ''], [1, 'off'], ['vo', 0]];
  for (const [audio, subtitle] of unreadable) {
    setColumns(u, audio, subtitle);
    let read;
    assert.doesNotThrow(() => { read = readVersionPref(db, u); }, `${audio} / ${subtitle}`);
    assert.equal(read, null, `${String(audio)} / ${String(subtitle)} → Automatique`);
  }
});

test('VERSION PRÉFÉRÉE: un compte inconnu → « Automatique », sans lever', () => {
  const { db } = freshDb();
  let read;
  assert.doesNotThrow(() => { read = readVersionPref(db, 9999); });
  assert.equal(read, null);
});

test('VERSION PRÉFÉRÉE: une base existante gagne les deux colonnes par lib/db.ts, nulles pour les comptes déjà là', () => {
  // Les deux ALTER TABLE de lib/db.ts, rejoués sur une table `users` d'avant la préférence.
  const src = readText(path.join(ROOT, 'lib/db.ts'));
  const alters = [...src.matchAll(/"(ALTER TABLE users ADD COLUMN pref_\w+ [^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(alters, [
    'ALTER TABLE users ADD COLUMN pref_audio TEXT DEFAULT NULL',
    'ALTER TABLE users ADD COLUMN pref_subtitle TEXT DEFAULT NULL',
  ]);
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
    recovery_phrase_hash TEXT NOT NULL, credits INTEGER DEFAULT 5, is_admin BOOLEAN DEFAULT FALSE, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  const old = db.prepare("INSERT INTO users (username, password_hash, recovery_phrase_hash) VALUES ('ancien', 'x', 'y')").run().lastInsertRowid;
  for (const sql of alters) db.exec(sql);
  assert.equal(readVersionPref(db, old), null, 'un compte d\'avant la migration est en « Automatique »');
  writeVersionPref(db, old, { audio: 'vo', subtitle: 'fr' });
  assert.deepEqual(readVersionPref(db, old), { audio: 'vo', subtitle: 'fr' });
  // Au démarrage suivant, la colonne existe : l'ALTER lève, et lib/db.ts l'avale (migration idempotente).
  for (const sql of alters) assert.throws(() => db.exec(sql), /duplicate column/);
  const tail = src.slice(src.indexOf(alters[0]));
  assert.match(
    tail,
    /^ALTER TABLE users ADD COLUMN pref_audio TEXT DEFAULT NULL",\s*"ALTER TABLE users ADD COLUMN pref_subtitle TEXT DEFAULT NULL",?\s*\];\s*for \(const sql of \w+\) \{\s*try \{\s*db\.exec\(sql\);\s*\} catch/,
    'les deux ALTER sont rejoués un par un dans un try / catch, comme les autres migrations',
  );
});

// ---------- Le corps du PATCH ----------

test('VERSION PRÉFÉRÉE: parseVersionPrefBody accepte les six couples, dont les cinq de la liste', () => {
  for (const [name, pref] of COUPLES) {
    assert.deepEqual(parseVersionPrefBody({ ...pref }), { ok: true, pref }, name);
  }
});

test('VERSION PRÉFÉRÉE: parseVersionPrefBody — { audio: null, subtitle: null } veut dire « Automatique »', () => {
  assert.deepEqual(parseVersionPrefBody({ audio: null, subtitle: null }), { ok: true, pref: null });
});

test('VERSION PRÉFÉRÉE: parseVersionPrefBody refuse un seul des deux nul', () => {
  for (const body of [{ audio: 'vf', subtitle: null }, { audio: null, subtitle: 'fr' }, { audio: 'vo', subtitle: null }, { audio: null, subtitle: 'off' }]) {
    assert.deepEqual(parseVersionPrefBody(body), { ok: false }, JSON.stringify(body));
  }
});

test('VERSION PRÉFÉRÉE: parseVersionPrefBody refuse une valeur inconnue', () => {
  const bodies = [
    { audio: 'xx', subtitle: 'off' }, { audio: 'vf', subtitle: 'xx' }, { audio: 'VF', subtitle: 'off' }, { audio: 'vo', subtitle: 'FR' },
    { audio: 'vf', subtitle: 'de' }, { audio: '', subtitle: 'off' }, { audio: 'vo', subtitle: '' }, { audio: 1, subtitle: 'off' },
    { audio: 'vf', subtitle: true }, { audio: ['vf'], subtitle: 'off' }, { audio: { v: 'vf' }, subtitle: 'off' }, { audio: 'xx', subtitle: null },
  ];
  for (const body of bodies) assert.deepEqual(parseVersionPrefBody(body), { ok: false }, JSON.stringify(body));
});

test('VERSION PRÉFÉRÉE: parseVersionPrefBody refuse ce qui n\'est pas un objet { audio, subtitle } complet', () => {
  for (const body of [null, undefined, 'vf', 42, true, [], ['vf', 'off'], [{ audio: 'vf', subtitle: 'off' }]]) {
    assert.deepEqual(parseVersionPrefBody(body), { ok: false }, `entrée ${JSON.stringify(body)}`);
  }
  // Un champ absent n'est pas un champ nul : « Automatique » se dit avec deux null explicites.
  for (const body of [{}, { audio: 'vf' }, { subtitle: 'fr' }, { audio: null }, { audio: undefined, subtitle: undefined }]) {
    assert.deepEqual(parseVersionPrefBody(body), { ok: false }, `champ absent ${JSON.stringify(body)}`);
  }
});

// ---------- Les routes ----------

test('VERSION PRÉFÉRÉE: PATCH /api/me/version lit la session, refuse (401 puis 400) avant d\'écrire, rend { version_pref }', () => {
  const src = readText(path.join(ROOT, 'app/api/me/version/route.ts'));
  assert.match(src, /export async function PATCH\(/, 'la route répond à PATCH');
  assert.doesNotMatch(src, /export async function (GET|POST|PUT|DELETE)\b/, 'et à rien d\'autre');
  assert.match(src, /getUserFromSession\(cookieStore\.get\('session'\)\?\.value\)/, 'session lue dans le cookie');
  assert.match(src, /import \{ db \} from '@\/lib\/db'/, 'la base est passée en paramètre');
  // Dans l'ordre : session (401), lecture du corps (400), écriture, réponse.
  const order = ['getUserFromSession(', 'status: 401', 'parseVersionPrefBody(', 'status: 400', 'writeVersionPref(db, user.id, ', 'version_pref:'].map((s) => src.indexOf(s));
  assert.ok(order.every((i) => i > 0), `étapes présentes : ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'session, refus, écriture, réponse');
  assert.match(src, /writeVersionPref\(db, user\.id, parsed\.pref\)/, 'seule la préférence lue par parseVersionPrefBody s\'écrit');
  assert.match(src, /NextResponse\.json\(\{ version_pref: parsed\.pref \}\)/, '200 { version_pref }');
  assert.doesNotMatch(src, /console\.log/, 'aucun console.log');
});

test('VERSION PRÉFÉRÉE: GET /api/me rend user.version_pref, et une base en panne n\'en prive pas le profil', () => {
  const src = readText(path.join(ROOT, 'app/api/me/route.ts'));
  const read = src.indexOf('readVersionPref(db, user.id)');
  assert.ok(read > 0, 'la préférence est lue par readVersionPref');
  // Gardée : une erreur ici rendrait 500, et `fetchMe` conclurait à une déconnexion.
  const guarded = src.slice(src.lastIndexOf('try {', read), src.indexOf('}', src.indexOf('catch', read)) + 1);
  assert.ok(guarded.includes('catch'), 'la lecture est gardée');
  const user = src.slice(src.indexOf('user: {'), src.indexOf('}', src.indexOf('user: {')));
  assert.match(user, /version_pref: versionPref/, 'user.version_pref');
});
