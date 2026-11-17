import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readText } from '../helpers/repo.mjs';
import { shouldStartCastOnOpen } from '../../src/utils/cast-on-open.ts';

// « Sur la TV » sur le panneau « Votre K7 est prête » de la borne (spec 2026-11-17, § 7).
const ok = { castOnOpen: 7, currentPlayingFilm: 7, isPlayerOpen: true, hasRental: true, isApple: false };
test('CAST: le lecteur lance le Cast à son ouverture quand la borne l\'a demandé', () => {
  assert.equal(shouldStartCastOnOpen(ok), true);
  assert.equal(shouldStartCastOnOpen({ ...ok, castOnOpen: null }), false);
  assert.equal(shouldStartCastOnOpen({ ...ok, currentPlayingFilm: 8 }), false);
  assert.equal(shouldStartCastOnOpen({ ...ok, isPlayerOpen: false }), false);
  assert.equal(shouldStartCastOnOpen({ ...ok, hasRental: false }), false);
  assert.equal(shouldStartCastOnOpen({ ...ok, isApple: true }), false);
});
test('CAST: le drapeau est consommé une fois et jamais persisté', () => {
  const store = readText(path.join(process.cwd(), 'src/store/index.ts'));
  assert.ok(store.includes('openPlayerOnTv'), 'action du magasin');
  const partialize = store.slice(store.indexOf('partialize'), store.indexOf('partialize') + 800);
  assert.ok(!partialize.includes('castOnOpen'), 'castOnOpen ne doit pas être persisté');
  const player = readText(path.join(process.cwd(), 'src/components/player/VHSPlayer.tsx'));
  assert.ok(player.includes('shouldStartCastOnOpen'), 'le lecteur consulte la règle');
  assert.ok(player.includes('clearCastOnOpen'), 'le lecteur consomme le drapeau');
});
