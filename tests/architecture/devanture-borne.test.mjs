// La fabrication des images de la devanture mobile (borne + porte) vit dans tools/devanture-borne/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const T = path.join(ROOT, 'tools/devanture-borne');

test('FABRIQUE: les scripts et les sources de la devanture sont dans le dépôt', () => {
  for (const f of ['fabrique.sh', 'README.md', 'geometrie.json', 'fond.py', 'textures.py', 'neon_graphe.py', 'neon.py', 'borne.py', 'compo.py',
    'sources/storefront-mobile.jpeg', 'sources/accueil-face.png', 'sources/accueil-bureau.png', 'sources/tranches.json']) {
    assert.ok(existsSync(path.join(T, f)), f);
  }
});

test('FABRIQUE: aucun script ne dépend du dossier de l\'essai, de ~/Downloads ni de la base locale', () => {
  for (const f of ['fond.py', 'fond_bureau.py', 'textures.py', 'neon.py', 'borne.py', 'compo.py', 'masque.py', 'variante.py', 'sorties.py',
    'approche_trajet.py', 'approche_rendu.py', 'approche_compo.py', 'fabrique.sh']) {
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

test('IMAGES: la devanture mobile a la taille annoncée', () => {
  const L = JSON.parse(readFileSync(path.join(ROOT, 'src/data/storefront-mobile.json'), 'utf8'));
  assert.deepEqual(tailleWebp(readFileSync(path.join(ROOT, 'public/storefront-mobile.webp'))), [1536, 2752]);
  assert.deepEqual([L.image.w, L.image.h], [1536, 2752]);
});

test('IMAGES: la mise en page est cohérente', () => {
  const L = JSON.parse(readFileSync(path.join(ROOT, 'src/data/storefront-mobile.json'), 'utf8'));
  const dans = (a, b) => a.x0 >= b.x0 && a.x1 <= b.x1 && a.y0 >= b.y0 && a.y1 <= b.y1;
  assert.ok(dans(L.ecran, L.borne), 'l\'écran est dans la borne');
  assert.ok(L.borne.x1 < L.porte.x0, 'la borne est à gauche de la porte');
  const ratio = ((L.ecran.y1 - L.ecran.y0) * L.image.h) / ((L.ecran.x1 - L.ecran.x0) * L.image.w);
  assert.ok(Math.abs(ratio - 9 / 5) < 0.03, `écran 5:9, mesuré ${ratio}`);
});

// Relecture finale (18/11/2026) : « python3 … | tail » sous « set -e » rend le code de sortie de tail — une étape en
// échec laissait la fabrique continuer sur l'intermédiaire d'un passage précédent, jusqu'à écraser les images du site.
test('FABRIQUE: une étape en échec arrête la fabrique', () => {
  const sh = readFileSync(path.join(T, 'fabrique.sh'), 'utf8');
  assert.ok(sh.includes('set -e'), 'arrêt à la première erreur');
  // Relecture finale de la livraison B : la règle vaut pour toute commande de la fabrique (ffmpeg, Blender), pas
  // seulement python3. « || » (repli en cas d'échec) n'est pas un tube.
  for (const ligne of sh.split('\n').filter((l) => /^\s*(python3|ffmpeg|"\$BLENDER"|[A-Z]+=\$\()/.test(l))) {
    assert.ok(!/(^|[^|])\|([^|]|$)/.test(ligne), `le code de sortie est masqué par un tube : ${ligne.trim()}`);
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
  // L'écran de la borne vue de la rue est son écran d'accueil, pas la fiche d'un film (Rusmir, 23/11/2026).
  assert.equal(g.facade.ecran_image, 'accueil-face.png');
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

test('MASQUE: le masque du bureau sort de la fabrique, au format de l\'image', () => {
  const png = readFileSync(path.join(ROOT, 'public/storefront-mask.png'));
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [2891, 1536]);
  const g = JSON.parse(readFileSync(path.join(T, 'geometrie-bureau.json'), 'utf8'));
  assert.deepEqual(g.masque.vitre, [0, 1, 0]);
  const src = readFileSync(path.join(T, 'masque.py'), 'utf8');
  for (const garde of ['SystemExit', 'rouge', 'mur ajouté']) assert.ok(src.includes(garde), garde);
});

// ----- L'approche filmée de la borne (livraison B) : un film de 3 s rendu image par image -----

// Ce que le fichier MP4 dit de lui-même (et non ce que la mise en page en dit) : largeur et hauteur de la piste
// (fin de la boîte « tkhd », en 16.16), nombre d'images (« stsz »).
function lisMp4(buf) {
  const t = buf.indexOf('tkhd'), fin = t - 4 + buf.readUInt32BE(t - 4), s = buf.indexOf('stsz');
  return { w: buf.readUInt32BE(fin - 8) / 65536, h: buf.readUInt32BE(fin - 4) / 65536, images: buf.readUInt32BE(s + 12) };
}

function controleFilm(L, fichier, budget) {
  const a = L.approche, buf = readFileSync(path.join(ROOT, 'public', fichier));
  assert.deepEqual(lisMp4(buf), { w: a.w, h: a.h, images: a.images }, 'le fichier a la taille et le nombre d\'images annoncés par la mise en page');
  assert.equal(a.src, '/' + fichier);
  assert.deepEqual([a.duree, a.images], [3, 91]);
  assert.equal(buf.length, a.octets);
  assert.ok(buf.length <= budget, `${buf.length} octets pour un budget de ${budget}`);
  assert.equal(buf.toString('latin1', 4, 8), 'ftyp');
  assert.ok(buf.indexOf('moov') > 0 && buf.indexOf('moov') < buf.indexOf('mdat'), 'lisible dès le début du téléchargement');
  assert.ok(!buf.includes('soun'), 'pas de piste son');
  assert.ok(Math.abs(a.w / a.h - L.image.w / L.image.h) < 0.002, 'le film a le format de l\'image');
  return a;
}

test('APPROCHE: le film du bureau', () => {
  const L = JSON.parse(readFileSync(path.join(ROOT, 'src/data/storefront-desktop.json'), 'utf8'));
  const a = controleFilm(L, 'storefront-borne-approche.mp4', 2621440);
  assert.deepEqual([a.w, a.h], [1920, 1020]);
  assert.ok(Math.abs((a.ecran.y1 - a.ecran.y0) - 0.94) < 0.02, 'l\'écran fait 94 % de la hauteur à l\'arrivée');
  assert.ok(Math.abs((a.ecran.x0 + a.ecran.x1) / 2 - 0.43) < 0.02 && Math.abs((a.ecran.y0 + a.ecran.y1) / 2 - 0.5) < 0.02);
});

test('APPROCHE: le départ du film est tenu à l\'image fixe', () => {
  const src = readFileSync(path.join(T, 'approche_compo.py'), 'utf8');
  assert.ok(src.includes('SystemExit') && src.includes('compo.png'), 'la première image est comparée à l\'image fixe, écart qui arrête la fabrique');
});

// Rusmir, 18/11/2026 : « on veut la même chose sur le mobile » — le film d'approche remplace le zoom, et sa vue
// rapprochée disparaît de la fabrique comme du site.
test('APPROCHE: le film du mobile, et plus de vue rapprochée', () => {
  const L = JSON.parse(readFileSync(path.join(ROOT, 'src/data/storefront-mobile.json'), 'utf8'));
  const a = controleFilm(L, 'storefront-mobile-borne-approche.mp4', 1572864);
  assert.deepEqual([a.w, a.h], [720, 1290]);
  assert.ok(Math.abs((a.ecran.x1 - a.ecran.x0) - 0.78) < 0.02 && Math.abs((a.ecran.y0 + a.ecran.y1) / 2 - 0.47) < 0.02);
  assert.equal(L.zoom, undefined);
  assert.ok(!existsSync(path.join(ROOT, 'public/storefront-borne-zoom.webp')));
  assert.ok(!readFileSync(path.join(T, 'borne.py'), 'utf8').includes("PASSE == 'zoom'"));
});

// Relecture finale : les options -color_primaries / -color_trc de ffmpeg n'arrivaient pas dans le fichier, et le film
// sortait plus clair que la devanture dans Chrome sur Mac (+2 à +6 niveaux par canal). Les images du film sont en
// sRGB : étiqueté ainsi (filtre setparams), il s'affiche comme l'image fixe (écart 0,4). La fabrique relit les
// étiquettes du fichier et s'arrête si elles manquent.
test('APPROCHE: le film est étiqueté sRGB, et la fabrique le vérifie', () => {
  const sh = readFileSync(path.join(T, 'fabrique.sh'), 'utf8');
  assert.ok(sh.includes('setparams=') && sh.includes('color_trc=iec61966-2-1') && sh.includes('color_primaries=bt709'), 'étiquettes écrites par setparams');
  assert.match(sh, /ffprobe[^\n]*color_transfer[\s\S]{0,400}tv,bt709,iec61966-2-1,bt709[\s\S]{0,200}exit 1/, 'étiquettes relues, échec si elles manquent');
});

// Rusmir, 18/11/2026 : le film mobile en 720 × 1290 est un peu mou sur un téléphone récent (écran de 1080 points de
// large) ; « garder le film réalisé pour les téléphones anciens ayant une faible résolution, on chargerait le film en
// fonction de la résolution acceptée par le téléphone ». Deux films mobiles, même trajet, même cadrage.
test('APPROCHE: le mobile a aussi un film en haute définition, même trajet', () => {
  const L = JSON.parse(readFileSync(path.join(ROOT, 'src/data/storefront-mobile.json'), 'utf8'));
  const hd = L.approche.hd, buf = readFileSync(path.join(ROOT, 'public/storefront-mobile-borne-approche-hd.mp4'));
  assert.equal(hd.src, '/storefront-mobile-borne-approche-hd.mp4');
  assert.deepEqual(lisMp4(buf), { w: 1080, h: 1936, images: L.approche.images }, 'taille et nombre d\'images lus dans le fichier');
  assert.deepEqual([hd.w, hd.h], [1080, 1936]);                       // hauteur paire : le codage vidéo l'exige (1935 était refusé)
  assert.equal(buf.length, hd.octets);
  assert.ok(buf.length <= 3670016, `${buf.length} octets pour un budget de 3 670 016`);
  assert.ok(buf.indexOf('moov') > 0 && buf.indexOf('moov') < buf.indexOf('mdat') && !buf.includes('soun'));
  const D = JSON.parse(readFileSync(path.join(ROOT, 'src/data/storefront-desktop.json'), 'utf8'));
  assert.equal(D.approche.hd, undefined, 'le bureau n\'a qu\'un film');
});
