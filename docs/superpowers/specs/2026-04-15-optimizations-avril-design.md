# Optimizations Avril — Design

**Date** : 2026-04-15
**Branche** : `optimizations-avril`
**Auteur** : Rusmir Sadikovic + Claude (Opus 4.6)

## 1. Contexte et motivation

Le projet Zone Club (`video-club-webgpu`) a déjà bénéficié de plusieurs passes d'optimisation documentées dans la mémoire projet : materials Physical → Standard, SSGI off, render pause sur overlays 2D, IndexedDB atlas cache des posters, non-blocking poster loading, InstancedMesh + DataArrayTexture pour ~1002 cassettes, mobile DPR 1.7 + shadows 256 + FXAA, raycast limité à 4m, consolidation useFrame, proxy TMDB avec cache disque.

Malgré cela, des douleurs subsistent côté mobile (Pixel 9, Chrome Android) et, dans une moindre mesure, sur le temps de chargement initial. Ce sprint vise à les adresser avec une approche **mesure-first** en quatre phases.

## 2. Priorités validées

### 2.1 Ordre de priorité
1. **Mobile FPS** (priorité principale)
2. **Temps de chargement initial** (priorité secondaire)

### 2.2 Douleurs mobiles identifiées (Pixel 9, portrait)
- **B** — Rotation caméra (swipe écran droit) saccade
- **E** — Premier passage devant un rayon non visité (shader-compile stutter)
- **F** — Tutorial (transitions waypoint caméra)

### 2.3 Cible FPS mobile
**45-60 fps stable**, priorité à la stabilité (pas de saccades) plus qu'au maximum absolu.

### 2.4 Trade-offs acceptés
- **Shader stutter** : warmup critique bloquant au loading (D) + stretch goal cache IDB shaders (C) pour visites répétées. Loading +1-2s acceptable en échange d'une scène sans stutter.
- **Tutorial** : lerp waypoint plus court (C) + gel des tâches coûteuses pendant l'animation (D).
- **Bundle** : quick wins chirurgicaux + split monolithes conditionnel si l'analyseur le justifie, pas de refonte du store Zustand.

## 3. Approche globale : sprint mesure-first en 4 phases

**Principe** : mesurer avant de coder, valider entre chaque phase, s'arrêter si la cible est atteinte. Permet de livrer un gain utilisateur progressivement et de détecter une régression dans une fenêtre étroite.

### 3.1 Séquence
| Phase | Contenu | Effort | Gain attendu |
|---|---|---|---|
| 0 | Baseline mesurée (overlay perf dev + script `dev:mobile` + protocole manuel) | 0.5 j | Référence chiffrée |
| 1 | Shader warmup étendu + cache IDB stretch + tutorial lerp+gel | 1-1.5 j | +10-20 fps sur 1er passage ; −50% stutter tutorial |
| 2 | Profil rotation Pixel 9 → fix guidé + palier de qualité mobile dynamique | 1.5-2 j | +5-15 fps rotation ; stabilité globale |
| 3 | Bundle : codemod tree-shaking Three + HDR→KTX2 + prefetch avancé + audit deps | 1.25-2 j | JS gzipped −30-50% ; LCP −1s à −2s |

**Effort total estimé** : 4.25 à 6 jours de travail concentré.

### 3.2 Critère d'arrêt anticipé
Si, après Phase 2, tous les critères mobiles (45-60 fps stable rotation, pas de stutter 1er passage, tutorial fluide) sont atteints et que le bundle initial gzipped est déjà ≤ 3MB, la Phase 3 peut être réduite à 3A + 3E uniquement.

## 4. Workflow de test mobile

### 4.1 Option retenue : `next dev --experimental-https` LAN

**Ajout à `package.json`** :
```json
"dev:mobile": "next dev --experimental-https --hostname 0.0.0.0 --port 3001"
```

### 4.2 Prérequis
- Mac et Pixel 9 sur le **même Wi-Fi** (validé).
- `mkcert` téléchargé automatiquement par Next 15 au premier run.
- Firewall Mac autorise `node` sur le port 3001 (validé).
- Chrome Android : accepter l'alerte de sécurité (cert auto-signé) au premier accès à `https://<IP-mac>:3001`.

