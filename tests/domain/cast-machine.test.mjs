import test from 'node:test';
import assert from 'node:assert/strict';
import {
  castReduce, castView, castOwnsFilm, initialCastState,
  CAST_CONNECT_TIMEOUT_MS, CAST_LOAD_TIMEOUT_MS, CAST_ACK_TIMEOUT_MS, CAST_STATUS_TIMEOUT_MS, CAST_REPORT_EVERY_MS,
} from '../../src/cast/cast-machine.ts';

// Machine à états du Cast (docs/superpowers/specs/2026-11-18-cast-refonte-design.md, § 5.2 et 5.2 bis).
// Chaque état et chaque événement passés au réducteur sont gelés en profondeur : une mutation lèverait une
// exception (module ESM = mode strict), ce qui vérifie au passage que la fonction est pure.

function freeze(value) {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const inner of Object.values(value)) freeze(inner);
  }
  return value;
}
function runFrom(start, events) {
  let state = freeze(start);
  const effects = [];
  for (const event of events) {
    const out = castReduce(state, freeze(event));
    state = freeze(out.state);
    effects.push(...out.effects);
  }
  return { state, effects };
}
const run = (events) => runFrom(initialCastState, events);
const step = (state, event) => castReduce(freeze(state), freeze(event));
const ofType = (effects, type) => effects.filter((e) => e.type === type);
const SERVER_EFFECTS = ['SERVER_OPEN', 'SERVER_REPORT', 'SERVER_CLOSE', 'READ_RENTAL', 'REMEMBER_FILM'];

const media = { url: 'https://s/vf.mp4', title: 'Get Out', startAt: 0, subtitles: [], activeSubtitleId: null };
const ready = { type: 'SDK_READY', hasSession: false, rememberedFilmId: null };
const ask = { type: 'REQUEST_CAST', filmId: 7, tracked: true, media };
const playing = (o = {}) => ({ type: 'MEDIA_STATUS', filmId: 7, playerState: 'PLAYING', idleReason: null, position: 10, duration: 600, volume: 0.3, ...o });
const started = { type: 'SESSION_STARTED', deviceName: 'Salon', resumed: false };

const starting = { type: 'SESSION_STARTING', deviceName: 'Salon' };
// Statut IDLE tel que le SDK l'envoie à la fin : durée et position déjà remises à zéro (D4).
const tvIdle = (idleReason, o = {}) => playing({ playerState: 'IDLE', idleReason, position: 0, duration: 0, ...o });
const media8 = { ...media, url: 'https://s/us.mp4', title: 'Us', startAt: 42 };
const ask8 = { type: 'REQUEST_CAST', filmId: 8, tracked: true, media: media8 };
const preview = { ...ask, tracked: false };
const toRemote = [ready, ask, started, playing()];
const toLost = [...toRemote, { type: 'STATUS_FAILED' }];
const toEnded = [ready, ask, started, playing({ position: 590 }), tvIdle('FINISHED')];
const PHASES = ['idle', 'choosing', 'connecting', 'loading', 'remote', 'ended', 'lost'];
const PATHS = {
  idle: [ready],
  choosing: [ready, ask],
  connecting: [ready, ask, starting],
  loading: [ready, ask, started],
  remote: toRemote,
  ended: toEnded,
  lost: toLost,
};
function reach(phase) {
  const { state } = run(PATHS[phase]);
  assert.equal(state.phase, phase, `chemin vers ${phase}`);
  return state;
}

// ---------------------------------------------------------------------------------------------------------
// Les cas du plan (un par défaut mesuré D1 à D7, plus les cas limites du § 5.2 bis)
// ---------------------------------------------------------------------------------------------------------

