import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeCastSdk, MEDIA_NAMESPACE } from '../helpers/fake-cast-sdk.mjs';
import {
  castView, CAST_ACK_TIMEOUT_MS, CAST_LOAD_TIMEOUT_MS, CAST_REPORT_EVERY_MS, CAST_STATUS_TIMEOUT_MS,
} from '../../src/cast/cast-machine.ts';

// Le service Cast (src/cast/cast-service.ts) devant un faux SDK (tests/helpers/fake-cast-sdk.mjs) qui rejoue ce
// que fait le vrai sur le Pixel 9a (mesuré le 18/11/2026). Chaque cas part d'une page neuve
// (__resetCastForTests) ; les minuteurs sont ceux de node:test.

installFakeCastSdk();
const service = await import('../../src/cast/cast-service.ts');

const flush = () => new Promise((resolve) => setImmediate(resolve));
const getOut = { url: 'https://s/vf.mp4', title: 'Get Out', startAt: 0, subtitles: [], activeSubtitleId: null };
const ask = (filmId) => ({ type: 'REQUEST_CAST', filmId, tracked: true, media: getOut });

function fakePorts(remembered = null) {
  const ports = {
    calls: [],
    rental: { exists: true, watchProgress: 40, watchPosition: 120 },
    rememberedId: remembered,
    serverOpen: (...args) => record('serverOpen', args),
    serverReport: (...args) => record('serverReport', args),
    serverClose: (...args) => record('serverClose', args),
    readRental: async (filmId) => { ports.calls.push(['readRental', filmId]); return ports.rental; },
    remember: (filmId) => { ports.calls.push(['remember', filmId]); ports.rememberedId = filmId; },
    remembered: () => ports.rememberedId,
  };
  function record(name, args) {
    ports.calls.push([name, ...args]);
    return Promise.resolve();
  }
  return ports;
}
const named = (ports, name) => ports.calls.filter(([n]) => n === name).map(([, ...args]) => args);

/**
 * Page neuve, service démarré. `session` : la page est rechargée pendant un Cast (séance reprise, annoncée
 * quelques ms après l'initialisation). `settle` : le délai de reprise s'écoule, SDK_READY part.
 */
async function start(t, { sdk = true, session = false, remembered = null, settle = true } = {}) {
  service.__resetCastForTests();
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const fake = installFakeCastSdk({ sdk });
  const tv = session ? fake.makeSession('Salon') : null;
  if (tv) fake.context.resume(tv);
  const ports = fakePorts(remembered);
  service.initCast(ports);
  await flush();                                       // le chargeur rend la main : initialisation du SDK
  if (tv) fake.context.emitSession('SESSION_RESUMED', tv);
  if (sdk && settle) t.mock.timers.tick(service.CAST_RESUME_SETTLE_MS);
  return { fake, tv, ports, state: () => service.getCastState() };
}

/** Page rechargée pendant que la TV joue `filmId`, le SDK annonce son objet média : télécommande. */
async function remoteOn(t, filmId = 7, mediaOptions = {}) {
  const ctx = await start(t, { session: true });
  const playing = ctx.fake.makeMedia({ filmId, ...mediaOptions });
  ctx.tv.announceMedia(playing);
  await flush();
  assert.equal(ctx.state().phase, 'remote', 'préalable : télécommande');
  return { ...ctx, playing };
}

test('CAST SERVICE (a): deux démarrages, une seule initialisation du SDK', async (t) => {
  const { fake, state } = await start(t);
  service.initCast(fakePorts());
  await flush();
  assert.equal(fake.calls.setOptions.length, 1);
  assert.equal(fake.calls.setOptions[0].autoJoinPolicy, 'origin_scoped');
  assert.equal(state().available, true);
  assert.equal(state().connected, false);
});

