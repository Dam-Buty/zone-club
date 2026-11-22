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
  assert.equal(D.spineSrc(9426), '/kiosk-tranches/9426.webp');
  assert.equal(D.fallbackSpineSrc(3), '/kiosk-tranches/repli-3.webp');
  assert.equal(D.fallbackWearSrc(1), '/kiosk-tranches/usure-1.webp');
});

test('distribution : les calques ne sont visibles que pendant l\'arrêt sur la fente', () => {
  const arret = { debutS: 5.9, finS: 6.95 };
  assert.equal(D.overlayVisible(5899, arret), false);
  assert.equal(D.overlayVisible(5900, arret), true);
  assert.equal(D.overlayVisible(6949, arret), true);
  assert.equal(D.overlayVisible(6950, arret), false);
});

test('distribution : l\'afficheur tient en deux lignes de 20 caractères', () => {
  assert.deepEqual(D.displayLines('Get Out'), ['RETIREZ VOTRE K7', 'GET OUT']);
  const long = D.displayLines("Il était une fois dans l'Ouest")[1];
  assert.equal(long.length, 20);
  assert.ok(long.endsWith('…'));
  assert.equal(D.displayLines('12345678901234567890')[1], '12345678901234567890');
});

test('distribution : une boîte en fractions devient une position en pourcentages', () => {
  const s = D.boxStyle({ x0: 0.25, y0: 0.5, x1: 0.75, y1: 0.6 });
  assert.equal(parseFloat(s.left), 25);
  assert.equal(parseFloat(s.top), 50);
  assert.ok(Math.abs(parseFloat(s.width) - 50) < 1e-6);
  assert.ok(Math.abs(parseFloat(s.height) - 10) < 1e-6);
  for (const v of Object.values(s)) assert.ok(v.endsWith('%'));
});

test('distribution : l\'année se lit dans la date de sortie, et son absence ne casse rien', () => {
  assert.equal(D.yearOf('1986-08-15'), 1986);
  assert.equal(D.yearOf(''), null);
  assert.equal(D.yearOf(undefined), null);
  assert.equal(D.wearLevel(D.yearOf('1968-12-21')), 3);
});
