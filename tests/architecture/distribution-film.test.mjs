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

// Largeur et hauteur d'un WebP d'après son en-tête (formes étendue, sans perte, avec perte).
function tailleWebp(buf) {
  const forme = buf.toString('latin1', 12, 16);
  if (forme === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
  if (forme === 'VP8L') { const b = buf.readUInt32LE(21); return [1 + (b & 0x3fff), 1 + ((b >> 14) & 0x3fff)]; }
  return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
}

test('DISTRIBUTION FILMÉE: l\'arrêt sur la fente laisse au moins une seconde pour lire le titre', () => {
  const { arret } = lis();
  assert.ok(arret.finS - arret.debutS >= 1.0, `arrêt de ${arret.finS - arret.debutS} s`);
  // 26/11/2026 : l'étape du tiroir (1,25 s) décale l'arrêt — la K7 s'arrête à 7,10 s, l'appareil repart à 8,25 s.
  assert.ok(arret.debutS >= 7.10 && arret.finS <= 8.25, 'les calques tiennent entre l\'arrêt de la K7 et le départ de l\'appareil');
  for (const nom of ['tranche', 'afficheur']) {
    const b = arret[nom];
    assert.ok(b.x0 >= 0 && b.y0 >= 0 && b.x1 <= 1 && b.y1 <= 1 && b.x0 < b.x1 && b.y0 < b.y1, `boîte « ${nom} » dans l'image`);
  }
  const { film } = lis(), t = arret.tranche;
  assert.ok((t.x1 - t.x0) * film.largeur > 3 * (t.y1 - t.y0) * film.hauteur, 'la K7 sort couchée : sa tranche est bien plus large que haute');
  assert.ok(arret.afficheur.y1 <= t.y0, 'l\'afficheur est au-dessus de la fente');
});

test('DISTRIBUTION FILMÉE: une vidéo de 9,25 s en 720 × 1290, avec son, d\'au plus 2 800 000 octets', () => {
  const { film } = lis();
  assert.equal(film.src, '/kiosk-distribution.mp4');
  assert.deepEqual([film.largeur, film.hauteur, film.dureeMs], [720, 1290, 9250]);
  const buf = readFileSync(path.join(ROOT, 'public', film.src));
  assert.deepEqual(lisMp4(buf), { w: 720, h: 1290 });
  assert.equal(buf.length, film.octets);
  // 2 600 000 sur 8 s (Rusmir, 22/11/2026) ; le H.264 ne va plus qu'aux appareils sans AV1 et garde son débit (26/11/2026).
  assert.ok(buf.length <= 2_800_000, `${buf.length} octets pour un plafond de 2 800 000`);
  assert.equal(buf.toString('latin1', 4, 8), 'ftyp');
  assert.ok(buf.indexOf('moov') > 0 && buf.indexOf('moov') < buf.indexOf('mdat'), 'lisible dès le début du téléchargement');
  assert.ok(buf.includes('soun'), 'la vidéo a sa piste son');
  assert.ok(!buf.includes('av01'), 'le fichier commun est en H.264');
});

// Rusmir, 26/11/2026 : « ceux qui sont compatibles AV1 reçoivent la vidéo AV1, les autres la vidéo H264 ».
test('DISTRIBUTION FILMÉE: la même vidéo en AV1, plus légère, avec son, décrite pour le navigateur', () => {
  const { film } = lis(), a = film.av1;
  assert.equal(a.src, '/kiosk-distribution.av1.mp4');
  assert.match(a.codecs, /^av01\.0\.\d\dM\.08$/, 'profil principal, 8 bits : la chaîne que le site passe au navigateur');
  const buf = readFileSync(path.join(ROOT, 'public', a.src));
  assert.equal(buf.length, a.octets);
  assert.deepEqual(lisMp4(buf), { w: 720, h: 1290 });
  assert.ok(buf.includes('av01') && buf.includes('soun'), 'piste AV1 et piste son');
  assert.ok(buf.indexOf('moov') > 0 && buf.indexOf('moov') < buf.indexOf('mdat'), 'lisible dès le début du téléchargement');
  assert.ok(a.octets <= 1_800_000 && a.octets < 0.8 * film.octets, `${a.octets} octets (H.264 : ${film.octets})`);
});

test('DISTRIBUTION FILMÉE: la fabrique refuse une vidéo trop lourde, vérifie ses étiquettes de couleur et la qualité de l\'AV1', () => {
  const src = readFileSync(path.join(ROOT, 'tools/devanture-borne/distribution_sorties.py'), 'utf8');
  assert.ok(src.includes('2_800_000') && src.includes('PLAFOND_AV1') && src.includes('SystemExit') && src.includes('deux_films('), 'plafonds de poids, deux encodages');
  const enc = readFileSync(path.join(ROOT, 'tools/devanture-borne/encodage.py'), 'utf8');
  assert.ok(enc.includes('setparams=') && enc.includes('color_trc=iec61966-2-1') && enc.includes("'tv,bt709,iec61966-2-1,bt709'"), 'étiquetée sRGB, étiquettes relues');
  assert.ok(enc.includes('libsvtav1') && enc.includes('ssim') && enc.includes('cible - TOLERANCE_SSIM'), 'l\'AV1 égale la qualité mesurée du H.264');
});

test('DISTRIBUTION FILMÉE: les tranches des films sont préparées debout, non éclairées, avec leur repli par niveau d\'usure', () => {
  const dir = path.join(ROOT, 'public/kiosk-tranches');
  const films = readdirSync(dir).filter((f) => /^\d+\.webp$/.test(f));
  assert.ok(films.length >= 300, `${films.length} tranches préparées`);
  // Deux images par film : une par régime de lumière (vitrine ; « -c », couchée à la fente).
  const toutes = [...films, 'repli-1.webp', 'repli-2.webp', 'repli-3.webp'].flatMap((f) => [f, f.replace('.webp', '-c.webp')]);
  for (const f of toutes) {
    const buf = readFileSync(path.join(dir, f));
    assert.ok(buf.length < 60_000, `${f} pèse moins de 60 000 octets`);
    // Debout, au format de la tranche du générateur : c'est la page qui la couche à la fente, et l'ombre de chaque
    // image qui l'éclaire (spec § 13) — une tranche déjà éclairée pour la fente serait fausse dans la vitrine.
    assert.deepEqual(tailleWebp(buf), [153, 1068], f);
  }
  assert.ok(!readdirSync(dir).some((f) => f.startsWith('usure-')), 'l\'usure du repli est cuite dans repli-N');
});

// ===== La tranche suit la K7 (spec § 13, plan 2026-11-23) : suivi par image, planches de caches et d'ombres =====

test('DISTRIBUTION FILMÉE: le suivi dit où sont la tranche et l\'écran à chacune des 223 images', () => {
  const s = JSON.parse(readFileSync(path.join(ROOT, 'public/kiosk-distribution-suivi.json'), 'utf8'));
  assert.deepEqual([s.images, s.ips, s.pas.length], [223, 24, 223]);
  // La tranche n'est suivie que dans l'image ou à son bord ; l'écran, lui, sort largement du cadre pendant le rapproché sur la fente.
  const boite = (b, marge) => b.every((v) => v > -marge && v < 1 + marge) && b[0] < b[2] && b[1] < b[3];
  for (const p of s.pas) { assert.ok(p.t === null || boite(p.t, 0.5)); assert.ok(boite(p.e, 3)); assert.ok(p.c === 0 || p.c === 1); }
  const bascules = s.pas.filter((p, i) => i > 0 && p.c !== s.pas[i - 1].c).length;
  assert.equal(bascules, 1, 'la K7 se couche une seule fois (au passage vers la fente)');
  assert.ok(s.pas[0].c === 0 && s.pas[222].c === 1);
  for (const r of ['debout', 'couchee']) assert.ok(s.lumiere[r].lmax > 0 && s.lumiere[r].teinte.length === 3, `lumière du régime « ${r} »`);
  // L'appareil part de l'écran et y revient : même boîte à la première et à la dernière image, centrée, entière dans le cadre.
  // (Sa largeur exacte importe peu : la page cale le cadre de la vidéo sur le vrai écran de la borne.)
  const [e0, e1] = [s.pas[0].e, s.pas[222].e];
  assert.ok(e0.every((v, k) => Math.abs(v - e1[k]) < 0.002) && e0.every((v) => v > 0 && v < 1) && Math.abs(e0[0] + e0[2] - 1) < 0.01);
  for (const bloc of [s.debout, s.couchee]) assert.ok(bloc.cellule.length === 2 && bloc.colonnes > 0 && bloc.de <= bloc.a);
  assert.equal(s.debout.a + 1, s.couchee.de, 'les deux blocs se suivent sans trou');
});

test('DISTRIBUTION FILMÉE: les planches de caches et d\'ombres ont la taille annoncée et restent légères', () => {
  const s = JSON.parse(readFileSync(path.join(ROOT, 'public/kiosk-distribution-suivi.json'), 'utf8'));
  let total = 0;
  // Les ombres, douces, sont à demi-taille : la page plaçant les cellules en pourcentages, la planche se lit pareil.
  for (const [nom, reduction] of [['kiosk-distribution-caches.webp', 1], ['kiosk-distribution-ombres.webp', 2]]) {
    const buf = readFileSync(path.join(ROOT, 'public', nom));
    total += buf.length;
    const [w, h] = tailleWebp(buf);
    assert.deepEqual([w, h], s.planche.map((v) => v / reduction), `${nom} : ${w} × ${h}`);
    assert.ok(w <= 4096 && h <= 4096);
  }
  assert.ok(total <= 600_000, `${total} octets pour les deux planches`);
  const lignes = (b) => Math.ceil((b.a - b.de + 1) / b.colonnes) * b.cellule[1];
  assert.equal(s.planche[1], lignes(s.debout) + lignes(s.couchee), 'le bloc « couchée » est sous le bloc « debout »');
});
