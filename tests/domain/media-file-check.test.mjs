import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Database from 'better-sqlite3';
import { readText } from '../helpers/repo.mjs';
import {
  judgeFilm, playableVersions, versionsToMark, reportLines, tailDecoded, MIN_DURATION_RATIO, VF_VO_MAX_GAP_S,
} from '../../lib/media/file-check.ts';

// Contrôle des fichiers (docs/superpowers/specs/2026-11-19-versions-et-erreurs-de-lecture-design.md, § 6). Un script
// (`npm run media:check`) contrôle chaque version des films disponibles et rapporte ; avec `--mark`, il marque une
// version défectueuse, qui compte alors comme absente partout (fiche, adresses de la location). Un film sans aucune
// version lisible ne se loue pas : le serveur refuse avant de toucher aux crédits.
const ROOT = process.cwd();

/** Un fichier sain de `seconds` secondes. */
const ok = (seconds) => ({ exists: true, opens: true, hasVideo: true, hasAudio: true, duration: seconds, tailDecodes: true });
const NONE = { vf: [], vo: [], pair: [] };

/** Corps d'une fonction exportée : du `export function nom` au prochain `\nexport ` (ou la fin du fichier). */
function fnBlock(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `${signature} existe`);
  const end = src.indexOf('\nexport ', start + 1);
  return src.slice(start, end > 0 ? end : undefined);
}

// ---------- Les valeurs ----------

test('CONTRÔLE DES FICHIERS: 90 % de la durée TMDB au moins, deux secondes d\'écart au plus entre VF et VO', () => {
  assert.equal(MIN_DURATION_RATIO, 0.9);
  assert.equal(VF_VO_MAX_GAP_S, 2);
});

// ---------- judgeFilm : les cinq films de la spec, § 1 ----------
// Durée du fichier VF relevée en production le 19/11/2026, durée du film annoncée par TMDB ; la VO a la durée du film.

const SPEC_CASES = [
  ['The Revenant', 37.7, 157, '37,7'],
  ["2001 : L'Odyssée de l'espace", 68.5, 156, '68,5'],
  ['Old Boy', 62.5, 120, '62,5'],
  ['Le Seigneur des anneaux : Le Retour du roi', 127.7, 201, '127,7'],
  ['The Murderer', 140.9, 157, '140,9'],
];

for (const [title, vfMin, runtime, shown] of SPEC_CASES) {
  test(`CONTRÔLE DES FICHIERS: ${title} — VF de ${shown} min pour un film de ${runtime} min → « durée … » sur la VF`, () => {
    const j = judgeFilm({ runtimeMin: runtime, vf: ok(vfMin * 60), vo: ok(runtime * 60) });
    assert.deepEqual(j.vf, [`durée ${shown} min pour un film de ${runtime} min`]);
    assert.deepEqual(j.vo, [], 'la VO, à la durée du film, est saine');
    assert.deepEqual(j.pair, [`VF et VO de durées différentes (${shown} min / ${runtime},0 min)`]);
  });
}

test('CONTRÔLE DES FICHIERS: les mots exacts de la spec pour « 2001 »', () => {
  const j = judgeFilm({ runtimeMin: 156, vf: ok(68.5 * 60), vo: ok(156 * 60) });
  assert.deepEqual(j, {
    vf: ['durée 68,5 min pour un film de 156 min'],
    vo: [],
    pair: ['VF et VO de durées différentes (68,5 min / 156,0 min)'],
  });
});

// ---------- judgeFilm : les autres cas ----------

test('CONTRÔLE DES FICHIERS: fichier absent → « fichier absent », seule anomalie de la version, pas de comparaison VF / VO', () => {
  const absent = { exists: false, opens: false, hasVideo: false, hasAudio: false, duration: 0, tailDecodes: false };
  assert.deepEqual(judgeFilm({ runtimeMin: 156, vf: absent, vo: ok(156 * 60) }), { vf: ['fichier absent'], vo: [], pair: [] });
  assert.deepEqual(judgeFilm({ runtimeMin: 156, vf: ok(156 * 60), vo: absent }), { vf: [], vo: ['fichier absent'], pair: [] });
});