test('CAST SERVICE (b): rechargée pendant que la TV joue, la réponse brute à GET_STATUS ramène le film', async (t) => {
  const { fake, tv, ports, state } = await start(t, { session: true, remembered: 7 });
  assert.equal(fake.getStatusCount(), 1, 'séance reprise → GET_STATUS');
  assert.equal(fake.calls.sendMessage[0].namespace, MEDIA_NAMESPACE);
  fake.player.volumeLevel = 0.28;
  // F2 : le SDK n'a pas encore d'objet média ; seule la réponse brute dit ce que joue la TV.
  assert.equal(tv.getMediaSession(), null);
  tv.reply({ type: 'MEDIA_STATUS', requestId: 1, status: [{
    mediaSessionId: 4, playerState: 'PLAYING', currentTime: 1234.5, media: { duration: 5400, customData: { filmId: 7 } },
  }] });
  await flush();
  const s = state();
  assert.equal(s.phase, 'remote');
  assert.equal(s.filmId, 7);
  assert.equal(s.position, 1234.5);
  assert.equal(s.duration, 5400);
  assert.equal(s.volume, 0.28);
  assert.equal(s.connected, true);
  assert.equal(castView(s, 7), 'remote', 'le lecteur rouvert montre la télécommande, pas le film en local (D6)');
  assert.deepEqual(named(ports, 'serverReport'), [[7, 1234.5, 5400]]);
  assert.deepEqual(named(ports, 'remember'), [[7]]);
  t.mock.timers.tick(CAST_STATUS_TIMEOUT_MS);
  assert.equal(state().phase, 'remote', 'la réponse a levé l\'échéance du statut');
});

test('CAST SERVICE (c): rechargée, TV revenue à l\'accueil : la liste vide fait relire la location', async (t) => {
  const { tv, ports, state } = await start(t, { session: true, remembered: 7 });
  tv.reply({ type: 'MEDIA_STATUS', requestId: 1, status: [] });
  await flush();
  assert.deepEqual(named(ports, 'readRental'), [[7]]);
  const s = state();
  assert.equal(s.phase, 'idle');
  assert.equal(s.notice?.code, 'stopped_elsewhere');
  assert.equal(s.notice?.filmId, 7);
  assert.deepEqual(s.resume, { filmId: 7, position: 120, play: false }, 'reprise locale en pause, à la position du serveur');
});

test('CAST SERVICE (d): GET_STATUS sans réponse → liaison perdue à l\'échéance, pas avant', async (t) => {
  const { fake, state } = await remoteOn(t);
  const before = fake.getStatusCount();
  t.mock.timers.tick(CAST_REPORT_EVERY_MS);            // TICK : demande de statut, la TV se tait
  assert.equal(fake.getStatusCount(), before + 1);
  t.mock.timers.tick(CAST_STATUS_TIMEOUT_MS - 1);
  assert.equal(state().phase, 'remote');
  t.mock.timers.tick(1);
  assert.equal(state().phase, 'lost');
});

test('CAST SERVICE (e): liaison morte, l\'envoi lève dans le SDK → rien ne remonte ; sans reprise de la séance, liaison perdue à l\'échéance', async (t) => {
  const { fake, tv, state } = await remoteOn(t);
  tv.sendMessageImpl = () => { throw new DOMException('PresentationConnection is closed', 'InvalidStateError'); };
  assert.doesNotThrow(() => service.sendCast({ type: 'TICK' }));
  assert.deepEqual(fake.calls.requestSessionById, [tv.getSessionId()], 'la séance est redemandée par son identifiant');
  assert.equal(state().phase, 'remote', 'pas encore perdue : la reprise est en route');
  t.mock.timers.tick(CAST_STATUS_TIMEOUT_MS);
  assert.equal(state().phase, 'lost');
  // Perdue, chaque TICK retente la reprise : la liaison peut revenir toute seule.
  t.mock.timers.tick(CAST_REPORT_EVERY_MS);
  assert.equal(fake.calls.requestSessionById.length, 2);
});

