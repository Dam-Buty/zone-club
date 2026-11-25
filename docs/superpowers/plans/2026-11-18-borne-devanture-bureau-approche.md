# Borne sur la devanture du bureau et approche filmée (lot 3, livraison B) — plan d'exécution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Rusmir a choisi l'exécution **en ligne** (superpowers:executing-plans, un relecteur neuf à la fin) pour tous les plans de la borne.

**Goal:** La devanture du bureau montre la borne validée, animée comme aujourd'hui ; choisir la borne joue, sur le bureau comme sur le téléphone, un film de 3 secondes où l'on avance jusqu'à elle, puis l'interface apparaît sur l'écran filmé.

**Architecture:** La fabrique `tools/devanture-borne/` gagne une variante « bureau » à côté de la variante « mobile », une passe « masque » et une étape « approche » qui rend le film image par image (Blender pour la borne, recalage exact du mur de la photo) et l'encode. Côté site, chaque devanture est une « scène » aux proportions de son image ; un crochet React unique charge et joue le film dans cette scène, une fonction pure amène l'écran filmé sur l'écran de l'interface, et `App` fait apparaître la borne en fondu par-dessus la dernière image. Le zoom de la livraison A est retiré.

**Tech Stack:** Python 3.11 (PIL, numpy, scipy), Blender 5.3 (Cycles, Metal), ffmpeg 8 (libx264), Next.js 16 / React 19, CSS Modules, Three.js (devanture WebGL), tests `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-18-borne-devanture-bureau-design.md` (à lire en entier) ; document parent `docs/superpowers/specs/2026-11-16-borne-location-design.md`.

## État de départ (à lire avant la tâche 1)

- Worktree `~/projetsperso/video-club-webgpu-borne`, branche `feat/borne-location`, HEAD `08444f8`, **commits locaux uniquement, ni push ni PR**.
- Essai validé du bureau, hors dépôt : `.superpowers/lot3-essai-pc/` — image `essai3-compo.png` (5782 × 3072), `geometrie.json`, `fond_pc.py`, `ecran-pc.png`, `storefront-origine.jpeg`, `storefront-mask-origine.png`, et le film validé `anim/approche-borne-essai1.mp4` avec ses scripts `anim_camera.py`, `anim_rendu.py`, `anim_compo.py`. Récit : `REPRISE.md` du même dossier (**à lire en entier**).
- Écarts entre l'essai et la fabrique (relevés le 18/11) : `textures.py`, `neon.py`, `neon_graphe.py` identiques ; `borne.py` diffère par les marges à l'échelle (`ECH = PPM / 549`), l'axe de l'appareil (`camera.axe_px`), la zone de la passe « mur » (`mur.zone_px`) et la texture de l'écran ; `compo.py` par cette zone et par la pluie. Tous ces écarts ont une valeur par défaut qui redonne le mobile.
- Écran de `KioskView` sur PC, **mesuré à l'écran** le 18/11 (build de production, `[class*="KioskView_ks__"]`) : hauteur `h = min(0,94 × vh, 1100)`, largeur `w = h × 2/3`, bord gauche `0,62 × w + 62` px (le corps de la borne est collé à gauche de la fenêtre : bordure 3, marge 26, vitrine `0,62 × w`, écart 20, cadre 13), haut `(vh − h) / 2`. Relevés : 1280 × 720 → 341,7 / 21,6 / 451,2 × 676,8 ; 1440 × 900 → 411,7 / 27 / 564 × 846 ; 1920 × 1080 et 2560 × 1080 → 481,6 / 32,4 / 676,8 × 1015,2 ; 2560 × 1440 → 516,7 / 170 / 733,3 × 1100.
- Écran de `KioskView` sur téléphone : `kioskScreenBox(vw, vh)` de `src/components/exterior/storefront-layout.ts` (inchangé).
- Site, aujourd'hui : `ExteriorView.tsx` (443 lignes) — branche mobile avec scène, zoom (`kioskZoom`, `closeUpReady`, `finishKioskZoom`, voile) ; branche bureau avec `contentArea` (boîte de l'image dans la fenêtre), zone de la porte en pourcentages écrits dans la feuille de style, bouton provisoire `kioskButton`. `ExteriorScene.ts` : `TARGET_ASPECT_RATIO = 5632 / 3072` (ligne 684), constructeur `(container, onStorefrontShown?)`. `App.tsx` : `openKiosk` (ligne 592), `releaseInteriorForKiosk`, rendu de la devanture quand `currentScene === 'exterior'`, de la borne quand `isKiosk`.
- Recettes de vérification (build de production, serveur autonome port 3002, Playwright) : mémoire `borne-recettes-verification.md`.

## Global Constraints

