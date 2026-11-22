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