test('CAST SERVICE (f): film A remplacé par B, puis l\'ancien objet A parle et meurt → B continue', async (t) => {
  const { fake, tv, ports, state, playing: filmA } = await remoteOn(t, 7);
  tv.loadMediaImpl = () => {
    tv.mediaSession = fake.makeMedia({ filmId: 8, currentTime: 0 });
    return Promise.resolve();
  };
  service.sendCast(ask(8));
  assert.equal(state().phase, 'loading');
  await flush();
  assert.equal(state().phase, 'remote');
  assert.equal(state().filmId, 8);
  assert.deepEqual(fake.calls.loadMedia[0].media.customData, { filmId: 8 });
  filmA.update({ playerState: 'PAUSED' });             // dernier statut de l'ancien objet
  filmA.update({}, false);                             // puis sa mort, sans IDLE
  await flush();
  const s = state();
  assert.equal(s.phase, 'remote');
  assert.equal(s.filmId, 8);
  assert.equal(s.paused, false);
  assert.ok(!named(ports, 'serverClose').some(([filmId]) => filmId === 8), 'aucune clôture pour B');
  assert.ok(!named(ports, 'readRental').some(([filmId]) => filmId === 8), 'aucune relecture de la location de B');
});

test('CAST SERVICE (g): le sélecteur s\'ouvre dans la pile de l\'appui ; refermé, retour au repos sans message', async (t) => {
  const { fake, state } = await start(t);
  let inTap = false;
  let openedInTap = null;
  fake.context.requestSessionImpl = () => {
    openedInTap = inTap;
    return Promise.reject('cancel');
  };
  inTap = true;
  service.sendCast(ask(7));
  inTap = false;
  assert.equal(openedInTap, true, 'requestSession appelé avant que sendCast ne rende la main');
  assert.equal(state().phase, 'choosing');
  await flush();
  assert.equal(state().phase, 'idle');
  assert.equal(state().notice, null, 'un geste du visiteur n\'est pas une panne');
});

test('CAST SERVICE (g): jamais le sélecteur quand une séance existe — le film part dessus', async (t) => {
  // Séance reprise, demande faite avant SDK_READY : la machine ne se sait pas encore connectée.
  const { fake, state } = await start(t, { session: true, settle: false });
  assert.equal(state().connected, false);
  service.sendCast(ask(7));
  assert.equal(fake.calls.requestSession, 0);
  assert.equal(state().phase, 'loading');
  assert.equal(fake.calls.loadMedia.length, 1);
});

test('CAST SERVICE (h): SDK absent pendant le choix → « Impossible de joindre… », puis Cast indisponible', async (t) => {
  const { fake, state } = await start(t, { sdk: false });
  service.sendCast(ask(7));
  assert.equal(state().phase, 'choosing');
  fake.scripts[0].onerror();                           // le script du SDK ne se charge pas
  await flush();
  const s = state();
  assert.equal(s.phase, 'idle');
  assert.deepEqual(s.notice, { code: 'connect_failed', filmId: 7, deviceName: null });
  assert.equal(s.available, false);
});

test('CAST SERVICE (i): fin du film lue sur l\'objet média, RemotePlayer remis à zéro → terminé', async (t) => {
  const { fake, ports, state, playing } = await remoteOn(t, 7, { duration: 596.5, currentTime: 590 });
  fake.player.duration = 0;                            // D4 : remis à zéro au même instant
  fake.player.currentTime = 0;
  playing.update({ playerState: 'IDLE', idleReason: 'FINISHED' }, false);
  await flush();
  assert.equal(state().phase, 'ended');
  assert.deepEqual(named(ports, 'serverClose'), [[7, null, true]]);
});

