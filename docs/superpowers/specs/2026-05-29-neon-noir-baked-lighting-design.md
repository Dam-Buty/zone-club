# Néon-noir Baked Lighting — Design (deux phases, WebGPU/TSL)

> **Statut : design COURANT** (réécrit le 29/05/2026 après le spike WebGPU). Remplace la version précédente du même fichier (bake shell = raycaster WebGL2 vendored, sondes = cubemap-from-lit-shell — **obsolète**, voir l'historique git). Validé par le workflow de dé-risk (13 agents) + le spike `app/radiosity-spike/page.tsx` (color-bleed WebGPU prouvé, auto-vérifié Playwright).
>
> **Source de vérité vivante** : `memory/lightbake-workstream.md`. **Plan exécutable (Phase 1)** : `docs/superpowers/plans/2026-05-29-webgpu-radiosity-lightmap.md`.

## 1. Objectif

Éclairage **néon-noir nocturne photoréaliste** du vidéoclub : GI calculé **hors-ligne** (bake) et **lu** au runtime WebGPU, au lieu d'être simulé par ~14 RectAreaLights (héritage non-photoréaliste). Cible Mac Mini M1, 30 fps. L'utilisateur veut le réalisme maximal, par phases.

## 2. Le découpage statique / dynamique = pourquoi DEUX phases

C'est la contrainte structurante : **un lightmap exige une géométrie statique à UV unique**.

- **Surfaces statiques non-instanciées** (sol, plafond, 4 murs, 2 corps d'îlots, 8 dos d'étagères) → **lightmappables** (Phase 1).
- **Planches/séparateurs d'étagères** = `InstancedMesh` (géométrie partagée entre instances) → **impossible** de leur donner un lightmap par instance.
- **Objets dynamiques** : K7 (un `InstancedMesh` de ~520), manager (NPC), TV/CRT → bougent ou partagent une géométrie → pas lightmappables.

⇒ Les planches instanciées **et** les dynamiques ont besoin d'une solution **volumétrique** : un **volume de sondes d'irradiance** (Phase 2). Les deux phases sont **séquentielles et conditionnelles** : la Phase 2 dépend de la Phase 1 (elle lit le shell baké comme source, et son budget perf est gaté par la marge FPS M1 mesurée en fin de Phase 1).

## 3. Fondation commune (prouvée par le spike)

Les deux phases partagent le **même moteur**, ce qui garantit la cohérence visuelle entre shell et objets :

- **Gather BVH en WebGPU/TSL** via `three-mesh-bvh/webgpu` (`bvhIntersectFirstHit` + `getVertexAttribute`) — prouvé dans le stack (three 0.184 WebGPURenderer + TSL). Pattern de buffers documenté dans `memory/lightbake-workstream.md`.
- **Rig néon-noir = géométrie émissive** (7 familles : tubes fluo plafond chauds, vitrine froide, enseignes néon colorées, bandeaux sous-étagères, lueur CRT, lampe comptoir, clair de lune directionnel) + un terme **ciel/clair-de-lune froid** pour les rayons qui manquent. Les deux phases gather la lumière depuis ces émetteurs.
- Pas de WebGL2, pas de GLB, pas de path-tracer caméra. Runtime 100 % WebGPU.

## 4. PHASE 1 — Lightmap radiosité des surfaces statiques *(plan écrit, prêt à exécuter)*

- **Périmètre** : sol, plafond, 4 murs, 2 corps d'îlots, 8 dos d'étagères.
- **Bake** : `uv1` **procédural déterministe** (slot d'atlas + projection planaire, calculé identiquement au bake et au runtime → on ne shippe que le PNG, zéro round-trip, zéro GLB) → radiosité itérative ping-pong en WebGPU/TSL (gather hémisphérique, multi-bounce coloré + AO de contact). Les **planches instanciées sont des occludeurs** (elles projettent l'ombre dans le bake) mais ne sont pas lightmappées.
- **Runtime** (`?baked=1`) : recalcule le même `uv1` procédural, attache `lightMap` ; supprime le rig temps réel (garde les meshes néon émissifs pour le bloom).
- **Plan** : `2026-05-29-webgpu-radiosity-lightmap.md` (Tasks 0-9). **Se termine par un STOP de validation M1** (Task 9).

## 5. PHASE 2 — Volume de sondes d'irradiance *(conditionnel — plan écrit APRÈS réussite Phase 1)*

- **Cibles** : planches/séparateurs d'étagères instanciés + K7 + manager + TV/CRT.
- **Bake (réutilise le moteur Phase 1, PAS de cubemap)** : une grille 3D de sondes ; à chaque sonde, un gather sphérique contre **le même BVH** + le rig émissif + **les surfaces statiques DÉJÀ bakées en Phase 1 traitées comme émetteurs** (leur radiance sortante = lightmap Phase 1 × albédo, lue à l'`uv1` du hit via `getVertexAttribute`). ⇒ le rebond coloré de la Phase 1 est capté « gratuitement » comme bounce suivant, **uniforme avec la Phase 1**.
  - ⚠️ Ceci **remplace** l'ancienne approche « cubemap-from-lit-shell → `LightProbeGenerator` → SH » (version obsolète de ce doc). Le gather BVH WebGPU est uniforme avec la Phase 1 et élimine le besoin de rendus cubemap + de proxies pour les RectAreaLights.
- **Encodage** : **SH-L1 RGB** (décision dé-risk : L1 pas L2 — L2 ringe sur les néons ponctuels vifs, et les K7 sont quasi-lambertiennes → gain L2 marginal). Stocké en `Data3DTexture` RGBA16F, **`LinearFilter` OBLIGATOIRE** (piège universel : sinon WGSL bascule en `textureLoad` → banding silencieux). Grille ≈ 1.0 m XZ / 0.7 m Y (~400 sondes). Upgrade **ZH3** = shader-only ultérieur, format inchangé.
- **Runtime** : les objets dynamiques échantillonnent le volume en TSL (stage vertex) via `emissiveNode` (PAS `context.irradiance` → réactiverait le pipeline lighting Standard sur 520 instances).
- Détails + pièges : `memory/lightbake-probe-bake-traps.md` (le piège Data3DTexture s'applique ; le piège cubemap est **caduc** avec le gather BVH).

## 6. Conditionnalité explicite (Phase 1 → Phase 2)

Le **plan de la Phase 2 n'est écrit qu'après validation de la Phase 1 sur le Mac Mini M1**. Critères de passage (Task 9 de la Phase 1) :

1. **Visuel** : le color-bleed néon-noir lit bien sur les surfaces statiques (flaques chaudes, morsure magenta/cyan, vitrine froide, contraste). Si décevant → on réoriente le rig/bake AVANT d'investir dans les sondes.
2. **Perf** : FPS M1 ≥ cible (30) avec **marge** pour absorber le coût runtime des sondes (sampling SH-L1 sur ~520 K7). Si la marge est nulle → revoir le périmètre Phase 2 (ex. sondes seulement, planches en fill simple).

Tant que ces critères ne sont pas confirmés, la Phase 2 reste un **design anticipé** (cette section), pas un plan exécutable.

## 7. Risques de la Phase 2 (déjà dé-risqués par le workflow)

| Risque | Statut |
|---|---|
| `Data3DTexture` NearestFilter par défaut → `textureLoad` silencieux → banding | Mitigé : `LinearFilter` + `HalfFloatType` à la création + check WGSL `textureSample`. **Universel.** |
| Coût runtime sondes sur M1 (non mesuré) | À mesurer **après** Phase 1 (gate §6.2) ; sampling SH-L1 en stage vertex ; démarrer L1 pas L2. |
| Ringing SH sur néons vifs | Évité en restant L1 (+ clamp ≥ 0) ; ZH3 plus tard. |
| ~~Cubemap rate le terme direct (RectArea non rasterisées)~~ | **Caduc** : le gather BVH voit la géométrie émissive directement. |

## 8. Hors-scope (les deux phases)

GI temps réel, réflexions spéculaires, relighting dynamique. Le bake est **statique** (rig figé) ; tout changement du rig ou de la géométrie du shell = re-bake.

## 9. Roadmap

1. **Phase 1** — exécuter `2026-05-29-webgpu-radiosity-lightmap.md` → STOP validation M1.
2. **Gate §6** — l'utilisateur valide visuel + perf.
3. **Phase 2** — SEULEMENT si gate OK : écrire le plan sondes (volume SH-L1, gather BVH réutilisant la Phase 1, runtime sampling K7/manager/TV/planches), puis l'exécuter.
