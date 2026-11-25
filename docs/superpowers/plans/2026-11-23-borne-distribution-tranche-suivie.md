# Borne 24/7 — distribution de la K7 : la tranche suit la K7, l'écran est le vrai — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dans la vidéo de distribution, la K7 porte la tranche du film loué de la vitrine à la fente, sans défaut d'illusion, et l'écran de la borne est le vrai écran ; le tout prouvé par des tests de bout en bout dans le navigateur.

**Architecture:** la vidéo (une seule pour tous les films) est un décor. À chaque image qu'elle présente, la page place trois calques d'après des données rendues par la fabrique : la tranche du film (image par film, non éclairée), découpée par le cache de l'image (planche d'images en `mask-image`), puis l'ombre de l'image (planche de voiles noirs) ; et elle met le vrai écran de la borne à l'échelle dans la boîte de l'écran filmé. Les styles sont posés hors de React.

**Tech Stack:** Blender 5.3, Python (numpy, PIL), ffmpeg ; Next.js 16, React 19, CSS Modules ; `node --test` ; Playwright (`playwright-core`, vrai Chrome) pour le bout en bout.

**Spec:** `docs/superpowers/specs/2026-11-17-borne-distribution-k7-design.md`, **§ 13** (prime sur le § 12, qui prime sur les § 3 à 6). Ce plan remplace les tâches 6 et 7 du plan `2026-11-22-borne-distribution-livraison-2.md` ; ses tâches 1 à 5 restent (K7 neutre, chronologie, sorties, logique, crochet).

## Global Constraints

- Sous `src/components/kiosk/` : ni `<canvas>`, ni `three`, ni filtre CSS, ni `backdrop-filter`, ni mode de fusion. `mask-image` et les transformations sont permis.
- Une seule vidéo pour tous les films, au plus **2 600 000 octets**, 720 × 1290, 24 i/s, 8 s (193 images), avec son.
- La vidéo ne fait jamais attendre ; une location refusée ne joue rien ; appui ou geste retour → panneau ; « moins de mouvement » → panneau.
- Aucun rendu React par image de la vidéo : les calques se placent par mutation directe de `style`, dans le rappel `requestVideoFrameCallback`.
- **Avant tout rendu long** (le film, 193 images, ~1 h 35) : montrer à Rusmir les images clés du changement et attendre son accord.
- Seuils d'usure : < 1985 → 3 ; 1985-2004 → 2 ; ≥ 2005 → 1 ; sans année → 2.
- Planches d'images : aucune dimension au-delà de 4096 points ; poids total des deux planches ≤ 600 000 octets.
- Vérification et tests de bout en bout : build de production, port 3002, vrai Chrome (`channel: 'chrome'`). Commits locaux, ni push ni PR ; jamais `git add -A`.

## Review Focus

1. **Une image de la vidéo sautée ou présentée en retard** (téléphone lent) → les calques sont placés sur l'image RÉELLEMENT présentée (`mediaTime`), jamais sur l'horloge : pas de tranche qui traîne derrière la K7. (Tâche 4, test de bout en bout de la tâche 6)
2. **Le suivi ou une planche n'est pas arrivé quand la vidéo part** → pas de vidéo du tout (panneau directement), jamais une K7 noire sans tranche. (Tâche 3)
3. **Film sans tranche préparée** → repli lisible pendant tout le trajet (tranche neutre + titre), découpé et ombré comme une vraie. (Tâche 4)
4. **Fenêtre redimensionnée ou téléphone tourné pendant la vidéo** → le cadre et l'écran se recalent, ou la vidéo passe au panneau ; jamais un écran de borne laissé déformé après la fin. (Tâche 5)
5. **Fin, saut ou panne de la vidéo** → l'écran de la borne revient exactement à sa place et à sa taille (aucune transformation résiduelle). (Tâche 5)

## File Structure

