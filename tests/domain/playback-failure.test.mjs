import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readText } from '../helpers/repo.mjs';
import { PLAYBACK_START_TIMEOUT_MS, startTimerArmed, signalsFor, shownFailure, failureHoldsPlayback, failurePanel, failureTrace } from '../../src/utils/playback-failure.ts';
import { VF, VOSTFR, VO, VF_ST } from '../../src/utils/version-choice.ts';

// « Cette version ne se lance pas » (spec 2026-11-19-versions-et-erreurs-de-lecture, § 5.1 et § 5.3) : le lecteur dit
// qu'une version ne démarre pas — erreur nette, ou rien ne vient en 15 secondes alors que la lecture est voulue —,
// propose l'autre version, et laisse une trace au serveur, sans adresse de fichier.

const ROOT = process.cwd();
const read = (rel) => readText(path.join(ROOT, rel));
const PLAYER = 'src/components/player/VHSPlayer.tsx';
const HOOK = 'src/components/player/usePlaybackFailure.ts';
const PANEL = 'src/components/player/PlaybackFailurePanel.tsx';
/** Longueur du lecteur au commit 66ab47c : il ne grossit plus (le nouveau code vit dans ses propres fichiers). */
const PLAYER_MAX_LINES = 1740;

const ODYSSEE = "2001 : L'Odyssée de l'espace";
/** VF, VO et sous-titres français : la location ordinaire. */
const FULL = { vf: true, vo: true, fr: true, en: false };
const ARMED = { wanted: true, hasMetadata: false, failed: false };

test('ÉCHEC LECTURE: le délai « rien ne vient » vaut 15 secondes', () => {
  assert.equal(PLAYBACK_START_TIMEOUT_MS, 15000);
});

test('ÉCHEC LECTURE: le délai court quand la lecture est voulue et que rien n\'est encore venu', () => {
  assert.equal(startTimerArmed(ARMED), true);
});

test('ÉCHEC LECTURE: pas de délai quand la lecture n\'est pas voulue (invite, Cast, BE KIND REWIND)', () => {
  assert.equal(startTimerArmed({ ...ARMED, wanted: false }), false);
});

test('ÉCHEC LECTURE: pas de délai une fois les métadonnées arrivées', () => {
  assert.equal(startTimerArmed({ ...ARMED, hasMetadata: true }), false);
});

test('ÉCHEC LECTURE: pas de délai quand un échec est déjà affiché', () => {
  assert.equal(startTimerArmed({ ...ARMED, failed: true }), false);
});

const NOTHING = { error: false, metadata: false, timeout: false };

test('ÉCHEC LECTURE: une erreur vue pendant que la lecture n\'est pas voulue attend, rien ne s\'affiche', () => {
  assert.equal(shownFailure(false, { element: 'a', ...NOTHING, error: true }), null);
  assert.equal(shownFailure(false, { element: 'a', ...NOTHING, timeout: true }), null);
  // La lecture redevient voulue : l'erreur gardée s'affiche aussitôt.
  assert.equal(shownFailure(true, { element: 'a', ...NOTHING, error: true }), 'error');
});

test('ÉCHEC LECTURE: lecture voulue, l\'erreur nette l\'emporte sur le délai, rien sans signal', () => {
  assert.equal(shownFailure(true, { element: 'a', ...NOTHING, error: true, timeout: true }), 'error');
  assert.equal(shownFailure(true, { element: 'a', ...NOTHING, timeout: true }), 'timeout');
  assert.equal(shownFailure(true, { element: 'a', ...NOTHING, metadata: true }), null);
});

// Vu à l'écran le 20/11 : l'erreur de l'élément en panne comptait encore au premier rendu du suivant (« Essayer en … »,
// « Réessayer ») — une trace de trop, pour une version qui jouait.
test('ÉCHEC LECTURE: les signaux d\'un élément <video> précédent ne comptent jamais pour le suivant', () => {
  const failed = { element: 'vf-x#0', ...NOTHING, error: true };
  assert.deepEqual(signalsFor(failed, 'vo-y#0'), { element: 'vo-y#0', ...NOTHING }, 'autre source');
  assert.deepEqual(signalsFor(failed, 'vf-x#1'), { element: 'vf-x#1', ...NOTHING }, '« Réessayer »');
  assert.equal(shownFailure(true, signalsFor(failed, 'vf-x#1')), null);
  assert.equal(signalsFor(failed, 'vf-x#0'), failed, 'le même élément garde ce qu\'il a signalé');
  assert.deepEqual(signalsFor(null, 'vf-x#0'), { element: 'vf-x#0', ...NOTHING }, 'rien encore');
});

