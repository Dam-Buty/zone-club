# Néon-noir — Éclairage baké (lightmap shell + volume de sondes) — Design

> **Statut** : design validé en brainstorming (29/05/2026). Dé-risqué par le workflow `lightbake-probe-derisk` (13 agents, confiance haute, 0 claim réfuté). Étend `docs/superpowers/plans/2026-05-29-lightmap-bake-pipeline.md` — ne le remplace pas.

## 1. Objectif

Refondre l'éclairage du vidéoclub 3D pour un rendu **néon-noir nocturne photoréaliste**, en calculant le GI **hors-ligne** (bake) et en le **lisant** au runtime WebGPU au lieu de le simuler avec ~14 RectAreaLights. Gain double : moins de pipelines lumière temps réel sur le **Mac Mini M1 (cible 30 fps)** *et* un GI multi-source (rebonds colorés, ombres douces, AO) impossible à faire en temps réel.

**Constat de départ** : le rig actuel (`Lighting.tsx`) compte **14 RectAreaLights + 3 PointLights + 1 hemisphere + 1 directional** + 16 tubes néon émissifs. La moitié des RectAreaLights (« wall-wash », « fill », « ceiling-bounce ») n'existe que pour **simuler à la main le GI absent**. Un bake calcule ce GI pour de vrai → ces fakes deviennent inutiles. C'est un héritage de l'ancienne version, non baké, non photoréaliste.

## 2. Décisions verrouillées (issues du brainstorming + dé-risk)

| Axe | Décision | Source |
|---|---|---|
| Ambiance | **Néon-noir nocturne** — flaques chaudes sous les fluo, néons colorés qui mordent, nuit froide à la vitrine, ombres marquées | choix utilisateur |
| Couleur | **Phasée, colour-ready** : grayscale d'abord (valide pipeline + FPS M1), couleur ensuite ; format conçu RGB dès le départ | choix utilisateur |
| Objets dynamiques | Éclairés par un **volume de sondes d'irradiance** (pas des fills temps réel) | choix utilisateur |
| Set d'émetteurs | **7 familles** (cf. §4) | choix utilisateur |
| Pipeline | **Approche A** : lightmap surface (raycaster BVH vendored) + sondes par **cubemap rendu depuis le shell déjà baké** → SH | choix utilisateur |
| Encodage sondes | **SH-L1 RGB** (12 floats/sonde), reconstruit par `getShIrradianceAt` natif de three (bandes 0+1). **PAS L2** (ringe sur néons vifs ; gain marginal sur K7 lambertiennes). Upgrade ZH3 = shader-only ultérieur | dé-risk |
| Grille sondes | **Uniforme anisotrope 1.0 m XZ / 0.7 m Y** → 10×4×10 ≈ 400 sondes (~250-300 après cull intérieur-solide). Densifier seulement si banding | dé-risk + utilisateur |
| Stockage sondes | **4× `Data3DTexture` RGBA16F (HalfFloat)**, `LinearFilter` **obligatoire**, `ClampToEdge`. ~30 Ko VRAM | dé-risk |
| Bake sondes | Cubemap 32px/face depuis le shell lightmappé → `LightProbeGenerator.fromCubeRenderTarget` (confirmé WebGPU/r184), offline WebGL2 | dé-risk |
| Terme direct | **Cartes émissives proxy offline** alignées sur chaque RectAreaLight dans la scène de capture (jamais shippées) — les RectArea ne se rasterisent pas dans un cubemap | dé-risk + utilisateur |
| Injection runtime | Via **`emissiveNode`** du material K7 (PAS `context.irradiance`/`LightProbeNode` → réactiverait le lighting Standard sur 520 instances), sample en **stage vertex** | dé-risk |
| Scope v1 | **K7 uniquement** (contenu principal). Manager + CRT/TV en v2 | choix utilisateur |
| uv channel | `uv1` (three 0.184 échantillonne `lightMap` depuis `uv1`) | plan existant |
| Flag | `?baked=1` ; chemin procédural reste le défaut tant que non validé sur M1 | plan existant |

## 3. Architecture (Approche A)

