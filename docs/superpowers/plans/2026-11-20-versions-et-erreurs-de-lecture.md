# Versions, erreurs de lecture et télécommande de magnétoscope — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un seul réglage « Version » (VF / VOSTFR / VO) partout, une version préférée réglée par le visiteur dans son compte, un film qui ne se lance pas qui le dit et laisse une trace, des fichiers défectueux repérés d'avance, et une télécommande de télé qui se manie comme un magnétoscope.

**Architecture:** Un module pur (`src/utils/version-choice.ts`) décide de ce qui joue à partir de trois sources (choix fait pour ce film, version préférée du compte, choix par défaut) et de ce que la location offre ; la borne, le lecteur et la télécommande l'appellent tous et partagent une seule liste (`VersionList`). Les échecs de lecture passent par un module pur côté client, un panneau du lecteur et une table côté serveur. Sur la télé, changement de version et défilement rapide sont des états de la machine du Cast (`castReduce`), exécutés par le service existant, toujours avec le récepteur standard.

**Tech Stack:** Next.js 16, React 19, Zustand 5 (persist), better-sqlite3, SDK Google Cast (émetteur web, récepteur standard), ffprobe / ffmpeg, tests `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-19-versions-et-erreurs-de-lecture-design.md` (approuvée le 20/11/2026) — à lire en entier. Le tableau des réponses en tête du § 11 et les § 4 et 7 font foi sur toute phrase plus ancienne.

## Global Constraints

