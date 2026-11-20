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
  // Les retenues de localAutoPlay sont posées une fois (`playHolds`), la question des sous-titres s'y ajoute.
  assert.match(player, /const playHolds = \{[^}]*rewind: rewindPhase !== 'none'/, 'pas de lecture automatique derrière la proposition');
  assert.match(player, /const playWanted = localAutoPlay\(\{ \.\.\.playHolds, question: asking \}\);/, 'la même règle arme la lecture automatique');
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
  const free = { prompt: false, rewind: false, castHeld: false, pending: false, question: false };
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
  const free = { prompt: false, rewind: false, castHeld: false, pending: false, question: false };
  for (const view of ['local', 'other-on-tv']) {
    for (const held of ['prompt', 'rewind', 'castHeld', 'pending', 'question']) {
      assert.equal(localAutoPlay({ view, ...free, [held]: true }), false, `${view} / ${held}`);
    }
  }
  // Le Cast vient d'échouer, ou manque à ce navigateur (panneau « recopie d'écran ») : le visiteur choisit.
  for (const code of ['connect_failed', 'load_failed', 'unavailable']) assert.equal(noticeHoldsPlayback(code), true, code);
  // Les autres messages n'attendent pas de réponse : un arrêt laisse déjà le lecteur en pause (reprise `play: false`).
  for (const code of ['stopped_elsewhere', 'tv_error', 'rental_over', 'no_source']) assert.equal(noticeHoldsPlayback(code), false, code);
});

// Tâche 8 (spec 2026-11-19-versions-et-erreurs-de-lecture, § 4.1) : ouvert hors de la borne avec une décision « ask »
// (version préférée VOSTFR, film sans sous-titres français), le lecteur pose la question des sous-titres ; la vidéo
// attend la réponse derrière elle, et part dès qu'elle est donnée.
test('LECTEUR: la question des sous-titres retient la vidéo d\'ici tant qu\'elle est affichée', async () => {
  const { localAutoPlay } = await import('../../src/utils/cast-on-open.ts');
  const free = { prompt: false, rewind: false, castHeld: false, pending: false, question: false };
  assert.equal(localAutoPlay({ view: 'local', ...free, question: true }), false, 'question affichée : rien ne part');
  assert.equal(localAutoPlay({ view: 'local', ...free }), true, 'réponse donnée : la vidéo part');
  // La réponse ne lève pas les autres retenues : l'invite « Regarder sur TV ? » attend encore la sienne.
  assert.equal(localAutoPlay({ view: 'local', ...free, prompt: true }), false);
});

// Relecture de la tâche 8 : la lecture automatique désarmée ne suffit pas — une reprise du Cast (`play()` de
// takeCastResume) ou une touche média du matériel pouvaient lancer le film derrière la question. Toute lecture qui part
// ici est arrêtée aussitôt, sous la même règle que sous le panneau d'échec.
test('LECTEUR: une lecture qui part sous la question des sous-titres, sous le panneau d\'échec ou TV aux commandes est arrêtée', async () => {
  const { playHeldHere } = await import('../../src/utils/cast-on-open.ts');
  const free = { tvOwnsFilm: false, failure: false, question: false };
  assert.equal(playHeldHere(free), false, 'rien ne la retient : elle joue');
  for (const held of ['tvOwnsFilm', 'failure', 'question']) {
    assert.equal(playHeldHere({ ...free, [held]: true }), true, held);
  }
  const player = readText(path.join(process.cwd(), 'src/components/player/VHSPlayer.tsx'));
  const onPlay = player.slice(player.indexOf('onPlay={() => {'), player.indexOf('onPause={() => {'));
  assert.match(onPlay, /if \(playHeldHere\(\{ tvOwnsFilm, failure: failureHoldsPlayback\(failure\), question: asking \}\)\) \{\s*videoRef\.current\?\.pause\(\);\s*return;/, 'onPlay arrête la lecture sous la question');
});

// Relecture d'ensemble de la partie A (I3) : l'éjection ignorait le clic fantôme du toucher qui ouvre le lecteur (menu
// de la télé assise, au `touchstart`), mais la question des sous-titres, affichée dès l'ouverture dans la même zone,
// n'avait pas cette garde : le clic fantôme répondait à la question (film lancé, choix enregistré) ou fermait le lecteur.
test('LECTEUR: un appui dans les 500 ms qui suivent l\'ouverture est le clic fantôme, il est ignoré', async () => {
  const { GHOST_CLICK_MS, ghostClick } = await import('../../src/utils/cast-on-open.ts');
  assert.equal(GHOST_CLICK_MS, 500);
  assert.equal(ghostClick(1000, 1000), true, 'à l\'ouverture même');
  assert.equal(ghostClick(1000, 1080), true, 'le clic synthétisé, 50 à 100 ms après le toucher');
  assert.equal(ghostClick(1000, 1499.9), true, 'juste avant la limite');
  assert.equal(ghostClick(1000, 1500), false, 'à 500 ms, un vrai appui');
  assert.equal(ghostClick(1000, 4200), false, 'un appui ordinaire');
});
test('LECTEUR: l\'éjection, les deux réponses de la question et son « Retour » passent par la même garde', () => {
  const player = readText(path.join(process.cwd(), 'src/components/player/VHSPlayer.tsx'));
  const guard = 'ghostClick(mountedAtRef.current, performance.now())';
  const eject = player.slice(player.indexOf('const handleEject = useCallback('), player.indexOf('const video = videoRef.current;', player.indexOf('const handleEject = useCallback(')));
  assert.ok(eject.includes(`if (${guard}) return;`), 'l\'éjection ignore le clic fantôme');
  const answer = player.slice(player.indexOf('const answerQuestion = (v: VersionChoice) => {'), player.indexOf('\n  };', player.indexOf('const answerQuestion')));
  assert.ok(answer.indexOf(`if (${guard}) return;`) >= 0 && answer.indexOf(`if (${guard}) return;`) < answer.indexOf('choose(v)'), 'la réponse : la garde avant le choix');
  const quit = player.slice(player.indexOf('const quitQuestion = () => {'), player.indexOf('\n  };', player.indexOf('const quitQuestion')));
  assert.match(quit, /if \(!ghostClick\(mountedAtRef\.current, performance\.now\(\)\)\) closePlayer\(\);/, '« Retour » : la garde, puis la fermeture');
  assert.ok(player.includes('onQuit={quitQuestion}') && player.includes('onAnswer={answerQuestion}'), 'le panneau reçoit les deux gestionnaires gardés');
  assert.ok(!/performance\.now\(\) - mountedAtRef\.current < 500/.test(player), 'plus de délai écrit à la main');
});