// Relecture de la tâche 3 : après le délai, l'élément continuait de charger avec sa lecture automatique ; des métadonnées
// arrivées tard lançaient le film, avec le son, derrière « Cette version ne se lance pas ».
test('ÉCHEC LECTURE: un délai écoulé reste affiché même si les métadonnées arrivent ensuite', () => {
  assert.equal(shownFailure(true, { element: 'a', error: false, metadata: true, timeout: true }), 'timeout');
});

test('ÉCHEC LECTURE: tant que le panneau est affiché, la vidéo est retenue ; sans panneau, rien ne la retient', () => {
  assert.equal(failureHoldsPlayback('timeout'), true);
  assert.equal(failureHoldsPlayback('error'), true);
  assert.equal(failureHoldsPlayback(null), false);
});

test('ÉCHEC LECTURE: le panneau dit que cette version ne se lance pas, avec le titre et la version', () => {
  const panel = failurePanel({ title: ODYSSEE, version: VF, offer: FULL });
  assert.equal(panel.heading, 'Cette version ne se lance pas');
  assert.equal(panel.line, "2001 : L'Odyssée de l'espace · VF");
});

test('ÉCHEC LECTURE: la VF en panne propose la VOSTFR', () => {
  const panel = failurePanel({ title: ODYSSEE, version: VF, offer: FULL });
  assert.deepEqual(panel.tryOther, { label: 'Essayer en VOSTFR', version: VOSTFR });
});

test('ÉCHEC LECTURE: la VOSTFR en panne propose la VF', () => {
  const panel = failurePanel({ title: ODYSSEE, version: VOSTFR, offer: FULL });
  assert.equal(panel.line, "2001 : L'Odyssée de l'espace · VOSTFR");
  assert.deepEqual(panel.tryOther, { label: 'Essayer en VF', version: VF });
});

test('ÉCHEC LECTURE: un film à une seule piste audio n\'a rien d\'autre à proposer', () => {
  assert.equal(failurePanel({ title: ODYSSEE, version: VF, offer: { vf: true, vo: false, fr: true, en: true } }).tryOther, null);
  assert.equal(failurePanel({ title: ODYSSEE, version: VO, offer: { vf: false, vo: true, fr: false, en: false } }).tryOther, null);
});

test('ÉCHEC LECTURE: sans titre connu, la ligne dit la version seule', () => {
  assert.equal(failurePanel({ title: '', version: VF_ST, offer: FULL }).line, 'VF sous-titrée');
});

const TRACE = { filmId: 42, preview: false, version: VOSTFR, kind: 'timeout', currentTime: 0, savedPosition: 1234.5 };

test('ÉCHEC LECTURE: la trace dit le film, la version, l\'appareil et la nature de l\'échec', () => {
  const trace = failureTrace({ ...TRACE, currentTime: 61.25 });
  assert.deepEqual(trace, { filmId: 42, audio: 'vo', subtitle: 'fr', place: 'device', kind: 'timeout', position: 61.25 });
});

test('ÉCHEC LECTURE: rien de joué, la trace prend la position de la location', () => {
  assert.equal(failureTrace(TRACE).position, 1234.5);
  assert.equal(failureTrace({ ...TRACE, savedPosition: undefined }).position, null, 'position inconnue');
});

test('ÉCHEC LECTURE: jamais de trace pour une prévisualisation de /admin, ni sans film', () => {
  assert.equal(failureTrace({ ...TRACE, preview: true }), null);
  assert.equal(failureTrace({ ...TRACE, filmId: null }), null);
});

test('ÉCHEC LECTURE: la trace ne porte que ses six champs, jamais une adresse', () => {
  const trace = failureTrace({ ...TRACE, kind: 'error', url: 'https://storage/secret/vf.mp4', src: 'https://storage/secret/vf.mp4' });
  assert.deepEqual(Object.keys(trace).sort(), ['audio', 'filmId', 'kind', 'place', 'position', 'subtitle']);
  assert.ok(!JSON.stringify(trace).includes('secret'));
});

