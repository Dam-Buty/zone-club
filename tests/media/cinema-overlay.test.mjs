import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OVERLAY_PASSES,
  buildOverlayCommands,
  clockExpr,
  escapeDrawtext,
  filmLabel,
} from '../../cinema-stream/src/overlay.ts';
import { formatDuration } from '../../cinema-stream/src/format.ts';

// Le concat demuxer ne transporte pas de métadonnée par fichier : l'incrustation
// (titre + horloge) est pilotée par un fichier sendcmd horodaté sur la timeline
// ffmpeg. Ces tests figent le format exact des commandes, qui dépend de trois
// niveaux d'échappement (sendcmd → options du filtre → expansion drawtext).

const film = (title, durationSec, year = null) => ({
  id: 1,
  title,
  year,
  absolutePath: `/media/films/${title}/vf.mp4`,
  durationSec,
});

const state = (films) => ({
  films,
  totalSec: films.reduce((acc, f) => acc + f.durationSec, 0),
});

test('une commande reinit par film et par passage', () => {
  const s = state([film('A', 5000), film('B', 4000), film('C', 2800)]);
  const lines = buildOverlayCommands(s, 0, 4998, 2).trimEnd().split('\n');
  assert.equal(lines.length, 6);
  assert.ok(lines.every((l) => l.includes('[enter] drawtext@ov reinit')));
  assert.ok(lines.every((l) => l.endsWith("fontsize=38';")));
});

test('le fichier sendcmd est borné en passages (coût mémoire)', () => {
  // sendcmd garde chaque commande en RSS (~14 Ko mesurés par cue) : couvrir les
  // 50 passages de la liste concat coûtait +267 Mo pour un titre qui ne se
  // figerait qu'au bout de 5 ans d'uptime continu.
  const s = state([film('A', 10), film('B', 10)]);
  assert.equal(OVERLAY_PASSES, 3);
  assert.equal(buildOverlayCommands(s, 0, 0).trimEnd().split('\n').length, 6);
});

test("le premier film démarre à l'offset courant, les suivants à leur frontière", () => {
  const s = state([film('A', 5000), film('B', 4000), film('C', 2800)]);
  const lines = buildOverlayCommands(s, 0, 4998, 1).trimEnd().split('\n');

  // frontière A→B à durée - offset, B→C à la somme des durées restantes
  assert.match(lines[0], /^0\.000 /);
  assert.match(lines[1], /^2\.000 /);
  assert.match(lines[2], /^4002\.000 /);

  // horloge du premier film : t + offset (elle a déjà 1:23:18 d'écoulées)
  assert.match(lines[0], /max\(0\\,t\+4998\.000\)/);
  assert.match(lines[1], /max\(0\\,t-2\.000\)/);
});

test("l'ordre des films suit la position de départ dans la playlist", () => {
  const s = state([film('A', 5000), film('B', 4000), film('C', 2800)]);
  const lines = buildOverlayCommands(s, 2, 100, 1).trimEnd().split('\n');
  assert.match(lines[0], /'text=C /);
  assert.match(lines[1], /'text=A /);
  assert.match(lines[2], /'text=B /);
  // C dure 2800 s et on démarre à 100 s : frontière suivante à 2700 s
  assert.match(lines[1], /^2700\.000 /);
});

test('horloge en h:mm:ss au-delà d’une heure, en mm:ss en dessous', () => {
  const long = clockExpr(0, true);
  const short = clockExpr(0, false);
  assert.match(long, /\/3600/);
  assert.match(long, /\\:.*mod\(floor\(/);
  assert.doesNotMatch(short, /3600/);
  // secondes et minutes toujours sur deux chiffres
  assert.match(long, /\\:d\\:2/);
  assert.match(short, /\\:d\\:2/);
});

test('les durées suivent le format du bot Discord', () => {
  assert.equal(formatDuration(6559), '1:49:19');
  assert.equal(formatDuration(2800), '46:40');
  assert.equal(formatDuration(59), '0:59');
});

test("échappement : ':' '%' ''' et antislash neutralisés", () => {
  assert.equal(escapeDrawtext('Star Wars: Episode IV'), 'Star Wars\\: Episode IV');
  assert.equal(escapeDrawtext('100% pur'), '100%% pur');
  assert.equal(escapeDrawtext("L'armée"), 'L\u2019armée');
  assert.equal(escapeDrawtext('a\\b'), 'ab');
  assert.equal(escapeDrawtext('a\nb'), 'a b');
});

test('un titre très long est tronqué avant de sortir du cadre', () => {
  const long = film('X'.repeat(120), 5000);
  const label = filmLabel(long);
  assert.equal(label.length, 62);
  assert.ok(label.endsWith('\u2026'));
});

test("un ':' dans le titre réel ne casse pas la commande sendcmd", () => {
  const s = state([film('Star Wars: Episode IV', 5000)]);
  const [line] = buildOverlayCommands(s, 0, 0, 1).trimEnd().split('\n');
  // le seul ':' non échappé doit être celui qui sépare text= de fontsize=
  const bare = line.replace(/\\:/g, '');
  assert.equal(bare.match(/:/g).length, 1);
  assert.ok(bare.includes(':fontsize=38'));
});
