import test from 'node:test';
import assert from 'node:assert/strict';

import * as D from '../../src/components/kiosk/kiosk-distribution-logic.ts';

test('distribution : le niveau d\'usure suit l\'année du film (seuils 1985 et 2005)', () => {
  assert.equal(D.wearLevel(1984), 3);
  assert.equal(D.wearLevel(1985), 2);
  assert.equal(D.wearLevel(2004), 2);
  assert.equal(D.wearLevel(2005), 1);
});

test('distribution : un film sans année connue prend le niveau moyen', () => {
  assert.equal(D.wearLevel(null), 2);
  assert.equal(D.wearLevel(undefined), 2);
});

test('distribution : adresses des tranches préparées et de leur repli', () => {
  // deux images par film : la lumière de la vitrine, celle de la fente (K7 couchée)
  assert.equal(D.spineSrc(9426, false), '/kiosk-tranches/9426.webp');
  assert.equal(D.spineSrc(9426, true), '/kiosk-tranches/9426-c.webp');
  assert.equal(D.fallbackSpineSrc(3, false), '/kiosk-tranches/repli-3.webp');
  assert.equal(D.fallbackSpineSrc(3, true), '/kiosk-tranches/repli-3-c.webp');
});

// ----- La tranche suit la K7 (spec § 13) -----
const SUIVI = {
  images: 193, ips: 24, planche: [1792, 3968],
  debout: { cellule: [48, 336], colonnes: 16, de: 0, a: 113 },
  couchee: { cellule: [448, 64], colonnes: 4, de: 114, a: 192 },
  pas: [],
};

test('distribution : l\'image suivie est celle que la vidéo présente, bornée au film', () => {
  assert.equal(D.frameAt(0, SUIVI), 0);
  assert.equal(D.frameAt(6.4, SUIVI), 154);
  assert.equal(D.frameAt(2.3541, SUIVI), 56);
  assert.equal(D.frameAt(99, SUIVI), 192);
  assert.equal(D.frameAt(-1, SUIVI), 0);
});

test('distribution : la cellule d\'une image dans la planche (bloc debout, puis bloc couché dessous)', () => {
  const pct = (v) => v.split(' ').map(parseFloat);
  const c0 = D.sheetPosition(0, 0, SUIVI);
  assert.deepEqual(pct(c0.size).map(Math.round), [Math.round(1792 / 48 * 100), Math.round(3968 / 336 * 100)]);
  assert.deepEqual(pct(c0.position), [0, 0]);
  // image 17 : deuxième ligne, deuxième colonne du bloc debout → décalage de 48 et 336 points
  const c17 = pct(D.sheetPosition(17, 0, SUIVI).position);
  assert.ok(Math.abs(c17[0] - 48 / (1792 - 48) * 100) < 1e-6 && Math.abs(c17[1] - 336 / (3968 - 336) * 100) < 1e-6);
  // image 119 : couchée, sixième cellule du bloc couché (ligne 1, colonne 1), sous les 8 lignes du bloc debout
  const c119 = pct(D.sheetPosition(119, 1, SUIVI).position);
  assert.ok(Math.abs(c119[0] - 448 / (1792 - 448) * 100) < 1e-6 && Math.abs(c119[1] - (8 * 336 + 64) / (3968 - 64) * 100) < 1e-6);
});

test('distribution : le cadre de la vidéo se cale sur le vrai écran, qui ne bouge donc pas à la première image', () => {
  const ecran0 = [0.0921, 0.0902, 0.9079, 0.9098];
  const borne = { left: 6, top: 62, width: 400, height: 720 };
  const cadre = D.stageRect(ecran0, borne, 720 / 1290);
  assert.ok(Math.abs(cadre.width - 400 / (0.9079 - 0.0921)) < 1e-6);
  assert.ok(Math.abs(cadre.left + 0.0921 * cadre.width - 6) < 1e-6 && Math.abs(cadre.top + 0.0902 * cadre.height - 62) < 1e-6);
  const t0 = D.screenTransform(ecran0, cadre, borne);
  assert.ok(Math.abs(t0.tx) < 0.01 && Math.abs(t0.ty) < 0.01 && Math.abs(t0.sx - 1) < 0.001 && Math.abs(t0.sy - 1) < 0.01, JSON.stringify(t0));
  // plan large : l'écran filmé est petit, à droite — le vrai écran rétrécit et s'y place
  const t = D.screenTransform([0.5162, 0.2194, 0.7595, 0.4638], cadre, borne);
  assert.ok(Math.abs(t.sx - (0.7595 - 0.5162) * cadre.width / 400) < 1e-6);
  assert.ok(Math.abs(t.tx - (cadre.left + 0.5162 * cadre.width - 6)) < 1e-6);
  assert.equal(D.transformCss(t), `translate(${t.tx}px, ${t.ty}px) scale(${t.sx}, ${t.sy})`);
});