| Fichier | Rôle |
|---|---|
| `tools/devanture-borne/distribution_film.py` (modifié) | `SUIVI`, `PASSES`, écran éteint (`ECRAN=eteint`) |
| `tools/devanture-borne/distribution_planches.py` (créé) | des passes → planche de caches, planche d'ombres, `suivi` compact |
| `tools/devanture-borne/distribution_tranches_site.py` (modifié) | tranches par film NON éclairées, debout |
| `tools/devanture-borne/distribution_sorties.py` (modifié) | écrit aussi le suivi et les planches |
| `public/kiosk-distribution-suivi.json`, `public/kiosk-distribution-caches.webp`, `public/kiosk-distribution-ombres.webp` (générés) | données communes à tous les films |
| `src/components/kiosk/kiosk-distribution-logic.ts` (modifié) | types du suivi, image à l'instant t, styles des calques, transformation de l'écran |
| `src/components/kiosk/useDistributionFilm.ts` (modifié) | charge aussi le suivi et les planches ; rappel par image |
| `src/components/kiosk/KioskDistributionFilm.tsx` + `.module.css` (réécrits) | la vidéo et les calques de la K7 |
| `src/components/kiosk/KioskView.tsx` (modifié) | l'écran de la borne suit l'écran filmé |
| `tests/e2e/borne-distribution.e2e.cjs` (créé) + script npm `test:e2e:borne` | bout en bout dans le vrai Chrome |

---

### Task 1: La fabrique — suivi, passes, planches

**Files:** Modify `distribution_film.py` (commiter `SUIVI`, `PASSES`, `LISTE`, déjà écrits) ; Create `distribution_planches.py` ; Test `tests/architecture/distribution-film.test.mjs`.

