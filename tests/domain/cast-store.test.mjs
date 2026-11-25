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

// Versions, tâche 7 (docs/superpowers/specs/2026-11-19-versions-et-erreurs-de-lecture-design.md, § 4.4) : le Cast part
// de la même décision que le panneau de la borne et le lecteur. Plus de « vf » choisi d'office dans la tranche.
test('CAST STORE VERSION: castFilm prend une version, sinon la décision unique — jamais « vf » d\'office', () => {
  const slice = read(SLICE);
  assert.ok(!slice.includes("?? 'vf'"), "plus de ?? 'vf' dans la tranche");
  assert.ok(!/opts\?\.audio|opts\?\.subtitle/.test(slice), 'plus de piste ni de sous-titres passés à part');
  assert.match(slice, /castFilm: \(filmId: number, opts\?: \{ version\?: VersionChoice; startAt\?: number \}\) => void/, 'signature : une version et un départ');
  const body = between(slice, 'castFilm: (filmId, opts) => {', 'castToggle: () => ask(');
  assert.ok(body.includes('opts?.version ?? resolvedVersion(versionDecisionFor(s, filmId))'), 'sans version : resolvedVersion(versionDecisionFor(…))');
  assert.ok(/audio: version\.audio/.test(body) && /subtitle: version\.subtitle/.test(body), 'le média suit la version, piste et sous-titres');
  assert.ok(body.indexOf('versionDecisionFor(') < body.indexOf('castMediaRequest('), 'la décision précède le média');
  assert.match(slice, /import \{ versionDecisionFor \} from '\.\/version'/, 'la décision vient de la tranche des versions');
});

