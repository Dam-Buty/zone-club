# Borne de location — lot 1, tranche a — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Bandeau du 16/11/2026 — ce plan a été exécuté ; voici ce qui a changé depuis.** Son texte est
> laissé tel qu'il a été suivi.
>
> - **Tarif.** Le plan dit que la borne garde « la même règle qu'aujourd'hui » : c'était faux. La
>   règle du client (année de sortie) différait de celle du serveur (nouveauté marquée, rayon
>   Classiques) ; l'affichage a été aligné sur le serveur — `src/utils/rental-tier.ts`, commit
>   `290796b`. Décision validée par Rusmir.
> - **Écart n° 1, scène gelée si elle était prête.** Remplacé : la scène est démontée à l'ouverture
>   de la borne dans tous les cas, et les préchargements 3D sont coupés.
> - **Geste retour, paysage sur téléphone, ouverture sans écran noir, « Se reconnecter », règles
>   du formulaire** : décidés après la relecture — voir le bandeau du document de conception et
>   la section « Borne de location » d'`AGENTS.md`.

**Goal:** Depuis la devanture, n'importe quel appareil — même sans WebGPU — peut ouvrir la borne, trouver un film, le louer, le regarder et l'envoyer sur un Chromecast, sans qu'aucun rendu 3D ne tourne.

**Architecture:** La borne est une troisième scène de l'application (`currentScene === 'kiosk'`), dans la même page et le même magasin d'état que le reste. Son interface est du DOM pur (`src/components/kiosk/`), dessinée en unités `cqw` d'après la maquette validée ; elle réutilise tel quel le lecteur (`VHSPlayer`) et les actions du magasin (`login`, `register`, `rentFilm`, `openPlayer`) ; la connexion y est redessinée dans sa charte. Toute la logique décidable vit dans un module pur testé (`kiosk-logic.ts`).

**Tech Stack:** Next.js 16, React 19, Zustand 5, CSS Modules avec container queries, tests `node --test` (Node 24, import direct des `.ts`).

**Spec:** `docs/superpowers/specs/2026-11-16-borne-location-design.md` (validé le 16/11/2026). Maquette de l'écran : `docs/superpowers/specs/2026-11-16-borne-maquette-ecran.html` (copiée en tâche 0).

