# Suivi serveur d'un film regardé sur la TV — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un film regardé sur la TV, téléphone éteint, est noté vu par le serveur à l'heure de fin estimée de la séance de Cast, et le lecteur propose de rembobiner quand on le rouvre.

**Architecture:** La règle « séance finie → location vue » vit dans un petit module serveur qui reçoit la base en paramètre (`lib/cast-completion.ts`), appelé par le vérificateur existant avant la notification. Côté client, une fonction pure décide à l'ouverture du lecteur s'il faut proposer le rembobinage, et `VHSPlayer` l'applique une fois par ouverture.

**Tech Stack:** Next.js 16, better-sqlite3, React 19 / Zustand, tests `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-17-cast-suivi-serveur-design.md`

## Global Constraints

- Worktree `~/projetsperso/video-club-webgpu-borne`, branche `feat/borne-location`, commits locaux seulement, jamais `git add -A`.
- **Jamais de récepteur Chromecast maison** (décision de Rusmir) : on ne touche pas au récepteur.
- Valeurs de la spec : location notée vue = `watch_progress = 100`, `watch_position = 0`, `watch_completed_at` posé s'il est nul — **même si la location a expiré** ; noter la location **avant** la notification et **sans en dépendre** ; vérificateur toutes les 60 s (inchangé).
- `lib/cast-completion.ts` et `src/utils/cast-on-open.ts` n'ont **aucun import de valeur** (chargés tels quels par Node dans les tests).
- Vérification dans le navigateur sur le **port 3002**, build de production (recette `borne-recettes-verification`).
- Base de tests : 252 tests, 243 OK, 9 échecs préexistants (budget de taille, 6 intégration, P-01, île SF). Aucun nouvel échec.

## Review Focus

1. **Séance sans `rental_id`** (location introuvable au lancement du Cast) → la location la plus récente de ce visiteur pour ce film est notée → test `completeCastRental` « sans rental_id » (tâche 1).
2. **Rejeu** (le vérificateur repasse si la notification a échoué) → rien ne change la seconde fois, `watch_completed_at` garde sa première date → test « idempotent » (tâche 1).
3. **Rembobinage déjà réclamé** → à l'ouverture, pas de proposition, ouverture normale → test `shouldOfferRewindOnOpen` (tâche 2).
4. **Lecteur rouvert pendant que la TV joue encore ce film** → pas de proposition (le Cast reprend la main) → test `castingThisFilm: true` (tâche 2).
5. **Notification en échec** → la location est quand même notée → test statique : l'appel à `completeCastRental` précède `sendPushNotification` et a son propre `try` (tâche 1).

---

### Task 1: Le serveur note la location vue à la fin estimée de la séance

**Files:**
- Create: `lib/cast-completion.ts`
- Modify: `lib/cast-session-checker.ts` (boucle de `checkExpiredSessions`, L11-29)
- Test: `tests/domain/cast-completion.test.mjs` (nouveau)

**Interfaces:**
- Produces: `completeCastRental(database: { prepare(sql: string): { get(...a: unknown[]): unknown; run(...a: unknown[]): unknown } }, session: { rental_id: number | null; user_id: number; film_id: number }): boolean` — vrai si une location a été trouvée et notée.

- [ ] **Step 1: Écrire les tests qui échouent**

Base en mémoire : `new Database(':memory:')` (better-sqlite3), `exec(readFileSync('lib/schema.sql'))`, un utilisateur, un film, des locations insérées à la main.

```js
test('CAST SERVEUR: la séance finie note sa location vue, même expirée', () => {
  // location r1 : watch_progress 30, watch_position 812, is_active 0, expires_at dans le passé
  assert.equal(completeCastRental(db, { rental_id: r1, user_id: u, film_id: f }), true);
  const row = db.prepare('SELECT watch_progress, watch_position, watch_completed_at FROM rentals WHERE id = ?').get(r1);
  assert.equal(row.watch_progress, 100);
  assert.equal(row.watch_position, 0);
  assert.ok(row.watch_completed_at);
});
test('CAST SERVEUR: sans rental_id, la location la plus récente du visiteur pour ce film', () => {
  // deux locations du même film (r_old, r_new) : seule r_new passe à 100
});
test('CAST SERVEUR: idempotent — watch_completed_at garde sa première date', () => {
  // completed_at posé à '2026-01-01 00:00:00' avant l'appel ; deux appels ; la date ne bouge pas
});
test('CAST SERVEUR: aucune location → false, rien ne casse', () => {
  assert.equal(completeCastRental(db, { rental_id: null, user_id: u, film_id: 99999 }), false);
});
test('CAST SERVEUR: le vérificateur note la location avant la notification, sans en dépendre', () => {
  const src = readText('lib/cast-session-checker.ts');
  assert.ok(src.indexOf('completeCastRental(') !== -1 && src.indexOf('completeCastRental(') < src.indexOf('sendPushNotification('));
  // l'appel a son propre try/catch : un échec de notification ne l'annule pas, et inversement
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `node --test --test-reporter=tap tests/domain/cast-completion.test.mjs`
Expected: FAIL (`Cannot find module …/lib/cast-completion.ts`).

- [ ] **Step 3: Implémenter**

`completeCastRental` : la location vaut `rental_id` s'il est donné, sinon `SELECT id FROM rentals WHERE user_id = ? AND film_id = ? ORDER BY id DESC LIMIT 1` ; puis `UPDATE rentals SET watch_progress = 100, watch_position = 0, watch_completed_at = COALESCE(watch_completed_at, datetime('now')) WHERE id = ?`. Dans `checkExpiredSessions`, pour chaque séance : `try { completeCastRental(db, session) } catch {}` **puis** le bloc existant (notification, `markSessionNotified`). Commentaire en tête du module : pourquoi (téléphone éteint, spec).

- [ ] **Step 4: Lancer, vérifier**

Run: `node --test --test-reporter=tap tests/domain/cast-completion.test.mjs` puis `npx tsc --noEmit -p .`
Expected: `# fail 0` ; aucune erreur de type.

