# Documentation Rendu 3D (WebGPU / WebGL)

Ce document explique comment le rendu 3D fonctionne dans le projet, ou WebGPU est utilise, quelles optimisations sont deja en place, et comment verifier les performances.

## 1) Vue d'ensemble

Le projet utilise deux pipelines 3D differents :

- `src/components/exterior/ExteriorView.tsx` + `src/components/exterior/scene/ExteriorScene.ts`
  - Rendu **WebGL** (`THREE.WebGLRenderer`) pour la scene exterieure.
  - Shader GLSL custom pour l'enseigne/neon/vitrine.
- `src/components/interior/InteriorScene.tsx`
  - Rendu **WebGPU** (`THREE.WebGPURenderer`) pour l'interieur du videoclub.
  - Scene React Three Fiber + TSL + post-processing WebGPU.

## 2) Quand WebGPU est utilise

WebGPU est requis pour la scene interieure.

- Verification support navigateur:
  - `src/App.tsx` teste `navigator.gpu`.
  - Si absent: ecran "WebGPU non disponible".
- Initialisation renderer WebGPU:
  - `src/components/interior/InteriorScene.tsx`
  - `navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })`
  - fallback `requestAdapter()` si besoin.
  - creation `new THREE.WebGPURenderer(...)` puis `await renderer.init()`.

Important: l'exterieur reste volontairement en WebGL pour garder une entree ultra-compatible et legere.

## 3) Robustesse WebGPU (device/adapter)

Implante dans `src/components/interior/InteriorScene.tsx`:

- detection defensive de `maxTextureArrayLayers`:
  - lecture device/adapter
  - fallback a `256` si info indisponible
- gestion erreurs runtime GPU:
  - `device.onuncapturederror`
  - `device.lost.then(...)`
  - affichage d'un message utilisateur en overlay en cas de perte device
- mode debug limite layers:
  - query param `?debugMaxTextureArrayLayers=...`
  - utile pour reproduire les profils GPU "low limits"

## 4) Optimisations 3D/GPU deja en place

### 4.1 Cassettes instanciees + texture array (gain majeur draw calls)

- `src/components/interior/CassetteInstances.tsx`
- `src/utils/CassetteTextureArray.ts`

Ce qui est fait:

- toutes les cassettes sont rendues en `InstancedMesh` (pas 1 mesh par cassette)
- les affiches sont empilees dans une `DataArrayTexture` (1 layer = 1 poster)
- material TSL unique + lecture par `layerIndex` par instance
- animation hover/emissive pilotee par compute WebGPU (`renderer.compute(...)`)
- upload poster couche par couche via `copyExternalImageToTexture` quand possible
- fallback canvas/CPU si GPU texture pas encore prete

Impact:

- reduction massive des draw calls
- evite les reuploads complets d'une grosse texture array a chaque poster

### 4.2 Chunking selon limites GPU (`maxTextureArrayLayers`)

- `src/components/interior/CassetteInstances.tsx`
- `src/components/interior/Aisle.tsx`

Ce qui est fait:

- si `instances > maxTextureArrayLayers`, decoupage en plusieurs chunks
- chaque chunk a sa propre `DataArrayTexture` et son `InstancedMesh`
- garantit l'affichage des ~520 K7 meme sur des appareils limites a 256 layers

### 4.3 Compression textures PBR (KTX2 + fallback)

- `src/hooks/useKTX2Textures.ts`
- `src/components/interior/Aisle.tsx` (`USE_KTX2 = true`)

Ce qui est fait:

- tentative KTX2 avec `KTX2Loader.detectSupport(renderer)`
- compatible WebGL et WebGPU (selon support runtime)
- fallback automatique JPEG si KTX2 indisponible
- anisotropy, colorSpace et filtres configures

### 4.4 Post-processing adapte desktop/mobile

- `src/components/interior/PostProcessingEffects.tsx`

Desktop:
- Scene MRT + GTAO (resolutionScale 0.5)
- Bloom + vignette + FXAA

Mobile:
- pipeline simplifie Bloom + vignette
- pas de GTAO, pas de FXAA pour limiter cout GPU

### 4.5 Optimisations CPU interaction/raycast

- `src/components/interior/Controls.tsx`

Ce qui est fait:

- raycaster filtre par layers (`RAYCAST_LAYER_CASSETTE`, `RAYCAST_LAYER_INTERACTIVE`)
- cible compacte (`raycastTargetsRef`) au lieu de `intersectObjects(scene.children, true)` partout
- throttle du raycast (`RAYCAST_INTERVAL`)
- refresh periodique de la liste cible (800 ms)
- hysteresis de selection cassette pour stabiliser le focus

## 5) Benchmark mode (temps reel)

Fichiers:

- `src/components/interior/BenchmarkMode.tsx`
- `src/components/interior/InteriorScene.tsx`
- `src/components/terminal/TVTerminal.tsx`
- `src/store/index.ts`

Activation:

- via terminal utilisateur > "Benchmark WebGPU" (toggle ACTIF/INACTIF)
- ou via URL `?benchmark=1`

Mesures exposees:

- FPS instant, FPS moyen, FPS 1% low
- frametime moyen, p95
- draw calls, triangles
- nombre de chunks/instances cassette
- layer budget detecte

Export:

- bouton "Export JSON" dans l'overlay benchmark
- dump stocke dans `window.__videoclubBenchmark`

## 6) Parametres de qualite/perf deja ajustes

- DPR cap:
  - mobile: `<= 1.5`
  - desktop: `<= 2`
  - fichier: `src/components/interior/InteriorScene.tsx`
- shadows:
  - mobile: `PCFShadowMap`
  - desktop: `PCFSoftShadowMap`
- tone mapping:
  - ACES Filmic

## 7) Ce qu'un contributeur doit retenir

- Le coeur perf est dans:
  - instancing cassette + texture arrays + chunking layers
  - pipeline postprocess differencie desktop/mobile
  - fallback KTX2 -> JPEG
- WebGPU est central pour l'interieur, mais l'exterieur est encore en WebGL (choix volontaire).
- Ne pas supprimer les garde-fous `device.lost`, `onuncapturederror`, et `maxTextureArrayLayers`: ils evitent des crashs silencieux sur certains devices.
- Pour valider un changement rendu:
  - `npm run test:phase`
  - `npm run build`
  - test manuel navigateur + benchmark overlay actif

## 8) Pistes d'amelioration futures (chantier optionnel)

- ajouter un mode "qualite dynamique" (ajustement auto GTAO/Bloom selon frametime)
- introduire LOD / culling plus agressif pour les objets hors champ
- enregistrer une baseline benchmark par device cible (desktop/mobile) pour detecter les regressions
- homogeniser la couche debug/perf dans un panneau unique dev