test('CAST SERVICE (j): appels serveur en file — la clôture attend la position, un rejet n\'arrête pas la file', async (t) => {
  const { fake, ports, state } = await remoteOn(t);
  let failReport = null;
  ports.serverReport = (...args) => {
    ports.calls.push(['serverReport', ...args]);
    return new Promise((_resolve, reject) => { failReport = reject; });
  };
  fake.setVisibility('hidden');                        // PAGE_HIDDEN : la position part avant le gel de Chrome
  service.sendCast({ type: 'USER_STOP' });             // « Arrêter »
  await flush();
  assert.equal(named(ports, 'serverReport').length, 2, 'à la reprise du suivi, puis à la mise en arrière-plan');
  assert.deepEqual(named(ports, 'serverClose'), [], 'la clôture attend la fin de l\'envoi de position');
  failReport(new Error('502'));
  await flush();
  assert.deepEqual(named(ports, 'serverClose'), [[7, 10, false]]);
  assert.deepEqual(fake.calls.endCurrentSession, [true], 'la TV revient à son accueil');
  assert.equal(state().phase, 'idle');
});

test('CAST SERVICE (k): commande sans accusé → COMMAND_FAILED à l\'échéance, puis demande de statut', async (t) => {
  const { fake, state, playing } = await remoteOn(t);
  playing.answer = 'silent';
  const before = fake.getStatusCount();
  service.sendCast({ type: 'COMMAND', command: { kind: 'toggle' } });
  assert.deepEqual(fake.calls.commands, ['pause']);
  assert.equal(state().busy, true);
  t.mock.timers.tick(CAST_ACK_TIMEOUT_MS - 1);
  assert.equal(state().busy, true);
  t.mock.timers.tick(1);
  assert.equal(state().busy, false);
  assert.equal(fake.getStatusCount(), before + 1, 'la TV est interrogée');
});

test('CAST SERVICE (l): fin de séance pendant le lancement → échec dit tout de suite, sans attendre 20 s', async (t) => {
  const { fake, tv, state } = await start(t, { session: true });
  tv.reply({ type: 'MEDIA_STATUS', requestId: 1, status: [] });   // TV à l'accueil
  tv.loadMediaImpl = () => new Promise(() => {});
  service.sendCast(ask(7));
  assert.equal(state().phase, 'loading');
  fake.context.emitSession('SESSION_ENDED');
  const s = state();
  assert.equal(s.phase, 'idle');
  assert.equal(s.notice?.code, 'load_failed');
  assert.equal(s.notice?.filmId, 7);
  t.mock.timers.tick(CAST_LOAD_TIMEOUT_MS);
  assert.equal(state(), s, 'plus rien ne se passe après');
});

test('CAST SERVICE: réponse sans `media` pour la séance média connue → son film, son nouvel état', async (t) => {
  const { tv, state, playing } = await remoteOn(t);
  service.sendCast({ type: 'TICK' });
  tv.reply({ type: 'MEDIA_STATUS', requestId: 2, status: [{ mediaSessionId: playing.mediaSessionId, playerState: 'PAUSED', currentTime: 300 }] });
  const s = state();
  assert.equal(s.filmId, 7);
  assert.equal(s.paused, true);
  assert.equal(s.position, 300);
});

test('CAST SERVICE: séance finie avant la reprise de son objet média → elle ne rouvre pas la télécommande', async (t) => {
  const { fake, tv, state } = await start(t, { session: true, remembered: 7 });
  tv.reply({ type: 'MEDIA_STATUS', requestId: 1, status: [{
    mediaSessionId: 4, playerState: 'PLAYING', currentTime: 50, media: { duration: 600, customData: { filmId: 7 } },
  }] });
  assert.equal(state().phase, 'remote');
  tv.mediaSession = fake.makeMedia({ filmId: 7, currentTime: 50 });   // l'objet que le SDK crée pour cette réponse…
  fake.context.emitSession('SESSION_ENDED');                         // …mais la séance finit avant qu'on le reprenne
  assert.equal(state().phase, 'idle');
  t.mock.timers.tick(1);
  assert.equal(state().phase, 'idle', 'l\'objet média d\'une séance finie ne parle plus');
});
test('CAST SERVICE: le volume du récepteur change → la télécommande le suit', async (t) => {
  const { fake, state } = await remoteOn(t);
  fake.controller.setVolume(0.4);
  assert.equal(state().volume, 0.4);
});

