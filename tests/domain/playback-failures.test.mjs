import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { readText } from '../helpers/repo.mjs';
import { parsePlaybackFailure, briefBrowser, PLAYBACK_FAILURE_MAX_BODY_BYTES } from '../../lib/playback-failure-parse.ts';
import { savePlaybackFailure, summarizePlaybackFailures, recentPlaybackFailures, withoutVisitor, clampDays } from '../../lib/playback-failures.ts';
import { failureVersionLabel, failurePlaceLabel, failureDateLabel, parseDbDate } from '../../app/admin/types.ts';

// Trace serveur des lectures en échec (docs/superpowers/specs/2026-11-19-versions-et-erreurs-de-lecture-design.md) :
// quand un film ne démarre pas, le navigateur envoie une ligne courte — quel film, quelle version, où, quel genre
// d'échec, quel navigateur. JAMAIS l'adresse de diffusion de la location : c'est son secret.
const ROOT = process.cwd();

function freshDb() {
  const db = new Database(':memory:');
  db.exec(readFileSync(path.join(ROOT, 'lib/schema.sql'), 'utf-8'));
  const user = (name) => db.prepare('INSERT INTO users (username, password_hash, recovery_phrase_hash) VALUES (?, \'x\', \'y\')').run(name).lastInsertRowid;
  const film = (tmdb, title) => db.prepare('INSERT INTO films (tmdb_id, title) VALUES (?, ?)').run(tmdb, title).lastInsertRowid;
  const u = user('visiteur');
  const f = film(1, 'Get Out');
  return { db, u, f, user, film };
}

const valid = (filmId, extra = {}) => ({
  filmId, audio: 'vf', subtitle: 'off', place: 'device', kind: 'error', position: 12.5, ...extra,
});
const save = (db, userId, failure, browser = 'Chrome 157 · Android') => savePlaybackFailure(db, { ...failure, userId, browser });

test('LECTURE EN ÉCHEC: une trace enregistrée se relit telle quelle', () => {
  const { db, u, f } = freshDb();
  save(db, u, valid(f, { audio: 'vo', subtitle: 'fr', place: 'tv', kind: 'tv_load', position: 812.5 }), 'Chrome 157 · Android');
  const rows = recentPlaybackFailures(db, 10);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.film_id, f);
  assert.equal(r.title, 'Get Out');
  assert.equal(r.user_id, u);
  assert.equal(r.audio, 'vo');
  assert.equal(r.subtitle, 'fr');
  assert.equal(r.place, 'tv');
  assert.equal(r.kind, 'tv_load');
  assert.equal(r.position_sec, 812.5);
  assert.equal(r.browser, 'Chrome 157 · Android');
  assert.match(r.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'date posée par la base');
});

test('LECTURE EN ÉCHEC: une position inconnue est conservée comme absente, pas comme zéro', () => {
  const { db, u, f } = freshDb();
  save(db, u, valid(f, { position: null }));
  assert.equal(recentPlaybackFailures(db, 10)[0].position_sec, null);
});

test('LECTURE EN ÉCHEC: les plus récentes d\'abord, et la limite est respectée', () => {
  const { db, u, f } = freshDb();
  for (const kind of ['error', 'timeout', 'tv_load']) save(db, u, valid(f, { kind }));
  assert.deepEqual(recentPlaybackFailures(db, 10).map((r) => r.kind), ['tv_load', 'timeout', 'error']);
  assert.deepEqual(recentPlaybackFailures(db, 2).map((r) => r.kind), ['tv_load', 'timeout']);
});

test('LECTURE EN ÉCHEC: un film inconnu ne laisse aucune ligne et ne casse pas l\'envoi', () => {
  const { db, u } = freshDb();
  assert.doesNotThrow(() => save(db, u, valid(99999)));
  assert.equal(db.prepare('SELECT count(*) n FROM playback_failures').get().n, 0);
});

test('LECTURE EN ÉCHEC: supprimer le film ou le visiteur supprime ses traces (cascade)', () => {
  const { db, u, f, user, film } = freshDb();
  const u2 = user('autre');
  const f2 = film(2, 'Us');
  save(db, u, valid(f));
  save(db, u2, valid(f2));
  db.prepare('DELETE FROM films WHERE id = ?').run(f);
  assert.deepEqual(recentPlaybackFailures(db, 10).map((r) => r.film_id), [f2]);
  db.prepare('DELETE FROM users WHERE id = ?').run(u2);
  assert.equal(db.prepare('SELECT count(*) n FROM playback_failures').get().n, 0);
});