- Worktree `~/projetsperso/video-club-webgpu-borne`, branche `feat/borne-location`. **Commits locaux seulement : jamais `git push`, jamais `git add -A`** (fichiers ajoutés un par un), message par `git commit -F <fichier>` terminé par l'attribution du projet (les deux lignes données par la session en cours).
- **Jamais de récepteur Chromecast maison.** Sur la télé, changer de piste audio = recharger l'autre fichier ; l'avance rapide = une suite de sauts.
- **Jamais l'adresse de diffusion d'une location dans une trace ou un journal** : c'est le secret de la location.
- **Aucun bouton grisé** (`disabled`) : une version absente est une ligne de texte avec sa raison ; un bouton en attente porte `aria-busy`.
- Borne : **DOM pur sous `kiosk/`**, dessin de la dalle, casse des libellés, **zones d'appui d'au moins 44 px mesurées** à 360×780, 393×852 et 412×915, geste retour qui ferme ce qui est ouvert (`kioskBackAction`).
- **`VHSPlayer.tsx` ne grossit pas** : 1 740 lignes à `66ab47c`, jamais plus après un commit de ce plan (test statique) ; le nouveau code vit dans ses propres fichiers. Nouveaux fichiers ≤ 1 000 lignes.
- Toute décision vit dans de la **logique pure testée par `node --test`** : modules sans import de valeur, ou avec imports relatifs portant l'extension `.ts`, chargés tels quels par Node.
- **Une seule décision de version** (`decideVersion`) : aucun autre code ne choisit `'vf'` par défaut.
- La version préférée n'est **jamais déduite** : seul le réglage de « Mon compte » l'écrit. Un choix fait sur un film, « Essayer en … » ou la réponse à la question des sous-titres ne valent que pour ce film.
- Port **3002** pour ce worktree (jamais 3000 ni 3001). Rien n'est lancé sur la production. `next dev` réécrit `AGENTS.md` et `next-env.d.ts` : `git checkout --` ces deux fichiers avant chaque commit.
- Tout nouvel écran est **montré en capture et annoncé provisoire** avant d'être tenu pour validé ; le téléphone se juge sur le Pixel 9a.
- Sur l'appareil : **jamais `adb screencap`** (captures de l'onglet par CDP), **jamais `pm clear com.android.chrome`**, `svc power stayon false` en fin de session.
- Sur cette machine `grep`, `rg`, `sed`, `awk` sont refusés dans le shell : outil Read, ou `node <scratchpad>/cherche.cjs`. Ne jamais lire `.env`.
- Base des tests à `66ab47c` : **586 tests, 577 OK, 9 échecs préexistants** (budget de taille, 6 d'intégration, P-01, île SF). Aucun nouvel échec ; ces 9 ne sont pas à corriger ici.
- Noms exacts des versions : « VF » (version française), « VOSTFR » (version originale, sous-titres français), « VO » (version originale, sans sous-titres), « VF sous-titrée » (version française, sous-titres français), « VO, sous-titres anglais » (version originale, sous-titres anglais), « VF · sous-titres anglais » (version française, sous-titres anglais) ; « Autres versions » ; « Automatique » (« VF quand elle existe, sinon VOSTFR ») ; « Version préférée ».
- Autres textes exacts : « {nom} · seule version de ce film » ; « {nom} · indisponible pour ce film » ; « {nom joué} · VF indisponible pour ce film » ; « Ce film n'a pas de sous-titres français » / « La VO existe avec des sous-titres anglais. » / « Continuer en VO, sous-titres anglais » / « Passer en VF » ; « Ce film n'a pas de sous-titres. » / « Continuer en VO sans sous-titres » ; « Cette version ne se lance pas » / « Essayer en {nom} » / « Réessayer » / « Retour » ; « La {nom} ne se lance pas sur {télé}. Le film continue en {nom}. » ; « FF x2 », « FF x4 », « REW x2 », « REW x4 » ; « Taille des sous-titres » : « Normal », « Grand », « Très grand ».
- Valeurs : délai avant « rien ne vient » `PLAYBACK_START_TIMEOUT_MS = 15000` ; fin d'avance rapide à `CAST_SCAN_END_MARGIN_S = 10` secondes de la fin ; durée minimale d'un fichier `0,9 ×` la durée TMDB.

## Review Focus

1. **Choix par film périmé** : la version retenue pour un film n'existe plus (drapeau posé depuis, fichier retiré) → traitée comme une demande ordinaire (substitution écrite ou question), jamais une adresse vide → test « choix périmé » (tâche 1).
2. **Préférence illisible en base** (une colonne nulle et pas l'autre, valeur inconnue) → « Automatique », jamais une exception dans `/api/me` → test « préférence partielle » (tâche 5).
3. **Double appui sur une version pendant que la télé recharge** → une seule demande de chargement, pas de sélecteur d'appareil → test « demande répétée pendant le changement » (tâche 10).
4. **Trace malformée ou bavarde** (corps trop gros, champ `url`, position `NaN`) → refusée ou bornée, et aucune colonne ne peut porter une adresse → tests « entrées bornées » et « aucune adresse » (tâche 2).
5. **Accusé tardif d'un défilement arrêté** (appuis rapides ◀◀ ▶▶ ▶) → une seule chaîne de sauts, jamais deux → test « accusé périmé ignoré » (tâche 12).

## Ordre et parcage

- **Partie A — sans appareil** (tâches 1 à 9), dans l'ordre du § 9 de la spec. Écart assumé : la tâche 1 (logique pure des versions, sans écran) passe avant le lot 1, parce que le panneau d'erreur nomme les versions.
- **Partie B — Pixel 9a et vidéoprojecteur requis** (tâches 10 à 15), parquable en bloc : à l'écriture de ce plan, `adb devices` ne voit aucun appareil. Deux préalables : **P1**, la recette 8b de la refonte du Cast, avant la tâche 10 ; **l'essai jetable de la tâche 11**, montré à Rusmir, avant les tâches 12 à 14.

---

## Partie A — sans appareil

### Task 1: La décision de version (logique pure)

**Files:**
- Create: `src/utils/version-choice.ts` (aucun import de valeur)
- Test: `tests/domain/version-choice.test.mjs`

**Interfaces — Produces :**

```ts
export type VersionAudio = 'vf' | 'vo';
export type VersionSubtitle = 'off' | 'fr' | 'en';
export interface VersionChoice { audio: VersionAudio; subtitle: VersionSubtitle }
export interface VersionOffer { vf: boolean; vo: boolean; fr: boolean; en: boolean }
export const VF: VersionChoice; export const VOSTFR: VersionChoice; export const VO: VersionChoice;
export const VF_ST: VersionChoice;      // vf + fr
export const VO_STEN: VersionChoice;    // vo + en
export const FULL_OFFER: VersionOffer;  // tout vrai : liste du réglage du compte
export function versionOffer(urls: { vf: string | null; vo: string | null; subtitles: string | null; subtitles_en: string | null } | null | undefined): VersionOffer;
export function sameVersion(a: VersionChoice | null, b: VersionChoice | null): boolean;
export function isOffered(offer: VersionOffer, v: VersionChoice): boolean;
export function offeredVersions(offer: VersionOffer): VersionChoice[];      // tous les couples jouables
export function parseVersionChoice(audio: unknown, subtitle: unknown): VersionChoice | null;
export function versionName(v: VersionChoice): string;
export function versionSubLabel(v: VersionChoice): string;
export function defaultVersion(offer: VersionOffer): VersionChoice | null;  // VF ; sinon VOSTFR ; sinon VO + en ; sinon VO ; null sans piste audio
export function otherVersion(offer: VersionOffer, failed: VersionChoice): VersionChoice | null; // défaut calculé sans la piste audio en échec
export type VersionDecision =
  | { kind: 'none' }
  | { kind: 'play'; version: VersionChoice; note: string | null }
  | { kind: 'ask'; title: string; body: string | null; keep: { label: string; version: VersionChoice }; other: { label: string; version: VersionChoice } };
export function decideVersion(i: { offer: VersionOffer; filmChoice: VersionChoice | null; pref: VersionChoice | null }): VersionDecision;
export function resolvedVersion(d: VersionDecision): VersionChoice | null;   // play → version ; ask → keep.version ; none → null
export type VersionRow =
  | { kind: 'auto'; selected: boolean }
  | { kind: 'choice'; version: VersionChoice; name: string; sub: string; selected: boolean }
  | { kind: 'absent'; text: string }
  | { kind: 'more' };
export function versionRows(i: { offer: VersionOffer; current: VersionChoice | null; expanded: boolean; withAuto: boolean }): VersionRow[];
export function versionLine(offer: VersionOffer, current: VersionChoice | null): { text: string; openable: boolean };
export function nextAudio(offer: VersionOffer, v: VersionChoice): VersionChoice;     // touche V : l'autre piste si elle existe
export function nextSubtitle(offer: VersionOffer, v: VersionChoice): VersionChoice;  // touche T : off → fr → en → off, langues présentes seulement
export function prunedFilmVersions(map: Record<number, VersionChoice>, activeFilmIds: readonly number[]): Record<number, VersionChoice>;
```

Règles de `decideVersion` (spec § 4.1) : demandé = `filmChoice ?? pref` ; rien de demandé → défaut, sans note. Demandé et offert → joué, sans note. VF demandée absente → défaut, note « {nom joué} · VF indisponible pour ce film ». VO demandée absente → `VF`, note « VF · VO indisponible pour ce film ». Sous-titres demandés absents sur la VO : si la VF existe → `ask` (titre selon la langue demandée ; `keep` = VO avec l'autre langue si elle existe, sinon VO sans sous-titres ; `other` = `VF`, « Passer en VF ») ; sans VF → `play` de ce même `keep`, note « {nom joué} · sous-titres français indisponibles pour ce film ». Sous-titres demandés absents sur la VF → `{ vf, off }`, note du même modèle. Aucune piste audio → `none`.

`versionRows` : `auto` en tête si `withAuto` (sélectionnée quand `current` est null) ; puis VF, VOSTFR, VO dans cet ordre — `choice` si offerte, sinon `absent` « {nom} · indisponible pour ce film » ; puis `more` si une des deux autres est offerte et que `expanded` est faux ; ces deux-là en `choice` si `expanded` ou si `current` est l'une d'elles.

- [ ] **Step 1: Écrire les tests (rouges : module absent)**

```js
test('VERSION: sans rien de demandé — VF, sinon VOSTFR, sinon VO + anglais, sinon VO', () => {
  assert.deepEqual(defaultVersion({ vf: true, vo: true, fr: true, en: true }), VF);
  assert.deepEqual(defaultVersion({ vf: false, vo: true, fr: true, en: true }), VOSTFR);
  assert.deepEqual(defaultVersion({ vf: false, vo: true, fr: false, en: true }), VO_STEN);
  assert.deepEqual(defaultVersion({ vf: false, vo: true, fr: false, en: false }), VO);
  assert.equal(defaultVersion({ vf: false, vo: false, fr: true, en: true }), null);
});
test('VERSION: le choix du film prime sur la préférence, la préférence sur le défaut', () => {
  const offer = { vf: true, vo: true, fr: true, en: true };
  assert.deepEqual(decideVersion({ offer, filmChoice: VO, pref: VOSTFR }), { kind: 'play', version: VO, note: null });
  assert.deepEqual(decideVersion({ offer, filmChoice: null, pref: VOSTFR }), { kind: 'play', version: VOSTFR, note: null });
});
test('VERSION: VOSTFR préférée, pas de sous-titres français, VF présente → question', () => {
  const d = decideVersion({ offer: { vf: true, vo: true, fr: false, en: true }, filmChoice: null, pref: VOSTFR });
  assert.equal(d.kind, 'ask');
  assert.equal(d.title, "Ce film n'a pas de sous-titres français");
  assert.equal(d.body, 'La VO existe avec des sous-titres anglais.');
  assert.deepEqual(d.keep, { label: 'Continuer en VO, sous-titres anglais', version: VO_STEN });
  assert.deepEqual(d.other, { label: 'Passer en VF', version: VF });
});
test('VERSION: même cas sans aucun sous-titre → « Continuer en VO sans sous-titres »', () => { /* titre « Ce film n'a pas de sous-titres. », body null, keep VO */ });
test('VERSION: même cas sans VF → pas de question, VO jouée, note écrite', () => { /* kind play, VO_STEN, note « VO, sous-titres anglais · sous-titres français indisponibles pour ce film » */ });
test('VERSION: VF préférée absente → défaut, « VOSTFR · VF indisponible pour ce film »', () => {});
test('VERSION: VF sous-titrée préférée, pas de sous-titres français → VF sans question, note', () => {});
test('VERSION: choix périmé (film sans VO désormais) → VF avec « VF · VO indisponible pour ce film »', () => {});
test('VERSION: la réponse à la question, rangée en choix du film, ne repose pas la question', () => { /* decideVersion avec filmChoice = keep.version → play */ });
test('VERSION: noms et sous-libellés des six couples', () => { /* table des Global Constraints */ });
test('VERSION: lignes de la liste — absente écrite, « Autres versions », seule version', () => {
  const rows = versionRows({ offer: { vf: false, vo: true, fr: true, en: true }, current: VOSTFR, expanded: false, withAuto: false });
  assert.deepEqual(rows.map((r) => r.kind), ['absent', 'choice', 'choice', 'more']);
  assert.equal(rows[0].text, 'VF · indisponible pour ce film');
  assert.deepEqual(versionLine({ vf: false, vo: true, fr: false, en: false }, VO), { text: 'VO · seule version de ce film', openable: false });
});
test('VERSION: touches V et T agissent chacune sur son axe', () => { /* nextAudio garde les sous-titres s'ils restent offerts ; nextSubtitle saute les langues absentes */ });
test('VERSION: entrées illisibles → null ; choix des films rendus retirés', () => { /* parseVersionChoice('xx','fr') === null ; prunedFilmVersions */ });
```

- [ ] **Step 2:** `node --test tests/domain/version-choice.test.mjs` — attendu : « Cannot find module ».
- [ ] **Step 3: Écrire `src/utils/version-choice.ts`** selon les signatures et règles ci-dessus.
- [ ] **Step 4:** même commande — attendu : tout passe.
- [ ] **Step 5: Commit** `feat(version): décision pure de la version jouée (choix du film, préférence, défaut)`

---

### Task 2: Serveur — la trace des lectures en échec

**Files:**
- Create: `lib/playback-failure-parse.ts` (aucun import de valeur), `lib/playback-failures.ts` (base passée en paramètre, comme `lib/cast-session-store.ts`), `app/api/playback-failures/route.ts`
- Modify: `lib/schema.sql` (table `playback_failures`), `src/api/index.ts`
- Test: `tests/domain/playback-failures.test.mjs` (base en mémoire, schéma lu comme dans `tests/domain/cast-session-store.test.mjs`)

**Interfaces — Produces :**
- Table `playback_failures (id, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, user_id INTEGER NOT NULL, film_id INTEGER NOT NULL, audio TEXT NOT NULL, subtitle TEXT NOT NULL, place TEXT NOT NULL, kind TEXT NOT NULL, position_sec REAL, browser TEXT)`, clés étrangères en cascade, index `(film_id, created_at)`. `CREATE TABLE IF NOT EXISTS` dans `schema.sql` : pas de migration.
- `PLAYBACK_FAILURE_MAX_BODY_BYTES = 1024` ; `interface PlaybackFailure { filmId: number; audio: 'vf' | 'vo'; subtitle: 'off' | 'fr' | 'en'; place: 'device' | 'tv'; kind: 'error' | 'timeout' | 'tv_load'; position: number | null }` ; `parsePlaybackFailure(json: unknown): PlaybackFailure | null` (seuls ces champs sont lus) ; `briefBrowser(userAgent: string | null): string` (40 caractères au plus, « Chrome 157 · Android », « inconnu »).
- `savePlaybackFailure(db, i: PlaybackFailure & { userId: number; browser: string }): void` ; `summarizePlaybackFailures(db, days: number): { film_id: number; title: string | null; audio: string; place: string; failures: number; last_at: string }[]` (plus récents d'abord) ; `recentPlaybackFailures(db, limit: number)`.
- `POST /api/playback-failures` : session requise (401) ; `checkRateLimit(getRateLimitKey(request, 'playback-failure'), 30, 15 * 60 * 1000)` (429) ; corps vide ou trop gros (413) ; illisible (400) ; sinon 204. Le navigateur est lu sur l'en-tête `User-Agent` par le serveur, pas dans le corps.
- Client : `api.playbackFailures.report(f: PlaybackFailure): Promise<void>` — `keepalive`, toute erreur avalée (une trace perdue ne dérange jamais le visiteur).

- [ ] **Step 1: Tests (rouges)** : enregistrement puis relecture d'une ligne ; « entrées bornées » (position négative ou `NaN` → null ; `filmId` non entier, `audio` inconnu → `null`) ; « aucune adresse » (un corps portant `url`, `src`, `streamingUrl` donne un objet sans ces clés, et `PRAGMA table_info(playback_failures)` ne liste aucune colonne dont le nom contient `url` ou `path`) ; résumé groupé par film, piste et lieu, compte juste, plus récent d'abord ; `briefBrowser` sur trois en-têtes réels ; statique : la route appelle `checkRateLimit` et `getUserFromSession`, ne contient pas `console.log`.
- [ ] **Step 2:** rouge, écrire, vert (`node --test tests/domain/playback-failures.test.mjs`).
- [ ] **Step 3: Commit** `feat(lecture): trace serveur des lectures en échec, sans adresse de fichier`

---

### Task 3: Lecteur — « Cette version ne se lance pas »

**Files:**
- Create: `src/utils/playback-failure.ts` (pur), `src/components/player/usePlaybackFailure.ts`, `src/components/player/PlaybackFailurePanel.tsx` (+ `.module.css`), `src/components/player/useAirPlay.ts` (extraction, voir plus bas)
- Modify: `src/components/player/VHSPlayer.tsx`, `tests/domain/cast-player.test.mjs`
- Test: `tests/domain/playback-failure.test.mjs`

**Interfaces:**
- Consumes: `version-choice.ts` (tâche 1), `api.playbackFailures.report` (tâche 2), `localAutoPlay` de `src/utils/cast-on-open.ts`.
- Produces:
  - `PLAYBACK_START_TIMEOUT_MS = 15000` ; `startTimerArmed(i: { wanted: boolean; hasMetadata: boolean; failed: boolean }): boolean` ; `failurePanel(i: { title: string; version: VersionChoice; offer: VersionOffer }): { heading: string; line: string; tryOther: { label: string; version: VersionChoice } | null }`.
  - `usePlaybackFailure(i: { videoRef; videoKey: string; wanted: boolean; onFailure(kind: 'error' | 'timeout'): void }): { failure: 'error' | 'timeout' | null; retry(): void; attempt: number }` — `attempt` entre dans la `key` de la vidéo (« Réessayer » la remonte).
  - `PlaybackFailurePanel({ panel, onTryOther, onRetry, onBack })`.

Décisions :
- `wanted` = les conditions exactes de `localAutoPlay(...)` (la vidéo ne part d'elle-même que là) : le délai ne court donc ni sous « Regarder sur TV ? », ni pendant un Cast (attente, télécommande, liaison perdue), ni sous « BE KIND REWIND ».
- Erreur nette : **un écouteur `error` en phase de capture sur `<video>`** — l'événement d'un `<source>` ne remonte pas mais se capture (`VHSPlayer.tsx:1390`). À vérifier dans le navigateur à l'étape 4 ; si la capture ne le voit pas, l'écouteur se pose sur le `<source>`.
- « Essayer en {nom} » : `otherVersion(offer, version)` ; à ce stade le lecteur a encore `audioTrack` / `subtitleTrack` : il bascule par `handleAudioTrackChange` et `setSubtitleTrack`, position gardée (la tâche 8 passera par le choix du film).
- Trace : une par échec affiché, `place: 'device'`, position = `video.currentTime` ou, à zéro, `rental.watchPosition`. Jamais pour une prévisualisation `/admin` (`previewRental`).
- Place faite dans `VHSPlayer.tsx` : le bloc AirPlay (états l. 97-99, effet et sélecteur l. 777-828) part dans `useAirPlay(videoRef, isPlayerOpen, videoUrl)`, sans changement de comportement.

- [ ] **Step 1: Tests (rouges)** : `startTimerArmed` (faux si `wanted` faux, si les métadonnées sont là, si un échec est déjà affiché) ; `failurePanel` (« Cette version ne se lance pas », « 2001 : L'Odyssée de l'espace · VF », « Essayer en VOSTFR » ; `tryOther` null pour un film à une seule piste audio) ; statique : `VHSPlayer.tsx` contient `usePlaybackFailure` et `PlaybackFailurePanel`, compte ≤ 1 740 lignes ; le panneau ne contient pas `disabled` ; `usePlaybackFailure.ts` contient `addEventListener('error'` avec `true` et `loadedmetadata`.
- [ ] **Step 2:** rouge, écrire, vert. `npx tsc --noEmit` sans erreur.
- [ ] **Step 3:** `npm run test:phase` — attendu : les 9 échecs préexistants seulement.
- [ ] **Step 4: Vérification à l'écran** (`PORT=3002 npx next dev`, Chromium piloté, film loué du seed) : par `window.__store`, remplacer l'adresse VF de la location par `http://localhost:3002/absent.mp4` → le panneau s'ouvre sans attendre 15 s, « Essayer en VOSTFR » lance la VO à la même position, « Retour » ferme ; remplacer par `http://10.255.255.1/x.mp4` → panneau à 15 s (± 1 s) ; même adresse fausse sous « Regarder sur TV ? » (écran de téléphone) → pas de panneau tant que l'invite est là ; une ligne par échec dans `playback_failures`, sans adresse. Captures jointes, annoncées provisoires.
- [ ] **Step 5: Commit** `feat(lecteur): panneau « Cette version ne se lance pas » et trace de l'échec`

---

### Task 4: `/admin` — la liste des lectures en échec

**Files:**
- Create: `app/api/admin/playback-failures/route.ts`, `app/admin/PlaybackFailures.tsx`
- Modify: `app/admin/AdminPageClient.tsx` (monte la section au-dessus des filtres), `app/admin/AdminPage.module.css`, `AGENTS.md` (table des routes, liste des tables, § lecteur : panneau d'erreur et trace)
- Test: `tests/domain/playback-failures.test.mjs` (cas statiques ajoutés)

**Interfaces:**
- Consumes: `summarizePlaybackFailures`, `recentPlaybackFailures` (tâche 2).
- Produces: `GET /api/admin/playback-failures?days=30` (403 hors admin) → `{ days, groups, recent }`. Section « Lectures en échec » : une ligne par film, version et lieu (« appareil » / « télé ») — titre, version, nombre d'échecs, date du dernier ; vide : « Aucun échec sur 30 jours. »

- [ ] **Step 1: Tests statiques (rouges)** : la route vérifie `is_admin` et répond 403 ; `PlaybackFailures.tsx` appelle `/api/admin/playback-failures` avec `credentials: 'include'` ; `AdminPageClient.tsx` monte `<PlaybackFailures`.
- [ ] **Step 2:** rouge, écrire, vert ; `npx tsc --noEmit`.
- [ ] **Step 3: Vérification à l'écran** : compte admin local, `/admin` montre les lignes créées à la tâche 3. Capture.
- [ ] **Step 4: Commit** `feat(admin): liste des lectures en échec par film et par version`

---

### Task 5: La version préférée (serveur) et le choix par film (magasin)

**Files:**
- Create: `lib/version-pref.ts` (base en paramètre ; importe `../src/utils/version-choice.ts` avec l'extension), `app/api/me/version/route.ts`, `src/store/slices/version.ts`
- Modify: `lib/schema.sql` (colonnes `pref_audio TEXT DEFAULT NULL`, `pref_subtitle TEXT DEFAULT NULL` sur `users`), `lib/db.ts` (deux `ALTER TABLE` idempotents, comme les autres), `app/api/me/route.ts`, `src/api/index.ts`, `src/store/index.ts` (fusion de la tranche, `fetchMe`, `refreshRentals`, `logout`, `partialize`)
- Test: `tests/domain/version-pref.test.mjs`, `tests/domain/version-store.test.mjs` (statique)

**Interfaces — Produces :**
- `readVersionPref(db, userId: number): VersionChoice | null` ; `writeVersionPref(db, userId: number, pref: VersionChoice | null): void` ; `parseVersionPrefBody(json: unknown): { ok: true; pref: VersionChoice | null } | { ok: false }` (`{ audio: null, subtitle: null }` = « Automatique » ; un seul des deux nul = refus).
- `PATCH /api/me/version` : 401 sans session, 400 corps refusé, 200 `{ version_pref }`. `GET /api/me` : `user.version_pref: { audio; subtitle } | null`.
- Client : `ApiUser.version_pref?: VersionChoice | null` ; `api.me.setVersionPref(pref: VersionChoice | null): Promise<{ version_pref: VersionChoice | null }>`.
- Tranche `VersionSlice` : `versionPref: VersionChoice | null` (écrit par `fetchMe`, jamais persisté) ; `filmVersions: Record<number, VersionChoice>` (**persisté** par `partialize` : c'est « retenu sur l'appareil ») ; `setVersionPref(pref): Promise<boolean>` (écrit le magasin seulement après le oui du serveur) ; `chooseFilmVersion(filmId, v): void` ; `versionDecisionFor(state: VideoClubState, filmId: number): VersionDecision` (fonction exportée : offre de la location, `filmVersions[filmId]`, `versionPref`).
- `fetchMe` et `refreshRentals`, après une lecture réussie, remplacent `filmVersions` par `prunedFilmVersions(filmVersions, locations actives)` ; `logout` vide les deux.

- [ ] **Step 1: Tests (rouges)** : écriture puis relecture d'une préférence ; `null` remet les deux colonnes à NULL ; « préférence partielle » (une colonne nulle, ou `'xx'`) → `readVersionPref` rend `null` sans lever ; `parseVersionPrefBody` (les cinq couples nommés acceptés, « Automatique », refus d'un seul nul et d'une valeur inconnue) ; statique : `partialize` contient `filmVersions` et pas `versionPref` ; `fetchMe` écrit `versionPref` ; `logout` remet `versionPref: null` et `filmVersions: {}` ; la route `PATCH` appelle `getUserFromSession` ; `lib/db.ts` contient les deux `ALTER TABLE users ADD COLUMN pref_`.
- [ ] **Step 2:** rouge, écrire, vert ; `npx tsc --noEmit` ; `npm run test:phase` (9 échecs préexistants).
- [ ] **Step 3: Commit** `feat(version): version préférée sur le compte, choix par film retenu sur l'appareil`

---

### Task 6: La liste partagée et « Version préférée » dans « Mon compte »

**Files:**
- Create: `src/components/version/VersionList.tsx` (sans feuille de style à lui)
- Modify: `src/components/kiosk/KioskAccount.tsx`, `src/components/kiosk/KioskPanels.module.css`, `src/components/kiosk/KioskView.tsx`, `src/components/kiosk/kiosk-logic.ts` (`kioskBackAction`)
- Test: `tests/domain/kiosk-logic.test.mjs`, `tests/domain/kiosk-wiring.test.mjs`

**Interfaces:**
- Consumes: `versionRows`, `FULL_OFFER`, `versionName` (tâche 1) ; `versionPref`, `setVersionPref` (tâche 5).
- Produces:
  - `VersionList(props: { title: string; rows: VersionRow[]; classes: { list: string; title: string; row: string; rowSelected: string; absent: string; name: string; sub: string; more: string; back: string }; onPick(v: VersionChoice | null): void; onMore(): void; onBack(): void; busy?: boolean })` — `auto` et `choice` sont des boutons (`aria-pressed`), `absent` un paragraphe, `more` le bouton « Autres versions », « Retour » en pied ; `busy` pose `aria-busy` et fait ignorer l'appui. Chaque endroit lui passe les classes de sa propre feuille : c'est ce qui laisse une seule liste pour trois dessins.
  - `KioskAccount` gagne `prefOpen: boolean` et `onPrefOpen(open: boolean): void` ; sous le solde, la ligne « Version préférée » avec sa valeur (« Automatique » ou `versionName`) ; un appui remplace le contenu de l'écran par la liste (`versionRows({ offer: FULL_OFFER, current: versionPref, expanded, withAuto: true })`, titre « Version préférée »).
  - Après un choix : `await setVersionPref` ; succès → la liste se ferme et la ligne affiche « Enregistré » pendant 2 s ; échec → la liste reste, avec « L'enregistrement n'a pas abouti. Réessayez. »
  - `kioskBackAction` : entrée `prefOpen?: boolean` → `'close-pref'`, placé avant `'close-account'`.

- [ ] **Step 1: Tests (rouges)** : `kioskBackAction({ accountOpen: true, prefOpen: true, … }) === 'close-pref'` ; statique : `KioskAccount.tsx` contient « Version préférée » et `VersionList`, ni lui ni `VersionList.tsx` ne contiennent `disabled` ; `VersionList.tsx` n'importe aucune feuille de style.
- [ ] **Step 2:** rouge, écrire, vert ; `npx tsc --noEmit`.
- [ ] **Step 3: Vérification à l'écran** (build de production, port 3002, recette de la mémoire `borne-recettes-verification`) à 360×780, 393×852 et 412×915 : régler VOSTFR, recharger la page → la ligne dit VOSTFR ; revenir à « Automatique » ; couper le serveur avant un choix → le message d'échec, la ligne inchangée ; geste retour : liste, puis compte ; zones d'appui de la ligne et des lignes de la liste mesurées par `document.elementFromPoint` (≥ 44 px). Captures annoncées provisoires.
- [ ] **Step 4: Commit** `feat(borne): « Version préférée » dans Mon compte, liste des versions partagée`

---

### Task 7: La borne — ligne « Version », liste, question, lancement à source unique

**Files:**
- Modify: `src/components/kiosk/KioskDistribution.tsx` (`KioskReady`), `src/components/kiosk/KioskView.tsx` (l. 275-314, 510-539, 705-723), `src/components/kiosk/KioskPanels.module.css`, `src/components/kiosk/kiosk-logic.ts`, `src/store/slices/cast.ts` (`castFilm`), `src/components/player/VHSPlayer.tsx:832-840` (`sendToTv`), `tests/domain/cast-store.test.mjs`
- Test: `tests/domain/kiosk-logic.test.mjs`, `tests/domain/kiosk-wiring.test.mjs`

**Interfaces:**
- Consumes: `versionDecisionFor`, `chooseFilmVersion` (tâche 5) ; `VersionList` (tâche 6) ; `versionLine`, `versionRows`, `resolvedVersion` (tâche 1).
- Produces:
  - `castFilm(filmId: number, opts?: { version?: VersionChoice; startAt?: number }): void` — sans `version` : `resolvedVersion(versionDecisionFor(state, filmId))`. La chaîne `'vf'` par défaut disparaît de la tranche. `sendToTv` du lecteur passe `{ version: { audio: audioTrack, subtitle: subtitleTrack }, startAt }` jusqu'à la tâche 8.
  - `kiosk-logic.ts` : `readyLaunchStep(d: VersionDecision): 'launch' | 'ask' | 'refuse'` ; `kioskBackAction` gagne `versionOpen?: boolean` → `'close-version'` et `questionOpen?: boolean` → `'close-question'`, tous deux avant `'close-ready'`.
  - `KioskReady` gagne `version: { text: string; openable: boolean; note: string | null }`, `view: 'panel' | 'versions' | 'question'`, `rows`, `question`, et les rappels `onOpenVersions`, `onPickVersion`, `onAnswer(v)`, `onCloseSub`. La ligne « Version » se place entre l'échéance et les deux boutons ; sans chevron quand `openable` est faux ; la note de substitution s'écrit dessous.

Comportement (spec § 4.1, 4.3 a, 4.4) :
- Un appui sur une version de la liste : `chooseFilmVersion(filmId, v)`, retour au panneau.
- « Sur ce téléphone » / « Sur ma télé » : `readyLaunchStep(versionDecisionFor(...))`. `launch` → comme aujourd'hui (`watchHere`, `watchOnTv`, ce dernier passant la version à `castFilm`). `ask` → la question remplace le contenu du panneau, la cible (ici ou télé) est retenue ; la réponse fait, **dans le gestionnaire de son appui**, `chooseFilmVersion` puis le lancement vers la cible retenue (le sélecteur d'appareils exige l'activation de l'appui). `refuse` → message « Ce film n'a aucune version lisible pour le moment. »
- La question n'est donc posée qu'au moment de lancer le film, une fois : sa réponse devient le choix de ce film.
- Geste retour : question → panneau (rien n'est lancé) ; liste → panneau ; panneau → fermé.

- [ ] **Step 1: Tests (rouges)** : `readyLaunchStep` sur les trois cas ; `kioskBackAction` (`questionOpen` puis `versionOpen` avant `close-ready`) ; statique : `slices/cast.ts` ne contient plus `?? 'vf'` et appelle `versionDecisionFor` ; `KioskView.tsx` passe `version` à `castFilm` ; `KioskDistribution.tsx` contient `VersionList`, pas `disabled`.
- [ ] **Step 2:** rouge, écrire, vert ; `npx tsc --noEmit` ; `npm run test:phase` (9 échecs préexistants).
- [ ] **Step 3: Vérification à l'écran** (build de production 3002, trois largeurs) avec le seed, qui pose une dispo par film : film VF + VO → ligne « Version  VF › », liste, choix VOSTFR, « Sur ce téléphone » démarre en VO sous-titrée ; film sans VF → « VF · indisponible pour ce film » en texte ; film à un seul couple → « VO · seule version de ce film », sans chevron ; version préférée VOSTFR sur un film sans sous-titres français mais avec VF → la question à l'appui sur « Sur ce téléphone », chaque réponse lance la bonne version, la question ne revient pas à la réouverture ; zones d'appui mesurées. Captures provisoires.
- [ ] **Step 4: Commit** `feat(borne): ligne « Version » du panneau, question des sous-titres, Cast lancé dans la version décidée`

---

### Task 8: Le lecteur — bouton « Version », question, et la vidéo remontée qui garde sa fin

**Files:**
- Create: `src/components/player/usePlayerVersion.ts`, `src/components/player/useVideoLifecycle.ts`, `src/components/player/PlayerVersionPanel.tsx` (+ `.module.css`), `src/utils/video-swap.ts` (pur)
- Modify: `src/components/player/VHSPlayer.tsx`, `src/components/player/VHSControls.tsx` (+ `.module.css`), `src/utils/cast-on-open.ts` (`localAutoPlay`), `tests/domain/cast-player.test.mjs`, `tests/domain/cast-on-open.test.mjs`, `AGENTS.md` (§ lecteur « Pistes » et § borne : le réglage « Version », la version préférée, la question)
- Test: `tests/domain/video-swap.test.mjs`

**Interfaces:**
- Consumes: tranche des versions (tâche 5), `VersionList` (tâche 6), `usePlaybackFailure` (tâche 3).
- Produces:
  - `usePlayerVersion(filmId: number | null, urls: StreamingUrls | undefined): { offer: VersionOffer; version: VersionChoice | null; note: string | null; question: Extract<VersionDecision, { kind: 'ask' }> | null; choose(v: VersionChoice): void; cycleAudio(): void; cycleSubtitle(): void }` — `choose` et les deux cycles écrivent `chooseFilmVersion`.
  - `swapResumeTime(i: { elementTime: number; rentalPosition: number; rentalProgress: number }): number` — la plus grande des deux positions, 0 pour une location vue à 100 %.
  - `useVideoLifecycle(i: { videoRef; videoKey: string; resumeAt: number; onEnded(): void })` — trois effets, **tous dépendants de `videoKey`** : fin de film, reprise à l'ouverture, position rétablie après un remontage (au `loadedmetadata` du nouvel élément si sa position est sous 1 s).
  - `localAutoPlay` gagne `question: boolean` : faux tant que la question est affichée.
  - `VHSControls` : `audioTrack`, `subtitleTrack`, `hasVF`, `hasVO`, `hasSubtitlesFr`, `hasSubtitlesEn` et leurs deux rappels laissent la place à `versionLabel: string` et `onOpenVersion(): void` ; un bouton « Version » qui affiche le nom courant.
  - `PlayerVersionPanel({ view: 'list' | 'question', … })` : la liste (`VersionList`, classes du lecteur) ou la question, dans le style du lecteur.

> **Note (vague de corrections de la partie A, 20/11/2026)** : la règle « 0 pour une location vue à 100 % » de
> `swapResumeTime` a été remplacée par la règle des 10 dernières secondes du fichier, lue sur sa durée, la même pour
> l'appareil et pour la télé : `swapResumeTime({ elementTime, rentalPosition, duration })`, `RESUME_END_MARGIN_S = 10`
> (`src/utils/video-swap.ts`).

Ce qui disparaît de `VHSPlayer.tsx` : les états `audioTrack` / `subtitleTrack` (l. 90-91), les deux effets de recalage (l. 209-223), `getVideoUrl` (l. 241-246), `handleAudioTrackChange`, `handleSubtitleTrackChange`, `cycleSubtitleTrack` (l. 263-284), l'effet de position après changement de piste (l. 287-298), l'effet de reprise (l. 346-359), l'écouteur de fin (l. 1000-1022, sa décision passe dans `onEnded`). La `key` de la vidéo devient `${version.audio}-${videoUrl}-${attempt}`. Les touches V et T appellent `cycleAudio` / `cycleSubtitle`. La note de substitution s'affiche dans les lignes sous l'en-tête. Le panneau d'erreur de la tâche 3 passe par `choose` : « Essayer en … » devient le choix de ce film.

- [ ] **Step 1: Tests (rouges)** : `swapResumeTime` (changement avant la première image → position de la location ; en cours de film → position de l'élément ; location à 100 % → 0) ; `localAutoPlay` faux avec `question` ; statique : `VHSPlayer.tsx` ne contient plus `useState<AudioTrack>` ni `getVideoUrl`, contient `usePlayerVersion` et `useVideoLifecycle`, compte moins de lignes qu'avant la tâche ; dans `useVideoLifecycle.ts`, chaque tableau de dépendances contient `videoKey` ; `VHSControls.tsx` ne contient plus `STFR` ni `disabled`, contient « Version ».
- [ ] **Step 2:** rouge, faire la chirurgie, vert ; `npx tsc --noEmit` ; `npm run lint` (aucune erreur nouvelle) ; `npm run test:phase` (9 échecs préexistants).
- [ ] **Step 3: Vérification à l'écran** (Chromium piloté, port 3002) : ouvrir un film repris à 5 min, changer de version avant la première image → la lecture part à 5 min (± 2 s), pas à zéro ; changer en cours de film → même seconde (± 1 s), lecture qui continue ; après deux changements, aller à 10 s de la fin → « BE KIND REWIND » s'affiche à la fin ; touches V et T ; film ouvert depuis le vidéoclub avec VOSTFR préférée et sans sous-titres français → la question dans le lecteur, vidéo en pause derrière, chaque réponse lance la bonne version. Captures provisoires.
- [ ] **Step 4: Commit** `refactor(lecteur): bouton « Version » et décision unique ; fin de film et reprise suivent la vidéo remontée`

---

### Task 9: Contrôle des fichiers

**Files:**
- Create: `lib/media/file-check.ts` (pur), `scripts/media-check.ts`
- Modify: `lib/schema.sql` et `lib/db.ts` (colonnes `vf_unplayable INTEGER DEFAULT 0`, `vo_unplayable INTEGER DEFAULT 0` sur `films`), `lib/films.ts` (`Film`), `lib/rentals.ts` (`buildStreamingUrls`, jointure de `getUserActiveRentals` l. 130-165, `rentFilm`), `app/api/films/[tmdbId]/route.ts`, `src/components/kiosk/kiosk-logic.ts` (`rentAction`, `actionLabel`), `src/components/kiosk/KioskAction.tsx`, `package.json` (`"media:check": "npx tsx --env-file=.env scripts/media-check.ts"`), `AGENTS.md` (commande, colonnes, leçon « Dispo VF/VO »)
- Test: `tests/domain/media-file-check.test.mjs`, `tests/domain/kiosk-logic.test.mjs`

**Interfaces — Produces :**
- `interface FileProbe { exists: boolean; opens: boolean; hasVideo: boolean; hasAudio: boolean; duration: number; tailDecodes: boolean }`.
- `MIN_DURATION_RATIO = 0.9` ; `VF_VO_MAX_GAP_S = 2`.
- `judgeFilm(i: { runtimeMin: number | null; vf: FileProbe | null; vo: FileProbe | null }): { vf: string[]; vo: string[]; pair: string[] }` — anomalies en français (« fichier absent », « illisible », « pas de piste vidéo », « pas de piste audio », « fin indécodable », « durée 68,5 min pour un film de 156 min », « VF et VO de durées différentes (68,5 min / 156,0 min) »). `null` = version que le film n'a pas : aucune anomalie.
- `playableVersions(film: { file_path_vf_transcoded: string | null; file_path_vo_transcoded: string | null; vf_unplayable?: number | null; vo_unplayable?: number | null }): { vf: boolean; vo: boolean }`.
- `rentAction` gagne `playable: boolean` et la valeur `'unplayable'` (après `'unavailable'`) : bouton « Indisponible », message « Film indisponible » / « Ce film n'a aucune version lisible pour le moment. »
- `rentFilm` : aucune version jouable → `throw new Error("Ce film n'a aucune version lisible pour le moment")`, **avant** le contrôle du stock et des crédits (aucun crédit dépensé). Le mode `FORCED_RENTAL_*` n'est pas concerné.

Décisions :
- Une version marquée compte comme absente dans `buildStreamingUrls` (adresse nulle), dans les liens créés par `rentFilm`, et dans `has_vf` / `has_vo` de la fiche. La prévisualisation `/admin` ne lit pas les drapeaux : elle sert à diagnostiquer.
- Le script lit les films `is_available = 1`, résout le chemin sous `MEDIA_FILMS_PATH`, ignore les médias directs du seed (`isDirectMediaUrl`), sonde par `probeStreams`, et décode les dix dernières secondes (`ffmpeg -v error -sseof -10 -i <fichier> -f null -`, 60 s au plus). Une ligne par anomalie (« [12] 2001 : L'Odyssée de l'espace — VF : durée 68,5 min pour un film de 156 min »), un bilan, code de sortie 1 s'il y a des anomalies.
- `--mark` : pose le drapeau d'une version qui a ses propres anomalies et **le retire** d'une version redevenue saine ; pour un écart VF / VO, seule la version sous 90 % de la durée TMDB est marquée. `--film <id>` limite à un film. Jamais d'écriture sur `is_available` ni `duration_sec`.

- [ ] **Step 1: Tests (rouges)** : `judgeFilm` (les cinq cas de la spec § 1 donnent « durée … » sur la VF ; fichier absent ; sans audio ; écart de 3 s entre VF et VO ; durée TMDB inconnue → pas d'anomalie de durée) ; `playableVersions` (drapeau → faux ; chemin nul → faux) ; `rentAction` (`playable: false` → `'unplayable'`) ; statique : `scripts/media-check.ts` ne contient ni `is_available =` ni `duration_sec =`, contient `--mark` ; `rentFilm` lève avant `RENTAL_COSTS` ; la route de la fiche et `buildStreamingUrls` passent par `playableVersions` ; la jointure de `getUserActiveRentals` porte les deux drapeaux.
- [ ] **Step 2:** rouge, écrire, vert ; `npx tsc --noEmit` ; `npm run test:phase` (9 échecs préexistants).
- [ ] **Step 3: Vérification locale** : sur la base du seed, `npm run media:check` répond que tous les médias sont des médias de seed (aucun contrôle, code 0) ; si `ffmpeg` est installé sur la machine, fabriquer dans un dossier temporaire un fichier sain et un fichier tronqué, les rattacher à deux films d'une copie de la base, et constater l'anomalie, le code de sortie 1, puis le drapeau posé par `--mark` et la fiche qui dit « indisponible ». Sinon l'écrire dans le rapport : non vérifié sur de vrais fichiers. **Rien n'est lancé sur la production.**
- [ ] **Step 4:** `npm run test:phase:full` (lint + tests + build) — build vert, 9 échecs préexistants.
- [ ] **Step 5: Commit** `feat(media): contrôle des fichiers (rapport, marquage sur option) et location refusée sans version lisible`

---

## Partie B — Pixel 9a et vidéoprojecteur requis (parquable)

**Préalable P1 — recette 8b de la refonte du Cast.** Tâche 8 du plan `docs/superpowers/plans/2026-11-18-cast-refonte.md` (espace `.superpowers/sdd/2026-11-18-cast-refonte/`), dont le point « sous-titres en Cast » : notre stockage envoie l'en-tête CORS « * », que la documentation de Google dit refusé quand des pistes sont déclarées. Si la télé refuse les pistes, **arrêt** : la suite (corriger l'en-tête du stockage, ou ne déclarer les pistes que pour une version sous-titrée) se décide avec Rusmir avant la tâche 10. Mise en place de l'appareil : celle de cette tâche 8 (`adb reverse tcp:3002 tcp:3002`, CDP, cible « Téléviseur Pièce à vivre »).

### Task 10: Changer de version sur la télé — appareil requis, après P1

**Files:**
- Modify: `src/cast/cast-machine.ts`, `src/cast/cast-labels.ts`, `src/store/slices/cast.ts`, `src/components/player/CastPanels.tsx` (+ `.module.css`), `src/components/player/CastNotices.tsx`, `src/components/player/usePlayerVersion.ts`, `src/components/player/VHSPlayer.tsx`
- Test: `tests/domain/cast-machine.test.mjs`, `tests/domain/cast-labels.test.mjs`, `tests/domain/cast-store.test.mjs`, `tests/domain/cast-panels.test.mjs`, `tests/domain/cast-service.test.mjs`

**Interfaces — Produces :**
- `CastNotice` gagne `'version_failed'` ; `CastState.notice` gagne `detail?: { failed: string; kept: string }` ; `CastState.swap: { fallback: CastMediaRequest | null; labels: { asked: string; kept: string } } | null` (null hors d'un changement de version).
- Événement `{ type: 'REQUEST_VERSION'; filmId: number; media: CastMediaRequest; fallback: CastMediaRequest; labels: { asked: string; kept: string } }`.
- `castWaitingParts(phase, deviceName, swapping?: boolean)` : « Changement de version sur {nom}… » ; `castNoticeView(code, deviceName, detail?)` : « La {failed} ne se lance pas sur {télé}. Le film continue en {kept}. », sans « Réessayer ».
- Tranche : `castVersion(filmId: number, next: VersionChoice): void`. Même piste audio que la version envoyée → `setCastSubtitle` (sans coupure) ; autre piste → `REQUEST_VERSION` avec `media.startAt = cast.position` (**la même seconde**) et, en `fallback`, la version en cours à la même position. La tranche retient la dernière version envoyée par film.
- `CastPanelsProps.subtitles` disparaît : `RemotePanel` porte la ligne « Version  {nom} › », qui ouvre `VersionList` (classes de `CastPanels.module.css`) ; un choix fait `chooseFilmVersion` puis `castVersion`. `castSubtitleRow`, `subtitleToTv` et `TV_SUBTITLE_ERROR` quittent `VHSPlayer.tsx` ; l'échec d'une bascule de sous-titres (« Sous-titres indisponibles sur la TV. ») s'écrit dans la télécommande.
- Télécommande ouverte, les touches V et T (`cycleAudio`, `cycleSubtitle` de `usePlayerVersion`) passent par le même chemin : choix du film, puis `castVersion` — la touche T agit déjà sur la télé aujourd'hui.
- `CastNoticeLine`, pour `load_failed` : bouton « Essayer en {nom} » quand `otherVersion(offer, version envoyée)` existe → `chooseFilmVersion` puis `castFilm(filmId, { version })`.
- Trace : quand le message passe à `load_failed` ou `version_failed` pour un film suivi, la tranche envoie `{ place: 'tv', kind: 'tv_load', audio et subtitle de la version demandée, position }`.

Règles de la machine :
- `REQUEST_VERSION` en `remote`, même film, sans commande en vol → `loading`, `LOAD_MEDIA` + délai de chargement ; ni `OPEN_PICKER`, ni `SERVER_CLOSE`. Ignoré ailleurs, pour un autre film, et pendant un changement en cours.
- Premier statut de lecture → `remote` ; l'effet serveur est `SERVER_REPORT` (la séance reste la même), `swap` revient à null.
- `LOAD_FAILED` ou délai dépassé avec un repli → on reste en `loading`, `LOAD_MEDIA` du repli, `swap.fallback = null`, message `version_failed` avec ses noms ; au statut de lecture suivant, `remote` **garde** ce message (aujourd'hui `enterRemote` efface le message du film).
- Second échec → repos, message `load_failed`, `SERVER_CLOSE` (non fini, position connue), film oublié, reprise locale en pause. Un seul repli, jamais de boucle.
- « Arrêter » pendant le changement (le bouton de l'attente prend ce libellé) → comme `USER_STOP` : la télé s'arrête, la séance se clôt à la position connue.

- [ ] **Step 1: Tests (rouges)** : les règles ci-dessus, une par test ; « demande répétée pendant le changement » → un seul `LOAD_MEDIA` ; invariant sur tous les chemins existants : `swap` est null hors de `loading` ; libellés ; faux SDK : un `REQUEST_VERSION` donne un `loadMedia` sur la séance ouverte et aucun `requestSession` ; statique : `CastPanels.tsx` ne contient plus `STFR`, contient « Version » ; `VHSPlayer.tsx` ne contient plus `castSubtitleRow`.
- [ ] **Step 2:** rouge, écrire, vert ; `npx tsc --noEmit` ; `npm run test:phase` (9 échecs préexistants).
- [ ] **Step 3: Sur l'appareil** (build de production, outils de l'audit du Cast) : VF → VOSTFR en cours de film — durée de la coupure chronométrée, position lue sur la télé avant et après (même seconde, ± 2 s) ; VOSTFR → VO : sans coupure ; version dont l'adresse est faussée dans le magasin → « La VO ne se lance pas sur … Le film continue en VF. », le film reprend ; même essai avec les deux adresses fausses → « Le film n'a pas pu démarrer sur … » et « Essayer en … » absent ; deux lignes `tv_load` dans la trace. **Si la coupure dépasse 3 secondes, le montrer à Rusmir** (spec § 11.3) avant de clore la tâche.
- [ ] **Step 4: Commit** `feat(cast): changer de version sur la télé, repli unique sur l'ancienne, trace des refus`

---

### Task 11: Essai jetable de l'avance rapide par sauts — appareil requis, puis arrêt

**Files:**
- Create (hors dépôt, dossier ignoré par git) : `.superpowers/sdd/2026-11-20-versions/essai-defilement/` — script piloté par CDP, relevés
- Modify: la spec, § 10, sous-partie « Résultats de l'essai du défilement »

Rien de cet essai n'entre dans `src/`. Il répond à ce que la spec ne sait pas (§ 11.9) et à ce que la documentation lue ne dit pas (les valeurs de `resumeState`).

- [ ] **Step 1:** film lancé sur la télé par le site (build de production). Dans la page, par la séance média du SDK : mise en pause, puis sauts enchaînés pendant 30 s à ×2, puis 30 s à ×4, chaque saut envoyé à l'accusé du précédent, de taille vitesse × temps écoulé. Relever pour chaque saut le délai d'accusé.
- [ ] **Step 2: Mesurer** : la télé rafraîchit-elle l'image à chaque saut quand elle est en pause ? Cadence des images (par seconde) ; vitesse réelle (secondes de film gagnées par seconde d'horloge) à ×2 et à ×4 ; même relevé en arrière ; valeurs acceptées par `SeekRequest.resumeState` ; variante « lecture entre les sauts » pour comparer (image, son).
- [ ] **Step 3: Téléphone verrouillé en plein défilement** : état de la télé 10 s après (pause, lecture, position) ; l'événement `visibilitychange` part-il avant le gel de la page ?
- [ ] **Step 4:** écrire les relevés dans la spec (§ 10) et en tirer `CAST_SCAN_MIN_INTERVAL_MS` pour la tâche 13. `svc power stayon false`.
- [ ] **Step 5: ARRÊT — montrer l'essai à Rusmir sur son vidéoprojecteur** et attendre son accord avant les tâches 12 à 14. S'il refuse le rendu, ces tâches sont à reconcevoir avec lui : ne pas les commencer.
- [ ] **Step 6: Commit** `docs(cast): résultats de l'essai du défilement par sauts sur la télé`

---

### Task 12: La machine du défilement (logique pure) — après l'accord de la tâche 11

**Files:**
- Modify: `src/cast/cast-machine.ts`, `src/cast/cast-labels.ts`
- Test: `tests/domain/cast-machine.test.mjs`, `tests/domain/cast-labels.test.mjs`

**Interfaces — Produces :**
- `CastState.scan: { id: number; direction: 1 | -1; speed: 2 | 4; lastAt: number } | null`.
- Événements `{ type: 'SCAN'; direction: 1 | -1; at: number }`, `{ type: 'SCAN_STEP_DONE'; id: number; at: number }`, `{ type: 'SCAN_STEP_FAILED'; id: number }` (`at` : horloge du service, en ms — la machine reste pure).
- Effet `{ type: 'SCAN_SEEK'; id: number; position: number; resume: 'pause' | 'play' }`.
- `CAST_SCAN_END_MARGIN_S = 10` ; `CAST_SCAN_MIN_STEP_S = 0.1` ; `CAST_SCAN_MIN_INTERVAL_MS` (valeur de l'essai).
- `CastCommand` perd `seekBy`.
- `castScanLabel(scan: CastState['scan']): string | null` → « FF x2 », « FF x4 », « REW x2 », « REW x4 ».

Règles : `SCAN` en `remote` — même sens : ×2 → ×4 → arrêt ; autre sens : ×2 dans ce sens ; chaque nouveau défilement prend un `id` neuf et part par un `SCAN_SEEK` en `pause`. `SCAN_STEP_DONE` du bon `id` → saut suivant de `speed × max(écoulé, CAST_SCAN_MIN_STEP_S)` secondes, `position` de l'état mise à jour (le compteur avance). Arrivé à 0 en arrière → dernier saut à 0 en `pause`, `scan` null, `paused` vrai. Arrivé à `duration − 10` en avant (durée connue) → saut à cette position en `play`, `scan` null. Arrêt par le cycle, par la touche du milieu (`COMMAND toggle` pendant un défilement) ou par `PAGE_HIDDEN` → `SCAN_SEEK` à la position courante en `play`, `scan` null, puis `SERVER_REPORT`. `SCAN_STEP_FAILED` → `scan` null, `REQUEST_STATUS`. Pendant un défilement : `POSITION` est ignoré, `TICK` n'émet pas `SERVER_REPORT`, le volume reste commandable, `busy` n'est jamais posé par un saut.

- [ ] **Step 1: Tests (rouges)** : le cycle des deux touches ; taille d'un saut pour 0,5 s écoulée à ×4 (2 s de film) et pour 0 s (plancher) ; butée au début ; butée à 10 s de la fin ; durée inconnue → pas de butée ; « accusé périmé ignoré » (un `SCAN_STEP_DONE` d'un `id` ancien ne produit aucun effet) ; touche du milieu ; `PAGE_HIDDEN` ; échec d'un saut ; aucun `SERVER_REPORT` pendant, un à la fin ; invariant sur tous les chemins : `scan` est null hors de `remote` (liaison perdue, fin, arrêt, « Sur ce téléphone », location disparue, changement de version) ; `castScanLabel`.
- [ ] **Step 2:** rouge, écrire, vert.
- [ ] **Step 3: Commit** `feat(cast): défilement rapide par sauts dans la machine du Cast`

---

### Task 13: La télécommande de magnétoscope — appareil requis

**Files:**
- Modify: `src/cast/cast-sdk.ts` (`CafSeekRequest.resumeState`, `media.ResumeState`), `src/cast/cast-service.ts` (`SCAN_SEEK`, `seekBy` retiré), `src/store/slices/cast.ts` (`castScan`, `castSeekBy` retiré), `src/components/player/CastPanels.tsx` (+ `.module.css`), `tests/helpers/fake-cast-sdk.mjs`
- Test: `tests/domain/cast-service.test.mjs`, `tests/domain/cast-panels.test.mjs`, `tests/domain/cast-store.test.mjs`

**Interfaces:**
- Consumes: tâche 12.
- Produces: `castScan(direction: 1 | -1): void` ; exécution de `SCAN_SEEK` par `media.seek` avec `resumeState`, accusé → `SCAN_STEP_DONE { id, at }`, refus ou silence au-delà de `CAST_ACK_TIMEOUT_MS` → `SCAN_STEP_FAILED` ; deux sauts jamais espacés de moins de `CAST_SCAN_MIN_INTERVAL_MS`.

Écran (spec § 7.1) : pastille de l'appareil, titre, **le temps en chiffres seul** (`formatCastTime`), l'état (`castScanLabel`), trois touches ◀◀ BACK · lecture / pause · ▶▶ FF, volume, « Version », puis « Retour », « Sur ce téléphone », « Arrêter ». La barre, le pourcentage, « −15s » et « +15s » disparaissent. La touche du milieu garde sa logique (⏸ en lecture, ▶ en pause ou en défilement), avec le libellé PAUSE ou PLAY. Pendant un défilement les trois touches ne sont ni estompées ni sourdes, quel que soit `cast.busy`.

- [ ] **Step 1: Tests (rouges)** : faux SDK — le second `seek` ne part qu'après l'accusé du premier, porte la pause, puis la lecture à l'arrêt ; silence → `SCAN_STEP_FAILED` ; statique : `CastPanels.tsx` ne contient plus `castSeekBy`, `castingBarFill`, `−15s`, contient `castScan(`, `BACK`, `FF` ; `slices/cast.ts` ne contient plus `seekBy`.
- [ ] **Step 2:** rouge, écrire, vert ; `npx tsc --noEmit` ; `npm run test:phase` (9 échecs préexistants).
- [ ] **Step 3: Sur l'appareil** : ▶▶ une fois, deux fois, trois fois ; ◀◀ jusqu'au début (pause à zéro) ; ▶▶ jusqu'à 10 s de la fin (la lecture reprend, « BE KIND REWIND » arrive) ; touche du milieu en plein défilement ; appuis rapides alternés (un seul défilement, compteur cohérent) ; téléphone verrouillé en plein défilement (lecture normale au retour) ; vitesse chronométrée contre le compteur à ×2 et ×4 ; zones d'appui des trois touches mesurées. Captures de l'onglet par CDP, annoncées provisoires.
- [ ] **Step 4: Commit** `feat(cast): télécommande de magnétoscope — retour et avance rapides, compteur, plus de barre`

---

### Task 14: Taille des sous-titres sur la télé — appareil requis

**Files:**
- Modify: `src/cast/cast-machine.ts` (`CastMediaRequest.subtitleScale: number`), `src/cast/cast-wire.ts` (`CastLoadData.subtitleScale`), `src/cast/cast-sdk.ts` (`media.TextTrackStyle`, second paramètre de `EditTracksInfoRequest`), `src/cast/cast-service.ts`, `src/cast/cast-labels.ts`, `src/store/slices/cast.ts`, `src/store/index.ts` (`partialize`), `src/components/player/CastPanels.tsx`, `tests/helpers/fake-cast-sdk.mjs`
- Test: `tests/domain/cast-wire.test.mjs`, `tests/domain/cast-labels.test.mjs`, `tests/domain/cast-service.test.mjs`, `tests/domain/cast-store.test.mjs`

**Interfaces — Produces :**
- `type CastSubtitleSize = 'normal' | 'grand' | 'tres-grand'` ; `castSubtitleScale(size): number` (1, 1,5, 2 — à ajuster à l'étape 3) ; `castSubtitleSizeLabel(size): 'Normal' | 'Grand' | 'Très grand'` ; `nextSubtitleSize(size): CastSubtitleSize`.
- Magasin : `castSubtitleSize: CastSubtitleSize` (**persisté** : retenu sur l'appareil), `setCastSubtitleSize(size): Promise<boolean>`.
- Service : `setCastSubtitleScale(scale: number): Promise<boolean>` (`EditTracksInfoRequest(pistes actives, style)`), et le style posé au chargement (`MediaInfo.textTrackStyle`) pour qu'un changement de version garde la taille.
- Télécommande : sous « Version », la ligne « Taille des sous-titres  {libellé} › » ; un appui passe à la taille suivante. Affichée seulement quand la télé a des sous-titres actifs.

- [ ] **Step 1: Tests (rouges)** : `loadRequestData` porte l'échelle ; libellés et cycle ; faux SDK : la demande d'édition porte les pistes actives **et** le style ; statique : `partialize` contient `castSubtitleSize`.
- [ ] **Step 2:** rouge, écrire, vert ; `npx tsc --noEmit`.
- [ ] **Step 3: Sur l'appareil** : les trois tailles en cours de lecture (le style change-t-il sans recharger, comme la documentation l'annonce ?), lisibilité sur le vidéoprojecteur, taille gardée après un changement de version et après un rechargement de page. Ajuster les trois échelles si besoin. Si le style ne change pas en cours de lecture : le noter, et n'appliquer la taille qu'au chargement suivant.
- [ ] **Step 4: Commit** `feat(cast): taille des sous-titres sur la télé, retenue sur l'appareil`

---

### Task 15: Recette sur le Pixel 9a et le vidéoprojecteur, documentation — appareil requis

**Files:**
- Modify: `AGENTS.md` (§ « Player + Cast » : changement de version, défilement, taille des sous-titres, retrait de `seekBy` ; § « Borne »), la spec (§ « Résultats de la recette », bandeau daté)

- [ ] **Step 1:** build de production à jour, serveur sur 3002, compte de test, films loués couvrant : VF + VO + sous-titres, VO seule, VO sans sous-titres français.
- [ ] **Step 2: Rejouer le § 10 de la spec**, chaque point avec attendu, observé, verdict : changement de piste audio sur la télé ; avance et retour rapides ; sous-titres en Cast ; taille des sous-titres ; panneau d'erreur **sur le Pixel** avec une adresse volontairement fausse (erreur nette et délai de 15 s).
- [ ] **Step 3: Points que le § 10 ne liste pas** : « Version préférée » réglée sur le Pixel puis lue sur un autre navigateur ; la question des sous-titres avant un lancement « Sur ma télé » (le sélecteur d'appareils s'ouvre bien après la réponse) ; ligne « Version » et liste de la borne sur le Pixel, zones d'appui mesurées ; « Essayer en … » après un échec sur la télé.
- [ ] **Step 4:** tout écart est un défaut à corriger dans sa tâche (test ajouté) avant de continuer, pas une note.
- [ ] **Step 5:** `npm run test:phase:full` — build vert, 9 échecs préexistants ; `svc power stayon false`.
- [ ] **Step 6: Commit** `docs(lecteur): AGENTS.md et résultats de la recette des versions sur le Pixel`