// Relecture finale, A1 : la séance d'une page rechargée revient APRÈS le délai de reprise (500 ms). SDK_READY est
// parti sans elle et a relu la location du film mémorisé ; la TV répond ensuite qu'elle joue ; la location (40 %)
// arrive après coup. La télécommande doit rester, la séance serveur ouverte, le film mémorisé.
test('CAST SERVICE A1: séance reprise après le délai de 500 ms, location relue entre-temps → la télécommande reste', async (t) => {
  service.__resetCastForTests();
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const fake = installFakeCastSdk();
  const ports = fakePorts(7);
  let answerRental = null;
  ports.readRental = (filmId) => {
    ports.calls.push(['readRental', filmId]);
    return new Promise((resolve) => { answerRental = resolve; });
  };
  service.initCast(ports);
  await flush();
  t.mock.timers.tick(service.CAST_RESUME_SETTLE_MS);   // SDK_READY, pas encore de séance : la location est relue
  await flush();
  assert.deepEqual(named(ports, 'readRental'), [[7]]);
  assert.equal(service.getCastState().connected, false);
  const tv = fake.makeSession('Salon');
  fake.context.resume(tv);
  fake.context.emitSession('SESSION_RESUMED', tv);       // la séance revient, après le délai
  assert.equal(fake.getStatusCount(), 1, 'la TV est interrogée');
  tv.reply({ type: 'MEDIA_STATUS', requestId: 1, status: [{
    mediaSessionId: 4, playerState: 'PLAYING', currentTime: 300, media: { duration: 600, customData: { filmId: 7 } },
  }] });
  await flush();
  assert.equal(service.getCastState().phase, 'remote', 'la TV joue : télécommande');
  answerRental({ exists: true, watchProgress: 40, watchPosition: 120 });   // la relecture périmée arrive
  await flush();
  const s = service.getCastState();
  assert.equal(s.phase, 'remote', 'la télécommande reste');
  assert.equal(castView(s, 7), 'remote');
  assert.equal(s.notice, null, 'aucun « La diffusion … s\'est arrêtée »');
  assert.deepEqual(named(ports, 'serverClose'), [], 'la séance serveur n\'est pas close');
  assert.ok(!named(ports, 'remember').some(([filmId]) => filmId === null), 'le film reste mémorisé');
  assert.deepEqual(named(ports, 'serverReport'), [[7, 300, 600]], 'le suivi serveur reprend');
});

// Relecture finale, B1 : après un rechargement, la séance reprise arrive avant SDK_READY et n'atteint pas la machine ;
// son appareil n'était jamais nommé (« la télé » pour toute la séance). SDK_READY le porte.
test('CAST SERVICE B1: après une reprise, le nom de l\'appareil est celui que donne le SDK', async (t) => {
  const { state } = await start(t, { session: true, remembered: 7 });
  assert.equal(state().deviceName, 'Salon');
  assert.equal(state().connected, true);
});

// Relecture finale, B9 : la relecture de la location d'un film mémorisé qui échoue (réseau, compte déconnecté) ne
// laissait aucune trace : le film restait « attendu » pour toute la vie de la page.
test('CAST SERVICE B9: relecture de la location impossible → le film mémorisé n\'est plus attendu, il reste mémorisé', async (t) => {
  service.__resetCastForTests();
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  installFakeCastSdk();
  const ports = fakePorts(7);
  ports.readRental = async (filmId) => { ports.calls.push(['readRental', filmId]); throw new Error('réseau'); };
  service.initCast(ports);
  await flush();
  t.mock.timers.tick(service.CAST_RESUME_SETTLE_MS);
  await flush();
  assert.deepEqual(named(ports, 'readRental'), [[7]]);
  const s = service.getCastState();
  assert.equal(s.phase, 'idle'); assert.equal(s.filmId, null); assert.equal(s.notice, null);
  assert.deepEqual(named(ports, 'remember'), [], 'lastCastFilmId n\'est pas effacé : la page suivante réessaiera');
});

