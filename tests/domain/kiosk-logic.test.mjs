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
// Décision de Rusmir du 17/11/2026 : six rayons par page (la colonne des rayons prenait trop de
// hauteur) — trois pages, la dernière plus courte.
test('BORNE: trois pages de six onglets au plus', () => {
  const pages = K.tabPages();
  assert.deepEqual(pages.map(p => p.length), [6, 6, 2]);
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

// ===== Bande de jaquettes : une flèche s'éteint à l'extrémité où elle ne mène plus nulle part =====
test('BORNE: la bande sait si elle est à son début ou à son bout', () => {
  assert.deepEqual(K.railEdges(0, 289, 2570), { atStart: true, atEnd: false });
  assert.deepEqual(K.railEdges(1000, 289, 2570), { atStart: false, atEnd: false });
  assert.deepEqual(K.railEdges(2281, 289, 2570), { atStart: false, atEnd: true });
  assert.deepEqual(K.railEdges(2280.4, 289, 2570), { atStart: false, atEnd: true }, 'défilement fractionnaire (écran dense)');
  assert.deepEqual(K.railEdges(0, 289, 200), { atStart: true, atEnd: true }, 'rayon qui tient sans défiler');
});

// ===== Louer se confirme (décision de Rusmir du 17/11/2026) =====
test('BORNE: le message de confirmation dit le film, le prix et ce qui restera', () => {
  assert.deepEqual(K.confirmRentText({ title: 'Get Out', cost: 2, credits: 5 }), {
    title: 'Confirmer la location',
    body: '«\u00a0Get Out\u00a0» pour 2 crédits. Il vous restera 3 crédits.',
  });
  assert.equal(K.confirmRentText({ title: 'Dune', cost: 1, credits: 2 }).body, '«\u00a0Dune\u00a0» pour 1 crédit. Il vous restera 1 crédit.');
  assert.equal(K.confirmRentText({ title: 'Dune', cost: 2, credits: 2 }).body, '«\u00a0Dune\u00a0» pour 2 crédits. Il ne vous restera plus de crédit.');
  assert.equal(K.confirmRentText({ title: '  Dune  ', cost: 1, credits: 3 }).body.startsWith('«\u00a0Dune\u00a0»'), true, 'titre sans espaces autour');
});

// ===== Mise en page sur téléphone : planchers en pixels, trois K7 en bas (Rusmir, 17/11/2026) =====
const PHONES = { petitAndroid: 3.48, iPhoneSE: 3.56, iPhone16: 3.81, pixel9a: 3.99, grand: 4.28 };
test('BORNE: chaque commande garde sa taille minimale, quel que soit le téléphone', () => {
  for (const [name, q] of Object.entries(PHONES)) {
    const L = K.phoneLayout(q);
    assert.ok(L.navH * q >= 40 - 0.01, name + ' : Compte et Quitter, 40 px au moins');
    assert.ok(L.tabH * q >= 44 - 0.01, name + ' : onglets des rayons, 44 px au moins');
    assert.ok(L.btnH * q >= 48 - 0.01, name + ' : LOUER et Recherche, 48 px au moins');
  }
});
test('BORNE: tout tient dans l\'écran, et la bande montre trois K7 entières', () => {
  for (const [name, q] of Object.entries(PHONES)) {
    const L = K.phoneLayout(q);
    assert.ok(Math.abs(L.stripTop + L.stripH + 2.4 - 180) < 0.01, name + ' : la bande finit au bas de l\'écran');
    assert.ok(L.stripH >= 30 - 0.01, name + ' : la bande garde une hauteur correcte');
    assert.ok(2 * L.railPosterH + 1 <= 70.4 + 0.01, name + ' : trois jaquettes tiennent entre les flèches');
    if (L.showUnder) assert.ok(L.btnTop >= L.underTop + L.underH + 2 - 0.01, name + ' : LOUER sous le cadre « En bref »');
  }
});
test('BORNE: la description prend la place que la bande peut céder, les jaquettes restent correctes', () => {
  // Rusmir, 17/11/2026 : « laisser plus de place pour la description ».
  const pixel = K.phoneLayout(PHONES.pixel9a);
  assert.equal(pixel.synLines, 3, 'Pixel 9a : trois lignes de résumé, en texte agrandi');
  assert.ok(pixel.railPosterH * PHONES.pixel9a >= 118, 'Pixel 9a : jaquettes d\'au moins 118 px');
  assert.equal(K.phoneLayout(PHONES.iPhone16).synLines, 2, 'iPhone 16 : deux lignes');
  const small = K.phoneLayout(PHONES.petitAndroid);
  assert.equal(small.showUnder, true);
  assert.equal(small.synLines, 0, 'petit écran : le générique seul');
  assert.ok(small.railPosterH * PHONES.petitAndroid >= 110, 'petit écran : jaquettes d\'au moins 110 px');
  const big = K.phoneLayout(PHONES.grand);
  assert.equal(big.synLines, 4);
  assert.ok(big.railPosterH * PHONES.grand >= 135, 'grand téléphone : jaquettes d\'au moins 135 px');
});
test('BORNE: six rayons par page, « Suite » pour les autres (Rusmir, 17/11/2026)', () => {
  assert.equal(K.KIOSK_TAB_PAGE_SIZE, 6);
  const pages = K.tabPages();
  assert.ok(pages.every((page) => page.length <= 6));
  assert.deepEqual(pages.flat(), K.KIOSK_TABS.map((t) => t.id), 'tous les onglets, dans l\'ordre');
  const L = K.phoneLayout(PHONES.pixel9a);
  assert.ok(Math.abs(L.cardH - (7 * L.tabH + 1.8)) < 0.01, 'la fiche suit une colonne de sept boutons');
});
test('BORNE: sur un écran assez grand, rien ne change de taille', () => {
  const L = K.phoneLayout(6);
  assert.equal(L.navH, 7.6); assert.equal(L.tabH, 9.75); assert.equal(L.btnH, 12);
  const odd = K.phoneLayout(0);
  assert.ok(Object.values(odd).every((v) => typeof v === 'boolean' || Number.isFinite(v)), 'mesure absente : pas de NaN');
});

test('BORNE: le texte du cadre « En bref » est agrandi de 2 px sur téléphone (Rusmir, 17/11/2026)', () => {
  // « Le texte du descriptif mériterait une police 1 ou 2 px plus grande, on a du mal à lire. »
  for (const [name, q] of Object.entries(PHONES)) {
    const L = K.phoneLayout(q);
    assert.ok(Math.abs(L.synSize * q - (3.75 * q + 2)) < 0.01, name + ' : 2 px de plus qu\'avant');
  }
  assert.equal(K.phoneLayoutVars(K.phoneLayout(4))['--k-syn-size'], '4.25cqw');
});

// ===== Fiche détaillée d'un film (Rusmir, 17/11/2026) =====
test('FICHE: six rubriques, dans l\'ordre d\'une fiche de vidéoclub', () => {
  assert.deepEqual(K.DETAIL_TABS.map((t) => t.label), ['Résumé', 'Distribution', 'Équipe', 'Avis', 'Bande-annonce', 'À voir aussi']);
});
test('FICHE: étoiles d\'une note sur 5, arrondie à l\'étoile', () => {
  assert.equal(K.starsFor(4.2), '★★★★☆');
  assert.equal(K.starsFor(4.6), '★★★★★');
  assert.equal(K.starsFor(0), '☆☆☆☆☆');
  assert.equal(K.starsFor(7), '★★★★★', 'jamais plus de cinq');
});
test('FICHE: public conseillé, d\'après la classification française', () => {
  assert.equal(K.audienceLabel('12'), 'Dès 12 ans');
  assert.equal(K.audienceLabel('16'), 'Dès 16 ans');
  assert.equal(K.audienceLabel('U'), 'Tous publics');
  assert.equal(K.audienceLabel('TP'), 'Tous publics');
  assert.equal(K.audienceLabel(''), null);
  assert.equal(K.audienceLabel(null), null);
});
test('FICHE: date de sortie en toutes lettres', () => {
  assert.equal(K.frenchDate('2017-05-03'), '3 mai 2017');
  assert.equal(K.frenchDate('2001-12-01'), '1 décembre 2001');
  assert.equal(K.frenchDate('pas une date'), null);
  assert.equal(K.frenchDate(null), null);
});
test('FICHE: le geste retour ferme la fiche, après ce qui est au-dessus d\'elle', () => {
  const base = { playerOpen: false, noticeOpen: false, noticeClosable: true, authOpen: false, phrasePending: false, searchOpen: false };
  assert.equal(K.kioskBackAction({ ...base, detailOpen: true }), 'close-detail');
  assert.equal(K.kioskBackAction({ ...base, detailOpen: true, noticeOpen: true }), 'close-notice', 'la confirmation de location d\'abord');
  assert.equal(K.kioskBackAction({ ...base, detailOpen: true, playerOpen: true }), 'close-player');
  assert.equal(K.kioskBackAction(base), 'none', 'sans fiche ouverte, rien ne change');
  assert.equal(K.kioskBackAction({ ...base, detailOpen: true, trailerOpen: true }), 'close-trailer', 'la bande-annonce s\'arrête d\'abord, la fiche reste');
});

test('FICHE: disponibilité en toutes lettres, jamais devinée', () => {
  // L'heure du serveur est lue par src/utils/server-date.ts (parseServerDate) avant d'arriver ici.
  assert.equal(K.availabilityText({ stock: 3, copiesLeft: 2, earliestReturnMs: NaN }), '2 copies sur 3 en rayon');
  assert.equal(K.availabilityText({ stock: 3, copiesLeft: 1, earliestReturnMs: NaN }), '1 copie sur 3 en rayon');
  assert.equal(K.availabilityText({ stock: 2, copiesLeft: 0, earliestReturnMs: Date.UTC(2026, 10, 19, 17, 42), timeZone: 'Europe/Paris' }), 'Toutes louées, prochain retour le 19 novembre à 18:42', 'heure de Paris');
  assert.equal(K.availabilityText({ stock: 2, copiesLeft: 0, earliestReturnMs: NaN }), 'Toutes les copies sont louées', 'date de retour illisible : on ne l\'invente pas');
  assert.equal(K.availabilityText(null), null, 'stock inconnu : rien plutôt qu\'un chiffre faux');
});

// ===== Jaquette 10 % plus grande, bouton « (i) Fiche film » à côté du titre (Rusmir, 17/11/2026) =====
test('BORNE: à côté du bouton « Fiche film », le corps du titre suit la place qui reste', () => {
  const titles = ['Get Out', 'Heat', 'Dernier train pour Busan', 'Killers of the Flower Moon', 'Il était une fois en Amérique', "Confessions d'un homme dangereux"];
  const rank = { lg: 0, md: 1, sm: 2 };
  for (const t of titles) {
    assert.equal(K.titleScale(t, 60.8), K.titleScale(t), t + ' : toute la largeur, comme avant');
    assert.ok(rank[K.titleScale(t, K.TITLE_W_WITH_INFO)] >= rank[K.titleScale(t)], t + ' : jamais plus grand dans moins de place');
  }
  // Bouton réduit de 30 % (24 → 16,8cqw), puis « Fiche film » → « Fiche », moins la largeur de « film »
  // mesurée dans le navigateur (4,13cqw) : 12,7cqw (Rusmir, 17/11/2026).
  assert.ok(Math.abs(K.TITLE_W_WITH_INFO - (60.8 - 12.7 - 1.6)) < 1e-9, 'le titre a la largeur que le bouton lui laisse');
  assert.equal(K.titleScale('Get Out', K.TITLE_W_WITH_INFO), 'lg');
  assert.equal(K.titleScale('Dernier train pour Busan', K.TITLE_W_WITH_INFO), 'sm', 'grand sur toute la largeur, petit à côté du bouton');
});

test('BORNE: jaquette de la fiche 10 % plus grande, sans toucher les valeurs de gauche ni le titre', () => {
  // « la jaquette elle-même devrait être 10 % plus grande » (Rusmir, 17/11/2026, sur son Pixel 9a).
  const before = (q) => Math.min(38, (K.phoneLayout(q).cardH - 26.7) / 1.5); // calcul d'avant
  for (const [name, q] of Object.entries(PHONES)) {
    const L = K.phoneLayout(q);
    assert.ok(L.posterW <= K.POSTER_MAX_W + 1e-9, name + ' : la jaquette ne passe pas sur les valeurs de gauche');
    assert.ok(L.posterW >= before(q) - 1e-9, name + ' : jamais plus petite qu\'avant');
    assert.ok(L.posterW <= before(q) * 1.1 + 1e-9, name + ' : 10 % de plus au plus');
    // Ardoise : 6,6cqw sous le haut de la fiche ; jaquette à 1,4cqw de son haut ; la ligne du titre
    // commence à 1,4 + (14,4 - 3,83) cqw de son bas ; 1cqw d'écart au moins.
    assert.ok(1.4 + L.posterW * 1.5 <= L.cardH - 6.6 - 1.4 - (14.4 - 3.83) - 1 + 1e-9, name + ' : au-dessus de la ligne du titre');
  }
  const pixel = K.phoneLayout(PHONES.pixel9a);
  assert.ok(Math.abs(pixel.posterW / before(PHONES.pixel9a) - 1.1) < 0.005, 'Pixel 9a : 10 % plus grande');
});

// ===== Effets de dalle de 2007 (Rusmir, 17/11/2026 : « je suis chaud pour les 4 ») =====
test('DALLE: la bande tourne à 25 images par seconde, avec un ralenti en fin de course', () => {
  assert.equal(K.KIOSK_FPS, 25);
  const steps = K.steppedScroll(0, 300, 240);
  assert.equal(steps.length, 6, '240 ms à 25 i/s : six images');
  assert.equal(steps.at(-1), 300, 'la dernière image est exactement la cible');
  for (let i = 1; i < steps.length; i++) assert.ok(steps[i] > steps[i - 1], 'toujours vers la cible');
  assert.ok(steps[0] > 300 / 6, 'ralenti en fin de course : la première image va plus loin qu\'un sixième');
  const back = K.steppedScroll(300, 0, 240);
  assert.equal(back.at(-1), 0);
  assert.ok(back[0] < 300);
  assert.deepEqual(K.steppedScroll(0, 300, 0), [300], 'durée nulle : on y va d\'un coup');
});

test('DALLE: l\'angle de vue d\'une TN — délavée vue d\'en dessus, assombrie vue d\'en dessous', () => {
  const zero = { washOut: 0, darken: 0, warm: 0, cool: 0, reflectX: 0, reflectY: 0 };
  assert.deepEqual(K.viewingAngle(0, 0), zero);
  const small = K.viewingAngle(3, -3);
  assert.equal(small.washOut + small.darken + small.warm + small.cool, 0, 'zone morte : tenir le téléphone ne bouge rien');
  const above = K.viewingAngle(20, 0);
  assert.ok(above.washOut > 0 && above.darken === 0, 'vue d\'en dessus : délavée');
  const below = K.viewingAngle(-20, 0);
  assert.ok(below.darken > 0 && below.washOut === 0, 'vue d\'en dessous : assombrie');
  assert.equal(K.viewingAngle(90, 0).washOut, 1, 'plafonné');
  assert.ok(K.viewingAngle(0, 20).warm > 0 && K.viewingAngle(0, -20).cool > 0, 'de côté : la teinte glisse');
  assert.ok(K.viewingAngle(20, -10).reflectY > 0 && K.viewingAngle(20, -10).reflectX < 0, 'le reflet suit l\'inclinaison');
  assert.equal(K.viewingAngle(0, 500).reflectX, 1, 'reflet plafonné');
  assert.deepEqual(K.viewingAngle(NaN, Infinity), zero, 'mesure illisible : rien');
});

test('DALLE: la position « de face » suit lentement la façon dont on tient le téléphone', () => {
  assert.equal(K.followBaseline(NaN, 40, 16), 40, 'première mesure : elle devient la référence');
  assert.equal(K.followBaseline(40, 60, 0), 40, 'sans temps écoulé, rien ne bouge');
  const afterTau = K.followBaseline(40, 60, 4000, 4000);
  assert.ok(Math.abs(afterTau - (40 + 20 * (1 - Math.exp(-1)))) < 1e-9, 'au bout d\'une constante de temps : 63 % du chemin');
  assert.ok(K.followBaseline(40, 60, 16) - 40 < 0.2, 'un geste rapide ne déplace presque pas la référence');
});

test('DALLE: l\'angle de vue se répartit jusqu\'à 60°, et la position de face revient en 8 s', () => {
  // Rusmir, 17/11/2026 : « la partie gyroscope devrait pouvoir avoir plus d'angle réaliste, le
  // mouvement est trop restreint ».
  assert.ok(K.viewingAngle(35, 0).washOut < 0.6, 'à 35° l\'effet n\'est plus au maximum');
  assert.equal(K.viewingAngle(60, 0).washOut, 1, 'plein effet à 60°');
  assert.ok(K.viewingAngle(-45, 0).darken > K.viewingAngle(-30, 0).darken, 'l\'effet croît encore au-delà de 30°');
  assert.ok(Math.abs(K.viewingAngle(0, 30).reflectX - 0.5) < 1e-9, 'le reflet suit l\'inclinaison sur toute la plage');
  const b = K.followBaseline(0, 10, 8000);
  assert.ok(Math.abs(b - 10 * (1 - Math.exp(-1))) < 1e-9, 'constante de temps par défaut : 8 s');
});

// ===== Distribution de la K7, livraison 1 (spec 2026-11-17, § 7) =====
const H = 3600_000, D = 24 * H, M = 60_000;
test('DISTRIBUTION: échéance du panneau « Votre K7 est prête »', () => {
  const t = Date.UTC(2026, 10, 19, 17, 42);
  assert.equal(K.readyUntilText(t, 'Europe/Paris'), 'À rendre avant le 19 novembre à 18:42');
});
test('DISTRIBUTION: temps restant d\'une location', () => {
  const now = Date.UTC(2026, 10, 17, 12, 0);
  assert.equal(K.timeLeftLabel(now + 2 * D + 4 * H + 10 * M, now), 'encore 2 j 4 h');
  assert.equal(K.timeLeftLabel(now + 2 * D + 20 * M, now), 'encore 2 j');
  assert.equal(K.timeLeftLabel(now + 3 * H + 5 * M, now), 'encore 3 h 05');
  assert.equal(K.timeLeftLabel(now + 42 * M, now), 'encore 42 min');
  assert.equal(K.timeLeftLabel(now + 20_000, now), 'encore 1 min');
  assert.equal(K.timeLeftLabel(now, now), 'expirée');
  assert.equal(K.timeLeftLabel(now - H, now), 'expirée');
});
test('DISTRIBUTION: lignes de « Mes locations », la plus proche de l\'échéance d\'abord', () => {
  const now = 0;
  const rows = K.rentalRows([{ filmId: 2, expiresAt: 5 * H }, { filmId: 9, expiresAt: 2 * H }],
    [{ id: 2, title: 'Get Out' }], now);
  assert.deepEqual(rows.map(r => r.filmId), [9, 2]);
  assert.equal(rows[0].title, 'Titre indisponible');
  assert.equal(rows[1].title, 'Get Out');
  assert.equal(rows[1].timeLeft, 'encore 5 h 00');
  assert.deepEqual(K.rentalRows([], [], now), []);
});
test('DISTRIBUTION: geste retour — rien pendant l\'attente, ferme le panneau puis le compte', () => {
  const base = { playerOpen: false, noticeOpen: false, noticeClosable: true, authOpen: false, phrasePending: false, searchOpen: false };
  assert.equal(K.kioskBackAction({ ...base, waiting: true }), 'none');
  assert.equal(K.kioskBackAction({ ...base, waiting: true, readyOpen: true }), 'none');
  assert.equal(K.kioskBackAction({ ...base, readyOpen: true, accountOpen: true }), 'close-ready');
  assert.equal(K.kioskBackAction({ ...base, accountOpen: true, detailOpen: true }), 'close-account');
  assert.equal(K.kioskBackAction({ ...base, playerOpen: true, readyOpen: true }), 'close-player');
  assert.equal(K.kioskBackAction({ ...base, noticeOpen: true, waiting: true }), 'close-notice');
});


// ===== « Mon compte » (spec 2026-11-17-borne-mon-compte, § 4) =====
const hist = (o = {}) => ({ filmId: 1, title: 'Get Out', posterUrl: '/p.jpg', rentedAt: 1000, returnedAt: 5000, isActive: false,
  expiresAt: 5000, watchProgress: 100, rewindClaimed: false, returnedEarly: false, returnDate: null, expiredDate: null, ...o });
test('COMPTE: l\'historique — rendu, expiré ou terminé, du plus récent au plus ancien, sans les locations en cours', () => {
  const rows = K.accountHistoryRows([
    hist({ filmId: 1, rentedAt: 1000, returnDate: 4000, rewindClaimed: true, returnedEarly: true }),
    hist({ filmId: 2, rentedAt: 3000, expiredDate: 6000 }),
    hist({ filmId: 3, rentedAt: 2000 }),
    hist({ filmId: 4, rentedAt: 9000, isActive: true }),
    hist({ filmId: 5, rentedAt: 500, title: null }),
  ], new Set(), {});
  assert.deepEqual(rows.map(r => r.filmId), [2, 3, 1, 5]);
  assert.deepEqual(rows[0].end, { kind: 'expiré', atMs: 6000 });
  assert.deepEqual(rows[1].end, { kind: 'terminée', atMs: null });
  assert.deepEqual(rows[2].end, { kind: 'rendu', atMs: 4000 });
  assert.equal(rows[2].rewound, true);
  assert.equal(rows[2].returnedEarly, true);
  assert.equal(rows[0].rewound, false);
  assert.equal(rows[3].title, 'Titre indisponible');
  assert.deepEqual(K.accountHistoryRows([], new Set(), {}), []);
});
test('COMPTE: l\'état de la critique d\'un film', () => {
  const elig = { 2: { allowed: true, reason: null, availableAtMs: null }, 3: { allowed: false, reason: 'Critique possible à partir du 19 novembre à 21:10', availableAtMs: 1 } };
  assert.deepEqual(K.reviewStateFor(1, new Set([1]), elig), { kind: 'publiée' });
  assert.deepEqual(K.reviewStateFor(2, new Set(), elig), { kind: 'possible' });
  assert.deepEqual(K.reviewStateFor(3, new Set(), elig), { kind: 'pas-encore', reason: 'Critique possible à partir du 19 novembre à 21:10' });
  assert.deepEqual(K.reviewStateFor(9, new Set(), elig), { kind: 'pas-encore', reason: 'Vous devez regarder au moins 80 % du film' });
});
test('CRITIQUE (borne): ce qui manque pour publier', async () => {
  // À côté du minimum de 144 (review-rules.ts) : kiosk-logic n'importe que des types.
  const { reviewFormCheck } = await import('../../src/utils/review-rules.ts');
  assert.equal(reviewFormCheck({ length: 143, ratings: [4, 4, 4] }), 'Encore 1 caractère');
  assert.equal(reviewFormCheck({ length: 100, ratings: [4, 4, 4] }), 'Encore 44 caractères');
  assert.equal(reviewFormCheck({ length: 144, ratings: [4, 0, 4] }), 'Donnez les trois notes');
  assert.equal(reviewFormCheck({ length: 144, ratings: [1, 5, 3] }), null);
});
test('CRITIQUE (borne): le geste retour ferme le formulaire avant le compte', () => {
  const base = { playerOpen: false, noticeOpen: false, noticeClosable: true, authOpen: false, phrasePending: false, searchOpen: false };
  assert.equal(K.kioskBackAction({ ...base, reviewOpen: true, accountOpen: true }), 'close-review');
});
test('PANNEAU: « Où voulez-vous regarder ? » dit où et comment', () => {
  assert.equal(K.watchHereLabel({ coarsePointer: true, shortSide: 412 }), 'Sur ce téléphone');
  assert.equal(K.watchHereLabel({ coarsePointer: true, shortSide: 820 }), 'Sur cette tablette');
  assert.equal(K.watchHereLabel({ coarsePointer: false, shortSide: 900 }), 'Sur cet ordinateur');
  assert.equal(K.tvMeansLabel(false), 'via Chromecast');
  assert.equal(K.tvMeansLabel(true), 'via AirPlay');
});

// ===== Refonte du Cast, tâche 7 : « Où voulez-vous regarder ? » pour chaque reprise de film =====
// docs/superpowers/specs/2026-11-18-cast-refonte-design.md, § 5.4 et § 5.5 point 6.
test('CAST BORNE: la TV a déjà ce film, ne répond plus pour lui ou vient de le finir → le lecteur ; sinon le panneau', () => {
  for (const view of ['remote', 'lost', 'ended']) assert.equal(K.watchEntry({ view }), 'remote', view);
  // Un autre film sur la TV, ou rien : on demande où regarder (le panneau, jamais l'invite du lecteur).
  for (const view of ['local', 'other-on-tv', 'choosing', 'connecting', 'loading']) assert.equal(K.watchEntry({ view }), 'choose', view);
});
test('CAST BORNE: « Sur ma télé » passe par AirPlay sur un appareil Apple qui le sait, par le Cast partout ailleurs', async () => {
  assert.equal(K.tvEntry({ airPlay: true }), 'airplay');
  assert.equal(K.tvEntry({ airPlay: false }), 'cast');
  // Avec la détection réelle (cast-on-open.ts), lue sur l'élément vidéo.
  const { appleAirPlay } = await import('../../src/utils/cast-on-open.ts');
  const picker = { webkitShowPlaybackTargetPicker() {} };
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const macChrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0 Safari/537.36';
  const pixel = 'Mozilla/5.0 (Linux; Android 17; Pixel 9a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0 Mobile Safari/537.36';
  assert.equal(K.tvEntry({ airPlay: appleAirPlay(iphone, picker) }), 'airplay', 'Safari sur iPhone');
  assert.equal(K.tvEntry({ airPlay: appleAirPlay(macChrome, {}) }), 'cast', 'Chrome sur Mac : pas d\'AirPlay, le Cast');
  assert.equal(K.tvEntry({ airPlay: appleAirPlay(pixel, picker) }), 'cast', 'Android');
});
test('CAST BORNE: la barre du Cast écrit l\'état dans la casse de la borne, avec les mots de cast-labels', async () => {
  const { castChipLabel } = await import('../../src/cast/cast-labels.ts');
  assert.equal(K.kioskLabelCase(castChipLabel('remote')), 'Télécommande');
  assert.equal(K.kioskLabelCase(castChipLabel('lost')), 'La télé ne répond plus');
  assert.equal(K.kioskLabelCase(castChipLabel('ended')), 'Film terminé');
  assert.equal(K.kioskLabelCase(''), '');
});
test('CAST BORNE: « Sur ma télé » dit qu\'il remplacera le film que joue la TV, avant l\'appui (correctif 1)', async () => {
  const { castDeviceLabel } = await import('../../src/cast/cast-labels.ts');
  assert.equal(K.tvChoiceLine({ airPlay: false, replacing: null }), 'via Chromecast');
  assert.equal(K.tvChoiceLine({ airPlay: true, replacing: null }), 'via AirPlay');
  assert.equal(K.tvChoiceLine({ airPlay: false, replacing: { title: 'Dune : Deuxième partie', device: castDeviceLabel('Salon') } }), 'remplace Dune : Deuxième partie sur Salon');
  // Titre absent du catalogue de la borne, appareil sans nom connu (page rechargée).
  assert.equal(K.tvChoiceLine({ airPlay: false, replacing: { title: null, device: castDeviceLabel(null) } }), 'remplace un film sur la télé');
  assert.equal(K.tvChoiceLine({ airPlay: false, replacing: { title: '  ', device: castDeviceLabel('  ') } }), 'remplace un film sur la télé');
  // AirPlay ne passe pas par le Cast : il ne remplace rien sur la TV du Cast.
  assert.equal(K.tvChoiceLine({ airPlay: true, replacing: { title: 'Dune', device: 'Salon' } }), 'via AirPlay');
});
test('CAST BORNE: la barre du Cast dit ce que fait l\'appui, pour un lecteur d\'écran (correctif 1)', () => {
  assert.equal(K.castBarLabel('remote', 'Dune'), 'Ouvrir la télécommande de Dune');
  assert.equal(K.castBarLabel('lost', 'Dune'), 'Dune : la télé ne répond plus, ouvrir');
  assert.equal(K.castBarLabel('ended', 'Dune'), 'Dune est terminé, ouvrir');
  for (const phase of ['idle', 'choosing', 'connecting', 'loading']) assert.equal(K.castBarLabel(phase, 'Dune'), null, phase);
});
test('CAST BORNE: « Location terminée » se montre lecteur fermé ; un lecteur resté ouvert sans location est d\'abord fermé', () => {
  // Le lecteur ne dessine rien sans location, mais reste « ouvert » : la borne, inerte sous lui, ne pourrait pas
  // faire fermer le message.
  assert.equal(K.rentalOverStep({ playerOpen: false, playerHasRental: false }), 'show');
  assert.equal(K.rentalOverStep({ playerOpen: false, playerHasRental: true }), 'show');
  assert.equal(K.rentalOverStep({ playerOpen: true, playerHasRental: false }), 'close-player');
  // Un autre film se regarde ici : le message attend que le lecteur se ferme.
  assert.equal(K.rentalOverStep({ playerOpen: true, playerHasRental: true }), 'wait');
});
test('CAST BORNE: la barre du Cast prend sa place entre LOUER et la bande, sans rien pousser hors de l\'écran', () => {
  for (const [name, q] of Object.entries(PHONES)) {
    const L = K.phoneLayout(q, true);
    const plain = K.phoneLayout(q);
    assert.ok(L.castH * q >= 44 - 0.01, name + ' : barre de 44 px au moins');
    assert.ok(L.castTop >= L.btnTop + L.btnH + 1.8 - 0.01, name + ' : sous LOUER');
    assert.ok(L.stripTop >= L.castTop + L.castH + 1.8 - 0.01, name + ' : au-dessus de la bande, sans la recouvrir');
    assert.ok(Math.abs(L.stripTop + L.stripH + 2.4 - 180) < 0.01, name + ' : la bande finit au bas de l\'écran');
    assert.ok(L.stripH >= 30 - 0.01, name + ' : la bande garde une hauteur correcte');
    assert.ok(2 * L.railPosterH + 1 <= 70.4 + 0.01, name + ' : trois jaquettes tiennent entre les flèches');
    if (L.showUnder) assert.ok(L.btnTop >= L.underTop + L.underH + 2 - 0.01, name + ' : LOUER sous le cadre « En bref »');
    // Les commandes et la fiche ne bougent pas : seule la place du cadre « En bref » et de la bande se répartit.
    for (const k of ['navH', 'tabH', 'btnH', 'cardTop', 'cardH', 'underTop']) assert.equal(L[k], plain[k], `${name} : ${k}`);
    assert.ok(L.underH <= plain.underH, name + ' : le cadre « En bref » cède d\'abord');
  }
  // Sans barre, la mise en page validée le 17/11 ne change pas.
  assert.deepEqual(K.phoneLayout(PHONES.pixel9a, false), K.phoneLayout(PHONES.pixel9a));
  assert.equal(K.phoneLayout(PHONES.pixel9a).castH, 0, 'sans barre, aucune place réservée');
  assert.ok(Object.values(K.phoneLayout(0, true)).every((v) => typeof v === 'boolean' || Number.isFinite(v)), 'mesure absente : pas de NaN');
  const vars = K.phoneLayoutVars(K.phoneLayout(4, true));
  assert.equal(vars['--k-cast-h'], '11cqw');
  assert.ok(/cqw$/.test(vars['--k-cast-top']));
});
