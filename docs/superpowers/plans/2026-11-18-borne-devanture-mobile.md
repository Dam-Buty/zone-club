# Borne sur la devanture mobile (lot 3, livraison A) — plan d'exécution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Rusmir a choisi l'exécution **en ligne** (superpowers:executing-plans, un relecteur neuf à la fin) pour tous les plans de la borne, et demandé que celui-ci soit exécuté **dans une session neuve**.

**Goal:** La devanture mobile du site montre la borne validée à côté de la porte ; deux boutons mènent à la borne ou à la porte ; choisir la borne zoome sur son écran puis ouvre l'interface de location.

**Architecture:** La fabrication des images (scripts Python + Blender de l'essai validé) entre dans le dépôt sous `tools/devanture-borne/` et produit, d'une commande, les deux images du site et un fichier de mise en page (où sont la borne, son écran et la porte dans l'image). Côté site, la devanture mobile devient une « scène » dimensionnée comme l'image : zones d'appui et zoom s'en déduisent par des fonctions pures, testées. L'interface de la borne (`KioskView`) n'est pas modifiée.

**Tech Stack:** Python 3.11 (PIL, numpy, scipy), Blender 5.3 (Cycles, Metal), Next.js 16 / React 19, CSS Modules, tests `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-16-borne-location-design.md` — § 3 (parcours), § 5 (devanture), § 9 (fabrication des images), § 10 (lot 3), et le journal de décisions en tête du document (entrées du 18/11/2026).

## État de départ (à lire avant la tâche 1)

- Worktree `~/projetsperso/video-club-webgpu-borne`, branche `feat/borne-location`, **commits locaux uniquement, ni push ni PR**.
- L'essai jetable du lot 3 est **validé par Rusmir le 18/11/2026** (« c'est bon pour moi je valide »). Il vit dans `.superpowers/lot3-essai/` (ignoré par git, ~240 Mo). Image de référence : `.superpowers/lot3-essai/essai10-compo.png` (1536 × 2752). Récit et pièges : `.superpowers/lot3-essai/REPRISE.md` (**à lire en entier**).
- Scripts actifs de l'essai : `fond.py` (mur, toit, ciel, lune autour de la photo), `textures.py` (usure, tranches tirées de TMDB, afficheur…), `neon_graphe.py` + `neon.py` (parcours des tubes du néon), `borne.py` (scène Blender ; passes `borne` et `mur`), `compo.py` (composition, halo, pluie), `gros_plan.py`, `charge.py`, `mesure_neon.py`, `essai.sh`, `passe_mur.sh`, `geometrie.json`. Commande qui refait tout l'essai : `sh essai.sh essai10 128 256 <dossier de journaux>`.
- Blender : `/Applications/Blender 5.3.app/Contents/MacOS/Blender`. Premier rendu Metal d'une session ≈ 3 min (compilation), les suivants ≈ 10 s.
- Mesuré sur l'image validée : borne colonnes 237 à 813, haut ligne 1844 ; écran de la borne ≈ colonnes 536 à 701, lignes 2047 à 2344 (0,30 × 0,54 m, rapport 5:9) ; porte colonnes 879 à 1483, haut de son cadre ligne 1546.
- Site, aujourd'hui (`src/components/exterior/ExteriorView.tsx`, lu le 18/11) : sur mobile, `<picture>` avec `/storefront-mobile.webp` puis `/storefront-mobile.jpeg` en `object-fit: cover; object-position: center top` ; zones d'appui en pourcentages **de la fenêtre** (`.mobileDoorHotspot` : `left 37 % ; top 56 % ; width 44 % ; height 20 %`), sans lien avec le cadre réel de l'image ; bouton provisoire `.kioskButtonMobile`. `App.tsx:575-580` : `openKiosk` fait `pauseInteriorPreload(); setInteriorPrewarm(false); setScene('kiosk')`. La devanture est démontée dès que la scène passe à `kiosk`.
- Écran de `KioskView` sur téléphone (`KioskView.module.css`) : `--ks-w: min(100vw - 12px, calc((100dvh - var(--kiosk-reserve)) * 5 / 9))`, réserve 84 px (26 px sous `max-height: 760px`), rapport 5/9.
- Recettes de vérification (seed, build de production, serveur autonome sur le port 3002, Playwright) : mémoire `borne-recettes-verification.md`.

## Global Constraints

- **Mobile seulement.** La devanture PC (`ExteriorScene.ts`, `storefront.jpeg`, `storefront-mask.png`, zones du bureau) ne change pas : elle garde son bouton provisoire. Elle fera l'objet d'un plan B.
- **`KioskView` ne change pas** : son enseigne « LOCATION 24/7 », son cadre et sa vitre restent tels quels (Rusmir, 18/11 : « laisse Location 24/7 tel quel sur la borne elle-même »).
- **Le GPU est libéré dès l'appui** sur la borne (décision de Rusmir du 16/11) : `pauseInteriorPreload()` et `setInteriorPrewarm(false)` partent à l'appui, pas à la fin du zoom.
- Règles de la borne : pas de bouton `disabled` ; zones d'appui ≥ 44 px ; pictogrammes en SVG ; pas de `backdrop-filter` ; textes en français.
- `prefers-reduced-motion: reduce` : pas de zoom, la borne s'ouvre directement.
- Les images du site gardent leurs noms : `public/storefront-mobile.webp` et `public/storefront-mobile.jpeg`, 1536 × 2752 (le préchargement de `app/layout.tsx` continue de marcher). Nouvelle image : `public/storefront-borne-zoom.webp`.
- Tests : `node --test` sur des `.test.mjs` ; un module TS importé par un test ne doit avoir **aucun import de valeur**. Base connue : 9 échecs préexistants (budget de taille, 6 tests d'intégration, P-01, sf-island-fill).
- Poste de travail : `grep`, `rg` et `sed`/`awk` par motif sont refusés (lire les fichiers, ou chercher en Python) ; jamais `git add -A` ; serveur de vérification sur le **port 3002** ; l'outil Write refuse un fichier modifié par script depuis sa lecture (écrire alors par `cat > … <<'EOF'`).
- Le Python de la machine refuse le certificat des serveurs TMDB : télécharger par `curl` (déjà fait dans `textures.py`).

## Review Focus

1. **Fenêtres qui rognent l'image** — 360 × 640, 390 × 844, 412 × 915, 412 × 700 (barres du navigateur), et le repli paysage (bureau sans WebGL, 1280 × 720) : la borne et la porte restent visibles et appuyables, les zones tombent sur leurs objets.
2. **Vue rapprochée pas encore chargée à l'appui** (réseau lent) : le zoom part quand même et la borne s'ouvre.
3. **Double appui, ou appui sur la porte pendant le zoom** : une seule transition, jamais la borne puis le vidéoclub.
4. **Animations réduites** : la borne s'ouvre sans zoom.
5. **Retour de la borne (« Quitter »)** : la devanture revient dézoomée, zones actives, préchargements de l'intérieur relancés.

---

### Task 1: La fabrication entre dans le dépôt

**Files:**
- Create: `tools/devanture-borne/` — y copier depuis `.superpowers/lot3-essai/` : `fond.py`, `textures.py`, `neon_graphe.py`, `neon.py`, `borne.py`, `compo.py`, `gros_plan.py`, `charge.py`, `mesure_neon.py`, `geometrie.json`
- Create: `tools/devanture-borne/sources/` — `storefront-mobile.jpeg` (la photo d'origine du mobile, à copier depuis `.superpowers/lot3-essai/` : elle va être remplacée dans `public/`), `gyro-face.png` (capture de l'interface, texture de l'écran), les quatre autocollants d'origine (lus aujourd'hui dans `~/Downloads` par `textures.py`, ligne `DL = Path.home() / 'Downloads'`), `tranches.json`
- Create: `tools/devanture-borne/fabrique.sh`, `tools/devanture-borne/README.md`, `tools/devanture-borne/.gitignore` (ignore `travail/`)
- Test: `tests/architecture/devanture-borne.test.mjs`

**Interfaces:**
- Produces: `sh tools/devanture-borne/fabrique.sh [échantillons borne] [échantillons mur]` — écrit tout l'intermédiaire dans `tools/devanture-borne/travail/` (ignoré) et laisse `travail/compo.png` (1536 × 2752). Les tâches 2 et suivantes ajoutent ses sorties vers `public/` et `src/data/`.
- Produces: `tools/devanture-borne/sources/tranches.json` — liste figée `[{ "tmdb_id", "title", "poster_url" }]`, dans l'ordre des tranches.

- [ ] **Step 1: Écrire le test qui échoue**

```js
// tests/architecture/devanture-borne.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const T = path.join(ROOT, 'tools/devanture-borne');

test('FABRIQUE: les scripts et les sources de la devanture sont dans le dépôt', () => {
  for (const f of ['fabrique.sh', 'README.md', 'geometrie.json', 'fond.py', 'textures.py', 'neon_graphe.py', 'neon.py', 'borne.py', 'compo.py',
    'sources/storefront-mobile.jpeg', 'sources/gyro-face.png', 'sources/tranches.json']) {
    assert.ok(existsSync(path.join(T, f)), f);
  }
});

test('FABRIQUE: aucun script ne dépend du dossier de l\'essai, de ~/Downloads ni de la base locale', () => {
  for (const f of ['fond.py', 'textures.py', 'neon.py', 'borne.py', 'compo.py', 'fabrique.sh']) {
    const src = readFileSync(path.join(T, f), 'utf8');
    assert.ok(!src.includes('.superpowers'), `${f} : .superpowers`);
    assert.ok(!src.includes('Downloads'), `${f} : Downloads`);
    assert.ok(!src.includes('zone.db') && !src.includes('sqlite3'), `${f} : base locale`);
  }
});

test('FABRIQUE: les tranches sont figées (96 films)', () => {
  const tr = JSON.parse(readFileSync(path.join(T, 'sources/tranches.json'), 'utf8'));
  assert.equal(tr.length, 96);
  for (const t of tr) assert.ok(Number.isInteger(t.tmdb_id) && t.title && t.poster_url.startsWith('https://image.tmdb.org/'));
});
```

- [ ] **Step 2: Le lancer, vérifier qu'il échoue**

Run: `node --test tests/architecture/devanture-borne.test.mjs`
Expected: FAIL (fichiers absents)

- [ ] **Step 3: Copier les scripts et les sources ; figer les tranches**

`textures.py` tire aujourd'hui la liste des films de `zone.db` (argument 2) puis la mélange : écrire une fois `sources/tranches.json` avec les 96 films **dans l'ordre qu'il produit aujourd'hui** (même graine), puis le lui faire lire à la place de la base. Les autocollants et la capture d'écran se lisent dans `sources/`. Tous les chemins partent du dossier du script ; l'intermédiaire (`fond.png`, `repere.json`, `tex/`, `tmdb-cache/`, `neon-borne.json`, `mur-passe.npy`…) va dans `travail/`. La clé TMDB reste lue dans le `.env` de la racine, jamais affichée.

- [ ] **Step 4: Écrire `fabrique.sh` et `README.md`**

`fabrique.sh` enchaîne, en s'arrêtant à la première erreur : `fond.py` → `textures.py` → `neon.py` → `borne.py` (passe `borne`) → `borne.py` (passe `mur`) → `compo.py` → `travail/compo.png`. Échantillons par défaut : 256 et 384. Le README dit ce qu'il faut (Blender 5.3, polices du Mac, clé TMDB), ce que chaque script fait en une ligne, et renvoie au document de conception.

- [ ] **Step 5: Lancer la fabrique et comparer à l'image validée**

Run: `sh tools/devanture-borne/fabrique.sh 128 256 && python3 -c "from PIL import Image, ImageChops, ImageStat; a=Image.open('tools/devanture-borne/travail/compo.png').convert('RGB'); b=Image.open('.superpowers/lot3-essai/essai10-compo.png').convert('RGB'); print(a.size, [round(v,2) for v in ImageStat.Stat(ImageChops.difference(a,b)).mean])"`
Expected: `(1536, 2752)` et un écart moyen **inférieur à 1,5** par canal (bruit de rendu). Au-delà, quelque chose a changé en chemin : chercher quoi avant de continuer.

- [ ] **Step 6: Tests, puis commit**

Run: `node --test tests/architecture/devanture-borne.test.mjs` → PASS ; `npm run audit:unused` → pas de nouvel orphelin.

```bash
git add tools/devanture-borne tests/architecture/devanture-borne.test.mjs
git commit -m "build(devanture): la fabrication des images de la borne entre dans le dépôt"
```

### Task 2: Les images du site et leur mise en page

**Files:**
- Modify: `tools/devanture-borne/borne.py`, `tools/devanture-borne/compo.py`, `tools/devanture-borne/fabrique.sh`
- Create: `public/storefront-borne-zoom.webp`, `src/data/storefront-mobile.json`
- Modify (remplacés par la fabrique): `public/storefront-mobile.webp`, `public/storefront-mobile.jpeg`
- Test: `tests/architecture/devanture-borne.test.mjs`

**Interfaces:**
- Produces: `src/data/storefront-mobile.json` — toutes les positions en **fractions de l'image** (0 à 1, origine en haut à gauche) :

```json
{
  "image": { "w": 1536, "h": 2752 },
  "borne": { "x0": 0, "y0": 0, "x1": 0, "y1": 1 },
  "ecran": { "x0": 0, "y0": 0, "x1": 0, "y1": 0 },
  "porte": { "x0": 0, "y0": 0, "x1": 0, "y1": 1 },
  "push": { "x": 0, "y": 0 },
  "groupe": { "cx": 0, "cy": 0.72 },
  "zoom": { "x0": 0, "y0": 0, "x1": 0, "y1": 0, "w": 1560, "h": 2340 }
}
```

`borne`, `ecran` : projetés par la caméra de `borne.py` (`world_to_camera_view`, comme pour `neon-bbox.json`), pas recopiés à la main. `porte` : de `repere.json` (`door_left_x`, `door_right_x`) et du haut du cadre de la porte (`geometrie.json` → `mur.porte_px.haut`), bas à 1. `push` : la plaque « PUSH » de la porte (aujourd'hui `left: calc(70.5% + 20px); top: 63.5%` de la fenêtre : la retrouver sur l'image). `groupe.cx` : milieu entre le bord gauche de la borne et le bord droit de la porte. `zoom` : la zone de l'image que couvre la vue rapprochée, et sa taille en pixels.

- [ ] **Step 1: Ajouter les tests qui échouent**

```js
// à la suite de tests/architecture/devanture-borne.test.mjs
function tailleWebp(buf) {              // VP8X, VP8L ou VP8 : largeur et hauteur
  const tag = buf.toString('ascii', 12, 16);
  if (tag === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
  if (tag === 'VP8L') { const b = buf.readUInt32LE(21); return [1 + (b & 0x3fff), 1 + ((b >> 14) & 0x3fff)]; }
  return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
}

test('IMAGES: la devanture mobile et la vue rapprochée ont les tailles annoncées', () => {
  const L = JSON.parse(readFileSync(path.join(ROOT, 'src/data/storefront-mobile.json'), 'utf8'));
  assert.deepEqual(tailleWebp(readFileSync(path.join(ROOT, 'public/storefront-mobile.webp'))), [1536, 2752]);
  assert.deepEqual([L.image.w, L.image.h], [1536, 2752]);
  assert.deepEqual(tailleWebp(readFileSync(path.join(ROOT, 'public/storefront-borne-zoom.webp'))), [L.zoom.w, L.zoom.h]);
});

test('IMAGES: la mise en page est cohérente', () => {
  const L = JSON.parse(readFileSync(path.join(ROOT, 'src/data/storefront-mobile.json'), 'utf8'));
  const dans = (a, b) => a.x0 >= b.x0 && a.x1 <= b.x1 && a.y0 >= b.y0 && a.y1 <= b.y1;
  assert.ok(dans(L.ecran, L.borne), 'l\'écran est dans la borne');
  assert.ok(dans(L.ecran, L.zoom), 'la vue rapprochée couvre l\'écran');
  assert.ok(L.borne.x1 < L.porte.x0, 'la borne est à gauche de la porte');
  const ratio = ((L.ecran.y1 - L.ecran.y0) * L.image.h) / ((L.ecran.x1 - L.ecran.x0) * L.image.w);
  assert.ok(Math.abs(ratio - 9 / 5) < 0.03, `écran 5:9, mesuré ${ratio}`);
  assert.ok(Math.abs((L.zoom.x1 - L.zoom.x0) * L.image.w / ((L.ecran.x1 - L.ecran.x0) * L.image.w) - 2) < 0.05, 'vue rapprochée : deux largeurs d\'écran');
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `node --test tests/architecture/devanture-borne.test.mjs`
Expected: FAIL (`storefront-mobile.json` absent)

- [ ] **Step 3: Faire écrire la mise en page par `borne.py` (passe `borne`)** dans `travail/mise-en-page.json`, selon le schéma ci-dessus.

- [ ] **Step 4: Ajouter la passe `zoom` à `borne.py`** — même caméra, même scène, rendu limité à la zone `zoom` par `render.border` (avec `use_crop_to_border = True`) et `resolution_percentage` réglé pour que l'écran fasse **780 px de large**. Zone : centrée sur l'écran, **2 largeurs d'écran de large et 3 de haut** (elle tient tout entière dans la borne : ni mur ni photo). Sortie opaque, sans halo ni pluie : `travail/zoom.png`, 1560 × 2340.

- [ ] **Step 5: Faire encoder les sorties par `fabrique.sh`** : `travail/compo.png` → `public/storefront-mobile.webp` (qualité 84) et `public/storefront-mobile.jpeg` (qualité 88) ; `travail/zoom.png` → `public/storefront-borne-zoom.webp` (qualité 82) ; `travail/mise-en-page.json` → `src/data/storefront-mobile.json`. Afficher le poids des trois images.

- [ ] **Step 6: Fabriquer, regarder, tester**

Run: `sh tools/devanture-borne/fabrique.sh && node --test tests/architecture/devanture-borne.test.mjs`
Expected: PASS. **Ouvrir les trois images** : la devanture est identique à l'image validée ; la vue rapprochée est nette, l'écran centré, la façade de la borne autour.

- [ ] **Step 7: Commit**

```bash
git add tools/devanture-borne public/storefront-mobile.webp public/storefront-mobile.jpeg public/storefront-borne-zoom.webp src/data/storefront-mobile.json tests/architecture/devanture-borne.test.mjs
git commit -m "feat(devanture): images mobiles avec la borne, vue rapprochée et mise en page"
```

### Task 3: La géométrie de la scène, en fonctions pures

**Files:**
- Create: `src/components/exterior/storefront-layout.ts` (aucun import de valeur)
- Test: `tests/domain/storefront-layout.test.mjs`

**Interfaces:**
- Consumes: le schéma de `src/data/storefront-mobile.json` (tâche 2).
- Produces:

```ts
export interface Rect { x0: number; y0: number; x1: number; y1: number }
export interface StorefrontLayout {
  image: { w: number; h: number }; borne: Rect; ecran: Rect; porte: Rect;
  push: { x: number; y: number }; groupe: { cx: number; cy: number };
  zoom: Rect & { w: number; h: number };
}
export interface Box { left: number; top: number; width: number; height: number }
/** La scène : l'image posée en « cover » dans la fenêtre, cadrée sur le groupe borne + porte. */
export function stageBox(layout: StorefrontLayout, vw: number, vh: number): Box;
/** Où sera l'écran de KioskView (formule de KioskView.module.css, téléphone). */
export function kioskScreenBox(vw: number, vh: number): Box;
/** Transformation CSS de la scène (transform-origin 0 0) qui amène l'écran de la borne sur kioskScreenBox. */
export function zoomTransform(layout: StorefrontLayout, vw: number, vh: number): { scale: number; x: number; y: number };
```

`stageBox` : `width = max(vw, vh × w/h)`, `height = width × h/w`, `left = clamp(vw − width, vw/2 − cx × width, 0)`, `top = clamp(vh − height, vh/2 − cy × height, 0)`. `kioskScreenBox` : largeur `min(vw − 12, (vh − réserve) × 5/9)` avec réserve 84, ou 26 si `vh ≤ 760` ; centré en largeur ; position verticale à lire dans `KioskView.module.css` (`.root`, `.sign`, `.body`) — si elle ne se déduit pas simplement, centrer l'écran dans la hauteur restante sous l'enseigne et le dire en commentaire (l'écart est couvert par le fondu final). `zoomTransform` : `scale = cible.width / (largeur de l'écran dans la scène)`, puis la translation qui pose le coin haut-gauche de l'écran sur celui de la cible.

- [ ] **Step 1: Écrire les tests qui échouent**

```js
// tests/domain/storefront-layout.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { stageBox, kioskScreenBox, zoomTransform } from '../../src/components/exterior/storefront-layout.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const L = JSON.parse(readFileSync(path.join(ROOT, 'src/data/storefront-mobile.json'), 'utf8'));
const FENETRES = [[360, 640], [390, 844], [412, 915], [412, 700], [1280, 720]];

test('SCÈNE: l\'image couvre toujours la fenêtre, sans bord vide', () => {
  for (const [vw, vh] of FENETRES) {
    const s = stageBox(L, vw, vh);
    assert.ok(s.left <= 0.5 && s.top <= 0.5 && s.left + s.width >= vw - 0.5 && s.top + s.height >= vh - 0.5, `${vw}x${vh}`);
    assert.ok(Math.abs(s.width / s.height - L.image.w / L.image.h) < 1e-6, 'proportions de l\'image');
  }
});

test('SCÈNE: sur téléphone, la borne et la porte sont visibles sur toute leur largeur', () => {
  for (const [vw, vh] of FENETRES.slice(0, 4)) {
    const s = stageBox(L, vw, vh);
    const x = (f) => s.left + f * s.width;
    // Sur les fenêtres les plus hautes, le groupe est à peine plus large que la fenêtre : 4 px de montant tolérés.
    assert.ok(x(L.borne.x0) >= -4 && x(L.porte.x1) <= vw + 4, `${vw}x${vh} : ${x(L.borne.x0)} … ${x(L.porte.x1)}`);
  }
});

test('ZOOM: l\'écran de la borne arrive sur celui de l\'interface', () => {
  for (const [vw, vh] of FENETRES.slice(0, 4)) {
    const s = stageBox(L, vw, vh), k = kioskScreenBox(vw, vh), z = zoomTransform(L, vw, vh);
    const gauche = s.left + z.x + z.scale * L.ecran.x0 * s.width;
    const haut = s.top + z.y + z.scale * L.ecran.y0 * s.height;
    const largeur = z.scale * (L.ecran.x1 - L.ecran.x0) * s.width;
    assert.ok(Math.abs(gauche - k.left) < 0.5 && Math.abs(haut - k.top) < 0.5 && Math.abs(largeur - k.width) < 0.5, `${vw}x${vh}`);
    assert.ok(z.scale > 3, 'c\'est bien un zoom');
  }
});

test('ZOOM: la formule de l\'écran suit celle de KioskView.module.css', () => {
  const css = readFileSync(path.join(ROOT, 'src/components/kiosk/KioskView.module.css'), 'utf8');
  assert.ok(css.includes('min(100vw - 12px, calc((100dvh - var(--kiosk-reserve)) * 5 / 9))'), 'largeur de l\'écran');
  assert.ok(css.includes('--kiosk-reserve: 84px') && css.includes('max-height: 760px'), 'réserve');
  assert.equal(kioskScreenBox(412, 915).width, 400);
  assert.equal(Math.round(kioskScreenBox(360, 640).width), Math.round((640 - 26) * 5 / 9));
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `node --test tests/domain/storefront-layout.test.mjs`
Expected: FAIL (module absent)

- [ ] **Step 3: Écrire `storefront-layout.ts`** selon les signatures ci-dessus.

- [ ] **Step 4: Vérifier le succès**

Run: `node --test tests/domain/storefront-layout.test.mjs && npx tsc --noEmit -p .`
Expected: PASS, aucun diagnostic. Sur 412 × 915 (plein écran), le groupe borne + porte fait environ 414 px pour 412 : c'est attendu, d'où la tolérance. Si une fenêtre rogne davantage, le consigner (Ruling) et garder le cadrage centré sur le groupe plutôt que de déformer l'image.

- [ ] **Step 5: Commit**

```bash
git add src/components/exterior/storefront-layout.ts tests/domain/storefront-layout.test.mjs
git commit -m "feat(devanture): géométrie de la scène mobile et du zoom vers la borne"
```

### Task 4: La devanture mobile devient une scène, avec ses deux boutons

**Files:**
- Modify: `src/components/exterior/ExteriorView.tsx` (branche `isStatic`, lignes 184-227), `src/components/exterior/ExteriorView.module.css` (bloc mobile, à partir de `.mobileImageContainer`)
- Test: `tests/domain/kiosk-wiring.test.mjs` (adapter les assertions existantes sur `ExteriorView`, lignes 33-37 et 262-271), `tests/domain/storefront-layout.test.mjs`

**Interfaces:**
- Consumes: `stageBox`, `StorefrontLayout` (tâche 3) ; `src/data/storefront-mobile.json` (tâche 2).
- Produces: dans la branche mobile de `ExteriorView`, un élément `.mobileStage` dimensionné par `stageBox(layout, innerWidth, innerHeight)` (recalculé au `resize`), qui contient l'image et **toutes** les zones, placées en pourcentages de la scène ; `openKiosk` reste la seule porte vers `onOpenKiosk` et garde son garde `isTransitioning`.

Ce que voit le visiteur :
- la borne entière et la porte entière sont des zones d'appui (boutons transparents, `aria-label` « Ouvrir la borne de location » et « Entrer dans le vidéoclub ») ;
- l'indicateur « PUSH ▼ » reste sur la plaque de la porte (`layout.push`) ;
- **en bas de la fenêtre, une barre de deux boutons** : à gauche « BORNE 24/7 » avec « louer sans entrer », à droite « PORTE VIDÉOCLUB » avec « entrer », chacun avec une flèche SVG pointant vers son objet (haut-gauche, haut-droite). Hauteur ≥ 52 px, `padding-bottom: env(safe-area-inset-bottom)`. **[C], à confirmer par Rusmir** : le document prévoyait les boutons « au-dessus de chaque élément », place aujourd'hui prise par les néons « BORNE 24/7 » et « Open 24/7 ».
- le bouton provisoire `.kioskButtonMobile` et le texte « Appuyez pour entrer » disparaissent ; le bureau garde `kioskButton(styles.kioskButton)`.

- [ ] **Step 1: Écrire les tests qui échouent** — dans `tests/domain/storefront-layout.test.mjs` :

```js
test('DEVANTURE MOBILE: une scène porte l\'image et les zones, deux boutons en bas', () => {
  const tsx = readFileSync(path.join(ROOT, 'src/components/exterior/ExteriorView.tsx'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'src/components/exterior/ExteriorView.module.css'), 'utf8');
  const mobile = tsx.slice(tsx.indexOf('if (isStatic) {'), tsx.indexOf('// ===== DESKTOP'));
  assert.ok(mobile.includes('styles.mobileStage') && tsx.includes('stageBox('), 'scène dimensionnée par stageBox');
  assert.ok(mobile.includes('BORNE 24/7') && mobile.includes('PORTE VIDÉOCLUB'), 'les deux boutons');
  assert.ok(!mobile.includes('kioskButtonMobile') && !mobile.includes('Appuyez pour entrer'), 'plus de bouton provisoire');
  assert.ok(!mobile.includes('disabled'), 'pas de bouton désactivé');
  assert.ok(!css.includes('backdrop-filter'), 'pas de backdrop-filter');
  const barre = css.slice(css.indexOf('.mobileChoices'));
  assert.ok(barre.includes('safe-area-inset-bottom'), 'la barre respecte l\'encoche');
  assert.ok(tsx.includes("from '../../data/storefront-mobile.json'"), 'mise en page lue dans le fichier fabriqué');
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `node --test tests/domain/storefront-layout.test.mjs`
Expected: FAIL sur « scène dimensionnée par stageBox »

- [ ] **Step 3: Écrire la scène et la barre** dans `ExteriorView.tsx` et son CSS. L'image garde `ref={mobileImageRef}` et son `decode()` ; elle remplit la scène (`width: 100%; height: 100%`, plus de `object-fit`). Les zones sont des enfants de la scène, en `left/top/width/height` calculés depuis `layout.borne` et `layout.porte`.

- [ ] **Step 4: Adapter `tests/domain/kiosk-wiring.test.mjs`** aux assertions qui visaient le bouton provisoire sur mobile (sans changer ce qu'elles protègent : `openKiosk` existe, teste `isTransitioning`, et aucun `onClick={onOpenKiosk}` direct).

- [ ] **Step 5: Vérifier**

Run: `node --test tests/domain/storefront-layout.test.mjs tests/domain/kiosk-wiring.test.mjs && npx tsc --noEmit -p .`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/exterior/ExteriorView.tsx src/components/exterior/ExteriorView.module.css tests/domain/storefront-layout.test.mjs tests/domain/kiosk-wiring.test.mjs
git commit -m "feat(devanture): scène mobile calée sur l'image, boutons « BORNE 24/7 » et « PORTE VIDÉOCLUB »"
```

### Task 5: Le zoom vers l'écran de la borne

**Files:**
- Modify: `src/components/exterior/ExteriorView.tsx`, `src/components/exterior/ExteriorView.module.css`, `src/App.tsx` (lignes 575-611)
- Test: `tests/domain/storefront-layout.test.mjs`, `tests/domain/kiosk-wiring.test.mjs`

**Interfaces:**
- Consumes: `zoomTransform` (tâche 3), `layout.zoom` (tâche 2).
- Produces: `ExteriorViewProps` gagne `onKioskIntent?: () => void` — appelé **à l'appui**, avant toute animation. `App.tsx` lui passe une fonction stable qui fait `pauseInteriorPreload(); setInteriorPrewarm(false);` ; `openKiosk` (inchangé, idempotent) reste appelé à la fin du zoom.

Déroulé, sur mobile, à l'appui sur la borne ou sur « BORNE 24/7 » :
1. `isTransitioning` passe à vrai (la porte et les boutons ne répondent plus), `onKioskIntent()` part ;
2. la scène reçoit `transform: translate(x, y) scale(s)` de `zoomTransform`, `transform-origin: 0 0`, transition de **900 ms**, `cubic-bezier(0.45, 0, 0.2, 1)` ;
3. la vue rapprochée (`<img src="/storefront-borne-zoom.webp">`, enfant de la scène, posée sur `layout.zoom`) passe de transparente à opaque entre 35 % et 70 % de la durée — seulement si elle est décodée ; elle est demandée dès que la devanture est affichée (`new Image()` + `decode()`), pas avant ;
4. sur les 180 dernières millisecondes, un voile noir monte ; à la fin, `onOpenKiosk()`.
- `prefers-reduced-motion: reduce` (lu par `matchMedia` à l'appui) : étapes 2 à 4 sautées, `onOpenKiosk()` tout de suite.
- Un minuteur de garde appelle `onOpenKiosk()` à 1 200 ms si `transitionend` n'arrive pas (onglet en arrière-plan). Les minuteurs sont nettoyés au démontage.
- Sur le bureau, rien ne change : le bouton provisoire appelle `onKioskIntent()` puis `onOpenKiosk()` aussitôt.

- [ ] **Step 1: Écrire les tests qui échouent**

```js
// tests/domain/storefront-layout.test.mjs
test('ZOOM: câblage dans la devanture', () => {
  const tsx = readFileSync(path.join(ROOT, 'src/components/exterior/ExteriorView.tsx'), 'utf8');
  const app = readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8');
  assert.ok(tsx.includes('onKioskIntent') && tsx.includes('zoomTransform('), 'intention à l\'appui, puis zoom');
  assert.ok(tsx.includes('prefers-reduced-motion'), 'animations réduites');
  assert.ok(tsx.includes('/storefront-borne-zoom.webp'), 'vue rapprochée');
  const ouvrir = tsx.slice(tsx.indexOf('const openKiosk = '), tsx.indexOf('const openKiosk = ') + 900);
  assert.ok(ouvrir.indexOf('isTransitioning') < ouvrir.indexOf('onKioskIntent'), 'le garde passe avant tout');
  assert.ok(ouvrir.indexOf('onKioskIntent') < ouvrir.indexOf('onOpenKiosk'), 'le GPU est libéré avant l\'ouverture');
  const jsx = app.slice(app.indexOf('<ExteriorView'), app.indexOf('<ExteriorView') + 400);
  assert.ok(jsx.includes('onKioskIntent='), 'App branche l\'intention');
});
```

- [ ] **Step 2: Vérifier l'échec** — Run: `node --test tests/domain/storefront-layout.test.mjs` → FAIL sur « intention à l'appui »

- [ ] **Step 3: Écrire le zoom** (état, styles, vue rapprochée, voile, garde, nettoyage) et brancher `App.tsx`.

- [ ] **Step 4: Vérifier** — Run: `node --test "tests/**/*.test.mjs"` → les 9 échecs préexistants seulement ; `npx tsc --noEmit -p .` → rien.

- [ ] **Step 5: Commit**

```bash
git add src/components/exterior/ExteriorView.tsx src/components/exterior/ExteriorView.module.css src/App.tsx tests/domain/storefront-layout.test.mjs tests/domain/kiosk-wiring.test.mjs
git commit -m "feat(devanture): zoom vers l'écran de la borne avant d'ouvrir l'interface"
```

### Task 6: Vérification à l'écran et documentation

**Files:**
- Modify: `AGENTS.md` (sections « Arborescence », « Frontend 3D → Extérieur », et la partie borne), `docs/superpowers/specs/2026-11-16-borne-location-design.md` (journal de décisions : livraison A faite, ce qui reste)

- [ ] **Step 1: Build de production et serveur sur le port 3002** (recette de la mémoire `borne-recettes-verification.md` : `rm -rf .next && RADARR_API_KEY=factice-verif npm run build`, liens `public` et `.next/static` dans `.next/standalone`, `PORT=3002 … node server.js`).

- [ ] **Step 2: Dérouler à l'écran, tactile simulé**, aux fenêtres 360 × 640, 390 × 844, 412 × 915, 412 × 700 : la devanture montre la borne et la porte ; chaque zone tombe sur son objet (vérifier par `getBoundingClientRect()` contre la mise en page, pas à l'œil) ; « BORNE 24/7 » zoome puis ouvre la borne ; « Quitter » ramène à la devanture dézoomée ; la porte entre dans le vidéoclub (ou affiche le message sans WebGPU) ; double appui → une seule transition ; `prefers-reduced-motion` → ouverture directe ; vue rapprochée bloquée (route interceptée) → le zoom part quand même. Capture de chaque étape.

- [ ] **Step 3: Bureau** : 1280 × 720 avec souris → devanture et bouton provisoire inchangés.

- [ ] **Step 4: Documenter** dans `AGENTS.md` : d'où viennent les images (`tools/devanture-borne/fabrique.sh`), le fichier de mise en page, la scène mobile et le zoom ; rappeler que le bureau attend le plan B.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md docs/superpowers/specs/2026-11-16-borne-location-design.md
git commit -m "docs(devanture): borne sur la devanture mobile, fabrication et zoom"
```

Puis la relecture finale (un relecteur neuf sur tout le plan), comme pour les plans précédents.

---

## Hors de ce plan

- **Plan B — devanture PC** : photo d'origine 5632 × 3072 (`git show f5123bb:public/storefront.jpeg`, masque au même commit), mur prolongé à gauche, borne rendue sous la perspective de la photo PC, masque de reflets mis à jour (R néons, G vitres, B métal), constante `5632 / 3072` (`ExteriorScene.ts:684` et `ExteriorView.tsx:11`), zones du bureau, zoom dans la scène WebGL. **Question à trancher avec Rusmir avant** : l'écran de la borne modélisée est au format 5:9, alors que l'interface sur PC est en 2:3.
- **Livraison 2 de la distribution** : le robot en mouvement et la vidéo de 8 secondes avec ses sons (`docs/superpowers/specs/2026-11-17-borne-distribution-k7-design.md`).
- Remplacer le cadre dessiné de `KioskView` par le rendu de la borne : non demandé, et contraire à « Location 24/7 reste tel quel ».
- Les tests sur le Pixel 9a et le Chromecast, repoussés par Rusmir.
