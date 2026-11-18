# Borne — « Mon compte », historique et critiques — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** « Compte » ouvre à tout moment un écran « Mon compte » (crédits, locations en cours, tout l'historique avec rembobinage, retour anticipé et critique), la critique s'écrit dans la borne à partir de 144 caractères selon la règle « 80 % vus + 80 % de la durée écoulée, sur n'importe quelle location », et le panneau d'après location demande « Où voulez-vous regarder ? ».

**Architecture:** Les règles décidables sont des fonctions pures (serveur : `lib/review-eligibility.ts`, `lib/rental-marks.ts` ; client : `kiosk-logic.ts`, `src/utils/review-rules.ts`) testées sans base ou sur base en mémoire. Le serveur calcule l'éligibilité aux critiques et la renvoie par `/api/me` ; la borne affiche, sans copie de la règle. `KioskAccount` remplace le message « Compte » et `KioskRentals` ; `KioskReview` est le formulaire.

**Tech Stack:** Next.js 16, better-sqlite3, React 19, Zustand 5, CSS Modules, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-17-borne-mon-compte-design.md`

## Global Constraints

- Worktree `~/projetsperso/video-club-webgpu-borne`, branche `feat/borne-location`, commits locaux, jamais `git add -A`.
- Règles de la borne (`AGENTS.md`, section borne) : aucun bouton `disabled` ; pas de `backdrop-filter` ; tailles en `cqw` ; pictogrammes dessinés (SVG), jamais tirés d'une police ; libellés écrits normalement (la feuille de style met l'action principale en capitales) ; zones d'appui ≥ 44 px ; le geste retour ne quitte jamais la borne.
- Modules chargés tels quels par Node dans les tests (aucun import de valeur) : `lib/review-eligibility.ts`, `lib/rental-marks.ts`, `src/utils/review-rules.ts`, `kiosk-logic.ts`.
- Valeurs de la spec : minimum de critique **144** ; critique permise si **une** location du film a `watch_progress >= 80` **et** (`watch_started_at` nul, ou `maintenant >= watch_started_at + 0,8 × durée`), durée = `films.duration_sec`, à défaut `runtime × 60` ; **une seule critique par film et par utilisateur** (modifiable) ; « +1 crédit » à la première publication ; `watch_started_at` posé seulement sur une location sans aucune progression.
- Raisons affichées : « Vous devez regarder au moins 80 % du film » ; « Critique possible à partir du {formatUntil} ».
- Ne pas renommer les champs existants de `RentalHistoryEntry` (le terminal et Michel les lisent) : on n'ajoute que des champs.
- Base de tests : 263 tests, 254 OK, 9 échecs préexistants. Aucun nouvel échec ; vérification navigateur sur le port 3002 (build de production).

## Review Focus

1. **Film loué deux fois, vu en entier la première, pas la seconde** → critique permise (la nouvelle location à 0 % ne la retire pas) → test `reviewEligibility` « n'importe quelle location » (tâche 3).
2. **Durée inconnue** (`duration_sec` et `runtime` nuls) → la garde de temps ne s'applique pas plutôt que de bloquer pour toujours → test (tâche 3).
3. **Location entamée avant le déploiement** → `watch_started_at` reste nul à la sauvegarde suivante → test `markWatchStarted` (tâche 2).
4. **Historique vide, ou film absent du catalogue chargé** → « Aucune location » / titre de repli → test `accountHistoryRows` (tâche 5).
5. **Critique déjà publiée** → la ligne dit « Critique publiée » et le formulaire s'ouvre en modification (PUT), sans « +1 crédit » → test statique `KioskReview` (tâche 6).

---

### Task 1: Le minimum de critique passe à 144 et les notes s'appellent par leur nom, définis une seule fois

**Files:**
- Create: `src/utils/review-rules.ts`
- Modify: `lib/reviews.ts:3,157-158,192-193` · `src/components/review/ReviewModal.tsx:15,71-73,210,334` · `src/components/player/VHSPlayer.tsx:15,2007-2009,…` (constante, message, placeholder, intitulés) · `src/components/manager/GenUICriticForm.tsx:19,55,60,79` · `src/components/terminal/TVTerminal.tsx:718-720` · `lib/chat-tools.ts:83` · `lib/chat.ts:64`
- Test: `tests/domain/review-rules.test.mjs`

**Interfaces:** Produces `REVIEW_MIN_LENGTH = 144` et `REVIEW_RATING_LABELS = { direction: 'Réalisation', screenplay: 'Scénario', acting: "Jeu d'acteurs" } as const` (Rusmir, 18/11 : « on ne peut pas juste écrire scén ou jeu, il faut dire scénario et jeu d'acteurs »).

- [ ] **Step 1: Tests qui échouent** — `REVIEW_MIN_LENGTH === 144` ; chacun des six fichiers ci-dessus importe ou cite `REVIEW_MIN_LENGTH` (les consignes de Michel citent « 144 ») ; aucun ne contient plus `500` dans une chaîne ou constante de critique (`/MIN_[A-Z_]*LENGTH\s*=\s*500|minimum 500|500\+|min\. 500|\/500/`) ; `VHSPlayer`, `ReviewModal`, `GenUICriticForm`, `TVTerminal` lisent `REVIEW_RATING_LABELS` et ne contiennent plus `'RÉAL'`, `'SCÉN'`, `'JEU'`, `Réal:`, `Scén:`, `Jeu:`, `'Realisation'`, `'Scenario'` (les « Réal » du générique de `VHSCaseOverlay` ne sont pas des notes : hors du test).
- [ ] **Step 2: Lancer** `node --test --test-reporter=tap tests/domain/review-rules.test.mjs` → FAIL (module absent).
- [ ] **Step 3: Implémenter** — remplacer chaque 500 par la constante (import relatif depuis `lib/` : `../src/utils/review-rules`) ; les deux consignes de Michel en texte : « au moins 144 caractères ».
- [ ] **Step 4: Vérifier** — test vert ; `npx tsc --noEmit -p .` sans erreur.
- [ ] **Step 5: Commit** — `feat(critiques): 144 caractères au minimum et notes nommées en entier, partout`

---

### Task 2: Les locations gardent leur lancement, leur retour et leur expiration

**Files:**
- Create: `lib/rental-marks.ts`
- Modify: `lib/db.ts` (migrations, après L135) · `lib/rentals.ts` (`updateWatchProgress` L313, `returnFilm` L485-487, `cleanupExpiredRentals` L538+) · `lib/cast-sessions.ts` (`createCastSession`)
- Test: `tests/domain/rental-marks.test.mjs` (base en mémoire, comme `cast-completion.test.mjs`, colonnes ajoutées à la main)

**Interfaces:** Produces
- colonnes `rentals.watch_started_at DATETIME`, `rentals.returned_at DATETIME`, `rentals.expired_at DATETIME` (migrations idempotentes, même modèle que `returned_early`) ;
- `markWatchStarted(database, rentalId: number): boolean` — pose `watch_started_at = datetime('now')` seulement si nul **et** `watch_progress = 0` **et** `watch_position = 0` ; vrai si posé.

- [ ] **Step 1: Tests qui échouent** — `markWatchStarted` pose la date sur une location vierge ; ne la pose pas sur une location à 30 % (entamée avant le déploiement) ; ne la change pas si déjà posée ; statiques : `updateWatchProgress` appelle `markWatchStarted` **avant** d'écrire la position, `createCastSession` l'appelle sur la location trouvée, `returnFilm` écrit `returned_at = datetime('now')`, `cleanupExpiredRentals` écrit `expired_at = expires_at`.
- [ ] **Step 2: Lancer** → FAIL.
- [ ] **Step 3: Implémenter.**
- [ ] **Step 4: Vérifier** — test vert, types sans erreur.
- [ ] **Step 5: Commit** — `feat(locations): heure de lancement, date de retour et d'expiration`