### 4.3 Profiling fin (ponctuel)
Pour les traces Chrome Performance sur le Pixel 9 (utile Phase 0 et Phase 2) :
- USB debugging activé sur le Pixel.
- Chrome Desktop → `chrome://inspect/#devices` → tab live du Pixel → Performance tab.
- Export `.json` → analyse dans Chrome Desktop DevTools.

## 5. Phase 0 — Baseline mesurée

### 5.1 Livrables
- **Overlay perf dev-only** : nouveau composant dans `src/components/ui/PerfOverlay.tsx`, activable via query string `?perf=1` ou touche `P`. Affiche FPS instantané + min sur 60f + GPU time + heap + draw calls + quality tier (quand Phase 2 sera en place).
- **Script** `dev:mobile` ajouté à `package.json`.
- **Document** `docs/perf/baseline-2026-04-15.md` avec chiffres des 3 scénarios.

### 5.2 Protocole de mesure Pixel 9
1. **Warm run** : entrer dans la scène, attendre fin loading + 10s d'idle.
2. **Scénario B (rotation)** : swipe droite-gauche en boucle 15s dans l'allée Action → FPS min/p5/median/p95/max + nombre de janks (frames > 33ms).
3. **Scénario E (1er passage)** : depuis spawn, marche à vitesse normale jusqu'au fond du magasin en passant devant les 6 allées (toutes non visitées) → time-to-stable-60fps par allée + stutters > 100ms.
4. **Scénario F (tutorial)** : lancer le tutorial, enregistrer FPS aux transitions waypoint → durées lerp actuelles + frames > 33ms par transition.
5. **TTI + LCP** : via Lighthouse mobile simulé (desktop) + Chrome Perf Live sur Pixel USB.

### 5.3 Critère de sortie
3 runs concordants (écart < 10%) enregistrés dans le doc baseline.

### 5.4 Contrainte d'exclusion de prod
L'overlay perf doit être strictement absent du bundle prod via `process.env.NODE_ENV === 'development'`. Pas de dépendance lourde ajoutée ; préférer `stats-gl` (déjà présent sinon) à des libs plus lourdes.

## 6. Phase 1 — Shader stutter + Tutorial fluide

### 6.1 Sous-partie 1A — Warmup shaders étendu (bloquant)

**Objectif** : éliminer le stutter "premier passage" en compilant tous les matériaux de la scène intérieure pendant le loading screen.

**Implémentation** :
- Construction d'une scène "probe" incluant : `WallShelf`, `IslandShelf`, `Aisle` (sol/mur/néons), `Storefront`, `Cassette` (atlas déjà disponible), `InteractiveTVDisplay` (VCR, écran LCD, mixer), `Couch`, `VHSCaseOverlay` (backdrop transparent).
- `await renderer.compileAsync(probeScene, camera)` une seule fois, avant la fin du loading.
- Nettoyage de la probe après.

**Fichier principal** : `src/components/interior/InteriorScene.tsx`.

**Gain attendu** : stutter 1er passage divisé par ≥ 3.

### 6.2 Sous-partie 1B — Shader cache IndexedDB (stretch goal)

**Principe** : Chrome garde un cache GPU automatique pour des pipelines identiques sur même URL + même User-Agent. Pas de code côté app, mais il faut garantir que les sources TSL soient **déterministes** (pas de template strings dynamiques, pas de timestamp, pas de `Math.random()`).

**Action** : audit des shaders TSL dans `CassetteInstances.tsx`, `NeonTube.ts`, `PostProcessingEffects.tsx`. Correction si détection d'une source non déterministe.

**Gain** : loading ~50% plus court en visite répétée.

**Effort** : 0.5 j max. Si l'audit montre que tout est déjà déterministe, sous-partie livrée en 15 min.

### 6.3 Sous-partie 1C — Tutorial fluide (C + D)

**C — Lerp raccourci** :
- Ajout d'un champ `lerpDuration` par waypoint dans `TUTORIAL_WAYPOINTS` (store).
- Valeurs cibles : **0.6s** pour les transitions courtes (même pièce), **0.9s** pour les grandes (spawn → TV).
- Easing `easeInOutCubic` (remplace un éventuel lerp linéaire).