Deux produits bakés **offline** (page `/bake`, WebGL2), shippés dans `public/baked/`, consommés par le **runtime WebGPU** qui ne calcule plus le GI — il le lit.

```
OFFLINE (page /bake, WebGL2, piloté Playwright)
  buildBakeScene()  →  shell statique (MeshStandard) + rig néon-noir (7 familles)
        │ unwrap uv1 (xatlas) + MeshBVH (occluders)
        ├─ PASSE 1 · Lightmap shell
        │     g-buffer UV-space (pos/normale) → raycaster Monte-Carlo BVH (per-light sum)
        │     → lightmap HDR → tonemap ÷scale → PNG ; géométrie unwrappée → GLB
        └─ PASSE 2 · Volume de sondes  (DÉPEND de la passe 1)
              shell + lightMap appliqué + cartes proxy émissives
              → cubemap 32px/face à chaque point de grille (skip-si-dans-solide via BVH)
              → projection SH-L1 (LightProbeGenerator) → 4 Data3DTexture RGBA16F

SHIP · public/baked/
  shell.glb · shell-lightmap.png · probes.bin (volume SH-L1) · manifest.json (scale, dims, bounds)

RUNTIME · WebGPU (?baked=1)
  BakedShell           : shell.glb + material.lightMap (uv1), lightMapIntensity = scale
  K7 (InstancedMesh)   : sample volume sondes en VERTEX → getShIrradianceAt(normale) → emissiveNode
  Lighting.tsx allégé  : 14 RectAreaLights + 3 PointLights SUPPRIMÉES ; restent les meshes néon émissifs (bloom) + 1 fill de secours éventuel
```

## 4. Rig d'émetteurs néon-noir (`buildBakeScene`)

Remplace la transcription du rig hérité. Chaque famille est posée comme objet Three **dans la scène de bake offline uniquement**, avec intensités/couleurs pensées pour le bake. Les RectAreaLights ont en plus une **carte émissive proxy** co-localisée (pour le terme direct dans le cubemap des sondes).

| # | Émetteur | Type bake | Rôle |
|---|---|---|---|
| 1 | Tubes fluo plafond (chauds `#fff5e6`) | RectAreaLight + proxy émissif + meshes émissifs réels | flaques chaudes, lumière clé |
| 2 | Vitrine nocturne froide (`#5577aa`-ish) | RectAreaLight + proxy | rim froid, contraste nuit |
| 3 | Enseignes genre néon (magenta/cyan) | RectAreaLight colorée + proxy | la « morsure » colorée (color bleed) |
| 4 | Bandeaux sous étagères | RectAreaLight fine + proxy | dégradés verticaux riches sur les K7 |
| 5 | Lueur CRT/TV (bakée fixe) | mesh émissif bleuté | accent local zone canapé |
| 6 | Lampe comptoir chaude | RectAreaLight + proxy | point chaud accueillant |
| 7 | Clair de lune directionnel froid | DirectionalLight | longues ombres dures cinéma |

Positions/intensités exactes : transcrites/retouchées depuis `Lighting.tsx` (colonnes plafond X = -3.3/-1.0/2.3/3.8, îlots X≈-2.2/0.05, vitrine Z≈+4.15, comptoir X≈2.8 Z≈2.5) + `GenreSectionPanel.tsx` (enseignes), `Storefront.tsx` (vitrine), pièce 9×8.5×2.8 m (`constants.ts`). Détail des valeurs : à figer en implémentation, scène de bake validée visuellement sur `/bake`.

## 5. Volume de sondes v1 (sous-système nouveau)

### Encodage & stockage
- **SH-L1 RGB** : 4 coefficients/canal, stockés en **radiance brute** (pas pré-convoluée). Reconstruction au runtime via `getShIrradianceAt` natif (la convolution cosinus `0.886227/0.511664` y est déjà — **ne pas double-convoluer**), en n'utilisant que les 4 premiers termes (bandes 0+1), les 5 slots bande-2 passés à zéro.
- **4 `Data3DTexture` RGBA16F** (une par coefficient L1, RGB packé dans `.xyz`), `type = HalfFloatType`, `minFilter = magFilter = LinearFilter`, `wrapR/S/T = ClampToEdge`.
- Upgrade **ZH3-hallucinated** ultérieur = dérivation du terme zonal quadratique depuis les coeffs L1 **en TSL** → changement *shader-only*, zéro modif du layout Data3DTexture, zéro re-bake.