test('CAST MACHINE: le choix de l\'appareil n\'a aucun délai (D3)', () => {
  const { state, effects } = run([ready, ask]);
  assert.equal(state.phase, 'choosing');
  assert.deepEqual(effects.map(e => e.type), ['OPEN_PICKER']);          // aucun START_TIMER
});
test('CAST MACHINE: sélecteur refermé = retour silencieux (D7)', () => {
  const { state, effects } = run([ready, ask, { type: 'PICKER_CANCELLED' }]);
  assert.equal(state.phase, 'idle'); assert.equal(state.notice, null);
  assert.deepEqual(effects.map(e => e.type), ['OPEN_PICKER']);          // ni message, ni arrêt
});
test('CAST MACHINE: lancement complet et ouverture de la séance serveur', () => {
  const { state, effects } = run([ready, ask, { type: 'SESSION_STARTING', deviceName: 'Salon' }, started, playing()]);
  assert.equal(state.phase, 'remote'); assert.equal(state.volume, 0.3); assert.equal(state.paused, false);
  assert.ok(effects.some(e => e.type === 'SERVER_OPEN' && e.filmId === 7 && e.duration === 600));
});
test('CAST MACHINE: TV déjà connectée → chargement direct, sans sélecteur (D5, D7)', () => {
  const { state, effects } = run([{ ...ready, hasSession: true }, { type: 'NO_MEDIA' }, ask]);
  assert.equal(state.phase, 'loading'); assert.ok(!effects.some(e => e.type === 'OPEN_PICKER'));
  assert.deepEqual(effects.at(-1), { type: 'START_TIMER', timer: 'load', ms: CAST_LOAD_TIMEOUT_MS });
});
test('CAST MACHINE: demande répétée ignorée', () => {
  const { effects } = run([ready, ask, ask, ask]);
  assert.equal(effects.filter(e => e.type === 'OPEN_PICKER').length, 1);
  for (const phase of ['connecting', 'loading']) {
    const before = reach(phase);
    const { state, effects: more } = step(before, ask);
    assert.equal(state, before, `${phase} : état inchangé`); assert.deepEqual(more, []);
  }
});
test('CAST MACHINE: fin du film = FINISHED, même durée et position remises à zéro (D4)', () => {
  const { state, effects } = run([ready, ask, started, playing({ position: 590 }),
    playing({ playerState: 'IDLE', idleReason: 'FINISHED', position: 0, duration: 0 })]);
  assert.equal(state.phase, 'ended'); assert.equal(state.filmId, 7);
  assert.deepEqual(effects.at(-1), { type: 'SERVER_CLOSE', filmId: 7, position: null, finished: true });
});
test('CAST MACHINE: fin sans signal, dernière position à 97 %', () => {
  const { state, effects } = run([ready, ask, started, playing({ position: 582 }), { type: 'NO_MEDIA' }]);
  assert.equal(state.phase, 'ended');
  assert.deepEqual(effects.at(-1), { type: 'SERVER_CLOSE', filmId: 7, position: null, finished: true });
  assert.ok(!effects.some(e => e.type === 'READ_RENTAL'), 'la fin se décide sans attendre le serveur');
});
test('CAST MACHINE: arrêt venu d\'ailleurs = pause locale à la dernière position, jamais de lecture d\'office', () => {
  const { state, effects } = run([ready, ask, started, playing({ position: 300 }), playing({ playerState: 'IDLE', idleReason: 'CANCELLED', position: 0, duration: 0 })]);
  assert.equal(state.phase, 'idle'); assert.equal(state.notice.code, 'stopped_elsewhere');
  assert.deepEqual(state.resume, { filmId: 7, position: 300, play: false });
  assert.deepEqual(state.notice, { code: 'stopped_elsewhere', filmId: 7, deviceName: 'Salon' });
  assert.deepEqual(effects.slice(-2), [
    { type: 'SERVER_CLOSE', filmId: 7, position: 300, finished: false },
    { type: 'REMEMBER_FILM', filmId: null },
  ]);
});
test('CAST MACHINE: reprise après rechargement, la TV joue (D6)', () => {
  const { state, effects } = run([{ ...ready, hasSession: true }, playing({ position: 73 })]);
  assert.equal(state.phase, 'remote'); assert.equal(state.position, 73);
  assert.equal(effects[0].type, 'REQUEST_STATUS');
});
test('CAST MACHINE: retour après la fin, plus de séance, location à 100 % → terminé', () => {
  const { state } = run([{ ...ready, rememberedFilmId: 7 }, { type: 'RENTAL_STATE', filmId: 7, exists: true, watchProgress: 100 }]);
  assert.equal(state.phase, 'ended'); assert.equal(castOwnsFilm(state), 7);
});
test('CAST MACHINE: retour, plus de média, location à 40 % → repos, pause', () => {
  const { state, effects } = run([{ ...ready, hasSession: true, rememberedFilmId: 7 }, { type: 'NO_MEDIA' },
    { type: 'RENTAL_STATE', filmId: 7, exists: true, watchProgress: 40 }]);
  assert.equal(state.phase, 'idle'); assert.equal(state.notice.code, 'stopped_elsewhere');
  assert.equal(state.resume.filmId, 7); assert.equal(state.resume.play, false);
  assert.equal(castOwnsFilm(state), null);
  assert.deepEqual(ofType(effects, 'READ_RENTAL'), [{ type: 'READ_RENTAL', filmId: 7 }]);
  // Sans position : la nôtre est périmée, le serveur garde la dernière qu'il a notée.
  assert.deepEqual(ofType(effects, 'SERVER_CLOSE'), [{ type: 'SERVER_CLOSE', filmId: 7, position: null, finished: false }]);
  assert.deepEqual(ofType(effects, 'REMEMBER_FILM'), [{ type: 'REMEMBER_FILM', filmId: null }]);
});
test('CAST MACHINE: commande sans accusé puis statut muet → liaison perdue, séance serveur gardée (D1)', () => {
  const { state, effects } = run([ready, ask, started, playing(), { type: 'COMMAND', command: { kind: 'toggle' } }, { type: 'COMMAND_FAILED' }, { type: 'STATUS_FAILED' }]);
  assert.equal(state.phase, 'lost'); assert.ok(!effects.some(e => e.type === 'SERVER_CLOSE'));
});
test('CAST MACHINE: liaison perdue puis statut revenu → télécommande', () => {
  const { state, effects } = step(reach('lost'), playing({ position: 40, playerState: 'PAUSED' }));
  assert.equal(state.phase, 'remote'); assert.equal(state.position, 40); assert.equal(state.paused, true);
  assert.deepEqual(effects, [
    { type: 'SERVER_REPORT', filmId: 7, position: 40, duration: 600 },
    { type: 'REMEMBER_FILM', filmId: 7 },
  ]);
});
test('CAST MACHINE: « Continuer sur ce téléphone » depuis la liaison perdue clôt la séance serveur', () => {
  const { state, effects } = step(reach('lost'), { type: 'USER_TO_PHONE' });
  assert.equal(state.phase, 'idle'); assert.equal(state.stopping, true);
  assert.deepEqual(state.resume, { filmId: 7, position: 10, play: true });
  assert.deepEqual(effects, [
    { type: 'STOP_AND_END_SESSION' },
    { type: 'SERVER_CLOSE', filmId: 7, position: 10, finished: false },
    { type: 'REMEMBER_FILM', filmId: null },
  ]);
});
test('CAST MACHINE: statut après arrêt ignoré', () => {
  const { state } = run([ready, ask, started, playing(), { type: 'USER_STOP' }, playing({ position: 12 })]);
  assert.equal(state.phase, 'idle');
});
test('CAST MACHINE: média sans film → pas de télécommande', () => {
  const { state } = run([{ ...ready, hasSession: true }, playing({ filmId: null })]);
  assert.equal(state.phase, 'idle');
  for (const phase of ['loading', 'remote', 'lost']) {
    const before = reach(phase);
    for (const status of [playing({ filmId: null }), tvIdle('FINISHED', { filmId: null })]) {
      const out = step(before, status);
      assert.equal(out.state, before, `${phase} : média inconnu ignoré`); assert.deepEqual(out.effects, []);
    }
  }
});
test('CAST MACHINE: location disparue → la TV s\'arrête, message, pas de reprise', () => {
  const { state, effects } = step(reach('remote'), { type: 'RENTAL_GONE', filmId: 7 });
  assert.equal(state.phase, 'idle'); assert.equal(state.notice.code, 'rental_over'); assert.equal(state.resume, null);
  assert.ok(effects.some(e => e.type === 'STOP_AND_END_SESSION'));
  assert.equal(state.stopping, true); assert.equal(castOwnsFilm(state), null);
});
test('CAST MACHINE: prévisualisation (tracked faux) → aucun effet serveur', () => {
  const sequences = [
    [ready, preview, started, playing(), { type: 'TICK' }, { type: 'PAGE_HIDDEN' }, { type: 'NO_MEDIA' }],
    [ready, preview, started, playing(), { type: 'USER_STOP' }],
    [ready, preview, started, playing(), { type: 'STATUS_FAILED' }, { type: 'USER_TO_PHONE' }],
    [ready, preview, started, playing({ position: 590 }), tvIdle('FINISHED'), { type: 'USER_DISMISS' }],
    [ready, preview, started, playing(), tvIdle('ERROR')],
    [ready, preview, started, playing(), { type: 'SESSION_ENDED' }],
    [ready, preview, started, playing(), { type: 'RENTAL_GONE', filmId: 7 }],
    [ready, preview, started, playing(), ask8],
  ];
  for (const events of sequences) {
    const { effects } = run(events);
    assert.ok(effects.some(e => e.type === 'LOAD_MEDIA'), 'la séquence passe bien par la TV');
    const leaked = effects.filter(e => SERVER_EFFECTS.includes(e.type));
    assert.deepEqual(leaked, [], `aucun effet serveur après ${events.at(-1).type}`);
  }
});
test('CAST MACHINE: un autre film sur la TV', () => {
  const { state } = run([ready, ask, started, playing()]);
  assert.equal(castView(state, 7), 'remote'); assert.equal(castView(state, 8), 'other-on-tv'); assert.equal(castView(initialCastState, 8), 'local');
});
test('CAST MACHINE: aucun écran sans sortie', () => {
  const USER = [{ type: 'USER_CANCEL' }, { type: 'USER_STOP' }, { type: 'USER_TO_PHONE' }, { type: 'USER_RETRY' }, { type: 'USER_DISMISS' }];
  // Plusieurs chemins par phase : par le lancement, par la reprise après rechargement, par le serveur.
  const paths = {
    choosing: [[ready, ask], [...toEnded, { type: 'SESSION_ENDED' }, ask8]],
    connecting: [[ready, ask, starting]],
    loading: [[ready, ask, started], [{ ...ready, hasSession: true }, ask], [...toRemote, ask8], [...toLost, ask8]],
    remote: [toRemote, [{ ...ready, hasSession: true }, playing()], [...toLost, playing()]],
    ended: [toEnded, [...toRemote, playing({ position: 582 }), { type: 'NO_MEDIA' }],
      [{ ...ready, rememberedFilmId: 7 }, { type: 'RENTAL_STATE', filmId: 7, exists: true, watchProgress: 100 }]],
    lost: [toLost, [{ ...ready, hasSession: true, rememberedFilmId: 7 }, { type: 'STATUS_FAILED' }]],
  };
  assert.deepEqual(Object.keys(paths).sort(), PHASES.filter(p => p !== 'idle').sort(), 'toutes les phases hors repos');
  for (const [phase, list] of Object.entries(paths)) {
    for (const events of list) {
      const { state } = run(events);
      assert.equal(state.phase, phase, `chemin vers ${phase}`);
      const exits = USER.filter(e => step(state, e).state.phase === 'idle');
      assert.ok(exits.length > 0, `aucune sortie depuis ${phase} (${events.map(e => e.type).join(' → ')})`);
    }
  }
});
test('CAST MACHINE: réouverture du lecteur pendant un Cast → télécommande tout de suite (D2)', () => {
  // Plus d'auto-détection ni de délai de 6 s : la vue se lit dans l'état, sans attendre aucun événement.
  assert.equal(castView(reach('remote'), 7), 'remote');
  assert.equal(castView(reach('lost'), 7), 'lost');
  assert.equal(castView(reach('ended'), 7), 'ended');
});