test('LECTURE EN ÉCHEC: entrées bornées', () => {
  // Une position négative, NaN, infinie, ou qui dépasse un jour, n'est pas une position : la trace reste, sans elle.
  for (const bad of [-1, -0.001, NaN, Infinity, -Infinity, 86401, '12', null, undefined, {}]) {
    const p = parsePlaybackFailure({ filmId: 3, audio: 'vf', subtitle: 'off', place: 'device', kind: 'error', position: bad });
    assert.notEqual(p, null, `trace gardée pour position ${String(bad)}`);
    assert.equal(p.position, null, `position ${String(bad)} → null`);
  }
  assert.equal(parsePlaybackFailure(valid(3, { position: 0 })).position, 0);
  assert.equal(parsePlaybackFailure(valid(3, { position: 3600.25 })).position, 3600.25);
  assert.equal(parsePlaybackFailure({ filmId: 3, audio: 'vf', subtitle: 'off', place: 'device', kind: 'error' }).position, null, 'position absente');

  // Un identifiant de film qui n'est pas un entier strictement positif : pas de trace.
  for (const bad of [1.5, '3', NaN, Infinity, 0, -2, null, undefined, [3], 2 ** 60]) {
    assert.equal(parsePlaybackFailure(valid(bad)), null, `filmId ${String(bad)}`);
  }
  // Chaque champ à valeurs fermées : une valeur inconnue, mal typée ou absente refuse la trace.
  for (const bad of ['VF', 'fr', '', null, 1, undefined]) assert.equal(parsePlaybackFailure(valid(3, { audio: bad })), null, `audio ${String(bad)}`);
  for (const bad of ['de', 'vf', '', null, undefined]) assert.equal(parsePlaybackFailure(valid(3, { subtitle: bad })), null, `subtitle ${String(bad)}`);
  for (const bad of ['salon', 'TV', '', null, undefined]) assert.equal(parsePlaybackFailure(valid(3, { place: bad })), null, `place ${String(bad)}`);
  for (const bad of ['crash', 'tv', '', null, undefined]) assert.equal(parsePlaybackFailure(valid(3, { kind: bad })), null, `kind ${String(bad)}`);
  // Ce qui n'est pas un objet n'est pas une trace.
  for (const bad of [null, undefined, 'error', 42, true, [], [valid(3)]]) assert.equal(parsePlaybackFailure(bad), null, `entrée ${JSON.stringify(bad)}`);

  // Toutes les valeurs permises passent.
  for (const audio of ['vf', 'vo']) for (const subtitle of ['off', 'fr', 'en']) for (const place of ['device', 'tv']) for (const kind of ['error', 'timeout', 'tv_load']) {
    assert.deepEqual(parsePlaybackFailure({ filmId: 7, audio, subtitle, place, kind, position: 1 }), { filmId: 7, audio, subtitle, place, kind, position: 1 });
  }
});

test('LECTURE EN ÉCHEC: aucune adresse, ni dans l\'objet lu ni dans la table', () => {
  const secret = 'https://storage.example/abc123def456/vo.mp4';
  const p = parsePlaybackFailure({
    ...valid(3), url: secret, src: secret, streamingUrl: secret, streaming_urls: { vo: secret }, path: '/data/films/vo.mp4', file_path: '/data/films/vo.mp4',
  });
  assert.deepEqual(Object.keys(p).sort(), ['audio', 'filmId', 'kind', 'place', 'position', 'subtitle']);
  assert.equal(JSON.stringify(p).includes('http'), false);
  assert.equal(JSON.stringify(p).includes('/data/'), false);

  const { db, u, f } = freshDb();
  const columns = db.prepare('PRAGMA table_info(playback_failures)').all().map((c) => c.name);
  assert.ok(columns.length >= 10, `table lue : ${columns.join(', ')}`);
  for (const name of columns) assert.doesNotMatch(name, /url|path/i, `colonne ${name}`);
  // Et rien d'une adresse ne traverse l'enregistrement, même si un appelant en glisse une dans l'objet.
  savePlaybackFailure(db, { ...valid(f), userId: u, browser: 'Chrome 157 · Android', url: secret, src: secret });
  const stored = JSON.stringify(db.prepare('SELECT * FROM playback_failures').all());
  assert.equal(stored.includes('http'), false);
  assert.equal(stored.includes('mp4'), false);
});

