import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readText } from '../helpers/repo.mjs';
import * as K from '../../src/components/kiosk/kiosk-logic.ts';

const f = (id, title, extra = {}) => ({ id, title, overview: '', poster_path: `/p${id}.jpg`, backdrop_path: null,
  release_date: '2014-01-01', runtime: 100, vote_average: 0, genres: [], ...extra });
const AISLES = ['nouveautes','action','aventure','horreur','comedie','drame','thriller','policier','sf','animation','classiques','bizarre','romance'];
const empty = () => Object.fromEntries(AISLES.map(a => [a, []]));

test('BORNE: les onglets couvrent chaque rayon d\'AisleType une fois, plus « tous »', () => {
  const src = readText(path.join(process.cwd(), 'src/types/index.ts'));
  const fromTypes = src.match(/export type AisleType = ([^;]+);/)[1].match(/'([^']+)'/g).map(s => s.slice(1, -1)).sort();
  const ids = K.KIOSK_TABS.map(t => t.id);
  assert.deepEqual(ids.filter(i => i !== 'tous').sort(), fromTypes);
  assert.equal(ids[0], 'nouveautes');
  assert.equal(ids.at(-1), 'tous');
  assert.equal(new Set(ids).size, ids.length);
});
test('BORNE: deux pages de sept onglets', () => {
  const pages = K.tabPages();
  assert.deepEqual(pages.map(p => p.length), [7, 7]);
  assert.equal(K.tabLabel('comedie'), 'Comédie');
});
test('BORNE: « tous » ne répète pas un film présent en rayon et en nouveauté', () => {
  const films = empty();
  films.action = [f(1, 'Zoulou'), f(2, 'Alien')];
  films.nouveautes = [f(2, 'Alien')];
  assert.deepEqual(K.filmsForTab(films, 'tous', 'alpha').map(x => x.id), [2, 1]);
  assert.deepEqual(K.filmsForTab(films, 'action', 'rayon').map(x => x.id), [1, 2]);
});
test('BORNE: tri par date, le plus récent d\'abord, et tri alphabétique insensible aux accents', () => {
  const films = empty();
  films.drame = [f(1, 'Écume', { release_date: '2001-01-01' }), f(2, 'Dune', { release_date: '2021-01-01' }), f(3, 'Fargo', { release_date: '1996-01-01' })];
  assert.deepEqual(K.filmsForTab(films, 'drame', 'date').map(x => x.id), [2, 1, 3]);
  assert.deepEqual(K.filmsForTab(films, 'drame', 'alpha').map(x => x.id), [2, 1, 3]);
});
test('BORNE: état du catalogue — chargement, puis indisponible après 8 s', () => {
  assert.equal(K.catalogState(12, 0), 'ready');
  assert.equal(K.catalogState(0, 7999), 'loading');
  assert.equal(K.catalogState(0, 8000), 'unavailable');
});
test('BORNE: jaquette — chemin du proxy, ou null sans affiche', () => {
  assert.equal(K.posterSrc({ poster_path: '/abc.jpg' }, 'w185'), '/api/poster/w185/abc.jpg');
  assert.equal(K.posterSrc({ poster_path: null }, 'w342'), null);
});
test('BORNE: libellés de la fiche', () => {
  assert.equal(K.formatRuntime(169), '2 h 49');
  assert.equal(K.formatRuntime(58), '58 min');
  assert.equal(K.formatRuntime(null), '—');
  assert.equal(K.releaseYear({ release_date: '2014-01-01' }), '2014');
  assert.equal(K.releaseYear({ release_date: '' }), '—');
  assert.equal(K.versionLabel({ vf: true, vo: true }), 'VF · VO');
  assert.equal(K.versionLabel({ vf: false, vo: true }), 'VO');
  assert.equal(K.versionLabel(null), '—');
  assert.equal(K.synopsisText('   '), 'Synopsis indisponible.');
  // Un film peut n'avoir aucun rayon (Film.aisle est nullable) : la fiche affiche un tiret.
  assert.equal(K.tabLabel(null), '—');
  assert.equal(K.tabLabel(undefined), '—');
});
test('BORNE: décision du bouton d\'action, par ordre de priorité', () => {
  const base = { isAuthenticated: true, isRented: false, isAvailable: true, copiesLeft: 2, credits: 3, cost: 1 };
  assert.equal(K.rentAction({ ...base, isRented: true }), 'watch');
  assert.equal(K.rentAction({ ...base, isAuthenticated: false }), 'login');
  assert.equal(K.rentAction({ ...base, isAvailable: false }), 'unavailable');
  assert.equal(K.rentAction({ ...base, copiesLeft: 0 }), 'out-of-stock');
  assert.equal(K.rentAction({ ...base, credits: 1, cost: 2 }), 'insufficient');
  assert.equal(K.rentAction({ ...base, copiesLeft: null }), 'rent');
});
test('BORNE: un double appui ne lance qu\'une location', async () => {
  let rents = 0; let release;
  const deps = { rent: () => { rents++; return new Promise(r => { release = r; }); }, setMode: async () => {} };
  const lock = { busy: false };
  const first = K.rentFlow(deps, lock);
  assert.deepEqual(await K.rentFlow(deps, lock), { status: 'busy' });
  release();
  assert.deepEqual(await first, { status: 'ok' });
  assert.equal(rents, 1);
  assert.equal(lock.busy, false);
});
test('BORNE: un refus du serveur remonte son message et libère le verrou', async () => {
  const lock = { busy: false };
  const res = await K.rentFlow({ rent: async () => { throw new Error('Non authentifié'); }, setMode: async () => {} }, lock);
  assert.deepEqual(res, { status: 'error', message: 'Non authentifié', httpStatus: null });
  assert.equal(lock.busy, false);
});
test('BORNE: un échec du mode de visionnage ne fait pas échouer la location', async () => {
  const res = await K.rentFlow({ rent: async () => {}, setMode: async () => { throw new Error('x'); } }, { busy: false });
  assert.deepEqual(res, { status: 'ok' });
});
test('BORNE: à l\'ouverture, l\'onglet est Nouveautés, ou le premier rayon qui a des films', () => {
  const films = empty();
  assert.equal(K.firstNonEmptyTab(films), 'nouveautes', 'catalogue vide : on reste sur Nouveautés');
  films.drame = [f(1, 'Fargo')];
  films.sf = [f(2, 'Alien')];
  assert.equal(K.firstNonEmptyTab(films), 'drame', 'ordre des onglets : Drame vient avant SF');
  films.nouveautes = [f(2, 'Alien')];
  assert.equal(K.firstNonEmptyTab(films), 'nouveautes');
});
test('BORNE: « crédit » s\'accorde — 0 et 1 au singulier', () => {
  assert.equal(K.creditsLabel(0), '0 crédit');
  assert.equal(K.creditsLabel(1), '1 crédit');
  assert.equal(K.creditsLabel(2), '2 crédits');
  assert.equal(K.creditsLabel(15), '15 crédits');
});
test('BORNE: échéance d\'une location, en français', () => {
  const expiresAt = Date.UTC(2026, 10, 19, 17, 42); // 19/11/2026 18:42 à Paris
  assert.equal(K.formatUntil(expiresAt, 'Europe/Paris'), '19 novembre à 18:42');
});

