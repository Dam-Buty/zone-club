# Borne 24/7 — distribution de la K7, livraison 2 (la vidéo) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** après une location réussie, la borne joue la vidéo de 8 s du robot qui sert la K7, avec la tranche du film loué et le texte de l'afficheur posés par la page pendant l'arrêt sur la fente, puis ouvre le panneau « Votre K7 est prête ».

**Architecture:** la fabrique (`tools/devanture-borne/`, Python + Blender) rend UNE vidéo pour tous les films, avec une K7 à tranche neutre, et écrit dans un JSON où et quand la page pose ses deux calques. Les tranches des films sont des images préparées à l'avance par la fabrique (usure et éclairage cuits). Côté site, une phase `film` s'insère entre `waiting` et `ready` dans `KioskView` ; toute la logique testable vit dans un module pur.

**Tech Stack:** Blender 5.3 (Cycles), Python 3 (numpy, PIL, scipy), ffmpeg ; Next.js 16, React 19, CSS Modules ; tests `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-17-borne-distribution-k7-design.md` — le **§ 12 prime** sur les § 3 à 6. Document parent : `2026-11-16-borne-location-design.md`. Règles de la borne : section « Borne de location » d'`AGENTS.md`.

## Global Constraints

- Rien de 3D sous `src/components/kiosk/` : ni `three`, ni `<canvas>`, ni `backdrop-filter`, ni filtre CSS ; un seul mode de fusion (`screen`, déjà pris par le reflet). Les calques posés sur la vidéo sont des `<img>` et du texte en composition normale.
- Aucun lecteur vidéo tiers : la vidéo est servie par le site, à la racine de `public/` (hors des chemins mis en cache par le service worker : pas de changement de `VERSION`).
- La location est enregistrée AVANT la vidéo ; une location refusée ne joue rien.
- La vidéo ne retarde ni ne bloque jamais : absente, pas prête, refusée, ou « moins de mouvement » demandé → panneau directement.
- Un appui n'importe où, ou le geste retour, saute au panneau. Le geste retour ne quitte jamais la borne ; une seule garde (`useBackGuard`), inchangée.
- Vidéo : **720 × 1290, 24 i/s, 8 s, H.264 + AAC, au plus 2 600 000 octets**, `moov` avant `mdat`, étiquettes sRGB (comme `encode` de `fabrique.sh`).
- Seuils d'usure : année < 1985 → niveau 3 ; 1985 à 2004 → niveau 2 ; ≥ 2005 → niveau 1.
- Arrêt sur la fente : la K7 est immobile et l'appareil fixe pendant **au moins 1,0 s** ; les calques de la page ne sont visibles que dans cet intervalle.
- `kiosk-logic.ts` est à 968 lignes sur un budget de 1000 : toute logique nouvelle va dans un nouveau module.
- Commits locaux seulement, ni push ni PR. Jamais `git add -A`. `next dev` réécrit `AGENTS.md` et `next-env.d.ts` : ne pas les commiter tels quels.
- Vérification à l'écran dans le **vrai Chrome** (le Chromium de Playwright ne lit pas le H.264), sur un build de production, port 3002 (jamais 3000 ; 3001 est celui de Rusmir).

## Review Focus

1. **La vidéo n'est pas entièrement téléchargée quand le serveur répond** → le panneau s'ouvre tout de suite, sans image figée ni attente. (Tâche 5)
2. **Le navigateur refuse la lecture avec le son** → la vidéo repart muette et le signe « son coupé » est visible ; si le muet est refusé aussi, panneau. (Tâche 5)
3. **Le film loué n'a pas de tranche préparée (image 404)** → la tranche de repli s'affiche (titre écrit par la page + usure du niveau de son année), jamais une K7 vide ni une image cassée. (Tâche 6)
4. **Un appui dans la première demi-seconde, ou deux appuis rapprochés** → un seul passage au panneau, pas de double ouverture ni de son qui continue. (Tâches 5 et 7)
5. **Un film sans année connue (`release_year` nul)** → niveau d'usure 2, pas d'erreur. (Tâche 4)

## File Structure