- [ ] **Step 5: Commit** — `feat(cast): le serveur note vue la location d'une séance de Cast finie`

---

### Task 2: Le lecteur propose de rembobiner à l'ouverture d'un film fini

**Files:**
- Modify: `src/utils/cast-on-open.ts`
- Modify: `src/components/player/VHSPlayer.tsx` (un effet près de « End of Film — Rewind Prompt », L1149 ; l'attribut `autoPlay` du `<video>`)
- Test: `tests/domain/cast-on-open.test.mjs` (ajouter)

**Interfaces:**
- Produces: `shouldOfferRewindOnOpen(i: { watchProgress: number; rewindClaimed: boolean; castingThisFilm: boolean }): boolean` — vrai si `watchProgress >= 100`, `!rewindClaimed` et `!castingThisFilm`.

- [ ] **Step 1: Écrire les tests qui échouent**

```js
test('REMBOBINAGE: proposé à l\'ouverture d\'un film fini, pas encore rembobiné', () => {
  const ok = { watchProgress: 100, rewindClaimed: false, castingThisFilm: false };
  assert.equal(shouldOfferRewindOnOpen(ok), true);
  assert.equal(shouldOfferRewindOnOpen({ ...ok, watchProgress: 99 }), false);
  assert.equal(shouldOfferRewindOnOpen({ ...ok, rewindClaimed: true }), false);
  assert.equal(shouldOfferRewindOnOpen({ ...ok, castingThisFilm: true }), false);
});
test('REMBOBINAGE: le lecteur applique la règle une fois par ouverture et ne lance pas le film derrière', () => {
  const player = readText('src/components/player/VHSPlayer.tsx');
  assert.ok(player.includes('shouldOfferRewindOnOpen('));
  assert.match(player, /autoPlay=\{[^}]*rewindPhase === 'none'/);
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `node --test --test-reporter=tap tests/domain/cast-on-open.test.mjs`
Expected: les deux tests `REMBOBINAGE:` échouent.

- [ ] **Step 3: Implémenter**

- La fonction pure dans `src/utils/cast-on-open.ts`.
- Dans `VHSPlayer`, un effet qui se déclenche quand le lecteur est ouvert et que sa location est connue, **une seule fois par ouverture et par film** (une ref remise à `null` à la fermeture) : `castingThisFilm = activeCastFilmId === currentPlayingFilm || playerState === 'casting' || playerState === 'awaitingCast'` ; si `shouldOfferRewindOnOpen(...)` : mettre la vidéo en pause, `setPlayerState('paused')`, `setPendingEject(false)` (« NON MERCI » laisse revoir le film au lieu d'éjecter), `setRewindPhase('prompt')`.
- `autoPlay` du `<video>` : ajouter `&& rewindPhase === 'none'` à la condition existante.

- [ ] **Step 4: Lancer, vérifier**

Run: `node --test --test-reporter=tap "tests/**/*.test.mjs"` puis `npx tsc --noEmit -p .`
Expected: pas plus que les 9 échecs préexistants ; aucune erreur de type.

- [ ] **Step 5: Commit** — `feat(lecteur): proposer de rembobiner à l'ouverture d'un film fini`

---

### Task 3: Vérification de bout en bout et documentation

**Files:**
- Modify: `AGENTS.md` (section « Player + Cast — machine à états unifiée » : un paragraphe « Suivi d'un film sur la TV »)

- [ ] **Step 1: Serveur.** Build de production, serveur sur le port 3002. Dans la base du worktree : une location active du compte de test `verif778804` (`watch_progress` bas, `rewind_claimed = 0`) et une séance de Cast `ended = 0, notified = 0` dont `estimated_end_at` est dans le passé. Attendre au plus 70 s. Expected : la location passe à `watch_progress = 100`, `watch_position = 0`, `watch_completed_at` posé ; la séance est `notified = 1`.
- [ ] **Step 2: Lecteur.** Navigateur à 412 × 915, borne, compte de test : ouvrir le lecteur sur ce film (Mes locations → Regarder, puis le lien `/?castEnded=<filmId>`). Expected : la proposition de rembobinage s'affiche, la vidéo est en pause ; « NON MERCI » laisse le film en pause sans fermer le lecteur. Puis rembobinage réclamé en base (`rewind_claimed = 1`) → ouverture normale, sans proposition.
- [ ] **Step 3: Documenter et commiter** — `docs(cast): suivi serveur d'un film regardé sur la TV`
