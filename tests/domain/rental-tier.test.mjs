import test from 'node:test';
import assert from 'node:assert/strict';
import { getRentalTier } from '../../src/utils/rental-tier.ts';

const NOW = new Date('2026-11-16T12:00:00Z');
test('TARIF: un film de l\'année ou de l\'année précédente est une nouveauté', () => {
  assert.equal(getRentalTier({ release_date: '2026-01-01' }, NOW), 'nouveaute');
  assert.equal(getRentalTier({ release_date: '2025-01-01' }, NOW), 'nouveaute');
});
test('TARIF: vingt ans ou plus = classique, entre les deux = standard', () => {
  assert.equal(getRentalTier({ release_date: '2006-01-01' }, NOW), 'classique');
  assert.equal(getRentalTier({ release_date: '2014-01-01' }, NOW), 'standard');
});
