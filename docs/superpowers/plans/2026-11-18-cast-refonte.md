# Refonte du Cast — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un Cast qui ne coince jamais le visiteur : télécommande fidèle à la TV, reprise après fermeture du lecteur, arrière-plan ou rechargement, fin du film reconnue, suivi serveur systématique.

**Architecture:** Un service unique (`src/cast/`, sans React) initialise le SDK une seule fois et traduit ses événements pour une machine à états pure (`castReduce`), qui rend l'état et les effets à lancer. Une tranche du store publie cet état ; `VHSPlayer` et la borne le lisent et envoient des intentions, sans plus rien décider. Côté serveur, les séances de Cast passent par un module à base injectée (création sans durée, correction, pas de doublon, clôture).

**Tech Stack:** Next.js 16, React 19, Zustand 5, SDK Google Cast (émetteur web, récepteur standard), better-sqlite3, tests `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-18-cast-refonte-design.md` — à lire en entier avant toute tâche (constats D1 à D7, faits F1 à F3, § 5.2 bis).

## Global Constraints

- Worktree `~/projetsperso/video-club-webgpu-borne`, branche `feat/borne-location`, **commits locaux seulement**, jamais `git add -A`, jamais de push.
- **Jamais de récepteur Chromecast maison** ; `NEXT_PUBLIC_GOOGLE_CAST_APP_ID` reste facultatif (récepteur standard par défaut).
- **`setOptions(` n'apparaît qu'une fois dans `src/`** (dans `src/cast/cast-service.ts`). C'est la cause de D1.
- `src/cast/cast-machine.ts`, `src/cast/cast-wire.ts` et `lib/cast-session-store.ts` n'ont **aucun import de valeur** : Node les charge tels quels dans les tests (`import … from '../../src/cast/cast-machine.ts'`).
- Jamais de lecture locale lancée d'office ; jamais le film sur le téléphone et la TV à la fois.
- Pas de `<button disabled>` (échec silencieux sur mobile, cf. `AGENTS.md`) : un bouton en attente porte `aria-busy="true"`, est estompé, et son gestionnaire ignore l'appui.
- Textes exacts : « Connexion à {nom}… », « Lancement du film sur {nom}… », « Annuler », « La télé ne répond plus », « Réessayer », « Continuer sur ce téléphone » (libellé d'appareil par `watchHereLabel`), « Fermer », « La diffusion sur {nom} s'est arrêtée », « La télé n'a pas pu lire le film », « Location terminée », « Film terminé », « {titre} est en cours sur {nom} », « Impossible de joindre {nom} », « Le film n'a pas pu démarrer sur {nom} », « ← Retour à la borne », « ← Retour au vidéoclub ».
- Délais (constantes exportées de `cast-machine.ts`) : `CAST_CONNECT_TIMEOUT_MS = 20000`, `CAST_LOAD_TIMEOUT_MS = 20000`, `CAST_ACK_TIMEOUT_MS = 5000`, `CAST_STATUS_TIMEOUT_MS = 5000`, `CAST_REPORT_EVERY_MS = 10000`. Aucun délai pendant `choosing`.
- Nouveaux fichiers ≤ 1000 lignes (`tests/architecture/file-size.test.mjs`). `VHSPlayer.tsx` doit **diminuer**.
- Sur cette machine, `grep`, `rg`, `sed` et `awk` par motif sont refusés dans le shell : lire avec l'outil Read, ou un petit `node -e`.
- `next dev` réécrit `AGENTS.md` et `next-env.d.ts` : `git checkout --` ces deux fichiers avant chaque commit.
- Vérification à l'écran : **build de production, port 3002** (`RADARR_API_KEY=x npm run build`, puis serveur autonome, recette dans la mémoire `borne-recettes-verification`).
- Base des tests avant ce chantier : **332 tests, 323 OK, 9 échecs préexistants** (budget de taille, 6 d'intégration, P-01, île SF). Aucun nouvel échec ; les 9 ne sont pas à corriger ici.
- Écart assumé avec la spec : `customData` porte `{ filmId }` seul (le type `Rental` du client n'a pas d'identifiant de location ; le serveur retrouve la location par visiteur et film).

## Review Focus

1. **Double appui sur « Regarder sur TV »** pendant le choix ou le chargement → un seul sélecteur, un seul chargement → test « demande répétée ignorée » (tâche 2).
2. **Statut tardif après « Arrêter »** (la TV annonce encore `PLAYING` une seconde après) → la télécommande ne réapparaît pas → test « statut après arrêt ignoré » (tâche 2).
3. **Média inconnu sur la TV** (pas de `customData.filmId`) → pas de télécommande, lecteur local normal → test « média sans film » (tâche 2).
4. **Valeurs absurdes envoyées au serveur** (position négative, `NaN`, durée nulle) → bornées ou ignorées, jamais de date de fin invalide → test « entrées bornées » (tâche 1).
5. **Location sans source jouable** (ni VF ni VO) → pas de sélecteur, un message → test `castSourceFor` rend `null` (tâche 3).

---

### Task 1: Serveur — séances de Cast sans trou

**Files:**
- Create: `lib/cast-session-store.ts`
- Modify: `lib/cast-sessions.ts` (devient une fine enveloppe autour du module ci-dessus), `app/api/cast-sessions/route.ts`, `lib/cast-session-checker.ts:19-24`, `src/api/index.ts:509-530`
- Test: `tests/domain/cast-session-store.test.mjs` (nouveau ; base en mémoire, même `freshDb()` que `tests/domain/cast-completion.test.mjs`, avec `duration_sec` renseigné sur le film)

**Interfaces:**
- Consumes: `completeCastRental(db, session)` de `lib/cast-completion.ts`, `markWatchStarted(db, rentalId)` de `lib/rental-marks.ts` (passés en paramètre, pas importés).
- Produces (toutes prennent la base en premier paramètre) :
  - `openCastSession(db, i: { userId: number; filmId: number; position: number; durationSeconds?: number | null }, deps: { markWatchStarted(db, rentalId: number): void }): { id: number; rental_id: number; duration_seconds: number; estimated_end_at: string } | null` — `null` si le visiteur n'a pas de location active de ce film, ou si aucune durée n'existe (ni reçue, ni `films.duration_sec`).
  - `reportCastSession(db, i: { userId: number; filmId: number; position: number; durationSeconds?: number | null }, deps): boolean` — met à jour la séance ouverte ; s'il n'y en a pas, en ouvre une (mêmes règles que `openCastSession`).
  - `closeCastSession(db, i: { userId: number; filmId: number; position?: number | null; finished: boolean }, deps: { completeCastRental(db, s): boolean }): void`
  - API HTTP : `POST` `{ filmId, currentPosition, durationSeconds? }` → `{ session }` (200, `session: null` sans location) ou 400 `{ error: 'Durée du film inconnue' }` ; `PATCH` `{ filmId, currentPosition, durationSeconds? }` ; `DELETE` `{ filmId, currentPosition?, finished? }`.
  - Client : `api.castSessions.create(filmId, currentPosition, durationSeconds?)`, `.updatePosition(filmId, currentPosition, durationSeconds?)`, `.end(filmId, opts?: { position?: number; finished?: boolean })`.

- [ ] **Step 1: Écrire les tests (ils échouent : module absent)**

```js
test('CAST SÉANCE: sans durée reçue, celle du film en base', () => {
  const { db, u, f, rent } = freshDb({ filmDuration: 6840 });
  const r = rent();
  const s = openCastSession(db, { userId: u, filmId: f, position: 0 }, deps);
  assert.equal(s.duration_seconds, 6840);
  assert.equal(s.rental_id, r);
});
test('CAST SÉANCE: aucune durée nulle part → null', () => {
  const { db, u, f, rent } = freshDb({ filmDuration: null });
  rent();
  assert.equal(openCastSession(db, { userId: u, filmId: f, position: 0, durationSeconds: 0 }, deps), null);
});
test('CAST SÉANCE: sans location active → null, aucune ligne', () => {
  const { db, u, f } = freshDb({ filmDuration: 6840 });
  assert.equal(openCastSession(db, { userId: u, filmId: f, position: 0 }, deps), null);
  assert.equal(db.prepare('SELECT count(*) n FROM cast_sessions').get().n, 0);
});
test('CAST SÉANCE: une seconde ouverture met à jour la même ligne', () => {
  const { db, u, f, rent } = freshDb({ filmDuration: 6840 }); rent();
  const a = openCastSession(db, { userId: u, filmId: f, position: 0 }, deps);
  const b = openCastSession(db, { userId: u, filmId: f, position: 120, durationSeconds: 596.5 }, deps);
  assert.equal(b.id, a.id);
  assert.equal(b.duration_seconds, 596.5);
  assert.equal(db.prepare('SELECT count(*) n FROM cast_sessions WHERE ended = 0').get().n, 1);
});
test('CAST SÉANCE: le téléphone corrige la durée, la fin estimée suit', () => {
  const { db, u, f, rent } = freshDb({ filmDuration: 6840 }); rent();
  openCastSession(db, { userId: u, filmId: f, position: 0 }, deps);
  reportCastSession(db, { userId: u, filmId: f, position: 500, durationSeconds: 596.5 }, deps);
  const s = db.prepare('SELECT duration_seconds d, last_position p, estimated_end_at e FROM cast_sessions').get();
  assert.equal(s.d, 596.5); assert.equal(s.p, 500);
  const left = (Date.parse(s.e) - Date.now()) / 1000;
  assert.ok(left > 90 && left < 100, `reste ${left}`);
});
test('CAST SÉANCE: un envoi de position sans séance ouverte en rouvre une', () => { /* reportCastSession → 1 ligne ended = 0 */ });
test('CAST SÉANCE: entrées bornées', () => {
  /* position -5 → 0 ; NaN → 0 ; durée -1 ou NaN → durée du film ; estimated_end_at toujours une date ISO valide */
});
test('CAST SÉANCE: fin vue par le téléphone = location à 100 %, position 0, séance close', () => {
  /* closeCastSession({ finished: true }) → rentals 100 / 0 / watch_completed_at posé ; cast_sessions.ended = 1 */
});
test('CAST SÉANCE: arrêt en cours de film = séance close, location intacte, position notée', () => {
  /* closeCastSession({ finished: false, position: 300 }) → ended = 1, last_position = 300, watch_progress inchangé */
});
test('CAST SÉANCE: le vérificateur clôt la séance qu\'il complète', () => {
  /* statique : dans lib/cast-session-checker.ts, « ended = 1 » est écrit après completeCastRental et avant sendPushNotification */
});
```

- [ ] **Step 2: Lancer** `node --test tests/domain/cast-session-store.test.mjs` — attendu : échec « Cannot find module ».
- [ ] **Step 3: Écrire `lib/cast-session-store.ts`** (signatures ci-dessus ; fin estimée = maintenant + max(0, durée − position), en ISO ; « séance ouverte » = `ended = 0` pour ce visiteur et ce film, la plus récente).
- [ ] **Step 4: Brancher** `lib/cast-sessions.ts` (enveloppes qui passent `db` et les dépendances), la route (durée facultative, `DELETE` avec `currentPosition` / `finished`), le vérificateur (`UPDATE cast_sessions SET ended = 1 WHERE id = ?` juste après `completeCastRental`), le client `src/api/index.ts`.
- [ ] **Step 5: Lancer** `node --test tests/domain/cast-session-store.test.mjs tests/domain/cast-completion.test.mjs` — attendu : tout passe.
- [ ] **Step 6: Commit** `feat(cast): séances serveur sans durée obligatoire, sans doublon, closes à la fin`

---

### Task 2: La machine à états (fonction pure)

**Files:**
- Create: `src/cast/cast-machine.ts`
- Test: `tests/domain/cast-machine.test.mjs`

**Interfaces — Produces :**

```ts
export type CastPhase = 'idle' | 'choosing' | 'connecting' | 'loading' | 'remote' | 'ended' | 'lost';
export type CastNotice = 'stopped_elsewhere' | 'tv_error' | 'rental_over' | 'connect_failed' | 'load_failed' | 'unavailable' | 'no_source';
export interface CastMediaRequest { url: string; title: string; startAt: number; subtitles: { id: number; url: string; language: 'fr' | 'en'; label: string }[]; activeSubtitleId: number | null }
export interface CastState {
  phase: CastPhase;
  available: boolean | null;      // null tant que le SDK n'a pas répondu
  connected: boolean;             // séance ouverte avec un appareil
  deviceName: string | null;
  filmId: number | null;          // film demandé, joué, fini ou perdu
  tracked: boolean;               // faux pour une prévisualisation /admin : aucun appel serveur
  position: number; duration: number; paused: boolean; volume: number;
  busy: boolean;                  // une commande attend son accusé
  stopping: boolean;              // arrêt demandé : les statuts tardifs sont ignorés
  notice: { code: CastNotice; filmId: number | null; deviceName: string | null } | null;
  resume: { filmId: number; position: number; play: boolean } | null; // à reprendre en local
}
export type CastCommand = { kind: 'toggle' } | { kind: 'seekBy'; seconds: number } | { kind: 'volume'; level: number };
export type CastEvent =
  | { type: 'SDK_READY'; hasSession: boolean; rememberedFilmId: number | null } | { type: 'SDK_UNAVAILABLE' }
  | { type: 'REQUEST_CAST'; filmId: number; tracked: boolean; media: CastMediaRequest }
  | { type: 'PICKER_CANCELLED' } | { type: 'PICKER_FAILED' }
  | { type: 'SESSION_STARTING'; deviceName: string | null }
  | { type: 'SESSION_STARTED'; deviceName: string | null; resumed: boolean }
  | { type: 'SESSION_ENDED' }
  | { type: 'LOAD_FAILED' }
  | { type: 'MEDIA_STATUS'; filmId: number | null; playerState: 'PLAYING' | 'PAUSED' | 'BUFFERING' | 'IDLE'; idleReason: 'FINISHED' | 'CANCELLED' | 'INTERRUPTED' | 'ERROR' | null; position: number; duration: number; volume: number }
  | { type: 'NO_MEDIA' } | { type: 'STATUS_FAILED' }
  | { type: 'POSITION'; position: number }
  | { type: 'RENTAL_STATE'; filmId: number; exists: boolean; watchProgress: number }
  | { type: 'RENTAL_GONE'; filmId: number }
  | { type: 'COMMAND'; command: CastCommand }
  | { type: 'COMMAND_DONE' } | { type: 'COMMAND_FAILED' }
  | { type: 'TIMEOUT'; timer: 'connect' | 'load' }
  | { type: 'TICK' } | { type: 'PAGE_VISIBLE' } | { type: 'PAGE_HIDDEN' }
  | { type: 'USER_CANCEL' } | { type: 'USER_STOP' } | { type: 'USER_TO_PHONE' } | { type: 'USER_RETRY' } | { type: 'USER_DISMISS' } | { type: 'RESUME_TAKEN' };
export type CastEffect =
  | { type: 'OPEN_PICKER' } | { type: 'LOAD_MEDIA'; filmId: number; media: CastMediaRequest }
  | { type: 'REQUEST_STATUS' } | { type: 'SEND_COMMAND'; command: CastCommand; position: number; paused: boolean }
  | { type: 'STOP_AND_END_SESSION' }
  | { type: 'START_TIMER'; timer: 'connect' | 'load'; ms: number } | { type: 'CLEAR_TIMER'; timer: 'connect' | 'load' }
  | { type: 'SERVER_OPEN'; filmId: number; position: number; duration: number | null }
  | { type: 'SERVER_REPORT'; filmId: number; position: number; duration: number | null }
  | { type: 'SERVER_CLOSE'; filmId: number; position: number | null; finished: boolean }
  | { type: 'READ_RENTAL'; filmId: number } | { type: 'REMEMBER_FILM'; filmId: number | null };
export const initialCastState: CastState;
export function castReduce(state: CastState, event: CastEvent): { state: CastState; effects: CastEffect[] };
export type CastView = 'local' | 'choosing' | 'connecting' | 'loading' | 'remote' | 'ended' | 'lost' | 'other-on-tv';
export function castView(state: CastState, filmId: number | null): CastView;   // 'other-on-tv' : la TV joue un autre film
export function castOwnsFilm(state: CastState): number | null;                  // film à signaler par la puce (remote, lost, ended)
```

Les effets `SERVER_*` et `READ_RENTAL` ne sont émis que si `state.tracked`.

**Table des transitions** (tout événement absent d'une ligne laisse l'état inchangé, sans effet) :

| Depuis | Événement | Vers | Effets et champs |
|---|---|---|---|
| tous | `SDK_UNAVAILABLE` | `idle` | `available = false` |
| `idle` | `SDK_READY` | `idle` | `available = true`, `connected = hasSession`, `filmId = rememberedFilmId` ; si `hasSession` : `REQUEST_STATUS` ; sinon, si `rememberedFilmId` : `READ_RENTAL` |
| `idle` (film mémorisé) | `NO_MEDIA` | `idle` | `READ_RENTAL` du film mémorisé ; sans film mémorisé : rien |
| `idle`, `ended` | `REQUEST_CAST`, `available === false` | inchangé | `notice = unavailable` |
| `idle`, `ended` | `REQUEST_CAST`, non connecté | `choosing` | `OPEN_PICKER` ; `filmId`, `tracked`, média gardés pour la suite ; `notice = null` |
| `idle`, `ended`, `remote` (autre film) | `REQUEST_CAST`, connecté | `loading` | `LOAD_MEDIA`, `START_TIMER load` ; si un autre film jouait et était suivi : `SERVER_CLOSE` de l'ancien à sa position |
| `choosing`, `connecting`, `loading` | `REQUEST_CAST` | inchangé | aucun (demande répétée ignorée) |
| `choosing` | `PICKER_CANCELLED` | `idle` | aucun message |
| `choosing` | `PICKER_FAILED` | `idle` | `notice = connect_failed` |
| `choosing` | `SESSION_STARTING` | `connecting` | `deviceName`, `START_TIMER connect` |
| `choosing`, `connecting` | `SESSION_STARTED` | `loading` | `connected = true`, `CLEAR_TIMER connect`, `LOAD_MEDIA`, `START_TIMER load` |
| `connecting` | `TIMEOUT connect` | `idle` | `notice = connect_failed` |
| `loading` | `MEDIA_STATUS` du film demandé, `PLAYING`/`PAUSED`/`BUFFERING` | `remote` | `CLEAR_TIMER load`, `SERVER_OPEN`, `REMEMBER_FILM` |
| `loading` | `MEDIA_STATUS` `IDLE` (l'ancien média interrompu) | inchangé | aucun |
| `loading` | `LOAD_FAILED`, `TIMEOUT load` | `idle` | `notice = load_failed`, `connected` gardé |
| `choosing`, `connecting`, `loading` | `USER_CANCEL` | `idle` | `CLEAR_TIMER` ; en `loading` : `STOP_AND_END_SESSION` |
| `idle` | `SESSION_STARTED` (reprise) | `idle` | `connected = true`, `REQUEST_STATUS` |
| `idle`, `lost` | `MEDIA_STATUS` avec `filmId`, non `IDLE`, `stopping` faux | `remote` | champs mis à jour ; `SERVER_REPORT` ; `REMEMBER_FILM` |
| tous | `MEDIA_STATUS` sans `filmId` | inchangé | aucun (média inconnu) |
| tous | `MEDIA_STATUS` non `IDLE` quand `stopping` | inchangé | aucun (statut tardif) |
| `remote` | `MEDIA_STATUS` du même film, non `IDLE` | `remote` | position, durée, pause (`PAUSED`), volume ; `busy = false` |
| `remote` | `POSITION` | `remote` | position |
| `remote` | `MEDIA_STATUS` `IDLE` `FINISHED` | `ended` | `SERVER_CLOSE finished`, position 0 |
| `remote` | `MEDIA_STATUS` `IDLE` `ERROR` | `idle` | `notice = tv_error`, `resume` (pause) à la dernière position, `SERVER_CLOSE` à cette position, `REMEMBER_FILM null` |
| `remote` | `MEDIA_STATUS` `IDLE` autre raison, `SESSION_ENDED` | `idle` | `notice = stopped_elsewhere`, `resume` (pause), `SERVER_CLOSE` à la dernière position, `REMEMBER_FILM null` ; `connected = false` sur `SESSION_ENDED` |
| `remote` | `NO_MEDIA` | `ended` si dernière position ≥ 95 % de la dernière durée (`SERVER_CLOSE finished`) ; sinon inchangé + `READ_RENTAL` | |
| `remote`, `idle` (film mémorisé), `lost` | `RENTAL_STATE` du film | `ended` si `watchProgress >= 100` ; sinon `idle` + `notice = stopped_elsewhere` + `resume` (pause) + `SERVER_CLOSE` sans position ; `exists` faux → comme `RENTAL_GONE` | `REMEMBER_FILM null` hors `ended` |
| `remote` | `COMMAND` | `remote` | `busy = true`, `SEND_COMMAND` (ignoré si déjà `busy`) |
| `remote` | `COMMAND_DONE` | `remote` | `busy = false` |
| `remote` | `COMMAND_FAILED` | `remote` | `busy = false`, `REQUEST_STATUS` |
| `remote` | `STATUS_FAILED` | `lost` | — (la séance serveur reste ouverte) |
| `remote` | `TICK` | `remote` | `REQUEST_STATUS`, `SERVER_REPORT` |
| `remote` | `PAGE_HIDDEN` | `remote` | `SERVER_REPORT` |
| `remote`, `lost` | `PAGE_VISIBLE` | inchangé | `REQUEST_STATUS` |
| `lost` | `TICK`, `USER_RETRY` | `lost` | `REQUEST_STATUS` (pas de `SERVER_REPORT`) |
| `lost` | `NO_MEDIA` | `lost` | `READ_RENTAL` |
| `lost` | `SESSION_ENDED` | `idle` | comme depuis `remote` |
| `remote`, `lost` | `USER_STOP` | `idle` | `stopping = true`, `STOP_AND_END_SESSION`, `SERVER_CLOSE` à la position, `resume` (pause), `REMEMBER_FILM null` |
| `remote`, `lost` | `USER_TO_PHONE` | `idle` | comme `USER_STOP`, avec `resume.play = true` |
| `remote`, `lost`, `loading` | `RENTAL_GONE` du film | `idle` | `stopping = true`, `STOP_AND_END_SESSION`, `SERVER_CLOSE`, `notice = rental_over`, pas de `resume` |
| tous | `SESSION_ENDED` (hors lignes ci-dessus) | inchangé | `connected = false`, `stopping = false` |
| `ended` | `USER_DISMISS` | `idle` | `filmId = null`, `REMEMBER_FILM null` |
| tous | `USER_DISMISS` (hors `ended`) | inchangé | `notice = null` |
| tous | `RESUME_TAKEN` | inchangé | `resume = null` |

- [ ] **Step 1: Écrire les tests** — une fonction `run(events)` qui replie `castReduce` depuis `initialCastState` et rend l'état final et la liste des effets. Cas obligatoires (noms des tests) :

```js
const media = { url: 'https://s/vf.mp4', title: 'Get Out', startAt: 0, subtitles: [], activeSubtitleId: null };
const ready = { type: 'SDK_READY', hasSession: false, rememberedFilmId: null };
const ask = { type: 'REQUEST_CAST', filmId: 7, tracked: true, media };
const playing = (o = {}) => ({ type: 'MEDIA_STATUS', filmId: 7, playerState: 'PLAYING', idleReason: null, position: 10, duration: 600, volume: 0.3, ...o });
const started = { type: 'SESSION_STARTED', deviceName: 'Salon', resumed: false };

test('CAST MACHINE: le choix de l\'appareil n\'a aucun délai (D3)', () => {
  const { state, effects } = run([ready, ask]);
  assert.equal(state.phase, 'choosing');
  assert.deepEqual(effects.map(e => e.type), ['OPEN_PICKER']);          // aucun START_TIMER
});
test('CAST MACHINE: sélecteur refermé = retour silencieux (D7)', () => {
  const { state } = run([ready, ask, { type: 'PICKER_CANCELLED' }]);
  assert.equal(state.phase, 'idle'); assert.equal(state.notice, null);
});
test('CAST MACHINE: lancement complet et ouverture de la séance serveur', () => {
  const { state, effects } = run([ready, ask, { type: 'SESSION_STARTING', deviceName: 'Salon' }, started, playing()]);
  assert.equal(state.phase, 'remote'); assert.equal(state.volume, 0.3); assert.equal(state.paused, false);
  assert.ok(effects.some(e => e.type === 'SERVER_OPEN' && e.filmId === 7 && e.duration === 600));
});
test('CAST MACHINE: TV déjà connectée → chargement direct, sans sélecteur (D5, D7)', () => {
  const { state, effects } = run([{ ...ready, hasSession: true }, { type: 'NO_MEDIA' }, ask]);
  assert.equal(state.phase, 'loading'); assert.ok(!effects.some(e => e.type === 'OPEN_PICKER'));
});
test('CAST MACHINE: demande répétée ignorée', () => {
  const { effects } = run([ready, ask, ask, ask]);
  assert.equal(effects.filter(e => e.type === 'OPEN_PICKER').length, 1);
});
test('CAST MACHINE: fin du film = FINISHED, même durée et position remises à zéro (D4)', () => {
  const { state, effects } = run([ready, ask, started, playing({ position: 590 }),
    playing({ playerState: 'IDLE', idleReason: 'FINISHED', position: 0, duration: 0 })]);
  assert.equal(state.phase, 'ended'); assert.equal(state.filmId, 7);
  assert.deepEqual(effects.at(-1), { type: 'SERVER_CLOSE', filmId: 7, position: null, finished: true });
});
test('CAST MACHINE: fin sans signal, dernière position à 97 %', () => {
  const { state } = run([ready, ask, started, playing({ position: 582 }), { type: 'NO_MEDIA' }]);
  assert.equal(state.phase, 'ended');
});
test('CAST MACHINE: arrêt venu d\'ailleurs = pause locale à la dernière position, jamais de lecture d\'office', () => {
  const { state } = run([ready, ask, started, playing({ position: 300 }), playing({ playerState: 'IDLE', idleReason: 'CANCELLED', position: 0, duration: 0 })]);
  assert.equal(state.phase, 'idle'); assert.equal(state.notice.code, 'stopped_elsewhere');
  assert.deepEqual(state.resume, { filmId: 7, position: 300, play: false });
});
test('CAST MACHINE: reprise après rechargement, la TV joue (D6)', () => {
  const { state, effects } = run([{ ...ready, hasSession: true }, playing({ position: 73 })]);
  assert.equal(state.phase, 'remote'); assert.equal(state.position, 73);
  assert.equal(effects[0].type, 'REQUEST_STATUS');
});
test('CAST MACHINE: retour après la fin, plus de séance, location à 100 % → terminé', () => {
  const { state } = run([{ ...ready, rememberedFilmId: 7 }, { type: 'RENTAL_STATE', filmId: 7, exists: true, watchProgress: 100 }]);
  assert.equal(state.phase, 'ended'); assert.equal(castOwnsFilm(state), 7);
});
test('CAST MACHINE: retour, plus de média, location à 40 % → repos, pause', () => { /* idle, notice stopped_elsewhere, resume.play === false */ });
test('CAST MACHINE: commande sans accusé puis statut muet → liaison perdue, séance serveur gardée (D1)', () => {
  const { state, effects } = run([ready, ask, started, playing(), { type: 'COMMAND', command: { kind: 'toggle' } }, { type: 'COMMAND_FAILED' }, { type: 'STATUS_FAILED' }]);
  assert.equal(state.phase, 'lost'); assert.ok(!effects.some(e => e.type === 'SERVER_CLOSE'));
});
test('CAST MACHINE: liaison perdue puis statut revenu → télécommande', () => { /* …, STATUS_FAILED, playing() → remote */ });
test('CAST MACHINE: « Continuer sur ce téléphone » depuis la liaison perdue clôt la séance serveur', () => {
  /* USER_TO_PHONE → idle, effets STOP_AND_END_SESSION + SERVER_CLOSE, resume.play === true */
});
test('CAST MACHINE: statut après arrêt ignoré', () => {
  const { state } = run([ready, ask, started, playing(), { type: 'USER_STOP' }, playing({ position: 12 })]);
  assert.equal(state.phase, 'idle');
});
test('CAST MACHINE: média sans film → pas de télécommande', () => {
  const { state } = run([{ ...ready, hasSession: true }, playing({ filmId: null })]);
  assert.equal(state.phase, 'idle');
});
test('CAST MACHINE: location disparue → la TV s\'arrête, message, pas de reprise', () => { /* RENTAL_GONE → idle, notice rental_over, resume null, effet STOP_AND_END_SESSION */ });
test('CAST MACHINE: prévisualisation (tracked faux) → aucun effet serveur', () => { /* aucun SERVER_*, aucun READ_RENTAL */ });
test('CAST MACHINE: un autre film sur la TV', () => {
  const { state } = run([ready, ask, started, playing()]);
  assert.equal(castView(state, 7), 'remote'); assert.equal(castView(state, 8), 'other-on-tv'); assert.equal(castView(initialCastState, 8), 'local');
});
test('CAST MACHINE: aucun écran sans sortie', () => {
  /* pour chaque phase ≠ idle atteinte ci-dessus, au moins un événement USER_* ramène à idle */
});
```

- [ ] **Step 2: Lancer** `node --test tests/domain/cast-machine.test.mjs` — attendu : échec « Cannot find module ».
- [ ] **Step 3: Écrire `src/cast/cast-machine.ts`** d'après la table (aucun import).
- [ ] **Step 4: Relancer** — attendu : tout passe.
- [ ] **Step 5: Commit** `feat(cast): machine à états pure du Cast`

---

### Task 3: Le service — un seul SDK pour toute l'application

**Files:**
- Create: `src/cast/cast-wire.ts` (pur), `src/cast/cast-service.ts`
- Test: `tests/domain/cast-wire.test.mjs`, `tests/domain/cast-service-wiring.test.mjs` (statique)

**Interfaces:**
- Consumes: tout `cast-machine.ts` (tâche 2).
- Produces, `cast-wire.ts` (aucun import) :
  - `castSourceFor(rental: { videoUrl?: string; streamingUrls?: { vf: string | null; vo: string | null } } | null | undefined, audio: 'vf' | 'vo'): string | null` — la piste demandée, sinon l'autre, sinon `videoUrl`, sinon `null`.
  - `loadRequestData(filmId: number, media: CastMediaRequest): { contentId: string; contentType: 'video/mp4'; title: string; customData: { filmId: number }; currentTime: number; autoplay: true; tracks: { trackId: number; trackContentId: string; language: string; name: string }[]; activeTrackIds: number[] }`
  - `mediaStatusEvent(media: { playerState?: string; idleReason?: string | null; media?: { duration?: number | null; customData?: unknown } | null; getEstimatedTime?: () => number } | null, volume: number): CastEvent` — `NO_MEDIA` si `media` est nul ; `filmId` lu dans `media.media.customData.filmId` (entier > 0, sinon `null`) ; états inconnus → `BUFFERING`.
- Produces, `cast-service.ts` :
  - `interface CastPorts { serverOpen(filmId: number, position: number, duration: number | null): Promise<unknown>; serverReport(filmId: number, position: number, duration: number | null): Promise<unknown>; serverClose(filmId: number, position: number | null, finished: boolean): Promise<unknown>; readRental(filmId: number): Promise<{ exists: boolean; watchProgress: number }>; remember(filmId: number | null): void; remembered(): number | null }`
  - `initCast(ports: CastPorts): void` — idempotent ; charge le SDK, **le seul `setOptions(` du dépôt**, un `RemotePlayer` + un `RemotePlayerController`, écouteurs posés une fois (`CAST_STATE_CHANGED`, `SESSION_STATE_CHANGED`, `MEDIA_SESSION`, `Media.addUpdateListener`, `visibilitychange`, `resume`).
  - `getCastState(): CastState`, `subscribeCast(listener: (s: CastState) => void): () => void`, `sendCast(event: CastEvent): void`
  - `setCastSubtitle(trackId: number | null): Promise<boolean>`
  - `preloadCastSdk(): Promise<boolean>` (repris de `useGoogleCast.ts:163-245`, délai de 8 s compris)

Règles du service (ce que les tests statiques ne voient pas — à tenir exactement) :
- `OPEN_PICKER` : `context.requestSession()` appelé **dans la pile de l'appui** (pas d'`await` avant) ; rejet `'cancel'` → `PICKER_CANCELLED`, autre rejet → `PICKER_FAILED`.
- `REQUEST_STATUS` : `session.sendMessage('urn:x-cast:com.google.cast.media', { type: 'GET_STATUS', requestId })` dans un `try/catch` ; exception, rejet, ou pas de statut reçu dans `CAST_STATUS_TIMEOUT_MS` → `STATUS_FAILED` ; statut reçu sans média → `NO_MEDIA`.
- `SEND_COMMAND` : par la séance média (`media.play/pause/seek`, `session.setVolume`), rappels de succès → `COMMAND_DONE`, d'échec, exception ou `CAST_ACK_TIMEOUT_MS` → `COMMAND_FAILED`.
- `STOP_AND_END_SESSION` : `context.endCurrentSession(true)` dans un `try/catch`, jamais d'exception vers l'appelant.
- `POSITION` envoyé au plus une fois par seconde, seulement en `remote`, depuis `media.getEstimatedTime()`. `TICK` toutes les `CAST_REPORT_EVERY_MS`, page visible, en `remote` ou `lost`.
- Les effets `SERVER_*`, `READ_RENTAL`, `REMEMBER_FILM` passent par les ports ; un port qui rejette est ignoré (jamais d'exception).
- Tout `catch` du service mène à un événement de la machine : aucune erreur avalée sans état.

- [ ] **Step 1: Tests de `cast-wire`** :

```js
test('CAST FIL: source = piste demandée, sinon l\'autre, sinon rien', () => {
  assert.equal(castSourceFor({ streamingUrls: { vf: 'a', vo: 'b' } }, 'vo'), 'b');
  assert.equal(castSourceFor({ streamingUrls: { vf: null, vo: 'b' } }, 'vf'), 'b');
  assert.equal(castSourceFor({ streamingUrls: { vf: null, vo: null } }, 'vf'), null);
  assert.equal(castSourceFor(null, 'vf'), null);
});
test('CAST FIL: la demande de chargement porte le film', () => {
  const d = loadRequestData(7, { url: 'u', title: 'Get Out', startAt: 42, subtitles: [{ id: 1, url: 's', language: 'fr', label: 'Français' }], activeSubtitleId: 1 });
  assert.deepEqual(d.customData, { filmId: 7 }); assert.equal(d.currentTime, 42); assert.deepEqual(d.activeTrackIds, [1]);
});
test('CAST FIL: statut de la TV → événement', () => {
  assert.deepEqual(mediaStatusEvent(null, 0.3), { type: 'NO_MEDIA' });
  const e = mediaStatusEvent({ playerState: 'IDLE', idleReason: 'FINISHED', media: { duration: 596.5, customData: { filmId: 7 } }, getEstimatedTime: () => 0 }, 0.3);
  assert.equal(e.idleReason, 'FINISHED'); assert.equal(e.filmId, 7); assert.equal(e.duration, 596.5);
  assert.equal(mediaStatusEvent({ playerState: 'PLAYING', media: { customData: { filmId: 'x' } } }, 1).filmId, null);
});
```

- [ ] **Step 2: Tests statiques** (`cast-service-wiring`) : sur tous les `.ts`/`.tsx` de `src/` (`walkFiles` de `tests/helpers/repo.mjs`), `setOptions(` apparaît **exactement une fois**, dans `src/cast/cast-service.ts` ; `cast-service.ts` contient `GET_STATUS`, `addUpdateListener`, `endCurrentSession`, `visibilitychange` ; `cast-machine.ts` et `cast-wire.ts` ne contiennent aucun `import ` hors `import type`. *(Ce test échouera sur `setOptions` tant que `useGoogleCast.ts` existe : il est attendu rouge jusqu'à la tâche 6, où le hook est supprimé — le noter dans le message de commit.)*
- [ ] **Step 3: Écrire `cast-wire.ts`, puis `cast-service.ts`.**
- [ ] **Step 4: Lancer** `node --test tests/domain/cast-wire.test.mjs` (vert) et `npx tsc --noEmit` (aucune erreur nouvelle).
- [ ] **Step 5: Commit** `feat(cast): service Cast unique (SDK initialisé une fois, statut, commandes avec accusé)`

---

### Task 4: La tranche du store et l'initialisation

**Files:**
- Create: `src/store/slices/cast.ts`
- Modify: `src/store/index.ts` (l. 152-171, 417-440 `logout`, 766, 781-826, 1091-1102), `src/App.tsx:430-440`, `src/components/interior/InteriorScene.tsx:26` et `:815-817`, `src/components/kiosk/KioskDistribution.tsx:2` et `:74`
- Test: `tests/domain/cast-store.test.mjs` (statique), mise à jour de `tests/domain/cast-on-open.test.mjs`

**Interfaces:**
- Consumes: `initCast`, `subscribeCast`, `sendCast`, `getCastState`, `preloadCastSdk` (tâche 3) ; `castSourceFor` ; `api.castSessions.*` (tâche 1) ; `buildCastSubtitleTracks`, `activeSubtitleId` de `src/utils/cast-subtitles.ts`.
- Produces (`CastSlice`, fusionnée dans `VideoClubState`) :
  - `cast: CastState` ; `activeCastFilmId: number | null` (= `castOwnsFilm(cast)` quand la phase est `remote` ou `lost`, sinon `null` ; écrit par la tranche, **plus de `setActiveCastFilmId` ni d'`endCast`**) ; `lastCastFilmId: number | null` (**persisté** dans `partialize`)
  - `startCast(): void` — appelle `initCast` avec les ports (une fois) et s'abonne au service
  - `castFilm(filmId: number, opts?: { audio?: 'vf' | 'vo'; subtitle?: 'off' | 'fr' | 'en'; startAt?: number }): void` — sans source (`castSourceFor` nul) : `notice = no_source`, rien d'autre ; `startAt` par défaut = `watchPosition` de la location, 0 si elle est à 100 % ; `tracked = false` si `previewRental?.filmId === filmId`
  - `castToggle()`, `castSeekBy(seconds: number)`, `castVolume(level: number)`, `castStop()`, `castToPhone()`, `castRetry()`, `castCancel()`, `castDismiss()`
  - `takeCastResume(filmId: number): { position: number; play: boolean } | null`
  - `openPlayer(filmId: number, opts?: { from?: 'kiosk' | 'store'; ask?: boolean }): void` ; nouveaux champs `playerFrom: 'kiosk' | 'store'` (défaut `'store'`) et `playerAsk: boolean` (défaut `true` : montrer l'invite « Regarder sur TV ? » sur mobile)
  - **Supprimés** : `castOnOpen`, `openPlayerOnTv`, `clearCastOnOpen`, `setActiveCastFilmId`, `endCast` ; dans `src/utils/cast-on-open.ts` : `shouldStartCastOnOpen` (garder `appleAirPlay`, `shouldOfferRewindOnOpen`, `rewindOfferOnOpen`).
- Ports : `serverOpen/serverReport` → `api.castSessions.create/updatePosition` **et**, pour `serverReport`, `updateRentalProgress(filmId, round(position / duration × 100), position)` quand la durée est connue ; `serverClose(finished)` → `api.castSessions.end`, puis `fetchMe()` ; `readRental` → `fetchMe()` puis lecture de `rentals` ; `remember/remembered` → `lastCastFilmId`.
- Surveillance des locations : à chaque changement de `rentals` (et à `logout`), si `castOwnsFilm(cast)` n'a plus de location et que le film n'est pas une prévisualisation → `sendCast({ type: 'RENTAL_GONE', filmId })`.

- [ ] **Step 1: Tests statiques** : `src/store/index.ts` ne contient plus `castOnOpen`, `openPlayerOnTv`, `setActiveCastFilmId`, `endCast:` ; `partialize` contient `lastCastFilmId` et pas `cast:` ; `src/App.tsx` appelle `startCast` ; aucun fichier de `src/` hors `src/cast/` et `src/store/slices/cast.ts` n'importe `cast-service`. Mettre à jour `cast-on-open.test.mjs` (retirer les cas de `shouldStartCastOnOpen` et de `openPlayerOnTv`).
- [ ] **Step 2: Lancer** — attendu : rouge.
- [ ] **Step 3: Écrire la tranche, la brancher** (`...createCastSlice(set, get, store)`), remplacer les préchargements (`App.tsx`, `InteriorScene.tsx`, `KioskDistribution.tsx`) par `startCast()`.
- [ ] **Step 4: Lancer** les tests de la tâche + `npx tsc --noEmit` — les erreurs de type restantes ne doivent venir que de `VHSPlayer.tsx`, `KioskView.tsx` et `ActiveCastIndicator.tsx` (traités aux tâches 5 à 7) : les lister dans le rapport. **Ne pas commiter un arbre qui ne compile pas** : dans cette tâche, garder des alias temporaires `setActiveCastFilmId`/`endCast`/`openPlayerOnTv` marqués `/** @deprecated retiré à la tâche 6/7 */` si nécessaire, et retirer du test statique les lignes correspondantes jusqu'à la tâche qui les supprime (noté dans le rapport).
- [ ] **Step 5: Commit** `feat(cast): état du Cast dans le store, service démarré à l'entrée`

---

### Task 5: Les panneaux du Cast

**Files:**
- Create: `src/components/player/CastPanels.tsx`, `src/components/player/CastPanels.module.css` (styles `castingOverlay`, `awaiting*`, `nowPlaying*` **déplacés** depuis `VHSPlayer.module.css`)
- Modify: `src/components/player/ActiveCastIndicator.tsx`
- Test: `tests/domain/cast-panels.test.mjs` (statique)

**Interfaces:**
- Consumes: `useStore` (`cast`, actions de la tâche 4), `castView`, `watchHereLabel` de `src/components/kiosk/kiosk-logic.ts`.
- Produces: `CastPanels({ filmId, title, onBack, subtitles }: { filmId: number; title: string; onBack: () => void; subtitles: ReactNode }): JSX.Element | null` — rend, selon `castView(cast, filmId)` : rien (`local`, `other-on-tv`, `ended`), l'attente (`choosing` : « Choisis ton appareil dans la fenêtre Google Cast. » ; `connecting` ; `loading`), la télécommande (`remote`), la liaison perdue (`lost`). `subtitles` = la rangée STFR/STEN fournie par le lecteur.

Décisions d'écran :
- Télécommande : pastille du nom de l'appareil, titre, temps `position / durée` et barre, −15 s · lecture/pause · +15 s, volume, sous-titres, puis **« ← Retour à la borne » / « ← Retour au vidéoclub »** (selon `playerFrom`, appelle `onBack`), « Sur ce téléphone » (libellé de `watchHereLabel`), « Arrêter ».
- Le bouton central affiche ⏸ quand `cast.paused` est faux, ▶ quand il est vrai. Le curseur de volume est **contrôlé** par `cast.volume` (plus de `defaultValue={1}`).
- `cast.busy` : boutons de transport `aria-busy`, estompés, appuis ignorés.
- Liaison perdue : titre « La télé ne répond plus », trois boutons « Réessayer » (`castRetry`), « Continuer sur ce téléphone » (`castToPhone`), « Fermer » (`onBack`).
- `ActiveCastIndicator` : visible quand `castOwnsFilm(cast)` est non nul et le lecteur fermé ; libellé de droite « TÉLÉCOMMANDE » (`remote`), « LA TÉLÉ NE RÉPOND PLUS » (`lost`), « FILM TERMINÉ » (`ended`) ; l'appui ouvre le lecteur avec `ask: false`. Prend une prop `variant?: 'store' | 'kiosk'` (le dessin `kiosk` vient à la tâche 7).

- [ ] **Step 1: Tests statiques** : `CastPanels.tsx` ne contient ni `defaultValue={1}`, ni `disabled`, ni `useGoogleCast` ; il contient « La télé ne répond plus », `aria-busy`, `castRetry`, `castToPhone` ; `ActiveCastIndicator.tsx` contient « FILM TERMINÉ ».
- [ ] **Step 2: Rouge, puis écrire les composants, puis vert.** `npx tsc --noEmit` sans erreur dans ces fichiers.
- [ ] **Step 3: Commit** `feat(cast): panneaux d'attente, de télécommande et de liaison perdue lus dans le store`

---

### Task 6: Le lecteur ne décide plus rien du Cast

**Files:**
- Modify: `src/components/player/VHSPlayer.tsx`, `src/components/player/VHSPlayer.module.css` (styles déplacés à la tâche 5 retirés), `src/types/index.ts:142` (`PlayerState` perd `'casting'` et `'awaitingCast'`), `src/components/player/VHSEffects.tsx` et `VHSControls.tsx` s'ils lisent ces deux états, `app/admin/AdminPageClient.tsx` (appelle `startCast()` au montage), `tests/domain/audit-ux-compat.test.mjs` et tout test statique qui cite le code retiré
- Delete: `src/hooks/useGoogleCast.ts`
- Test: `tests/domain/cast-player.test.mjs` (statique) ; le test `setOptions` de la tâche 3 passe au vert

**Interfaces:**
- Consumes: `CastPanels` (tâche 5) ; actions et champs de la tâche 4 ; `castView`.

Ce qui disparaît de `VHSPlayer.tsx` (numéros de ligne à `cd61350`) : l'appel à `useGoogleCast` (133-154) ; `castFilmIdRef`, `castDurationRef`, `lastKnownCastTimeRef` (156-161) ; l'effet de bascule de sous-titres par `setCastTextTrack` (231-239, remplacé par `setCastSubtitle` du service) ; l'auto-détection (363-395) ; le délai de 6 s (402-416) ; les branches `casting` de `handleStop` (561-580) et `handleEject` (665-679) ; `handleCastCurrentVideo` et `handleSwitchToPhone` (883-969) ; l'effet `castOnOpen` (1015-1024) ; la branche Cast de l'envoi périodique (1065-1071) et du vidage (1096-1100) ; la visibilité et MediaSession du Cast (1112-1158, déplacés dans `CastPanels` pour MediaSession, dans le service pour la visibilité) ; la détection d'arrêt distant (1219-1261) ; la déconnexion (1263-1318) ; les panneaux d'attente et de télécommande (1653-1813).

Ce que le lecteur fait désormais :
- `const view = castView(cast, currentPlayingFilm)` ; `const remoteActive = view !== 'local' && view !== 'other-on-tv' && view !== 'ended'`.
- **Vidéo locale** : `autoPlay` vrai seulement si `view === 'local'`, que l'invite n'attend pas de réponse (`showMobileRemotePrompt` faux) et que `rewindPhase === 'none'`. À la réponse « Continuer sur smartphone » : `video.play()`. Quand `remoteActive` devient vrai : `video.pause()`.
- **Invite « Regarder sur TV ? »** : affichée à l'ouverture sur mobile seulement si `playerAsk` est vrai et `view === 'local'` ; réaffichée quand `cast.notice` vaut `connect_failed` / `load_failed` pour ce film, et quand le sélecteur a été refermé (`choosing` → `local`).
- **« Regarder sur TV »** (invite, bouton CAST de l'en-tête) : Apple + AirPlay → `handleAirPlayPicker` comme aujourd'hui ; sinon `castFilm(filmId, { audio: audioTrack, subtitle: subtitleTrack, startAt: max(video.currentTime, rental.watchPosition) })` **directement dans le gestionnaire de l'appui**.
- **`cast.resume` pour ce film** : `takeCastResume(filmId)` → `video.currentTime = position`, puis `video.play()` si `play`, sinon pause et rien d'autre.
- **Fin** : `view === 'ended'` → `setPendingEject(true); setRewindPhase('prompt')` si le rembobinage n'est pas réclamé, sinon `castDismiss(); closePlayer()` ; à la fermeture de la proposition (rembobiné ou éjecté) : `castDismiss()`.
- **`cast.notice`** pour ce film : une ligne sous l'en-tête, avec les textes des contraintes ; « Réessayer » pour `connect_failed`, `load_failed`, `tv_error` (relance `castFilm`) ; `unavailable` ouvre le panneau « recopie d'écran », dont le sous-titre devient « Le Cast n'est pas disponible sur ce navigateur. » ; fermée par `castDismiss()`.
- **`other-on-tv`** : bandeau « {titre du film sur la TV} est en cours sur {nom} » ; « Regarder sur TV » demande confirmation (« Remplacer {titre} sur {nom} ? » Oui / Non) avant `castFilm`.
- **En-tête** : « ← RETOUR À LA BORNE » si `playerFrom === 'kiosk'`, sinon « ← RETOUR VIDÉOCLUB ».
- **Échap / E / geste retour pendant un Cast** : `closePlayer()` seul, la TV continue. « ■ STOP » des commandes VHS n'existe pas pendant un Cast (commandes démontées, comme aujourd'hui).
- **Sous-titres en Cast** : `setCastSubtitle(activeSubtitleId(castSubtitles, subtitleTrack))` quand `subtitleTrack` change et `view === 'remote'` ; échec → `setRemoteError('Sous-titres indisponibles sur la TV.')`.
- La proposition de rembobinage à l'ouverture (`rewindOfferOnOpen`) reçoit `castingThisFilm = remoteActive`.
- `hasReachedMilestone` et l'enregistrement local (10 s, pause, fermeture) ne gardent que leur branche locale.

- [ ] **Step 1: Tests statiques** (`cast-player`) : `VHSPlayer.tsx` ne contient plus `useGoogleCast`, `awaitingCast`, `wasCastConnectedRef`, `lastKnownCastTimeRef`, `remoteStop`, `6000` ; il contient `castView(`, `takeCastResume`, `CastPanels`, « RETOUR À LA BORNE » ; `src/hooks/useGoogleCast.ts` n'existe plus ; `VHSPlayer.tsx` compte moins de lignes qu'à `cd61350` (2125).
- [ ] **Step 2: Rouge. Faire la chirurgie. Vert.**
- [ ] **Step 3:** `npx tsc --noEmit` (zéro erreur), `npm run lint` (aucune erreur nouvelle), `npm run test:phase` (attendu : seuls les 9 échecs préexistants).
- [ ] **Step 4: Vérification à l'écran sans TV** (build de production, port 3002, Chromium piloté — recette `borne-recettes-verification`) : ouvrir un film loué sur un écran de téléphone → l'invite s'affiche, **la vidéo locale est en pause** (lire `video.paused` et `currentTime === 0`) ; « Continuer sur smartphone » → lecture ; bureau → lecture immédiate ; Échap ferme. Captures jointes au rapport.
- [ ] **Step 5: Commit** `refactor(cast): le lecteur lit l'état du Cast et n'écrit plus rien ; useGoogleCast supprimé`

---

### Task 7: La borne — « Où voulez-vous regarder ? » partout, et sa puce

**Files:**
- Modify: `src/components/kiosk/KioskView.tsx` (l. 261-270, 578, 596, 603-612, 639-660), `src/components/kiosk/KioskAction.tsx:131-133`, `src/components/kiosk/KioskDistribution.tsx` (`KioskReady`), `src/components/kiosk/KioskPanels.module.css`, `src/components/player/ActiveCastIndicator.tsx` (variante `kiosk`), `src/App.tsx:694`, `tests/domain/kiosk-wiring.test.mjs`
- Test: `tests/domain/kiosk-logic.test.mjs` (une fonction pure de plus), `tests/domain/kiosk-wiring.test.mjs`

**Interfaces:**
- Consumes: `openPlayer(filmId, { from: 'kiosk', ask: false })`, `castFilm`, `castView`, `cast` (tâche 4) ; `appleAirPlay`.
- Produces: dans `kiosk-logic.ts`, `watchEntry(i: { view: CastView }): 'remote' | 'choose'` — `'remote'` si `view` vaut `remote`, `lost` ou `ended` (ouvrir le lecteur tout de suite), sinon `'choose'` (montrer le panneau). `KioskReady` gagne `fresh: boolean` : vrai → titre « Votre K7 est prête » (inchangé) ; faux → le titre du panneau est « Où voulez-vous regarder ? » et la ligne de question disparaît. `KioskAction` gagne `onWatch: (filmId: number) => void` (il n'appelle plus `openPlayer`).

Comportement :
- État local : `distribution: { phase: 'waiting' | 'ready'; filmId: number; fresh: boolean } | null`.
- « REGARDER » (film déjà loué) et « Regarder » de « Mon compte » : `watchEntry` → `'remote'` : `openPlayer(filmId, { from: 'kiosk', ask: false })` ; `'choose'` : `setDistribution({ phase: 'ready', filmId, fresh: false })`.
- Panneau, « Sur ce téléphone » : `openPlayer(filmId, { from: 'kiosk', ask: false })` puis lecture locale (le lecteur démarre : pas d'invite en attente).
- Panneau, « Sur ma télé » : Apple + AirPlay → `openPlayer(filmId, { from: 'kiosk', ask: true })` (l'invite du lecteur porte AirPlay) ; sinon, **dans le même gestionnaire d'appui** : `castFilm(filmId)` puis `openPlayer(filmId, { from: 'kiosk', ask: false })`.
- Puce de la borne (`variant="kiosk"`) : une barre dans le langage de la borne (mêmes polices et bordures que `kNoticeBtn`), **au-dessus de la rangée de K7 du bas, sans la recouvrir** — elle prend sa place dans le flux de l'écran, pas en `position: fixed`. Visuel **provisoire** : une capture avant/après (Pixel, 411 × 809) est jointe au rapport pour Rusmir.

- [ ] **Step 1: Tests** : `watchEntry` (`remote`/`lost`/`ended` → `'remote'`, `local`/`other-on-tv`/`choosing` → `'choose'`) ; statique : `KioskAction.tsx` ne contient plus `openPlayer(`, `KioskView.tsx` ne contient plus `openPlayerOnTv` et contient `fresh: false`, `castFilm(`.
- [ ] **Step 2: Rouge, écrire, vert.** Retirer les alias `@deprecated` laissés à la tâche 4 et remettre les lignes du test statique `cast-store`.
- [ ] **Step 3:** `npx tsc --noEmit`, `npm run lint`, `npm run test:phase` (9 échecs préexistants seulement).
- [ ] **Step 4: Vérification à l'écran sans TV** (build de production, 411 × 809) : film loué → « REGARDER » → panneau « Où voulez-vous regarder ? » → « Sur ce téléphone » → le film démarre, pas d'invite ; « Mon compte » → même panneau ; « Plus tard » referme. Captures.
- [ ] **Step 5: Commit** `feat(borne): « Où voulez-vous regarder ? » pour chaque reprise de film, puce du Cast dans le dessin de la borne`

---

### Task 8: Recette sur le Pixel 9a et le vidéoprojecteur, documentation

**Files:**
- Modify: `AGENTS.md` (section « Player + Cast — machine à états unifiée » réécrite : service unique, `castReduce`, interdiction d'un second `setOptions`, les faits F1 à F3, la recette), `docs/superpowers/specs/2026-11-18-cast-refonte-design.md` (§ « Résultats de la recette », bandeau daté)
- Outils : `.superpowers/sdd/2026-11-18-audit-cast/` (`drv.cjs`, `probe.js`, `sampler.js`, `picker.cjs`, `tv.py` ; venv : `python3 -m venv <scratchpad>/venv && <scratchpad>/venv/bin/pip install pychromecast`). `sampler.js` est à adapter aux nouvelles classes CSS (`CastPanels`).

Préalables : Pixel branché (`adb devices`), `adb reverse tcp:3002 tcp:3002`, `adb forward tcp:9334 localabstract:chrome_devtools_remote` (vérifier `Android-Package` = `com.android.chrome`), onglet ouvert par `adb shell am start -a android.intent.action.VIEW -d http://localhost:3002/ com.android.chrome`, appuis par `adb shell input tap`, **jamais de `adb screencap`** (captures de l'onglet par CDP). Cible : « Téléviseur Pièce à vivre » ; « Salle TV » est un Chromecast Audio, pas une cible. `svc power stayon usb` pendant la recette, `stayon false` à la fin.

- [ ] **Step 1: Build de production à jour**, serveur sur 3002, compte de test neuf, trois films loués.
- [ ] **Step 2: Rejouer les points 1 à 10 de la recette de la spec (§ 6)**, chacun avec l'état lu sur la TV (`tv.py`) et le journal de la sonde. Pour chaque point : attendu, observé, verdict. Tout écart est un défaut à corriger (retour à la tâche concernée, test ajouté) avant de continuer — pas une note.
- [ ] **Step 3: Point 12** (Chrome du Mac, build de production) : lancement, télécommande, fin.
- [ ] **Step 4: Relever ce qui reste à faire avec Rusmir** (point 11 : arrêt et extinction depuis la TV, téléphone verrouillé jusqu'après la fin, Wi-Fi coupé, déconnexion du compte) et les sous-titres en Cast (production seulement) : liste écrite dans la spec, non cochée.
- [ ] **Step 5:** `npm run test:phase:full` (lint + tests + build) — attendu : build vert, 9 échecs préexistants seulement.
- [ ] **Step 6: Commit** `docs(cast): AGENTS.md et résultats de la recette sur le Pixel`
