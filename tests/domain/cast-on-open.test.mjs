import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readText } from '../helpers/repo.mjs';

// « Sur ma télé » de la borne ne passe plus par un drapeau lu par le lecteur : la borne demande le Cast elle-même,
// sauf sur Apple avec AirPlay (tests/domain/kiosk-wiring.test.mjs). Restent ici la règle Apple et la proposition de
// rembobinage.

// Revue finale : l'état « AirPlay disponible » du lecteur est posé par un effet du même commit que
// l'ouverture — il pouvait valoir encore false sur Apple. La détection se fait donc sur l'élément vidéo
// lui-même.
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
  assert.ok(player.includes('appleAirPlay(navigator.userAgent, videoRef.current'), '« Regarder sur TV » lit l\'élément vidéo');
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
  // rewindPromptFor applique rewindOfferOnOpen, qui applique shouldOfferRewindOnOpen.
  assert.ok(player.includes('rewindPromptFor('), 'le lecteur consulte la règle');
  assert.match(player, /const playWanted = localAutoPlay\(\{[^}]*rewind: rewindPhase !== 'none'/, 'pas de lecture automatique derrière la proposition');
  assert.ok(player.includes('autoPlay={playWanted}'), 'la vidéo part selon cette règle');
});

// Relecture finale : la décision était prise une seule fois, parfois sur des données périmées (page
// gardée en mémoire, réponse fraîche du serveur pas encore arrivée), ou verrouillée pendant l'attente du
// Cast ; et la proposition restait affichée quand la TV jouait encore le film.
test('REMBOBINAGE: on attend des données fraîches et la fin d\'un Cast en cours avant de décider', async () => {
  const { rewindOfferOnOpen } = await import('../../src/utils/cast-on-open.ts');
  const ok = { fresh: true, watchProgress: 100, rewindClaimed: false, castingThisFilm: false };
  assert.equal(rewindOfferOnOpen(ok), 'offer');
  assert.equal(rewindOfferOnOpen({ ...ok, fresh: false }), 'wait');
  assert.equal(rewindOfferOnOpen({ ...ok, castingThisFilm: true }), 'wait');
  assert.equal(rewindOfferOnOpen({ ...ok, watchProgress: 40 }), 'skip');
  assert.equal(rewindOfferOnOpen({ ...ok, rewindClaimed: true }), 'skip');
});
test('REMBOBINAGE: le lecteur décide sur la réponse fraîche et retire la proposition si la TV reprend', () => {
  const player = readText(path.join(process.cwd(), 'src/components/player/VHSPlayer.tsx'));
  assert.ok(player.includes('setRentalFreshFor('), 'fraîcheur posée à la réponse du fetchMe d\'ouverture');
  // La TV joue ce film (la machine du Cast le dit, plus l'ancienne auto-détection du lecteur) : la télécommande l'emporte.
  assert.match(player, /if \(remoteActive && rewindPhase === 'prompt' && !pendingEject\) setRewindPhase\('none'\)/, 'la télécommande l\'emporte');
  assert.match(player, /tv: view === 'ended' \? 'ended' : remoteActive \? 'busy' : 'free'/, 'la décision attend tant que la TV a ce film, et connaît sa fin');
});

// Relecture de la tâche 6 : fin vue par la TV, lecteur ouvert, location déjà à 100 % par les rapports de position. Deux
// effets décidaient : la fin (ÉJECTER) et « l'ouverture » (NON MERCI), qui gagnait ; NON MERCI fermait sans oublier le
// film terminé, et la question revenait. Une seule décision désormais.
test('REMBOBINAGE: une seule décision — fin vue par la TV, film fini à l\'ouverture, rembobinage déjà réclamé', async () => {
  const { rewindPromptFor } = await import('../../src/utils/cast-on-open.ts');
  const base = { tv: 'free', offered: false, fresh: true, watchProgress: 0, rewindClaimed: false };
  // Fin vue par la TV, lecteur ouvert : ÉJECTER, même location à 100 %, même données fraîches, même proposition de
  // l'ouverture déjà tranchée — jamais NON MERCI.
  for (const patch of [{}, { watchProgress: 100 }, { offered: true }, { fresh: false }, { watchProgress: 100, offered: true }]) {
    assert.equal(rewindPromptFor({ ...base, tv: 'ended', ...patch }), 'eject', JSON.stringify(patch));
  }
  // Rembobinage déjà réclamé : la fin vue par la TV ferme le lecteur ; à l'ouverture, rien à proposer.
  assert.equal(rewindPromptFor({ ...base, tv: 'ended', rewindClaimed: true, watchProgress: 100 }), 'close');
  assert.equal(rewindPromptFor({ ...base, rewindClaimed: true, watchProgress: 100 }), 'skip');
  // Lecteur rouvert sur un film fini (TV au repos) : NON MERCI, une fois par ouverture ; pas avant la réponse fraîche.
  assert.equal(rewindPromptFor({ ...base, watchProgress: 100 }), 'offer');
  assert.equal(rewindPromptFor({ ...base, watchProgress: 100, offered: true }), 'skip');
  assert.equal(rewindPromptFor({ ...base, watchProgress: 100, fresh: false }), 'wait');
  // La TV a encore ce film : on attend sa fin, rien n'est proposé par-dessus la télécommande.
  assert.equal(rewindPromptFor({ ...base, tv: 'busy', watchProgress: 100 }), 'wait');
  // Film pas fini : rien.
  assert.equal(rewindPromptFor({ ...base, watchProgress: 40 }), 'skip');
});