### Bake (passe 2, offline)
Par sonde de la grille : (1) skip si à l'intérieur d'un solide (BVH three-mesh-bvh déjà vendored) ; (2) `CubeCamera` + `WebGLCubeRenderTarget` (HalfFloatType, **RGBAFormat requis** par `fromCubeRenderTarget`), 32px/face, rendu sur le shell **avec son lightMap appliqué** + les cartes proxy émissives ; (3) `LightProbeGenerator.fromCubeRenderTarget` → `SphericalHarmonics3`, on garde les 4 coeffs L1. Sérialisation ordonnée x→y→z dans `probes.bin` + bounds/dims dans `manifest.json`.

### Runtime (TSL, K7)
Sample en **stage vertex** de l'InstancedMesh K7 : `uvw = (worldPos − GRID_MIN) / GRID_SIZE` (depuis `modelWorldMatrix·positionLocal`), `4× texture3D(volume).sample(uvw)` (trilinéaire matériel), assemblage `shCoefficients[0..3]`, `getShIrradianceAt(normalWorld, coeffs)`. Injection : remplacer l'auto-émissif fixe `cappedColor.mul(0.20)` du `emissiveNode` par `cappedColor.mul(probeIrradiance.max(0).mul(probeIntensityUniform))`, avec un petit plancher pour garder les K7 lisibles. `probeIntensityUniform` permet de retoucher sans re-bake.

**Garde anti-régression** : inspecter le WGSL généré au premier build → doit contenir `textureSample(` (trilinéaire OK), **pas** `textureLoad(` (= le filtre est silencieusement tombé en nearest).

## 6. Phasage & checkpoints

- **Phase 0 (prérequis, bloque tout)** : câbler le lightMap shell sur les matériaux du shell **au runtime ET dans la scène de capture**. Sans ça, le 2ᵉ bounce du cubemap est noir. *(= cœur du plan lightmap existant.)*
- **Phase A — grayscale** :
  - *A.1 sanity* : 1 sonde globale (pas de Data3DTexture), `uniformArray` + `getShIrradianceAt`, valider bake→projection→reconstruction→emissive de bout en bout sur M1, **mesurer le delta-ms** (bloom+SSAA actifs). Forcer `R=G=B=luminance` au bake (format RGB déjà, sortie neutre).
  - *A.2 volume* : remplacer par les 4 `Data3DTexture` à 1.0 m, sampling vertex trilinéaire. Vérifier l'absence de banding (check WGSL `textureSample`). Toujours luminance-forcé.
  - **STOP — validation utilisateur sur Mac Mini M1** (réalisme shell + sondes, FPS en marchant).
- **Phase A+ — couleur** : retirer le forçage luminance au bake → la chrominance néon réelle circule. Runtime/format **inchangés** (colour-ready par construction).
- **Phase B (optionnel, si budget)** : ZH3-hallucinated (shader-only) ; manager + CRT/TV reçoivent le sampling sondes ; densification locale 1.0→0.6 m près des enseignes **si** banding observé.

## 7. Registre de risques