// ===== Recherche (partagée avec le Minitel) =====
import { searchFilms } from '../../src/utils/minitelSearch.ts';
test('BORNE: la recherche ignore la casse et les accents, exact d\'abord', () => {
  const films = [f(1, 'Les Évadés'), f(2, 'Evade'), f(3, 'Alien')];
  assert.deepEqual(searchFilms(films, 'évade').map(x => x.id), [2, 1]);
  assert.deepEqual(searchFilms(films, '   '), []);
});

// I2 (relecture finale) — annuler la connexion pendant qu'elle est en cours ne doit pas louer le
// film : la connexion aboutit après coup et rappelait l'action mise en attente.
test('BORNE: annuler la connexion oublie l\'action qui l\'avait demandée', () => {
  let rented = 0;
  const pending = K.createPendingAction();
  pending.set(() => { rented++; });
  pending.cancel();
  pending.take()?.();
  assert.equal(rented, 0, 'une connexion annulée ne doit pas déclencher la location');
});
test('BORNE: l\'action en attente n\'est reprise qu\'une fois, et la dernière demandée gagne', () => {
  let a = 0; let b = 0;
  const pending = K.createPendingAction();
  pending.set(() => { a++; });
  pending.set(() => { b++; });
  pending.take()?.();
  pending.take()?.();
  assert.deepEqual([a, b], [0, 1]);
  assert.equal(pending.take(), undefined);
});

// ===== Retours de Rusmir du 16/11/2026, après la relecture =====