---

### Task 3: Une critique se mérite sur n'importe quelle location

**Files:**
- Create: `lib/review-eligibility.ts`
- Modify: `lib/reviews.ts` (`canUserReview` L89-136 : branche « film loué »)
- Test: `tests/domain/review-eligibility.test.mjs`

**Interfaces:** Produces
`reviewEligibility(rentals: ReadonlyArray<{ watch_progress: number | null; watch_started_at: string | null; duration_sec: number | null; runtime: number | null }>, nowMs: number): { allowed: boolean; reason: string | null; availableAtMs: number | null }` — dates SQLite UTC sans fuseau lues comme UTC.

- [ ] **Step 1: Tests qui échouent** — une location à 100 % sans `watch_started_at` → permise ; 100 % lancée il y a 10 min sur un film de 2 h → refusée, raison commençant par « Critique possible à partir du », `availableAtMs` = lancement + 0,8 × 7200 s ; même film, une autre location ancienne qui remplit tout → permise (Review Focus 1) ; seule location à 40 % → « Vous devez regarder au moins 80 % du film », `availableAtMs` nul ; durée inconnue → garde de temps ignorée (Review Focus 2) ; `runtime` utilisé quand `duration_sec` est nul.
- [ ] **Step 2: Lancer** → FAIL.
- [ ] **Step 3: Implémenter** — la raison « possible à partir du » porte la date la plus proche parmi les locations à ≥ 80 %, formatée comme `formatUntil` (`toLocaleString('fr-FR', { day, month: 'long', hour, minute, timeZone: 'Europe/Paris' })`). `canUserReview` lit **toutes** les locations du film (`SELECT r.watch_progress, r.watch_started_at, f.duration_sec, f.runtime FROM rentals r JOIN films f …`) et délègue ; le doublon (« Vous avez déjà critiqué ce film »), l'admin et le film jamais loué ne changent pas.
- [ ] **Step 4: Vérifier** — test vert, types sans erreur.
- [ ] **Step 5: Commit** — `feat(critiques): permise sur n'importe quelle location vue, après 80 % de la durée`

