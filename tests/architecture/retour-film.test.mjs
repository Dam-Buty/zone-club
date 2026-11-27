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
  assert.ok(vue.includes('useReturnFilm({ variant: isPc ? PC_RETURN : MOBILE_RETURN'), 'la variante de l\'appareil, comme la distribution');
  assert.ok(vue.includes('film={returnFilm.film}') && vue.includes('sheets={returnFilm.sheets}'), 'le calque reçoit la vidéo et les planches de la variante');
  assert.ok(vue.includes('ref={returnFilm.layerRef}') && vue.includes('rented={returnRented}'), 'son calque, avec la tranche du film rendu');
  assert.ok(vue.includes("action === 'skip-film') skipShowing()"), 'le geste retour passe aussi ce film');
});

test('RETOUR FILMÉ SUR PC: la borne dans la rue, 1920 × 1020, mêmes durée et son, en H.264 (≤ 3 500 000 octets) et en AV1', () => {
  const { pc } = lis();
  assert.ok(pc, 'la variante du PC est livrée (tools/devanture-borne/retour_pc.sh)');
  assert.equal(pc.film.src, '/kiosk-retour-pc.mp4');
  assert.deepEqual([pc.film.largeur, pc.film.hauteur, pc.film.dureeMs], [1920, 1020, 5958]);
  const buf = readFileSync(path.join(ROOT, 'public', pc.film.src));
  assert.deepEqual(lisMp4(buf), { w: 1920, h: 1020 });
  assert.equal(buf.length, pc.film.octets);
  assert.ok(buf.length <= 3_500_000, `${buf.length} octets`);
  assert.ok(buf.indexOf('moov') > 0 && buf.indexOf('moov') < buf.indexOf('mdat'), 'lisible dès le début du téléchargement');
  assert.ok(buf.includes('soun') && !buf.includes('av01'), 'H.264 avec sa piste son');
  const a = pc.film.av1, av1 = readFileSync(path.join(ROOT, 'public', a.src));
  assert.equal(a.src, '/kiosk-retour-pc.av1.mp4');
  assert.match(a.codecs, /^av01\.0\.\d\dM\.08$/);
  assert.equal(av1.length, a.octets);
  assert.deepEqual(lisMp4(av1), { w: 1920, h: 1020 });
  assert.ok(av1.includes('av01') && av1.includes('soun'), 'piste AV1 et piste son');
  assert.ok(a.octets <= 2_200_000 && a.octets < 0.8 * pc.film.octets, `${a.octets} octets (H.264 : ${pc.film.octets})`);
  // Même format que le film de location du PC : la borne cale les deux sur le même cadre (filmRatioRef).
  const loc = JSON.parse(source('src/data/kiosk-distribution.json')).pc.film;
  assert.deepEqual([pc.film.largeur, pc.film.hauteur], [loc.largeur, loc.hauteur]);
});

test('RETOUR FILMÉ SUR PC: le film part du décor de la page et y revient, la tranche suit la K7 de la main à la fente', () => {
  const { pc } = lis();
  const s = JSON.parse(readFileSync(path.join(ROOT, 'public', pc.suivi), 'utf8'));
  assert.deepEqual([s.images, s.ips, s.pas.length], [143, 24, 143]);
  // L'écran filmé de la première et de la dernière image est celui du décor : le vrai écran ne bouge ni au départ ni à la fin.
  const decor = JSON.parse(source('src/data/kiosk-distribution.json')).pc.decor.ecran;
  for (const i of [0, 142]) s.pas[i].e.forEach((v, k) => assert.ok(Math.abs(v - decor[k]) < 5e-4, `image ${i} : écran ${s.pas[i].e} / décor ${decor}`));
  // Pendant le rapproché sur la fente, l'écran filmé est sorti du cadre par le haut : la main ne passe jamais dessous.
  for (let i = 29; i <= 104; i++) assert.ok(s.pas[i].e[3] < 0, `image ${i} : bas de l'écran à ${s.pas[i].e[3]}`);
  assert.ok(s.pas.every((p) => p.c === 1) && s.debout.a < s.debout.de, 'la K7 est couchée tout le film');
  const loc = JSON.parse(readFileSync(path.join(ROOT, 'public/kiosk-distribution-suivi.json'), 'utf8'));
  assert.deepEqual(s.lumiere.couchee, loc.lumiere.couchee);
  // La main apporte la K7 (elle entre à l'image vers 0,9 s), l'engage, les rouleaux l'avalent (après 3,7 s).
  for (let i = 0; i < 20; i++) assert.equal(s.pas[i].t, null, `K7 hors de vue à l'image ${i}`);
  for (let i = 28; i <= 84; i++) assert.ok(s.pas[i].t !== null, `tranche posée à l'image ${i}`);
  for (let i = 96; i < 143; i++) assert.equal(s.pas[i].t, null, `K7 avalée à l'image ${i}`);
  for (const nom of ['caches', 'ombres']) {
    const [w, h] = tailleWebp(readFileSync(path.join(ROOT, 'public', pc[nom])));
    assert.deepEqual(nom === 'caches' ? [w, h] : [w * 2, h * 2], s.planche, nom);
  }
});

test('FILMS DU PC: la vidéo prend les bords fondus du décor qu\'elle remplace (raccord de lumière)', () => {
  // Le décor de la page se fond dans le noir sur ses bords (.decorFade) ; la vidéo, posée au même endroit, doit en
  // faire autant, sinon les bords s'éclairent à son départ (27/11/2026 : + 17 niveaux en haut, + 22 à gauche).
  const fondu = (css, regle) => {
    const debut = css.indexOf(`${regle} {`);
    assert.ok(debut >= 0, `${regle} introuvable`);
    return css.slice(debut, css.indexOf('}', debut)).split('\n').filter((l) => l.includes('linear-gradient')).map((l) => l.trim());
  };
  const decor = fondu(source('src/components/kiosk/KioskView.module.css'), '.decorFade');
  const video = fondu(source('src/components/kiosk/KioskDistributionFilm.module.css'), '.stageFade');
  assert.equal(decor.length, 2);
  assert.deepEqual(video, decor);
  const vue = source('src/components/kiosk/KioskView.tsx');
  assert.equal(vue.split('decor={decor !== null && decorLoaded}').length - 1, 2, 'les deux films (location, retour) le reçoivent');
  assert.ok(source('src/components/kiosk/KioskDistributionFilm.tsx').includes('{decor && <div className={styles.stageFade}'));
});