test('CONTRÔLE DES FICHIERS: fichier sans piste audio → « pas de piste audio »', () => {
  const j = judgeFilm({ runtimeMin: 120, vf: { ...ok(120 * 60), hasAudio: false }, vo: ok(120 * 60) });
  assert.deepEqual(j, { vf: ['pas de piste audio'], vo: [], pair: [] });
});

test('CONTRÔLE DES FICHIERS: illisible, sans vidéo, fin indécodable — les mots de la spec', () => {
  const unreadable = { exists: true, opens: false, hasVideo: false, hasAudio: false, duration: 0, tailDecodes: false };
  assert.deepEqual(judgeFilm({ runtimeMin: 120, vf: null, vo: unreadable }), { vf: [], vo: ['illisible'], pair: [] });
  assert.deepEqual(judgeFilm({ runtimeMin: 120, vf: null, vo: { ...ok(7200), hasVideo: false } }).vo, ['pas de piste vidéo']);
  assert.deepEqual(judgeFilm({ runtimeMin: 120, vf: null, vo: { ...ok(7200), tailDecodes: false } }).vo, ['fin indécodable']);
  // Plusieurs anomalies d'un même fichier sont toutes rapportées.
  assert.deepEqual(
    judgeFilm({ runtimeMin: 120, vf: { ...ok(3000), hasAudio: false, tailDecodes: false }, vo: null }).vf,
    ['pas de piste audio', 'fin indécodable', 'durée 50,0 min pour un film de 120 min'],
  );
});

test('CONTRÔLE DES FICHIERS: écart de 3 s entre VF et VO → anomalie de la paire, aucune sur les versions', () => {
  // 9001 s = 150,02 min, 9004 s = 150,07 min : arrondis sans ambiguïté au dixième.
  const j = judgeFilm({ runtimeMin: 150, vf: ok(9001), vo: ok(9004) });
  assert.deepEqual(j, { vf: [], vo: [], pair: ['VF et VO de durées différentes (150,0 min / 150,1 min)'] });
});

test('CONTRÔLE DES FICHIERS: écart de 2 s entre VF et VO → toléré', () => {
  assert.deepEqual(judgeFilm({ runtimeMin: 150, vf: ok(9001), vo: ok(9003) }), NONE);
  assert.deepEqual(judgeFilm({ runtimeMin: 150, vf: ok(9003), vo: ok(9001) }), NONE);
});

test('CONTRÔLE DES FICHIERS: durée TMDB inconnue → pas d\'anomalie de durée (l\'écart VF / VO reste rapporté)', () => {
  for (const runtimeMin of [null, 0]) {
    assert.deepEqual(judgeFilm({ runtimeMin, vf: ok(68.5 * 60), vo: null }), NONE, `runtime ${runtimeMin}`);
    const j = judgeFilm({ runtimeMin, vf: ok(68.5 * 60), vo: ok(156 * 60) });
    assert.deepEqual(j.vf, [], `runtime ${runtimeMin} : VF`);
    assert.deepEqual(j.vo, [], `runtime ${runtimeMin} : VO`);
    assert.deepEqual(j.pair, ['VF et VO de durées différentes (68,5 min / 156,0 min)'], `runtime ${runtimeMin} : paire`);
  }
});

test('CONTRÔLE DES FICHIERS: null = version que le film n\'a pas, aucune anomalie', () => {
  assert.deepEqual(judgeFilm({ runtimeMin: 156, vf: null, vo: ok(156 * 60) }), NONE);
  assert.deepEqual(judgeFilm({ runtimeMin: 156, vf: null, vo: null }), NONE);
});

test('CONTRÔLE DES FICHIERS: un film sain n\'a aucune anomalie, juste au-dessus de 90 % compris', () => {
  assert.deepEqual(judgeFilm({ runtimeMin: 156, vf: ok(156 * 60), vo: ok(156 * 60) }), NONE);
  assert.deepEqual(judgeFilm({ runtimeMin: 100, vf: ok(5400), vo: ok(5400) }), NONE, '90 min pour 100 : pile 90 %');
});

