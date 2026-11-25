import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readText } from '../helpers/repo.mjs';
import { getRentalTier } from '../../src/utils/rental-tier.ts';
import { RENTAL_COSTS } from '../../src/types/index.ts';

// Le palier affiché doit être celui que le serveur facture. Constat du 16/11/2026 : le client
// le déduisait de l'année de sortie, le serveur du marquage « nouveauté » et du rayon Classiques ;
// « Get Out » (2017, marqué nouveauté) s'affichait à 1 crédit et en coûtait 2.

test('TARIF: nouveauté signalée, sinon rayon Classiques, sinon standard', () => {
  assert.equal(getRentalTier({ is_nouveaute: true, aisle: 'thriller' }), 'nouveaute');
  assert.equal(getRentalTier({ is_nouveaute: false, aisle: 'classiques' }), 'classique');
  assert.equal(getRentalTier({ is_nouveaute: false, aisle: 'drame' }), 'standard');
  assert.equal(getRentalTier({ aisle: null }), 'standard');
});
test('TARIF: une nouveauté rangée en Classiques reste une nouveauté (même priorité que le serveur)', () => {
  assert.equal(getRentalTier({ is_nouveaute: true, aisle: 'classiques' }), 'nouveaute');
});
test('TARIF: l\'année de sortie ne décide de rien', () => {
  const getOut = { is_nouveaute: true, aisle: 'thriller', release_date: '2017-01-01' };
  assert.equal(RENTAL_COSTS[getRentalTier(getOut)], 2);
  const recent = { is_nouveaute: false, aisle: 'sf', release_date: '2026-01-01' };
  assert.equal(RENTAL_COSTS[getRentalTier(recent)], 1);
  const ancien = { is_nouveaute: false, aisle: 'horreur', release_date: '1979-01-01' };
  assert.equal(getRentalTier(ancien), 'standard');
});
test('TARIF: le serveur facture avec cette même fonction, pas avec une copie', () => {
  const src = readText(path.join(process.cwd(), 'lib/films.ts'));
  const start = src.indexOf('export function getFilmTier');
  assert.ok(start > 0, 'getFilmTier introuvable dans lib/films.ts');
  assert.match(src.slice(start, start + 200), /getRentalTier\(/, 'getFilmTier doit déléguer à getRentalTier');
});
