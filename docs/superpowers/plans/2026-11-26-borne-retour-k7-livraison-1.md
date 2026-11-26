# Rendre sa K7 à la borne — livraison 1 — plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le parcours complet du retour à la borne, sans le film de retour : délai de 8 h partout, proposition à
l'arrivée pour un film vu, retour avec résultat (crédit, exemplaires) et enchaînement sur la critique, bouton
« Rembobiner » (crédit au bout de 60 s), exemplaires 2/1 et leur état sur la fiche.

**Architecture:** Les règles chiffrées vivent dans un module pur partagé par le serveur et le client
(`src/utils/rental-rules.ts`). Le parcours du retour et le rembobinage sont deux crochets à part
(`useKioskReturn.ts`, `useKioskRewind.ts`) que `KioskView` branche et passe à `KioskAccount` — `KioskView` dépasse déjà
le budget de taille, il ne fait que brancher. Les textes sont des fonctions pures testées par `node --test`.

**Tech Stack:** Next.js 16 / React 19, Zustand, SQLite (`better-sqlite3`), tests `node --test` (type-strip natif).

**Spec:** `docs/superpowers/specs/2026-11-26-borne-retour-k7-design.md` (validée par Rusmir le 26/11/2026). Lire les
§§ 4, 6, 7 et 7 bis avant de commencer.

## Global Constraints

- Worktree `../video-club-webgpu-borne`, branche `feat/borne-rendre-k7`. Serveurs : 3002 (build) et 3003 (dev) ;
  **jamais 3000**, 3001 est celui de Rusmir.
- **Jamais `git add -A`** : ajouter fichier par fichier. Ne pas commiter `AGENTS.md` ni `next-env.d.ts` si `next dev`
  les réécrit (`git checkout -- AGENTS.md next-env.d.ts`).
- Pas de push ni de fusion sur `main` sans l'accord explicite de Rusmir.
- Délai de retour anticipé : **8 h** après `rented_at`, bornes comprises (`<= 8 h`) ; bonus **+1 crédit**.
- Exemplaires : **2 pour une nouveauté (`is_nouveaute = 1`), 1 pour tout autre film.**
- Rembobinage à la borne : **jamais automatique** ; crédit au bout de **60 000 ms** ; le retour ne rembobine pas.
- Question à l'arrivée : film vu à **80 %** (`watchProgress >= 80`), **une fois par location**.
- Modules chargés par Node dans les tests : imports de type seulement, imports de valeur relatifs **avec l'extension
  `.ts`** (comme `kiosk-logic.ts`).
- Textes en français, avec accents ; guillemets « » comme dans le reste de la borne.
- Baseline des tests : 9 échecs préexistants (budget de taille, 6 `http-headers`, `P-01`, `sf-island-fill`). Comparer
  dans la même passe, sur `origin/main` si un doute.

## Review Focus

- **Plusieurs films vus** : une seule question, pour le `watchCompletedAt` le plus récent ; les autres ne sont pas
  marqués « demandés ». → test dans la tâche 6.
- **Location échue entre la question et l'appui** : `returnFilm` rend `null` → « Le retour n'a pas abouti », rien de
  marqué rendu. → test dans la tâche 5.
- **Stockage local indisponible** (navigation privée, accès qui lève) : la question s'affiche quand même, aucune
  exception. → test dans la tâche 6.
- **Rendre un film en cours de rembobinage** : le rembobinage s'arrête, aucun crédit de rembobinage. → test dans la
  tâche 7.
- **Plus de locations en cours que d'exemplaires** (stock réduit par la migration) : chaque location en cours a sa
  ligne, aucune n'est cachée. → test dans la tâche 3.

---

### Task 1: Le délai de 8 h, une seule valeur partout

