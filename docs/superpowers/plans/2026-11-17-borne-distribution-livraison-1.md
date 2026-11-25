# Distribution de la K7 — livraison 1 (sans vidéo) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Après « LOUER » confirmé, la borne affiche « Veuillez patienter » pendant l'appel au serveur, puis un panneau « Votre K7 est prête » (Regarder, Sur la TV, Mes locations) au lieu du message « Location enregistrée », et un écran « Mes locations » liste les locations en cours.

**Architecture:** La borne garde un état de distribution (`waiting` → `ready`) dans `KioskView`, alimenté par deux rappels de `KioskAction`. Les textes et le geste retour sont des fonctions pures de `kiosk-logic.ts`. « Sur la TV » pose un drapeau `castOnOpen` dans le magasin et ouvre le lecteur, qui lance à son montage son propre parcours Cast (`handleCastCurrentVideo`). La livraison 2 (vidéo du robot, lot 3) s'insérera entre `waiting` et `ready` ; elle aura son propre plan.

**Tech Stack:** Next.js 16 / React 19, Zustand 5, CSS Modules, tests `node --test` (`.test.mjs`, TypeScript importé par type-strip natif de Node 22).

**Spec:** `docs/superpowers/specs/2026-11-17-borne-distribution-k7-design.md` (§ 5 « Ordre location / animation », § 7, § 9 point 1). Parent : `docs/superpowers/specs/2026-11-16-borne-location-design.md`.

## Global Constraints