**Interfaces — Produces :**
- `public/kiosk-distribution-suivi.json` :
  `{ "images": 193, "ips": 24, "debout": {"cellule": [w, h], "colonnes": n, "de": i0, "a": i1}, "couchee": {…}, "planche": [W, H], "lmax": number, "pas": [ {"t": [x0,y0,x1,y1] | null, "c": 0|1, "e": [x0,y0,x1,y1]} × 193 ] }`
  — `t` : boîte de la tranche (fractions de l'image, `null` si la K7 est hors champ) ; `c` : 1 = couchée ; `e` : boîte de l'écran.
- `kiosk-distribution-caches.webp` (alpha) et `kiosk-distribution-ombres.webp` (noir + alpha) : une cellule par image, rangées par orientation ; la cellule de l'image `i` est à la colonne `(i − de) % colonnes`, ligne `⌊(i − de) / colonnes⌋` de son bloc ; le bloc « couchée » est sous le bloc « debout ».
- Opacité de l'ombre : `1 − (l / lmax)^(1/2,4)`, `l` = luminance linéaire de la passe blanche divisée par 0,8.

- [ ] **Step 1 :** tests : le suivi a 193 pas ; toute boîte est dans [−0,5 ; 1,5] avec `x0 < x1`, `y0 < y1` ; `c` passe de 0 à 1 une seule fois ; les deux planches existent, ≤ 4096 points de côté, ≤ 600 000 octets à elles deux, et leurs dimensions sont celles qu'annonce `planche`. Échec attendu.
- [ ] **Step 2 :** `distribution_planches.py` : lit `suivi.json`, `passes/` ; recadre chaque passe sur la boîte de la tranche ; cellules debout 48 × 336, couchées 448 × 64 ; 16 colonnes debout, 4 couchées.
- [ ] **Step 3 :** `distribution_sorties.py` copie le suivi et les planches dans `public/`. Test → PASS.
- [ ] **Step 4 :** commit.

### Task 2: Les tranches par film, non éclairées

**Files:** Modify `distribution_tranches_site.py` ; Test (même fichier de test).

- Produit `public/kiosk-tranches/<tmdb>.webp` : **debout**, 153 × 1068, usure cuite, multipliée par `lmax` (bornée à 1) ; `repli-N.webp` : la tranche neutre, même format ; `usure-N.webp` supprimés (l'usure du repli est cuite dans `repli-N`).
- [ ] **Step 1 :** test : chaque tranche fait 153 × 1068 (en-tête WebP lu en binaire) et pèse moins de 60 000 octets ; `usure-*.webp` n'existent plus. Échec. **Step 2 :** réécrire. **Step 3 :** PASS. **Step 4 :** commit.

### Task 3: La logique pure et le chargement

**Files:** Modify `kiosk-distribution-logic.ts`, `useDistributionFilm.ts` ; Tests `tests/domain/kiosk-distribution-logic.test.mjs`, `kiosk-wiring.test.mjs`.

**Interfaces :**
- `type Suivi` (la forme du JSON ci-dessus) ; `frameAt(mediaTimeS: number, suivi: Pick<Suivi, 'images' | 'ips'>): number` (arrondi, borné à [0, images − 1]).
- `spineLayerStyle(pas: SuiviPas): { left; top; width; height; transform } | null` — la boîte en pourcentages ; couchée : l'image debout est tournée de −90° dans la boîte.
- `sheetPosition(i: number, suivi: Suivi): { size: string; position: string }` — `mask-size` / `mask-position` (et `background-*` pour l'ombre) de la cellule de l'image `i`.
- `screenTransform(ecranFilme: Box, cadre: DOMRectLike, ecranBorne: DOMRectLike): string` — `translate(…px, …px) scale(…)` à appliquer à l'écran de la borne (origine en haut à gauche).
- `stageRect(ecran0: Box, ecranBorne: DOMRectLike, ratio: number): DOMRectLike` — le cadre de la vidéo tel que l'écran filmé de l'image 0 tombe sur l'écran de la borne.
- Suppressions : `overlayVisible`, `displayLines`, `fallbackWearSrc`, type `Arret` (l'arrêt n'est plus lu par le site).
- Le crochet charge **vidéo + suivi + deux planches** ; `start()` rend `false` tant que l'un des quatre manque. Il prend `onFrame(i: number)` (appelé à chaque image présentée, hors rendu React) et n'expose plus `timeMs`.

- [ ] **Step 1 :** tests des cinq fonctions (valeurs : `frameAt(6.4, {images: 193, ips: 24}) === 154` ; `frameAt(99, …) === 192` ; cellule 0 et cellule 17 d'un bloc à 16 colonnes ; `stageRect` puis `screenTransform` de l'image 0 → `translate(0px, 0px) scale(1)` à 0,01 près) et test statique du crochet (quatre chargements, `start` faux si l'un manque, `onFrame` dans le rappel d'image). Échec. **Step 2 :** implémenter. **Step 3 :** PASS. **Step 4 :** commit.

### Task 4: Le composant de la K7

**Files:** Rewrite `KioskDistributionFilm.tsx`, `.module.css` ; Test `kiosk-wiring.test.mjs`.

- Calques, dans le cadre de la vidéo : `.spine` (boîte de la tranche) contenant l'image du film (ou le repli + le titre écrit) puis l'ombre ; le cache en `mask-image` sur `.spine`. Un seul rappel `onFrame` pose `left/top/width/height/transform`, `mask-position`, `background-position`, et masque `.spine` quand `t` est `null`.
- L'image de la tranche est demandée dès le début du téléchargement de la vidéo (elle est prête avant la réponse du serveur) ; `onError` → repli.
- [ ] **Step 1 :** tests statiques : `mask-image` présent, ni `<canvas>` ni `filter:` ni `mix-blend-mode` ; pas de `useState` alimenté par image ; `onError` → repli ; signe « son coupé » conservé. Échec. **Step 2 :** implémenter. **Step 3 :** PASS + `tsc`. **Step 4 :** commit.

### Task 5: Le vrai écran dans l'écran filmé

**Files:** Modify `KioskView.tsx`, `KioskView.module.css`, `KioskDistributionFilm.tsx` ; Test `kiosk-wiring.test.mjs`.

- La vidéo passe SOUS l'écran de la borne et au-dessus du reste : pendant la phase `film`, l'écran (`.ks`) reçoit `transform: screenTransform(...)` à chaque image et une classe qui le place au-dessus de la vidéo ; le reste de la borne est couvert.
- À la fin (fin, saut, panne) : `transform` et la classe sont retirés dans le même passage que le changement de phase.
- `resize` / `orientationchange` pendant la vidéo → `skip()`.
- [ ] **Step 1 :** tests statiques (transformation posée par référence, retirée en fin ; écouteur `resize` qui saute). Échec. **Step 2 :** implémenter. **Step 3 :** PASS. **Step 4 :** commit.

### Task 6: Tests de bout en bout dans le navigateur

**Files:** Create `tests/e2e/borne-distribution.e2e.cjs`, `tests/e2e/outils.cjs` ; Modify `package.json` (`"test:e2e:borne": "node tests/e2e/borne-distribution.e2e.cjs"`), `AGENTS.md`.

Sur le build de production servi sur 3002, vrai Chrome, téléphone 412 × 915 (et 360 × 640), compte de test :
1. location réussie → la vidéo joue jusqu'au bout → panneau « Votre K7 est prête » ;
2. **illusion** : à six instants (vitrine au repos, saisie, descente derrière l'autocollant, apparition dans la fente, sortie, arrêt), capture de la page comparée à l'image de référence fabriquée par collage (`colle2.py` porté dans `tests/e2e/reference/`, six images 720 × 1290 par film) : écart moyen dans la boîte de la K7 **≤ 6 niveaux sur 255**, et la tranche à **≤ 1,5 point** de sa boîte ;
3. **écran** : à l'image 0 l'écran de la borne n'a pas bougé (≤ 0,5 point) ; à trois instants il est dans la boîte de l'écran filmé (≤ 1 point) ; après la fin, aucune transformation ne reste ;
4. second film d'une autre époque : autre tranche ;
5. appui → panneau ; 6. geste retour → panneau, toujours dans la borne ; 7. mouvement réduit → panneau ; 8. vidéo, suivi ou planche bloqués → panneau, pas de vidéo ; 9. tranche absente → repli avec le titre, pendant tout le trajet ; 10. son refusé → muette + signe ; 11. location refusée → message, pas de vidéo ; 12. aucune erreur de page.

- [ ] **Step 1 :** écrire le test ; le lancer contre le build AVANT les tâches 4-5 terminées n'a pas de sens : le lancer d'abord avec les calques coupés (drapeau de requête du test qui bloque les planches) pour voir échouer 2 et 3. **Step 2 :** tout au vert. **Step 3 :** `AGENTS.md` (remplacer le paragraphe de la tranche posée à l'arrêt), commit.

### Task 7: Le film à écran éteint

- [ ] **Step 1 :** `ECRAN=eteint` dans `distribution_film.py` (écran noir légèrement lumineux, sa vitre conservée). Rendre **trois images clés** (0, 60, 150), y coller l'écran de la borne capturé et la tranche, **les montrer à Rusmir et attendre son accord**.
- [ ] **Step 2 :** après accord seulement : rendu du film (~1 h 35), `PASSES=tout`, `SUIVI=1`, planches, sorties ; tests et bout en bout au vert ; lui montrer la vidéo jouée dans la borne (capture d'écran vidéo de la page).
- [ ] **Step 3 :** commit.

**Hors de ce plan :** le catalogue de production (capture des tranches contre une copie de la base de production) ; Safari/iOS et le vrai téléphone ; le cadrage sur PC (écran 2:3) ; la tôle de la fente, le bandeau violet.
