import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readText } from '../helpers/repo.mjs';
import { parseServerDate } from '../../src/utils/server-date.ts';

// Le serveur stocke ses dates en UTC, sans fuseau (« 2026-11-18 18:00:56.106 »). Lues telles
// quelles par `new Date()`, elles sont prises pour des heures locales : constat du 16/11/2026,
// une location qui expire à 19:00 (Paris) s'affichait « jusqu'à 18:00 ».

test('DATES: une date du serveur sans fuseau est en UTC', () => {
  assert.equal(parseServerDate('2026-11-18 18:00:56.106'), Date.UTC(2026, 10, 18, 18, 0, 56, 106));
  assert.equal(parseServerDate('2026-11-16 18:00:56'), Date.UTC(2026, 10, 16, 18, 0, 56));
  assert.equal(parseServerDate('2026-11-16T18:00:56'), Date.UTC(2026, 10, 16, 18, 0, 56));
});
test('DATES: une date qui porte son fuseau est lue telle quelle', () => {
  assert.equal(parseServerDate('2026-11-18T18:00:56.106Z'), Date.UTC(2026, 10, 18, 18, 0, 56, 106));
  assert.equal(parseServerDate('2026-11-18T19:00:56+01:00'), Date.UTC(2026, 10, 18, 18, 0, 56));
});
test('DATES: valeur absente ou illisible → NaN, jamais une date inventée', () => {
  assert.ok(Number.isNaN(parseServerDate(null)));
  assert.ok(Number.isNaN(parseServerDate(undefined)));
  assert.ok(Number.isNaN(parseServerDate('')));
  assert.ok(Number.isNaN(parseServerDate('pas une date')));
});
test('DATES: les locations du magasin passent par parseServerDate', () => {
  const src = readText(path.join(process.cwd(), 'src/store/index.ts'));
  const start = src.indexOf('function apiRentalToRental');
  const body = src.slice(start, start + 900);
  assert.match(body, /rentedAt: parseServerDate\(/);
  assert.match(body, /expiresAt: parseServerDate\(/);
  assert.ok(!/new Date\(apiRental\.(rented_at|expires_at)\)/.test(body), 'plus de new Date() sur une date sans fuseau');
});