---

### Task 4: `/api/me` dit ce qu'on peut encore critiquer, le magasin garde l'historique complet

**Files:**
- Modify: `app/api/me/route.ts` · `lib/reviews.ts` (export `getReviewEligibilityForUser(userId): Array<{ film_id: number; allowed: boolean; reason: string | null; available_at_ms: number | null }>` — films de l'historique non critiqués) · `src/api/index.ts` (`ApiRentalHistoryEntry` L430, `MeResponse` L435) · `src/store/index.ts` (`RentalHistoryEntry` L55-64, `fetchMe` L428-455)
- Test: `tests/domain/kiosk-wiring.test.mjs` (statique)

**Interfaces:** Produces
- `MeResponse.reviewEligibility` (le tableau ci-dessus) ; `ApiRentalHistoryEntry` gagne `watch_progress`, `rewind_claimed`, `returned_early`, `returned_at`, `expired_at` ;
- `RentalHistoryEntry` gagne `rewindClaimed: boolean`, `returnedEarly: boolean`, `watchProgress: number`, `returnDate: number | null` (`returned_at`), `expiredDate: number | null` (`expired_at`), `expiresAt: number` — sans toucher `returnedAt` ;
- magasin : `reviewEligibility: Record<number, { allowed: boolean; reason: string | null; availableAtMs: number | null }>` (vide si non connecté).

- [ ] **Step 1: Test statique qui échoue** — `route.ts` renvoie `reviewEligibility` ; `fetchMe` pose `reviewEligibility`, `rewindClaimed`, `returnedEarly`, `returnDate`, `expiredDate` ; le `catch` de `fetchMe` remet `reviewEligibility` à `{}`.
- [ ] **Step 2: Lancer** → FAIL. **Step 3: Implémenter** (dates par `parseServerDate`). **Step 4: Vérifier** — test vert, types sans erreur, suite à la base.
- [ ] **Step 5: Commit** — `feat(compte): historique complet et critiques possibles dans /api/me`

---

### Task 5: L'écran « Mon compte »

**Files:**
- Create: `src/components/kiosk/KioskAccount.tsx`
- Modify: `src/components/kiosk/kiosk-logic.ts` · `src/components/kiosk/KioskView.tsx` (`openAccount` L370-388, état `rentalsOpen` → `accountOpen`, `kioskBackAction`) · `src/components/kiosk/KioskPanels.module.css`
- Delete: `src/components/kiosk/KioskRentals.tsx` (absorbé)
- Test: `tests/domain/kiosk-logic.test.mjs`, `tests/domain/kiosk-wiring.test.mjs`

**Interfaces:** Produces
- `accountHistoryRows(history: RentalHistoryEntry[], reviewedFilmIds: ReadonlySet<number>, eligibility: Record<number, …>): KioskHistoryRow[]` avec `KioskHistoryRow = { filmId; title; posterUrl; end: { kind: 'rendu' | 'expiré' | 'terminée'; atMs: number | null }; rewound: boolean; returnedEarly: boolean; review: { kind: 'publiée' } | { kind: 'possible' } | { kind: 'pas-encore'; reason: string } }` — locations **terminées** seulement, la plus récente d'abord ; titre de repli « Titre indisponible » ;
- `reviewStateFor(filmId: number, reviewedFilmIds: ReadonlySet<number>, eligibility: Record<number, …>): KioskHistoryRow['review']` — utilisé par `accountHistoryRows` **et** par les lignes « En cours » (spec § 4 : on peut critiquer avant de rendre) ; film sans entrée d'éligibilité et non critiqué → « pas-encore » avec « Vous devez regarder au moins 80 % du film » ;
- `KioskBackAction` : `'close-rentals'` devient `'close-account'`, `rentalsOpen` devient `accountOpen` ;
- `KioskAccount(props: { films: Film[]; onWatch(filmId: number): void; onReview(filmId: number): void; onLogout(): void; onBack(): void })`.

- [ ] **Step 1: Tests qui échouent** — `accountHistoryRows` : « rendu » si `returnDate`, « expiré » si `expiredDate`, sinon « terminée » sans date ; badges rembobiné / rendu en avance ; critique « publiée » / « possible » / raison du serveur ; historique vide → `[]` ; location active exclue ; `reviewStateFor` pour un film critiqué, permis, refusé avec raison, sans entrée. Statiques : `KioskAccount` contient « Mon compte », « En cours », « Historique », « Se déconnecter », « Écrire ma critique », « +1 crédit », `rentalRows` et `accountHistoryRows` ; `KioskView` : « Compte » connecté ouvre `KioskAccount` (plus de message « Compte »), `KioskRentals` n'existe plus ; `fetchMe` est appelé à l'ouverture de l'écran.
- [ ] **Step 2: Lancer** → FAIL. **Step 3: Implémenter** (✓ / ✗ dessinés en SVG ; un bonus manqué n'est pas un bouton). **Step 4: Vérifier.**
- [ ] **Step 5: Commit** — `feat(borne): écran « Mon compte » avec tout l'historique`

---

### Task 6: Le formulaire de critique de la borne

**Files:**
- Create: `src/components/kiosk/KioskReview.tsx`
- Modify: `src/components/kiosk/KioskView.tsx` (ouverture depuis `KioskAccount`, geste retour) · `kiosk-logic.ts` (`kioskBackAction` : `'close-review'`, avant `'close-account'`) · `KioskPanels.module.css`
- Test: `tests/domain/kiosk-logic.test.mjs`, `tests/domain/kiosk-wiring.test.mjs`

**Interfaces:** Produces `reviewFormCheck(i: { length: number; ratings: [number, number, number] }): string | null` (pure : `null` si publiable, sinon « Encore {n} caractères » ou « Donnez les trois notes ») ; `KioskReview(props: { film: Film; existing: { content: string; ratings: [number, number, number] } | null; onDone(): void; onBack(): void })`.

- [ ] **Step 1: Tests qui échouent** — `reviewFormCheck({ length: 143, ratings: [4,4,4] })` → « Encore 1 caractère » ; `{ length: 144, ratings: [4,0,4] }` → « Donnez les trois notes » ; `{ length: 144, ratings: [1,5,3] }` → `null`. Statiques : `KioskReview` utilise `REVIEW_MIN_LENGTH`, appelle `api.reviews.create` sans critique existante et `api.reviews.update` sinon, n'affiche « +1 crédit » que pour une création, appelle `fetchMe` après publication, ne contient aucun `disabled` ; `kioskBackAction({…, reviewOpen: true, accountOpen: true })` → `'close-review'`.
- [ ] **Step 2: Lancer** → FAIL. **Step 3: Implémenter** (trois rangées de 5 étoiles dessinées, zones d'appui ≥ 44 px ; « PUBLIER » dit ce qui manque au lieu de se griser). **Step 4: Vérifier.**
- [ ] **Step 5: Commit** — `feat(borne): écrire sa critique depuis « Mon compte »`

---

### Task 7: « Où voulez-vous regarder ? »

**Files:**
- Modify: `src/components/kiosk/KioskDistribution.tsx` · `kiosk-logic.ts` · `KioskView.tsx` (« Mon compte › » au lieu de « Mes locations › ») · `KioskPanels.module.css`
- Test: `tests/domain/kiosk-logic.test.mjs`, `tests/domain/kiosk-wiring.test.mjs`

**Interfaces:** Produces `watchHereLabel(i: { coarsePointer: boolean; shortSide: number }): 'Sur ce téléphone' | 'Sur cette tablette' | 'Sur cet ordinateur'` (téléphone : pointeur grossier et petit côté ≤ `PHONE_SHORT_SIDE_MAX`) ; `tvMeansLabel(airPlay: boolean): 'via AirPlay' | 'via Chromecast'` (borne : `appleAirPlay(navigator.userAgent, HTMLVideoElement.prototype)`).

- [ ] **Step 1: Tests qui échouent** — les trois libellés d'appareil ; les deux moyens ; statiques : le panneau contient « Où voulez-vous regarder ? », « Sur ma télé », « le film démarre ici », « Mon compte », deux `<svg`, plus « Mes locations ».
- [ ] **Step 2: Lancer** → FAIL. **Step 3: Implémenter** (deux boutons pleine largeur à deux lignes ; le premier en action principale). **Step 4: Vérifier.**
- [ ] **Step 5: Commit** — `feat(borne): « Où voulez-vous regarder ? »`

---

### Task 8: Vérification dans le navigateur et documentation

**Files:** Modify `AGENTS.md` (section borne : « Mon compte », critiques) · statut de la spec.

- [ ] **Step 1** — build de production, port 3002, compte `verif778804`, 412 × 915 puis 1440 × 900 : « Compte » sans avoir loué ouvre « Mon compte » ; en cours + historique ; une location rendue (`POST /api/rentals/<id>/return`) apparaît « rendu le … » avec ses badges ; critique : une location vue à 100 % lancée il y a longtemps → « Écrire ma critique · +1 crédit » → 143 caractères refusés avec la raison, 144 publiés, crédit +1, ligne « Critique publiée » ; une location à 100 % lancée il y a 5 min → raison « Critique possible à partir du … » ; panneau d'après location : libellés et pictogrammes ; geste retour : formulaire → compte → borne.
- [ ] **Step 2** — captures montrées à Rusmir ; ce qui n'a pas pu être testé, dit tel quel.
- [ ] **Step 3: Commit** — `docs(borne): « Mon compte » et critiques`
