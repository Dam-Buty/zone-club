import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../src/components/kiosk/kiosk-copies.ts';

const at = Date.UTC(2026, 10, 27, 20, 0); const tz = 'Europe/Paris';

test('FICHE: l\'état de chaque exemplaire, jamais deviné', () => {
  assert.deepEqual(C.copyLines({ stock: 2, returns: [] }, tz), [
    { n: 1, available: true, text: 'disponible' }, { n: 2, available: true, text: 'disponible' }]);
  assert.deepEqual(C.copyLines({ stock: 2, returns: [{ atMs: at, mine: false }] }, tz), [
    { n: 1, available: false, text: 'loué · retour prévu le 27 novembre à 21:00' }, { n: 2, available: true, text: 'disponible' }]);
  assert.equal(C.copyLines({ stock: 1, returns: [{ atMs: at, mine: true }] }, tz)[0].text, 'loué par vous · jusqu\'au 27 novembre à 21:00');
  assert.equal(C.copyLines({ stock: 1, returns: [{ atMs: at, mine: false }, { atMs: at + 1, mine: true }] }, tz).length, 2, 'aucune location cachée');
  assert.equal(C.copyLines({ stock: 1, returns: [{ atMs: NaN, mine: false }] }, tz)[0].text, 'loué');
  assert.equal(C.copyLines(null), null);
});