**D — Gel des coûts pendant la transition** :
- Nouveau flag store `isTutorialCameraMoving` (true pendant le lerp, false à l'arrivée).
- Quand true :
  - Skip raycast dans `Controls.tsx` (early return).
  - Skip CanvasTexture updates sur `InteractiveTVDisplay`.
  - Pause la chaîne poster decode / IndexedDB reads du `CassetteTextureArray`.
  - Bloom strength lerpée vers 0 en 100ms, remontée en 150ms à la fin.

**Fichiers touchés** :
- `src/components/interior/Controls.tsx`
- `src/components/interior/InteractiveTVDisplay.tsx`
- `src/components/interior/PostProcessingEffects.tsx`
- `src/components/tutorial/TutorialOverlay.tsx` ou store
- `src/utils/CassetteTextureArray.ts`
- `src/store/index.ts`

### 6.4 Critères de succès Phase 1
1. Premier passage : **FPS min ≥ 40** sur Pixel 9 dans toutes les allées.
2. Tutorial : **aucune frame > 33ms** pendant un lerp waypoint.
3. TTI reste ≤ +1s vs baseline (warmup étendu acceptable).

### 6.5 Risques
- `compileAsync` peut ne pas couvrir tous les matériaux si un shader dépend de données runtime. **Mitigation** : la probe scene inclut les mêmes bindings que la scène réelle.
- Le gel des poster reads pendant tutorial peut laisser des slots blancs visibles — acceptable car waypoints courts.

## 7. Phase 2 — Rotation caméra fluide (profil-guidé)

### 7.1 Étape 2A — Profil Pixel 9 (préalable obligatoire)

**Protocole** :
1. Scène chargée, idle, dans l'allée Action.
2. Enregistrement Performance Chrome (6s) via `chrome://inspect` : swipe continu droite ↔ gauche.
3. Export trace `.json`.
4. Analyse des postes :
   - JS Main thread : useFrame handlers, raycast, events touch, Zustand updates.
   - GPU : durée par frame, composition pipeline.
   - Layout/Paint : doit être 0.

**Livrable** : `docs/perf/rotation-profile-2026-04-15.md` avec top-5 hotspots.

### 7.2 Étape 2B — Fixes guidés

**Aucun fix n'est écrit en amont**. Selon le profil, on applique 1 à 3 fixes parmi :

| Hotspot identifié | Fix typique |
|---|---|
| Raycast > 5% main | Throttle raycast 2 frames → 4 frames pendant rotation active |
| Poster decode bloquant | Pause poster chain pendant `isCameraRotating` |
| Zustand re-renders | Audit selectors, passer en `subscribe()` ce qui bouge (position caméra, targetedCassetteKey) |
| React reconciliation | `React.memo` manquants, props objets recréés |
| DoF actif sans overlay | Vérifier gating DoF (doit être off hors VHSCaseOverlay) |
| GPU bound | Bloom mip chain réduit + FXAA à 0.5× qualité pendant rotation |
| Touch handler lourd | Parsing delta swipe dans rAF throttle, pas dans `onTouchMove` brut |

### 7.3 Étape 2C — Palier de qualité mobile dynamique

**Principe** : adapter la qualité au FPS réel, pas à une hypothèse statique.

**Implémentation** :
- Nouveau fichier `src/utils/qualityTier.ts` avec 3 niveaux :
  - **HIGH** : DPR 1.7, Bloom strength 0.12, shadow 256, FXAA on
  - **MEDIUM** : DPR 1.4, Bloom strength 0.08, shadow 128, FXAA on
  - **LOW** : DPR 1.2, Bloom strength 0.06, shadow off, FXAA off
- Tier initial : heuristique device (`navigator.hardwareConcurrency`, GPU info si dispo).
- **Adaptation dynamique** :
  - Downgrade si FPS moyen < 40 sur 60 frames consécutives.
  - Upgrade si FPS moyen > 55 sur 300 frames consécutives.
  - **Hystérésis** : debounce minimum 5s entre changements.
- Lu depuis Zustand ; `useEffect` côté Canvas pour reconfigurer DPR / shadow / bloom / FXAA.
- Tier courant affiché dans l'overlay perf.

### 7.4 Fichiers touchés
- `src/components/interior/Controls.tsx`
- `src/utils/qualityTier.ts` (nouveau)
- `src/store/index.ts`
- `src/components/interior/PostProcessingEffects.tsx`
- `src/components/interior/InteriorScene.tsx`
- `src/components/interior/Lighting.tsx`
- `src/components/ui/PerfOverlay.tsx`

### 7.5 Critères de succès Phase 2
1. Rotation continue 15s Pixel 9 : **FPS min ≥ 40, aucun drop sous 30**.
2. Tier dynamique : Pixel 9 se stabilise à HIGH en idle, éventuellement MEDIUM temporaire pendant rotation ; jamais LOW sur ce device.
3. Pas de régression visuelle détectable en HIGH vs pré-Phase 2.

### 7.6 Risques
- **Faux-positif de rotation** : `isCameraRotating` doit passer `true` uniquement si delta swipe > seuil, et s'éteindre après 150ms d'inactivité.
- **Tier ping-pong** : hystérésis 5s non négociable.
- **DPR dynamique WebGPU** : changer DPR peut forcer un reset swapchain. Plan B : appliquer DPR cible seulement quand la scène est stable (pas pendant rotation en cours).

## 8. Phase 3 — Bundle et temps de chargement

### 8.1 Sous-partie 3A — Codemod Three.js tree-shaking

**Problème** : `import * as THREE` dans 32 fichiers casse le tree-shaking (chunks Three 11-13MB observés).

**Implémentation** :
1. `scripts/codemod-three-imports.mjs` : parse chaque fichier, collecte les accès `THREE.X`, remplace par `import { X, Y, Z } from 'three'` (ou `'three/webgpu'` selon contexte).
2. Revue manuelle des cas limites (10-15 fichiers max).
3. Validation par build + bundle analyzer.

**Gain attendu** : −30 à −50% sur le chunk `three` isolé (~4-6MB brut, ~1-1.5MB gzipped).

### 8.2 Sous-partie 3B — HDR → KTX2

**Problème** : `indoor_night.hdr` (ou équivalent) chargé non compressé.

**Implémentation** :
1. Conversion HDR → `.ktx2` UASTC HDR via `ktxtools` CLI.
2. `Lighting.tsx` : `HDRLoader` → `KTX2Loader` (transcoder wasm à ajouter dans `public/`).
3. Fallback `.hdr` conservé pendant cette phase en cas d'artefact visible.

**Gain attendu** : −5 à −10MB assets ; décodage GPU-side.

**Risque** : UASTC HDR peut introduire du banding. Mitigation : comparaison visuelle screenshots avant/après.

### 8.3 Sous-partie 3C — Prefetch avancé

**Implémentation** :
- Module-level dans `src/App.tsx` : déclencher `import('./components/interior/Aisle')` et `import('./components/videoclub/VHSCaseOverlay')` en parallèle du fetch API films, avant le mount React.
- `app/layout.tsx` : `<link rel="prefetch">` pour les chunks non-critiques, `preload` pour les critiques.

**Gain attendu** : TTI-to-interactive −0.3 à −0.8s.

### 8.4 Sous-partie 3D — Split monolithes (conditionnel)

**Déclencheur** : si le bundle analyzer montre que `InteractiveTVDisplay.tsx` (1844 lignes) ou `VHSCaseOverlay.tsx` (2532 lignes) occupent > 10% du chunk initial.

**Si déclenché** :
- Extraire `AdminPanel`, `MixerPanel`, `VCRDebugPanel` de `InteractiveTVDisplay` en fichiers séparés lazy-imported.
- Extraire 3-4 modales secondaires de `VHSCaseOverlay` en composants lazy.

**Gain attendu si déclenché** : −1 à −2MB chunk initial.

### 8.5 Sous-partie 3E — Audit deps

**Implémentation** :
- Activation ponctuelle de `webpack-bundle-analyzer` via env var `ANALYZE=true` dans `next.config.ts`.
- Revue top 10 deps runtime : `@react-three/drei`, `postprocessing`, `@ai-sdk/*`, `@langfuse/otel`, doublons `dayjs`/`date-fns`.
- Décision 1-2 fixes ciblés (pas de chasse systématique).

### 8.6 Fichiers touchés
- `scripts/codemod-three-imports.mjs` (nouveau)
- 32 fichiers `src/**/*.tsx` + `src/**/*.ts` (imports Three.js)
- `src/components/interior/Lighting.tsx`
- `public/indoor_night.ktx2` (nouveau)
- `public/basis_transcoder.wasm` + `.js` (si pas déjà présent)
- `src/App.tsx`
- `app/layout.tsx`
- `next.config.ts`

### 8.7 Critères de succès Phase 3
1. **Bundle JS initial gzipped** ≤ 2.5MB.
2. **LCP mobile simulé** (Lighthouse Slow 4G + Pixel 9 simulé) : **−1s minimum** vs baseline.
3. **TTI Pixel 9 réel** (visite à froid, cache vidé) : **−1 à −1.5s** vs baseline.
4. Pas de régression visuelle HDR.
5. Build passe sans warning tree-shaking ajouté.

### 8.8 Risques
- **Codemod** : casse possible sur usage métaprog de `THREE`. Mitigation : whitelist du codemod + revue manuelle.
- **KTX2 rendu** : banding possible. Mitigation : comparaison visuelle + fallback HDR.
- **Prefetch trop agressif** : gaspillage bande passante si l'utilisateur quitte la homepage. Non-bloquant car `prefetch` low-priority.

## 9. Critères de succès globaux (acceptance)

Le sprint est considéré réussi si **tous** les critères suivants sont atteints :

### 9.1 Mobile (Pixel 9, priorité absolue)
- Rotation caméra 15s continue : **FPS min ≥ 40, median ≥ 50**, aucun drop < 30.
- Premier passage dans une allée non visitée : **aucun stutter > 100ms**.
- Transitions waypoint tutorial : **aucune frame > 33ms**.

### 9.2 Chargement
- **Bundle JS initial gzipped ≤ 2.5MB**.
- **LCP Lighthouse mobile simulé : −1s minimum** vs baseline documentée Phase 0.

### 9.3 Non-régression
- Aucun test existant cassé (`npm run test:phase`).
- Build production passe (`npm run build`).
- Aucune régression visuelle détectable sur desktop en comparant screenshots Phase 0 vs fin.
- Pas de feature utilisateur cassée (auth, location, reviews, terminal admin, cast, tutorial complet).

## 10. Hors scope (YAGNI explicite)

Les éléments suivants **ne seront pas** abordés dans ce sprint, même s'ils apparaissent tentants :

- Refonte du store Zustand (876 lignes, non splitté). Trop de couplage avec l'app actuelle, bénéfice incertain vs risque.
- Remplacement de `postprocessing` par une lib alternative.
- Migration WebGPU → WebGL fallback (hors sujet).
- Refonte du tutoriel (nouvelle UX, nouveaux waypoints).
- Optimisations serveur (API response times, cache HTTP, CDN).
- Passage à Suspense-streaming SSR avancé.
- Modifications schema DB / migration.

## 11. Risques transverses et plan de rollback

### 11.1 Risques transverses
- **Mesure non reproductible** : conditions de test Pixel 9 (batterie, thermal throttling, WiFi). Mitigation : 3 runs + écart < 10%.
- **Claude biais confirmation** : tendance à déclarer succès sans mesure. Mitigation : checks explicites FPS avant claim completed.
- **Régression desktop non vue** : le sprint cible mobile, desktop peut être oublié. Mitigation : smoke test desktop après chaque phase.

### 11.2 Rollback par phase
Chaque phase = un ou plusieurs commits atomiques sur `optimizations-avril`. En cas de régression :
- `git revert` du commit incriminé.
- Rollback partiel : les phases étant indépendantes, revenir à la fin de la phase précédente est toujours possible.

## 12. Workflow de branche

- Branche de travail : `optimizations-avril` (créée depuis `main` à jour).
- Commits atomiques par sous-phase (ex: `perf(phase1): warmup shaders étendu`).
- Mesures consignées dans `docs/perf/` à chaque phase.
- PR finale squash-merged vers `main` une fois tous les critères d'acceptance validés.
- Pas de merge intermédiaire vers `main` sauf demande explicite utilisateur.

## 13. Prochaines étapes

1. **Validation de ce spec par l'utilisateur.**
2. Invocation du skill `superpowers:writing-plans` pour produire le plan d'implémentation détaillé (étapes, commits, tests, ordre précis) à partir de ce design.
3. Exécution phase par phase, en respectant le checkpoint mesure-valide-commit.
