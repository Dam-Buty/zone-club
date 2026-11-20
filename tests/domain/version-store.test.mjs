import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readText } from '../helpers/repo.mjs';

// La tranche « Versions » du magasin (src/store/slices/version.ts ; spec
// docs/superpowers/specs/2026-11-19-versions-et-erreurs-de-lecture-design.md, § 4.1 et 4.2). Gardes statiques : la
// tranche tire l'API du navigateur, absente de Node ; la décision qu'elle appelle (decideVersion) est testée dans
// version-choice.test.mjs, la préférence côté serveur dans version-pref.test.mjs.

const ROOT = process.cwd();
const read = (rel) => readText(path.join(ROOT, rel));
const SLICE = 'src/store/slices/version.ts';
const STORE = 'src/store/index.ts';

/** Le texte entre deux repères (le premier trouvé après `start`). */
function between(src, start, end) {
  const i = src.indexOf(start);
  assert.ok(i >= 0, `repère introuvable : ${start}`);
  const j = src.indexOf(end, i + start.length);
  assert.ok(j > i, `repère introuvable après ${start} : ${end}`);
  return src.slice(i, j);
}

test('VERSIONS MAGASIN: la tranche existe et le magasin la fusionne', () => {
  const slice = read(SLICE);
  assert.ok(slice.includes('export const createVersionSlice'), 'la tranche exporte son créateur');
  assert.ok(slice.includes('export interface VersionSlice'), 'et son type');
  assert.ok(/export function versionDecisionFor\(state: VideoClubState, filmId: number\): VersionDecision/.test(slice), 'versionDecisionFor exportée, signature du plan');
  const store = read(STORE);
  assert.ok(store.includes("from './slices/version'"), 'le magasin importe la tranche');
  assert.ok(store.includes('...createVersionSlice(set, get, store)'), 'le magasin la fusionne comme les autres');
  assert.ok(/interface VideoClubState extends CastSlice, VersionSlice\b/.test(store), 'VideoClubState porte le type de la tranche');
  const iface = between(slice, 'export interface VersionSlice', '\n}');
  assert.match(iface, /versionPref: VersionChoice \| null/);
  assert.match(iface, /filmVersions: Record<number, VersionChoice>/);
  assert.match(iface, /setVersionPref: \(pref: VersionChoice \| null\) => Promise<boolean>/);
  assert.match(iface, /chooseFilmVersion: \(filmId: number, v: VersionChoice\) => void/);
});

test('VERSIONS MAGASIN: le choix par film est retenu sur l\'appareil, la version préférée jamais', () => {
  const partialize = between(read(STORE), 'partialize:', '}),');
  assert.ok(partialize.includes('filmVersions: state.filmVersions'), 'filmVersions est persisté');
  assert.ok(!partialize.includes('versionPref'), 'versionPref n\'est pas persisté : le serveur la tient');
});

test('VERSIONS MAGASIN: fetchMe écrit la version préférée lue sur le serveur et oublie les choix des locations finies', () => {
  const store = read(STORE);
  const fetchMe = between(store, 'fetchMe: async () => {', '// User local (fallback)');
  const success = fetchMe.slice(0, fetchMe.indexOf('catch'));
  assert.match(success, /versionPref: data\.user\.version_pref \?\? null/, 'versionPref vient de /api/me');
  assert.match(success, /filmVersions: prunedFilmVersions\(get\(\)\.filmVersions, data\.activeRentals\.map\(\(r\) => r\.film_id\)\)/, 'élagage sur les locations actives lues');
  // Sur un échec (non connecté, panne) : plus de préférence de compte, mais les choix de l'appareil restent.
  const failure = fetchMe.slice(fetchMe.indexOf('catch'));
  assert.match(failure, /versionPref: null/, 'hors connexion, pas de préférence de compte');
  assert.ok(!failure.includes('filmVersions'), 'une lecture ratée n\'efface pas les choix retenus sur l\'appareil');
  assert.match(store, /import \{ prunedFilmVersions \} from '\.\.\/utils\/version-choice'/, 'l\'élagage est la fonction pure testée');
});