// ---------- Le décodage de la fin ----------
// Sorties relevées le 20/11/2026 (ffmpeg 8.0.1) sur des fichiers fabriqués : la commande de la spec, précédée de
// `-progress pipe:1`, sur un fichier sain de 120 min, sur le même coupé à 60 % de ses octets, puis à 99,99 %.

const PROGRESS_SAIN = 'frame=20\nfps=0.00\nout_time_us=10000000\nout_time=00:00:10.000000\nprogress=end\n';
const PROGRESS_VIDE = 'frame=0\nfps=0.00\nout_time_us=N/A\nout_time=N/A\nprogress=end\n';

test('FIN DU FICHIER: un fichier sain décode ses dix dernières secondes', () => {
  assert.equal(tailDecoded({ code: 0, stderr: '', progress: PROGRESS_SAIN }), true);
});

test('FIN DU FICHIER: coupé bien avant sa fin, il ne décode rien, sans erreur ni code non nul — indécodable quand même', () => {
  // ffmpeg saute au-delà des données, n'écrit qu'un avertissement (« Output file is empty, nothing was encoded »),
  // muet en `-v error`, et sort avec 0. Seule la position décodée le trahit.
  assert.equal(tailDecoded({ code: 0, stderr: '', progress: PROGRESS_VIDE }), false);
  assert.equal(tailDecoded({ code: 0, stderr: '', progress: '' }), false, 'aucune progression lue');
});

test('FIN DU FICHIER: coupé près de sa fin, le décodeur se plaint — indécodable', () => {
  const stderr = '[h264 @ 0x87505d500] Invalid NAL unit size (1272 > 709).\n[h264 @ 0x87505d500] missing picture in access unit with size 713\n';
  assert.equal(tailDecoded({ code: 0, stderr, progress: 'frame=18\nout_time_us=9000000\nprogress=end\n' }), false);
});

test('FIN DU FICHIER: code non nul, ou ffmpeg tué au bout de 60 s (code nul) — indécodable', () => {
  assert.equal(tailDecoded({ code: 1, stderr: '', progress: PROGRESS_SAIN }), false);
  assert.equal(tailDecoded({ code: null, stderr: '', progress: 'frame=3\nout_time_us=1500000\nprogress=continue\n' }), false);
});

// ---------- Ce que marque --mark ----------

test('CONTRÔLE DES FICHIERS: --mark marque la version qui a ses propres anomalies, pas l\'autre', () => {
  const j = judgeFilm({ runtimeMin: 156, vf: ok(68.5 * 60), vo: ok(156 * 60) });
  assert.deepEqual(versionsToMark(j), { vf: true, vo: false });
  assert.deepEqual(versionsToMark(judgeFilm({ runtimeMin: 120, vf: ok(7200), vo: { ...ok(7200), hasAudio: false } })), { vf: false, vo: true });
});

test('CONTRÔLE DES FICHIERS: un écart VF / VO seul ne marque rien (on ne sait pas laquelle est fausse)', () => {
  const unknownRuntime = judgeFilm({ runtimeMin: null, vf: ok(68.5 * 60), vo: ok(156 * 60) });
  assert.equal(unknownRuntime.pair.length, 1);
  assert.deepEqual(versionsToMark(unknownRuntime), { vf: false, vo: false });
  const bothLong = judgeFilm({ runtimeMin: 150, vf: ok(9001), vo: ok(9004) });
  assert.deepEqual(versionsToMark(bothLong), { vf: false, vo: false });
});

test('CONTRÔLE DES FICHIERS: une version redevenue saine n\'est plus à marquer (--mark retire le drapeau)', () => {
  assert.deepEqual(versionsToMark(judgeFilm({ runtimeMin: 156, vf: ok(156 * 60), vo: ok(156 * 60) })), { vf: false, vo: false });
});

// ---------- Le rapport ----------

