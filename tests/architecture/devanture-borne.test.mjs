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

// Relecture finale (18/11/2026) : « python3 … | tail » sous « set -e » rend le code de sortie de tail — une étape en
// échec laissait la fabrique continuer sur l'intermédiaire d'un passage précédent, jusqu'à écraser les images du site.
test('FABRIQUE: une étape en échec arrête la fabrique', () => {
  const sh = readFileSync(path.join(T, 'fabrique.sh'), 'utf8');
  assert.ok(sh.includes('set -e'), 'arrêt à la première erreur');
  for (const ligne of sh.split('\n').filter((l) => /^\s*python3 /.test(l))) {
    assert.ok(!ligne.includes('|'), `le code de sortie de python3 est masqué par un tube : ${ligne.trim()}`);
  }
});

// Relecture finale : seule la liste des films était figée ; le logo de chaque tranche était rechoisi chez TMDB à
// chaque fabrication (selon des votes qui bougent), et sans réseau la fabrique écrivait des tranches dégradées.
test('FABRIQUE: le logo de chaque tranche est figé, et la fabrique n\'interroge plus l\'API de TMDB', () => {
  const tr = JSON.parse(readFileSync(path.join(T, 'sources/tranches.json'), 'utf8'));
  for (const t of tr) assert.ok(t.logo_path === null || /^\/[\w-]+\.png$/.test(t.logo_path), `${t.title} : ${t.logo_path}`);
  assert.ok(tr.filter((t) => t.logo_path).length >= 90, 'presque toutes les tranches portent le logo du film');
  const src = readFileSync(path.join(T, 'textures.py'), 'utf8');
  assert.ok(!src.includes('api.themoviedb.org') && !src.includes('TMDB_API_KEY'), 'ni API ni clé');
  assert.ok(src.includes('SystemExit'), 'une image attendue qui manque arrête la fabrique');
});

// Livraison B (18/11/2026) : la fabrique fait deux devantures (mobile, bureau). Chaque script prend sa géométrie et
// son dossier d'intermédiaire dans variante.py, plus aucun chemin écrit en dur.
test('VARIANTES: chaque script lit sa géométrie et son dossier par variante.py', () => {
  assert.ok(existsSync(path.join(T, 'variante.py')));
  for (const f of ['fond.py', 'textures.py', 'neon.py', 'borne.py', 'compo.py', 'sorties.py']) {
    const src = readFileSync(path.join(T, f), 'utf8');
    assert.ok(src.includes('variante'), `${f} : variante`);
    assert.ok(!src.includes("'geometrie.json'") && !src.includes("/ 'travail'"), `${f} : chemin en dur`);
  }
  const sh = readFileSync(path.join(T, 'fabrique.sh'), 'utf8');
  assert.ok(sh.includes('DEVANTURE='), 'la fabrique boucle sur les variantes');
  assert.ok(readFileSync(path.join(T, '.gitignore'), 'utf8').includes('travail-*/'));
});

test('VARIANTES: la géométrie du mobile porte ses réglages de pluie, de fond et d\'écran', () => {
  const g = JSON.parse(readFileSync(path.join(T, 'geometrie.json'), 'utf8'));
  assert.equal(g.fond, 'fond.py');
  assert.equal(g.facade.ecran_image, 'gyro-face.png');
  assert.deepEqual(g.pluie, { densite: 0.00016, longueur: [10, 34], pente: 0.06, force: [0.05, 0.22], epaisseur: 1, flou: 0.6 });
});

// ----- La devanture du bureau (livraison B) -----

function tailleJpeg(buf) {                // premier marqueur SOF0..SOF2 : hauteur puis largeur
  for (let i = 2; i < buf.length;) {
    const m = buf[i + 1], n = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xc2) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + n;
  }
  throw new Error('JPEG sans SOF');
}

test('BUREAU: sources, géométrie et mise en page', () => {
  for (const f of ['geometrie-bureau.json', 'fond_bureau.py', 'sources/storefront-bureau.jpeg', 'sources/ecran-bureau.png']) assert.ok(existsSync(path.join(T, f)), f);
  const g = JSON.parse(readFileSync(path.join(T, 'geometrie-bureau.json'), 'utf8'));
  assert.deepEqual([g.sortie.w, g.sortie.h, g.sortie.px_par_m], [5782, 3072, 1104]);
  assert.equal(g.borne.ecart_porte_m, 0.16);
  assert.equal(g.site.zoom, undefined);
  const L = JSON.parse(readFileSync(path.join(ROOT, 'src/data/storefront-desktop.json'), 'utf8'));
  assert.deepEqual([L.image.w, L.image.h], [5782, 3072]);
  const dans = (a, b) => a.x0 >= b.x0 && a.x1 <= b.x1 && a.y0 >= b.y0 && a.y1 <= b.y1;
  assert.ok(dans(L.ecran, L.borne) && L.borne.x1 < L.porte.x0);
  const ratio = ((L.ecran.y1 - L.ecran.y0) * L.image.h) / ((L.ecran.x1 - L.ecran.x0) * L.image.w);
  assert.ok(Math.abs(ratio - 3 / 2) < 0.03, `écran 2:3, mesuré ${ratio}`);
  assert.ok(L.push.x > L.porte.x0 && L.push.x < L.porte.x1 && L.zoom === undefined);
  assert.ok(Math.abs(L.borne.x0 * 5782 - 91) < 6 && Math.abs(L.ecran.x0 * 5782 - 679) < 6 && Math.abs(L.ecran.y0 * 3072 - 1817) < 6, 'positions de l\'essai validé');
});

test('BUREAU: la devanture du site a le format de sa mise en page', () => {
  const [w, h] = tailleJpeg(readFileSync(path.join(ROOT, 'public/storefront.jpeg')));
  assert.deepEqual([w, h], [2102, 1117]);
});