test('VERSIONS MAGASIN: refreshRentals oublie aussi les choix des locations finies, dans sa seule écriture, sans toucher la préférence', () => {
  const refresh = between(read(STORE), 'refreshRentals: async () => {', 'fetchMe: async () => {');
  assert.equal((refresh.match(/\bset\(/g) ?? []).length, 1, 'une seule écriture');
  const write = refresh.slice(refresh.indexOf('set({'));
  assert.match(write, /filmVersions: prunedFilmVersions\(get\(\)\.filmVersions, data\.activeRentals\.map\(\(r\) => r\.film_id\)\)/);
  assert.ok(!refresh.includes('versionPref'), 'seul fetchMe lit la préférence');
});

test('VERSIONS MAGASIN: logout remet versionPref à null et vide filmVersions', () => {
  const logout = between(read(STORE), 'logout: async', 'clearAuthError:');
  const write = logout.slice(logout.indexOf('set({'));
  assert.match(write, /versionPref: null/);
  assert.match(write, /filmVersions: \{\}/);
});

test('VERSIONS MAGASIN: setVersionPref n\'écrit le magasin qu\'après le oui du serveur', () => {
  const slice = read(SLICE);
  const body = between(slice, 'setVersionPref: async (pref) => {', 'chooseFilmVersion:');
  const call = body.indexOf('await api.me.setVersionPref(pref)');
  const write = body.indexOf('set({ versionPref:');
  assert.ok(call > 0 && write > call, 'l\'appel au serveur précède l\'écriture du magasin');
  assert.equal((body.match(/\bset\(/g) ?? []).length, 1, 'une seule écriture');
  // Un refus (400, 401) ou une panne : rien n'est écrit, l'appelant le sait.
  const failure = body.slice(body.indexOf('catch'));
  assert.match(failure, /return false/);
  assert.ok(!failure.includes('set('), 'rien n\'est écrit sur un échec');
  assert.match(body.slice(write), /return true/, 'vrai seulement après l\'écriture');
  // Une réponse revenue pour un autre compte (déconnexion pendant l'appel) n'écrit rien.
  assert.ok(body.indexOf('authUser?.id') < call && body.lastIndexOf('authUser?.id') > call && body.lastIndexOf('authUser?.id') < write, 'le compte est revérifié entre la réponse et l\'écriture');
});

test('VERSIONS MAGASIN: un choix fait sur un film ne touche jamais la version préférée', () => {
  const slice = read(SLICE);
  const choose = between(slice, 'chooseFilmVersion: (filmId, v) =>', '\n})');
  assert.match(choose, /filmVersions: \{ \.\.\.s\.filmVersions, \[filmId\]: v \}/, 'le choix est rangé pour ce film');
  assert.ok(!choose.includes('versionPref'), 'la préférence n\'est jamais déduite d\'un choix');
  // Dans le magasin, la préférence ne s'écrit qu'à la lecture du compte (fetchMe) et à la déconnexion.
  const store = read(STORE);
  const writes = [...store.matchAll(/versionPref:/g)].map((m) => m.index);
  // Les repères de fin existent aussi dans l'interface, plus haut : cherchés après le début du bloc.
  const span = (start, end) => { const i = store.indexOf(start); return [i, store.indexOf(end, i)]; };
  const fetchMe = span('fetchMe: async () => {', '// User local (fallback)');
  const logout = span('logout: async () => {', 'clearAuthError:');
  assert.ok(fetchMe[0] > 0 && fetchMe[1] > fetchMe[0] && logout[0] > 0 && logout[1] > logout[0], 'blocs fetchMe et logout trouvés');
  assert.ok(writes.length === 3, `trois écritures dans le magasin (succès et échec de fetchMe, logout) : ${writes.length}`);
  for (const at of writes) {
    const inside = (at > fetchMe[0] && at < fetchMe[1]) || (at > logout[0] && at < logout[1]);
    assert.ok(inside, `versionPref: écrit hors de fetchMe et de logout (position ${at})`);
  }
});

test('VERSIONS MAGASIN: versionDecisionFor passe par la décision unique, avec l\'offre de la location, le choix du film et la préférence', () => {
  const slice = read(SLICE);
  const fn = between(slice, 'export function versionDecisionFor(', '\n}');
  assert.match(fn, /decideVersion\(\{/, 'la seule décision de version');
  assert.match(fn, /offer: versionOffer\(state\.getRental\(filmId\)\?\.streamingUrls\)/, 'l\'offre de la location (prévisualisation comprise)');
  assert.match(fn, /state\.filmVersions\[filmId\]/, 'le choix fait pour ce film');
  assert.match(fn, /parseVersionChoice\(/, 'un choix illisible sur l\'appareil compte comme pas de choix');
  assert.match(fn, /pref: state\.versionPref/, 'la version préférée du compte');
  // Aucun autre code ne choisit « vf » d'office.
  assert.ok(!/'vf'/.test(slice), 'la tranche n\'écrit jamais \'vf\' en dur');
});

test('VERSIONS MAGASIN: le client envoie PATCH /api/me/version avec les deux champs nommés, null pour « Automatique »', () => {
  const src = read('src/api/index.ts');
  const user = between(src, 'export interface ApiUser {', '\n}');
  assert.match(user, /version_pref\?: VersionChoice \| null;/, 'ApiUser.version_pref');
  assert.match(src, /import type \{ VersionChoice \} from '\.\.\/utils\/version-choice'/);
  const me = between(src, 'export const me = {', '\n};');
  const fn = between(me, 'async setVersionPref(pref: VersionChoice | null): Promise<{ version_pref: VersionChoice | null }>', '},');
  assert.match(fn, /'\/api\/me\/version'/);
  assert.match(fn, /method: 'PATCH'/);
  assert.match(fn, /body: JSON\.stringify\(\{ audio: pref\?\.audio \?\? null, subtitle: pref\?\.subtitle \?\? null \}\)/, 'deux champs nommés, null compris');
});