| Sévérité | Risque | Mitigation |
|---|---|---|
| **Blocker** | `Data3DTexture` en NearestFilter défaut (ou FloatType non-filterable) → WGSL `textureLoad` au lieu de `textureSample` → banding **sans erreur** | `LinearFilter` + `HalfFloatType` explicites sur chaque volume + check WGSL au build |
| **Blocker** | Cubemap rate le **terme direct** : (a) lightMap shell pas encore câblé → 2ᵉ bounce noir ; (b) RectAreaLights non rasterisées → K7 sous enseigne plates | (a) Phase 0 d'abord ; (b) cartes émissives proxy offline ; valider 1 sonde-test sous l'enseigne magenta avant le volume complet |
| Majeur | Coût M1 **non mesuré** (greenfield, budget déjà serré bloom+SSAA+520 K7) | Phaser la mesure (1 sonde zéro-fetch d'abord), sampling vertex, démarrer L1 pas L2, profiler sur le vrai M1 à chaque phase |
| Mineur | SH-L1 peut passer négatif sur néons à fort contraste, lave le contraste vs L2 | `clamp(0)` runtime ; ZH3 (Phase B) restaure la directionnalité au coût-stockage L1 |
| Mineur | `fromCubeRenderTarget` est un addon examples/jsm (pas core), readback CPU | Pin three 0.184.0 (déjà) ; offline-only ; la math `SphericalHarmonics3` est en core (inlinable si l'addon dérive) |
| Mineur | HalfFloat (RGBA16F) : néon très intense pourrait clipper le coeff band-0 | Plage RGBA16F ~65504 amplement suffisante ; vérifier l'exposition au bake ; `probeIntensityUniform` trim sans re-bake |

## 8. Découpage en unités (interfaces claires)

- **`buildBakeScene.ts`** (nouveau) — pur builder : retourne `{ scene, meshes, lights, proxies }`. Dépend de `constants.ts` + valeurs de `Lighting.tsx`.
- **`generateAtlas.ts` / `renderAtlas.ts` / `Lightmapper*.ts`** (vendored, **Task 1 déjà faite**) — unwrap uv1 + g-buffer + raycaster BVH.
- **`bakeShell.ts`** (nouveau) — orchestration passe 1 (per-light sum).
- **`bakeProbes.ts`** (nouveau) — orchestration passe 2 : grille → cubemap → SH-L1 → `Data3DTexture`/`probes.bin`. Interface : `(renderer, litShellScene, grid) → { volumes, manifest }`.
- **`app/bake/page.tsx`** (nouveau) — harness WebGL2 : lance les 2 passes, expose `window.__bake` + `window.__bakeExport()`.
- **`scripts/bake.mjs`** (nouveau) — driver Playwright offline → écrit `public/baked/`.
- **`BakedShell.tsx`** (nouveau) — runtime : GLB + lightMap (uv1).
- **`probeSampling` (node TSL)** (nouveau) — fonction TSL réutilisable : `(worldPos, normalWorld) → irradiance`. Consommée par le material K7 (v1), manager/TV (v2).
- **`Lighting.tsx`** (modifié) — prop `bakedLighting` : drop les 14 RectAreaLights + 3 PointLights ; garde les meshes néon émissifs.

## 9. Tests

- **Unitaires (logique pure)** : indexation grille sondes (world→uvw, ordre de sérialisation), packing/unpacking SH-L1, membership `BAKE_SHELL`, parsing manifest, bounds de grille.
- **Garde build** : check WGSL `textureSample(` vs `textureLoad(` sur les textures de sondes.
- **Vérif visuelle Playwright** : A/B `/?baked=1` vs `/` (shell : ombres douces + AO + bleed coloré ; K7 : irradiance cohérente avec le shell, pas de banding ; 0 erreur console ; absence des 14 RectAreaLights au render). Sonde-test sous enseigne magenta montre un lobe teinté.

## 10. Relation au plan existant

Ce design **étend** `2026-05-29-lightmap-bake-pipeline.md` :
- **Task 1 (vendoring uv1) déjà faite** (`5742dfe`) — reste valable.
- Les Tasks 2-7 du plan (scene builder, bake orchestration, /bake, driver, runtime shell, checkpoint M1) couvrent la **passe 1 (lightmap shell)** = Phase 0 + base de Phase A.
- **Nouvelles tâches** à ajouter par `writing-plans` : rig néon-noir 7 familles + cartes proxy, `bakeProbes.ts` (passe 2), node TSL `probeSampling`, intégration K7, sérialisation `probes.bin`/manifest, garde WGSL.
- Le Task 2 du plan (« transcrire le rig hérité ») est **remplacé** par le rig néon-noir de §4.
- La phase « A+ albedo g-buffer » du plan reste pertinente pour le **color bleed du shell** (orthogonale aux sondes).
