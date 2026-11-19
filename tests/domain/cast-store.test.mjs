import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readText, toPosix, walkFiles } from '../helpers/repo.mjs';

// La tranche `cast` du magasin (src/store/slices/cast.ts) : le seul endroit de l'application qui parle au
// service du Cast. Gardes statiques : le service parle au vrai SDK de Google (absent de Node), la tranche tire
// ses ports du magasin et de l'API. Ce que sa logique a de pur est testé dans cast-wire.test.mjs.

const ROOT = process.cwd();
const read = (rel) => readText(path.join(ROOT, rel));
const SLICE = 'src/store/slices/cast.ts';
const STORE = 'src/store/index.ts';

/** Le texte entre deux repères (le premier trouvé après `from`). */
function between(src, start, end) {
  const i = src.indexOf(start);
  assert.ok(i >= 0, `repère introuvable : ${start}`);
  const j = src.indexOf(end, i + start.length);
  assert.ok(j > i, `repère introuvable après ${start} : ${end}`);
  return src.slice(i, j);
}

test('CAST STORE: la tranche existe et le magasin la fusionne', () => {
  const slice = read(SLICE);
  assert.ok(slice.includes('export const createCastSlice'), 'la tranche exporte son créateur');
  const store = read(STORE);
  assert.ok(store.includes("from './slices/cast'"), 'le magasin importe la tranche');
  assert.ok(store.includes('...createCastSlice(set, get, store)'), 'le magasin la fusionne comme les deux autres');
  assert.ok(/interface VideoClubState extends CastSlice/.test(store), 'VideoClubState porte le type de la tranche');
});

test('CAST STORE: seul lastCastFilmId est persisté, jamais l\'état du Cast', () => {
  // L'état du Cast porte l'adresse du film et des drapeaux passagers : relu au rechargement, il serait faux.
  const store = read(STORE);
  const partialize = between(store, 'partialize:', '}),');
  assert.ok(partialize.includes('lastCastFilmId'), 'lastCastFilmId est persisté (le film dont le Cast court peut-être encore)');
  assert.ok(!partialize.includes('cast:'), 'l\'état du Cast n\'est pas persisté (cast:)');
  assert.ok(!/\bcast,/.test(partialize), 'l\'état du Cast n\'est pas persisté (cast,)');
});

test('CAST STORE: le service démarre à l\'entrée, par la tranche, à la place des trois préchargements', () => {
  assert.ok(/\bstartCast\b/.test(read('src/App.tsx')), 'App.tsx démarre le Cast');
  assert.ok(/\bstartCast\b/.test(read('src/components/interior/InteriorScene.tsx')), 'InteriorScene démarre le Cast');
  assert.ok(/\bstartCast\b/.test(read('src/components/kiosk/KioskDistribution.tsx')), 'KioskDistribution démarre le Cast');
  for (const rel of ['src/App.tsx', 'src/components/interior/InteriorScene.tsx', 'src/components/kiosk/KioskDistribution.tsx']) {
    assert.ok(!read(rel).includes('preloadCastSdk'), `${rel} ne précharge plus le SDK à part : le service le charge`);
  }
});