test('ÉCHEC LECTURE: le lecteur monte le crochet et le panneau, sans grossir', () => {
  const src = read(PLAYER);
  assert.ok(src.includes('usePlaybackFailure('), 'VHSPlayer.tsx appelle usePlaybackFailure');
  assert.ok(src.includes('<PlaybackFailurePanel'), 'VHSPlayer.tsx monte PlaybackFailurePanel');
  const lines = (src.match(/\n/g) ?? []).length;
  assert.ok(lines <= PLAYER_MAX_LINES, `VHSPlayer.tsx compte ${lines} lignes, plafond ${PLAYER_MAX_LINES}`);
});

test('ÉCHEC LECTURE: le panneau n\'a aucun bouton grisé', () => {
  assert.ok(!/disabled/i.test(read(PANEL)), 'PlaybackFailurePanel.tsx contient disabled');
});

test('ÉCHEC LECTURE: l\'erreur d\'un <source> se capture sur <video>, les métadonnées arrêtent le délai', () => {
  const hook = read(HOOK);
  assert.match(hook, /addEventListener\('error', [^)]*, true\)/, "écouteur 'error' en phase de capture");
  assert.ok(hook.includes("'loadedmetadata'"), 'écouteur loadedmetadata');
});

// Vu à l'écran le 20/11 : sur téléphone, « Continuer sur ce téléphone » appelle play() sur une version en panne — plus
// en pause, durée NaN ; l'enregistrement des 10 s (garde `duration === 0`) écrivait position 0 et progression NaN, et
// « Essayer en … » repartait du début.
// Relecture de la tâche 3 : la fin du film restait écoutée sur l'élément détaché après « Réessayer » ou « Essayer en … » —
// ni 100 %, ni « BE KIND REWIND ». Tout écouteur posé sur la vidéo suit la key de l'élément.
test('ÉCHEC LECTURE: l\'enregistrement des 10 s n\'écrit rien sans durée connue, et la vidéo est suivie après remontage', () => {
  const src = read(PLAYER);
  const at = src.indexOf('// ===== Watch Progress Reporting (every 10s) =====');
  assert.ok(at > 0, 'boucle des 10 s introuvable');
  const loop = src.slice(at, src.indexOf('}, 10000);', at));
  assert.match(loop, /if \(!video \|\| !\(video\.duration > 0\) \|\| video\.paused\) return;/, 'durée NaN ou nulle : rien n\'est écrit');
  for (const event of ['ended', 'canplay']) {
    const listen = src.indexOf(`video.addEventListener('${event}'`);
    assert.ok(listen > 0, `écouteur ${event} introuvable`);
    const deps = src.slice(listen, src.indexOf('\n', src.indexOf('}, [', listen)));
    assert.match(deps, /\}, \[[^\]]*\bvideoKey\b[^\]]*\]\);/, `l'effet de '${event}' suit la key de l'élément <video>`);
  }
});

test('ÉCHEC LECTURE: le panneau retient la vidéo, aucun chargement tardif ne la lance derrière lui', () => {
  const hook = read(HOOK);
  assert.match(hook, /if \(failureHoldsPlayback\(failure\)\) videoRef\.current\?\.pause\(\);/, 'le crochet met la vidéo en pause dès que le panneau s\'affiche');
  const src = read(PLAYER);
  const onPlay = src.slice(src.indexOf('onPlay={() => {'), src.indexOf('onPause={() => {'));
  assert.match(onPlay, /if \(tvOwnsFilm \|\| failureHoldsPlayback\(failure\)\) \{\s*videoRef\.current\?\.pause\(\);\s*return;/, 'une lecture qui part sous le panneau est arrêtée');
});

test('ÉCHEC LECTURE: la place est faite, AirPlay vit dans useAirPlay', () => {
  const src = read(PLAYER);
  assert.ok(src.includes('useAirPlay(videoRef, isPlayerOpen'), 'VHSPlayer.tsx appelle useAirPlay');
  for (const gone of ['webkitplaybacktargetavailabilitychanged', 'setIsAirPlayAvailable', 'type AirPlayVideoElement =']) {
    assert.ok(!src.includes(gone), `VHSPlayer.tsx contient encore ${gone}`);
  }
  assert.ok(read('src/components/player/useAirPlay.ts').includes('webkitplaybacktargetavailabilitychanged'), 'le crochet suit la disponibilité');
});