**Files:**
- Create: `src/utils/rental-rules.ts`
- Modify: `lib/rentals.ts:479-493` (`EARLY_RETURN_HOURS`, `returnFilm`)
- Modify: `src/components/videoclub/VHSCaseOverlay.tsx:869-872`, `:1137`, `:1447`
- Modify: `src/components/tutorial/TutorialOverlay.tsx:45`
- Modify: `src/components/kiosk/kiosk-account-logic.ts:46-70`
- Test: `tests/domain/rental-rules.test.mjs` (nouveau), `tests/domain/kiosk-account-logic.test.mjs`,
  `tests/domain/borne-rendre-k7.test.mjs`

**Interfaces:**
- Produces (`src/utils/rental-rules.ts`, aucun import) :
  - `export const EARLY_RETURN_HOURS = 8;`
  - `export const EARLY_RETURN_MS = EARLY_RETURN_HOURS * 3_600_000;`
  - `export function isEarlyReturn(rentedAtMs: number, nowMs: number): boolean` — `nowMs - rentedAtMs <= EARLY_RETURN_MS`
  - `export const COPIES_NOUVEAUTE = 2; export const COPIES_AUTRE = 1;`
  - `export function copiesForFilm(isNouveaute: boolean | number | null | undefined): number`

- [ ] **Step 1: Write the failing tests** — `tests/domain/rental-rules.test.mjs` :

```js
import * as R from '../../src/utils/rental-rules.ts';
test('RÈGLES: retour anticipé sous 8 h, borne comprise', () => {
  const t0 = Date.UTC(2026, 10, 26, 12, 0);
  assert.equal(R.EARLY_RETURN_HOURS, 8);
  assert.equal(R.isEarlyReturn(t0, t0 + 8 * 3_600_000), true);
  assert.equal(R.isEarlyReturn(t0, t0 + 8 * 3_600_000 + 1), false);
});
test('RÈGLES: 2 exemplaires pour une nouveauté, 1 sinon', () => {
  assert.equal(R.copiesForFilm(true), 2); assert.equal(R.copiesForFilm(1), 2);
  assert.equal(R.copiesForFilm(false), 1); assert.equal(R.copiesForFilm(0), 1); assert.equal(R.copiesForFilm(null), 1);
});
test('RÈGLES: le serveur, le vidéoclub 3D, le tutoriel et la borne lisent la même règle', () => {
  assert.match(src('lib/rentals.ts'), /isEarlyReturn\(/);
  assert.doesNotMatch(src('lib/rentals.ts'), /EARLY_RETURN_HOURS = 24/);
  assert.match(src('src/components/videoclub/VHSCaseOverlay.tsx'), /isEarlyReturn\(rental\.rentedAt, Date\.now\(\)\)/);
  assert.doesNotMatch(src('src/components/videoclub/VHSCaseOverlay.tsx'), /24h|24 \* 60 \* 60/);
  assert.match(src('src/components/tutorial/TutorialOverlay.tsx'), /Retourner le film sous 8h/);
});
```

Dans `tests/domain/kiosk-account-logic.test.mjs` (tests « RENDRE: … ») : cas 7 h 59 → texte avec « dans les 8 h » ;
cas 8 h 01 → sans crédit ; retirer l'assertion `EARLY_RETURN_MS === 24*H`. Dans `tests/domain/borne-rendre-k7.test.mjs`,
remplacer le test « le délai du crédit affiché est celui du serveur » par une assertion que `kiosk-account-logic.ts`
importe `isEarlyReturn` de `../../utils/rental-rules.ts`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/domain/rental-rules.test.mjs tests/domain/kiosk-account-logic.test.mjs tests/domain/borne-rendre-k7.test.mjs`
Expected: FAIL (`rental-rules.ts` introuvable).

- [ ] **Step 3: Implement**
  - `src/utils/rental-rules.ts` comme dans Interfaces.
  - `lib/rentals.ts` : supprimer `EARLY_RETURN_HOURS`, importer `isEarlyReturn` de `'../src/utils/rental-rules'`, le
    calcul devient `isEarlyReturn(rentedAt.getTime(), Date.now())`.
  - `VHSCaseOverlay.tsx` : `isWithinEarlyReturn = rental ? isEarlyReturn(rental.rentedAt, Date.now()) : false` ; textes
    « Retour sous 8h = +1 crédit bonus » et « Retour sous 8h : +1 crédit bonus ».
  - `TutorialOverlay.tsx:45` : « Retourner le film sous 8h ».
  - `kiosk-account-logic.ts` : supprimer `EARLY_RETURN_MS` local ; `returnConfirmText` utilise `isEarlyReturn` ; texte
    « Rendue dans les 8 h qui suivent la location, elle vous rapporte 1 crédit. »

- [ ] **Step 4: Run to verify they pass** — même commande. Expected: PASS. Puis `npx tsc --noEmit` : exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/utils/rental-rules.ts lib/rentals.ts src/components/videoclub/VHSCaseOverlay.tsx src/components/tutorial/TutorialOverlay.tsx src/components/kiosk/kiosk-account-logic.ts tests/domain/rental-rules.test.mjs tests/domain/kiosk-account-logic.test.mjs tests/domain/borne-rendre-k7.test.mjs
git commit -m "feat(location): retour anticipé sous 8 h pour tout le monde"
```

