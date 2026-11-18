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

function tailleWebp(buf) {              // VP8X, VP8L ou VP8 : largeur et hauteur
  const tag = buf.toString('ascii', 12, 16);
  if (tag === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
  if (tag === 'VP8L') { const b = buf.readUInt32LE(21); return [1 + (b & 0x3fff), 1 + ((b >> 14) & 0x3fff)]; }
  return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
}

test('IMAGES: la devanture mobile et la vue rapprochée ont les tailles annoncées', () => {
  const L = JSON.parse(readFileSync(path.join(ROOT, 'src/data/storefront-mobile.json'), 'utf8'));
  assert.deepEqual(tailleWebp(readFileSync(path.join(ROOT, 'public/storefront-mobile.webp'))), [1536, 2752]);
  assert.deepEqual([L.image.w, L.image.h], [1536, 2752]);
  assert.deepEqual(tailleWebp(readFileSync(path.join(ROOT, 'public/storefront-borne-zoom.webp'))), [L.zoom.w, L.zoom.h]);
});

test('IMAGES: la mise en page est cohérente', () => {
  const L = JSON.parse(readFileSync(path.join(ROOT, 'src/data/storefront-mobile.json'), 'utf8'));
  const dans = (a, b) => a.x0 >= b.x0 && a.x1 <= b.x1 && a.y0 >= b.y0 && a.y1 <= b.y1;
  assert.ok(dans(L.ecran, L.borne), 'l\'écran est dans la borne');
  assert.ok(dans(L.ecran, L.zoom), 'la vue rapprochée couvre l\'écran');
  assert.ok(L.borne.x1 < L.porte.x0, 'la borne est à gauche de la porte');
  const ratio = ((L.ecran.y1 - L.ecran.y0) * L.image.h) / ((L.ecran.x1 - L.ecran.x0) * L.image.w);
  assert.ok(Math.abs(ratio - 9 / 5) < 0.03, `écran 5:9, mesuré ${ratio}`);
  assert.ok(Math.abs((L.zoom.x1 - L.zoom.x0) * L.image.w / ((L.ecran.x1 - L.ecran.x0) * L.image.w) - 2) < 0.05, 'vue rapprochée : deux largeurs d\'écran');
});
