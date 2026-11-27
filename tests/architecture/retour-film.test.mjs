// Le film du retour de la K7 (borne, livraison 3) : ce que la fabrique livre au site, et où la borne le joue.
// Spec : docs/superpowers/specs/2026-11-26-borne-retour-k7-design.md, § 5.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = process.cwd();
const lis = () => JSON.parse(readFileSync(path.join(ROOT, 'src/data/kiosk-retour.json'), 'utf8'));
const source = (f) => readFileSync(path.join(ROOT, f), 'utf8');

function lisMp4(buf) {
  const t = buf.indexOf('tkhd'), fin = t - 4 + buf.readUInt32BE(t - 4);
  return { w: buf.readUInt32BE(fin - 8) / 65536, h: buf.readUInt32BE(fin - 4) / 65536 };
}

function tailleWebp(buf) {
  const forme = buf.toString('latin1', 12, 16);
  if (forme === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
  if (forme === 'VP8L') { const b = buf.readUInt32LE(21); return [1 + (b & 0x3fff), 1 + ((b >> 14) & 0x3fff)]; }
  return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
}

test('RETOUR FILMÉ: une vidéo de 6 s en 720 × 1290, avec son, en H.264 d\'au plus 2 800 000 octets', () => {
  const { film } = lis();
  assert.equal(film.src, '/kiosk-retour.mp4');
  assert.deepEqual([film.largeur, film.hauteur, film.dureeMs], [720, 1290, 5958]);
  const buf = readFileSync(path.join(ROOT, 'public', film.src));
  assert.deepEqual(lisMp4(buf), { w: 720, h: 1290 });
  assert.equal(buf.length, film.octets);
  assert.ok(buf.length <= 2_800_000, `${buf.length} octets`);
  assert.ok(buf.indexOf('moov') > 0 && buf.indexOf('moov') < buf.indexOf('mdat'), 'lisible dès le début du téléchargement');
  assert.ok(buf.includes('soun'), 'la vidéo a sa piste son (validée à l\'écoute par Rusmir le 27/11/2026)');
  assert.ok(!buf.includes('av01'), 'le fichier commun est en H.264');
});

test('RETOUR FILMÉ: la même vidéo en AV1, plus légère, avec son', () => {
  const { film } = lis(), a = film.av1;
  assert.equal(a.src, '/kiosk-retour.av1.mp4');
  assert.match(a.codecs, /^av01\.0\.\d\dM\.08$/);
  const buf = readFileSync(path.join(ROOT, 'public', a.src));
  assert.equal(buf.length, a.octets);
  assert.deepEqual(lisMp4(buf), { w: 720, h: 1290 });
  assert.ok(buf.includes('av01') && buf.includes('soun'), 'piste AV1 et piste son');
  assert.ok(a.octets < 0.8 * film.octets, `${a.octets} octets (H.264 : ${film.octets})`);
});

test('RETOUR FILMÉ: le suivi couvre les 143 images, K7 couchée de bout en bout, tranche effacée une fois avalée', () => {
  const d = lis();
  const s = JSON.parse(readFileSync(path.join(ROOT, 'public', d.suivi), 'utf8'));
  assert.deepEqual([s.images, s.ips, s.pas.length], [143, 24, 143]);
  assert.equal(Math.round((s.images * 1000) / s.ips), d.film.dureeMs);
  assert.ok(s.pas.every((p) => p.c === 1), 'la K7 est couchée tout le film');
  assert.ok(s.debout.a < s.debout.de, 'aucune cellule « debout »');
  // Lumière reprise du film de location : les tranches du site sont cuites une seule fois, à sa lumière.
  const loc = JSON.parse(readFileSync(path.join(ROOT, 'public/kiosk-distribution-suivi.json'), 'utf8'));
  assert.deepEqual(s.lumiere.couchee, loc.lumiere.couchee);
  // La main engage la K7 (2,6 → 3,2 s) : sa tranche est posée ; avalée (après 4 s), elle ne l'est plus.
  for (let i = 63; i <= 76; i++) assert.ok(s.pas[i].t !== null, `tranche posée à l'image ${i}`);
  for (let i = 100; i < 143; i++) assert.equal(s.pas[i].t, null, `K7 avalée à l'image ${i}`);
  for (const nom of ['caches', 'ombres']) {
    const [w, h] = tailleWebp(readFileSync(path.join(ROOT, 'public', d[nom])));
    // La planche des ombres est réduite de moitié (distribution_planches.planche) : la page la lit en pourcentages.
    assert.deepEqual(nom === 'caches' ? [w, h] : [w * 2, h * 2], s.planche, nom);
  }
});

test('RETOUR FILMÉ: la borne le joue après la réponse du serveur, puis ouvre le message de fin', () => {
  const retour = source('src/components/kiosk/useKioskReturn.ts');
  assert.ok(/result && playFilm \? playFilm\(filmId\)/.test(retour), 'le film ne part que si le serveur a pris la K7');
  assert.ok(retour.indexOf('playFilm(filmId)') < retour.indexOf('returnDoneText('), 'le message vient après le film');
  assert.ok(retour.includes('onAsk?.(filmId)') && retour.includes('ask?.(candidate.filmId)'), 'téléchargé dès la question, des deux côtés');
  const vue = source('src/components/kiosk/KioskView.tsx');
  assert.ok(vue.includes('useReturnFilm({ enabled: !isPc'), 'téléphone seulement, tant que la variante PC n\'existe pas');
  assert.ok(vue.includes('ref={returnFilm.layerRef}') && vue.includes('rented={returnRented}'), 'son calque, avec la tranche du film rendu');
  assert.ok(vue.includes("action === 'skip-film') skipShowing()"), 'le geste retour passe aussi ce film');
});