test('LECTURE EN ÉCHEC: le résumé groupe par film, piste et lieu, compte juste, le plus récent d\'abord', () => {
  const { db, u, f, user, film } = freshDb();
  const u2 = user('autre');
  const g = film(2, 'Us');
  // Film 1 : VF sur l'appareil ×3 (dont une d'un autre visiteur), VO sur l'appareil ×1, VF sur la télé ×1.
  save(db, u, valid(f, { audio: 'vf', place: 'device' }));
  save(db, u, valid(f, { audio: 'vf', place: 'device', kind: 'timeout' }));
  save(db, u2, valid(f, { audio: 'vf', place: 'device' }));
  save(db, u, valid(f, { audio: 'vo', place: 'device' }));
  save(db, u, valid(f, { audio: 'vf', place: 'tv', kind: 'tv_load' }));
  // Film 2 : VF sur l'appareil ×2.
  save(db, u2, valid(g, { audio: 'vf', place: 'device' }));
  save(db, u2, valid(g, { audio: 'vf', place: 'device' }));
  // Les dates sont posées à la main : la base les arrondit à la seconde.
  const setAt = (id, when) => db.prepare('UPDATE playback_failures SET created_at = ? WHERE id = ?').run(when, id);
  const at = (daysAgo, hh = 12) => db.prepare(`SELECT strftime('%Y-%m-%d ${String(hh).padStart(2, '0')}:00:00', 'now', ?) d`).get(`-${daysAgo} days`).d;
  setAt(1, at(3)); setAt(2, at(1)); setAt(3, at(2));      // film 1, VF, appareil : plus récent = hier
  setAt(4, at(0, 0));                                       // film 1, VO, appareil : aujourd'hui à minuit
  setAt(5, at(2, 6));                                       // film 1, VF, télé : il y a 2 jours
  setAt(6, at(5)); setAt(7, at(4));                         // film 2, VF, appareil : plus récent = il y a 4 jours

  const rows = summarizePlaybackFailures(db, 30);
  assert.deepEqual(
    rows.map((r) => [r.film_id, r.title, r.audio, r.place, r.failures, r.last_at]),
    [
      [f, 'Get Out', 'vo', 'device', 1, at(0, 0)],
      [f, 'Get Out', 'vf', 'device', 3, at(1)],
      [f, 'Get Out', 'vf', 'tv', 1, at(2, 6)],
      [g, 'Us', 'vf', 'device', 2, at(4)],
    ],
  );
  assert.deepEqual(Object.keys(rows[0]).sort(), ['audio', 'failures', 'film_id', 'last_at', 'place', 'title']);
});

test('LECTURE EN ÉCHEC: le résumé ne regarde que les jours demandés', () => {
  const { db, u, f, film } = freshDb();
  const g = film(2, 'Us');
  save(db, u, valid(f));
  save(db, u, valid(g));
  db.prepare("UPDATE playback_failures SET created_at = datetime('now', '-10 days') WHERE film_id = ?").run(g);
  assert.deepEqual(summarizePlaybackFailures(db, 7).map((r) => r.film_id), [f]);
  assert.deepEqual(summarizePlaybackFailures(db, 30).map((r) => r.film_id).sort(), [f, g].sort());
  assert.deepEqual(summarizePlaybackFailures(freshDb().db, 7), [], 'rien à résumer : liste vide');
});

test('LECTURE EN ÉCHEC: le navigateur est résumé en moins de quarante caractères', () => {
  // En-têtes User-Agent réels : Chrome sur le Pixel 9a (Android figé à 10 par la réduction d'UA), Safari sur iPhone,
  // Firefox sur Mac.
  assert.equal(
    briefBrowser('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36'),
    'Chrome 157 · Android',
  );
  assert.equal(
    briefBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'),
    'Safari 18 · iOS',
  );
  assert.equal(
    briefBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0'),
    'Firefox 132 · macOS',
  );
  // Edge et Chrome portent tous deux « Chrome/ » : le plus précis gagne.
  assert.equal(
    briefBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.80'),
    'Edge 130 · Windows',
  );
  assert.equal(
    briefBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'),
    'Chrome 130 · macOS',
  );
});

