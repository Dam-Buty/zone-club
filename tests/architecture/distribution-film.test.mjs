// La vidéo de distribution de la K7 (borne, livraison 2) : ce que la fabrique livre au site.
// Spec : docs/superpowers/specs/2026-11-17-borne-distribution-k7-design.md, § 12.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';

const ROOT = process.cwd();
const lis = () => JSON.parse(readFileSync(path.join(ROOT, 'src/data/kiosk-distribution.json'), 'utf8'));

// Largeur et hauteur de la piste vidéo (fin de la boîte « tkhd », en 16.16), comme dans devanture-borne.test.mjs.
function lisMp4(buf) {
  const t = buf.indexOf('tkhd'), fin = t - 4 + buf.readUInt32BE(t - 4);
  return { w: buf.readUInt32BE(fin - 8) / 65536, h: buf.readUInt32BE(fin - 4) / 65536 };
}

test('DISTRIBUTION FILMÉE: l\'arrêt sur la fente laisse au moins une seconde pour lire le titre', () => {
  const { arret } = lis();
  assert.ok(arret.finS - arret.debutS >= 1.0, `arrêt de ${arret.finS - arret.debutS} s`);
  assert.ok(arret.debutS >= 5.85 && arret.finS <= 7.0, 'les calques tiennent entre l\'arrêt de la K7 et le départ de l\'appareil');
  for (const nom of ['tranche', 'afficheur']) {
    const b = arret[nom];
    assert.ok(b.x0 >= 0 && b.y0 >= 0 && b.x1 <= 1 && b.y1 <= 1 && b.x0 < b.x1 && b.y0 < b.y1, `boîte « ${nom} » dans l'image`);
  }
  const { film } = lis(), t = arret.tranche;
  assert.ok((t.x1 - t.x0) * film.largeur > 3 * (t.y1 - t.y0) * film.hauteur, 'la K7 sort couchée : sa tranche est bien plus large que haute');
  assert.ok(arret.afficheur.y1 <= t.y0, 'l\'afficheur est au-dessus de la fente');
});

test('DISTRIBUTION FILMÉE: une vidéo de 8 s en 720 × 1290, avec son, d\'au plus 2 600 000 octets', () => {
  const { film } = lis();
  assert.equal(film.src, '/kiosk-distribution.mp4');
  assert.deepEqual([film.largeur, film.hauteur, film.dureeMs], [720, 1290, 8000]);
  const buf = readFileSync(path.join(ROOT, 'public', film.src));
  assert.deepEqual(lisMp4(buf), { w: 720, h: 1290 });
  assert.equal(buf.length, film.octets);
  assert.ok(buf.length <= 2_600_000, `${buf.length} octets pour un plafond de 2 600 000`);
  assert.equal(buf.toString('latin1', 4, 8), 'ftyp');
  assert.ok(buf.indexOf('moov') > 0 && buf.indexOf('moov') < buf.indexOf('mdat'), 'lisible dès le début du téléchargement');
  assert.ok(buf.includes('soun'), 'la vidéo a sa piste son');
});

test('DISTRIBUTION FILMÉE: la fabrique refuse une vidéo trop lourde et vérifie ses étiquettes de couleur', () => {
  const src = readFileSync(path.join(ROOT, 'tools/devanture-borne/distribution_sorties.py'), 'utf8');
  assert.ok(src.includes('2_600_000') && src.includes('SystemExit'), 'plafond de poids');
  assert.ok(src.includes('setparams=') && src.includes('color_trc=iec61966-2-1') && src.includes('tv,bt709,iec61966-2-1,bt709'), 'étiquetée sRGB, étiquettes relues');
});