test('distribution : le vrai écran est rogné au cadre de la vidéo (rapproché sur la fente : il sort par le haut)', () => {
  const borne = { left: 6, top: 62, width: 400, height: 720 };
  const cadre = { left: -39, top: -17, width: 490, height: 878 };
  // image 0 : l'écran est entier dans le cadre → rien n'est rogné
  assert.equal(D.screenClip(D.screenTransform([0.0921, 0.0902, 0.9079, 0.9098], cadre, borne), cadre, borne), 'inset(0px 0px 0px 0px)');
  // rapproché : l'écran filmé déborde au-dessus du cadre → son haut est rogné, en points de l'écran NON transformé
  const t = D.screenTransform([0.09, -0.66, 0.95, 0.2], cadre, borne);
  const haut = parseFloat(D.screenClip(t, cadre, borne).slice(6));
  assert.ok(Math.abs(haut - (0.66 * cadre.height) / t.sy) < 0.01, String(haut));
});

test('distribution : la boîte de la tranche en pourcentages du cadre', () => {
  const s = D.boxStyle([0.25, 0.5, 0.75, 0.6]);
  assert.equal(parseFloat(s.left), 25);
  assert.equal(parseFloat(s.top), 50);
  assert.ok(Math.abs(parseFloat(s.width) - 50) < 1e-6 && Math.abs(parseFloat(s.height) - 10) < 1e-6);
});

test('distribution : l\'année se lit dans la date de sortie, et son absence ne casse rien', () => {
  assert.equal(D.yearOf('1986-08-15'), 1986);
  assert.equal(D.yearOf(''), null);
  assert.equal(D.yearOf(undefined), null);
  assert.equal(D.wearLevel(D.yearOf('1968-12-21')), 3);
});

// ----- Écran qui n'a pas les proportions de l'écran filmé (PC : 2:3 contre 5:9) -----
const E0 = [0.0921, 0.0902, 0.9079, 0.9098];
const RATIO = 720 / 1290;

test('distribution : sur téléphone (écran 5:9), le cadre reste calé exactement sur le vrai écran', () => {
  const borne = { left: 6, top: 72, width: 400, height: 720 };
  const s = D.stageFor(E0, borne, RATIO, { width: 412, height: 915 });
  assert.equal(s.exact, true);
  assert.deepEqual(s.cadre, D.stageRect(E0, borne, RATIO));
});

test('distribution : sur PC (écran 2:3), le cadre tient en entier dans la fenêtre, centré sur l\'écran de la borne', () => {
  const borne = { left: 412, top: 27, width: 564, height: 846 };
  const s = D.stageFor(E0, borne, RATIO, { width: 1440, height: 900 });
  assert.equal(s.exact, false);
  assert.equal(s.cadre.top, 0);
  assert.equal(s.cadre.height, 900);
  assert.ok(Math.abs(s.cadre.width - 900 * RATIO) < 1e-6);
  assert.ok(Math.abs(s.cadre.left + s.cadre.width / 2 - (412 + 282)) < 1e-6, 'centré sur l\'écran');
});

test('distribution : fenêtre de PC étroite ou basse — le cadre ne sort jamais de la fenêtre', () => {
  const s = D.stageFor(E0, { left: 0, top: 20, width: 300, height: 450 }, RATIO, { width: 800, height: 500 });
  assert.ok(s.cadre.left >= 0 && s.cadre.top >= 0 && s.cadre.left + s.cadre.width <= 800 + 1e-6 && s.cadre.top + s.cadre.height <= 500 + 1e-6);
  const etroit = D.stageFor(E0, { left: 10, top: 10, width: 180, height: 270 }, RATIO, { width: 200, height: 900 });
  assert.ok(Math.abs(etroit.cadre.width - 200) < 1e-6 && Math.abs(etroit.cadre.height - 200 / RATIO) < 1e-6);
});

test('distribution : dans un cadre non exact, le vrai écran garde ses proportions, centré dans l\'écran filmé', () => {
  const borne = { left: 412, top: 27, width: 564, height: 846 };
  const { cadre } = D.stageFor(E0, borne, RATIO, { width: 1440, height: 900 });
  const t = D.screenTransform(E0, cadre, borne, false);
  assert.equal(t.sx, t.sy, 'pas de déformation');
  const boiteL = (E0[2] - E0[0]) * cadre.width, boiteH = (E0[3] - E0[1]) * cadre.height;
  assert.ok(564 * t.sx <= boiteL + 1e-6 && 846 * t.sy <= boiteH + 1e-6, 'il tient dans l\'écran filmé');
  const centreX = 412 + t.tx + (564 * t.sx) / 2, centreY = 27 + t.ty + (846 * t.sy) / 2;
  assert.ok(Math.abs(centreX - (cadre.left + ((E0[0] + E0[2]) / 2) * cadre.width)) < 1e-6);
  assert.ok(Math.abs(centreY - (cadre.top + ((E0[1] + E0[3]) / 2) * cadre.height)) < 1e-6);
});