| Fichier | Rôle |
|---|---|
| `tools/devanture-borne/distribution_poses.py` (modifié) | scène : K7 servie et K7 saisie à tranche neutre |
| `tools/devanture-borne/distribution_film.py` (renommé depuis `distribution_essai_film.py`) | le film : chronologie avec l'arrêt allongé, export de `arret.json` |
| `tools/devanture-borne/distribution_tranches_site.py` (créé) | tranches des films pour le site : usure + éclairage cuits |
| `tools/devanture-borne/capture_jaquettes.cjs` (modifié) | capture des tranches de tout le catalogue, à l'échelle normale du générateur |
| `tools/devanture-borne/distribution_sorties.py` (créé) | encode, contrôle le poids, écrit `public/` et `src/data/kiosk-distribution.json` |
| `src/data/kiosk-distribution.json` (généré) | adresse, durée, intervalle de l'arrêt, boîtes de la tranche et de l'afficheur |
| `public/kiosk-distribution.mp4`, `public/kiosk-tranches/*.webp` (générés) | la vidéo, les tranches |
| `src/components/kiosk/kiosk-distribution-logic.ts` (créé) | logique pure : niveau d'usure, adresses, calques visibles à l'instant t, texte de l'afficheur |
| `src/components/kiosk/useDistributionFilm.ts` (créé) | téléchargement, lecture, son refusé, saut |
| `src/components/kiosk/KioskDistributionFilm.tsx` + `.module.css` (créés) | la vidéo et ses calques |
| `src/components/kiosk/KioskView.tsx`, `KioskAction.tsx` (modifiés) | phase `film`, préchargement à la confirmation |

---

### Task 1: La fabrique entre au dépôt, la scène sert une K7 neutre

