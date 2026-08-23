import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iso639_1to2, isFrench, isEnglish } from '../../lib/media/iso639.ts';

test('mappe les langues courantes 639-1 → 639-2/B', () => {
  assert.equal(iso639_1to2('en'), 'eng');
  assert.equal(iso639_1to2('ja'), 'jpn');
  assert.equal(iso639_1to2('ko'), 'kor');
  assert.equal(iso639_1to2('fr'), 'fre');
  assert.equal(iso639_1to2('it'), 'ita');
  assert.equal(iso639_1to2('es'), 'spa');
  assert.equal(iso639_1to2('de'), 'ger');
});

test('inconnu → renvoie la valeur telle quelle', () => {
  assert.equal(iso639_1to2('xx'), 'xx');
  assert.equal(iso639_1to2(''), '');
});

test('isFrench reconnaît fre/fra/fr', () => {
  for (const c of ['fre', 'fra', 'fr', 'FRE', 'French']) assert.equal(isFrench(c), true);
  for (const c of ['eng', 'en', '']) assert.equal(isFrench(c), false);
});

test('isEnglish reconnaît eng/en/english', () => {
  for (const c of ['eng', 'en', 'English', 'EN']) assert.equal(isEnglish(c), true);
  for (const c of ['fre', 'fr', '']) assert.equal(isEnglish(c), false);
});
