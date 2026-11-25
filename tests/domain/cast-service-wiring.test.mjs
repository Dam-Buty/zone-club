import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readText, toPosix, walkFiles } from '../helpers/repo.mjs';

// Le service Cast (src/cast/cast-service.ts) parle au vrai SDK de Google, absent de Node : ces gardes statiques
// tiennent ce que la recette sur téléphone ne peut pas surveiller à chaque commit.

const ROOT = process.cwd();
const SERVICE = path.join(ROOT, 'src/cast/cast-service.ts');
const occurrences = (text, needle) => text.split(needle).length - 1;

// Un second appel coupe sans bruit le canal des commandes : la télécommande n'obéit plus alors que le SDK se dit
// connecté (D1, mesuré le 18/11/2026).
test('CAST SERVICE: setOptions( n\'apparaît qu\'une fois dans src/, dans le service', () => {
  const hits = [];
  for (const file of walkFiles(path.join(ROOT, 'src'), new Set(['.ts', '.tsx']))) {
    const count = occurrences(readText(file), 'setOptions(');
    for (let i = 0; i < count; i++) hits.push(toPosix(path.relative(ROOT, file)));
  }
  assert.deepEqual(hits, ['src/cast/cast-service.ts']);
});
test('CAST SERVICE: le service appelle setOptions une seule fois', () => {
  assert.equal(occurrences(readText(SERVICE), 'setOptions('), 1);
});

test('CAST SERVICE: statut demandé à la TV, fin du film entendue, séance terminée, page surveillée', () => {
  const src = readText(SERVICE);
  for (const needle of ['GET_STATUS', 'addUpdateListener', 'endCurrentSession', 'visibilitychange']) {
    assert.ok(src.includes(needle), `cast-service.ts doit contenir ${needle}`);
  }
  // Les autres écouteurs posés une fois pour toute la vie de la page.
  for (const needle of ['CAST_STATE_CHANGED', 'SESSION_STATE_CHANGED', 'MEDIA_SESSION', 'addMessageListener', "'resume'"]) {
    assert.ok(src.includes(needle), `cast-service.ts doit contenir ${needle}`);
  }
});

test('CAST SERVICE: le sélecteur s\'ouvre dans la pile de l\'appui', () => {
  // Une activation perdue et Chrome refuse d'ouvrir le sélecteur : rien n'est attendu avant requestSession.
  const src = readText(SERVICE);
  assert.ok(src.includes('requestSession()'), 'le service ouvre le sélecteur');
  assert.ok(!/await\s+[\w.?]*requestSession/.test(src), 'requestSession n\'est jamais attendu');
});

// La machine n'importe aucune valeur. Le fil, une seule depuis la tâche 8 des versions (deuxième relecture) : la règle de
// reprise de l'appareil (swapResumeTime), pour que « Sur ma télé » parte de la même seconde que le téléphone — un module
// pur qui n'importe rien lui-même, avec son extension : le fil se charge toujours seul, dans Node comme dans le service.
test('CAST SERVICE: la machine n\'importe aucune valeur ; le fil, seulement la règle de reprise (pure, sans import)', () => {
  const machine = readText(path.join(ROOT, 'src/cast/cast-machine.ts'));
  assert.ok(!/^\s*import\s+(?!type\s)/m.test(machine), 'cast-machine.ts : seul « import type » est permis');
  const wire = readText(path.join(ROOT, 'src/cast/cast-wire.ts'));
  const valueImports = (wire.match(/^\s*import\s+(?!type\s).*$/gm) ?? []).map((line) => line.trim());
  assert.deepEqual(valueImports, ["import { swapResumeTime } from '../utils/video-swap.ts';"], 'cast-wire.ts : la règle de reprise, et rien d\'autre');
  assert.ok(!/^\s*import\s/m.test(readText(path.join(ROOT, 'src/utils/video-swap.ts'))), 'video-swap.ts n\'importe rien');
  for (const src of [machine, wire]) assert.ok(!/\bimport\s*\(/.test(src), 'pas d\'import dynamique');
});

test('CAST SERVICE: la remise à neuf réservée aux tests n\'est appelée nulle part dans l\'application', () => {
  // Elle oublie la séance, l'état et le SDK initialisé : appelée en vrai, elle rouvrirait la voie à un second
  // appel d'initialisation (D1).
  for (const file of walkFiles(path.join(ROOT, 'src'), new Set(['.ts', '.tsx']))) {
    const rel = toPosix(path.relative(ROOT, file));
    if (rel === 'src/cast/cast-service.ts' || rel === 'src/cast/cast-sdk.ts') continue;
    assert.ok(!readText(file).includes('ForTests'), `${rel} ne doit pas appeler une fonction réservée aux tests`);
  }
});

// Relecture finale, B12 : un effet ajouté à la machine ne doit pas pouvoir compiler sans être exécuté. `runEffect`
// se termine par une branche `never` (le compilateur refuse un cas oublié), et chaque effet de la machine y a son cas.
test('CAST SERVICE B12: runEffect traite chaque effet de la machine, et le compilateur le garde', () => {
  const src = readText(SERVICE);
  const start = src.indexOf('function runEffect(');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  assert.match(body, /default: \{\s*(?:\/\/[^\n]*\n\s*)*const unhandled: never = effect;/, 'branche never');
  const machine = readText(path.join(ROOT, 'src/cast/cast-machine.ts'));
  const union = machine.slice(machine.indexOf('export type CastEffect ='), machine.indexOf('export type CastView'));
  const types = [...union.matchAll(/type: '([A-Z_]+)'/g)].map((m) => m[1]);
  assert.ok(types.length >= 12, `effets relevés : ${types.length}`);
  for (const type of types) assert.ok(body.includes(`case '${type}'`), `runEffect traite ${type}`);
});