**Files:**
- Commit tel quel (non suivis aujourd'hui) : `distribution_poses.py`, `distribution_essai_film.py`, `distribution_tranches.py`, `k7_reference.py`, `k7_usure_tranche.py`, `k7_etiquette.py`, `k7_voisines.py`, `capture_jaquettes.cjs`
- Modify: `tools/devanture-borne/distribution_tranches.py`, `tools/devanture-borne/distribution_poses.py`

**Interfaces:**
- Produces: `travail/tex/jaquette-neutre.png` et `jaquette-neutre-usure.png` (mêmes cotes que `jaquette-servie.png`) ; dans la scène, l'objet `K7` (servie) et la K7 de la case saisie portent la tranche neutre ; variable `TRANCHE_NEUTRE = (0.035, 0.035, 0.04)` (couleur linéaire).

- [ ] **Step 1 :** un premier commit des scripts non suivis, sans modification (`git add` fichier par fichier), message `chore(fabrique): scripts de la distribution et de la K7 de référence`.
- [ ] **Step 2 :** dans `distribution_tranches.py`, fabriquer `jaquette-neutre.png` : la toile de « La Mouche » dont les deux tranches (`SPINE1`, `SPINE2`) sont remplacées par un aplat `TRANCHE_NEUTRE` converti en sRGB, usure de niveau 2 cuite par `use()` ; et la ligne 25 de l'atlas (`tranches-etui-usees.png`, la case que le robot saisit) remplacée par le même aplat usé.
- [ ] **Step 3 :** dans `distribution_poses.py`, la matière `jaquette_servie` charge `jaquette-neutre.png` / `jaquette-neutre-usure.png`. Retirer l'assertion « La Mouche seulement ».
- [ ] **Step 4 — vérification :** `python3 distribution_tranches.py` puis rendre les images 60 et 150 (`QUALITE=photo LUMIERE=douce ECHELLE=2 … -- 128 mixte 60,150`). Attendu : dans la vitrine la case saisie est sombre et sans titre, ses voisines gardent leur titre ; à la fente la K7 est sombre et sans titre. Regarder les deux images.
- [ ] **Step 5 :** commit `feat(fabrique): K7 servie et K7 saisie à tranche neutre`.

### Task 2: Le film — arrêt allongé et export de l'arrêt

**Files:**
- Rename + modify: `distribution_essai_film.py` → `distribution_film.py`
- Test: `tests/architecture/distribution-film.test.mjs` (créé ; première moitié)

**Interfaces:**
- Produces: `travail/distribution/arret.json` :
  `{ "debutS": number, "finS": number, "tranche": {"x0","y0","x1","y1"}, "afficheur": {"x0","y0","x1","y1"} }` — boîtes en fractions de l'image (0 à 1, origine en haut à gauche), englobantes des quatre coins projetés par `world_to_camera_view` pendant l'arrêt.
  `travail/distribution/lumiere-tranche.png` : la région de la tranche rendue avec une tranche BLANCHE (albédo 0,8), mêmes cotes que la boîte à l'échelle 2.

Chronologie imposée (remplace les pistes actuelles ; le reste des pistes se décale en proportion) :

| Piste | Valeur |
|---|---|
| K7 immobile, à moitié sortie | à partir de **5,85 s** |
| Appareil fixe sur la fente | de **5,30 s à 7,00 s** |
| Calques de la page (`debutS` → `finS`) | **5,90 s → 6,95 s** |
| Retour à l'écran | 7,00 s → 8,00 s |

- [ ] **Step 1 :** écrire dans le test les assertions sur `arret.json` copié par la tâche 3 dans `src/data/kiosk-distribution.json` : `arret.finS - arret.debutS >= 1.0`, `arret.finS <= 7.0`, boîtes dans [0, 1] avec `x0 < x1`, `y0 < y1`, et la tranche plus large que haute (K7 couchée). Le lancer : il échoue (fichier absent).
- [ ] **Step 2 :** renommer le script, régler les pistes `ALLER`, `TIROIR`, `DESCENTE`, `GLISSE`, `SORTIE`, `OUVRE_VOLET`, `RETOUR` et les trois pistes d'appareil du cadrage `mixte` sur le tableau. Un seul accroc, conservé. Mettre à jour les retards de `travail/sons/mixe3.sh` du même décalage et recopier ce script dans `tools/devanture-borne/sons/` (suivi), les prises `.wav` restant hors dépôt.
- [ ] **Step 3 :** à la fin du script, écrire `arret.json` (coins de la face visible de `K7` et de l'objet de l'afficheur, à l'image `round(6.4 * 24)`), puis rendre `lumiere-tranche.png` (tranche blanche, même image, recadrée).
- [ ] **Step 4 — vérification :** rendre le film entier, encoder à la main, et contrôler sur la planche d'images (une par demi-seconde) que la K7 ne bouge plus entre 5,9 s et 6,95 s. Montrer la vidéo à Rusmir : c'est lui qui juge le rythme.
- [ ] **Step 5 :** commit `feat(fabrique): film de distribution, arrêt allongé sur la fente, export des boîtes`.

### Task 3: Les sorties — vidéo, JSON, contrôle du poids

**Files:**
- Create: `tools/devanture-borne/distribution_sorties.py`
- Generated: `public/kiosk-distribution.mp4`, `src/data/kiosk-distribution.json`
- Test: `tests/architecture/distribution-film.test.mjs` (seconde moitié)

**Interfaces:**
- Produces: `src/data/kiosk-distribution.json` :
  `{ "film": {"src": "/kiosk-distribution.mp4", "largeur": 720, "hauteur": 1290, "dureeMs": 8000, "octets": number}, "arret": {…arret.json…} }`

- [ ] **Step 1 :** compléter le test (lecture binaire, en reprenant `lisMp4` de `tests/architecture/devanture-borne.test.mjs` sans le modifier) : 720 × 1290, `octets <= 2_600_000` et égal à la taille réelle du fichier, `moov` avant `mdat`, **une piste `soun` présente**, `film.dureeMs === 8000`. Échec attendu.
- [ ] **Step 2 :** écrire `distribution_sorties.py` : encodage en deux passes à 2350 kbit/s + AAC 128 kbit/s avec les `setparams` sRGB de `fabrique.sh`, `+faststart` ; `SystemExit` si le poids dépasse 2 600 000 octets ; copie et écriture du JSON.
- [ ] **Step 3 :** `node --test tests/architecture/distribution-film.test.mjs` → PASS.
- [ ] **Step 4 :** commit `feat(fabrique): sorties de la distribution (vidéo, géométrie de l'arrêt)` — avec la vidéo et le JSON.

### Task 4: La logique pure

**Files:**
- Create: `src/components/kiosk/kiosk-distribution-logic.ts`
- Test: `tests/domain/kiosk-distribution-logic.test.mjs`

**Interfaces (toutes exportées, aucun import de valeur) :**
- `wearLevel(year: number | null | undefined): 1 | 2 | 3`
- `spineSrc(tmdbId: number): string` → `/kiosk-tranches/<tmdbId>.webp`
- `fallbackSpineSrc(level: 1 | 2 | 3): string` → `/kiosk-tranches/repli-<level>.webp`
- `fallbackWearSrc(level: 1 | 2 | 3): string` → `/kiosk-tranches/usure-<level>.webp`
- `type Box = { x0: number; y0: number; x1: number; y1: number }`
- `type Arret = { debutS: number; finS: number; tranche: Box; afficheur: Box }`
- `type DistributionFilm = { src: string; largeur: number; hauteur: number; dureeMs: number; octets: number }` (la forme de `src/data/kiosk-distribution.json`)
- `overlayVisible(tMs: number, arret: Pick<Arret, 'debutS' | 'finS'>): boolean`
- `displayLines(title: string): [string, string]` — `['RETIREZ VOTRE K7', titre]`, le titre en capitales, coupé à 20 caractères avec `…` au 20ᵉ s'il dépasse (le défilement du § 8 n'est pas fait : l'arrêt dure une seconde).
- `boxStyle(box: Box): { left: string; top: string; width: string; height: string }` en pourcentages.

- [ ] **Step 1 :** tests : `wearLevel(1984) === 3`, `(1985) === 2`, `(2004) === 2`, `(2005) === 1`, `(null) === 2`, `(undefined) === 2` ; `overlayVisible(5899, {debutS: 5.9, finS: 6.95}) === false`, `(5900) === true`, `(6950) === false` ; `displayLines('Il était une fois dans l\'Ouest')[1].length === 20` et finit par `…` ; `displayLines('Get Out')` → `['RETIREZ VOTRE K7', 'GET OUT']` ; `boxStyle({x0: .25, y0: .5, x1: .75, y1: .6})` → `{left: '25%', top: '50%', width: '50%', height: '10%'}` (tolérance d'arrondi : comparer les nombres). Échec attendu.
- [ ] **Step 2 :** implémenter. **Step 3 :** PASS. **Step 4 :** commit `feat(borne): logique de la distribution filmée`.

### Task 5: Le crochet de lecture

**Files:**
- Create: `src/components/kiosk/useDistributionFilm.ts`
- Test: `tests/domain/kiosk-wiring.test.mjs` (ajouts)

**Interfaces:**
- `useDistributionFilm({ url, durationMs, load, onDone }): { videoRef, src: string | null, phase: 'idle' | 'starting' | 'playing', muted: boolean, timeMs: number, start(): boolean, skip(): void }`
- Modèle : `src/components/exterior/useApproachFilm.ts` — mêmes gardes (400 ms pour la première image, durée + 1,5 s), même téléchargement en blob quand `load` devient vrai, `onDone` appelé **une seule fois**.
- Différences imposées :
  - `start()` tente `play()` avec le son ; si la promesse est rejetée, pose `video.muted = true`, `muted = true`, retente ; second rejet → `onDone()`.
  - `skip()` agit à tout moment de la phase `playing` (pas de délai de 500 ms : ici l'appui ne vient pas d'ouvrir le film), met la vidéo en pause (le son s'arrête) et appelle `onDone()`.
  - `timeMs` suit `requestVideoFrameCallback` (repli : `timeupdate`).
  - `start()` rend `false` sans rien jouer si `src` est nul, si `prefers-reduced-motion: reduce`, ou si un film est en cours.

- [ ] **Step 1 :** tests statiques dans `kiosk-wiring` (style du fichier) : le crochet contient `prefers-reduced-motion`, `muted = true` dans une branche `catch`, `pause()` dans `skip`, `URL.revokeObjectURL` ; il n'importe ni `three` ni le générateur. Échec attendu.
- [ ] **Step 2 :** implémenter. **Step 3 :** PASS. **Step 4 :** commit `feat(borne): lecture de la vidéo de distribution, repli muet`.

### Task 6: Les tranches préparées

**Files:**
- Modify: `tools/devanture-borne/capture_jaquettes.cjs`
- Create: `tools/devanture-borne/distribution_tranches_site.py`
- Generated: `public/kiosk-tranches/<tmdbId>.webp`, `repli-{1,2,3}.webp`, `usure-{1,2,3}.webp`
- Test: `tests/architecture/distribution-film.test.mjs` (ajout)

**Interfaces:**
- Consumes: `lumiere-tranche.png` et la boîte `tranche` (tâche 2) ; `masque(graine, niveau)`, `niveau_du_film(annee)` de `k7_usure_tranche.py`.
- Produces: une image par film, **couchée comme la K7 dans la fente**, au rapport exact de la boîte `tranche`, 900 points de large, WebP qualité 82 : la tranche du générateur, usée au niveau de son année, multipliée par la lumière de l'arrêt. `repli-N.webp` : la tranche neutre éclairée ; `usure-N.webp` : le seul papier à nu, sur fond transparent, déjà éclairé.

- [ ] **Step 1 :** test : pour chaque `tmdb_id` de `src/data/mock/films.json`, `public/kiosk-tranches/<id>.webp` existe et pèse moins de 60 000 octets ; les six fichiers de repli existent. Échec attendu.
- [ ] **Step 2 :** `capture_jaquettes.cjs` : prendre la liste des films à `/api/films` (ou des identifiants en argument), ne garder que la découpe `SPINE2` de la toile couleur (à l'échelle normale du générateur, **sans toucher à `RENDER_SCALE`**), reprendre là où il s'est arrêté (un fichier déjà écrit n'est pas refait).
- [ ] **Step 3 :** `distribution_tranches_site.py` : redresser la découpe (miroir puis rotation, comme `distribution_tranches.py`), cuire l'usure (`use()`), multiplier par `lumiere-tranche.png`, écrire. Années lues dans `zone.db` ; année absente → niveau 2.
- [ ] **Step 4 — vérification à l'œil :** poser `9426.webp` sur l'image 150 du film neutre, dans la boîte, et la comparer à l'image 150 de l'essai 7 (« La Mouche » rendue par Blender). Elles doivent se confondre à distance de lecture ; sinon corriger la lumière avant d'aller plus loin. Montrer la comparaison à Rusmir.
- [ ] **Step 5 :** test → PASS ; commit `feat(fabrique): tranches des films pour la borne` (images comprises, ajoutées par dossier nommé, pas `-A`).

### Task 7: Le composant et la phase `film`

**Files:**
- Create: `src/components/kiosk/KioskDistributionFilm.tsx`, `KioskDistributionFilm.module.css`
- Modify: `src/components/kiosk/KioskView.tsx` (état `distribution` L289, `onRented` L303, `onBack` L593-629, rendu L795-796), `src/components/kiosk/KioskAction.tsx` (L127-183 : signaler l'ouverture de la confirmation), `src/components/kiosk/kiosk-logic.ts` (`kioskBackAction`, un cas)
- Test: `tests/domain/kiosk-wiring.test.mjs`, `tests/domain/kiosk-logic.test.mjs`

**Interfaces:**
- `KioskDistributionFilm(props: { film: DistributionFilm; arret: Arret; title: string; tmdbId: number; year: number | null; hook: ReturnType<typeof useDistributionFilm> })`
- `distribution.phase` devient `'waiting' | 'film' | 'ready'`.
- `kioskBackAction` rend `'skip-film'` quand la phase est `film`.
- `KioskAction` reçoit `onConfirmOpen?: () => void`, appelé quand la confirmation s'ouvre : `KioskView` passe alors `load` à vrai (téléchargement « au plus tard à la confirmation », § 10).

Comportement imposé :
- `onRented(filmId)` : `if (!hook.start()) → phase 'ready'` ; sinon phase `film`, et `onDone` pose `ready` (avec `fresh: true`).
- Le composant est monté **hors de `.screen`**, au niveau de `KioskRotate`, et couvre la borne ; il apparaît en fondu de 280 ms sur l'écran vivant (raccord), et tout le reste garde l'inertie déjà posée par `distribution !== null`.
- Calques, visibles seulement si `overlayVisible(hook.timeMs, arret)` : la tranche (`<img src={spineSrc(tmdbId)}>` dans `boxStyle(arret.tranche)` ; sur `onError`, `repli-N` + le titre en texte + `usure-N` par-dessus) et l'afficheur (fond opaque sombre + `displayLines(title)` dans `boxStyle(arret.afficheur)`, police à matrice de points déjà chargée par la borne s'il y en a une, sinon `VT323`).
- `onClick` sur tout le composant → `hook.skip()`.
- Si `hook.muted` : un pictogramme « son coupé » de 24 px dans le coin haut droit, `aria-label="Son coupé"`, sans action.
- Aucun `<canvas>`, aucun filtre, aucun mode de fusion.

- [ ] **Step 1 :** tests : `kioskBackAction` avec une phase `film` → `'skip-film'` ; statiques : `KioskView` contient la phase `'film'`, `onRented` passe par `start()`, le composant est rendu hors de `.screen`, il contient `aria-label="Son coupé"` et `onError`, et le test « DOM pur » existant passe toujours sur le nouveau fichier. Échec attendu.
- [ ] **Step 2 :** implémenter. **Step 3 :** `node --test tests/domain/kiosk-wiring.test.mjs tests/domain/kiosk-logic.test.mjs` → PASS, puis `npm run test:phase` : le nombre d'échecs ne dépasse pas celui relevé AVANT la tâche (le relever au début, les échecs connus étant antérieurs).
- [ ] **Step 4 :** commit `feat(borne): la distribution filmée entre l'attente et le panneau`.

### Task 8: Vérification à l'écran et documentation

**Files:**
- Create: `.superpowers/sdd/2026-11-22-borne-distribution-livraison-2/verification/verif.cjs` (hors dépôt, comme les précédentes)
- Modify: `AGENTS.md` (section « Borne de location » : la phrase « la livraison 2 … viendra s'insérer » devient la description de ce qui est fait ; section fabrique : les nouveaux scripts et l'ordre de lancement)

- [ ] **Step 1 :** build de production servi sur 3002 (recette de `borne-recettes-verification`), vrai Chrome, compte de test. Parcours contrôlés, capture à l'appui pour chacun :
  1. location réussie → vidéo → à 6,4 s la tranche du film loué et « RETIREZ VOTRE K7 / titre » sont dans leurs boîtes → panneau ;
  2. un film d'une autre époque (un de 1968, un de 2014) : l'usure diffère ;
  3. appui pendant la vidéo → panneau immédiat, plus de son ;
  4. geste retour pendant la vidéo → panneau, on reste dans la borne ;
  5. `prefers-reduced-motion` → panneau direct ;
  6. vidéo bloquée par la page de test (requête interceptée) → panneau direct ;
  7. tranche absente (image interceptée en 404) → tranche de repli avec le titre ;
  8. lecture avec son refusée (politique de lecture automatique forcée au lancement de Chrome) → vidéo muette + signe « son coupé » ;
  9. location refusée → message d'erreur, pas de vidéo ;
  10. raccord : capture de l'écran vivant juste avant, de la première image juste après — pas de saut de cadre.
- [ ] **Step 2 :** montrer à Rusmir les captures 1, 2, 8 et 10, en disant ce qui est provisoire (le corps de la borne dans le site est encore le dessin, pas l'image Blender).
- [ ] **Step 3 :** `AGENTS.md`, puis commit `docs(borne): distribution filmée — règles et fabrique`.

**Non couvert par ce plan (à dire à Rusmir, pas à faire) :** le vrai téléphone et Safari/iOS (lecture avec son, première image d'une vidéo) ; le cadrage sur PC ; une variante plus fine pour les grands écrans ; la tôle de la fente et le bandeau violet ; les films du catalogue de PRODUCTION qui ne sont pas dans la base locale (l'outil de la tâche 6 devra tourner contre ce catalogue).