- Worktree `~/projetsperso/video-club-webgpu-borne`, branche `feat/borne-location`, **commits locaux seulement** (ni push ni PR). **Jamais `git add -A`** : ajouter les fichiers nommément.
- Serveur de dev **toujours sur le port 3001** (`PORT=3001 npm run dev`), jamais 3000.
- Aucun bouton `disabled` : un bouton qui ne peut pas agir le dit (leçon « boutons `disabled` » d'`AGENTS.md`).
- Le geste retour **ne quitte jamais la borne** ; seule sortie : « Quitter » (décision du 16/11).
- Pas de `backdrop-filter` ; un seul mode de fusion dans l'écran, `screen`.
- Casse : libellés écrits normalement dans le code ; la feuille de style met l'action principale en capitales (`kBtnPrimary`/`kLouer` existants).
- `kiosk-logic.ts` n'importe que des **types** (il est chargé tel quel par Node dans les tests).
- Textes exacts (spec § 7) : « Votre K7 est prête », « À rendre avant le {formatUntil} », « Regarder », « Sur la TV », « Mes locations », « Veuillez patienter ».
- Base de tests : avant la tâche 1, lancer `node --test "tests/**/*.test.mjs" 2>&1 | tail -8` et **noter** le nombre d'OK et d'échecs ; des échecs préexistent (tests d'intégration qui visent un serveur, budget de taille). Chaque tâche compare à ce chiffre : aucun nouvel échec.

## Review Focus

1. **Geste retour pendant « Veuillez patienter »** : il ne fait rien (l'appel au serveur ne s'annule pas) et ne sort pas de la borne → test `kioskBackAction({ ..., waiting: true })` = `'none'` (tâche 1).
2. **Location refusée** (crédits, stock, 401) : « Veuillez patienter » disparaît et le message d'erreur actuel s'affiche, **sans** panneau « prête » → test statique sur `KioskAction` (tâche 3) : `onRenting(null)` est appelé avant toute branche d'erreur, `onRented` seulement après `status === 'ok'`.
3. **« Quitter » pendant l'appel** : la barre du haut est inerte tant que « Veuillez patienter » est affiché, comme sous un message → test statique sur `KioskView` (tâche 3).
4. **« Sur la TV » sans Cast possible** (SDK qui ne charge pas, appareil Apple) : le lecteur s'ouvre normalement, jamais bloqué en `awaitingCast` → test de `shouldStartCastOnOpen` avec `isApple: true` (tâche 2) ; le retour en pause sur échec est celui de `handleCastCurrentVideo`, inchangé.
5. **« Mes locations » vide, ou film absent du catalogue chargé** → tests de `rentalRows` (tâche 1).

---

### Task 1: Logique pure — échéance, temps restant, lignes de « Mes locations », geste retour

**Files:**
- Modify: `src/components/kiosk/kiosk-logic.ts` (sections « Bouton d'action » et « Geste retour »)
- Test: `tests/domain/kiosk-logic.test.mjs` (ajouter à la fin)

**Interfaces:**
- Produces:
  - `readyUntilText(expiresAt: number, timeZone?: string): string` → `` `À rendre avant le ${formatUntil(expiresAt, timeZone)}` ``
  - `timeLeftLabel(expiresAt: number, now: number): string`
  - `type KioskRentalRow = { filmId: number; title: string; timeLeft: string; expiresAt: number }`
  - `rentalRows(rentals: ReadonlyArray<{ filmId: number; expiresAt: number }>, films: ReadonlyArray<Pick<Film, 'id' | 'title'>>, now: number): KioskRentalRow[]`
  - `KioskBackAction` gagne `'close-ready' | 'close-rentals'` ; `kioskBackAction` gagne trois champs optionnels `waiting?: boolean`, `readyOpen?: boolean`, `rentalsOpen?: boolean`.

- [ ] **Step 1: Écrire les tests qui échouent**

```js
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
  assert.equal(rows[0].title, 'Titre indisponible');   // film absent du catalogue chargé
  assert.equal(rows[1].title, 'Get Out');
  assert.equal(rows[1].timeLeft, 'encore 5 h 00');
  assert.deepEqual(K.rentalRows([], [], now), []);
});
test('DISTRIBUTION: geste retour — rien pendant l\'attente, ferme le panneau puis la liste', () => {
  const base = { playerOpen: false, noticeOpen: false, noticeClosable: true, authOpen: false, phrasePending: false, searchOpen: false };
  assert.equal(K.kioskBackAction({ ...base, waiting: true }), 'none');
  assert.equal(K.kioskBackAction({ ...base, waiting: true, readyOpen: true }), 'none');
  assert.equal(K.kioskBackAction({ ...base, readyOpen: true, rentalsOpen: true }), 'close-ready');
  assert.equal(K.kioskBackAction({ ...base, rentalsOpen: true, detailOpen: true }), 'close-rentals');
  assert.equal(K.kioskBackAction({ ...base, playerOpen: true, readyOpen: true }), 'close-player');
  assert.equal(K.kioskBackAction({ ...base, noticeOpen: true, waiting: true }), 'close-notice');
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `node --test tests/domain/kiosk-logic.test.mjs 2>&1 | tail -15`
Expected: les quatre tests `DISTRIBUTION:` échouent (`K.readyUntilText is not a function`, etc.), les autres passent.

- [ ] **Step 3: Implémenter dans `kiosk-logic.ts`**

- `readyUntilText` réutilise `formatUntil`.
- `timeLeftLabel` : ≤ 0 → `'expirée'` ; ≥ 1 jour → `encore {j} j` suivi de ` {h} h` seulement si les heures pleines restantes sont > 0 ; ≥ 1 h → `encore {h} h {mm}` (minutes sur deux chiffres) ; sinon `encore {m} min` avec `m = max(1, floor(minutes))`. Tout en divisions entières (`Math.floor`).
- `rentalRows` : titre cherché par `id` dans `films`, `'Titre indisponible'` à défaut ; tri par `expiresAt` croissant.
- `kioskBackAction`, ordre : `playerOpen` → `noticeOpen` (inchangé) → `waiting` → `'none'` → `readyOpen` → `'close-ready'` → `rentalsOpen` → `'close-rentals'` → la suite actuelle (`phrasePending`, `authOpen`, `detailOpen`, `searchOpen`). Compléter son commentaire (« Veuillez patienter » ne se ferme pas : l'appel au serveur ne s'annule pas).

- [ ] **Step 4: Lancer, vérifier que tout passe**

Run: `node --test tests/domain/kiosk-logic.test.mjs 2>&1 | tail -6`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/components/kiosk/kiosk-logic.ts tests/domain/kiosk-logic.test.mjs
git commit -m "feat(borne): textes et geste retour de la distribution de la K7"
```

---

### Task 2: « Sur la TV » — le lecteur lance le Cast à son ouverture

**Files:**
- Create: `src/utils/cast-on-open.ts`
- Modify: `src/store/index.ts` (type du magasin près de `openPlayer` L143 et `activeCastFilmId` L148 ; implémentation près de `openPlayer` L762-780)
- Modify: `src/components/player/VHSPlayer.tsx` (un effet après `handleCastCurrentVideo`, L869-936)
- Test: `tests/domain/cast-on-open.test.mjs` (nouveau)

**Interfaces:**
- Produces:
  - `shouldStartCastOnOpen(i: { castOnOpen: number | null; currentPlayingFilm: number | null; isPlayerOpen: boolean; hasRental: boolean; isApple: boolean }): boolean` — vrai seulement si le lecteur est ouvert, a sa location, sur le film demandé, et que l'appareil n'est pas Apple (sur Apple la TV passe par AirPlay, dont le sélecteur exige un geste direct : le lecteur s'ouvre normalement et son invite « Regarder sur TV » s'en charge).
  - Magasin : `castOnOpen: number | null` (initial `null`, **non persisté** : ne pas l'ajouter à `partialize`), `openPlayerOnTv: (filmId: number) => void` (pose `castOnOpen = filmId` puis appelle `openPlayer(filmId)`), `clearCastOnOpen: () => void`.
- Consumes (existant) : `openPlayer(filmId)`, `handleCastCurrentVideo` et la détection Apple déjà utilisée par `handleWatchOnTVFromPrompt` (L976-993) dans `VHSPlayer.tsx` ; `preloadCastSdk(): Promise<boolean>` de `src/hooks/useGoogleCast.ts` (L175).

- [ ] **Step 1: Écrire le test qui échoue**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readText } from '../helpers/repo.mjs';
import { shouldStartCastOnOpen } from '../../src/utils/cast-on-open.ts';

const ok = { castOnOpen: 7, currentPlayingFilm: 7, isPlayerOpen: true, hasRental: true, isApple: false };
test('CAST: le lecteur lance le Cast à son ouverture quand la borne l\'a demandé', () => {
  assert.equal(shouldStartCastOnOpen(ok), true);
  assert.equal(shouldStartCastOnOpen({ ...ok, castOnOpen: null }), false);
  assert.equal(shouldStartCastOnOpen({ ...ok, currentPlayingFilm: 8 }), false);
  assert.equal(shouldStartCastOnOpen({ ...ok, isPlayerOpen: false }), false);
  assert.equal(shouldStartCastOnOpen({ ...ok, hasRental: false }), false);
  assert.equal(shouldStartCastOnOpen({ ...ok, isApple: true }), false);
});
test('CAST: le drapeau est consommé une fois et jamais persisté', () => {
  const store = readText(path.join(process.cwd(), 'src/store/index.ts'));
  assert.ok(store.includes('openPlayerOnTv'), 'action du magasin');
  const partialize = store.slice(store.indexOf('partialize'), store.indexOf('partialize') + 800);
  assert.ok(!partialize.includes('castOnOpen'), 'castOnOpen ne doit pas être persisté');
  const player = readText(path.join(process.cwd(), 'src/components/player/VHSPlayer.tsx'));
  assert.ok(player.includes('shouldStartCastOnOpen'), 'le lecteur consulte la règle');
  assert.ok(player.includes('clearCastOnOpen'), 'le lecteur consomme le drapeau');
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `node --test tests/domain/cast-on-open.test.mjs 2>&1 | tail -10`
Expected: FAIL (`Cannot find module …/cast-on-open.ts`).

- [ ] **Step 3: Implémenter**

- `src/utils/cast-on-open.ts` : la fonction pure ci-dessus, sans import de valeur.
- Magasin : `castOnOpen`, `openPlayerOnTv`, `clearCastOnOpen` comme décrits.
- `VHSPlayer.tsx` : un `useEffect` qui, quand `shouldStartCastOnOpen(...)` est vrai, appelle **d'abord** `clearCastOnOpen()` puis `void handleCastCurrentVideo()`. Dépendances : `castOnOpen`, `currentPlayingFilm`, `isPlayerOpen`, la présence de la location, `handleCastCurrentVideo`. Commentaire : l'appui sur « Sur la TV » a eu lieu quelques centaines de millisecondes plus tôt ; l'activation par l'utilisateur du navigateur couvre encore la demande de session, à condition que le SDK soit déjà chargé (la borne le précharge, tâche 3). Sinon `handleCastCurrentVideo` retombe en pause, comme aujourd'hui.

- [ ] **Step 4: Lancer, vérifier que tout passe**

Run: `node --test tests/domain/cast-on-open.test.mjs 2>&1 | tail -6` puis `npx tsc --noEmit -p . 2>&1 | tail -5`
Expected: `# fail 0` ; aucune erreur de type nouvelle (comparer à `git stash; npx tsc --noEmit -p . | wc -l; git stash pop` si des erreurs préexistent).

- [ ] **Step 5: Commit**

```bash
git add src/utils/cast-on-open.ts src/store/index.ts src/components/player/VHSPlayer.tsx tests/domain/cast-on-open.test.mjs
git commit -m "feat(lecteur): lancer le Cast à l'ouverture quand la borne le demande"
```

---

### Task 3: « Veuillez patienter » et le panneau « Votre K7 est prête »

**Files:**
- Create: `src/components/kiosk/KioskDistribution.tsx` — `KioskWaiting` et `KioskReady` (la livraison 2 y ajoutera l'animation)
- Modify: `src/components/kiosk/KioskAction.tsx` (`rentNow`, L68-120 ; props L28-35)
- Modify: `src/components/kiosk/KioskView.tsx` (état, `onBack` L416-435, rendu L486-566)
- Modify: `src/components/kiosk/KioskPanels.module.css`
- Test: `tests/domain/kiosk-wiring.test.mjs` (ajouter)

**Interfaces:**
- Consumes: `readyUntilText`, `kioskBackAction` (tâche 1) ; `openPlayerOnTv` (tâche 2) ; `preloadCastSdk` de `src/hooks/useGoogleCast.ts`.
- Produces:
  - `KioskAction` props en plus : `onRenting: (filmId: number | null) => void`, `onRented: (filmId: number) => void`.
  - `KioskWaiting(): JSX.Element` — `role="status"`, titre « Veuillez patienter », sans bouton.
  - `KioskReady(props: { film: Film; expiresAt: number | null; onWatch: () => void; onTv: () => void; onRentals: () => void }): JSX.Element` — titre « Votre K7 est prête », le titre du film, `readyUntilText(expiresAt)` si `expiresAt` est connu, boutons « Regarder » (principal, focus à l'ouverture) et « Sur la TV », lien-bouton « Mes locations ». Précharge le SDK Cast à son montage (`void preloadCastSdk()`).
  - `KioskView` : état `distribution: { phase: 'waiting' | 'ready'; filmId: number } | null` et `rentalsOpen: boolean` (l'écran de la tâche 4 ; la tâche 3 ne fait que poser l'état et l'ouverture).

- [ ] **Step 1: Écrire les tests statiques qui échouent**

```js
test('DISTRIBUTION: la location réussie mène au panneau « prête », pas au message d\'avant', () => {
  const src = readText(path.join(ROOT, 'src/components/kiosk/KioskAction.tsx'));
  assert.ok(!src.includes('Location enregistrée'), 'l\'ancien message disparaît');
  const rentNow = src.slice(src.indexOf('const rentNow'), src.indexOf('const press'));
  assert.ok(rentNow.indexOf('onRenting(film.id)') < rentNow.indexOf('rentFlow('), 'l\'attente s\'affiche avant l\'appel');
  assert.ok(rentNow.indexOf('onRenting(null)') < rentNow.indexOf("status === 'error'"), 'l\'attente se retire avant toute erreur');
  assert.ok(rentNow.lastIndexOf('onRented(film.id)') > rentNow.indexOf("status === 'error'"), 'le panneau seulement après le cas d\'erreur');
});
test('DISTRIBUTION: pendant l\'attente la barre du haut est inerte et le panneau précharge le Cast', () => {
  const view = readText(path.join(ROOT, 'src/components/kiosk/KioskView.tsx'));
  assert.match(view, /className=\{styles\.kTop\} inert=\{[^}]*distribution/, 'barre du haut inerte pendant la distribution');
  assert.ok(view.includes('openPlayerOnTv'), '« Sur la TV »');
  const dist = readText(path.join(ROOT, 'src/components/kiosk/KioskDistribution.tsx'));
  for (const copy of ['Veuillez patienter', 'Votre K7 est prête', 'Regarder', 'Sur la TV', 'Mes locations']) {
    assert.ok(dist.includes(copy), copy);
  }
  assert.ok(dist.includes('preloadCastSdk'), 'SDK préchargé à l\'affichage du panneau');
  assert.ok(!/\bdisabled\b/.test(dist), 'aucun bouton grisé');
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `node --test tests/domain/kiosk-wiring.test.mjs 2>&1 | tail -10`
Expected: les deux tests `DISTRIBUTION:` échouent.

- [ ] **Step 3: Implémenter**

- `KioskAction.rentNow` : `onRenting(film.id)` juste avant `rentFlow` ; après le retour de `rentFlow` (sauf `busy`), `onRenting(null)` **avant** la branche d'erreur ; sur succès, `onRented(film.id)` à la place du `onNotice({ title: 'Location enregistrée', … })`. Le reste (verrou, erreurs, « Se reconnecter ») ne change pas.
- `KioskView` : `onRenting` pose `{ phase: 'waiting', filmId }` ou remet `null` ; `onRented` pose `{ phase: 'ready', filmId }`. Les deux `KioskAction` (parcours et fiche détaillée) reçoivent ces rappels. `inert` de `kTop`, `kPane` et des `kLayer` inclut `distribution !== null`. Rendu, au-dessus des calques et sous `KioskNotice` : `KioskWaiting` en phase `waiting`, `KioskReady` en phase `ready` avec le film retrouvé dans `catalogue` et `expiresAt` lu par `useStore.getState().getRental(filmId)?.expiresAt ?? null`. Actions : « Regarder » → fermer le panneau puis `openPlayer(filmId)` ; « Sur la TV » → fermer puis `openPlayerOnTv(filmId)` ; « Mes locations » → fermer puis `setRentalsOpen(true)`. `onBack` passe `waiting`, `readyOpen`, `rentalsOpen` à `kioskBackAction` et traite `'close-ready'` (fermer le panneau) et `'close-rentals'` (`setRentalsOpen(false)`).
- CSS : réutiliser la charte des messages (`kNoticeScrim`, `kNotice`, `kNoticeBtn`, `kNoticeBtnPrimary`) ; le lien « Mes locations » est un `<button>` stylé en lien, hauteur d'appui ≥ 44 px (`KIOSK_MIN_PX.tab`).

- [ ] **Step 4: Lancer, vérifier**

Run: `node --test "tests/**/*.test.mjs" 2>&1 | tail -8` puis `npx tsc --noEmit -p . 2>&1 | tail -5`
Expected: les tests `DISTRIBUTION:` passent ; pas plus d'échecs que la base notée ; pas d'erreur de type nouvelle.

- [ ] **Step 5: Commit**

```bash
git add src/components/kiosk/KioskDistribution.tsx src/components/kiosk/KioskAction.tsx src/components/kiosk/KioskView.tsx src/components/kiosk/KioskPanels.module.css tests/domain/kiosk-wiring.test.mjs
git commit -m "feat(borne): « Veuillez patienter » puis « Votre K7 est prête »"
```

---

### Task 4: L'écran « Mes locations »

**Files:**
- Create: `src/components/kiosk/KioskRentals.tsx`
- Modify: `src/components/kiosk/KioskView.tsx` (rendu du calque quand `rentalsOpen`)
- Modify: `src/components/kiosk/KioskPanels.module.css`
- Test: `tests/domain/kiosk-wiring.test.mjs` (ajouter)

**Interfaces:**
- Consumes: `rentalRows`, `timeLeftLabel` (tâche 1) ; `rentalsOpen` (tâche 3) ; magasin : `rentals: Rental[]` (`filmId`, `expiresAt` en ms), `openPlayer`.
- Produces: `KioskRentals(props: { films: Film[]; onWatch: (filmId: number) => void; onBack: () => void }): JSX.Element` — titre « Mes locations », une ligne par location (titre, temps restant, bouton « Regarder »), « Aucune location en cours. » quand la liste est vide, bouton « Retour ». Le temps restant se recalcule une fois par minute (`setInterval` de 60 000 ms, nettoyé au démontage).

- [ ] **Step 1: Écrire le test statique qui échoue**

```js
test('DISTRIBUTION: « Mes locations » liste les locations en cours', () => {
  const src = readText(path.join(ROOT, 'src/components/kiosk/KioskRentals.tsx'));
  for (const copy of ['Mes locations', 'Aucune location en cours.', 'Regarder', 'Retour']) assert.ok(src.includes(copy), copy);
  assert.ok(src.includes('rentalRows'), 'les lignes viennent de la logique testée');
  assert.ok(src.includes('clearInterval'), 'le minuteur est nettoyé');
  const view = readText(path.join(ROOT, 'src/components/kiosk/KioskView.tsx'));
  assert.ok(view.includes('<KioskRentals'), 'monté par la borne');
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `node --test tests/domain/kiosk-wiring.test.mjs 2>&1 | tail -6`
Expected: le test échoue (`ENOENT … KioskRentals.tsx`).

- [ ] **Step 3: Implémenter**

`KioskRentals` lit `rentals` dans le magasin (sélecteur individuel), appelle `rentalRows(rentals, films, now)` ; rendu dans un `kLayer` de `KioskView` (mêmes règles d'`inert` que la fiche détaillée), passé `catalogue` en `films`. « Regarder » → `openPlayer(filmId)` (la liste reste ouverte sous le lecteur, comme la fiche). « Retour » → `setRentalsOpen(false)`.

- [ ] **Step 4: Lancer, vérifier**

Run: `node --test "tests/**/*.test.mjs" 2>&1 | tail -8` puis `npx tsc --noEmit -p . 2>&1 | tail -5`
Expected: le test passe ; pas plus d'échecs que la base ; pas d'erreur de type nouvelle.

- [ ] **Step 5: Commit**

```bash
git add src/components/kiosk/KioskRentals.tsx src/components/kiosk/KioskView.tsx src/components/kiosk/KioskPanels.module.css tests/domain/kiosk-wiring.test.mjs
git commit -m "feat(borne): écran « Mes locations »"
```

---

### Task 5: Vérification dans le navigateur et documentation

**Files:**
- Modify: `AGENTS.md` (section « Borne de location » de la branche : une ligne sur la distribution et `castOnOpen`)
- Modify: `docs/superpowers/specs/2026-11-17-borne-distribution-k7-design.md` (statut : livraison 1 faite, commit)

- [ ] **Step 1: Lancer le site sur le port 3001** avec la base de dev seedée, en suivant la mémoire `borne-recettes-verification` (seed avec `.env`, pièges StrictMode). Run: `PORT=3001 npm run dev`. Expected: `Ready` sur `http://localhost:3001`.

- [ ] **Step 2: Parcours réel à 412 × 915 px (Pixel 9a émulé) puis sur PC** : ouvrir la borne, se connecter, louer un film disponible. Constater et capturer : « Veuillez patienter » (le cas échéant bref), puis le panneau avec le titre et « À rendre avant le … » ; geste retour (`history.back()`) sur le panneau → il se ferme, on reste dans la borne ; « Mes locations » → la ligne du film avec « encore … » ; « Regarder » → le lecteur s'ouvre. Louer avec trop peu de crédits → le message « Crédits insuffisants » d'avant, sans panneau.

- [ ] **Step 3: « Sur la TV »** : sur le PC de dev avec Chrome et un Chromecast sur le réseau si disponible, constater l'ouverture du sélecteur ; sinon constater que le lecteur s'ouvre et retombe en pause sans rester sur « Connexion à ta TV… ». Noter honnêtement ce qui n'a pas pu être testé.

- [ ] **Step 4: Documenter et commiter**

```bash
git add AGENTS.md docs/superpowers/specs/2026-11-17-borne-distribution-k7-design.md
git commit -m "docs(borne): distribution de la K7, livraison 1"
```