- **`KioskView` ne change pas.** L'image de la devanture mobile, sa mise en page (hors champ `zoom` → `approche`), sa barre de boutons ne changent pas.
- **Le GPU et les chargements du vidéoclub sont libérés dès le choix de la borne** (`onKioskIntent`), avant toute animation.
- **Jamais d'attente, jamais d'écran noir** : film pas chargé, lecture refusée, erreur → la borne s'ouvre aussitôt par le fondu d'apparition.
- **Jamais de lecteur vidéo tiers** : balise `<video muted playsInline>` et fichier servi par le site. Pas de son.
- `prefers-reduced-motion: reduce` : pas de film.
- Règles de la borne : pas de bouton `disabled` ; pas de `backdrop-filter` ; textes en français.
- Film : **3 secondes, 30 images par seconde, 91 images**, H.264 `yuv420p`, sans piste son, `+faststart`, couleurs BT.709. Bureau **1920 × 1020, ≤ 2 621 440 octets** ; mobile **720 × 1290, ≤ 1 572 864 octets**.
- Réglages du trajet validés (bureau) : accélération 0,55 s, freinage 1,10 s, balancement 5 mm à 1,8 Hz, obturateur 0,5 image, 7 sous-images de flou, appareil à 6 m du mur au départ, qui ne tourne jamais.
- Libellés : indicateur de la borne **« BORNE LOCATION ▼ »** ; porte **« PUSH ▼ »** inchangé.
- Noms conservés : `public/storefront.jpeg`, `public/storefront-mask.png`, `public/storefront-mobile.{webp,jpeg}`, `src/data/storefront-mobile.json`.
- Tests : `node --test` sur des `.test.mjs` ; un module TS importé par un test ne doit avoir **aucun import de valeur**. Base connue : 9 échecs préexistants (budget de taille, 6 tests d'intégration, P-01, sf-island-fill). Commande complète : `node --test "tests/**/*.test.mjs"`.
- Poste de travail : `grep`, `rg`, `sed`/`awk` par motif refusés (lire, ou chercher en Python) ; jamais `git add -A` ; serveur de vérification sur le **port 3002** ; ne pas lancer `next dev` ; le Chromium de Playwright **ne lit pas le H.264** : toute vérification du film passe par `chromium.launch({ channel: 'chrome' })`.
- Deux passages de la fabrique diffèrent par le bruit de rendu : ne commiter une image refaite que si quelque chose a réellement changé (sinon `git checkout --` sur les sorties).

## Review Focus

1. **Film pas encore chargé au moment du choix** (réseau lent, fichier bloqué) : la borne s'ouvre tout de suite, sans image noire ni attente.
2. **Clic pendant le film, double clic, porte choisie pendant le film** : une seule transition ; un clic pendant le film mène à l'arrivée ; jamais la borne puis le vidéoclub.
3. **Retour par « Quitter » puis second choix de la borne** : la devanture revient entière et animée, le film rejoue depuis sa première image.
4. **Fenêtres hors gabarit** : 2560 × 1440 (écran de l'interface plafonné à 1100 px), 2560 × 1080 (bandes latérales), téléphone bas (≤ 760 px de haut), et **bureau sans WebGL** (devanture fixe du mobile, mais interface de la borne au gabarit PC) : l'écran filmé arrive sur l'écran de l'interface, rien ne saute.
5. **Animations réduites** : aucun film, sur bureau comme sur mobile.

---

### Task 1: La fabrique à variantes (le mobile ressort inchangé)

**Files:**
- Create: `tools/devanture-borne/variante.py`
- Modify: `tools/devanture-borne/{fond,textures,neon,borne,compo,sorties}.py`, `fabrique.sh`, `.gitignore`, `geometrie.json`
- Test: `tests/architecture/devanture-borne.test.mjs`

**Interfaces:**
- Produces: `variante.py` — `VARIANTE` (variable d'environnement `DEVANTURE`, `mobile` par défaut), `ICI`, `G` (géométrie lue : `geometrie.json` pour `mobile`, `geometrie-<variante>.json` sinon), `D` (intermédiaire : `travail/` pour `mobile`, `travail-<variante>/` sinon), `CACHE = ICI / 'travail' / 'tmdb-cache'` (commun), `SOURCES = ICI / 'sources'`. En ligne de commande : `python3 variante.py <clé.pointée>` écrit la valeur de la géométrie (ex. `fond`, `site.zoom`), code 1 si absente.
- Produces: `DEVANTURES="mobile bureau" sh tools/devanture-borne/fabrique.sh [éch. borne] [éch. mur]` — une boucle sur les variantes (par défaut toutes celles dont la géométrie existe), chacune avec `DEVANTURE=<variante>`.
- Produces: clés de géométrie nouvelles, avec les valeurs actuelles du mobile dans `geometrie.json` : `fond` (`"fond.py"`), `facade.ecran_image` (`"gyro-face.png"`), `pluie` (`{ "densite": 0.00016, "longueur": [10, 34], "pente": 0.06, "force": [0.05, 0.22], "epaisseur": 1, "flou": 0.6 }`).

- [ ] **Step 1: Écrire les tests qui échouent** (ajoutés à `tests/architecture/devanture-borne.test.mjs`)

```js
test('VARIANTES: chaque script lit sa géométrie et son dossier par variante.py', () => {
  assert.ok(existsSync(path.join(T, 'variante.py')));
  for (const f of ['fond.py', 'textures.py', 'neon.py', 'borne.py', 'compo.py', 'sorties.py']) {
    const src = readFileSync(path.join(T, f), 'utf8');
    assert.ok(src.includes('variante'), `${f} : variante`);
    assert.ok(!src.includes("'geometrie.json'") && !src.includes("/ 'travail'"), `${f} : chemin en dur`);
  }
  const sh = readFileSync(path.join(T, 'fabrique.sh'), 'utf8');
  assert.ok(sh.includes('DEVANTURE='), 'la fabrique boucle sur les variantes');
  assert.ok(readFileSync(path.join(T, '.gitignore'), 'utf8').includes('travail-*/'));
});

test('VARIANTES: la géométrie du mobile porte ses réglages de pluie, de fond et d\'écran', () => {
  const g = JSON.parse(readFileSync(path.join(T, 'geometrie.json'), 'utf8'));
  assert.equal(g.fond, 'fond.py');
  assert.equal(g.facade.ecran_image, 'gyro-face.png');
  assert.deepEqual(g.pluie, { densite: 0.00016, longueur: [10, 34], pente: 0.06, force: [0.05, 0.22], epaisseur: 1, flou: 0.6 });
});
```

- [ ] **Step 2: Lancer, constater l'échec** — `node --test tests/architecture/devanture-borne.test.mjs` → les deux tests échouent (variante.py absent).
- [ ] **Step 3: Écrire `variante.py`** (interface ci-dessus). Sous Blender (`--factory-startup`), `borne.py` l'importe après `sys.path.insert(0, str(Path(__file__).resolve().parent))`.
- [ ] **Step 4: Porter dans `borne.py` et `compo.py` les écarts de l'essai PC** : `ECH = PPM / 549` sur les trois marges du cadre de rendu ; `AXE = G['camera'].get('axe_px', R['door_center_x'])` pour `shift_x` et la position de l'appareil ; `MUR.get('zone_px', (0, 900, 1100, 2300))` pour la passe « mur » (rendu, `.npy`, `compo.py`) ; texture de l'écran `SOURCES / F['ecran_image']` ; pluie de `compo.py` lue dans `G['pluie']`. Référence ligne à ligne : `diff tools/devanture-borne/borne.py .superpowers/lot3-essai-pc/borne.py` (idem `compo.py`).
- [ ] **Step 5: Brancher les six scripts sur `variante.py` (et, de la même façon, les trois outils de réglage hors fabrique `gros_plan.py`, `charge.py`, `mesure_neon.py`), la boucle des variantes dans `fabrique.sh`** (journaux dans le dossier de la variante ; l'étape « vue rapprochée » ne tourne que si `python3 variante.py site.zoom` réussit ; l'étape « fond » lance `python3 "$ICI/$(python3 "$ICI/variante.py" fond)"` sans tube), `travail-*/` dans `.gitignore`.
- [ ] **Step 6: Tests** — `node --test tests/architecture/devanture-borne.test.mjs` → tous verts.
- [ ] **Step 7: Le mobile ressort inchangé** — `DEVANTURES=mobile sh tools/devanture-borne/fabrique.sh`, puis comparer `public/storefront-mobile.webp` à `git show HEAD:public/storefront-mobile.webp` (PIL, écart absolu moyen sur 255). Expected : **< 0,5**. `src/data/storefront-mobile.json` : `git diff --stat` vide. Puis `git checkout -- public/storefront-mobile.webp public/storefront-mobile.jpeg public/storefront-borne-zoom.webp`.
- [ ] **Step 8: Commit** — `refactor(devanture): la fabrique prend des variantes, le mobile ressort inchangé`

### Task 2: La variante « bureau » — l'image et sa mise en page

**Files:**
- Create: `tools/devanture-borne/geometrie-bureau.json`, `tools/devanture-borne/fond_bureau.py`, `tools/devanture-borne/sources/storefront-bureau.jpeg`, `tools/devanture-borne/sources/ecran-bureau.png`, `src/data/storefront-desktop.json` (écrit par la fabrique)
- Modify: `tools/devanture-borne/borne.py` (mise en page sans vue rapprochée), `sorties.py`, `public/storefront.jpeg` (écrit par la fabrique)
- Test: `tests/architecture/devanture-borne.test.mjs`

**Interfaces:**
- Consumes: Task 1 (`variante.py`, clés `fond`, `facade.ecran_image`, `pluie`).
- Produces: `src/data/storefront-desktop.json` — `{ image: { w: 5782, h: 3072 }, borne, ecran, porte: Rect, push: { x, y }, groupe: { cx, cy } }`, fractions de l'image. **Pas de champ `zoom`.**
- Produces: `public/storefront.jpeg` **2102 × 1117**, JPEG qualité 88 progressif.
- Produces: `tools/devanture-borne/travail-bureau/compo.png` (5782 × 3072), `repere.json`, `neon-bbox.json`, `borne.png`, `mur-passe.npy`.

- [ ] **Step 1: Écrire les tests qui échouent**

```js
function tailleJpeg(buf) {                // premier marqueur SOF0..SOF2 : hauteur puis largeur
  for (let i = 2; i < buf.length;) {
    const m = buf[i + 1], n = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xc2) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + n;
  }
  throw new Error('JPEG sans SOF');
}

test('BUREAU: sources, géométrie et mise en page', () => {
  for (const f of ['geometrie-bureau.json', 'fond_bureau.py', 'sources/storefront-bureau.jpeg', 'sources/ecran-bureau.png']) assert.ok(existsSync(path.join(T, f)), f);
  const g = JSON.parse(readFileSync(path.join(T, 'geometrie-bureau.json'), 'utf8'));
  assert.deepEqual([g.sortie.w, g.sortie.h, g.sortie.px_par_m], [5782, 3072, 1104]);
  assert.equal(g.borne.ecart_porte_m, 0.16);
  assert.equal(g.site.zoom, undefined);
  const L = JSON.parse(readFileSync(path.join(ROOT, 'src/data/storefront-desktop.json'), 'utf8'));
  assert.deepEqual([L.image.w, L.image.h], [5782, 3072]);
  const dans = (a, b) => a.x0 >= b.x0 && a.x1 <= b.x1 && a.y0 >= b.y0 && a.y1 <= b.y1;
  assert.ok(dans(L.ecran, L.borne) && L.borne.x1 < L.porte.x0);
  const ratio = ((L.ecran.y1 - L.ecran.y0) * L.image.h) / ((L.ecran.x1 - L.ecran.x0) * L.image.w);
  assert.ok(Math.abs(ratio - 3 / 2) < 0.03, `écran 2:3, mesuré ${ratio}`);
  assert.ok(L.push.x > L.porte.x0 && L.push.x < L.porte.x1 && L.zoom === undefined);
  assert.ok(Math.abs(L.borne.x0 * 5782 - 91) < 6 && Math.abs(L.ecran.x0 * 5782 - 679) < 6 && Math.abs(L.ecran.y0 * 3072 - 1817) < 6, 'positions de l\'essai validé');
});

test('BUREAU: la devanture du site a le format de sa mise en page', () => {
  const [w, h] = tailleJpeg(readFileSync(path.join(ROOT, 'public/storefront.jpeg')));
  assert.deepEqual([w, h], [2102, 1117]);
});
```

- [ ] **Step 2: Lancer, constater l'échec.**
- [ ] **Step 3: Faire entrer les sources.** `storefront-bureau.jpeg` ← `.superpowers/lot3-essai-pc/storefront-origine.jpeg` (vérifier par `cmp` qu'elle est identique à `git show f5123bb:public/storefront.jpeg` ; sinon garder la copie de l'essai et le noter au registre) ; `ecran-bureau.png` ← `ecran-pc.png`. `geometrie-bureau.json` ← `geometrie.json` de l'essai, avec `"fond": "fond_bureau.py"`, `photo.fichier: "storefront-bureau.jpeg"`, `facade.ecran_image: "ecran-bureau.png"`, `pluie: { "densite": 0.00006, "longueur": [22, 80], "pente": 0.05, "force": [0.08, 0.36], "epaisseur": 2, "flou": 1.1 }`, `site` réduit à `groupe_cy`, et un en-tête qui ne parle plus d'essai. `fond_bureau.py` ← `fond_pc.py`, branché sur `variante.py`, photo lue dans `SOURCES`.
- [ ] **Step 4: `borne.py`** — `mise_en_page()` n'écrit `zoom` que si `site.zoom` existe. **`sorties.py`** — une branche par variante : `bureau` écrit `public/storefront.jpeg` (2102 × 1117, LANCZOS, qualité 88, progressif) et `src/data/storefront-desktop.json` ; `mobile` inchangé.
- [ ] **Step 5: Fabriquer** — `DEVANTURES=bureau sh tools/devanture-borne/fabrique.sh`. Expected : huit étapes moins la vue rapprochée, sans erreur.
- [ ] **Step 6: Critère de l'image** — écart absolu moyen entre `travail-bureau/compo.png` et `.superpowers/lot3-essai-pc/essai3-compo.png`. Expected : **< 1,5** sur 255. Regarder l'image (Read d'une réduction) : pas de raccord visible.
- [ ] **Step 7: Tests** → verts. **Step 8: Commit** — `feat(devanture): la devanture du bureau sort de la fabrique (image et mise en page)` (ajouter nommément les sources, la géométrie, les scripts, `public/storefront.jpeg`, `src/data/storefront-desktop.json`, le test).

### Task 3: Le masque de reflets du bureau

**Files:**
- Create: `tools/devanture-borne/masque.py`, `tools/devanture-borne/sources/storefront-mask-bureau.png`
- Modify: `tools/devanture-borne/borne.py` (passe `masque`), `fabrique.sh`, `sorties.py`, `geometrie-bureau.json`, `public/storefront-mask.png` (écrit par la fabrique)
- Test: `tests/architecture/devanture-borne.test.mjs`

**Interfaces:**
- Consumes: Task 2 (`travail-bureau/`, `geometrie-bureau.json`).
- Produces: `geometrie-bureau.json` → `"masque": { "source": "storefront-mask-bureau.png", "vitre": [0, 1, 0], "carrosserie": [0, 0, 0.25] }`.
- Produces: passe `masque` de `borne.py` → `travail-bureau/borne-masque.png` (RGBA 5782 × 3072) ; `masque.py` → `travail-bureau/masque.png` ; `public/storefront-mask.png` **2891 × 1536**.

- [ ] **Step 1: Test qui échoue**

```js
test('MASQUE: le masque du bureau sort de la fabrique, au format de l\'image', () => {
  const png = readFileSync(path.join(ROOT, 'public/storefront-mask.png'));
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [2891, 1536]);
  const g = JSON.parse(readFileSync(path.join(T, 'geometrie-bureau.json'), 'utf8'));
  assert.deepEqual(g.masque.vitre, [0, 1, 0]);
  const src = readFileSync(path.join(T, 'masque.py'), 'utf8');
  for (const garde of ['SystemExit', 'rouge', 'mur ajouté']) assert.ok(src.includes(garde), garde);
});
```

- [ ] **Step 2: Constater l'échec.**
- [ ] **Step 3: Passe `masque` dans `borne.py`** — même scène, même caméra, sans éclairage : chaque matière est remplacée par une émission pure ; `vitre` et la vitre de l'écran (relever sa matière près du bloc « écran », ligne ~581) → `masque.vitre` ; `peinture`, `alu`, `alu_noir`, `acier`, `inox`, `chrome`, `touche` → `masque.carrosserie` ; tout le reste de la borne, néon compris, → noir opaque ; mur attrape-ombres invisible. Fond transparent, vue « Standard », pas de débruitage, 16 échantillons.
- [ ] **Step 4: `masque.py`** — transforme le masque d'origine (5632 × 3072) comme `fond_bureau.py` transforme la photo : sous `photo.couture_px`, glissement de `decalage_px + elargissement_px` vers la droite ; au-dessus, glissement de `elargissement_px // 2` ; zéro partout où la photo n'apporte rien. Puis pose `borne-masque.png` par son alpha. Garde-fous qui lèvent `SystemExit` : rouge nul sur toutes les colonnes à gauche du cadre de la porte (`repere.json` `door_left_x`) sous la couture — commentaire « mur ajouté et borne : aucun néon qui vacille » ; vert > 200 au centre de l'écran ; rouge maximal ≥ 150 sur la bande de l'enseigne.
- [ ] **Step 5: `fabrique.sh`** (étapes « passe masque » et « masque » pour les variantes qui ont `masque`), **`sorties.py`** (`public/storefront-mask.png`, 2891 × 1536, LANCZOS). `storefront-mask-bureau.png` ← `.superpowers/lot3-essai-pc/storefront-mask-origine.png`.
- [ ] **Step 6: Fabriquer et regarder** — superposer `travail-bureau/masque.png` à 50 % sur `compo.png`, réduire, lire l'image : les aplats tombent sur les vitres et la carrosserie de la borne, rien sur le mur ajouté.
- [ ] **Step 7: Tests verts. Step 8: Commit** — `feat(devanture): masque de reflets du bureau fabriqué avec l'image`

### Task 4: La devanture du bureau dans le site (format, zones, indicateur)

**Files:**
- Modify: `src/components/exterior/storefront-layout.ts`, `src/components/exterior/scene/ExteriorScene.ts`, `src/components/exterior/ExteriorView.tsx`, `src/components/exterior/ExteriorView.module.css`
- Test: `tests/domain/storefront-layout.test.mjs`, `tests/domain/kiosk-wiring.test.mjs`

**Interfaces:**
- Consumes: `src/data/storefront-desktop.json` (Task 2).
- Produces: `export function fitBox(image: { w: number; h: number }, vw: number, vh: number): Box` — l'image entière, centrée, sans rognage (bandes en haut et en bas, ou sur les côtés).
- Produces: `StorefrontLayout.zoom` devient facultatif dans cette tâche (retiré en Task 8).
- Produces: `new ExteriorScene(container, aspect: number, onStorefrontShown?)`, `scene.pause(): void`, `scene.resume(): void` (arrêt et reprise de la boucle d'animation ; `resume` sans effet si la scène tourne).

- [ ] **Step 1: Tests qui échouent**

```js
// tests/domain/storefront-layout.test.mjs
const LD = JSON.parse(readFileSync(path.join(ROOT, 'src/data/storefront-desktop.json'), 'utf8'));

test('BUREAU: l\'image tient entière dans la fenêtre, centrée', () => {
  assert.deepEqual(fitBox(LD.image, 1920, 1080), { left: 0, top: (1080 - 1920 * 3072 / 5782) / 2, width: 1920, height: 1920 * 3072 / 5782 });
  const large = fitBox(LD.image, 2560, 1080);
  assert.equal(large.height, 1080);
  assert.ok(Math.abs(large.left - (2560 - 1080 * 5782 / 3072) / 2) < 1e-9 && large.top === 0);
});

test('BUREAU: câblage de la devanture', () => {
  const tsx = readFileSync(path.join(ROOT, 'src/components/exterior/ExteriorView.tsx'), 'utf8');
  const scene = readFileSync(path.join(ROOT, 'src/components/exterior/scene/ExteriorScene.ts'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'src/components/exterior/ExteriorView.module.css'), 'utf8');
  assert.ok(!tsx.includes('5632') && !scene.includes('5632'), 'plus de format écrit en dur');
  assert.ok(tsx.includes('storefront-desktop.json') && tsx.includes('fitBox('));
  assert.ok(tsx.includes('zoneStyle(LAYOUT_DESKTOP.borne)') && tsx.includes('zoneStyle(LAYOUT_DESKTOP.porte)'), 'borne et porte entières');
  assert.ok(tsx.includes('BORNE LOCATION'), 'indicateur de la borne');
  assert.ok(!tsx.includes('kioskButton') && !css.includes('.kioskButton'), 'le bouton provisoire a disparu');
});
```

Dans `tests/domain/kiosk-wiring.test.mjs`, le test « la devanture propose la borne… » (ligne 33) : remplacer ce qu'il exige du bouton provisoire par `aria-label="Ouvrir la borne de location"` présent dans les deux branches.

- [ ] **Step 2: Constater l'échec.**
- [ ] **Step 3: `fitBox`** dans `storefront-layout.ts`.
- [ ] **Step 4: `ExteriorScene`** — le format vient du constructeur (plus de constante), `pause()` / `resume()`.
- [ ] **Step 5: `ExteriorView`, branche bureau** — `LAYOUT_DESKTOP` importé de `storefront-desktop.json` ; `contentArea` calculée par `fitBox(LAYOUT_DESKTOP.image, …)` à partir de `viewport` (plus d'état ni d'écouteur à part) ; deux zones placées par `zoneStyle` : la borne (`onClick={openKiosk}`, survol → classe `kioskHover`) et la porte entière (`handleEnterClick`, survol existant) ; le halo de survol de la porte et l'indicateur « PUSH ▼ » posés sur `LAYOUT_DESKTOP.push` ; un indicateur « BORNE LOCATION ▼ » de même style, centré sur l'écran de la borne, son bas au bord haut de l'écran ; le bouton provisoire et ses styles supprimés. `openKiosk` garde pour l'instant son ouverture directe sur le bureau.
- [ ] **Step 6: Feuille de style** — plus aucun pourcentage de position pour la porte ; survol de la borne : liseré discret (`box-shadow` intérieur violet, pas de `backdrop-filter`).
- [ ] **Step 7: Tests** — `node --test tests/domain/storefront-layout.test.mjs tests/domain/kiosk-wiring.test.mjs` → verts ; `npx tsc --noEmit -p .` → aucune erreur nouvelle.
- [ ] **Step 8: Commit** — `feat(devanture): la borne sur la devanture du bureau, zones tirées de la mise en page`

### Task 5: La fabrique du film d'approche (bureau)

**Files:**
- Create: `tools/devanture-borne/approche_trajet.py`, `approche_rendu.py`, `approche_compo.py`, `public/storefront-borne-approche.mp4` (écrit par la fabrique)
- Modify: `fabrique.sh`, `sorties.py`, `geometrie-bureau.json`, `README.md`
- Test: `tests/architecture/devanture-borne.test.mjs`

**Interfaces:**
- Consumes: Task 2 (`travail-bureau/` : `fond.png`, `compo.png`, `repere.json`, `neon-bbox.json`, `borne.png`).
- Produces: `geometrie-bureau.json` → `"approche": { "ips": 30, "duree_s": 3.0, "accel_s": 0.55, "frein_s": 1.10, "pas_hz": 1.8, "pas_m": 0.005, "obturateur": 0.5, "sous_images": 7, "bord_exp": 2.2, "arrivee": { "hauteur_ecran": 0.94, "cx": 0.43, "cy": 0.5 }, "film": { "w": 1920, "h": 1020, "crf": 23, "fichier": "storefront-borne-approche.mp4", "budget_octets": 2621440 }, "echantillons": [64, 64], "pluie": { "densite": 0.00022, "longueur": [26, 78], "pente": 0.05, "force": [0.05, 0.22], "flou": 0.7 } }` (pluie exprimée pour une image de 1280 px de large, mise à l'échelle du film).
- Produces: `travail-<variante>/approche/trajet.json` — `{ ips, duree, images: [{ i, t, u, d, haut, cam_x, cam_z, shift_x, shift_y, boite: [col, ligne, largeur, hauteur], bouge: [boîtes] }] }`, 91 images.
- Produces: mise en page du site → `"approche": { "src": "/storefront-borne-approche.mp4", "w": 1920, "h": 1020, "duree": 3.0, "images": 91, "octets": <taille>, "ecran": { x0, y0, x1, y1 } }` — `ecran` = l'écran de la borne dans la **dernière** image, en fractions du cadre, projeté par la caméra.

- [ ] **Step 1: Test qui échoue**

```js
function controleFilm(L, fichier, budget) {
  const a = L.approche, buf = readFileSync(path.join(ROOT, 'public', fichier));
  assert.equal(a.src, '/' + fichier);
  assert.deepEqual([a.duree, a.images], [3, 91]);
  assert.equal(buf.length, a.octets);
  assert.ok(buf.length <= budget, `${buf.length} octets pour un budget de ${budget}`);
  assert.equal(buf.toString('latin1', 4, 8), 'ftyp');
  assert.ok(buf.indexOf('moov') > 0 && buf.indexOf('moov') < buf.indexOf('mdat'), 'lisible dès le début du téléchargement');
  assert.ok(!buf.includes('soun'), 'pas de piste son');
  assert.ok(Math.abs(a.w / a.h - L.image.w / L.image.h) < 0.002, 'le film a le format de l\'image');
  return a;
}

test('APPROCHE: le film du bureau', () => {
  const L = JSON.parse(readFileSync(path.join(ROOT, 'src/data/storefront-desktop.json'), 'utf8'));
  const a = controleFilm(L, 'storefront-borne-approche.mp4', 2621440);
  assert.deepEqual([a.w, a.h], [1920, 1020]);
  assert.ok(Math.abs((a.ecran.y1 - a.ecran.y0) - 0.94) < 0.02, 'l\'écran fait 94 % de la hauteur à l\'arrivée');
  assert.ok(Math.abs((a.ecran.x0 + a.ecran.x1) / 2 - 0.43) < 0.02 && Math.abs((a.ecran.y0 + a.ecran.y1) / 2 - 0.5) < 0.02);
});

test('APPROCHE: le départ du film est tenu à l\'image fixe', () => {
  const src = readFileSync(path.join(T, 'approche_compo.py'), 'utf8');
  assert.ok(src.includes('SystemExit') && src.includes('compo.png'), 'la première image est comparée à l\'image fixe, écart qui arrête la fabrique');
});
```

- [ ] **Step 2: Constater l'échec.**
- [ ] **Step 3: `approche_trajet.py`** ← `anim_camera.py` de l'essai, réglages lus dans `G['approche']`, sortie `D / 'approche' / 'trajet.json'`. Deux changements : (a) **l'arrivée** — le centre du cadre à l'arrivée est tel que l'écran (projeté sur le plan du mur) ait son centre en (`cx`, `cy`) du cadre, et la distance d'arrivée vient de `hauteur_ecran` **ou** de `largeur_ecran` (part de la largeur du cadre, pour le mobile) ; (b) **le glissement latéral** — `bord_exp` s'applique entre le bord de départ du cadre et son bord d'arrivée (la formule de l'essai suppose un départ en colonne 0 : la généraliser en interpolant le bord gauche de la boîte par `((W − largeur) / (W − largeur_arrivée)) ** bord_exp`, idem inchangé en hauteur avec l'exposant 1).
- [ ] **Step 4: `approche_rendu.py`** ← `anim_rendu.py` (exécute `borne.py` jusqu'à sa ligne de rendu, puis rend chaque image ; passes `borne` et `mur`). En passe `borne`, à la dernière image, projeter les quatre coins de l'écran (`cadre(...)` de `borne.py`) et écrire `D / 'approche' / 'ecran-arrivee.json`.
- [ ] **Step 5: `approche_compo.py`** ← `anim_compo.py` : assemblage par image (mur recalé par `resize(box=…)`, lumière du mur limitée comme dans `compo.py`, borne, halo étalonné), flou de bougé, pluie de `approche.pluie`, sortie `D / 'approche' / 'film_%04d.png'`. Garde-fou : la première image, avant pluie, comparée à `compo.png` réduite (LANCZOS) — écart absolu moyen ≥ 2,5 → `SystemExit` (l'image fixe porte sa propre pluie figée : l'essai mesurait 0,88).
- [ ] **Step 6: Encodage dans `fabrique.sh`**, pour les variantes qui ont `approche` :

```sh
ffmpeg -y -loglevel error -framerate 30 -i "$T/approche/film_%04d.png" -frames:v 91 \
  -vf "scale=out_color_matrix=bt709:out_range=tv" -c:v libx264 -preset slow -crf "$CRF" -pix_fmt yuv420p \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -an -movflags +faststart "$T/approche/film.mp4"
```

`ffmpeg` introuvable → message clair et arrêt. **`sorties.py`** copie le film dans `public/`, vérifie le budget (`SystemExit` au-delà) et complète la mise en page (`approche`).
- [ ] **Step 7: Fabriquer** — `DEVANTURES=bureau sh tools/devanture-borne/fabrique.sh` (environ un quart d'heure pour le film). Lire une planche de six images (0 ; 1 ; 1,5 ; 2 ; 2,5 ; 3 s) : la borne entière jusqu'à mi-parcours, l'écran net à l'arrivée, à gauche du milieu.
- [ ] **Step 8: Tests verts. Step 9: Montrer le film à Rusmir** (SendUserFile, `display: 'render'`, et `open` du fichier) en disant que l'arrivée est décalée vers la gauche par rapport à l'essai pour tomber sur l'écran de l'interface ; **continuer sans attendre**, son retour éventuel se règle dans `approche.arrivee`.
- [ ] **Step 10: README** (étape « approche », sorties, ffmpeg). **Commit** — `feat(devanture): le film d'approche de la borne sort de la fabrique (bureau)`

### Task 6: Le film dans le site — mécanique commune, bureau, apparition de la borne

**Files:**
- Create: `src/components/exterior/useApproachFilm.ts`
- Modify: `src/components/exterior/storefront-layout.ts`, `ExteriorView.tsx`, `ExteriorView.module.css`, `src/App.tsx`
- Test: `tests/domain/storefront-layout.test.mjs`, `tests/domain/kiosk-wiring.test.mjs`

**Interfaces:**
- Consumes: `layout.approche` (Task 5), `fitBox`, `ExteriorScene.pause/resume` (Task 4).
- Produces (`storefront-layout.ts`) :
  - `StorefrontLayout.approche?: { src: string; w: number; h: number; duree: number; images: number; octets: number; ecran: Rect }`
  - `export function kioskScreenBoxDesktop(vw: number, vh: number): Box` — `height = min(0.94 × vh, 1100)`, `width = height × 2 / 3`, `left = 0.62 × width + 62`, `top = (vh − height) / 2`.
  - `export function approachTransform(stage: Box, ecran: Rect, target: Box): { scale: number; x: number; y: number }` — transformation de la scène (`transform-origin: 0 0`, `translate(x, y) scale(scale)`) qui amène le rectangle `ecran` de la scène sur `target` : `scale = target.width / ((ecran.x1 − ecran.x0) × stage.width)`, `x = target.left − stage.left − scale × ecran.x0 × stage.width`, `y` de même.
- Produces (`useApproachFilm.ts`) :

```ts
export type ApproachPhase = 'idle' | 'starting' | 'playing';
export interface ApproachFilm {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Adresse locale du film une fois téléchargé en entier ; null avant. */
  src: string | null;
  phase: ApproachPhase;
  /** Lance le film. false = il ne peut pas partir (pas chargé, animations réduites) : l'appelant ouvre la borne directement. */
  start: () => boolean;
  /** Clic pendant le film : va à l'arrivée. */
  skip: () => void;
}
export function useApproachFilm(opts: { url: string | undefined; durationMs: number; load: boolean; onArrive: () => void }): ApproachFilm;
export const APPROACH_START_TIMEOUT_MS = 400;   // première image pas affichée à temps : on arrive
export const APPROACH_GUARD_MARGIN_MS = 1500;   // au-delà de la durée, comptée depuis la première image affichée
```

- Produces (`App.tsx`) : `KIOSK_REVEAL_MS = 280` ; la borne monte dans un conteneur qui apparaît en fondu (`@keyframes kiosk-reveal`, opacité 0 → 1) ; la devanture reste montée dessous pendant `KIOSK_REVEAL_MS` après `openKiosk`, puis est démontée.

- [ ] **Step 1: Tests qui échouent**

```js
// tests/domain/storefront-layout.test.mjs
test('APPROCHE: l\'écran de l\'interface du bureau, aux positions mesurées à l\'écran le 18/11/2026', () => {
  const cas = [[1280, 720, 341.7, 21.6, 451.2, 676.8], [1440, 900, 411.7, 27, 564, 846], [1920, 1080, 481.6, 32.4, 676.8, 1015.2],
    [2560, 1080, 481.6, 32.4, 676.8, 1015.2], [2560, 1440, 516.7, 170, 733.3, 1100]];
  for (const [vw, vh, left, top, width, height] of cas) {
    const b = kioskScreenBoxDesktop(vw, vh);
    for (const [k, v] of [['left', left], ['top', top], ['width', width], ['height', height]]) assert.ok(Math.abs(b[k] - v) < 0.6, `${vw}×${vh} ${k} : ${b[k]} au lieu de ${v}`);
  }
});

test('APPROCHE: la formule du bureau suit KioskView.module.css', () => {
  const css = readFileSync(path.join(ROOT, 'src/components/kiosk/KioskView.module.css'), 'utf8');
  for (const morceau of ['calc(min(94dvh, 1100px) * 2 / 3)', 'width: calc(var(--ks-w) * 0.62)', 'padding: 0 26px', 'gap: 20px', 'padding: 13px', 'border-left: 3px solid']) assert.ok(css.includes(morceau), morceau);
});

test('APPROCHE: l\'écran filmé arrive sur l\'écran de l\'interface (bureau et téléphone)', () => {
  const cas = [[LD, 1920, 1080, fitBox(LD.image, 1920, 1080), kioskScreenBoxDesktop(1920, 1080)], [LD, 2560, 1440, fitBox(LD.image, 2560, 1440), kioskScreenBoxDesktop(2560, 1440)]];
  for (const [L, vw, vh, stage, cible] of cas) {
    const e = L.approche.ecran, z = approachTransform(stage, e, cible);
    assert.ok(Math.abs(stage.left + z.x + z.scale * e.x0 * stage.width - cible.left) < 0.01);
    assert.ok(Math.abs(stage.top + z.y + z.scale * e.y0 * stage.height - cible.top) < 0.01);
    assert.ok(Math.abs(z.scale * (e.x1 - e.x0) * stage.width - cible.width) < 0.01);
    assert.ok(Math.abs(z.scale * (e.y1 - e.y0) * stage.height - cible.height) / cible.height < 0.03, `${vw}×${vh} : même proportion d'écran`);
  }
  const z = approachTransform(fitBox(LD.image, 1920, 1080), LD.approche.ecran, kioskScreenBoxDesktop(1920, 1080));
  assert.ok(z.scale > 1 && z.scale < 1.12, `sur 1920 × 1080 le film ne fait qu'un petit ajustement (${z.scale})`);
});

test('APPROCHE: le crochet du film ne fait jamais attendre', () => {
  const src = readFileSync(path.join(ROOT, 'src/components/exterior/useApproachFilm.ts'), 'utf8');
  for (const m of ['prefers-reduced-motion', 'APPROACH_START_TIMEOUT_MS', 'APPROACH_GUARD_MARGIN_MS', 'createObjectURL', 'revokeObjectURL', "'ended'", "'error'", 'requestVideoFrameCallback']) assert.ok(src.includes(m), m);
  assert.ok(!/youtube|dailymotion|vimeo/i.test(src));
});

test('APPROCHE: câblage du bureau et apparition de la borne', () => {
  const tsx = readFileSync(path.join(ROOT, 'src/components/exterior/ExteriorView.tsx'), 'utf8');
  const app = readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8');
  assert.ok(tsx.includes('useApproachFilm(') && tsx.includes('approachTransform(') && tsx.includes('kioskScreenBoxDesktop('));
  assert.match(tsx, /<video[\s\S]{0,300}muted[\s\S]{0,200}playsInline/);
  assert.match(tsx, /onKioskIntent\?\.\(\);[\s\S]{0,600}film\.start\(\)/, 'l\'intention part avant le film');
  assert.ok(tsx.includes('.pause()') && tsx.includes('film.skip'));
  assert.ok(app.includes('KIOSK_REVEAL_MS') && app.includes('kiosk-reveal'));
});
```

- [ ] **Step 2: Constater l'échec.**
- [ ] **Step 3: `kioskScreenBoxDesktop`, `approachTransform`, type `approche`** dans `storefront-layout.ts`.
- [ ] **Step 4: `useApproachFilm`** — quand `load` devient vrai : `fetch(url)` → `blob` → `URL.createObjectURL` (révoqué au démontage ; échec silencieux, `src` reste `null`). `start()` : rend `false` si `src` est `null`, si `prefers-reduced-motion: reduce`, ou si un film est en cours ; sinon `currentTime = 0`, `play()` (rejet → `onArrive`), phase `starting`, et passe à `playing` à la première image réellement présentée (`requestVideoFrameCallback`, repli sur l'événement `playing`). `onArrive` est appelé **une seule fois par lancement** : événement `ended`, événement `error`, `skip()`, première image absente après `APPROACH_START_TIMEOUT_MS`, ou `durationMs + APPROACH_GUARD_MARGIN_MS` après le passage à `playing`. La phase revient à `idle` quand la devanture est démontée (nouveau montage au retour).
- [ ] **Step 5: `ExteriorView`, branche bureau** — `const film = useApproachFilm({ url: LAYOUT_DESKTOP.approche?.src, durationMs: …duree × 1000, load: isStorefrontShown, onArrive: onOpenKiosk })`. `openKiosk` : gardes actuelles, `onKioskIntent?.()`, puis `if (!film.start()) onOpenKiosk()`. Dans la boîte de l'image : `<video ref={film.videoRef} src={film.src ?? undefined} muted playsInline preload="auto" aria-hidden="true">`, invisible hors phase `playing` (fondu d'entrée de 150 ms). En phase `playing` : la boîte reçoit `approachTransform(contentBox, approche.ecran, kioskScreenBoxDesktop(vw, vh))` par une transition de la durée du film (`cubic-bezier(0.45, 0, 0.3, 1)`), les zones et les indicateurs s'effacent, la scène WebGL est mise en pause (`sceneRef.current?.pause()`) et son conteneur masqué une fois le fondu d'entrée passé ; un clic n'importe où appelle `film.skip`. La porte ne répond plus dès que la phase n'est plus `idle`.
- [ ] **Step 6: `App.tsx`** — `openKiosk` ne démonte plus la devanture tout de suite : état `kioskRevealing` vrai pendant `KIOSK_REVEAL_MS` (minuteur nettoyé), devanture rendue si `currentScene === 'exterior' || kioskRevealing`, borne dans `<div style={{ animation: 'kiosk-reveal 280ms ease-out both' }}>`. `leaveKiosk` remet `kioskRevealing` à faux.
- [ ] **Step 7: Tests** — les deux fichiers de tests verts ; `npx tsc --noEmit -p .` sans erreur nouvelle ; suite complète : 9 échecs connus, pas un de plus.
- [ ] **Step 8: Commit** — `feat(devanture): le film d'approche joue sur le bureau, la borne apparaît sur l'écran filmé`

### Task 7: La fabrique du film d'approche (mobile), retrait de la vue rapprochée

**Files:**
- Modify: `tools/devanture-borne/fond.py` (ciel à part), `approche_compo.py`, `borne.py` (passe `zoom` retirée), `fabrique.sh`, `sorties.py`, `geometrie.json`, `README.md`, `src/data/storefront-mobile.json` (écrit par la fabrique)
- Create: `public/storefront-mobile-borne-approche.mp4` (écrit par la fabrique)
- Delete: `public/storefront-borne-zoom.webp`
- Test: `tests/architecture/devanture-borne.test.mjs`

**Interfaces:**
- Consumes: Task 5 (`approche_*.py`, étape d'encodage, `sorties.py`).
- Produces: `geometrie.json` → `"approche"` : les réglages du bureau, sauf `"bord_exp": 1`, `"arrivee": { "largeur_ecran": 0.78, "cx": 0.5, "cy": 0.47 }`, `"film": { "w": 720, "h": 1290, "crf": 23, "fichier": "storefront-mobile-borne-approche.mp4", "budget_octets": 1572864 }`, pluie à l'échelle ; `site.zoom` supprimé.
- Produces: `fond.py` → en plus de `fond.png`, `travail/ciel.png` (le ciel et la lune seuls, sur toute l'image, sans bâtiment) et `travail/ciel-masque.png` (niveaux de gris : 255 là où `fond.png` montre le ciel).
- Produces: `src/data/storefront-mobile.json` sans `zoom`, avec `approche` (mêmes champs qu'au bureau).

- [ ] **Step 1: Tests qui échouent** — dans `tests/architecture/devanture-borne.test.mjs` : remplacer le test « IMAGES: … vue rapprochée ont les tailles annoncées » par la seule devanture ; retirer de « la mise en page est cohérente » les deux assertions sur `L.zoom` ; ajouter :

```js
test('APPROCHE: le film du mobile, et plus de vue rapprochée', () => {
  const L = JSON.parse(readFileSync(path.join(ROOT, 'src/data/storefront-mobile.json'), 'utf8'));
  const a = controleFilm(L, 'storefront-mobile-borne-approche.mp4', 1572864);
  assert.deepEqual([a.w, a.h], [720, 1290]);
  assert.ok(Math.abs((a.ecran.x1 - a.ecran.x0) - 0.78) < 0.02 && Math.abs((a.ecran.y0 + a.ecran.y1) / 2 - 0.47) < 0.02);
  assert.equal(L.zoom, undefined);
  assert.ok(!existsSync(path.join(ROOT, 'public/storefront-borne-zoom.webp')));
  assert.ok(!readFileSync(path.join(T, 'borne.py'), 'utf8').includes("PASSE == 'zoom'"));
});
```

- [ ] **Step 2: Constater l'échec.**
- [ ] **Step 3: `fond.py`** écrit le ciel à part (même tirage aléatoire : `fond.png` doit rester identique octet pour octet — le vérifier par `cmp` avant/après).
- [ ] **Step 4: `approche_compo.py`** — quand `ciel.png` existe : le bâtiment se recale comme le mur ; **le ciel ne change pas d'échelle** (il est à l'infini), il ne fait que glisser du déplacement du cadre (`shift_x`, `shift_y` de l'image moins ceux du départ, en hauteurs de cadre) ; les deux sont mêlés par `ciel-masque.png` recalé comme le bâtiment. Hors de `ciel.png`, prolonger par ses bords.
- [ ] **Step 5: Retirer la vue rapprochée** — passe `zoom` et `zone_zoom` de `borne.py`, étape de `fabrique.sh`, `zoom.png` de `sorties.py`, bloc `site.zoom` ; `git rm public/storefront-borne-zoom.webp`.
- [ ] **Step 6: Fabriquer** — `DEVANTURES=mobile sh tools/devanture-borne/fabrique.sh`. L'image fixe : écart moyen < 0,5 avec `git show HEAD:public/storefront-mobile.webp` → `git checkout --` des deux images fixes. Lire une planche de six images du film : le ciel et la lune ne grossissent pas, la borne reste nette, l'écran arrive à 78 % de la largeur.
- [ ] **Step 7: Tests verts. Step 8: Montrer le film mobile à Rusmir** (SendUserFile + `open`), en l'annonçant comme essai à juger (durée et rythme du bureau, pluie ajoutée) ; **continuer sans attendre**.
- [ ] **Step 9: README. Commit** — `feat(devanture): film d'approche du mobile, la vue rapprochée du zoom est retirée`

### Task 8: Le film sur la devanture mobile, retrait du zoom

**Files:**
- Modify: `src/components/exterior/ExteriorView.tsx`, `ExteriorView.module.css`, `storefront-layout.ts`
- Test: `tests/domain/storefront-layout.test.mjs`, `tests/domain/kiosk-wiring.test.mjs`

**Interfaces:**
- Consumes: `useApproachFilm`, `approachTransform`, `kioskScreenBox` (Task 6), `storefront-mobile.json` avec `approche` (Task 7).
- Produces: `storefront-layout.ts` sans `zoomTransform` ni `StorefrontLayout.zoom` ; `approche` devient obligatoire dans le type.

- [ ] **Step 1: Tests** — dans `storefront-layout.test.mjs`, supprimer les tests « ZOOM: … » (lignes 29, 62, 78, 97) et « BARRE: le zoom part… » (ligne 149), retirer `zoomTransform` des imports et de « BARRE: câblage » ; ajouter :

```js
test('APPROCHE MOBILE: l\'écran filmé arrive sur l\'écran de l\'interface', () => {
  for (const [vw, vh] of [[360, 640], [390, 844], [412, 915], [412, 700]]) {
    const s = stageBox(L, vw, vh, 76), k = kioskScreenBox(vw, vh), e = L.approche.ecran, z = approachTransform(s, e, k);
    assert.ok(Math.abs(s.left + z.x + z.scale * e.x0 * s.width - k.left) < 0.01 && Math.abs(s.top + z.y + z.scale * e.y0 * s.height - k.top) < 0.01);
    assert.ok(Math.abs(z.scale * (e.y1 - e.y0) * s.height - k.height) / k.height < 0.03, `${vw}×${vh} : écran 5:9`);
    assert.ok(z.scale > 0.75 && z.scale < 1.35, `${vw}×${vh} : petit ajustement (${z.scale})`);
  }
});

test('APPROCHE MOBILE: câblage — le film remplace le zoom', () => {
  const tsx = readFileSync(path.join(ROOT, 'src/components/exterior/ExteriorView.tsx'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'src/components/exterior/ExteriorView.module.css'), 'utf8');
  const lay = readFileSync(path.join(ROOT, 'src/components/exterior/storefront-layout.ts'), 'utf8');
  for (const mort of ['kioskZoom', 'closeUpReady', 'CLOSE_UP_SRC', 'storefront-borne-zoom', 'KIOSK_ZOOM_GUARD_MS', 'kioskVeil']) assert.ok(!tsx.includes(mort), mort);
  assert.ok(!css.includes('.mobileCloseUp') && !css.includes('.kioskVeil') && !css.includes('.mobileStageZoom'));
  assert.ok(!lay.includes('zoomTransform'));
  assert.ok(tsx.includes('approachTransform(stage, LAYOUT.approche.ecran, kioskTarget)'));
  assert.match(tsx, /\(min-width: 769px\) and \(pointer: fine\)[\s\S]{0,200}kioskScreenBoxDesktop\([\s\S]{0,120}kioskScreenBox\(/, 'sans WebGL sur un bureau, la cible est l\'écran PC de l\'interface');
  assert.ok(tsx.includes('mobileChoicesLeaving'), 'la barre des boutons s\'efface pendant le film');
});
```

Dans `kiosk-wiring.test.mjs` : le test de la ligne 257 (« pendant le zoom vers la borne, la scène 3D ne se monte pas ») garde son sens — le renommer « pendant le film » et lui faire lire `film.start()` au lieu du zoom ; celui de la ligne 319 (« deux appuis rapprochés ne zooment pas ») : garder la garde contre le double appui, exprimée sur la phase du film.

- [ ] **Step 2: Constater l'échec.**
- [ ] **Step 3: `ExteriorView`, branche mobile** — un seul crochet pour les deux branches (`url`, durée et `ecran` pris dans la mise en page de la branche active) ; la scène porte la balise `<video>` (mêmes attributs qu'au bureau), calée sur l'image ; en phase `playing` la scène reçoit `approachTransform(stage, LAYOUT.approche.ecran, kioskTarget)` par la même transition — `kioskTarget` est `kioskScreenBoxDesktop(…)` quand `window.matchMedia('(min-width: 769px) and (pointer: fine)')` répond (bureau retombé sur l'image fixe faute de WebGL : `KioskView` y garde son gabarit PC), `kioskScreenBox(…)` sinon —, la barre prend `mobileChoicesLeaving`, les zones ne répondent plus sauf pour passer le film. Tout le zoom disparaît : états, effets, vue rapprochée, voile, minuteur.
- [ ] **Step 4: Feuille de style et `storefront-layout.ts`** — classes et fonction mortes retirées ; en-tête du module mis à jour.
- [ ] **Step 5: Tests** — deux fichiers verts, `npx tsc --noEmit -p .`, suite complète : 9 échecs connus.
- [ ] **Step 6: Commit** — `feat(devanture): le film d'approche remplace le zoom sur mobile`

### Task 9: Vérification à l'écran et documentation

**Files:**
- Create: `.superpowers/sdd/2026-11-18-borne-devanture-bureau-approche/verification/verif.cjs` (hors dépôt)
- Modify: `AGENTS.md`, `tools/devanture-borne/README.md`, `docs/superpowers/specs/2026-11-18-borne-devanture-bureau-design.md` (statut, journal de ce qui a été mesuré)

**Interfaces:**
- Consumes: tout ce qui précède, sur un build de production servi sur le port 3002.

- [ ] **Step 1: Build de production et serveur** (recette `borne-recettes-verification.md` : `rm -rf .next`, build, liens `public` et `.next/static`, serveur autonome port 3002).
- [ ] **Step 2: Script de vérification** (Playwright, `chromium.launch({ channel: 'chrome', headless: true })` avec les options WebGPU de la recette ; partir de `.superpowers/sdd/2026-11-18-borne-devanture-mobile/verification/verif.cjs`). Pour les fenêtres bureau 1280 × 720, 1440 × 900, 1920 × 1080, 2560 × 1080, 2560 × 1440 et téléphone 360 × 640, 412 × 915, 412 × 700 (tactile, `isMobile`), mesurer et afficher :
  1. zones de la borne et de la porte contre la mise en page (écart ≤ 1 px) ; indicateurs présents ;
  2. **départ du film** : capture juste avant le choix et à la première image présentée — écart absolu moyen dans la boîte de l'image ≤ 6 sur 255 (pluie et phares compris) et aucune capture dont la moyenne tombe sous 4 (image noire) pendant tout le parcours (captures toutes les 150 ms) ;
  3. **arrivée** : rectangle de l'écran filmé (boîte de la scène transformée × `approche.ecran`) contre `[class*="KioskView_ks__"]` — écart ≤ 3 px sur chaque bord ;
  4. images réellement présentées pendant le film (`requestVideoFrameCallback`) : ≥ 80 sur 91 ;
  5. clic pendant le film → borne ouverte en moins de 600 ms ; double clic → une seule ouverture ;
  6. film bloqué (`page.route` qui interrompt le `.mp4`) → borne ouverte en moins de 600 ms après le choix, sans image noire ;
  7. `reducedMotion: 'reduce'` → aucune lecture (`video.currentTime === 0`), borne ouverte ;
  8. « Quitter » → devanture entière, puis second choix : le film rejoue (première image présentée, `currentTime` reparti de 0) ;
  9. bureau sans WebGL (`--disable-3d-apis`, fenêtre 1280 × 720) : devanture fixe, film du mobile, écran filmé contre l'écran réel de l'interface — écart ≤ 8 px (le reste est couvert par le fondu) ;
  10. bureau : capture pendant le passage d'un véhicule — reflet présent sur la borne (écart avec une capture sans véhicule dans la boîte de la borne) et nul sur le mur ajouté au-dessus des 14 % du bas.
  Expected : chaque ligne `OK`, un total affiché. Tout `ÉCHEC` se corrige par `superpowers:systematic-debugging`, avec un test qui le reproduit quand c'est du code.
- [ ] **Step 3: Regarder** — lire des captures du bureau (devanture au repos, survol de la borne, mi-parcours, arrivée, borne ouverte) sur 1920 × 1080 et 2560 × 1440, et du téléphone sur 412 × 915 : rien de grossier, pas de bord dur choquant sur 2560 × 1440 (limite annoncée dans la spec § 6.3 : la décrire telle qu'elle est).
- [ ] **Step 4: Documentation** — `AGENTS.md` : section « Devanture » (bureau fabriqué, film d'approche, `useApproachFilm`, apparition de la borne, plus de zoom, Playwright et H.264) ; README de la fabrique (variantes, masque, approche, sorties, poids mesurés) ; spec : statut « construit », mesures (poids des films, écarts mesurés), ce qui n'est pas vérifié (vrai téléphone, Safari, iPad).
- [ ] **Step 5: Suite complète** — `node --test "tests/**/*.test.mjs"` → 9 échecs connus, pas un de plus. **Commit** — `docs(devanture): devanture du bureau et approche filmée — mesures et mode d'emploi`
- [ ] **Step 6: Montrer à Rusmir** — les captures et les deux films en situation ; son verdict visuel sur la devanture animée du bureau et sur les deux approches clôt le chantier. Arrêter le serveur du port 3002 s'il n'est plus utile.