test('DISTRIBUTION FILMÉE: les tranches des films sont préparées, légères, avec leur repli par niveau d\'usure', () => {
  const dir = path.join(ROOT, 'public/kiosk-tranches');
  const films = readdirSync(dir).filter((f) => /^\d+\.webp$/.test(f));
  assert.ok(films.length >= 300, `${films.length} tranches préparées`);
  for (const f of films) assert.ok(statSync(path.join(dir, f)).size < 60_000, `${f} pèse moins de 60 000 octets`);
  for (const n of [1, 2, 3]) for (const nom of [`repli-${n}.webp`, `usure-${n}.webp`]) assert.ok(existsSync(path.join(dir, nom)), nom);
});

// ===== La tranche suit la K7 (spec § 13, plan 2026-11-23) : suivi par image, planches de caches et d'ombres =====

// Largeur et hauteur d'un WebP d'après son en-tête (formes étendue, sans perte, avec perte).
function tailleWebp(buf) {
  const forme = buf.toString('latin1', 12, 16);
  if (forme === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
  if (forme === 'VP8L') { const b = buf.readUInt32LE(21); return [1 + (b & 0x3fff), 1 + ((b >> 14) & 0x3fff)]; }
  return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
}

test('DISTRIBUTION FILMÉE: le suivi dit où sont la tranche et l\'écran à chacune des 193 images', () => {
  const s = JSON.parse(readFileSync(path.join(ROOT, 'public/kiosk-distribution-suivi.json'), 'utf8'));
  assert.deepEqual([s.images, s.ips, s.pas.length], [193, 24, 193]);
  // La tranche n'est suivie que dans l'image ou à son bord ; l'écran, lui, sort largement du cadre pendant le rapproché sur la fente.
  const boite = (b, marge) => b.every((v) => v > -marge && v < 1 + marge) && b[0] < b[2] && b[1] < b[3];
  for (const p of s.pas) { assert.ok(p.t === null || boite(p.t, 0.5)); assert.ok(boite(p.e, 3)); assert.ok(p.c === 0 || p.c === 1); }
  const bascules = s.pas.filter((p, i) => i > 0 && p.c !== s.pas[i - 1].c).length;
  assert.equal(bascules, 1, 'la K7 se couche une seule fois (au passage vers la fente)');
  assert.ok(s.pas[0].c === 0 && s.pas[192].c === 1);
  assert.ok(s.lmax > 0);
  // L'appareil part de l'écran et y revient : même boîte à la première et à la dernière image, centrée, entière dans le cadre.
  // (Sa largeur exacte importe peu : la page cale le cadre de la vidéo sur le vrai écran de la borne.)
  const [e0, e1] = [s.pas[0].e, s.pas[192].e];
  assert.ok(e0.every((v, k) => Math.abs(v - e1[k]) < 0.002) && e0.every((v) => v > 0 && v < 1) && Math.abs(e0[0] + e0[2] - 1) < 0.01);
  for (const bloc of [s.debout, s.couchee]) assert.ok(bloc.cellule.length === 2 && bloc.colonnes > 0 && bloc.de <= bloc.a);
  assert.equal(s.debout.a + 1, s.couchee.de, 'les deux blocs se suivent sans trou');
});

test('DISTRIBUTION FILMÉE: les planches de caches et d\'ombres ont la taille annoncée et restent légères', () => {
  const s = JSON.parse(readFileSync(path.join(ROOT, 'public/kiosk-distribution-suivi.json'), 'utf8'));
  let total = 0;
  for (const nom of ['kiosk-distribution-caches.webp', 'kiosk-distribution-ombres.webp']) {
    const buf = readFileSync(path.join(ROOT, 'public', nom));
    total += buf.length;
    const [w, h] = tailleWebp(buf);
    assert.deepEqual([w, h], s.planche, `${nom} : ${w} × ${h}`);
    assert.ok(w <= 4096 && h <= 4096);
  }
  assert.ok(total <= 600_000, `${total} octets pour les deux planches`);
  const lignes = (b) => Math.ceil((b.a - b.de + 1) / b.colonnes) * b.cellule[1];
  assert.equal(s.planche[1], lignes(s.debout) + lignes(s.couchee), 'le bloc « couchée » est sous le bloc « debout »');
});