test('LECTURE EN ÉCHEC: un navigateur qu\'on ne reconnaît pas, ou absent, donne « inconnu » ; jamais plus de quarante caractères', () => {
  for (const ua of [null, '', '   ', 'curl/8.4.0', 'x'.repeat(5000)]) assert.equal(briefBrowser(ua), 'inconnu', JSON.stringify(ua).slice(0, 30));
  // Un système reconnu sans navigateur reconnu se dit quand même.
  assert.equal(briefBrowser('SuperBrowser/9 (Linux; Android 14)'), 'Android');
  // Rien du texte reçu ne ressort tel quel : ni espaces de contrôle, ni longueur.
  const hostile = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/1' + '9'.repeat(200) + '.0 \n<script>alert(1)</script>';
  const out = briefBrowser(hostile);
  assert.ok(out.length <= 40, `longueur ${out.length}`);
  assert.doesNotMatch(out, /[<>\n]/);
});

test('LECTURE EN ÉCHEC: la taille maximale d\'un corps est de 1024 octets', () => {
  assert.equal(PLAYBACK_FAILURE_MAX_BODY_BYTES, 1024);
});

test('LECTURE EN ÉCHEC: la route exige la session, limite le débit, borne le corps, ne journalise pas', () => {
  const src = readText(path.join(ROOT, 'app/api/playback-failures/route.ts'));
  assert.match(src, /checkRateLimit\(\s*getRateLimitKey\(request, 'playback-failure'\)\s*,\s*30\s*,\s*15 \* 60 \* 1000\s*\)/, 'débit : 30 par quart d\'heure');
  assert.match(src, /getUserFromSession\(/, 'session lue');
  assert.match(src, /PLAYBACK_FAILURE_MAX_BODY_BYTES/, 'corps borné');
  assert.doesNotMatch(src, /console\.log/, 'aucun console.log');
  // Le navigateur est lu par le serveur, sur l'en-tête, pas dans le corps.
  assert.match(src, /headers\.get\(['"]user-agent['"]\)/i);
  // Les cinq issues, dans l'ordre : session, débit, taille, lecture, enregistrement.
  const order = ['status: 401', 'status: 429', 'status: 413', 'status: 400', 'status: 204'].map((s) => src.indexOf(s));
  assert.ok(order.every((i) => i > 0), `statuts présents : ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'dans l\'ordre session, débit, taille, lecture, succès');
  // La route ne lit rien de la location : ni adresse, ni chemin, ni corps réécrit dans un journal.
  assert.doesNotMatch(src, /streaming|symlink|file_path/i);
  assert.doesNotMatch(src, /console\.\w+\([^)]*\b(body|json|failure)\b/, 'le corps ne va dans aucun journal');
});

test('LECTURE EN ÉCHEC: les modules du serveur n\'importent aucune valeur et la table n\'a pas de colonne d\'adresse', () => {
  for (const file of ['lib/playback-failure-parse.ts', 'lib/playback-failures.ts']) {
    const src = readText(path.join(ROOT, file));
    assert.doesNotMatch(src, /^\s*import\s+(?!type\b)/m, `${file} : import de valeur`);
    assert.doesNotMatch(src, /\brequire\(/, `${file} : require`);
  }
  const schema = readText(path.join(ROOT, 'lib/schema.sql'));
  const table = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS playback_failures'));
  const body = table.slice(0, table.indexOf(');'));
  assert.ok(body.length > 100, 'table playback_failures dans schema.sql');
  assert.match(body, /ON DELETE CASCADE/);
  assert.match(schema, /CREATE INDEX IF NOT EXISTS \w+ ON playback_failures\(film_id, created_at\)/);
});

test('LECTURE EN ÉCHEC: le client envoie en keepalive et avale toute erreur', () => {
  const src = readText(path.join(ROOT, 'src/api/index.ts'));
  const block = src.slice(src.indexOf('export const playbackFailures'), src.indexOf('// ============ PUSH SUBSCRIBE'));
  assert.ok(block.length > 50, 'bloc playbackFailures présent');
  assert.match(block, /\/api\/playback-failures/);
  assert.match(block, /keepalive:\s*true/);
  assert.match(block, /catch/, 'toute erreur est avalée');
  // Le corps est construit champ par champ : un appelant qui porte une adresse dans son objet ne la fait pas partir.
  assert.match(block, /JSON\.stringify\(\{ filmId, audio, subtitle, place, kind, position \}\)/, 'six champs nommés');
  assert.doesNotMatch(block, /JSON\.stringify\(failure\)/, 'jamais l\'objet reçu tel quel');
  assert.match(src.slice(src.indexOf('export const api = {')), /playbackFailures,/, 'exposé dans api');
});

// ---------- /admin : la liste des lectures en échec (tâche 4) ----------

test('LECTURES EN ÉCHEC ADMIN: la route répond 403 hors administrateur, avant de lire la moindre trace', () => {
  const src = readText(path.join(ROOT, 'app/api/admin/playback-failures/route.ts'));
  assert.match(src, /export async function GET\(/, 'lecture seule : GET');
  assert.doesNotMatch(src, /export async function (POST|PUT|PATCH|DELETE)\b/, 'aucune écriture');
  assert.match(src, /getUserFromSession\(cookieStore\.get\('session'\)\?\.value\)/, 'session lue dans le cookie');
  assert.match(src, /!user\?\.is_admin/, 'is_admin vérifié');
  assert.match(src, /status:\s*403/, '403 hors admin');
  const gate = src.indexOf('is_admin');
  assert.ok(gate > 0, 'garde présente');
  for (const call of ['summarizePlaybackFailures(', 'recentPlaybackFailures(']) {
    const at = src.indexOf(call);
    assert.ok(at > gate, `${call} n'est appelé qu'après la garde (garde ${gate}, appel ${at})`);
  }
  assert.match(src, /import \{ db \} from '@\/lib\/db'/, 'la base est passée en paramètre, comme la route des traces');
  assert.doesNotMatch(src, /console\.log/, 'aucun console.log');
});

test('LECTURES EN ÉCHEC ADMIN: la route rend { days, groups, recent } sur 30 jours par défaut, bornés', () => {
  const src = readText(path.join(ROOT, 'app/api/admin/playback-failures/route.ts'));
  assert.match(src, /searchParams\.get\('days'\)/, '?days=');
  assert.match(src, /\?\?\s*30\b/, '30 jours quand rien n\'est demandé');
  assert.match(src, /clampDays\(/, 'la borne est celle du module, pas une seconde copie');
  assert.match(src, /NextResponse\.json\(\{\s*days\s*,\s*groups\s*,\s*recent\s*\}\)/, 'les trois clés de la réponse');
  // Le visiteur ne part pas vers le navigateur : les traces passent par withoutVisitor avant d'être rendues.
  assert.match(src, /withoutVisitor\(recentPlaybackFailures\(/, 'les traces récentes perdent le visiteur');
  assert.doesNotMatch(src, /user_id|userId/, 'la route ne touche jamais au visiteur');
});

test('LECTURES EN ÉCHEC ADMIN: clampDays — entier entre 1 et 365, une valeur illisible vaut une semaine', () => {
  assert.equal(clampDays(30), 30);
  assert.equal(clampDays(30.4), 30);
  assert.equal(clampDays(0), 1);
  assert.equal(clampDays(-5), 1);
  assert.equal(clampDays(365), 365);
  assert.equal(clampDays(9999), 365);
  assert.equal(clampDays(NaN), 7);
  assert.equal(clampDays(Infinity), 7);
});

test('LECTURES EN ÉCHEC ADMIN: les traces rendues à l\'admin ne portent jamais le visiteur', () => {
  const { db, u, f } = freshDb();
  save(db, u, valid(f, { audio: 'vo', subtitle: 'fr', place: 'tv', kind: 'tv_load', position: 812.5 }), 'Chrome 157 · Android');
  const full = recentPlaybackFailures(db, 10);
  assert.equal(full[0].user_id, u, 'la ligne lue le porte bien : c\'est withoutVisitor qui le retire');
  const rows = withoutVisitor(full);
  assert.equal(rows.length, 1);
  assert.deepEqual(
    Object.keys(rows[0]).sort(),
    ['audio', 'browser', 'created_at', 'film_id', 'id', 'kind', 'place', 'position_sec', 'subtitle', 'title'],
  );
  assert.equal(JSON.stringify(rows).includes('user'), false, 'ni clé ni valeur de visiteur dans ce qui part');
  assert.equal(rows[0].title, 'Get Out');
  assert.equal(rows[0].position_sec, 812.5);
  assert.deepEqual(withoutVisitor([]), []);
  // Un champ de plus sur la ligne lue ne traverse pas : la liste est nommée, pas un « tout sauf ».
  assert.equal('extra' in withoutVisitor([{ ...full[0], extra: 'x' }])[0], false);
});

test('LECTURES EN ÉCHEC ADMIN: la section appelle la route avec la session, dit le vide, et n\'a aucun bouton grisé', () => {
  const src = readText(path.join(ROOT, 'app/admin/PlaybackFailures.tsx'));
  assert.match(src, /^'use client';/, 'composant client');
  assert.match(src, /fetch\(\s*`\/api\/admin\/playback-failures\?days=\$\{[A-Z_]+\}`\s*,\s*\{\s*credentials:\s*'include'\s*\}\s*,?\s*\)/, 'route admin, session envoyée');
  assert.match(src, /export function PlaybackFailures\(/, 'composant exporté sous son nom');
  assert.match(src, /Lectures en échec/, 'titre de la section');
  assert.match(src, /Aucun échec sur \{data\.days\} jours\./, 'vide : « Aucun échec sur 30 jours. » (les jours sont ceux de la réponse)');
  for (const column of ['Film', 'Version', 'Lieu', 'Échecs', 'Dernier échec']) assert.match(src, new RegExp(`>${column}<`), `colonne ${column}`);
  assert.doesNotMatch(src, /disabled/, 'aucun bouton grisé');
  assert.doesNotMatch(src, /user_id|userId/, 'le visiteur n\'est pas affiché');
  assert.doesNotMatch(src, /console\.(log|error)/, 'aucune sortie console');
});

test('LECTURES EN ÉCHEC ADMIN: /admin monte la section au-dessus des filtres', () => {
  const src = readText(path.join(ROOT, 'app/admin/AdminPageClient.tsx'));
  assert.match(src, /import \{ PlaybackFailures \} from '\.\/PlaybackFailures'/, 'import');
  const mounted = src.indexOf('<PlaybackFailures');
  const filters = src.indexOf('<section className={styles.filters}>');
  assert.ok(mounted > 0, '<PlaybackFailures monté');
  assert.ok(filters > 0, 'section des filtres trouvée');
  assert.ok(mounted < filters, `la section est avant les filtres (${mounted} < ${filters})`);
});

test('LECTURES EN ÉCHEC ADMIN: version, lieu et date de chaque ligne se lisent en français', () => {
  assert.equal(failureVersionLabel('vf'), 'VF');
  assert.equal(failureVersionLabel('vo'), 'VO');
  assert.equal(failureVersionLabel('xx'), 'xx', 'une valeur inconnue se montre telle quelle, jamais remplacée par « VF »');
  assert.equal(failurePlaceLabel('device'), 'appareil');
  assert.equal(failurePlaceLabel('tv'), 'télé');
  assert.equal(failurePlaceLabel('salon'), 'salon');
  // SQLite écrit « maintenant » en UTC, sans fuseau : la date se lit en UTC, quel que soit le fuseau de l'administrateur.
  assert.equal(parseDbDate('2026-11-20 10:05:09')?.toISOString(), '2026-11-20T10:05:09.000Z');
  assert.equal(parseDbDate('2026-11-20 23:59:59')?.toISOString(), '2026-11-20T23:59:59.000Z');
  assert.equal(parseDbDate('hier'), null);
  assert.equal(parseDbDate(''), null);
  assert.equal(failureDateLabel('hier'), 'hier', 'une date illisible se montre telle quelle');
  assert.match(failureDateLabel('2026-11-20 10:05:09'), /20/, 'le jour y est');
});