// ---------------------------------------------------------------------------------------------------------
// La table des transitions, ligne par ligne
// ---------------------------------------------------------------------------------------------------------

test('CAST MACHINE TABLE: délais exportés, aucun pendant le choix', () => {
  assert.equal(CAST_CONNECT_TIMEOUT_MS, 20000); assert.equal(CAST_LOAD_TIMEOUT_MS, 20000);
  assert.equal(CAST_ACK_TIMEOUT_MS, 5000); assert.equal(CAST_STATUS_TIMEOUT_MS, 5000);
  assert.equal(CAST_REPORT_EVERY_MS, 10000);
});
test('CAST MACHINE TABLE: état initial', () => {
  assert.deepEqual(initialCastState, {
    phase: 'idle', available: null, connected: false, deviceName: null, filmId: null, tracked: true,
    position: 0, duration: 0, paused: false, volume: 1, busy: false, stopping: false, notice: null, resume: null, media: null,
  });
});
test('CAST MACHINE TABLE: SDK indisponible → repos depuis toutes les phases', () => {
  for (const phase of PHASES) {
    const { state, effects } = step(reach(phase), { type: 'SDK_UNAVAILABLE' });
    assert.equal(state.phase, 'idle', phase); assert.equal(state.available, false); assert.deepEqual(effects, []);
  }
  assert.equal(run([{ type: 'SDK_UNAVAILABLE' }]).state.available, false);
});
test('CAST MACHINE TABLE: SDK prêt — séance → statut ; film mémorisé sans séance → location', () => {
  let r = run([ready]);
  assert.equal(r.state.available, true); assert.equal(r.state.connected, false); assert.equal(r.state.filmId, null);
  assert.deepEqual(r.effects, []);
  r = run([{ ...ready, hasSession: true, rememberedFilmId: 7 }]);
  assert.equal(r.state.connected, true); assert.equal(r.state.filmId, 7);
  assert.deepEqual(r.effects, [{ type: 'REQUEST_STATUS' }]);
  r = run([{ ...ready, rememberedFilmId: 7 }]);
  assert.equal(r.state.connected, false); assert.equal(r.state.filmId, 7);
  assert.deepEqual(r.effects, [{ type: 'READ_RENTAL', filmId: 7 }]);
  // Hors repos, la ligne ne s'applique pas.
  const remote = reach('remote');
  assert.equal(step(remote, { ...ready, rememberedFilmId: 9 }).state, remote);
});
test('CAST MACHINE TABLE: au repos, plus de média → location du film mémorisé, sinon rien', () => {
  assert.deepEqual(run([{ ...ready, hasSession: true, rememberedFilmId: 7 }, { type: 'NO_MEDIA' }]).effects,
    [{ type: 'REQUEST_STATUS' }, { type: 'READ_RENTAL', filmId: 7 }]);
  assert.deepEqual(run([{ ...ready, hasSession: true }, { type: 'NO_MEDIA' }]).effects, [{ type: 'REQUEST_STATUS' }]);
});
test('CAST MACHINE TABLE: Cast indisponible → message, rien d\'autre (repos et terminé)', () => {
  const { state, effects } = run([{ type: 'SDK_UNAVAILABLE' }, ask]);
  assert.equal(state.phase, 'idle'); assert.deepEqual(effects, []);
  assert.deepEqual(state.notice, { code: 'unavailable', filmId: 7, deviceName: null });
  const ended = { ...reach('ended'), available: false };
  const out = step(ended, ask8);
  assert.equal(out.state.phase, 'ended'); assert.deepEqual(out.effects, []);
  assert.deepEqual(out.state.notice, { code: 'unavailable', filmId: 8, deviceName: null });
});
test('CAST MACHINE TABLE: une demande acceptée garde film, suivi et média, efface arrêt, message et reprise', () => {
  // Arrêt demandé, séance pas encore close (stopping vrai), reprise en attente : la nouvelle demande repart à neuf.
  const stopped = run([...toRemote, { type: 'USER_STOP' }]).state;
  assert.equal(stopped.stopping, true); assert.notEqual(stopped.resume, null);
  let { state } = step(stopped, ask8);
  assert.equal(state.phase, 'loading'); assert.equal(state.stopping, false); assert.equal(state.resume, null);
  assert.equal(state.filmId, 8); assert.equal(state.position, 42); assert.equal(state.duration, 0);
  // Message en cours (erreur de la TV) : effacé.
  ({ state } = run([...toRemote, tvIdle('ERROR'), ask]));
  assert.equal(state.phase, 'loading'); assert.equal(state.notice, null); assert.equal(state.resume, null);
  // Sélecteur : film, suivi et média gardés jusqu'au chargement.
  const r = run([ready, { ...ask8, tracked: false }, started]);
  assert.equal(r.state.tracked, false);
  assert.deepEqual(ofType(r.effects, 'LOAD_MEDIA'), [{ type: 'LOAD_MEDIA', filmId: 8, media: media8 }]);
});
test('CAST MACHINE TABLE: TV connectée — terminé ou autre film → chargement, l\'ancien film clos à sa position', () => {
  let r = step(reach('ended'), ask8);
  assert.equal(r.state.phase, 'loading'); assert.equal(r.state.filmId, 8);
  assert.ok(!r.effects.some(e => e.type === 'OPEN_PICKER' || e.type === 'SERVER_CLOSE'));
  assert.deepEqual(r.effects.slice(-2), [
    { type: 'LOAD_MEDIA', filmId: 8, media: media8 },
    { type: 'START_TIMER', timer: 'load', ms: CAST_LOAD_TIMEOUT_MS },
  ]);
  const remote = run([...toRemote, { type: 'POSITION', position: 250 }]).state;
  r = step(remote, ask8);
  assert.equal(r.state.phase, 'loading'); assert.equal(r.state.position, 42);
  assert.deepEqual(r.effects, [
    { type: 'SERVER_CLOSE', filmId: 7, position: 250, finished: false },
    { type: 'REMEMBER_FILM', filmId: null },
    { type: 'LOAD_MEDIA', filmId: 8, media: media8 },
    { type: 'START_TIMER', timer: 'load', ms: CAST_LOAD_TIMEOUT_MS },
  ]);
  // Le même film, déjà sur la TV : rien à faire.
  const same = step(remote, ask);
  assert.equal(same.state, remote); assert.deepEqual(same.effects, []);
});
test('CAST MACHINE TABLE: échec du sélecteur → message de connexion', () => {
  const { state, effects } = run([ready, ask, { type: 'PICKER_FAILED' }]);
  assert.equal(state.phase, 'idle'); assert.deepEqual(effects.map(e => e.type), ['OPEN_PICKER']);
  assert.deepEqual(state.notice, { code: 'connect_failed', filmId: 7, deviceName: null });
});
test('CAST MACHINE TABLE: appareil choisi → connexion, délai armé seulement maintenant', () => {
  const { state, effects } = step(reach('choosing'), starting);
  assert.equal(state.phase, 'connecting'); assert.equal(state.deviceName, 'Salon');
  assert.deepEqual(effects, [{ type: 'START_TIMER', timer: 'connect', ms: CAST_CONNECT_TIMEOUT_MS }]);
});
test('CAST MACHINE TABLE: séance ouverte → chargement du média gardé', () => {
  const { state, effects } = step(reach('connecting'), started);
  assert.equal(state.phase, 'loading'); assert.equal(state.connected, true);
  assert.deepEqual(effects, [
    { type: 'CLEAR_TIMER', timer: 'connect' },
    { type: 'LOAD_MEDIA', filmId: 7, media },
    { type: 'START_TIMER', timer: 'load', ms: CAST_LOAD_TIMEOUT_MS },
  ]);
});
test('CAST MACHINE TABLE: connexion trop longue → message ; délai périmé ignoré', () => {
  const { state, effects } = step(reach('connecting'), { type: 'TIMEOUT', timer: 'connect' });
  assert.equal(state.phase, 'idle'); assert.deepEqual(effects, []);
  assert.deepEqual(state.notice, { code: 'connect_failed', filmId: 7, deviceName: 'Salon' });
  const loading = reach('loading');
  assert.equal(step(loading, { type: 'TIMEOUT', timer: 'connect' }).state, loading);
  const remote = reach('remote');
  assert.equal(step(remote, { type: 'TIMEOUT', timer: 'load' }).state, remote);
});
test('CAST MACHINE TABLE: le film demandé joue → télécommande, séance serveur ouverte (même sans durée, D5)', () => {
  const { state, effects } = step(reach('loading'), playing({ playerState: 'BUFFERING', duration: 0 }));
  assert.equal(state.phase, 'remote'); assert.equal(state.paused, false); assert.equal(state.media, null);
  assert.deepEqual(effects, [
    { type: 'CLEAR_TIMER', timer: 'load' },
    { type: 'SERVER_OPEN', filmId: 7, position: 10, duration: null },
    { type: 'REMEMBER_FILM', filmId: 7 },
  ]);
});
test('CAST MACHINE TABLE: pendant le chargement, l\'ancien média qui parle encore est ignoré', () => {
  const loading = reach('loading');
  for (const status of [tvIdle('INTERRUPTED'), tvIdle('INTERRUPTED', { filmId: 6 }), playing({ filmId: 6 })]) {
    const out = step(loading, status);
    assert.equal(out.state, loading); assert.deepEqual(out.effects, []);
  }
});
test('CAST MACHINE TABLE: chargement raté ou trop long → message, séance gardée', () => {
  let r = step(reach('loading'), { type: 'LOAD_FAILED' });
  assert.equal(r.state.phase, 'idle'); assert.equal(r.state.connected, true);
  assert.deepEqual(r.state.notice, { code: 'load_failed', filmId: 7, deviceName: 'Salon' });
  assert.deepEqual(r.effects, [{ type: 'CLEAR_TIMER', timer: 'load' }]);
  r = step(reach('loading'), { type: 'TIMEOUT', timer: 'load' });
  assert.equal(r.state.phase, 'idle'); assert.equal(r.state.connected, true);
  assert.equal(r.state.notice.code, 'load_failed'); assert.deepEqual(r.effects, []);
});
test('CAST MACHINE TABLE: Annuler pendant le choix, la connexion ou le chargement', () => {
  const cancel = { type: 'USER_CANCEL' };
  const expected = {
    choosing: [],
    connecting: [{ type: 'CLEAR_TIMER', timer: 'connect' }],
    loading: [{ type: 'CLEAR_TIMER', timer: 'load' }, { type: 'STOP_AND_END_SESSION' }],
  };
  for (const [phase, effects] of Object.entries(expected)) {
    const out = step(reach(phase), cancel);
    assert.equal(out.state.phase, 'idle', phase); assert.equal(out.state.notice, null);
    assert.deepEqual(out.effects, effects, phase);
  }
});
test('CAST MACHINE TABLE: au repos, séance reprise → statut demandé', () => {
  const { state, effects } = run([ready, started]);
  assert.equal(state.phase, 'idle'); assert.equal(state.connected, true);
  assert.deepEqual(effects, [{ type: 'REQUEST_STATUS' }]);
});
test('CAST MACHINE TABLE: statut du film en cours → position, durée, pause, volume, accusé', () => {
  const busy = run([...toRemote, { type: 'COMMAND', command: { kind: 'toggle' } }]).state;
  assert.equal(busy.busy, true);
  const { state, effects } = step(busy, playing({ playerState: 'PAUSED', position: 42, volume: 0.6 }));
  assert.equal(state.phase, 'remote'); assert.equal(state.position, 42); assert.equal(state.paused, true);
  assert.equal(state.volume, 0.6); assert.equal(state.busy, false); assert.equal(state.duration, 600);
  assert.deepEqual(effects, []);
  // Une durée absente (0) n'efface pas la dernière connue : c'est elle qui juge la fin sans signal (D4).
  assert.equal(step(state, playing({ duration: 0 })).state.duration, 600);
  assert.equal(step(state, playing({ duration: 596.5 })).state.duration, 596.5);
});
test('CAST MACHINE TABLE: position estimée, seulement en télécommande', () => {
  assert.equal(step(reach('remote'), { type: 'POSITION', position: 123 }).state.position, 123);
  for (const phase of ['idle', 'loading', 'lost', 'ended']) {
    const before = reach(phase);
    assert.equal(step(before, { type: 'POSITION', position: 123 }).state, before, phase);
  }
});
test('CAST MACHINE TABLE: erreur de lecture sur la TV → message, pause à la dernière position', () => {
  const { state, effects } = step(run([...toRemote, playing({ position: 300 })]).state, tvIdle('ERROR'));
  assert.equal(state.phase, 'idle');
  assert.deepEqual(state.notice, { code: 'tv_error', filmId: 7, deviceName: 'Salon' });
  assert.deepEqual(state.resume, { filmId: 7, position: 300, play: false });
  assert.deepEqual(effects, [
    { type: 'SERVER_CLOSE', filmId: 7, position: 300, finished: false },
    { type: 'REMEMBER_FILM', filmId: null },
  ]);
});
test('CAST MACHINE TABLE: arrêt sans raison ou séance terminée ailleurs → même arrivée ; connexion perdue sur fin de séance', () => {
  const remote = run([...toRemote, playing({ position: 300 })]).state;
  for (const event of [tvIdle('INTERRUPTED'), tvIdle(null), { type: 'SESSION_ENDED' }]) {
    const { state, effects } = step(remote, event);
    assert.equal(state.phase, 'idle');
    assert.equal(state.notice.code, 'stopped_elsewhere');
    assert.deepEqual(state.resume, { filmId: 7, position: 300, play: false });
    assert.equal(state.connected, event.type !== 'SESSION_ENDED');
    assert.deepEqual(effects, [
      { type: 'SERVER_CLOSE', filmId: 7, position: 300, finished: false },
      { type: 'REMEMBER_FILM', filmId: null },
    ]);
  }
});
test('CAST MACHINE TABLE: plus de média avant 95 % → on relit la location', () => {
  const remote = reach('remote');
  const { state, effects } = step(remote, { type: 'NO_MEDIA' });
  assert.equal(state, remote); assert.deepEqual(effects, [{ type: 'READ_RENTAL', filmId: 7 }]);
});
test('CAST MACHINE TABLE: location relue en télécommande — vue, arrêtée, ou disparue', () => {
  const remote = reach('remote');
  let r = step(remote, { type: 'RENTAL_STATE', filmId: 7, exists: true, watchProgress: 100 });
  assert.equal(r.state.phase, 'ended'); assert.equal(r.state.filmId, 7); assert.deepEqual(r.effects, []);
  r = step(remote, { type: 'RENTAL_STATE', filmId: 7, exists: true, watchProgress: 40 });
  assert.equal(r.state.phase, 'idle'); assert.equal(r.state.notice.code, 'stopped_elsewhere');
  assert.deepEqual(r.state.resume, { filmId: 7, position: 10, play: false });
  assert.deepEqual(r.effects, [
    { type: 'SERVER_CLOSE', filmId: 7, position: null, finished: false },
    { type: 'REMEMBER_FILM', filmId: null },
  ]);
  r = step(remote, { type: 'RENTAL_STATE', filmId: 7, exists: false, watchProgress: 0 });
  assert.equal(r.state.phase, 'idle'); assert.equal(r.state.notice.code, 'rental_over'); assert.equal(r.state.resume, null);
  assert.ok(r.effects.some(e => e.type === 'STOP_AND_END_SESSION'));
  // La location d'un autre film ne concerne pas la TV.
  const other = step(remote, { type: 'RENTAL_STATE', filmId: 8, exists: false, watchProgress: 0 });
  assert.equal(other.state, remote); assert.deepEqual(other.effects, []);
});
test('CAST MACHINE TABLE: location relue en liaison perdue', () => {
  const lost = reach('lost');
  assert.equal(step(lost, { type: 'RENTAL_STATE', filmId: 7, exists: true, watchProgress: 100 }).state.phase, 'ended');
  const r = step(lost, { type: 'RENTAL_STATE', filmId: 7, exists: true, watchProgress: 12 });
  assert.equal(r.state.phase, 'idle'); assert.equal(r.state.resume.play, false);
  assert.deepEqual(ofType(r.effects, 'SERVER_CLOSE'), [{ type: 'SERVER_CLOSE', filmId: 7, position: null, finished: false }]);
});
test('CAST MACHINE TABLE: une commande à la fois, avec accusé', () => {
  const remote = reach('remote');
  const seek = { kind: 'seekBy', seconds: 15 };
  const sent = step(remote, { type: 'COMMAND', command: seek });
  assert.equal(sent.state.busy, true);
  assert.deepEqual(sent.effects, [{ type: 'SEND_COMMAND', command: seek, position: 10, paused: false }]);
  const again = step(sent.state, { type: 'COMMAND', command: { kind: 'toggle' } });
  assert.equal(again.state, sent.state); assert.deepEqual(again.effects, []);
  let r = step(sent.state, { type: 'COMMAND_DONE' });
  assert.equal(r.state.busy, false); assert.deepEqual(r.effects, []);
  r = step(sent.state, { type: 'COMMAND_FAILED' });
  assert.equal(r.state.busy, false); assert.deepEqual(r.effects, [{ type: 'REQUEST_STATUS' }]);
  const lost = reach('lost');
  assert.equal(step(lost, { type: 'COMMAND', command: seek }).state, lost);
});
test('CAST MACHINE TABLE: liaison muette → perdue, séance serveur gardée', () => {
  const { state, effects } = step(reach('remote'), { type: 'STATUS_FAILED' });
  assert.equal(state.phase, 'lost'); assert.deepEqual(effects, []);
});
test('CAST MACHINE TABLE: surveillance en télécommande — cadence, arrière-plan, retour', () => {
  const remote = reach('remote');
  const report = { type: 'SERVER_REPORT', filmId: 7, position: 10, duration: 600 };
  assert.deepEqual(step(remote, { type: 'TICK' }).effects, [{ type: 'REQUEST_STATUS' }, report]);
  assert.deepEqual(step(remote, { type: 'PAGE_HIDDEN' }).effects, [report]);
  assert.deepEqual(step(remote, { type: 'PAGE_VISIBLE' }).effects, [{ type: 'REQUEST_STATUS' }]);
  assert.deepEqual(step(reach('lost'), { type: 'PAGE_VISIBLE' }).effects, [{ type: 'REQUEST_STATUS' }]);
  for (const phase of ['idle', 'loading', 'ended']) {
    for (const type of ['TICK', 'PAGE_HIDDEN', 'PAGE_VISIBLE', 'USER_RETRY']) {
      assert.deepEqual(step(reach(phase), { type }).effects, [], `${phase} ${type}`);
    }
  }
});
test('CAST MACHINE TABLE: liaison perdue — on redemande sans rapporter de position', () => {
  const lost = reach('lost');
  for (const type of ['TICK', 'USER_RETRY']) {
    const { state, effects } = step(lost, { type });
    assert.equal(state.phase, 'lost'); assert.deepEqual(effects, [{ type: 'REQUEST_STATUS' }]);
  }
  assert.deepEqual(step(lost, { type: 'NO_MEDIA' }).effects, [{ type: 'READ_RENTAL', filmId: 7 }]);
  assert.equal(step(lost, { type: 'NO_MEDIA' }).state.phase, 'lost');
});
test('CAST MACHINE TABLE: liaison perdue puis fin de séance → comme depuis la télécommande', () => {
  const { state, effects } = step(reach('lost'), { type: 'SESSION_ENDED' });
  assert.equal(state.phase, 'idle'); assert.equal(state.connected, false);
  assert.equal(state.notice.code, 'stopped_elsewhere'); assert.deepEqual(state.resume, { filmId: 7, position: 10, play: false });
  assert.deepEqual(effects, [
    { type: 'SERVER_CLOSE', filmId: 7, position: 10, finished: false },
    { type: 'REMEMBER_FILM', filmId: null },
  ]);
});
test('CAST MACHINE TABLE: « Arrêter » arrête la TV, termine la séance, pause locale', () => {
  for (const phase of ['remote', 'lost']) {
    const { state, effects } = step(reach(phase), { type: 'USER_STOP' });
    assert.equal(state.phase, 'idle'); assert.equal(state.stopping, true); assert.equal(state.notice, null);
    assert.deepEqual(state.resume, { filmId: 7, position: 10, play: false });
    assert.deepEqual(effects, [
      { type: 'STOP_AND_END_SESSION' },
      { type: 'SERVER_CLOSE', filmId: 7, position: 10, finished: false },
      { type: 'REMEMBER_FILM', filmId: null },
    ]);
  }
});
test('CAST MACHINE TABLE: location disparue pendant le chargement ou la liaison perdue', () => {
  const gone = { type: 'RENTAL_GONE', filmId: 7 };
  let r = step(reach('loading'), gone);
  assert.equal(r.state.phase, 'idle'); assert.equal(r.state.stopping, true); assert.equal(r.state.notice.code, 'rental_over');
  assert.deepEqual(r.effects, [
    { type: 'CLEAR_TIMER', timer: 'load' },
    { type: 'STOP_AND_END_SESSION' },
    { type: 'SERVER_CLOSE', filmId: 7, position: null, finished: false },
    { type: 'REMEMBER_FILM', filmId: null },
  ]);
  r = step(reach('lost'), gone);
  assert.equal(r.state.phase, 'idle'); assert.equal(r.state.notice.code, 'rental_over'); assert.equal(r.state.resume, null);
  const remote = reach('remote');
  assert.equal(step(remote, { type: 'RENTAL_GONE', filmId: 8 }).state, remote);
});
test('CAST MACHINE TABLE: fin de séance ailleurs → connexion perdue, arrêt soldé, phase gardée', () => {
  const stopped = run([...toRemote, { type: 'USER_STOP' }]).state;
  let r = step(stopped, { type: 'SESSION_ENDED' });
  assert.equal(r.state.phase, 'idle'); assert.equal(r.state.connected, false); assert.equal(r.state.stopping, false);
  assert.deepEqual(r.effects, []);
  for (const phase of ['choosing', 'connecting', 'loading', 'ended']) {
    r = step(reach(phase), { type: 'SESSION_ENDED' });
    assert.equal(r.state.phase, phase); assert.equal(r.state.connected, false); assert.deepEqual(r.effects, []);
  }
});
test('CAST MACHINE TABLE: « Fermer » — film terminé oublié ; ailleurs, message effacé', () => {
  let r = step(reach('ended'), { type: 'USER_DISMISS' });
  assert.equal(r.state.phase, 'idle'); assert.equal(r.state.filmId, null);
  assert.deepEqual(r.effects, [{ type: 'REMEMBER_FILM', filmId: null }]);
  const failed = run([ready, ask, { type: 'PICKER_FAILED' }]).state;
  r = step(failed, { type: 'USER_DISMISS' });
  assert.equal(r.state.phase, 'idle'); assert.equal(r.state.notice, null); assert.deepEqual(r.effects, []);
});
test('CAST MACHINE TABLE: reprise locale consommée', () => {
  const stopped = run([...toRemote, tvIdle('ERROR')]).state;
  assert.notEqual(stopped.resume, null);
  const { state, effects } = step(stopped, { type: 'RESUME_TAKEN' });
  assert.equal(state.resume, null); assert.equal(state.phase, 'idle'); assert.deepEqual(effects, []);
});
test('CAST MACHINE TABLE: fin du film — le film reste mémorisé, durée gardée', () => {
  const { state, effects } = run(toEnded);
  assert.equal(state.position, 0); assert.equal(state.duration, 600);
  assert.ok(!effects.some(e => e.type === 'REMEMBER_FILM' && e.filmId === null), 'pas d\'oubli avant « Fermer »');
  assert.equal(castOwnsFilm(state), 7);
});
test('CAST MACHINE TABLE: vue du lecteur et puce, phase par phase', () => {
  const owns = { idle: null, choosing: null, connecting: null, loading: null, remote: 7, ended: 7, lost: 7 };
  for (const phase of PHASES) {
    const state = reach(phase);
    assert.equal(castView(state, 7), phase === 'idle' ? 'local' : phase, phase);
    assert.equal(castOwnsFilm(state), owns[phase], phase);
  }
});

