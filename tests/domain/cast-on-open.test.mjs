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
// Revue finale : l'état « AirPlay disponible » du lecteur est posé par un effet du même commit que
// l'ouverture — lu par l'effet de « Sur la TV », il valait encore false sur Apple. La détection se
// fait donc sur l'élément vidéo lui-même.
test('CAST: Apple se reconnaît sur l\'élément vidéo, pas sur un état du rendu précédent', async () => {
  const { appleAirPlay } = await import('../../src/utils/cast-on-open.ts');
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15';
  const pixel = 'Mozilla/5.0 (Linux; Android 17; Pixel 9a) AppleWebKit/537.36 Chrome/157.0';
  const airplay = { webkitShowPlaybackTargetPicker() {} };
  assert.equal(appleAirPlay(iphone, airplay), true);
  assert.equal(appleAirPlay(iphone, {}), false);        // Chrome sur Mac : pas d'AirPlay, il garde le Cast
  assert.equal(appleAirPlay(pixel, airplay), false);
  assert.equal(appleAirPlay(iphone, null), false);
  const player = readText(path.join(process.cwd(), 'src/components/player/VHSPlayer.tsx'));
  assert.ok(player.includes('appleAirPlay(navigator.userAgent, videoRef.current'), 'l\'effet lit l\'élément vidéo');
});

// Suivi serveur d'un film regardé sur la TV (spec 2026-11-17-cast-suivi-serveur) : à la réouverture,
// un film noté vu par le serveur propose le rembobinage au lieu de repartir du début.
test('REMBOBINAGE: proposé à l\'ouverture d\'un film fini, pas encore rembobiné', async () => {
  const { shouldOfferRewindOnOpen } = await import('../../src/utils/cast-on-open.ts');
  const ok = { watchProgress: 100, rewindClaimed: false, castingThisFilm: false };
  assert.equal(shouldOfferRewindOnOpen(ok), true);
  assert.equal(shouldOfferRewindOnOpen({ ...ok, watchProgress: 99 }), false);
  assert.equal(shouldOfferRewindOnOpen({ ...ok, rewindClaimed: true }), false);
  assert.equal(shouldOfferRewindOnOpen({ ...ok, castingThisFilm: true }), false);
});
test('REMBOBINAGE: le lecteur applique la règle une fois par ouverture et ne lance pas le film derrière', () => {
  const player = readText(path.join(process.cwd(), 'src/components/player/VHSPlayer.tsx'));
  assert.ok(player.includes('shouldOfferRewindOnOpen('), 'le lecteur consulte la règle');
  assert.match(player, /autoPlay=\{[^}]*rewindPhase === 'none'/, 'pas de lecture automatique derrière la proposition');
});