Le « Rendre » de « Mon compte » (non commité au début de ce plan) part avec ce commit : ajouter aussi
`src/components/kiosk/KioskAccount.tsx`, `KioskPanels.module.css`, `KioskView.tsx` s'ils portent encore ses
modifications (vérifier par `git diff` qu'il n'y a rien d'autre).

---

### Task 2: Exemplaires 2/1 côté serveur, et la fin de chaque location en cours

**Files:**
- Modify: `lib/db.ts:174-187` (remplacer le bloc « Set stock based on aisle »)
- Modify: `lib/films.ts:336-338` (`setFilmNouveaute`)
- Modify: `scripts/seed-films.ts:398-401`
- Modify: `lib/rentals.ts:38-47` (`RentalStatus`), `:207-232` (`getFilmRentalStatus`)
- Modify: `src/api/index.ts:335-343` (type `rental_status`)
- Test: `tests/domain/rental-rules.test.mjs`

**Interfaces:**
- Consumes: `copiesForFilm` (tâche 1).
- Produces: `RentalStatus.active_returns: { expires_at: string; mine: boolean }[]` — une entrée par location en
  cours du film, triées par `expires_at` croissant (l'ordre de `getActiveRentalsForFilm`), **sans identifiant
  d'utilisateur** ; même champ dans le type client `FilmWithRentalStatus.rental_status`.

- [ ] **Step 1: Write the failing test** (audit du texte, motif du dépôt) :

```js
test('EXEMPLAIRES: une migration unique, guidée par PRAGMA user_version, et plus l\'ancienne règle 3/2/1', () => {
  const db = src('lib/db.ts');
  assert.match(db, /PRAGMA user_version/);
  assert.match(db, /copiesForFilm/);
  assert.doesNotMatch(db, /SET stock = 3 WHERE is_nouveaute = 1/);
  assert.match(src('lib/films.ts'), /setFilmNouveaute[\s\S]{0,300}copiesForFilm\(isNouveaute\)/);
  assert.match(src('scripts/seed-films.ts'), /copiesForFilm\(/);
  assert.match(src('lib/rentals.ts'), /active_returns: activeRentals\.map\(/);
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test tests/domain/rental-rules.test.mjs` → FAIL.

- [ ] **Step 3: Implement**
  - `lib/db.ts` : supprimer le bloc qui se rejoue à chaque démarrage ; à sa place, si `PRAGMA user_version` < 1 :
    dans une transaction, `UPDATE films SET stock = 2 WHERE is_nouveaute = 1`, `UPDATE films SET stock = 1 WHERE
    is_nouveaute = 0 OR is_nouveaute IS NULL`, puis `PRAGMA user_version = 1`. Valeurs tirées de `COPIES_NOUVEAUTE` /
    `COPIES_AUTRE`. Commentaire : décision de Rusmir du 26/11/2026, migration unique pour ne pas écraser un stock réglé
    ensuite dans l'admin.
  - `setFilmNouveaute` : met aussi `stock = copiesForFilm(isNouveaute)`. `setFilmStock` reste (réglage à la main).
  - Seed : `const stock = copiesForFilm(mapping.is_nouveaute)`.
  - `getFilmRentalStatus` : `active_returns: activeRentals.map((r) => ({ expires_at: r.expires_at, mine: r.user_id === userId }))`.
    `earliest_return` reste (le vidéoclub 3D le lit).

- [ ] **Step 4: Run to verify it passes** — même commande → PASS ; `npx tsc --noEmit` → 0.

- [ ] **Step 5: Vérifier la migration sur une copie de la base**

```bash
cp zone.db "$SCRATCHPAD/zone-copie.db"   # le scratchpad de la session, jamais /tmp
sqlite3 "$SCRATCHPAD/zone-copie.db" "SELECT is_nouveaute, stock, COUNT(*) FROM films GROUP BY 1,2"
```
Lancer le serveur de dev 3003 avec `DATABASE_PATH=<copie>`, appeler `GET /api/films` une fois, puis relancer la même
requête SQL. Expected : seulement (1, 2) et (0 ou NULL, 1) ; `PRAGMA user_version` = 1. Modifier un stock à la main
dans la copie, redémarrer : il n'est pas écrasé.

- [ ] **Step 6: Commit**

```bash
git add lib/db.ts lib/films.ts scripts/seed-films.ts lib/rentals.ts src/api/index.ts tests/domain/rental-rules.test.mjs
git commit -m "feat(location): 2 exemplaires pour une nouveauté, 1 sinon ; fin de chaque location en cours"
```

---

### Task 3: L'état de chaque exemplaire sur la fiche de la borne

**Files:**
- Create: `src/components/kiosk/kiosk-copies.ts`
- Modify: `src/components/kiosk/KioskAction.tsx:16-28` (`KioskFilmDetail`)
- Modify: `src/components/kiosk/KioskView.tsx:640-645` (lecture du détail)
- Modify: `src/components/kiosk/KioskDetail.tsx:273-275` et l'endroit où `availability` est rendu
- Modify: `src/components/kiosk/kiosk-logic.ts:917-929` (supprimer `availabilityText`)
- Modify: `src/components/kiosk/KioskPanels.module.css` ou `KioskBrowse.module.css` (le fichier de la fiche)
- Test: `tests/domain/kiosk-copies.test.mjs` (nouveau) ; `tests/domain/kiosk-logic.test.mjs:395-399` (retirer)

**Interfaces:**
- Consumes: `active_returns` (tâche 2) ; `formatUntil(expiresAt, timeZone?)` de `kiosk-logic.ts`.
- Produces:
  - `KioskFilmDetail.returns: { atMs: number; mine: boolean }[]` (remplace `earliestReturn`), lu par
    `parseServerDate` depuis `active_returns`.
  - `export type CopyLine = { n: number; available: boolean; text: string };`
  - `export function copyLines(i: { stock: number; returns: ReadonlyArray<{ atMs: number; mine: boolean }> } | null, timeZone?: string): CopyLine[] | null`
    — `max(stock, returns.length)` lignes ; les louées d'abord dans l'ordre des retours, puis les disponibles.

- [ ] **Step 1: Write the failing test**

```js
const at = Date.UTC(2026, 10, 27, 20, 0); const tz = 'Europe/Paris';
assert.deepEqual(C.copyLines({ stock: 2, returns: [] }, tz), [
  { n: 1, available: true, text: 'disponible' }, { n: 2, available: true, text: 'disponible' }]);
assert.deepEqual(C.copyLines({ stock: 2, returns: [{ atMs: at, mine: false }] }, tz), [
  { n: 1, available: false, text: 'loué · retour prévu le 27 novembre à 21:00' }, { n: 2, available: true, text: 'disponible' }]);
assert.equal(C.copyLines({ stock: 1, returns: [{ atMs: at, mine: true }] }, tz)[0].text, 'loué par vous · jusqu\'au 27 novembre à 21:00');
// Plus de locations que d'exemplaires (stock réduit) : aucune cachée.
assert.equal(C.copyLines({ stock: 1, returns: [{ atMs: at, mine: false }, { atMs: at + 1, mine: true }] }, tz).length, 2);
// Date illisible : « loué », sans date.
assert.equal(C.copyLines({ stock: 1, returns: [{ atMs: NaN, mine: false }] }, tz)[0].text, 'loué');
assert.equal(C.copyLines(null), null);
```

- [ ] **Step 2: Run to verify it fails** — `node --test tests/domain/kiosk-copies.test.mjs` → FAIL.

- [ ] **Step 3: Implement** `copyLines` ; dans la fiche, à la place de la phrase « N copies sur M en rayon », un bloc
  titré « Exemplaires » avec une ligne par `CopyLine` (`▮ n° 1   disponible`, spec § 7 bis.2), disponible en clair,
  loué atténué. Supprimer `availabilityText` et ses tests.

- [ ] **Step 4: Run** — `node --test tests/domain/kiosk-copies.test.mjs tests/domain/kiosk-logic.test.mjs` → PASS ;
  `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit** (`git add` des fichiers listés) — `feat(borne): l'état de chaque exemplaire sur la fiche`.

---

### Task 4: Les messages de la borne savent montrer une liste

**Files:**
- Modify: `src/components/kiosk/KioskNotice.tsx`
- Modify: `src/components/kiosk/KioskPanels.module.css` (`.kNoticeList`)
- Test: `tests/domain/kiosk-wiring.test.mjs`

**Interfaces:**
- Produces: `KioskNoticeSpec.lines?: string[]` — rendues en `<ul className={styles.kNoticeList}>` sous `body`, une
  `<li>` par ligne ; le focus initial suit aussi `lines` (dépendance de l'effet).

- [ ] **Step 1: Test** — assertion de texte : `KioskNotice.tsx` déclare `lines?: string[]` et rend `lines.map(`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(borne): listes dans les messages`.

---

### Task 5: Le parcours du retour, partagé par « Mon compte » et la proposition

**Files:**
- Create: `src/components/kiosk/useKioskReturn.ts`
- Modify: `src/components/kiosk/kiosk-account-logic.ts` (textes)
- Modify: `src/components/kiosk/KioskAccount.tsx:140-174` (le retour sort du composant), `:250-265` (props)
- Modify: `src/components/kiosk/KioskView.tsx` (brancher le crochet ; quelques lignes)
- Test: `tests/domain/kiosk-account-logic.test.mjs`, `tests/domain/borne-rendre-k7.test.mjs`

**Interfaces:**
- Consumes: `KioskNoticeSpec.lines` (tâche 4) ; `copyLines` (tâche 3) ; `reviewStateFor`, `KioskReviewState`
  (`kiosk-logic.ts`) ; `store.returnFilm`, `store.fetchMe`, `api.films.getById(tmdbId)`.
- Produces:
  - `export function returnReviewOffer(state: KioskReviewState): { kind: 'write' } | { kind: 'later'; reason: string } | null`
    — `possible` → write ; `pas-encore` → later avec la raison du serveur ; `publiée` → null.
  - `export function useKioskReturn(o: { films: Film[]; onNotice: (n: KioskNoticeSpec | null) => void; onReview: (filmId: number) => void; beforeReturn?: (filmId: number) => void }): { returningId: number | null; askReturn: (filmId: number) => void; startReturn: (filmId: number) => void }`
    - `askReturn` : la question actuelle de « Mon compte » (`returnConfirmText`), puis `startReturn`.
    - `startReturn` : `beforeReturn?.(filmId)` (la tâche 7 y arrête un rembobinage), `returnFilm`, puis en parallèle
      `fetchMe()` et le détail du film (exemplaires) ; enfin le message : titre/texte de `returnDoneText`, `lines` =
      les exemplaires (`n° 1 · disponible`), boutons selon `returnReviewOffer` — `write` : primaire « Écrire ma
      critique » → `onReview(filmId)`, secondaire « Fermer » ; `later` : la raison ajoutée au texte, « Fermer » seul ;
      `null` : « Fermer » seul. « Fermer » garde le traitement actuel de `cast.notice` (`castDismiss`).
  - `KioskAccount` reçoit `returningId` et `onAskReturn: (filmId: number) => void` au lieu de son état interne.

- [ ] **Step 1: Write the failing tests**

```js
assert.deepEqual(K.returnReviewOffer({ kind: 'possible' }), { kind: 'write' });
assert.deepEqual(K.returnReviewOffer({ kind: 'pas-encore', reason: 'Critique possible à partir du 27 novembre à 21:10' }),
  { kind: 'later', reason: 'Critique possible à partir du 27 novembre à 21:10' });
assert.equal(K.returnReviewOffer({ kind: 'publiée' }), null);
// Échec (location échue entre-temps) : le message d'échec, jamais « K7 rendue ».
assert.equal(K.returnDoneText(null, false).title, "Le retour n'a pas abouti");
```
Dans `borne-rendre-k7.test.mjs`, réécrire les assertions de câblage : `useKioskReturn.ts` contient
`await returnFilm(filmId)`, `returnReviewOffer(`, `label: 'Écrire ma critique'` ; `KioskAccount.tsx` appelle
`onAskReturn(row.filmId)` ; `KioskView.tsx` appelle `useKioskReturn(`.

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (le contenu de `doReturn`/`askReturn` de `KioskAccount` passe dans le crochet).
- [ ] **Step 4: Run** `node --test tests/domain/kiosk-account-logic.test.mjs tests/domain/borne-rendre-k7.test.mjs` →
  PASS ; `npx tsc --noEmit` → 0.
- [ ] **Step 5: Commit** — `feat(borne): fin du retour — crédit, exemplaires, critique`.

---

### Task 6: La proposition à l'arrivée

**Files:**
- Modify: `src/components/kiosk/kiosk-account-logic.ts`
- Modify: `src/components/kiosk/useKioskReturn.ts` (ajout de `useReturnPrompt`)
- Modify: `src/components/kiosk/KioskView.tsx` (un appel)
- Test: `tests/domain/kiosk-account-logic.test.mjs`, `tests/domain/borne-rendre-k7.test.mjs`

**Interfaces:**
- Consumes: `startReturn` (tâche 5) ; `isEarlyReturn` (tâche 1) ; `reviewStateFor`.
- Produces:
  - `export type PromptRental = { filmId: number; rentedAt: number; watchProgress: number; watchCompletedAt: number | null; rewindClaimed: boolean };`
  - `export function returnPromptKey(userId: number, filmId: number, rentedAt: number): string` → `` `${userId}:${filmId}:${rentedAt}` ``
  - `export function returnPromptCandidate(rentals: ReadonlyArray<PromptRental>, asked: ReadonlySet<string>, userId: number): PromptRental | null`
    — `watchProgress >= 80`, clé absente de `asked`, `watchCompletedAt` le plus récent (null = le plus ancien).
  - `export function returnPromptText(i: { title: string; rentedAt: number; nowMs: number; rewound: boolean; review: KioskReviewState }): { title: string; body: string; lines: string[] }`
    — titre `Vous avez fini « ${title} » ?`, texte « Rendez la K7 à la borne : », lignes dans cet ordre et seulement
    si vraies : « rendue avant 8 h : +1 crédit » (`isEarlyReturn`), « rembobinez-la d'abord dans « Mon compte » : +1
    crédit » (`!rewound`), « votre critique ensuite : +1 crédit » (`review.kind === 'possible'`).
  - `export function readAsked(storage: Pick<Storage, 'getItem'> | null): Set<string>` et
    `export function rememberAsked(storage: Pick<Storage, 'getItem' | 'setItem'> | null, key: string): void` — clé de
    stockage `zone-borne-retour-demande`, tableau JSON ; toute exception ou valeur illisible → ensemble vide / rien.
  - `export function useReturnPrompt(o: { active: boolean; startReturn: (filmId: number) => void; onNotice: (n: KioskNoticeSpec | null) => void; films: Film[] }): void`
    — `active` = `!welcome && isAuthenticated && overlay === null && distribution === null && reviewFilmId === null &&
    !authVisible` (calculé dans `KioskView`). Au premier passage à vrai : `fetchMe()`, puis une seule évaluation pour
    cette ouverture de la borne ; s'il y a un candidat, `rememberAsked` puis le message : primaire « Rendre la K7 » →
    `startReturn(filmId)`, secondaire « Plus tard » → `onNotice(null)`.

- [ ] **Step 1: Write the failing tests**

```js
const r = (filmId, p, done, extra = {}) => ({ filmId, rentedAt: 1000 + filmId, watchProgress: p, watchCompletedAt: done, rewindClaimed: false, ...extra });
assert.equal(K.returnPromptCandidate([r(1, 79, null)], new Set(), 7), null);
assert.equal(K.returnPromptCandidate([r(1, 80, 50), r(2, 95, 90)], new Set(), 7).filmId, 2, 'le plus récemment fini');
assert.equal(K.returnPromptCandidate([r(2, 95, 90)], new Set([K.returnPromptKey(7, 2, 1002)]), 7), null, 'une fois par location');
// Stockage qui lève (navigation privée) : ni exception ni mémoire.
const boom = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
assert.deepEqual([...K.readAsked(boom)], []); K.rememberAsked(boom, 'k');
const t = K.returnPromptText({ title: 'Alien', rentedAt: 0, nowMs: 9 * 3_600_000, rewound: false, review: { kind: 'possible' } });
assert.equal(t.title, 'Vous avez fini « Alien » ?');
assert.deepEqual(t.lines, ['rembobinez-la d\'abord dans « Mon compte » : +1 crédit', 'votre critique ensuite : +1 crédit']);
```
Câblage : `KioskView.tsx` appelle `useReturnPrompt(` avec `active:` qui contient `!welcome`.

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS ; `npx tsc --noEmit` → 0.
- [ ] **Step 5: Commit** — `feat(borne): proposer de rendre un film vu, à l'arrivée`.

---

### Task 7: « Rembobiner » dans « Mon compte »

**Files:**
- Create: `src/components/kiosk/useKioskRewind.ts`
- Modify: `src/components/kiosk/kiosk-account-logic.ts`
- Modify: `src/components/kiosk/KioskAccount.tsx` (troisième bouton de la ligne)
- Modify: `src/components/kiosk/KioskView.tsx` (brancher ; `beforeReturn` de `useKioskReturn` = `rewind.cancel`)
- Test: `tests/domain/kiosk-account-logic.test.mjs`, `tests/domain/borne-rendre-k7.test.mjs`

**Interfaces:**
- Consumes: `api.rentals.claimRewind(filmId)` (`src/api/index.ts:226`), `store.fetchMe`.
- Produces:
  - `export const REWIND_MS = 60_000;`
  - `export const REWIND_SOUNDS: { rewind: string | null; robot: string | null } = { rewind: null, robot: null };`
    (les fichiers arrivent en livraison 2, après écoute par Rusmir ; `null` = silence).
  - `export function canRewind(r: { watchProgress: number; rewindClaimed: boolean } | undefined): boolean` —
    `watchProgress >= 80 && !rewindClaimed`.
  - `export function useKioskRewind(o: { onNotice: (n: KioskNoticeSpec | null) => void }): { rewindingId: number | null; start: (filmId: number) => void; cancel: (filmId: number) => void }`
    — un seul rembobinage à la fois ; `start` joue `REWIND_SOUNDS.rewind` s'il existe, arme une minuterie de
    `REWIND_MS` ; à l'échéance : `claimRewind`, `fetchMe`, puis `REWIND_SOUNDS.robot` s'il existe ; échec du serveur →
    message « Le rembobinage n'a pas abouti » (« Fermer »). `cancel(filmId)` et le démontage de la borne coupent son et
    minuterie, **sans crédit**. Rien ne bloque l'écran pendant les 60 s.
  - `KioskAccount` : props `rewindingId: number | null; onRewind: (filmId: number) => void` ; bouton « Rembobiner »
    (ou « Rembobinage… » quand `rewindingId === row.filmId`) sur les lignes où `canRewind` est vrai.

- [ ] **Step 1: Write the failing tests**

```js
assert.equal(K.REWIND_MS, 60_000);
assert.equal(K.canRewind({ watchProgress: 80, rewindClaimed: false }), true);
assert.equal(K.canRewind({ watchProgress: 79, rewindClaimed: false }), false);
assert.equal(K.canRewind({ watchProgress: 100, rewindClaimed: true }), false);
assert.equal(K.canRewind(undefined), false);
```
Câblage : `useKioskRewind.ts` contient `REWIND_MS` dans un `setTimeout` suivi de `claimRewind(` ; son nettoyage
appelle `clearTimeout` ; `KioskView.tsx` passe `beforeReturn: rewind.cancel` à `useKioskReturn` (retour d'un film en
cours de rembobinage → pas de crédit) ; `useKioskReturn.ts` ne contient pas `claimRewind` (le retour ne rembobine
jamais).

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS ; `npx tsc --noEmit` → 0.
- [ ] **Step 5: Commit** — `feat(borne): rembobiner dans « Mon compte », crédit au bout de 60 s`.

---

### Task 8: Vérification de bout en bout

**Files:**
- Create (scratchpad de la session, pas le dépôt) : `verif-retour.cjs`, sur le modèle de `verif-rendre.cjs`
  (Playwright, Chrome, téléphone émulé, serveur de dev 3003, compte de test neuf créé par l'API).

- [ ] **Step 1: Préparer** deux locations sur le compte de test (une nouveauté, un autre film) ; passer leur
  `watch_progress` à 90 dans **la base du worktree** (`sqlite3 zone.db`, jamais la base de Rusmir ni la prod).
- [ ] **Step 2: Scénario** — ouvrir la borne, toucher l'accueil. Expected : « Vous avez fini « … » ? » pour le film le
  plus récemment fini, avec ses lignes. « Plus tard » → fermer la borne, la rouvrir → plus de question pour ce film,
  question pour l'autre. « Rendre la K7 » → message « K7 rendue », « Rendue en avance : +1 crédit », la liste des
  exemplaires (n° 1 disponible), « Écrire ma critique » ouvre la critique ; crédits relus côté serveur (`/api/me`).
- [ ] **Step 3: Rembobiner** — « Mon compte » → « Rembobiner » → le bouton dit « Rembobinage… », la borne reste
  utilisable ; après 60 s, solde +1 et « Rembobiné ». Fermer la borne à 30 s → aucun crédit.
- [ ] **Step 4: Fiche** — un film nouveauté loué par le compte : « Exemplaires », n° 1 « loué par vous · jusqu'au … »,
  n° 2 « disponible » ; un autre film : une seule ligne.
- [ ] **Step 5: Suite complète** — `node --test "tests/**/*.test.mjs"` : seuls les 9 échecs de la baseline ;
  `npx tsc --noEmit` → 0 ; erreurs de page : 0.
- [ ] **Step 6: Pixel 9a** — le même parcours sur le téléphone réel (serveur 3002, build), sans `adb screencap`
  (captures par CDP seulement). Montrer les captures à Rusmir.

---

## Suite (plans séparés, après cette livraison)

- **Livraison 2 — les sons du rembobinage** : fabriquer le rembobinage de ~60 s (démarrage, forte accélération,
  ralentissement sur les 10 dernières secondes, « clac ») et extraire le son du robot de la vidéo de location ; les
  faire écouter à Rusmir, puis renseigner `REWIND_SOUNDS`.
- **Livraison 3 — le film de retour** : image fixe de la main d'abord, puis images clés, rendu Blender, fichiers
  d'accompagnement, branchement entre la réponse du serveur et le message de fin (spec § 5).