test('BORNE: un refus de location garde le code du serveur ; « Se reconnecter » ne vaut que pour une session expirée', async () => {
  const refuse = (status, message) => K.rentFlow({ rent: async () => { throw Object.assign(new Error(message), status === null ? {} : { status }); }, setMode: async () => {} }, { busy: false });
  const expired = await refuse(401, 'Non authentifié');
  assert.deepEqual(expired, { status: 'error', message: 'Non authentifié', httpStatus: 401 });
  assert.equal(K.offersRelogin(expired), true);
  assert.equal(K.offersRelogin(await refuse(400, 'Crédits insuffisants')), false, 'un refus de crédits ou de stock ne propose pas de se reconnecter');
  assert.equal(K.offersRelogin(await refuse(null, 'Failed to fetch')), false, 'une panne de réseau non plus');
  assert.equal(K.offersRelogin({ status: 'ok' }), false);
});
test('BORNE: le catalogue est dit indisponible dès que son chargement a échoué, sans attendre 8 s', () => {
  assert.equal(K.catalogState(0, 500, false), 'loading');
  assert.equal(K.catalogState(0, 500, true), 'unavailable');
  assert.equal(K.catalogState(3, 500, true), 'ready', 'des films sont là : le catalogue est prêt');
  assert.equal(K.catalogState(0, K.CATALOG_WAIT_MS, false), 'unavailable', 'le plafond de 8 s reste le filet');
});
test('BORNE: le geste retour agit dans la borne et ne la quitte jamais', () => {
  const base = { playerOpen: false, noticeOpen: false, noticeClosable: true, authOpen: false, phrasePending: false, searchOpen: false };
  assert.equal(K.kioskBackAction(base), 'none', 'à la racine : rien, seul « quitter » sort');
  assert.equal(K.kioskBackAction({ ...base, searchOpen: true }), 'close-search');
  assert.equal(K.kioskBackAction({ ...base, searchOpen: true, authOpen: true }), 'cancel-auth', 'la connexion est au-dessus de la recherche');
  assert.equal(K.kioskBackAction({ ...base, authOpen: true, phrasePending: true }), 'none', 'la phrase de récupération ne se ferme pas d\'un geste');
  assert.equal(K.kioskBackAction({ ...base, searchOpen: true, noticeOpen: true }), 'close-notice', 'le message est au-dessus de tout');
  assert.equal(K.kioskBackAction({ ...base, noticeOpen: true, noticeClosable: false }), 'none', '« Catalogue indisponible » ne se ferme pas d\'un geste');
  assert.equal(K.kioskBackAction({ ...base, noticeOpen: true, searchOpen: true, playerOpen: true }), 'close-player', 'le lecteur d\'abord');
  // Table complète : aucune combinaison ne fait sortir de la borne.
  const allowed = new Set(['none', 'close-player', 'close-notice', 'cancel-auth', 'close-search']);
  for (let bits = 0; bits < 64; bits++) {
    const s2 = { playerOpen: !!(bits & 1), noticeOpen: !!(bits & 2), noticeClosable: !!(bits & 4), authOpen: !!(bits & 8), phrasePending: !!(bits & 16), searchOpen: !!(bits & 32) };
    assert.ok(allowed.has(K.kioskBackAction(s2)), JSON.stringify(s2));
  }
});
test('BORNE: sur un téléphone en paysage, la borne ne s\'affiche pas', () => {
  const phone = { coarsePointer: true, landscape: true, shortSide: 390 };
  assert.equal(K.hidesKioskInLandscape(phone), true);
  assert.equal(K.hidesKioskInLandscape({ ...phone, landscape: false }), false, 'à la verticale, la borne s\'affiche');
  assert.equal(K.hidesKioskInLandscape({ ...phone, coarsePointer: false }), false, 'une fenêtre de PC basse n\'est pas un téléphone');
  assert.equal(K.hidesKioskInLandscape({ ...phone, shortSide: 768 }), false, 'une tablette a la hauteur qu\'il faut');
});

// ===== Retouche visuelle du 16/11/2026 : la fiche donne le générique =====
test('BORNE: générique court de la fiche — deux réalisateurs et trois interprètes au plus', () => {
  assert.deepEqual(
    K.creditsLine(['Jordan Peele'], ['Daniel Kaluuya', 'Allison Williams', 'Bradley Whitford', 'Catherine Keener']),
    { by: 'Jordan Peele', cast: 'Daniel Kaluuya, Allison Williams, Bradley Whitford' },
  );
  assert.deepEqual(K.creditsLine(['Joel Coen', 'Ethan Coen', 'Un Troisième'], []), { by: 'Joel Coen, Ethan Coen', cast: null });
  assert.deepEqual(K.creditsLine([], ['  ', 'Sigourney Weaver']), { by: null, cast: 'Sigourney Weaver' });
});
test('BORNE: sans générique connu, la fiche n\'affiche pas de ligne vide', () => {
  assert.equal(K.creditsLine([], []), null);
  assert.equal(K.creditsLine(null, undefined), null);
  assert.equal(K.creditsLine(['', '  '], ['']), null);
});