test('CAST STORE: aucun fichier de src/ hors du service et de la tranche n\'importe le service', () => {
  for (const file of walkFiles(path.join(ROOT, 'src'), new Set(['.ts', '.tsx']))) {
    const rel = toPosix(path.relative(ROOT, file));
    if (rel.startsWith('src/cast/') || rel === SLICE) continue;
    assert.ok(!/from\s+['"][^'"]*cast-service/.test(readText(file)), `${rel} ne doit pas importer cast-service`);
  }
  assert.ok(/from\s+['"][^'"]*cast\/cast-service/.test(read(SLICE)), 'la tranche importe le service');
});

test('CAST STORE: castFilm part dans la pile de l\'appui, sans attente avant sendCast', () => {
  // Le sélecteur d'appareils exige l'activation de l'appui : un `await` ou une promesse avant l'envoi la perdrait.
  const slice = read(SLICE);
  const body = between(slice, 'castFilm: (filmId, opts) => {', 'castToggle: () => ask(');
  assert.ok(!/\bawait\b/.test(body), 'castFilm ne contient aucun await');
  assert.ok(!/\basync\b/.test(body), 'castFilm n\'est pas asynchrone');
  assert.ok(!/\.then\(/.test(body), 'castFilm n\'enchaîne aucune promesse');
  assert.ok(body.includes("type: 'REQUEST_CAST'"), 'castFilm envoie REQUEST_CAST');
  assert.ok(body.indexOf('startCast()') < body.indexOf("type: 'REQUEST_CAST'"), 'le service est démarré avant l\'envoi');
});

test('CAST STORE: initCast d\'abord, une seule fois, avant tout sendCast', () => {
  const slice = read(SLICE);
  const start = between(slice, 'startCast: () => {', 'castFilm: (filmId, opts) => {');
  assert.ok(start.includes('initCast('), 'startCast appelle initCast');
  assert.ok(start.includes('subscribeCast('), 'startCast s\'abonne au service');
  assert.ok(start.indexOf('initCast(') < start.indexOf('subscribeCast('), 'initCast précède l\'abonnement');
  // Une seule inscription au magasin et au service pour toute la page, quel que soit le nombre d'appels.
  assert.ok(/if\s*\(\s*started\s*\)\s*return/.test(start), 'startCast est idempotent');
  for (const action of ['castToggle', 'castSeekBy', 'castVolume', 'castStop', 'castToPhone', 'castRetry', 'castCancel', 'castSubtitle']) {
    assert.ok(slice.includes(`${action}:`), `la tranche expose ${action}`);
  }
  assert.ok(slice.includes('takeCastResume:') && slice.includes('castDismiss:'), 'la tranche expose takeCastResume et castDismiss');
});

test('CAST STORE: chaque port se règle, avec une échéance nommée', () => {
  // Le service range ses appels serveur dans une seule file : un port qui ne se règle jamais la bloquerait pour
  // la vie de la page.
  const slice = read(SLICE);
  const wire = read('src/cast/cast-wire.ts');
  assert.ok(/export const CAST_SERVER_GIVE_UP_MS\s*=\s*10000\b/.test(wire), 'échéance nommée de 10 000 ms, dans cast-wire (testée)');
  assert.ok(/import[^;]*\bsettle\b[^;]*from\s+'\.\.\/\.\.\/cast\/cast-wire'/.test(slice), 'la tranche prend `settle` de cast-wire');
  assert.ok(!/function settle\b/.test(slice), 'la tranche n\'a pas sa propre copie de settle');
  // Chaque port serveur passe par `settle` : un seul qui l'oublie, et la file du service est à la merci d'un appel muet.
  const ports = between(slice, 'function createPorts', 'export const createCastSlice');
  const portBodies = {
    serverOpen: between(ports, 'serverOpen:', 'serverReport:'),
    serverReport: between(ports, 'serverReport:', 'serverClose:'),
    serverClose: between(ports, 'serverClose:', 'readRental:'),
    readRental: between(ports, 'readRental:', 'remember:'),
  };
  for (const [port, body] of Object.entries(portBodies)) {
    assert.ok(body.includes('settle('), `le port ${port} passe par settle(`);
  }
  for (const port of ['remember', 'remembered']) {
    assert.ok(ports.includes(`${port}:`), `port ${port}`);
  }
  assert.ok(slice.includes('castSessions.create(') && slice.includes('castSessions.updatePosition(') && slice.includes('castSessions.end('), 'les trois appels de séance');
  // La position du Cast tient aussi la progression de la location (spec § 5.1 : « progression + séance »).
  assert.ok(slice.includes('updateRentalProgress('), 'serverReport tient la progression de la location');
});

test('CAST STORE: openPlayer reçoit son origine et son invite, sans casser les appels à un argument', () => {
  const store = read(STORE);
  assert.ok(/openPlayer:\s*\(filmId:\s*number,\s*opts\?:\s*\{[^}]*from\?:\s*'kiosk'\s*\|\s*'store'[^}]*ask\?:\s*boolean/.test(store), 'type de openPlayer');
  assert.ok(/playerFrom:\s*'kiosk'\s*\|\s*'store'/.test(store) && /playerAsk:\s*boolean/.test(store), 'champs playerFrom et playerAsk typés');
  const open = between(store, 'openPlayer: (filmId, opts)', 'closePlayer:');
  assert.ok(open.includes("opts?.from ?? 'store'") && open.includes('opts?.ask ?? true'), 'défauts : store, invite montrée');
  const close = between(store, 'closePlayer:', '// Targeting');
  assert.ok(!close.includes('playerFrom') && !close.includes('playerAsk'), 'closePlayer laisse l\'origine et l\'invite');
});

test('CAST STORE: les accès du vieux lecteur sont partis, et celui de la borne avec eux', () => {
  // Le lecteur lit la machine (tâche 6) : plus rien n'écrit l'état du Cast hors de la tranche.
  const store = read(STORE);
  for (const name of ['castOnOpen', 'clearCastOnOpen', 'setActiveCastFilmId', 'endCast', 'openPlayerOnTv']) {
    assert.ok(!new RegExp(`\\b${name}\\b`).test(store), `${name} doit avoir quitté le magasin`);
  }
  assert.ok(!read('src/utils/cast-on-open.ts').includes('shouldStartCastOnOpen'), 'la règle du drapeau de la borne est partie');
  // Seule la tranche écrit activeCastFilmId : le magasin n'en garde que le type et la valeur de départ.
  assert.equal(store.split('activeCastFilmId:').length - 1, 2, 'activeCastFilmId : son type et sa valeur de départ, rien d\'autre');
  assert.ok(!read('src/components/player/VHSPlayer.tsx').includes('activeCastFilmId'), 'le lecteur ne lit ni n\'écrit activeCastFilmId');
});

test('CAST STORE: openPlayerOnTv n\'existe plus nulle part — la borne demande le Cast elle-même', () => {
  // Tâche 7 : « Sur ma télé » appelle castFilm puis openPlayer dans son propre gestionnaire, et rien sur la branche
  // AirPlay (gardes dans tests/domain/kiosk-wiring.test.mjs).
  for (const file of walkFiles(path.join(ROOT, 'src'), new Set(['.ts', '.tsx']))) {
    assert.ok(!readText(file).includes('openPlayerOnTv'), `${toPosix(path.relative(ROOT, file))} ne connaît plus openPlayerOnTv`);
  }
  assert.ok(!read(STORE).includes('@deprecated retiré à la tâche 7'), 'plus d\'alias périmé laissé pour la borne');
});

test('CAST STORE: activeCastFilmId est écrit par la tranche, la déconnexion et la location surveillées', () => {
  const slice = read(SLICE);
  assert.ok(slice.includes('activeCastFilmId'), 'la tranche écrit activeCastFilmId');
  assert.ok(slice.includes("'remote'") && slice.includes("'lost'") && slice.includes('castOwnsFilm'), 'valeur dérivée : remote ou lost');
  assert.ok(slice.includes("type: 'RENTAL_GONE'"), 'la location qui disparaît arrête le Cast');
  assert.ok(slice.includes('rentalGoneFilm('), 'la décision est la fonction pure de cast-wire');
  const store = read(STORE);
  const logout = between(store, 'logout: async', 'clearAuthError:');
  assert.ok(logout.includes('castLoggedOut()'), 'logout prévient la tranche');
  assert.ok(slice.includes('lastCastFilmId'), 'la tranche tient lastCastFilmId');
});