// ---------------------------------------------------------------------------------------------------------
// Transitions que la table ne fixe pas, choisies pour ne jamais laisser le visiteur sans issue ni lancer la
// lecture locale d'office (voir le rapport de la tâche 2, « Transitions ajoutées »)
// ---------------------------------------------------------------------------------------------------------

test('CAST MACHINE AJOUT: échec de la séance pendant la connexion → message tout de suite, sans attendre 20 s', () => {
  const { state, effects } = step(reach('connecting'), { type: 'PICKER_FAILED' });
  assert.equal(state.phase, 'idle'); assert.equal(state.notice.code, 'connect_failed');
  assert.deepEqual(effects, [{ type: 'CLEAR_TIMER', timer: 'connect' }]);
});
test('CAST MACHINE AJOUT: Annuler le chargement → les statuts tardifs du film ne rouvrent pas la télécommande', () => {
  const cancelled = run([ready, ask, started, { type: 'USER_CANCEL' }]).state;
  assert.equal(cancelled.stopping, true);
  assert.equal(step(cancelled, playing()).state.phase, 'idle');
  const ended = run([ready, ask, started, { type: 'USER_CANCEL' }, { type: 'SESSION_ENDED' }]).state;
  assert.equal(ended.stopping, false);
});
test('CAST MACHINE AJOUT: un autre film prend la TV → le nôtre est arrêté, le nouveau suivi', () => {
  for (const phase of ['remote', 'lost']) {
    const before = runFrom(reach(phase), phase === 'remote' ? [{ type: 'POSITION', position: 300 }] : []).state;
    const at = phase === 'remote' ? 300 : 10;
    const { state, effects } = step(before, playing({ filmId: 9, position: 5, duration: 900 }));
    assert.equal(state.phase, 'remote', phase); assert.equal(state.filmId, 9);
    assert.equal(state.position, 5); assert.equal(state.duration, 900);
    assert.deepEqual(state.notice, { code: 'stopped_elsewhere', filmId: 7, deviceName: 'Salon' });
    assert.deepEqual(state.resume, { filmId: 7, position: at, play: false });
    assert.deepEqual(effects, [
      { type: 'SERVER_CLOSE', filmId: 7, position: at, finished: false },
      { type: 'REMEMBER_FILM', filmId: null },
      { type: 'SERVER_REPORT', filmId: 9, position: 5, duration: 900 },
      { type: 'REMEMBER_FILM', filmId: 9 },
    ]);
    assert.equal(castView(state, 7), 'other-on-tv');
  }
  // Le statut IDLE d'un autre film ne dit rien du nôtre.
  const remote = reach('remote');
  assert.equal(step(remote, tvIdle('FINISHED', { filmId: 9 })).state, remote);
});
test('CAST MACHINE AJOUT: liaison perdue puis la TV répond IDLE → comme depuis la télécommande', () => {
  const lost = reach('lost');
  let r = step(lost, tvIdle('FINISHED'));
  assert.equal(r.state.phase, 'ended');
  assert.deepEqual(r.effects, [{ type: 'SERVER_CLOSE', filmId: 7, position: null, finished: true }]);
  r = step(lost, tvIdle('ERROR'));
  assert.equal(r.state.phase, 'idle'); assert.equal(r.state.notice.code, 'tv_error');
  r = step(lost, tvIdle('CANCELLED'));
  assert.equal(r.state.phase, 'idle'); assert.equal(r.state.notice.code, 'stopped_elsewhere');
  assert.deepEqual(r.state.resume, { filmId: 7, position: 10, play: false });
});
test('CAST MACHINE AJOUT: prévisualisation sans média → la machine tranche seule, sans location à relire', () => {
  let r = run([ready, preview, started, playing({ position: 300 }), { type: 'NO_MEDIA' }]);
  assert.equal(r.state.phase, 'idle'); assert.equal(r.state.notice.code, 'stopped_elsewhere');
  assert.deepEqual(r.state.resume, { filmId: 7, position: 300, play: false });
  r = run([ready, preview, started, playing({ position: 582 }), { type: 'NO_MEDIA' }]);
  assert.equal(r.state.phase, 'ended');
  r = run([ready, preview, started, playing({ position: 300 }), { type: 'STATUS_FAILED' }, { type: 'NO_MEDIA' }]);
  assert.equal(r.state.phase, 'idle');
  assert.ok(!r.effects.some(e => SERVER_EFFECTS.includes(e.type)));
});
test('CAST MACHINE AJOUT: rechargement, film mémorisé, la TV ne répond pas → liaison perdue, pas de lecture locale', () => {
  const { state, effects } = run([{ ...ready, hasSession: true, rememberedFilmId: 7 }, { type: 'STATUS_FAILED' }]);
  assert.equal(state.phase, 'lost'); assert.equal(castView(state, 7), 'lost'); assert.equal(castOwnsFilm(state), 7);
  assert.deepEqual(effects, [{ type: 'REQUEST_STATUS' }]);
  const nothing = run([{ ...ready, hasSession: true }, { type: 'STATUS_FAILED' }]).state;
  assert.equal(nothing.phase, 'idle');
});
test('CAST MACHINE AJOUT: séance retrouvée au repos → nom de l\'appareil gardé, ancien arrêt soldé', () => {
  // Arrêt demandé, mais la fin de séance n'est jamais arrivée : une nouvelle séance ne doit pas rester sourde.
  const stopped = run([...toRemote, { type: 'USER_STOP' }]).state;
  const { state } = step(stopped, { type: 'SESSION_STARTED', deviceName: 'Chambre', resumed: true });
  assert.equal(state.stopping, false); assert.equal(state.deviceName, 'Chambre'); assert.equal(state.connected, true);
  assert.equal(step(state, playing({ filmId: 9 })).state.phase, 'remote');
});
test('CAST MACHINE AJOUT: séance revenue hors repos → connexion à jour, pas de sélecteur parasite (D7)', () => {
  const back = run([...toEnded, { type: 'SESSION_ENDED' }, { ...started, resumed: true }]);
  assert.equal(back.state.phase, 'ended'); assert.equal(back.state.connected, true);
  const r = step(back.state, ask8);
  assert.equal(r.state.phase, 'loading'); assert.ok(!r.effects.some(e => e.type === 'OPEN_PICKER'));
});
test('CAST MACHINE AJOUT: autre film demandé depuis la liaison perdue → chargement, ancien film clos', () => {
  const lost = reach('lost');
  const r = step(lost, ask8);
  assert.equal(r.state.phase, 'loading'); assert.equal(r.state.filmId, 8);
  assert.deepEqual(r.effects.slice(0, 2), [
    { type: 'SERVER_CLOSE', filmId: 7, position: 10, finished: false },
    { type: 'REMEMBER_FILM', filmId: null },
  ]);
  const same = step(lost, ask);
  assert.equal(same.state, lost); assert.deepEqual(same.effects, []);
});
test('CAST MACHINE AJOUT: quitter « Film terminé » pour un autre film l\'oublie', () => {
  const r = step({ ...reach('ended'), connected: false }, ask8);
  assert.equal(r.state.phase, 'choosing');
  assert.deepEqual(r.effects, [{ type: 'REMEMBER_FILM', filmId: null }, { type: 'OPEN_PICKER' }]);
});
test('CAST MACHINE AJOUT: location disparue après la fin → puce retirée, la TV laissée à son accueil', () => {
  const { state, effects } = step(reach('ended'), { type: 'RENTAL_GONE', filmId: 7 });
  assert.equal(state.phase, 'idle'); assert.equal(castOwnsFilm(state), null);
  assert.deepEqual(effects, [{ type: 'REMEMBER_FILM', filmId: null }]);
});
test('CAST MACHINE AJOUT: la TV finit par jouer le film → son message d\'échec et sa reprise locale tombent', () => {
  // Chargement déclaré trop long, puis la TV démarre quand même : la télécommande, sans le message d'échec.
  let r = run([ready, ask, started, { type: 'TIMEOUT', timer: 'load' }, playing()]);
  assert.equal(r.state.phase, 'remote'); assert.equal(r.state.notice, null);
  assert.ok(r.effects.some(e => e.type === 'SERVER_REPORT' && e.filmId === 7));
  // « Sur ce téléphone », puis le film relancé sur la TV avant que le lecteur ait repris : pas sur les deux écrans.
  r = run([...toRemote, { type: 'USER_TO_PHONE' }, { type: 'SESSION_ENDED' }, started, playing()]);
  assert.equal(r.state.phase, 'remote'); assert.equal(r.state.resume, null);
  // Une reprise d'un autre film, elle, reste.
  r = run([...toRemote, { type: 'USER_TO_PHONE' }, { type: 'SESSION_ENDED' }, started, playing({ filmId: 9 })]);
  assert.deepEqual(r.state.resume, { filmId: 7, position: 10, play: true });
});
test('CAST MACHINE AJOUT: un film jamais parti est oublié → une séance retrouvée n\'annonce pas d\'arrêt', () => {
  for (const abandon of [[{ type: 'PICKER_CANCELLED' }], [{ type: 'PICKER_FAILED' }], [starting, { type: 'TIMEOUT', timer: 'connect' }], [started, { type: 'LOAD_FAILED' }]]) {
    const { state, effects } = run([ready, ask, ...abandon, started, { type: 'NO_MEDIA' }]);
    assert.equal(state.phase, 'idle');
    assert.ok(!effects.some(e => e.type === 'READ_RENTAL'), abandon.map(e => e.type).join(' → '));
    assert.equal(state.filmId, null);
  }
});
test('CAST MACHINE AJOUT: vue d\'un autre film selon la phase', () => {
  const expected = { idle: 'local', choosing: 'local', connecting: 'other-on-tv', loading: 'other-on-tv', remote: 'other-on-tv', ended: 'local', lost: 'other-on-tv' };
  for (const phase of PHASES) {
    assert.equal(castView(reach(phase), 8), expected[phase], phase);
    assert.equal(castView(reach(phase), null), expected[phase], `${phase}, lecteur sans film`);
  }
});