// ===== Trame de la dalle : calée sur les pixels physiques de l'écran =====
test('BORNE: la trame de la dalle se cale sur un pixel physique, quelle que soit la densité', () => {
  assert.equal(K.lcdDevicePixel(1), '1px');
  assert.equal(K.lcdDevicePixel(2), '0.5px');
  // Pixel 9a : densité fractionnaire. Trois pas de trame doivent tomber sur trois pixels physiques
  // à mieux qu'un centième près sur toute la largeur de l'écran (~1000 px), sinon moirage.
  const step = parseFloat(K.lcdDevicePixel(2.625));
  assert.ok(Math.abs(step * 2.625 - 1) * 1000 < 0.01, `pas de ${step}px`);
});
test('BORNE: sans densité lisible, la trame retombe sur le pixel CSS', () => {
  for (const bad of [0, -2, NaN, Infinity, undefined]) assert.equal(K.lcdDevicePixel(bad), '1px');
});

// ===== Grille de la dalle : aussi serrée que l'écran le permet =====
test('BORNE: la grille de la dalle est aussi serrée que l\'écran le permet', () => {
  // Écran non dense : un pixel physique sur deux, on ne peut pas dessiner plus fin.
  assert.equal(K.lcdPitchInDevicePixels(1), 2);
  // Écrans denses : le pas reste voisin d'un pixel CSS et demi.
  assert.equal(K.lcdPitchInDevicePixels(2), 3);
  assert.equal(K.lcdPitchInDevicePixels(2.625), 4);
  assert.equal(K.lcdPitchInDevicePixels(3), 5);
  // Zoom arrière du navigateur : jamais moins de deux pixels physiques.
  assert.equal(K.lcdPitchInDevicePixels(0.75), 2);
});
test('BORNE: sans densité lisible, la grille prend le pas le plus serré', () => {
  for (const bad of [0, -2, NaN, Infinity, undefined]) assert.equal(K.lcdPitchInDevicePixels(bad), 2);
});

// ===== Bouton d'action : l'action d'un côté, le prix de l'autre =====
// Les libellés sont écrits normalement (« Louer ») : c'est la feuille de style qui met l'action
// principale en capitales, pour qu'un lecteur d'écran ne l'épelle pas.
test('BORNE: le bouton d\'action dit l\'action, le prix est donné à part et en toutes lettres', () => {
  assert.deepEqual(K.actionLabel('rent', 2, false), { text: 'Louer', price: '2 crédits' });
  assert.deepEqual(K.actionLabel('login', 1, false), { text: 'Louer', price: '1 crédit' });
  assert.deepEqual(K.actionLabel('insufficient', 3, false), { text: 'Louer', price: '3 crédits' });
});
test('BORNE: quand il n\'y a rien à payer, le bouton ne montre pas de prix', () => {
  assert.deepEqual(K.actionLabel('watch', 2, false), { text: 'Regarder', price: null });
  assert.deepEqual(K.actionLabel('unavailable', 2, false), { text: 'Indisponible', price: null });
  assert.deepEqual(K.actionLabel('out-of-stock', 2, false), { text: 'Toutes louées', price: null });
  assert.deepEqual(K.actionLabel('rent', 2, true), { text: 'Location…', price: null });
});

// ===== Titre de la fiche : le plus grand corps qui tient =====
// Largeurs réelles mesurées sur le fichier de police (Big Shoulders Display, graisse 800), en em.
const TITRES_MESURES = [['Get Out', 2.68], ['Dernier train pour Busan', 9.02], ['Killers of the Flower Moon', 9.69], ["Confessions d'un homme dangereux", 13.39]];
test('BORNE: la largeur estimée d\'un titre suit sa largeur réelle sans jamais la sous-évaluer', () => {
  for (const [title, real] of TITRES_MESURES) {
    const est = K.titleWidthEm(title);
    assert.ok(est >= real && est <= real * 1.03, `${title} : estimé ${est.toFixed(2)} em pour ${real} em mesurés`);
  }
  assert.ok(K.titleWidthEm('日本') >= 1.2, 'un signe inconnu compte large, par prudence');
  assert.equal(K.titleWidthEm('  Get Out  '), K.titleWidthEm('Get Out'), 'les espaces autour ne comptent pas');
});
test('BORNE: le titre garde le plus grand corps qui tient sur sa ligne', () => {
  assert.equal(K.titleScale('Get Out'), 'lg');
  assert.equal(K.titleScale('Dernier train pour Busan'), 'lg', '54cqw à 6cqw de corps : il tient en grand');
  assert.equal(K.titleScale('Killers of the Flower Moon'), 'md', '9,69 em : une ligne, en corps moyen');
  assert.equal(K.titleScale('Il était une fois en Amérique'), 'md');
  assert.equal(K.titleScale("Confessions d'un homme dangereux"), 'sm', 'trop large pour une ligne : deux lignes, en petit');
});