test('CONTRÔLE DES FICHIERS: une ligne par anomalie, au format de la spec', () => {
  const j = judgeFilm({ runtimeMin: 156, vf: ok(68.5 * 60), vo: ok(156 * 60) });
  assert.deepEqual(reportLines({ id: 12, title: "2001 : L'Odyssée de l'espace" }, j), [
    "[12] 2001 : L'Odyssée de l'espace — VF : durée 68,5 min pour un film de 156 min",
    "[12] 2001 : L'Odyssée de l'espace — VF et VO de durées différentes (68,5 min / 156,0 min)",
  ]);
  const vo = judgeFilm({ runtimeMin: 120, vf: null, vo: { ...ok(7200), hasAudio: false } });
  assert.deepEqual(reportLines({ id: 3, title: 'Old Boy' }, vo), ['[3] Old Boy — VO : pas de piste audio']);
  assert.deepEqual(reportLines({ id: 3, title: 'Old Boy' }, NONE), []);
});

// ---------- playableVersions ----------

test('VERSIONS JOUABLES: une version marquée compte comme absente', () => {
  const film = { file_path_vf_transcoded: 'X (2001)/vf.mp4', file_path_vo_transcoded: 'X (2001)/vo.mp4' };
  assert.deepEqual(playableVersions({ ...film, vf_unplayable: 1, vo_unplayable: 0 }), { vf: false, vo: true });
  assert.deepEqual(playableVersions({ ...film, vf_unplayable: 0, vo_unplayable: 1 }), { vf: true, vo: false });
  assert.deepEqual(playableVersions({ ...film, vf_unplayable: 1, vo_unplayable: 1 }), { vf: false, vo: false });
});

test('VERSIONS JOUABLES: un chemin nul est une version absente, drapeaux à 0 ou inconnus', () => {
  assert.deepEqual(playableVersions({ file_path_vf_transcoded: null, file_path_vo_transcoded: 'X/vo.mp4', vf_unplayable: 0, vo_unplayable: 0 }), { vf: false, vo: true });
  assert.deepEqual(playableVersions({ file_path_vf_transcoded: 'X/vf.mp4', file_path_vo_transcoded: null }), { vf: true, vo: false });
  assert.deepEqual(playableVersions({ file_path_vf_transcoded: 'X/vf.mp4', file_path_vo_transcoded: '', vf_unplayable: null, vo_unplayable: null }), { vf: true, vo: false });
  assert.deepEqual(playableVersions({ file_path_vf_transcoded: null, file_path_vo_transcoded: null }), { vf: false, vo: false });
});

// ---------- Les deux colonnes ----------

test('CONTRÔLE DES FICHIERS: une base existante gagne vf_unplayable et vo_unplayable par lib/db.ts, à 0 pour les films déjà là', () => {
  const src = readText(path.join(ROOT, 'lib/db.ts'));
  const alters = [...src.matchAll(/"(ALTER TABLE films ADD COLUMN v[fo]_unplayable [^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(alters, [
    'ALTER TABLE films ADD COLUMN vf_unplayable INTEGER DEFAULT 0',
    'ALTER TABLE films ADD COLUMN vo_unplayable INTEGER DEFAULT 0',
  ]);
  const db = new Database(':memory:');
  db.exec('CREATE TABLE films (id INTEGER PRIMARY KEY AUTOINCREMENT, tmdb_id INTEGER UNIQUE NOT NULL, title TEXT NOT NULL)');
  const old = db.prepare("INSERT INTO films (tmdb_id, title) VALUES (62, '2001')").run().lastInsertRowid;
  for (const sql of alters) db.exec(sql);
  assert.deepEqual(db.prepare('SELECT vf_unplayable, vo_unplayable FROM films WHERE id = ?').get(old), { vf_unplayable: 0, vo_unplayable: 0 });
  // Au démarrage suivant la colonne existe : l'ALTER lève, et lib/db.ts l'avale (migration idempotente).
  for (const sql of alters) assert.throws(() => db.exec(sql), /duplicate column/);
  const tail = src.slice(src.indexOf(alters[0]));
  assert.match(
    tail,
    /^ALTER TABLE films ADD COLUMN vf_unplayable INTEGER DEFAULT 0",\s*"ALTER TABLE films ADD COLUMN vo_unplayable INTEGER DEFAULT 0",?\s*\];\s*for \(const sql of \w+\) \{\s*try \{\s*db\.exec\(sql\);\s*\} catch/,
    'les deux ALTER sont rejoués un par un dans un try / catch, comme les autres migrations',
  );
});

