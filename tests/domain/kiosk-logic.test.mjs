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
  assert.deepEqual(res, { status: 'error', message: 'Non authentifié' });
  assert.equal(lock.busy, false);
});
test('BORNE: le formulaire de connexion dit ce qui manque au lieu d\'échouer en silence', () => {
  const ok = { username: 'ana', password: 'secret', confirm: 'secret', phrase: 'un deux trois' };
  assert.equal(K.authFormError('login', { ...ok, confirm: '', phrase: '' }), null);
  assert.equal(K.authFormError('login', { ...ok, username: '  ' }), 'Saisissez votre pseudo.');
  assert.equal(K.authFormError('login', { ...ok, password: '' }), 'Saisissez votre mot de passe.');
  assert.equal(K.authFormError('register', { ...ok, confirm: 'autre' }), 'Les deux mots de passe ne sont pas identiques.');
  assert.equal(K.authFormError('recover', { ...ok, phrase: '' }), 'Saisissez votre phrase de récupération.');
  assert.equal(K.authFormError('recover', ok), null);
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