**Périmètre :** ce plan couvre la **tranche a** du lot 1 (spec, section 10). La tranche b (règle des crédits), la tranche c (critiques, bande-annonce, compte complet, retour par la fente, commande d'un film absent), le lot 2 (seuil) et le lot 3 (devanture Blender) auront chacun leur plan.

## Global Constraints

- L'interface de la borne n'utilise **ni WebGPU ni WebGL**, ni `backdrop-filter`, ni `<canvas>`. Aucun import de `three` ou de `@react-three/*` sous `src/components/kiosk/`.
- La borne ne doit **jamais** déclencher le préchauffage de la scène intérieure, ni appeler `selectFilm` (qui lance la génération de jaquette sur canvas 2D).
- Habillage : métal sombre et néon violet pour le corps ; écran bleu profond, boutons turquoise, bouton d'action orange. **Pas de rouge, aucune marque ni logo des bornes de référence.**
- Écran en portrait **2:3**. Sur mobile il occupe **90 %** de la largeur ; sur PC il prend la hauteur.
- Textes d'interface en français, accents corrects, vouvoiement.
- Pas de bouton `disabled` muet : un bouton reste actif et explique le refus (leçon d'`AGENTS.md`).
- Aucune nouvelle dépendance npm. Aucun fichier au-dessus de 1000 lignes.
- La porte du vidéoclub n'est jamais verrouillée pour un appareil qui a WebGPU.
- Git : branche `feat/borne-location` partie de `origin/main` ; jamais `git add -A` ; commits locaux seulement, **push et PR sur demande de Rusmir** ; messages terminés par les deux lignes d'attribution de la session.
- Serveur de dev du worktree sur le **port 3002** (le 3001 est occupé par celui de Rusmir, le 3000 est interdit).
- Avant tout build de vérification : `rm -rf .next`.

## Écarts par rapport au spec — tranchés par Rusmir le 16/11/2026

Acceptés :

1. **Suspension de la scène intérieure.** Le spec disait que la préparation « reprend là où elle s'était arrêtée ». Retenu : si la scène est déjà prête quand la borne s'ouvre, elle reste montée et son rendu est gelé (`frameloop="never"`) ; si elle est encore en préparation, elle est **démontée**, et la préparation repart du début quand le visiteur revient à la devanture. Raison : mettre en pause la boucle de préchauffage en plein milieu touche le code le plus fragile du projet.
2. **Crédits insuffisants.** Tant que la tranche b n'est pas livrée, la borne dit seulement combien il manque.
3. **Barre du haut.** « compte » ouvre la connexion ou un résumé (pseudo, crédits, déconnexion) ; « retour » n'est pas affiché avant la tranche c.
4. **Sans WebGPU, pas de service worker** : son installation précharge les assets 3D, inutiles à ces appareils. Conséquence : pas de notification « film terminé sur la TV » pour eux.

Refusé :

5. ~~La connexion garde son apparence actuelle.~~ **La connexion et l'inscription prennent la charte graphique de la borne, par cohérence** (tâche 6). `AuthModal` n'est pas utilisé sous `src/components/kiosk/`. Le lecteur, lui, garde son affichage actuel.

## Review Focus

1. **Catalogue pas encore arrivé, ou en échec, à l'ouverture de la borne** → « Chargement du catalogue… », puis après 8 s « Catalogue indisponible » avec un bouton « Réessayer » ; jamais un écran vide. Test en tâche 1 (`catalogState`), branchement en tâche 5.
2. **Double appui sur LOUER, ou réseau lent** → une seule location, le second appui est ignoré. Test en tâche 1 (`rentFlow`).
3. **Session expirée** (le magasin croit le visiteur connecté, le serveur refuse) → le message du serveur est affiché avec un bouton « Se reconnecter » ; pas d'échec silencieux. Test en tâche 1 (`rentFlow`, branche erreur), branchement en tâche 7.
4. **Film sans jaquette, ou jaquette qui ne charge pas** → une vignette de remplacement portant le titre, pas d'icône cassée. Test en tâche 1 (`posterSrc`), branchement en tâche 5.
5. **Téléphone en paysage ou fenêtre très basse** (hauteur ≈ 390 px) → l'écran 2:3 se cale sur la hauteur disponible, rien n'est coupé ni inaccessible. Vérification visuelle en tâche 9 (aucun test automatique possible sans navigateur).

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| `src/components/kiosk/kiosk-logic.ts` (nouveau) | Logique pure : onglets, listes, tris, libellés, décision du bouton, déroulé d'une location |
| `src/utils/rental-tier.ts` (nouveau) | `getRentalTier`, sorti de `VHSCaseOverlay.tsx` pour être partagé |
| `src/components/kiosk/KioskView.tsx` + `.module.css` (nouveaux) | Coque : corps de la borne, écran, barre du haut, bascule parcourir / recherche, messages |
| `src/components/kiosk/KioskBrowse.tsx` (nouveau) | Rayons, fiche, bouton d'action, bande de jaquettes |
| `src/components/kiosk/KioskSearch.tsx` (nouveau) | Recherche par titre |
| `src/components/kiosk/KioskNotice.tsx` (nouveau) | Message dans l'écran (titre, texte, un ou deux boutons) |
| `src/components/kiosk/KioskAuth.tsx` (nouveau) | Connexion, inscription, récupération du compte, dans la charte de la borne |
| `src/components/exterior/DoorBlockedNotice.tsx` (nouveau) | Message de la porte, bouton vers la borne, minuteur |
| `src/components/exterior/ExteriorView.tsx` + `.module.css` | Vidéo d'attente retirée, bouton provisoire de la borne, porte bloquée sans WebGPU, repli sans WebGL |
| `src/utils/interior-preload-gate.ts` | `hasWebGPU()` ; la vanne ne s'ouvre pas sans WebGPU |
| `src/types/index.ts` | `SceneType` gagne `'kiosk'` |
| `src/App.tsx` | Plus d'écran d'excuses en tête ; scène borne ; montage et gel de la scène intérieure |
| `src/components/interior/InteriorScene.tsx` | Prop `suspended` → `frameloop` du Canvas |
| Supprimés | `src/components/exterior/IdleVideo.tsx`, `IdleVideo.module.css`, `src/hooks/useIdleDetection.ts` |
| `tests/domain/kiosk-logic.test.mjs`, `rental-tier.test.mjs`, `kiosk-wiring.test.mjs` (nouveaux) | Tests |

`public/videoclubvideo.mp4` reste en place (la vidéo est désactivée, pas supprimée) ; `npm run audit:unused` le signalera comme orphelin, c'est attendu.

---

### Task 0 : Branche de travail et socle

**Files:**
- Create: worktree `../video-club-webgpu-borne` sur la branche `feat/borne-location`
- Create: `docs/superpowers/specs/2026-11-16-borne-maquette-ecran.html`
- Add: `docs/superpowers/specs/2026-11-16-borne-location-design.md`, `docs/superpowers/plans/2026-11-16-borne-tranche-a.md`

- [ ] **Step 1 : créer le worktree depuis `origin/main`**

```bash
cd ~/projetsperso/video-club-webgpu && git fetch origin
git worktree add ../video-club-webgpu-borne -b feat/borne-location origin/main
```

- [ ] **Step 2 : y copier le spec, le plan et la maquette**

Copier depuis la copie de travail principale : le spec, ce plan, et `.superpowers/brainstorm/83786-1794781814/content/borne-ecran-v2.html` vers `docs/superpowers/specs/2026-11-16-borne-maquette-ecran.html`.

- [ ] **Step 3 : rendre le worktree exécutable**

`npm ci` dans le worktree ; copier `.env` et `zone.db` depuis la copie principale (fichiers locaux, jamais commités — vérifier par `git status` qu'ils sont ignorés).

- [ ] **Step 4 : relever la ligne de base des tests**

Run: `npm run test:phase 2>&1 | tail -15`
Noter le nombre de tests OK et en échec **avant toute modification** : c'est la référence des tâches suivantes (les échecs préexistants connus : tests d'intégration visant le port 3000, budget de taille, `P-01`, `sf-island-fill`).

- [ ] **Step 5 : commit**

```bash
git add docs/superpowers/specs/2026-11-16-borne-location-design.md docs/superpowers/specs/2026-11-16-borne-maquette-ecran.html docs/superpowers/plans/2026-11-16-borne-tranche-a.md
git commit -m "docs(borne): document de conception, maquette et plan de la tranche a"
```

---

### Task 1 : Logique pure de la borne

**Files:**
- Create: `src/components/kiosk/kiosk-logic.ts`, `src/utils/rental-tier.ts`
- Modify: `src/components/videoclub/VHSCaseOverlay.tsx:26-32` (supprimer `getRentalTier` local, l'importer)
- Test: `tests/domain/kiosk-logic.test.mjs`, `tests/domain/rental-tier.test.mjs`

**Interfaces:**
- Consumes: types `Film`, `AisleType`, `RentalTier` de `src/types` (**imports de type uniquement** : ces deux modules sont chargés tels quels par Node dans les tests, un import de valeur sans extension casserait).
- Produces (`src/utils/rental-tier.ts`) :
  - `getRentalTier(film: Pick<Film, 'release_date'>, now?: Date): RentalTier` — même règle qu'aujourd'hui : 1 an ou moins → `'nouveaute'`, 20 ans ou plus → `'classique'`, sinon `'standard'`.
- Produces (`src/components/kiosk/kiosk-logic.ts`) :
  - `type KioskTab = AisleType | 'tous'` ; `type KioskSort = 'rayon' | 'alpha' | 'date'`
  - `KIOSK_TABS: ReadonlyArray<{ id: KioskTab; label: string }>` dans cet ordre et avec ces libellés : `nouveautes` Nouveautés, `action` Action, `aventure` Aventure, `comedie` Comédie, `drame` Drame, `horreur` Horreur, `policier` Policier, `romance` Romance, `sf` SF, `thriller` Thriller, `animation` Animation, `classiques` Classiques, `bizarre` Bizarre, `tous` Tous
  - `KIOSK_TAB_PAGE_SIZE = 7` ; `tabPages(): KioskTab[][]` ; `tabLabel(id: KioskTab): string`
  - `allFilms(films: Record<AisleType, Film[]>): Film[]` — sans doublon (un film peut être en rayon et en nouveauté)
  - `filmsForTab(films: Record<AisleType, Film[]>, tab: KioskTab, sort: KioskSort): Film[]`
  - `CATALOG_WAIT_MS = 8000` ; `catalogState(total: number, waitedMs: number): 'ready' | 'loading' | 'unavailable'`
  - `posterSrc(film: Pick<Film, 'poster_path'>, size: 'w185' | 'w342'): string | null`
  - `formatRuntime(minutes: number | null | undefined): string` ; `releaseYear(film: Pick<Film, 'release_date'>): string` ; `versionLabel(v: { vf: boolean; vo: boolean } | null): string` ; `synopsisText(overview: string | null | undefined): string`
  - `type RentAction = 'login' | 'watch' | 'unavailable' | 'out-of-stock' | 'insufficient' | 'rent'`
  - `rentAction(i: { isAuthenticated: boolean; isRented: boolean; isAvailable: boolean; copiesLeft: number | null; credits: number; cost: number }): RentAction`
  - `rentFlow(deps: { rent: () => Promise<unknown>; setMode: () => Promise<unknown> }, lock: { busy: boolean }): Promise<{ status: 'ok' } | { status: 'busy' } | { status: 'error'; message: string }>`
  - `type KioskAuthMode = 'login' | 'register' | 'recover'`
  - `authFormError(mode: KioskAuthMode, f: { username: string; password: string; confirm: string; phrase: string }): string | null` — premier refus dans cet ordre, ou `null` : pseudo vide → « Saisissez votre pseudo. » ; mot de passe vide → « Saisissez votre mot de passe. » ; en `recover`, phrase vide → « Saisissez votre phrase de récupération. » ; en `register` et `recover`, confirmation différente → « Les deux mots de passe ne sont pas identiques. »

- [ ] **Step 1 : écrire les tests qui échouent**

`tests/domain/rental-tier.test.mjs` :

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { getRentalTier } from '../../src/utils/rental-tier.ts';

const NOW = new Date('2026-11-16T12:00:00Z');
test('TARIF: un film de l\'année ou de l\'année précédente est une nouveauté', () => {
  assert.equal(getRentalTier({ release_date: '2026-01-01' }, NOW), 'nouveaute');
  assert.equal(getRentalTier({ release_date: '2025-01-01' }, NOW), 'nouveaute');
});
test('TARIF: vingt ans ou plus = classique, entre les deux = standard', () => {
  assert.equal(getRentalTier({ release_date: '2006-01-01' }, NOW), 'classique');
  assert.equal(getRentalTier({ release_date: '2014-01-01' }, NOW), 'standard');
});
```

`tests/domain/kiosk-logic.test.mjs` :

```js
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
```

- [ ] **Step 2 : vérifier qu'ils échouent**

Run: `node --test tests/domain/kiosk-logic.test.mjs tests/domain/rental-tier.test.mjs`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` sur les deux modules.

- [ ] **Step 3 : écrire `src/utils/rental-tier.ts`, puis brancher `VHSCaseOverlay.tsx` dessus**

Corps repris de `VHSCaseOverlay.tsx:26-32`, avec `now` injectable. Dans `VHSCaseOverlay.tsx`, supprimer la fonction locale et importer celle-ci.

- [ ] **Step 4 : écrire `src/components/kiosk/kiosk-logic.ts`**

Choix non déterminés par les signatures : tri `'alpha'` par `localeCompare(…, 'fr', { sensitivity: 'base' })` ; `'date'` par `release_date` décroissante ; `'rayon'` = ordre reçu de l'API. `formatRuntime` : moins de 60 min → `"58 min"`, sinon `"2 h 49"` (minutes sur deux chiffres). `rentFlow` : pose `lock.busy`, appelle `rent()`, puis `setMode()` dans un `try` séparé dont l'échec est ignoré, libère le verrou dans un `finally`.

- [ ] **Step 5 : vérifier que tout passe**

Run: `node --test tests/domain/kiosk-logic.test.mjs tests/domain/rental-tier.test.mjs`
Expected: 14 tests PASS. Puis `npx tsc --noEmit` : aucune erreur nouvelle.

- [ ] **Step 6 : commit**

```bash
git add src/components/kiosk/kiosk-logic.ts src/utils/rental-tier.ts src/components/videoclub/VHSCaseOverlay.tsx tests/domain/kiosk-logic.test.mjs tests/domain/rental-tier.test.mjs
git commit -m "feat(borne): logique pure de la borne et tarif partagé"
```

---

### Task 2 : Vanne WebGPU et type de scène

**Files:**
- Modify: `src/utils/interior-preload-gate.ts`, `src/types/index.ts:139`
- Test: `tests/domain/kiosk-wiring.test.mjs` (créé ici, complété aux tâches 3 et 4)

**Interfaces:**
- Produces : `hasWebGPU(): boolean` (exporté par `interior-preload-gate.ts`, vrai si `navigator.gpu` existe) ; `releaseInteriorPreload()` ne fait **rien** quand `hasWebGPU()` est faux ; `SceneType = 'exterior' | 'interior' | 'kiosk'`.

- [ ] **Step 1 : écrire les tests qui échouent**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readText, walkFiles } from '../helpers/repo.mjs';

const ROOT = process.cwd();
const setGpu = (value) => Object.defineProperty(globalThis.navigator, 'gpu', { value, configurable: true });

test('BORNE: sans WebGPU, la vanne des préchargements 3D reste fermée', async () => {
  setGpu(undefined);
  const gate = await import('../../src/utils/interior-preload-gate.ts');
  let ran = 0;
  gate.afterStorefront(() => { ran++; });
  assert.equal(gate.hasWebGPU(), false);
  gate.releaseInteriorPreload();
  assert.equal(ran, 0, 'aucun préchargement 3D ne doit partir sans WebGPU');
  setGpu({});
  assert.equal(gate.hasWebGPU(), true);
  gate.releaseInteriorPreload();
  assert.equal(ran, 1);
});
test('BORNE: la borne est une scène à part entière', () => {
  const src = readText(path.join(ROOT, 'src/types/index.ts'));
  assert.match(src, /export type SceneType = 'exterior' \| 'interior' \| 'kiosk';/);
});
```

- [ ] **Step 2 : vérifier qu'ils échouent** — Run: `node --test tests/domain/kiosk-wiring.test.mjs` — Expected: 2 FAIL (`hasWebGPU is not a function`, motif absent).

- [ ] **Step 3 : implémenter** `hasWebGPU()` et la garde dans `releaseInteriorPreload()` ; étendre `SceneType`.

- [ ] **Step 4 : vérifier** — Run: `node --test tests/domain/kiosk-wiring.test.mjs && npx tsc --noEmit` — Expected: 2 PASS, aucune erreur de type nouvelle.

- [ ] **Step 5 : commit**

```bash
git add src/utils/interior-preload-gate.ts src/types/index.ts tests/domain/kiosk-wiring.test.mjs
git commit -m "feat(borne): scène kiosk et vanne des préchargements fermée sans WebGPU"
```

---

### Task 3 : Devanture — vidéo retirée, bouton de la borne, porte sans WebGPU

**Files:**
- Create: `src/components/exterior/DoorBlockedNotice.tsx`
- Modify: `src/components/exterior/ExteriorView.tsx`, `src/components/exterior/ExteriorView.module.css`, `src/App.tsx` (l'appel `<ExteriorView …/>` seulement)
- Delete: `src/components/exterior/IdleVideo.tsx`, `src/components/exterior/IdleVideo.module.css`, `src/hooks/useIdleDetection.ts`
- Test: `tests/domain/kiosk-wiring.test.mjs`

**Interfaces:**
- Consumes : `hasWebGPU()` (tâche 2).
- Produces :
  - `ExteriorView({ onEnter, onOpenKiosk, canEnter }: { onEnter: () => void; onOpenKiosk: () => void; canEnter: boolean })`
  - `DoorBlockedNotice({ reason, seconds, onOpenKiosk, onDismiss, onForceEnter }: { reason: 'no-webgpu' | 'low-power'; seconds: number; onOpenKiosk: () => void; onDismiss: () => void; onForceEnter?: () => void })` — `'low-power'` et `onForceEnter` servent au lot 2 ; ici seul `'no-webgpu'` est utilisé, sans `onForceEnter`.

- [ ] **Step 1 : ajouter les tests qui échouent** (à la suite de `kiosk-wiring.test.mjs`)

```js
test('BORNE: la vidéo d\'attente de la devanture est désactivée', () => {
  const src = readText(path.join(ROOT, 'src/components/exterior/ExteriorView.tsx'));
  for (const gone of ['IdleVideo', 'useIdleDetection', 'videoclubvideo']) {
    assert.ok(!src.includes(gone), `ExteriorView ne doit plus référencer ${gone}`);
  }
});
test('BORNE: la devanture propose la borne et ne laisse pas entrer sans WebGPU', () => {
  const src = readText(path.join(ROOT, 'src/components/exterior/ExteriorView.tsx'));
  assert.ok(src.includes('onOpenKiosk'), 'bouton de la borne');
  assert.ok(src.includes('canEnter'), 'la porte consulte canEnter');
  assert.ok(src.includes('DoorBlockedNotice'), 'message de la porte');
});
test('BORNE: le message de la porte sans WebGPU n\'offre pas d\'entrer quand même', () => {
  const src = readText(path.join(ROOT, 'src/components/exterior/DoorBlockedNotice.tsx'));
  assert.match(src, /onForceEnter\s*&&/, '« Entrer quand même » n\'apparaît que si onForceEnter est fourni');
});
```

- [ ] **Step 2 : vérifier qu'ils échouent** — Run: `node --test tests/domain/kiosk-wiring.test.mjs` — Expected: 3 nouveaux FAIL.

- [ ] **Step 3 : retirer la vidéo d'attente**

Dans `ExteriorView.tsx` : supprimer l'import paresseux d'`IdleVideo`, `IDLE_TIMEOUT`, les états `isVideoReady` / `isVideoPlaying`, les cinq callbacks vidéo, l'appel à `useIdleDetection` et le bloc JSX `<IdleVideo …/>`. Supprimer les trois fichiers listés (`git rm`).

- [ ] **Step 4 : écrire `DoorBlockedNotice.tsx`**

Panneau centré au-dessus de la devanture (fond opaque sombre, bordure néon violet, **sans** `backdrop-filter`), `role="dialog"`, `aria-modal="true"`. Textes exacts pour `'no-webgpu'` :
- titre : « Le vidéoclub ne peut pas s'ouvrir sur cet appareil »
- texte : « Votre navigateur n'a pas WebGPU, nécessaire à la visite en 3D. Essayez avec un ordinateur ou un téléphone plus récent. En attendant, la borne vous permet de louer et de regarder tous les films. »
- bouton principal : « Aller à la borne (N) », N décompté chaque seconde depuis `seconds` ; à zéro, `onOpenKiosk()` est appelé une fois
- bouton secondaire : « Rester devant la devanture » → `onDismiss()` (arrête le minuteur)
- bouton « Entrer quand même » rendu **uniquement** si `onForceEnter` est fourni
- un `<details>` « Comment activer WebGPU ? » qui reprend les consignes par navigateur aujourd'hui dans `WebGPUNotSupported` (`src/App.tsx:109-168`, avec `detectBrowser`), accents corrigés.

Le minuteur s'arrête au démontage et quand l'onglet est caché (`document.visibilityState`).

- [ ] **Step 5 : brancher la devanture**

Dans `ExteriorView.tsx` :
- `handleEnterClick` : si `!canEnter`, ouvrir `DoorBlockedNotice` (`reason="no-webgpu"`, `seconds={15}`) au lieu de lancer la transition.
- Bouton provisoire de la borne, visible seulement quand `isStorefrontShown`, `aria-label="Ouvrir la borne de location"`, texte « BORNE 24/7 » sur une ligne et « louer sans entrer ▼ » dessous, dans le style néon violet de l'indicateur PUSH mais avec un cadre visible. Positions : PC, dans `.contentArea`, `left: 3%; top: 58%` (le mur à gauche de la porte) ; mobile, `position: fixed; left: 4%; top: 44%`. `z-index` sous le rideau (inférieur à 8).
- Repli sans WebGL : entourer `new ExteriorScene(…)` d'un `try/catch` ; en cas d'échec, basculer sur le rendu statique du mobile (état `webglFailed`, la branche mobile devient `isMobile || webglFailed`).

Dans `App.tsx`, passer dès maintenant les deux nouvelles props à `<ExteriorView>` : `onOpenKiosk={() => setScene('kiosk')}` et `canEnter={hasWebGPU()}`. La scène `'kiosk'` ne rend encore rien (tâche 4) : le bouton mène à un écran vide jusque-là, c'est attendu.

- [ ] **Step 6 : vérifier** — Run: `node --test tests/domain/kiosk-wiring.test.mjs tests/architecture/*.test.mjs && npx tsc --noEmit` — Expected: les 5 tests de `kiosk-wiring` PASS ; `dangling-imports` et `assets-references` PASS ; `file-size` inchangé par rapport à la ligne de base ; zéro erreur de type.

- [ ] **Step 7 : commit**

```bash
git add src/components/exterior/DoorBlockedNotice.tsx src/components/exterior/ExteriorView.tsx src/components/exterior/ExteriorView.module.css src/App.tsx tests/domain/kiosk-wiring.test.mjs
git rm src/components/exterior/IdleVideo.tsx src/components/exterior/IdleVideo.module.css src/hooks/useIdleDetection.ts
git commit -m "feat(devanture): bouton de la borne, porte sans WebGPU, vidéo d'attente désactivée"
```

---

### Task 4 : Application — scène borne, scène intérieure gelée ou démontée

**Files:**
- Modify: `src/App.tsx`, `src/components/interior/InteriorScene.tsx` (interface des props lignes 126-130, signature ligne 764, `<Canvas>` ligne 889)
- Create: `src/components/kiosk/KioskView.tsx` (coque minimale ici, complétée en tâche 5)
- Test: `tests/domain/kiosk-wiring.test.mjs`

**Interfaces:**
- Consumes : `hasWebGPU()`, `ExteriorView` (tâche 3), `SceneType` (tâche 2).
- Produces : `InteriorScene({ onCassetteClick, prewarm, suspended }: { …; suspended?: boolean })` — `suspended` vrai ⇒ `<Canvas frameloop="never">`, sinon `"always"`. `KioskView(): JSX.Element` (export nommé, sans props ; lit le magasin).

- [ ] **Step 1 : ajouter les tests qui échouent**

```js
test('BORNE: App n\'arrête plus tout le site quand WebGPU manque', () => {
  const src = readText(path.join(ROOT, 'src/App.tsx'));
  assert.ok(!/return\s*<WebGPUNotSupported/.test(src), 'plus de retour anticipé sur l\'écran d\'excuses');
  assert.ok(src.includes("'kiosk'"), 'App connaît la scène kiosk');
  assert.ok(/suspended=\{/.test(src), 'la scène intérieure reçoit suspended');
});
test('BORNE: l\'interface de la borne reste du DOM pur', () => {
  const dir = path.join(ROOT, 'src/components/kiosk');
  const banned = [/backdrop-filter/i, /backdropFilter/, /<canvas/i, /from ['"]three/, /@react-three/, /selectFilm\(/, /fetchVHSCoverData/, /AuthModal/];
  for (const file of walkFiles(dir)) {
    const src = readText(file);
    for (const rx of banned) assert.ok(!rx.test(src), `${path.basename(file)} ne doit pas contenir ${rx}`);
  }
});
```

- [ ] **Step 2 : vérifier qu'ils échouent** — Run: `node --test tests/domain/kiosk-wiring.test.mjs` — Expected: 2 nouveaux FAIL.

- [ ] **Step 3 : `InteriorScene` accepte `suspended`** et le passe à `frameloop` du `<Canvas>`.

- [ ] **Step 4 : coque minimale de `KioskView`**

Conteneur plein écran `position: fixed; inset: 0` avec un bouton « quitter » qui appelle `setScene('exterior')`, et `useBackGuard(true, quitter)`. Assez pour traverser l'application ; l'interface vient en tâche 5.

- [ ] **Step 5 : recâbler `App.tsx`**

- `webgpuSupported` vient de `hasWebGPU()` ; supprimer le retour anticipé, `WebGPUNotSupported` et `detectBrowser` (déplacés en tâche 3).
- `const isKiosk = currentScene === 'kiosk'` ; `const interiorWarm = useStore(s => s.interiorWarm)`.
- Montage de la scène intérieure : `webgpuSupported && (isInterior || (interiorPrewarm && (!isKiosk || interiorWarm)))`, avec `prewarm={!isInterior}` et `suspended={isKiosk}`. Conséquence voulue : borne ouverte pendant le préchauffage ⇒ scène démontée ; borne ouverte sur scène prête ⇒ scène gardée, rendu gelé.
- `ExteriorView` rendu quand `currentScene === 'exterior'`, avec `onOpenKiosk={() => setScene('kiosk')}` et `canEnter={webgpuSupported}`.
- Branche borne : `KioskView` en `lazy`, dans un `Suspense`, accompagné de `{isPlayerOpen && <VHSPlayer />}` et de `<ActiveCastIndicator />`.
- Préchargement du SDK Cast : la condition devient `currentScene === 'interior' || currentScene === 'kiosk'`.
- Chargement frais de la page : toute scène autre que `'exterior'` est ramenée à `'exterior'` (aujourd'hui seule `'interior'` l'est).
- Sans WebGPU : si `currentScene === 'interior'`, repasser à `'exterior'` ; le lien `?castEnded=` ouvre `'kiosk'` au lieu de `'interior'`, puis `openPlayer(filmId)` comme aujourd'hui.

- [ ] **Step 6 : vérifier** — Run: `node --test tests/domain/kiosk-wiring.test.mjs tests/domain/consistency.test.mjs tests/domain/audit-medium-low.test.mjs && npx tsc --noEmit` — Expected: 7 tests de `kiosk-wiring` PASS ; les deux autres fichiers au même résultat que la ligne de base ; zéro erreur de type.

- [ ] **Step 7 : vérifier dans le navigateur** (serveur du worktree, `PORT=3002 npm run dev`)

1. Devanture → bouton « BORNE 24/7 » → la coque s'affiche → « quitter » → devanture. Console sans erreur.
2. Ouvrir la borne **dans les 2 secondes** après l'apparition de la devanture (préchauffage en cours), attendre 5 s, quitter, pousser la porte : le vidéoclub se charge et s'affiche normalement, console sans erreur liée au GPU.
3. Attendre que `__store.getState().interiorWarm` soit vrai, ouvrir la borne, quitter, pousser la porte : entrée immédiate, sans écran de chargement.
4. Retour arrière du navigateur depuis la borne : devanture, pas de sortie du site.

Si l'étape 2 montre des erreurs ou un vidéoclub cassé après remontage : **s'arrêter et le signaler** ; le repli est de ne jamais démonter (la scène finit sa préparation en arrière-plan), à décider avec Rusmir.

- [ ] **Step 8 : commit**

```bash
git add src/App.tsx src/components/interior/InteriorScene.tsx src/components/kiosk/KioskView.tsx tests/domain/kiosk-wiring.test.mjs
git commit -m "feat(borne): scène kiosk dans l'application, scène 3D gelée ou démontée pendant la borne"
```

---

### Task 5 : Écran de la borne — coque et parcours des films

**Files:**
- Modify: `src/components/kiosk/KioskView.tsx`
- Create: `src/components/kiosk/KioskView.module.css`, `src/components/kiosk/KioskBrowse.tsx`, `src/components/kiosk/KioskNotice.tsx`

**Interfaces:**
- Consumes : tout `kiosk-logic.ts` (tâche 1) ; magasin : `films`, `loadFilmsFromApi`, `setScene`, `isAuthenticated`, `authUser`, `logout` ; `useCredits()`.
- Produces :
  - `type KioskNoticeSpec = { title: string; body: string; primary: { label: string; onPress: () => void }; secondary?: { label: string; onPress: () => void } }` (exporté par `KioskNotice.tsx`)
  - `KioskNotice(props: KioskNoticeSpec)`
  - `KioskBrowse({ selectedId, versions, onSelect, onSearch, actionSlot }: { selectedId: number | null; versions: { vf: boolean; vo: boolean } | null; onSelect: (film: Film) => void; onSearch: () => void; actionSlot: (film: Film) => React.ReactNode })` — `actionSlot` reçoit le film affiché et rend le bouton d'action (tâche 7) ; `versions` vaut `null` jusqu'à la tâche 7.
  - État local de `KioskView` : `mode: 'browse' | 'search'`, `selectedId: number | null`, `notice` (un seul message à la fois).

- [ ] **Step 1 : porter la maquette dans `KioskView.module.css`**

Source visuelle : `docs/superpowers/specs/2026-11-16-borne-maquette-ecran.html`. Reprendre ses classes `.metal`, `.neon-txt`, `.bezel`, `.spines`, `.slot` (corps de la borne) et `.ks`, `.k-top`, `.k-logo`, `.k-nav`, `.k-side`, `.k-tab`, `.k-card`, `.k-clap`, `.k-meta`, `.k-poster`, `.k-under`, `.k-name`, `.k-syn`, `.k-btn`, `.k-louer`, `.k-search`, `.k-strip-h`, `.k-chips`, `.k-strip`, `.k-arrow`, `.k-rail` (écran), mêmes valeurs en `cqw`. Écarts voulus :
- `.k-louer` s'étend de `left: 31cqw` à `right: 3cqw` (le bouton « extrait » arrive en tranche c) ;
- la bande de jaquettes défile nativement : `.k-rail { overflow-x: auto; scroll-snap-type: x proximity; scrollbar-width: none }`, les flèches appellent `scrollBy` ;
- taille de l'écran : mobile `width: min(90vw, calc((100dvh - 150px) * 2 / 3))` ; PC (`min-width: 769px` et pointeur fin) `height: min(94dvh, 1100px)` et largeur déduite du ratio ; dans les deux cas `aspect-ratio: 2 / 3` et `container-type: inline-size` ;
- corps de la borne : sur mobile, enseigne néon « Location 24/7 » au-dessus et fente « retour des cassettes » dessous, masquées quand la hauteur manque (`@media (max-height: 640px)`) ; sur PC, vitrine de tranches à gauche de l'écran ;
- `prefers-reduced-motion` : pas de transition.

- [ ] **Step 2 : `KioskNotice`** — panneau centré dans l'écran de la borne (fond bleu nuit opaque, cadre turquoise, boutons de la charte), `role="dialog"`. Le bouton principal reçoit le focus à l'ouverture.

- [ ] **Step 3 : `KioskView` complet**

- Corps de la borne + écran ; barre du haut : logo « VIDÉOCLUB » et « borne 24/7 », puis « compte » et « quitter ».
- « quitter » et le geste retour → `setScene('exterior')`.
- « compte » : non connecté → la connexion de la borne, branchée en tâche 6 (d'ici là, l'appui ne fait rien) ; connecté → `KioskNotice` titre « Compte », corps « {pseudo} — {n} crédit(s) », boutons « Fermer » et « Se déconnecter ».
- État du catalogue par `catalogState(allFilms(films).length, tempsÉcoulé)` : `'loading'` → « Chargement du catalogue… » ; `'unavailable'` → `KioskNotice` « Catalogue indisponible » / « Vérifiez votre connexion. » / bouton « Réessayer » → `loadFilmsFromApi()` et remise à zéro du délai.
- À l'ouverture, film affiché = le premier de l'onglet Nouveautés (ou du premier onglet non vide).

- [ ] **Step 4 : `KioskBrowse`**

- Colonne des rayons : la page courante de `tabPages()` (7 onglets) et un huitième bouton « suite ▾ » qui passe à l'autre page ; l'onglet actif en blanc et orange.
- Fiche : bandeau clap ; ANNÉE (`releaseYear`), DURÉE (`formatRuntime`), RAYON (`tabLabel(film.aisle)`), VERSION (`versionLabel(versions)`) ; jaquette `posterSrc(film, 'w342')`.
- Sous la fiche : titre sur une ligne avec points de suspension ; « En bref : » suivi de `synopsisText(film.overview)`, trois lignes au plus.
- Boutons : « recherche » → `onSearch()` ; emplacement du bouton d'action = `actionSlot(film)`.
- Bande : titre = `tabLabel(onglet)` ; trois pastilles de tri « sélection » (`rayon`), « A→Z » (`alpha`), « par date » (`date`) ; jaquettes `posterSrc(film, 'w185')` en `<img loading="lazy" decoding="async">` avec `alt` = titre ; un appui appelle `onSelect(film)` ; la jaquette du film affiché porte le cadre orange.
- Jaquette absente (`posterSrc` rend `null`) ou en erreur (`onError`) : vignette de remplacement de même format portant le titre.
- Changement d'onglet ou de tri : la bande revient au début.

- [ ] **Step 5 : vérifier**

Run: `node --test tests/domain/kiosk-wiring.test.mjs tests/architecture/*.test.mjs && npx tsc --noEmit` — Expected: PASS (dont « DOM pur »), zéro erreur de type.
Navigateur (3002), captures à 390 × 844 et 1440 × 810, comparées à la maquette : onglets, fiche, bande, tri, « suite ▾ », vignette de remplacement (forcer une erreur d'image), état « Catalogue indisponible » (bloquer `/api/films/*`). Console sans erreur.

- [ ] **Step 6 : commit**

```bash
git add src/components/kiosk/KioskView.tsx src/components/kiosk/KioskView.module.css src/components/kiosk/KioskBrowse.tsx src/components/kiosk/KioskNotice.tsx
git commit -m "feat(borne): écran de la borne, rayons, fiche et bande de jaquettes"
```

---

### Task 6 : Connexion dans la charte de la borne

**Files:**
- Create: `src/components/kiosk/KioskAuth.tsx`
- Modify: `src/components/kiosk/KioskView.tsx`, `src/components/kiosk/KioskView.module.css`

**Interfaces:**
- Consumes : `authFormError`, `KioskAuthMode` (tâche 1) ; magasin : `login(username, password): Promise<boolean>`, `register(username, password): Promise<boolean>`, `isLoading`, `authError`, `clearAuthError`, `recoveryPhrase` (remplie après une inscription), `clearRecoveryPhrase` ; `api.auth.recover(username, recoveryPhrase, newPassword): Promise<{ user; newRecoveryPhrase: string }>` puis `fetchMe()`.
- Produces : `KioskAuth({ initialMode, onDone, onCancel }: { initialMode?: KioskAuthMode; onDone: () => void; onCancel: () => void })` ; dans `KioskView`, `requestAuth(then?: () => void): void` — ouvre `KioskAuth`, et appelle `then` une fois le visiteur connecté. C'est ce `requestAuth` que la tâche 7 reçoit sous le nom `onRequestAuth`.

Référence fonctionnelle : `src/components/auth/AuthModal.tsx` (mêmes trois parcours, même écran de phrase de récupération). On en reprend le comportement, pas l'apparence, et on corrige ses deux échecs silencieux : mots de passe différents, et récupération refusée par le serveur.

- [ ] **Step 1 : `KioskAuth`**

Panneau qui occupe l'écran de la borne sous la barre du haut (pas de portail, pas de fenêtre par-dessus la page). Charte de la borne : fond bleu, champs à cadre turquoise, bouton principal orange, liens en boutons turquoise. Trois modes et un écran final :

| Mode | Champs | Bouton principal | Liens |
|---|---|---|---|
| `login` — « Connexion » | pseudo, mot de passe | SE CONNECTER | « Créer un compte », « Mot de passe oublié » |
| `register` — « Créer un compte » | pseudo, mot de passe, confirmation | CRÉER MON COMPTE | « J'ai déjà un compte » |
| `recover` — « Récupérer mon compte » | pseudo, phrase de récupération, nouveau mot de passe, confirmation | CHANGER LE MOT DE PASSE | « Retour à la connexion » |

- À la validation : `authFormError(…)` ; s'il rend un message, l'afficher sous le formulaire et ne rien envoyer.
- Refus du serveur : afficher `authError` du magasin (connexion, inscription) ou le message de l'erreur levée par `api.auth.recover`.
- Pendant l'appel : le bouton principal affiche « UN INSTANT… » et ignore les appuis.
- Après une inscription ou une récupération réussie : écran « Votre phrase de récupération », la phrase en grand, le texte « Notez-la : elle seule permet de retrouver votre compte si vous oubliez votre mot de passe. », un bouton « Copier » (`navigator.clipboard.writeText` dans le gestionnaire du clic, rejet attrapé, repli : sélectionner le texte) et un bouton « J'ai noté ma phrase » → `clearRecoveryPhrase()` puis `onDone()`.
- Après une connexion réussie : `onDone()` directement.
- Un bouton « ◀ retour » en haut du panneau → `onCancel()`.
- Attributs des champs : `autoComplete="username"`, `"current-password"` ou `"new-password"` selon le mode ; `autoCapitalize="none"` sur le pseudo ; chaque champ a un `<label>` visible.

- [ ] **Step 2 : brancher dans `KioskView`**

État `auth: { then?: () => void } | null`. `requestAuth(then)` l'ouvre ; `onDone` le ferme puis appelle `then` ; `onCancel` le ferme. « compte », pour un visiteur non connecté, appelle `requestAuth()`. Le geste retour du navigateur ferme d'abord la connexion, puis la borne.

- [ ] **Step 3 : vérifier**

Run: `node --test tests/domain/kiosk-wiring.test.mjs && npx tsc --noEmit` — Expected: PASS (dont « DOM pur », qui interdit `AuthModal` sous `kiosk/`), zéro erreur de type.
Navigateur (3002), mobile et PC, captures à l'appui : connexion d'un compte de test ; mauvais mot de passe → message du serveur visible ; inscription avec deux mots de passe différents → message, aucune requête ; inscription réussie → phrase affichée, « Copier », « J'ai noté ma phrase » → retour à la borne, « compte » montre le pseudo ; récupération avec une phrase fausse → message visible ; sur mobile, le clavier virtuel ne masque pas le champ en cours de saisie.

- [ ] **Step 4 : commit**

```bash
git add src/components/kiosk/KioskAuth.tsx src/components/kiosk/KioskView.tsx src/components/kiosk/KioskView.module.css
git commit -m "feat(borne): connexion, inscription et récupération dans la charte de la borne"
```

---

### Task 7 : Louer et regarder depuis la fiche

**Files:**
- Modify: `src/components/kiosk/KioskView.tsx`, `src/components/kiosk/KioskBrowse.tsx`
- Create: `src/components/kiosk/KioskAction.tsx`

**Interfaces:**
- Consumes : `rentAction`, `rentFlow` (tâche 1) ; `getRentalTier` ; `RENTAL_COSTS` de `src/types` ; `api.films.getById(tmdbId)` → `{ has_vf, has_vo, rental_status: { available_copies, earliest_return } }` ; magasin : `getRental`, `rentFilm`, `setViewingMode`, `openPlayer`, `isAuthenticated`, `fetchMe` ; `useCredits()` ; `onRequestAuth` fourni par `KioskView` (tâche 6).
- Produces : `KioskAction({ film, detail, onNotice, onRequestAuth }: { film: Film; detail: KioskFilmDetail | null; onNotice: (n: KioskNoticeSpec | null) => void; onRequestAuth: (then: () => void) => void })` ; `type KioskFilmDetail = { vf: boolean; vo: boolean; copiesLeft: number; earliestReturn: string | null }`.

- [ ] **Step 1 : charger le détail du film affiché**

Dans `KioskView` : à chaque changement de film, `api.films.getById(film.tmdb_id)` ; la réponse n'est retenue que si le film affiché n'a pas changé entre-temps ; en cas d'échec le détail reste `null` (version « — », stock inconnu ⇒ `copiesLeft: null` pour `rentAction`). Le détail alimente la prop `versions` de `KioskBrowse`.

- [ ] **Step 2 : `KioskAction`, un bouton qui ne se grise jamais**

Libellé et effet selon `rentAction(…)`, avec `cost = RENTAL_COSTS[getRentalTier(film)]` :

| Action | Libellé | Effet de l'appui |
|---|---|---|
| `watch` | REGARDER | `openPlayer(film.id)` |
| `login` | LOUER · {cost} cr. | `onRequestAuth(relancer l'action)` : la connexion de la borne s'ouvre, puis la location repart |
| `rent` | LOUER · {cost} cr. | `rentFlow` ; pendant l'appel le libellé devient « LOCATION… » |
| `insufficient` | LOUER · {cost} cr. | message « Crédits insuffisants » / « Ce film coûte {cost} crédit(s). Vous en avez {n}. » / « Fermer » |
| `unavailable` | INDISPONIBLE | message « Film indisponible » / « Ce film n'est pas encore en rayon. » |
| `out-of-stock` | TOUTES LOUÉES | message « Toutes les copies sont louées » / « Revenez un peu plus tard. » |

`rentFlow` reçoit `rent: () => rentFilm(film.id)` et `setMode: () => setViewingMode(film.id, 'sur_place')` (même état serveur que le parcours du vidéoclub), avec un verrou tenu dans une `ref`. Résultats :
- `ok` → message « Location enregistrée » / « {titre} est à vous jusqu'au {date de `expiresAt`, format fr-FR}. » / boutons « Regarder » (`openPlayer`) et « Plus tard » ;
- `error` → message « Location impossible » / message du serveur / boutons « Fermer » et « Se reconnecter » (`onRequestAuth`) ;
- `busy` → rien.

- [ ] **Step 3 : vérifier dans le navigateur** (3002, base de dev avec un compte de test)

1. Non connecté : LOUER → connexion → la location part → message → « Regarder » → le lecteur s'ouvre par-dessus la borne et lit le film ; le fermer ramène à la fiche, bouton devenu REGARDER.
2. Crédits à zéro (ajuster le compte de test en base) : LOUER → message « Crédits insuffisants », aucun appel `POST /api/rentals`.
3. Deux appuis rapides sur LOUER : une seule requête `POST /api/rentals/…` dans l'onglet réseau.
4. Cookie de session supprimé à la main puis LOUER : « Location impossible » avec « Se reconnecter ».
5. Cast : le bouton TV du lecteur est présent (le SDK est préchargé depuis la borne). L'envoi réel vers un Chromecast demande HTTPS et un appareil : à valider par Rusmir.

- [ ] **Step 4 : tests et types** — Run: `npm run test:phase 2>&1 | tail -15 && npx tsc --noEmit` — Expected: mêmes échecs que la ligne de base, rien de plus ; zéro erreur de type.

- [ ] **Step 5 : commit**

```bash
git add src/components/kiosk/KioskAction.tsx src/components/kiosk/KioskView.tsx src/components/kiosk/KioskBrowse.tsx
git commit -m "feat(borne): louer et regarder depuis la fiche"
```

---

### Task 8 : Recherche par titre

**Files:**
- Create: `src/components/kiosk/KioskSearch.tsx`
- Modify: `src/components/kiosk/KioskView.tsx`, `src/components/kiosk/KioskView.module.css`
- Test: `tests/domain/kiosk-logic.test.mjs`

**Interfaces:**
- Consumes : `searchFilms(films: Film[], query: string): Film[]` de `src/utils/minitelSearch.ts` (10 résultats au plus, insensible à la casse et aux accents) ; `allFilms`, `posterSrc`, `releaseYear`, `tabLabel`.
- Produces : `KioskSearch({ films, onPick, onBack }: { films: Film[]; onPick: (film: Film) => void; onBack: () => void })`.

- [ ] **Step 1 : test de non-régression sur la recherche partagée**

```js
import { searchFilms } from '../../src/utils/minitelSearch.ts';
test('BORNE: la recherche ignore la casse et les accents, exact d\'abord', () => {
  const films = [f(1, 'Les Évadés'), f(2, 'Evade'), f(3, 'Alien')];
  assert.deepEqual(searchFilms(films, 'évade').map(x => x.id), [2, 1]);
  assert.deepEqual(searchFilms(films, '   '), []);
});
```

Run: `node --test tests/domain/kiosk-logic.test.mjs` — Expected: PASS (le comportement existe déjà ; le test le verrouille pour la borne).

- [ ] **Step 2 : `KioskSearch`**

Dans l'écran de la borne, sous la barre du haut : un champ « Titre du film » (`type="search"`, `enterKeyHint="search"`, focus à l'ouverture, cadre turquoise) et un bouton « ◀ rayons » → `onBack()`. Résultats = `searchFilms(films, saisie)`, recalculés à chaque frappe : une ligne par film (jaquette `w185`, titre, année, rayon), un appui → `onPick(film)`. Saisie vide : « Tapez le début d'un titre. » Aucun résultat : « Aucun film ne correspond à « {saisie} ». »

- [ ] **Step 3 : brancher** — `KioskView` passe en `mode: 'search'` sur « recherche » ; `onPick` affiche le film, revient à `'browse'` et sélectionne l'onglet du rayon du film (`film.aisle`, ou `tous` s'il est absent).

- [ ] **Step 4 : vérifier** — Navigateur (3002), mobile et PC : chercher « alien », « évadés », une suite sans résultat ; choisir un film ouvre sa fiche dans le bon rayon ; sur mobile, le clavier virtuel ne masque pas le champ. `npx tsc --noEmit` sans erreur.

- [ ] **Step 5 : commit**

```bash
git add src/components/kiosk/KioskSearch.tsx src/components/kiosk/KioskView.tsx src/components/kiosk/KioskView.module.css tests/domain/kiosk-logic.test.mjs
git commit -m "feat(borne): recherche par titre"
```

---

### Task 9 : Vérification d'ensemble avant mise en ligne

**Files:** aucun nouveau ; corrections éventuelles dans les fichiers des tâches précédentes.

- [ ] **Step 1 : suite complète et build**

Run: `npm run test:phase 2>&1 | tail -15` — Expected: les échecs de la ligne de base (tâche 0), aucun autre.
Run: `rm -rf .next && npm run build` — Expected: build réussi.

- [ ] **Step 2 : parcours sans WebGPU**

Navigateur avec `navigator.gpu` masqué avant le chargement (script d'initialisation). Attendu : la devanture s'affiche ; aucune requête vers le chunk de la scène intérieure, ni vers `/textures/`, `/models/`, `/basis/` ; la porte ouvre le message avec le décompte depuis 15, qui bascule vers la borne à zéro ; pas de bouton « Entrer quand même » ; louer et regarder fonctionnent.

- [ ] **Step 3 : rien de 3D ne tourne pendant la borne**

Avec WebGPU, scène prête, borne ouverte pendant 10 s : un profil de performance ne montre aucune image rendue par le canevas de la scène intérieure (pas d'appel `requestAnimationFrame` de R3F).

- [ ] **Step 4 : cadrages**

Captures comparées à la maquette : 390 × 844 (écran à 90 % de la largeur), 844 × 390 (paysage : écran entier visible, rien de coupé), 1440 × 810 (écran sur la hauteur, vitrine à gauche), 1920 × 1080.

- [ ] **Step 5 : le vidéoclub n'a pas régressé**

Avec WebGPU : entrée par la porte, ouverture d'une cassette, location depuis la fiche 3D (le tarif affiché est le même qu'avant, `getRentalTier` ayant été déplacé), lecteur. Rejouer le protocole de test du survol des K7 n'est pas nécessaire (aucun fichier de la scène touché hormis la prop `suspended`).

- [ ] **Step 6 : téléphone réel**

Si le Pixel 9a est branché (adb) : charger la page du worktree, ouvrir la borne, faire défiler la bande et changer de rayon ; relever les images longues (plus de 50 ms) pendant 10 s de défilement. Sinon : le dire dans le compte rendu, sans chiffre inventé.

- [ ] **Step 7 : compte rendu à Rusmir**

Ce qui est vérifié avec sa preuve, ce qui ne l'est pas (Cast réel, téléphone si absent), les captures. **Ne pas pousser ni ouvrir de PR sans sa demande.**