test('CONTRÔLE DES FICHIERS: une base neuve a les deux colonnes, à 0 par défaut', () => {
  const db = new Database(':memory:');
  db.exec(readText(path.join(ROOT, 'lib/schema.sql')));
  const id = db.prepare("INSERT INTO films (tmdb_id, title) VALUES (62, '2001')").run().lastInsertRowid;
  assert.deepEqual(db.prepare('SELECT vf_unplayable, vo_unplayable FROM films WHERE id = ?').get(id), { vf_unplayable: 0, vo_unplayable: 0 });
});

// ---------- Le script ----------

test('CONTRÔLE DES FICHIERS: le script n\'écrit ni is_available ni duration_sec, et ne marque que sur --mark', () => {
  const src = readText(path.join(ROOT, 'scripts/media-check.ts'));
  assert.doesNotMatch(src, /is_available\s*=/, 'is_available n\'est jamais écrit');
  assert.doesNotMatch(src, /duration_sec\s*=/, 'duration_sec n\'est jamais écrit (il appartient à la chaîne 24/7)');
  assert.ok(src.includes("'--mark'"), 'l\'option --mark');
  // Une seule écriture : les deux drapeaux.
  const updates = [...src.matchAll(/UPDATE\s+films\s+SET\s+([^`'"]*?)\s+WHERE/gi)].map((m) => m[1]);
  assert.deepEqual(updates, ['vf_unplayable = ?, vo_unplayable = ?']);
  assert.doesNotMatch(src, /\b(INSERT|DELETE)\b/, 'ni ajout ni suppression');
  for (const used of ['judgeFilm(', 'versionsToMark(', 'reportLines(', 'probeStreams(', 'isDirectMediaUrl(']) {
    assert.ok(src.includes(used), `le script passe par ${used.slice(0, -1)}`);
  }
  // Les dix dernières secondes, décodées sans sortie, 60 s au plus — la commande de la spec, précédée de la progression
  // qui dit si quelque chose a été décodé, jugée par tailDecoded.
  assert.match(src, /\['-progress', 'pipe:1', '-v', 'error', '-sseof', '-10', '-i', \w+, '-f', 'null', '-'\]/);
  assert.match(src, /60_000|60000/);
  assert.ok(src.includes('tailDecoded('), 'le verdict vient de tailDecoded');
  // `isDirectMediaUrl` vient de lib/symlinks ; rien d'autre de ce qui fabrique l'adresse d'une location.
  assert.doesNotMatch(src, /streaming_url|getStreamingUrl|buildStreamingUrls|symlink_uuid|SYMLINKS_PATH|RentalSymlinks|from 'rentals'|rentals\./,
    'jamais l\'adresse de diffusion d\'une location');
});

test('CONTRÔLE DES FICHIERS: npm run media:check', () => {
  const pkg = JSON.parse(readText(path.join(ROOT, 'package.json')));
  assert.equal(pkg.scripts['media:check'], 'npx tsx --env-file=.env scripts/media-check.ts');
});

// ---------- Une version marquée compte comme absente partout ----------

test('VERSIONS JOUABLES: la fiche (has_vf / has_vo) passe par playableVersions', () => {
  const src = readText(path.join(ROOT, 'app/api/films/[tmdbId]/route.ts'));
  assert.match(src, /const playable = playableVersions\(film\)/);
  assert.match(src, /has_vf: playable\.vf,/);
  assert.match(src, /has_vo: playable\.vo,/);
  assert.doesNotMatch(src, /has_v[fo]: !!film\.file_path/, 'plus de lecture directe du chemin');
  // Les drapeaux sont internes, comme les chemins : la fiche n'a besoin que des booléens.
  assert.match(src, /'vf_unplayable', 'vo_unplayable'/);
});

test('VERSIONS JOUABLES: buildStreamingUrls passe par playableVersions (adresse nulle pour une version marquée)', () => {
  const src = readText(path.join(ROOT, 'lib/rentals.ts'));
  const block = fnBlock(src, 'export function buildStreamingUrls');
  assert.match(block, /const playable = playableVersions\(film\)/);
  assert.match(block, /vf: playable\.vf \? mediaUrl\(film\.file_path_vf_transcoded, /);
  assert.match(block, /vo: playable\.vo \? mediaUrl\(film\.file_path_vo_transcoded, /);
  // Le mode FORCED_RENTAL_* sert sa propre vidéo : il passe avant.
  assert.ok(block.indexOf('FORCED_RENTAL_VIDEO_URL') < block.indexOf('playableVersions('));
});

test('VERSIONS JOUABLES: la jointure de getUserActiveRentals porte les deux drapeaux jusqu\'au film', () => {
  const src = readText(path.join(ROOT, 'lib/rentals.ts'));
  const block = fnBlock(src, 'export function getUserActiveRentals');
  assert.ok(block.includes('f.vf_unplayable as f_vf_unplayable'), 'VF sélectionné');
  assert.ok(block.includes('f.vo_unplayable as f_vo_unplayable'), 'VO sélectionné');
  assert.ok(block.includes('vf_unplayable: row.f_vf_unplayable'), 'VF passé à parseFilm');
  assert.ok(block.includes('vo_unplayable: row.f_vo_unplayable'), 'VO passé à parseFilm');
});

test('LOCATION: sans version lisible, rentFilm refuse avant le stock et les crédits (aucun crédit dépensé)', () => {
  const src = readText(path.join(ROOT, 'lib/rentals.ts'));
  const block = fnBlock(src, 'export async function rentFilm');
  const refuse = block.indexOf('throw new Error("Ce film n\'a aucune version lisible pour le moment")');
  assert.ok(refuse > 0, 'le refus, avec son message exact');
  assert.ok(block.indexOf('!film.is_available') < refuse, 'après le contrôle de disponibilité');
  for (const later of ['getFilmStock(', 'RENTAL_COSTS[', 'credits', 'createRentalSymlinks(', 'INSERT INTO rentals']) {
    assert.ok(block.indexOf(later) > refuse, `avant ${later}`);
  }
  // Le refus vient de playableVersions, hors du mode FORCED_RENTAL_*.
  assert.match(block.slice(0, refuse), /const playable = playableVersions\(film\);\s*if \(!IS_FORCED_RENTAL_MODE && !playable\.vf && !playable\.vo\) \{\s*$/);
});

test('LOCATION: une version marquée n\'a pas de lien dans la location', () => {
  const block = fnBlock(readText(path.join(ROOT, 'lib/rentals.ts')), 'export async function rentFilm');
  assert.match(block, /vf: playable\.vf \? film\.file_path_vf_transcoded : null,/);
  assert.match(block, /vo: playable\.vo \? film\.file_path_vo_transcoded : null,/);
});

test('VERSIONS JOUABLES: la prévisualisation /admin ne lit pas les drapeaux (elle sert à diagnostiquer)', () => {
  const src = readText(path.join(ROOT, 'app/api/admin/preview/[filmId]/route.ts'));
  assert.match(src, /buildStreamingUrls\(\{ \.\.\.film, vf_unplayable: 0, vo_unplayable: 0 \}, symlinks\.uuid\)/);
});

// ---------- La borne ----------

test('BORNE: un film sans version lisible — « Indisponible », et l\'appui dit pourquoi', () => {
  const src = readText(path.join(ROOT, 'src/components/kiosk/KioskAction.tsx'));
  // Sans détail (pas encore arrivé, ou en échec), le film est supposé lisible : le serveur tranche à la location.
  assert.match(src, /const playable = detail \? detail\.vf \|\| detail\.vo : true;/);
  assert.equal((src.match(/rentAction\(\{[^}]*\bplayable\b/g) || []).length, 2, 'le rendu et l\'appui passent `playable`');
  assert.match(src, /if \(now === 'unplayable'\) \{\s*say\('Film indisponible', NO_PLAYABLE_VERSION\);\s*return;\s*\}/);
  assert.doesNotMatch(src, /\bdisabled\b/, 'aucun bouton grisé');
});