// Relecture finale, B15 : le sélecteur jusqu'au chargement, comme sur le téléphone — requestSession résolu, appareil
// choisi, séance ouverte, film chargé, télécommande.
test('CAST SERVICE B15: sélecteur, connexion, chargement, télécommande', async (t) => {
  const { fake, ports, state } = await start(t);
  const tv = fake.makeSession('Salon');
  let choose = null;
  fake.context.requestSessionImpl = () => new Promise((resolve) => { choose = resolve; });
  tv.loadMediaImpl = () => {
    tv.mediaSession = fake.makeMedia({ filmId: 7, currentTime: 0 });
    return Promise.resolve();
  };
  service.sendCast(ask(7));
  assert.equal(state().phase, 'choosing');
  assert.equal(fake.calls.requestSession, 1);
  fake.context.emitSession('SESSION_STARTING', tv);                    // appareil choisi dans le sélecteur
  assert.equal(state().phase, 'connecting');
  assert.equal(state().deviceName, 'Salon');
  fake.context.session = tv;
  fake.context.emitSession('SESSION_STARTED', tv);                     // séance ouverte
  assert.equal(state().phase, 'loading');
  assert.equal(fake.calls.loadMedia.length, 1);
  assert.deepEqual(fake.calls.loadMedia[0].media.customData, { filmId: 7 });
  choose();                                                            // la promesse du sélecteur se règle après coup
  await flush();
  assert.equal(state().phase, 'remote');
  assert.equal(state().filmId, 7);
  assert.equal(fake.calls.loadMedia.length, 1, 'un seul chargement');
  assert.deepEqual(named(ports, 'serverOpen'), [[7, 0, 600]]);
  t.mock.timers.tick(CAST_LOAD_TIMEOUT_MS);
  assert.equal(state().phase, 'remote', 'le délai de chargement est levé');
});

// Relecture finale, B15 : le faux endCurrentSession émet SESSION_ENDING puis SESSION_ENDED, comme le vrai.
test('CAST SERVICE B15: « Arrêter » — la séance passe par SESSION_ENDING puis SESSION_ENDED', async (t) => {
  const { fake, state } = await remoteOn(t);
  const seen = [];
  fake.context.addEventListener('sessionstatechanged', (e) => seen.push(e.sessionState));
  service.sendCast({ type: 'USER_STOP' });
  assert.equal(state().phase, 'idle'); assert.equal(state().stopping, true);
  assert.equal(fake.context.getSessionState(), 'SESSION_ENDING', 'la séance se ferme');
  // Un nouveau Cast demandé pendant la fermeture ne charge pas sur la séance qui se ferme.
  service.sendCast(ask(7));
  assert.equal(fake.calls.loadMedia.length, 0);
  await flush();
  assert.deepEqual(seen, ['SESSION_ENDING', 'SESSION_ENDED']);
  assert.equal(state().connected, false); assert.equal(state().stopping, false);
});

// Recette sur le Pixel 9a et le vidéoprojecteur, 21/11/2026 (trace du service) : sur une séance NEUVE — la télé lance
// l'application —, le SDK annonce un objet média provisoire (IDLE) 86 ms après l'envoi, l'abandonne, et règle la
// promesse du chargement sans objet média. La télé ne charge réellement le film que 2 s plus tard : le SDK crée alors
// un autre objet, sans MEDIA_SESSION. Le service n'en apprenait rien : « Le film n'a pas pu démarrer » au bout de
// 20 s, pendant que la télé jouait.
async function freshSessionLoading(t) {
  const ctx = await start(t);
  const tv = ctx.fake.makeSession('Salon');
  ctx.fake.context.requestSessionImpl = () => new Promise(() => {});
  service.sendCast(ask(7));
  ctx.fake.context.emitSession('SESSION_STARTING', tv);
  ctx.fake.context.session = tv;
  ctx.fake.context.emitSession('SESSION_STARTED', tv);
  const provisional = ctx.fake.makeMedia({ filmId: 7, playerState: 'IDLE', currentTime: 0, duration: 0 });
  tv.announceMedia(provisional);
  provisional.update({}, false);
  tv.mediaSession = null;
  await flush();                                                       // la promesse du chargement se règle : pas de média
  assert.equal(ctx.state().phase, 'loading', 'préalable : toujours en chargement');
  return { ...ctx, tv };
}

