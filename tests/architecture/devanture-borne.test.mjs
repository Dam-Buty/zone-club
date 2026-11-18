// La fabrication des images de la devanture mobile (borne + porte) vit dans tools/devanture-borne/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const T = path.join(ROOT, 'tools/devanture-borne');

test('FABRIQUE: les scripts et les sources de la devanture sont dans le dépôt', () => {
  for (const f of ['fabrique.sh', 'README.md', 'geometrie.json', 'fond.py', 'textures.py', 'neon_graphe.py', 'neon.py', 'borne.py', 'compo.py',
    'sources/storefront-mobile.jpeg', 'sources/gyro-face.png', 'sources/tranches.json']) {
    assert.ok(existsSync(path.join(T, f)), f);
  }
});

test('FABRIQUE: aucun script ne dépend du dossier de l\'essai, de ~/Downloads ni de la base locale', () => {
  for (const f of ['fond.py', 'textures.py', 'neon.py', 'borne.py', 'compo.py', 'fabrique.sh']) {
    const src = readFileSync(path.join(T, f), 'utf8');
    assert.ok(!src.includes('.superpowers'), `${f} : .superpowers`);
    assert.ok(!src.includes('Downloads'), `${f} : Downloads`);
    assert.ok(!src.includes('zone.db') && !src.includes('sqlite3'), `${f} : base locale`);
  }
});

test('FABRIQUE: les tranches sont figées (96 films)', () => {
  const tr = JSON.parse(readFileSync(path.join(T, 'sources/tranches.json'), 'utf8'));
  assert.equal(tr.length, 96);
  for (const t of tr) assert.ok(Number.isInteger(t.tmdb_id) && t.title && t.poster_url.startsWith('https://image.tmdb.org/'));
});