test('CAST STORE VERSION: le lecteur passe sa version courante à castFilm, avec la position d\'ici', () => {
  const player = read('src/components/player/VHSPlayer.tsx');
  const start = player.indexOf('const sendToTv = useCallback(');
  assert.ok(start > 0, 'sendToTv introuvable');
  const send = player.slice(start, player.indexOf('}, [', start));
  // La version que joue le lecteur (usePlayerVersion, la décision unique) ; sans version lisible, la tranche décide.
  // Le départ sur la télé suit la règle de reprise de l'appareil (swapResumeTime, testée dans video-swap.test.mjs).
  assert.match(send, /castFilm\(currentPlayingFilm, \{\s*version: version \?\? undefined,\s*startAt: swapResumeTime\(/, 'version d\'ici et position');
});

// La chaîne que castFilm compose, rejouée sur les vraies fonctions pures : la décision → la source et la piste de
// sous-titres envoyées à la TV. Les adresses sont factices.
async function castChain(offerUrls, filmChoice, pref) {
  const VC = await import('../../src/utils/version-choice.ts');
  const { castMediaRequest } = await import('../../src/cast/cast-wire.ts');
  const { buildCastSubtitleTracks } = await import('../../src/utils/cast-subtitles.ts');
  const rental = { videoUrl: offerUrls.vf || offerUrls.vo || '', streamingUrls: offerUrls, watchProgress: 0, watchPosition: 0 };
  const version = VC.resolvedVersion(VC.decideVersion({ offer: VC.versionOffer(offerUrls), filmChoice: filmChoice?.(VC) ?? null, pref: pref?.(VC) ?? null }));
  if (version === null) return null;
  return castMediaRequest({ rental, audio: version.audio, subtitle: version.subtitle, title: 'x', subtitles: buildCastSubtitleTracks(offerUrls) });
}
const URLS = { vf: 'https://s.example/vf.mp4', vo: 'https://s.example/vo.mp4', subtitles: 'https://s.example/fr.vtt', subtitles_en: 'https://s.example/en.vtt' };

test('CAST STORE VERSION: rien de choisi → la TV reçoit la VF, sans sous-titres', async () => {
  const media = await castChain(URLS);
  assert.equal(media.url, URLS.vf);
  assert.equal(media.activeSubtitleId, null);
});
test('CAST STORE VERSION: VOSTFR choisie pour ce film → la VO, piste française active', async () => {
  const media = await castChain(URLS, (VC) => VC.VOSTFR);
  assert.equal(media.url, URLS.vo);
  assert.equal(media.activeSubtitleId, 1, 'piste française (id 1)');
});
test('CAST STORE VERSION: VOSTFR préférée sur un film sans sous-titres français → la version gardée par défaut', async () => {
  // La borne pose la question avant ; un appel sans version (et sans question posée) part dans la version gardée.
  const media = await castChain({ ...URLS, subtitles: null }, null, (VC) => VC.VOSTFR);
  assert.equal(media.url, URLS.vo);
  assert.equal(media.activeSubtitleId, 2, 'piste anglaise (id 2)');
});
test('CAST STORE VERSION: aucune piste lisible → aucun média, la tranche le dit (no_source)', async () => {
  assert.equal(await castChain({ vf: null, vo: null, subtitles: URLS.subtitles, subtitles_en: null }), null);
  const body = between(read(SLICE), 'castFilm: (filmId, opts) => {', 'castToggle: () => ask(');
  assert.match(body, /const media = version && castMediaRequest\(/, 'sans version, pas de média');
  assert.ok(body.indexOf("code: 'no_source'") > body.indexOf('const media = '), 'puis le message « pas de source »');
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
  // Relecture finale, B11 : le champ dérivé activeCastFilmId n'avait plus de lecteur — il est parti (garde plus bas).
  assert.ok(!store.includes('activeCastFilmId'), 'activeCastFilmId a quitté le magasin');
});

test('CAST STORE: openPlayerOnTv n\'existe plus nulle part — la borne demande le Cast elle-même', () => {
  // Tâche 7 : « Sur ma télé » appelle castFilm puis openPlayer dans son propre gestionnaire, et rien sur la branche
  // AirPlay (gardes dans tests/domain/kiosk-wiring.test.mjs).
  for (const file of walkFiles(path.join(ROOT, 'src'), new Set(['.ts', '.tsx']))) {
    assert.ok(!readText(file).includes('openPlayerOnTv'), `${toPosix(path.relative(ROOT, file))} ne connaît plus openPlayerOnTv`);
  }
  assert.ok(!read(STORE).includes('@deprecated retiré à la tâche 7'), 'plus d\'alias périmé laissé pour la borne');
});

test('CAST STORE: la déconnexion et la location surveillées', () => {
  const slice = read(SLICE);
  // Le film que la TV signale vient de la machine (castOwnsFilm) ; plus de champ dérivé à tenir (B11).
  assert.ok(slice.includes('castOwnsFilm'), 'le film de la TV vient de la machine');
  assert.ok(slice.includes("type: 'RENTAL_GONE'"), 'la location qui disparaît arrête le Cast');
  assert.ok(slice.includes('rentalGoneFilm('), 'la décision est la fonction pure de cast-wire');
  const store = read(STORE);
  const logout = between(store, 'logout: async', 'clearAuthError:');
  assert.ok(logout.includes('castLoggedOut()'), 'logout prévient la tranche');
  // La déconnexion n'est pas une location finie : son propre événement, et son propre message (recette du 25/11).
  const loggedOut = between(slice, 'castLoggedOut: () => {', 'castPlayerClosed:');
  assert.ok(loggedOut.includes("type: 'LOGGED_OUT'"), 'castLoggedOut envoie LOGGED_OUT');
  assert.ok(!loggedOut.includes("'RENTAL_GONE'"), 'et non RENTAL_GONE (« Location terminée » serait faux)');
  assert.ok(slice.includes('lastCastFilmId'), 'la tranche tient lastCastFilmId');
});

// Relecture finale, A2 : `logout` attendait l'effacement du cookie avant d'arrêter le Cast ; le DELETE de la séance
// recevait 401 et la séance restait ouverte. Le Cast s'arrête d'abord (la TV, et le serveur tant que le compte est
// encore connecté), puis la déconnexion part — qui clôt de toute façon les séances côté serveur.
test('CAST STORE A2: logout arrête le Cast AVANT la requête de déconnexion', () => {
  const logout = between(read(STORE), 'logout: async', 'clearAuthError:');
  const cast = logout.indexOf('castLoggedOut()');
  const request = logout.indexOf('api.auth.logout()');
  assert.ok(cast >= 0 && request >= 0, 'les deux appels existent');
  assert.ok(cast < request, 'castLoggedOut() précède api.auth.logout()');
});

// Relecture finale, A4 : sur un échec, `fetchMe` pose « non connecté ». Appelé par les ports du Cast — à la clôture
// d'une séance et à la relecture d'une location, quand le réseau est le plus fragile —, il faisait demander à la borne
// de se reconnecter alors que le cookie était valide. Les ports passent par `refreshRentals`, qui n'écrit qu'en cas de
// succès, ne touche à rien sur une panne réseau, et ne laisse `fetchMe` conclure qu'à un vrai 401.
test('CAST STORE A4: les ports du Cast n\'appellent plus fetchMe, ils relisent les locations par refreshRentals', () => {
  const slice = read(SLICE);
  assert.ok(!slice.includes('fetchMe('), 'slices/cast.ts ne contient plus fetchMe(');
  const ports = between(slice, 'function createPorts', 'export const createCastSlice');
  assert.ok(between(ports, 'serverClose:', 'readRental:').includes('refreshRentals()'), 'serverClose relit les locations');
  assert.ok(between(ports, 'readRental:', 'remember:').includes('refreshRentals()'), 'readRental relit les locations');
  const store = read(STORE);
  assert.ok(/refreshRentals: \(\) => Promise<void>;/.test(store), 'action typée du magasin');
  const refresh = between(store, 'refreshRentals: async () => {', 'fetchMe: async () => {');
  assert.ok(refresh.includes('rentalsRefreshOutcome('), 'la décision est la fonction testée');
  // Sur une erreur : fetchMe seulement pour un compte réellement déconnecté, et l'appelant le sait (rejet).
  const failure = refresh.slice(refresh.indexOf('catch'), refresh.indexOf('set({'));
  assert.ok(failure.includes("=== 'logged-out'") && failure.includes('fetchMe()') && failure.includes('throw'), 'fetchMe sur 401 seulement, puis rejet');
  // Une seule écriture, après le verdict « write » : rentals et l'historique qui vient avec.
  assert.equal((refresh.match(/\bset\(/g) ?? []).length, 1, 'une seule écriture');
  const write = refresh.slice(refresh.indexOf('set({'));
  assert.ok(write.includes('rentals:') && write.includes('rentalHistory:'), 'rentals et historique');
  assert.ok(!/isAuthenticated:|authUser:/.test(refresh), 'refreshRentals ne dit jamais « connecté » ni « déconnecté »');
});
test('CAST STORE A4: la relecture des locations n\'écrit qu\'une réponse réussie, du compte qui l\'a demandée', async () => {
  const { rentalsRefreshOutcome } = await import('../../src/utils/rentals-refresh.ts');
  const ok = { failedStatus: undefined, accountBefore: 4, accountNow: 4, responseAccount: 4 };
  assert.equal(rentalsRefreshOutcome(ok), 'write');
  // Panne réseau (pas de statut) ou erreur du serveur : rien n'est touché, le visiteur reste connecté.
  assert.equal(rentalsRefreshOutcome({ ...ok, failedStatus: null }), 'keep');
  assert.equal(rentalsRefreshOutcome({ ...ok, failedStatus: 502 }), 'keep');
  // 401 : le visiteur est réellement déconnecté, fetchMe le constate.
  assert.equal(rentalsRefreshOutcome({ ...ok, failedStatus: 401 }), 'logged-out');
  // Déconnexion (ou autre compte) pendant l'appel : la réponse de l'ancien compte n'écrit rien.
  assert.equal(rentalsRefreshOutcome({ ...ok, accountNow: null }), 'keep');
  assert.equal(rentalsRefreshOutcome({ ...ok, accountNow: 9 }), 'keep');
  assert.equal(rentalsRefreshOutcome({ ...ok, responseAccount: 9 }), 'keep');
  // Page à peine chargée, compte pas encore lu : la réponse du serveur fait foi.
  assert.equal(rentalsRefreshOutcome({ ...ok, accountBefore: null, accountNow: null }), 'write');
  assert.equal(rentalsRefreshOutcome({ ...ok, accountBefore: null, accountNow: 4 }), 'write');
});

// Relecture finale, B6 : `resume` et les messages d'échec restaient indéfiniment, lecteur fermé. La fermeture du
// lecteur le dit à la machine (PLAYER_CLOSED), qui les retire — sauf « Location terminée ».
test('CAST STORE B6: fermer le lecteur retire les messages et la reprise du Cast pour ce film', () => {
  const close = between(read(STORE), 'closePlayer: () => {', '// Targeting');
  assert.ok(close.includes('castPlayerClosed(filmId)'), 'closePlayer prévient la tranche');
  assert.ok(close.indexOf('currentPlayingFilm') < close.indexOf('set({'), 'le film est lu avant d\'être effacé');
  const slice = read(SLICE);
  const action = between(slice, 'castPlayerClosed: (filmId) => {', 'castRentalGone:');
  assert.ok(action.includes("type: 'PLAYER_CLOSED'"), 'la machine décide');
  assert.ok(action.includes('noSource'), 'et le message « pas de source », tenu par la tranche, part aussi');
});
// Relecture finale, B7 : `lastCastFilmId` survivait au changement de compte — le visiteur suivant sur le même appareil
// recevait « Location terminée » pour un film qu'il n'avait pas loué.
test('CAST STORE B7: logout oublie le film mémorisé du Cast', () => {
  const logout = between(read(STORE), 'logout: async', 'clearAuthError:');
  assert.ok(/lastCastFilmId: null/.test(logout), 'lastCastFilmId remis à null');
});
// Relecture finale, B11 : la fiche de la K7 bloquait encore un autre film pendant un Cast (« DIFFUSION EN COURS —
// ARRÊTEZ D'ABORD ») ; la spec, § 5.4 : lecteur local normal avec bandeau. Le champ dérivé qu'elle seule lisait part.
test('CAST STORE B11: la fiche de la K7 ne bloque plus un autre film, et le champ dérivé sans lecteur est parti', () => {
  const overlay = read('src/components/videoclub/VHSCaseOverlay.tsx');
  assert.ok(!overlay.includes('ARRÊTEZ D\'ABORD') && !overlay.includes('isCastBlocked'), 'plus de blocage');
  for (const file of walkFiles(path.join(ROOT, 'src'), new Set(['.ts', '.tsx']))) {
    assert.ok(!readText(file).includes('activeCastFilmId'), `${toPosix(path.relative(ROOT, file))} ne connaît plus activeCastFilmId`);
  }
});
