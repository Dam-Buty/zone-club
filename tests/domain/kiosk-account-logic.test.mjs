// Le compte dans la borne : bonus de la semaine et fin d'une location (logique pure).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as K from '../../src/components/kiosk/kiosk-account-logic.ts';

test('BORNE: la prochaine fin de location à surveiller', () => {
  const now = 1_000_000;
  assert.equal(K.nextRentalEnd([], now), null);
  assert.deepEqual(K.nextRentalEnd([{ filmId: 1, expiresAt: now + 9000 }, { filmId: 2, expiresAt: now + 3000 }], now), { filmId: 2, at: now + 3000 });
  // Une location déjà échue que le serveur n'a pas encore retirée : à traiter tout de suite, pas ignorée.
  assert.deepEqual(K.nextRentalEnd([{ filmId: 3, expiresAt: now - 5 }], now), { filmId: 3, at: now - 5 });
});

// ----- Le bonus de la semaine dans la borne (spec 2026-11-20-credits-au-moment-de-l-action, § 5.5 ; Rusmir, 25/11/2026) -----
test('BONUS: l\'état du bonus de la semaine, d\'après le serveur', () => {
  assert.deepEqual(K.bonusLine({ canClaim: true, amount: 3, code: 'available' }), { state: 'available', amount: 3 });
  assert.deepEqual(K.bonusLine({ canClaim: false, amount: 0, code: 'claimed' }), { state: 'claimed' });
  assert.deepEqual(K.bonusLine({ canClaim: false, amount: 0, code: 'enough' }), { state: 'enough' });
  // Un serveur d'avant le code : la phrase suffit à reconnaître les deux cas.
  assert.deepEqual(K.bonusLine({ canClaim: false, amount: 0, reason: 'Bonus déjà réclamé cette semaine' }), { state: 'claimed' });
  assert.deepEqual(K.bonusLine({ canClaim: false, amount: 0, reason: 'Solde >= 5 crédits' }), { state: 'enough' });
  assert.deepEqual(K.bonusLine(null), { state: 'unknown' });
  assert.deepEqual(K.bonusLine({ canClaim: false, amount: 0 }), { state: 'unknown' });
});

test('BONUS: la ligne de « Mon compte » dit toujours son état', () => {
  assert.equal(K.bonusLineText({ state: 'claimed' }), 'déjà reçu');
  assert.equal(K.bonusLineText({ state: 'enough' }), 'quand il vous reste moins de 5 crédits');
  assert.equal(K.bonusLineText({ state: 'unknown' }), 'indisponible pour l\'instant');
  assert.equal(K.bonusButtonLabel(3), 'Recevoir +3 crédits');
  assert.equal(K.bonusButtonLabel(1), 'Recevoir +1 crédit');
});

test('BONUS: « Crédits insuffisants » propose le bonus quand il attend, et seulement s\'il suffit', () => {
  const avec = K.insufficientText({ cost: 2, credits: 1, bonus: { state: 'available', amount: 3 } });
  assert.equal(avec.body, 'Ce film coûte 2 crédits. Vous en avez 1. Votre bonus de la semaine vous en offre 3.');
  assert.equal(avec.offer, 3);
  const sans = K.insufficientText({ cost: 2, credits: 1, bonus: { state: 'claimed' } });
  assert.equal(sans.body, 'Ce film coûte 2 crédits. Vous en avez 1.');
  assert.equal(sans.offer, null);
  // Un bonus qui ne suffirait pas à payer le film ne promet rien.
  assert.equal(K.insufficientText({ cost: 5, credits: 0, bonus: { state: 'available', amount: 3 } }).offer, null);
});