// Relecture finale, A3 : un lecteur ouvert sur un film sans location ne dessine rien, mais reste « ouvert » — la borne
// inerte dessous, le vidéoclub en pause, Échap sans effet : un écran sans sortie visible. Location échue pendant le
// film puis relecture des locations, ou prévisualisation adoptée sur le site principal (lecteur sans location).
test('LECTEUR A3: ouvert sur un film sans location, données relues → il se ferme', async () => {
  const { playerWithoutRental } = await import('../../src/utils/cast-on-open.ts');
  const open = { open: true, hasRental: false, fresh: true };
  assert.equal(playerWithoutRental(open), true);
  // Pas avant la relecture faite à l'ouverture : un magasin périmé n'est pas une location disparue.
  assert.equal(playerWithoutRental({ ...open, fresh: false }), false);
  // Une location réelle, ou une prévisualisation /admin (getRental la sert), et rien ne se ferme.
  assert.equal(playerWithoutRental({ ...open, hasRental: true }), false);
  assert.equal(playerWithoutRental({ ...open, open: false }), false);
});

// Relecture finale, B4 / B5 / B9 : quand la vidéo d'ici part-elle d'elle-même ? Une seule règle, pure.
test('LECTEUR B5: un AUTRE film sur la TV n\'empêche pas ce film de jouer ici ; ce film sur la TV, si', async () => {
  const { playsHere, localAutoPlay } = await import('../../src/utils/cast-on-open.ts');
  const free = { prompt: false, rewind: false, castHeld: false, pending: false };
  assert.equal(playsHere('local'), true);
  assert.equal(playsHere('other-on-tv'), true, 'ce n\'est pas le même film sur deux écrans');
  for (const view of ['choosing', 'connecting', 'loading', 'remote', 'lost', 'ended']) {
    assert.equal(playsHere(view), false, view);
    assert.equal(localAutoPlay({ view, ...free }), false, view);
  }
  assert.equal(localAutoPlay({ view: 'local', ...free }), true);
  assert.equal(localAutoPlay({ view: 'other-on-tv', ...free }), true, '« Sur ce téléphone » d\'un second film démarre ici');
});
test('LECTEUR B4 / B9: une question, un Cast raté ou absent, un film mémorisé encore attendu → rien ne part seul', async () => {
  const { localAutoPlay, noticeHoldsPlayback } = await import('../../src/utils/cast-on-open.ts');
  const free = { prompt: false, rewind: false, castHeld: false, pending: false };
  for (const view of ['local', 'other-on-tv']) {
    for (const held of ['prompt', 'rewind', 'castHeld', 'pending']) {
      assert.equal(localAutoPlay({ view, ...free, [held]: true }), false, `${view} / ${held}`);
    }
  }
  // Le Cast vient d'échouer, ou manque à ce navigateur (panneau « recopie d'écran ») : le visiteur choisit.
  for (const code of ['connect_failed', 'load_failed', 'unavailable']) assert.equal(noticeHoldsPlayback(code), true, code);
  // Les autres messages n'attendent pas de réponse : un arrêt laisse déjà le lecteur en pause (reprise `play: false`).
  for (const code of ['stopped_elsewhere', 'tv_error', 'rental_over', 'no_source']) assert.equal(noticeHoldsPlayback(code), false, code);
});
