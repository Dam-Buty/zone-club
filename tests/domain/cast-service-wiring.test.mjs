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

test('CAST SERVICE: la machine et le fil n\'importent aucune valeur', () => {
  for (const name of ['cast-machine.ts', 'cast-wire.ts']) {
    const src = readText(path.join(ROOT, 'src/cast', name));
    assert.ok(!/^\s*import\s+(?!type\s)/m.test(src), `${name} : seul « import type » est permis`);
    assert.ok(!/\bimport\s*\(/.test(src), `${name} : pas d'import dynamique`);
  }
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