test('CAST SERVICE R1: séance neuve — l\'objet média réel, signalé par RemotePlayer, ouvre la télécommande', async (t) => {
  const { fake, tv, ports, state } = await freshSessionLoading(t);
  tv.mediaSession = fake.makeMedia({ filmId: 7, playerState: 'BUFFERING', currentTime: 0 });   // sans MEDIA_SESSION
  fake.controller.signal('ismedialoadedchanged');
  assert.equal(state().phase, 'remote');
  assert.equal(state().filmId, 7);
  await flush();                                                       // la file des appels au serveur
  assert.deepEqual(named(ports, 'serverOpen'), [[7, 0, 600]]);
  // Ses statuts suivants sont écoutés : la pause vue sur la télé arrive.
  tv.mediaSession.update({ playerState: 'PAUSED' });
  assert.equal(state().paused, true);
  t.mock.timers.tick(CAST_LOAD_TIMEOUT_MS);
  assert.equal(state().phase, 'remote', 'le délai de chargement est levé');
});

test('CAST SERVICE R1: séance neuve — sans aucun signal, le service retrouve l\'objet média en une seconde', async (t) => {
  const { fake, tv, state } = await freshSessionLoading(t);
  tv.mediaSession = fake.makeMedia({ filmId: 7, currentTime: 2 });
  t.mock.timers.tick(service.CAST_LOAD_LOOK_EVERY_MS);
  assert.equal(state().phase, 'remote');
  assert.equal(fake.calls.loadMedia.length, 1, 'un seul chargement');
});

test('CAST SERVICE R1: un objet média au repos n\'est pas repris sur un signal de RemotePlayer', async (t) => {
  const { fake, tv, ports, state, playing } = await remoteOn(t);
  playing.update({ playerState: 'IDLE', idleReason: 'FINISHED' }, false);  // fin du film : l'objet meurt, la séance le garde
  assert.equal(state().phase, 'ended');
  const closes = named(ports, 'serverClose').length;
  assert.equal(tv.mediaSession, playing);
  fake.controller.signal('playerstatechanged');
  fake.controller.signal('ismedialoadedchanged');
  assert.equal(state().phase, 'ended');
  assert.equal(named(ports, 'serverClose').length, closes, 'aucune seconde clôture');
  // L'objet mort n'est pas redevenu le média courant : aucune commande ne part vers lui.
  assert.equal(await service.setCastSubtitle(1), false);
  assert.deepEqual(fake.calls.commands, []);
});

// Recette sur le Pixel 9a, 21/11/2026 : Chrome gèle la page cachée depuis 60 s ; au retour le SDK se dit toujours
// connecté (CONNECTED, SESSION_STARTED, objet média « PLAYING ») mais tout envoi lève InvalidStateError
// (« Presentation connection is disconnected ») : « La télé ne répond plus », la télé en lecture.
// chrome.cast.requestSessionById(id) rejoint la séance sans fenêtre native : SESSION_RESUMED, nouvel objet de séance.
test('CAST SERVICE R2: retour d\'un gel — la séance est rejointe par son identifiant, la télécommande ne tombe pas', async (t) => {
  const { fake, tv, ports, state } = await remoteOn(t);
  tv.sendMessageImpl = () => { throw new DOMException('Presentation connection is disconnected.', 'InvalidStateError'); };
  fake.setVisibility('hidden');
  fake.setVisibility('visible');                                        // PAGE_VISIBLE : demande de statut, l'envoi lève
  assert.deepEqual(fake.calls.requestSessionById, [tv.getSessionId()]);
  assert.equal(state().phase, 'remote');
  // Le SDK tient un nouvel objet de séance, sans l'annoncer (pas de SESSION_RESUMED) : le service réessaie seul.
  const rejoined = fake.makeSession('Salon');
  fake.context.session = rejoined;
  const asked = fake.getStatusCount();
  t.mock.timers.tick(service.CAST_REJOIN_RETRY_MS);
  assert.equal(fake.getStatusCount(), asked + 1, 'le statut est redemandé sur la séance rejointe');
  t.mock.timers.tick(service.CAST_REJOIN_RETRY_MS * 3);
  assert.equal(fake.getStatusCount(), asked + 1, 'une fois l\'envoi passé, plus de nouvel essai');
  rejoined.reply({ type: 'MEDIA_STATUS', status: [{ mediaSessionId: 9, playerState: 'PLAYING', currentTime: 90, media: { duration: 600, customData: { filmId: 7 } } }] });
  assert.equal(state().phase, 'remote');
  assert.equal(state().position, 90);
  t.mock.timers.tick(CAST_STATUS_TIMEOUT_MS);
  assert.equal(state().phase, 'remote', 'l\'échéance est levée');
  assert.equal(fake.calls.requestSessionById.length, 1, 'une seule reprise');
  assert.equal(named(ports, 'serverClose').length, 0);
});

test('CAST SERVICE R2: la reprise est annoncée (SESSION_RESUMED) → le statut repart aussitôt, sans attendre le tour suivant', async (t) => {
  const { fake, tv, state } = await remoteOn(t);
  tv.sendMessageImpl = () => { throw new DOMException('Presentation connection is disconnected.', 'InvalidStateError'); };
  service.sendCast({ type: 'TICK' });
  const rejoined = fake.makeSession('Salon');
  fake.context.session = rejoined;
  const asked = fake.getStatusCount();
  fake.context.emitSession('SESSION_RESUMED', rejoined);
  assert.equal(fake.getStatusCount(), asked + 1);
  assert.equal(state().phase, 'remote');
});

test('CAST SERVICE R2: reprise sans effet, l\'envoi lève toujours → liaison perdue à l\'échéance, une seule reprise demandée', async (t) => {
  const { fake, tv, state } = await remoteOn(t);
  tv.sendMessageImpl = () => { throw new DOMException('Presentation connection is disconnected.', 'InvalidStateError'); };
  service.sendCast({ type: 'TICK' });
  t.mock.timers.tick(CAST_STATUS_TIMEOUT_MS - 1);
  assert.equal(state().phase, 'remote');
  assert.equal(fake.calls.requestSessionById.length, 1, 'les essais renvoient la demande, pas la reprise');
  t.mock.timers.tick(1);
  assert.equal(state().phase, 'lost');
  const sent = fake.calls.sendMessage.length;
  t.mock.timers.tick(service.CAST_REJOIN_RETRY_MS * 4);
  assert.equal(fake.calls.sendMessage.length, sent, 'perdue : les essais s\'arrêtent jusqu\'au TICK suivant');
});

test('CAST SERVICE R2: séance rejointe, envoi parti puis refusé → liaison perdue, sans seconde reprise', async (t) => {
  const { fake, tv, state } = await remoteOn(t);
  tv.sendMessageImpl = () => { throw new DOMException('Presentation connection is disconnected.', 'InvalidStateError'); };
  service.sendCast({ type: 'TICK' });
  const rejoined = fake.makeSession('Salon');
  rejoined.sendMessageImpl = () => Promise.reject(new Error('session_error'));
  fake.context.session = rejoined;
  t.mock.timers.tick(service.CAST_REJOIN_RETRY_MS);
  await flush();
  assert.equal(state().phase, 'lost');
  assert.equal(fake.calls.requestSessionById.length, 1);
});

test('CAST SERVICE R2: une promesse d\'envoi rejetée tente la même reprise', async (t) => {
  const { fake, tv, state } = await remoteOn(t);
  tv.sendMessageImpl = () => Promise.reject(new Error('session_error'));
  service.sendCast({ type: 'TICK' });
  await flush();
  assert.deepEqual(fake.calls.requestSessionById, [tv.getSessionId()]);
  assert.equal(state().phase, 'remote');
});
