# Optimizations Avril — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer un sprint perf mesure-first en 4 phases ordonnées (Baseline → Shader+Tutorial → Rotation profil-guidé → Bundle) amenant Pixel 9 à 45-60 fps stable et le bundle initial gzipped à ≤ 2.5MB, sans régression visuelle.

**Architecture:** Approche chirurgicale pilotée par la mesure. Phase 0 pose une baseline chiffrée via un overlay perf dev-only + protocole mobile reproductible. Phase 1 supprime le shader-compile stutter (warmup étendu `compileAsync`) et les saccades tutorial (lerp raccourci + gel des tâches coûteuses). Phase 2 capture un trace Chrome Pixel 9 pour guider les fixes + introduit un `MobileQualityTier` dynamique à 3 niveaux avec hystérésis. Phase 3 corrige le tree-shaking Three (32 fichiers en `import * as`), convertit le HDR en KTX2, avance les prefetch et splitte conditionnellement les monolithes.

**Tech Stack:** Next.js 15.3, React 19, Three.js 0.183.2 (WebGPU), React Three Fiber 9, Zustand 5, TypeScript strict. Outillage : `next dev --experimental-https` pour LAN Pixel 9, `chrome://inspect` pour profiling USB, Lighthouse pour LCP, `@next/bundle-analyzer` (à ajouter en devDep temporairement) pour Phase 3.

**Spec source:** `docs/superpowers/specs/2026-04-15-optimizations-avril-design.md`

---

## File Structure

### Fichiers créés
| Chemin | Responsabilité |
|---|---|
| `src/components/ui/PerfOverlay.tsx` | Overlay dev-only FPS/heap/draw calls/quality tier |
| `src/utils/qualityTier.ts` | Classe `MobileQualityTier` (3 niveaux + hystérésis) |
| `src/hooks/useQualityTier.ts` | Hook R3F qui pilote DPR/shadow/bloom depuis le store |
| `scripts/codemod-three-imports.mjs` | Codemod Node pour remplacer `import * as THREE` |
| `docs/perf/baseline-2026-04-15.md` | Chiffres baseline (Phase 0) |
| `docs/perf/rotation-profile-2026-04-15.md` | Top-5 hotspots Pixel 9 (Phase 2A) |
| `docs/perf/phase-results-2026-04-15.md` | Chiffres avant/après par phase |
| `public/textures/env/indoor_night.ktx2` | HDR converti en UASTC HDR (Phase 3B) |

### Fichiers modifiés
| Chemin | Sections | Phase |
|---|---|---|
| `package.json` | Scripts `dev:mobile`, devDep optionnelle analyzer | 0, 3 |
| `src/store/index.ts` | Ajout `isTutorialCameraMoving`, `isCameraRotating`, `qualityTier`, `lerpDuration` sur waypoints | 1, 2 |
| `src/components/interior/InteriorScene.tsx` | Warmup étendu, branchement PerfOverlay, DPR dynamique | 0, 1, 2 |
| `src/components/interior/Controls.tsx` | Lerp tutorial accéléré + easing, gate raycast pendant `isTutorialCameraMoving`/`isCameraRotating`, flag rotation | 1, 2 |
| `src/components/interior/PostProcessingEffects.tsx` | Bloom lerp vers 0 pendant tutorial moving, lecture tier | 1, 2 |
| `src/components/interior/InteractiveTVDisplay.tsx` | Gate LCD canvas updates pendant tutorial moving | 1 |
| `src/components/interior/Lighting.tsx` | Shadow toggle selon tier, `HDRLoader` → `KTX2Loader` | 2, 3 |
| `src/utils/CassetteTextureArray.ts` | Pause poster chain pendant tutorial moving / rotation | 1, 2 |
| `src/App.tsx` | Prefetch Aisle + VHSCaseOverlay module-level avancé | 3 |
| `next.config.ts` | Activation bundle analyzer via `ANALYZE=true` | 3 |
| `app/layout.tsx` | `<link rel="prefetch">` chunks non-critiques | 3 |
| 32 fichiers `src/**/*.{ts,tsx}` | `import * as THREE` → imports nommés | 3 |

---

# PHASE 0 — Baseline mesurée

**Objectif** : produire des chiffres honnêtes avant toute modification.
**Durée estimée** : 0.5 j.

### Task 0.1: Ajout scripts dev mobile et perf au package.json

**Files:**
- Modify: `package.json` (section `scripts`)

- [ ] **Step 1: Ouvrir `package.json` et lire la section `scripts`**

Run: `grep -n '"scripts"' package.json`
Note les lignes concernées.

- [ ] **Step 2: Ajouter le script `dev:mobile` après `"dev"`**

Diff attendu :
```diff
   "scripts": {
     "dev": "next dev",
+    "dev:mobile": "next dev --experimental-https --hostname 0.0.0.0 --port 3001",
     "build": "next build",
```

- [ ] **Step 3: Test de lancement**

Run: `npm run dev:mobile`
Expected: affichage URL `https://<IP>:3001` et `https://localhost:3001`. Next télécharge `mkcert` au premier run (certificats dans `./certificates/`). CTRL+C pour arrêter.

- [ ] **Step 4: Ajouter `./certificates` et `.playwright-mcp/` au .gitignore si absents**

Run: `grep -E "^certificates|^\.playwright-mcp" .gitignore || echo "ADD"`
Si retour vide ou "ADD", ajouter :
```
certificates/
.playwright-mcp/
```

- [ ] **Step 5: Commit**

```bash
git add package.json .gitignore
git commit -m "chore(perf): ajout script dev:mobile (HTTPS LAN pour Pixel 9)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 0.2: Créer le composant PerfOverlay dev-only

**Files:**
- Create: `src/components/ui/PerfOverlay.tsx`

- [ ] **Step 1: Créer le fichier avec overlay FPS minimal**

Contenu exact :

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store'

type Sample = { fps: number; gpuMs: number; drawCalls: number; heap: number }

const SAMPLE_WINDOW = 60

export function PerfOverlay() {
  const [visible, setVisible] = useState(() => {
    if (typeof window === 'undefined') return false
    const qs = new URLSearchParams(window.location.search)
    return qs.get('perf') === '1'
  })
  const [display, setDisplay] = useState<Sample & { fpsMin: number; fpsP5: number; tier: string }>({
    fps: 0, fpsMin: 0, fpsP5: 0, gpuMs: 0, drawCalls: 0, heap: 0, tier: '-',
  })
  const samplesRef = useRef<number[]>([])
  const lastFrameRef = useRef(performance.now())
  const rafRef = useRef(0)
  const qualityTier = useStore(s => s.qualityTier ?? '-')

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'p' || e.key === 'P') setVisible(v => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!visible) return
    const tick = () => {
      const now = performance.now()
      const dt = now - lastFrameRef.current
      lastFrameRef.current = now
      const fps = 1000 / dt
      const arr = samplesRef.current
      arr.push(fps)
      if (arr.length > SAMPLE_WINDOW) arr.shift()
      const sorted = [...arr].sort((a, b) => a - b)
      const fpsMin = sorted[0] ?? 0
      const fpsP5 = sorted[Math.floor(sorted.length * 0.05)] ?? 0
      const heap = (performance as any).memory?.usedJSHeapSize ?? 0
      setDisplay({
        fps: Math.round(fps),
        fpsMin: Math.round(fpsMin),
        fpsP5: Math.round(fpsP5),
        gpuMs: 0,
        drawCalls: 0,
        heap: Math.round(heap / 1e6),
        tier: String(qualityTier),
      })
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [visible, qualityTier])

  if (process.env.NODE_ENV !== 'development' || !visible) return null

  return (
    <div style={{
      position: 'fixed', top: 8, left: 8, zIndex: 99999,
      background: 'rgba(0,0,0,0.75)', color: '#0f0', padding: '6px 8px',
      fontFamily: 'ui-monospace, monospace', fontSize: 11, lineHeight: 1.35,
      borderRadius: 4, pointerEvents: 'none',
    }}>
      <div>FPS {display.fps} (min {display.fpsMin} / p5 {display.fpsP5})</div>
      <div>Heap {display.heap} MB</div>
      <div>Tier {display.tier}</div>
    </div>
  )
}
```

- [ ] **Step 2: Monter `PerfOverlay` dans `src/App.tsx`**

Lire `src/App.tsx` pour localiser le niveau racine du composant App. Ajouter l'import en haut :

```tsx
import { PerfOverlay } from './components/ui/PerfOverlay'
```

Et dans le JSX racine (avant le fragment de fermeture ou avant `<Canvas>` selon structure), ajouter :

```tsx
<PerfOverlay />
```

- [ ] **Step 3: Vérifier qu'aucun renvoi en prod**

Run: `grep -n "process.env.NODE_ENV" src/components/ui/PerfOverlay.tsx`
Expected: 2 occurrences de `development`.

- [ ] **Step 4: Lancer `npm run dev:mobile`, ouvrir `https://localhost:3001/?perf=1`**

Expected : overlay visible en haut à gauche avec FPS + Heap + Tier. Toucher `P` masque/affiche.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/PerfOverlay.tsx src/App.tsx
git commit -m "feat(perf): overlay dev-only FPS/heap/tier (toggle P ou ?perf=1)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 0.3: Ajouter lecture `qualityTier` au store (stub pour Phase 2)

**Files:**
- Modify: `src/store/index.ts`

- [ ] **Step 1: Ajouter le champ dans l'interface store**

Lire `src/store/index.ts` ligne ~220-230 (section des types du store). Ajouter dans l'interface :

```ts
qualityTier: 'HIGH' | 'MEDIUM' | 'LOW'
setQualityTier: (tier: 'HIGH' | 'MEDIUM' | 'LOW') => void
```

- [ ] **Step 2: Ajouter la valeur par défaut + setter dans `create`**

Dans la déclaration `create`, ajouter :
```ts
qualityTier: 'HIGH',
setQualityTier: (tier) => set({ qualityTier: tier }),
```

- [ ] **Step 3: Vérifier compilation TypeScript**

Run: `npx tsc --noEmit`
Expected: 0 erreur TypeScript.

- [ ] **Step 4: Commit**

```bash
git add src/store/index.ts
git commit -m "feat(perf): stub qualityTier dans le store (HIGH par défaut, Phase 2 plug)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 0.4: Créer le doc baseline (squelette + chiffres desktop)

**Files:**
- Create: `docs/perf/baseline-2026-04-15.md`

- [ ] **Step 1: Créer `docs/perf/` et le fichier baseline avec contenu squelette**

```bash
mkdir -p docs/perf
```

Contenu du fichier :

```markdown
# Baseline Perf — 2026-04-15

Branche : `optimizations-avril`, commit : `<à remplir>`.

## Environnement
- Mac : <modèle / chip / RAM>
- Pixel 9 : Android <version> / Chrome <version>
- Wi-Fi : <SSID> (idem Mac et Pixel)
- Ancrage de mesure : `npm run dev:mobile` (HTTPS auto-cert Next).

## Scénarios

### B — Rotation caméra (Pixel 9, portrait, allée Action)
- Protocole : 3 runs de 15s, swipe continu droite ↔ gauche.
- Run 1 : fpsMin `__` / fpsP5 `__` / median `__` / fpsMax `__` — janks > 33ms `__`.
- Run 2 : `__` / `__` / `__` / `__` — `__`.
- Run 3 : `__` / `__` / `__` / `__` — `__`.
- Écart : `__` % (attendu < 10%).

### E — Premier passage (Pixel 9)
- Protocole : depuis spawn, marche normale jusqu'au fond, on passe devant les 6 allées non visitées. Enregistrer stutters > 100ms et allée associée.
- Run 1 : `__` stutters / détail par allée.
- Run 2, 3 : idem.

### F — Tutorial (Pixel 9)
- Protocole : lancer le tutorial, noter FPS à chaque transition waypoint + durée lerp actuelle (issue de Controls.tsx:714-733, coefficient 3.0 × delta).
- Étape 0→1 : `__` fps min, `__` frames > 33ms.
- Étape 1→2 : `__`, `__`.
- Étape 2→3 : `__`, `__`.
- Étape 3→4 : `__`, `__`.
- Étape 4→5 : `__`, `__`.
- Étape 5→6 : `__`, `__`.

### Bundle & chargement (Lighthouse mobile simulé — desktop Chrome)
- LCP : `__` ms.
- TTI : `__` ms.
- Total Blocking Time : `__` ms.
- JS transferé initial : `__` KB (gzipped).
- `.next/static/chunks` : `__` MB.
- Taille HDR `indoor_night.hdr` : 1.4 MB.

### Conditions hors mesure
- Batterie Pixel 9 > 50% (éviter thermal throttling).
- Pas de background apps lourdes.
- Scène chargée, attendre 10s idle avant chaque run.
```

- [ ] **Step 2: Commit le squelette**

```bash
git add docs/perf/baseline-2026-04-15.md
git commit -m "docs(perf): squelette doc baseline 2026-04-15 (chiffres à remplir)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 0.5: Exécuter le protocole et remplir la baseline (action utilisateur)

- [ ] **Step 1: Lancer le dev server mobile**

Run: `npm run dev:mobile`
Expected: serveur sur `https://localhost:3001` et `https://<IP-LAN>:3001`.

- [ ] **Step 2: Sur le Pixel 9, ouvrir `https://<IP-LAN>:3001/?perf=1`**

Accepter l'alerte cert auto-signé. Vérifier que l'overlay FPS s'affiche.

- [ ] **Step 3: Exécuter les 3 runs Scénario B**

Swipe continu 15s dans l'allée Action. Noter fpsMin / p5 / median / max / janks. Répéter 3× (idle 30s entre runs).

- [ ] **Step 4: Exécuter les 3 runs Scénario E**

Marche spawn → fond, noter stutters par allée. Répéter 3× en rechargeant la page (cache réseau vide entre runs).

- [ ] **Step 5: Exécuter les 3 runs Scénario F**

Depuis le menu, lancer le tutorial, noter FPS à chaque transition. Répéter 3×.

- [ ] **Step 6: Lighthouse mobile simulé (Chrome Desktop, tab incognito)**

Ouvrir `https://localhost:3001`, DevTools → Lighthouse → Mobile, Slow 4G throttling → Generate report. Noter LCP, TTI, TBT, JS transferé.

- [ ] **Step 7: Remplir `docs/perf/baseline-2026-04-15.md` avec tous les chiffres**

Valider que les 3 runs pour chaque scénario ont un écart < 10%. Si non, refaire le run.

- [ ] **Step 8: Commit baseline finalisée**

```bash
git add docs/perf/baseline-2026-04-15.md
git commit -m "docs(perf): baseline 2026-04-15 — chiffres Pixel 9 scénarios B/E/F + Lighthouse

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## ✅ CHECKPOINT PHASE 0

**Validation avant de passer à Phase 1** :
- [ ] Baseline committée avec chiffres concrets (pas de `__`).
- [ ] 3 runs concordants par scénario (écart < 10%).
- [ ] Overlay perf fonctionne sur Pixel 9.
- [ ] Sortie : tableau résumé à présenter à l'utilisateur pour validation Phase 1.

---

# PHASE 1 — Shader-compile stutter + Tutorial fluide

**Objectif** : éliminer stutter 1er passage, rendre tutorial fluide.
**Durée estimée** : 1-1.5 j.

### Task 1.1: Audit shaders TSL pour déterminisme (sous-partie 1B, quick)

**Files:** lecture seule.

- [ ] **Step 1: Chercher les sources non déterministes dans les shaders TSL**

Run:
```bash
grep -rnE "Math\.random\(\)|Date\.now\(\)|performance\.now\(\)" \
  src/components/interior/CassetteInstances.tsx \
  src/utils/CassetteTextureArray.ts \
  src/components/interior/PostProcessingEffects.tsx \
  src/components/interior/Lighting.tsx \
  src/utils/CassetteAnimationSystem.ts 2>/dev/null
```
Expected: matches uniquement pour usages runtime (JS), pas dans des sources TSL passées à Fn/compute.

- [ ] **Step 2: Chercher des template strings dynamiques passées à Fn/compute**

Run:
```bash
grep -rnE "Fn\(\`|compute\(\`|tsl\(\`" src/ 2>/dev/null
```
Expected: 0 match (les TSL sont JS builder, pas des template strings).

- [ ] **Step 3: Documenter le résultat**

Ajouter une note dans `docs/perf/phase-results-2026-04-15.md` (créer) :

```markdown
# Phase Results

## Phase 1.1 — Audit shaders déterministes (2026-04-15)
- `Math.random()` / `Date.now()` dans sources TSL : AUCUN (vérifié).
- Template strings TSL dynamiques : AUCUN (vérifié).
- Conclusion : cache shader Chrome devrait fonctionner nativement en visite répétée. Pas de fix nécessaire.
```

- [ ] **Step 4: Commit**

```bash
git add docs/perf/phase-results-2026-04-15.md
git commit -m "docs(perf): phase 1.1 — audit shaders TSL déterministes OK

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 1.2: Étendre le warmup shaders existant dans InteriorScene

**Files:**
- Modify: `src/components/interior/InteriorScene.tsx` (section warmup ~ligne 865-900)

- [ ] **Step 1: Lire le contexte actuel du warmup**

Run:
```bash
sed -n '855,910p' src/components/interior/InteriorScene.tsx
```
Relever le bloc de warmup existant (3 frames frustumCulled=false sur cassettes). Noter comment le renderer est obtenu (`gl.compileAsync` ou `useThree`).

- [ ] **Step 2: Remplacer/étendre par un warmup via `renderer.compileAsync(scene, camera)`**

Identifier l'endroit exact du warmup actuel. Remplacer par :

```tsx
// SHADER WARM-UP étendu : compile tous les pipelines via compileAsync,
// qui itère la scene et précompile les matériaux sans besoin d'afficher.
// Couvre : étagères, allée, néons, TV interactive, cassettes, post-processing.
try {
  await renderer.compileAsync(scene, camera)
} catch (e) {
  console.warn('[perf] compileAsync failed, fallback to frame warmup', e)
  // Fallback : conserver les 3 frames frustumCulled=false existants
}
```

Notes d'implémentation :
- Obtenir `renderer` via `useThree(state => state.gl)` déjà dispo dans le contexte.
- `scene` = `useThree(state => state.scene)`.
- `camera` = `useThree(state => state.camera)`.
- Le `await` suppose qu'on est dans une async function ou une Promise chain ; adapter au code existant.

- [ ] **Step 3: Build + dev run**

Run:
```bash
npm run build
```
Expected: pas d'erreur. Le warning tree-shaking attendu est ignoré à ce stade.

Puis : `npm run dev:mobile`, recharger la page, observer le temps de loading (attendre la fin). Il doit être +0.5 à +1.5s plus long que baseline.

- [ ] **Step 4: Tester le 1er passage sur Pixel 9**

Depuis le Pixel, recharger `https://<IP>:3001/?perf=1`. Marcher dans les 6 allées non visitées. Observer si stutters > 100ms sont éliminés (attendu : oui).

- [ ] **Step 5: Commit**

```bash
git add src/components/interior/InteriorScene.tsx
git commit -m "perf(phase1): warmup shaders étendu via renderer.compileAsync

Élimine le stutter de 1er passage en compilant tous les pipelines WebGPU
pendant le loading screen (étagères, allée, néons, TV, cassettes, post-proc).
Trade-off : +0.5 à 1.5s sur le loading, scène sans stutter après.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 1.3: Ajouter flag `isTutorialCameraMoving` au store + `lerpDuration` sur waypoints

**Files:**
- Modify: `src/store/index.ts`

- [ ] **Step 1: Étendre le type `TUTORIAL_WAYPOINTS`**

À la ligne 11 de `src/store/index.ts`, remplacer :

```ts
export const TUTORIAL_WAYPOINTS: { position: [number, number, number]; lookAt: [number, number, number] }[] = [
```

par :

```ts
export const TUTORIAL_WAYPOINTS: {
  position: [number, number, number];
  lookAt: [number, number, number];
  lerpDuration?: number; // en secondes, default 0.9
}[] = [
```

- [ ] **Step 2: Ajouter `lerpDuration` sur chaque waypoint**

Parcourir le tableau `TUTORIAL_WAYPOINTS` et attribuer une durée selon la distance approximative au précédent :
- 0→1 : 0.6s
- 1→2 : 0.6s
- 2→3 : 0.6s
- 3→4 : 0.9s (transition vers le manager, plus longue)
- 4→5 : 0.9s
- 5→6 : 0.6s

(Si le tableau n'a que 7 entrées d'index 0 à 6, adapter les `lerpDuration` du waypoint **cible** — c'est à lui qu'on lerp.)

- [ ] **Step 3: Ajouter `isTutorialCameraMoving` à l'interface store**

Près des autres flags tutorial (ligne ~224-226) :

```ts
isTutorialCameraMoving: boolean
setTutorialCameraMoving: (v: boolean) => void
```

- [ ] **Step 4: Initialiser + setter dans `create`**

```ts
isTutorialCameraMoving: false,
setTutorialCameraMoving: (v) => set({ isTutorialCameraMoving: v }),
```

- [ ] **Step 5: Vérif TypeScript**

Run: `npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 6: Commit**

```bash
git add src/store/index.ts
git commit -m "feat(tutorial): lerpDuration par waypoint + flag isTutorialCameraMoving

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 1.4: Tutorial lerp raccourci + easing dans Controls.tsx

**Files:**
- Modify: `src/components/interior/Controls.tsx` (section ~714-733)

- [ ] **Step 1: Lire le bloc tutorial actuel**

Run:
```bash
sed -n '705,745p' src/components/interior/Controls.tsx
```
Identifier :
- Variable `_tutorialPos`.
- `camera.position.lerp(_tutorialPos, 3.0 * delta)`.
- Condition d'activation (`tutorialCameraTarget !== null`).

- [ ] **Step 2: Remplacer le lerp par un lerp temporel + easing**

À la place de `camera.position.lerp(_tutorialPos, 3.0 * delta)`, insérer :

```ts
// Lerp temporel (pas frame-rate dependent), easing cubique, durée par waypoint
const waypoint = useStore.getState().tutorialCameraTarget
const waypointIdx = useStore.getState().tutorialStep
// lerpDuration cible (fallback 0.9s)
const duration = (waypoint as { lerpDuration?: number })?.lerpDuration ?? 0.9
// Temps écoulé depuis l'entrée dans ce waypoint
if (tutorialEnterRef.current === null || tutorialLastIdxRef.current !== waypointIdx) {
  tutorialEnterRef.current = performance.now()
  tutorialLastIdxRef.current = waypointIdx
  useStore.getState().setTutorialCameraMoving(true)
}
const elapsed = (performance.now() - tutorialEnterRef.current) / 1000
const tRaw = Math.min(elapsed / duration, 1)
// easeInOutCubic
const t = tRaw < 0.5 ? 4 * tRaw * tRaw * tRaw : 1 - Math.pow(-2 * tRaw + 2, 3) / 2
// Lerp absolu depuis la position au moment d'entrée dans ce waypoint
camera.position.lerpVectors(tutorialStartPosRef.current, _tutorialPos, t)
// Arrivée
if (tRaw >= 1 && useStore.getState().isTutorialCameraMoving) {
  useStore.getState().setTutorialCameraMoving(false)
}
```

Prérequis : ajouter en haut du composant (près des autres `useRef`) :

```ts
const tutorialEnterRef = useRef<number | null>(null)
const tutorialLastIdxRef = useRef<number | null>(null)
const tutorialStartPosRef = useRef(new THREE.Vector3())
```

Et remplir `tutorialStartPosRef.current.copy(camera.position)` **au moment** où `tutorialEnterRef` est set (bloc de détection d'entrée waypoint). L'ordre est :

```ts
if (tutorialEnterRef.current === null || tutorialLastIdxRef.current !== waypointIdx) {
  tutorialStartPosRef.current.copy(camera.position) // capture début
  tutorialEnterRef.current = performance.now()
  tutorialLastIdxRef.current = waypointIdx
  useStore.getState().setTutorialCameraMoving(true)
}
```

- [ ] **Step 3: Reset refs quand le tutorial se termine**

Rechercher dans `Controls.tsx` la branche où `tutorialCameraTarget === null` ou `tutorialStep === null`. Y ajouter :

```ts
tutorialEnterRef.current = null
tutorialLastIdxRef.current = null
if (useStore.getState().isTutorialCameraMoving) {
  useStore.getState().setTutorialCameraMoving(false)
}
```

- [ ] **Step 4: Vérif build**

Run: `npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 5: Test manuel desktop**

Run: `npm run dev`, lancer le tutorial. Transitions doivent être fluides, durée totale perçue réduite de ~50%.

- [ ] **Step 6: Commit**

```bash
git add src/components/interior/Controls.tsx
git commit -m "perf(tutorial): lerp temporel easeInOutCubic + flag isTutorialCameraMoving

Remplace le lerp frame-rate dependent par un lerp temporel absolu avec easing
cubique. Durée lue depuis TUTORIAL_WAYPOINTS.lerpDuration (0.6 ou 0.9s).
Flag isTutorialCameraMoving exposé au reste de l'app pour geler les coûts.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 1.5: Geler le raycast pendant `isTutorialCameraMoving`

**Files:**
- Modify: `src/components/interior/Controls.tsx` (section raycast ~865-880)

- [ ] **Step 1: Localiser les 2 blocs de raycast**

Run:
```bash
grep -n "raycasterRef.current.setFromCamera" src/components/interior/Controls.tsx
```
Expected: au moins 2 lignes (mobile tap + desktop center).

- [ ] **Step 2: Ajouter early-return dans les blocs useFrame concernés**

Devant chaque `raycasterRef.current.setFromCamera(...)`, ajouter la garde :

```ts
if (useStore.getState().isTutorialCameraMoving) return // skip raycast pendant tutorial move
```

**Note** : la garde doit être dans le bon scope — si c'est dans un `useFrame`, early-return y fonctionne ; si c'est dans une boucle ou handler, utiliser `continue` ou wrap dans une condition.

- [ ] **Step 3: Vérifier que les handlers touch mobile ne raycastent pas non plus**

Dans `src/components/interior/Controls.tsx`, chercher `onPointerDown`/`onTouchStart`. Si un raycast est fait dans un handler, y appliquer la même garde.

- [ ] **Step 4: Test manuel**

Lancer le tutorial avec `?perf=1`, observer que pendant un lerp waypoint le FPS ne droppe plus sous 50.

- [ ] **Step 5: Commit**

```bash
git add src/components/interior/Controls.tsx
git commit -m "perf(tutorial): gate raycast pendant isTutorialCameraMoving

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 1.6: Geler les CanvasTexture updates sur InteractiveTVDisplay

**Files:**
- Modify: `src/components/interior/InteractiveTVDisplay.tsx`

- [ ] **Step 1: Trouver le bloc de mise à jour LCD**

Run:
```bash
grep -n "needsUpdate\|CanvasTexture\|distSq.*36\|drawLCD" src/components/interior/InteractiveTVDisplay.tsx
```
Expected: quelques matches autour du gating distance existant (6m).

- [ ] **Step 2: Ajouter la garde `isTutorialCameraMoving`**

Devant le bloc qui fait `texture.needsUpdate = true` ou appelle `drawLCD()`, ajouter :

```ts
if (useStore.getState().isTutorialCameraMoving) return
```

- [ ] **Step 3: Test**

Lancer le tutorial, observer que la LCD ne se rafraîchit pas pendant les transitions — elle se remet à jour à l'arrivée (OK).

- [ ] **Step 4: Commit**

```bash
git add src/components/interior/InteractiveTVDisplay.tsx
git commit -m "perf(tutorial): gate LCD CanvasTexture updates pendant tutorial moving

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 1.7: Pauser la chaîne poster decode pendant `isTutorialCameraMoving`

**Files:**
- Modify: `src/utils/CassetteTextureArray.ts`

- [ ] **Step 1: Localiser le boucleur de remplissage de posters**

Run:
```bash
grep -n "copyExternalImageToTexture\|dirty\|flush\|next poster\|loadNextPoster" src/utils/CassetteTextureArray.ts
```
Expected: boucle async qui décode les posters et fait des uploads GPU.

- [ ] **Step 2: Ajouter une garde au prochain cycle**

Au début de la fonction qui pick le prochain poster à décoder (typiquement `processQueue`/`loadNext`/équivalent) :

```ts
import { useStore } from '../store'

// Skip une itération si tutorial en cours de transition
if (useStore.getState().isTutorialCameraMoving) {
  setTimeout(() => this.processQueue(), 80)
  return
}
```

Adapter le nom `processQueue` au vrai nom trouvé. Le `setTimeout` permet de reprendre automatiquement après la transition.

- [ ] **Step 3: Test**

Lancer tutorial, observer qu'aucune nouvelle image de poster ne s'uploade pendant le lerp. Posters remplissent à nouveau à l'arrivée.

- [ ] **Step 4: Commit**

```bash
git add src/utils/CassetteTextureArray.ts
git commit -m "perf(tutorial): pause chaîne poster decode pendant tutorial moving

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 1.8: Bloom strength vers 0 pendant tutorial moving

**Files:**
- Modify: `src/components/interior/PostProcessingEffects.tsx`

- [ ] **Step 1: Localiser le lerp bloom existant**

Run:
```bash
grep -n "bloomStrengthRef\|bloomTarget\|lerp" src/components/interior/PostProcessingEffects.tsx
```
Expected: ligne 116-118 avec `bloomStrengthRef.current.value += (bloomTarget - currentBloom) * Math.min(delta * 8, 1)`.

- [ ] **Step 2: Ajouter la condition tutorialMoving dans le calcul de `bloomTarget`**

Rechercher l'endroit où `bloomTarget` est défini (probablement basé sur `isVHSCaseOpen`). Étendre :

```ts
const isTutorialMoving = useStore(state => state.isTutorialCameraMoving)
// bloomTarget actuel : typiquement BLOOM_STRENGTH * (isVHSCaseOpen ? 0 : 1)
// Nouveau :
const bloomTarget = BLOOM_STRENGTH * (isVHSCaseOpen || isTutorialMoving ? 0 : 1)
```

Adapter aux constantes/variables existantes (`BLOOM_STRENGTH`, `isVHSCaseOpen`, etc.).

- [ ] **Step 3: Ajuster le coefficient de lerp pour une réponse plus rapide**

Le `delta * 8` actuel = ~125ms de transition (assez rapide). OK, ne pas modifier.

- [ ] **Step 4: Test**

Lancer tutorial avec `?perf=1`, le bloom doit s'atténuer pendant les transitions et remonter à l'arrivée (invisible visuellement sur 600ms transition mais mesurable en FPS).

- [ ] **Step 5: Commit**

```bash
git add src/components/interior/PostProcessingEffects.tsx
git commit -m "perf(tutorial): bloom strength lerp vers 0 pendant tutorial moving

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 1.9: Mesure Phase 1 sur Pixel 9

**Files:**
- Modify: `docs/perf/phase-results-2026-04-15.md`

- [ ] **Step 1: Dans `docs/perf/phase-results-2026-04-15.md`, ajouter la section Phase 1**

```markdown
## Phase 1 — Shader warmup + Tutorial (2026-04-__)

### Scénario E — Premier passage
- Baseline : <chiffres issus de baseline-2026-04-15.md>
- Après : `__` stutters (attendu ≤ 1, 0 idéal)
- Gain : `__`

### Scénario F — Tutorial
- Baseline : FPS min par transition
- Après : FPS min par transition (aucune frame > 33ms attendue)
- Gain : `__` (% frames > 33ms éliminées)

### Impact loading
- Baseline TTI : `__`
- Après TTI : `__` (attendu +0.5 à +1.5s acceptable)

### Impact desktop (non-régression)
- FPS idle : baseline `__` → après `__` (écart doit être < 2 fps)
```

- [ ] **Step 2: Remplir les chiffres après les 3 runs Pixel 9**

Protocole identique à Phase 0.

- [ ] **Step 3: Validation**

Tous les critères de succès Phase 1 atteints ?
- [ ] FPS min ≥ 40 sur 1er passage Pixel 9 dans toutes les allées.
- [ ] Aucune frame > 33ms pendant un lerp waypoint tutorial.
- [ ] TTI ≤ +1s vs baseline.
- [ ] Pas de régression desktop.

Si non : diagnostic, retour en arrière partiel, ou ajustement (ex: augmenter/réduire durée warmup, ajuster `lerpDuration`).

- [ ] **Step 4: Commit**

```bash
git add docs/perf/phase-results-2026-04-15.md
git commit -m "docs(perf): résultats Phase 1 mesurés sur Pixel 9

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## ✅ CHECKPOINT PHASE 1

**Validation avant de passer à Phase 2** :
- [ ] Phase 1 mesurée et documentée.
- [ ] Critères Phase 1 atteints OU arbitrage utilisateur (go/no-go).
- [ ] Commits Phase 1 atomiques (1 par sous-partie).
- [ ] Aucun warning console nouveau en runtime.

---

# PHASE 2 — Rotation caméra fluide (profil-guidé)

**Objectif** : rotation fluide 45-60 fps stable, + palier qualité dynamique.
**Durée estimée** : 1.5-2 j.

### Task 2.1: Capture trace Chrome Performance Pixel 9 (action utilisateur)

**Files:** aucune, création de trace exportée.

- [ ] **Step 1: Activer USB debugging sur Pixel 9**

Paramètres → À propos → appuyer 7× sur "Numéro de build" → retour Paramètres → Options pour les développeurs → "Débogage USB" ON.

- [ ] **Step 2: Connecter Pixel au Mac en USB, autoriser sur l'écran du Pixel**

- [ ] **Step 3: Ouvrir Chrome Desktop → `chrome://inspect/#devices`**

Expected: Pixel 9 listé. Cliquer "inspect" sur le tab ouvert `https://<IP>:3001/?perf=1`.

- [ ] **Step 4: DevTools ouverts → Performance tab → Record**

Scène chargée, idle 10s dans l'allée Action. Lancer record. Swiper rotation droite ↔ gauche pendant 6s. Stop.

- [ ] **Step 5: Analyser le trace**

Noter les 5 plus gros hotspots :
1. Main thread self time > 500ms.
2. GPU time moyenne par frame.
3. React reconciliation flamegraph.
4. Long tasks > 50ms.
5. Script evaluation durant rotation.

- [ ] **Step 6: Exporter le trace pour conservation**

Bouton "Save profile" → sauver dans `docs/perf/traces/rotation-pixel9-<date>.json` (créer dossier).

```bash
mkdir -p docs/perf/traces
```

### Task 2.2: Documenter les hotspots

**Files:**
- Create: `docs/perf/rotation-profile-2026-04-15.md`

- [ ] **Step 1: Créer le document avec l'analyse**

```markdown
# Rotation Profile Pixel 9 — 2026-04-15

Branche : `optimizations-avril`
Trace : `docs/perf/traces/rotation-pixel9-2026-04-15.json`

## Top-5 Hotspots

### 1. <nom fonction/composant>
- **Self time** : __ ms / 6000 ms total trace (__ %)
- **Fichier** : `<path>:<line>`
- **Cause probable** : <analyse>
- **Fix proposé** : <fix>

### 2–5. ...

## FPS observé
- Min / P5 / Median / Max sur la rotation : __ / __ / __ / __

## Plan d'action Phase 2B
- Fix 1 : <hotspot 1>
- Fix 2 : <hotspot 2>
- (Fix 3 optionnel)
```

- [ ] **Step 2: Remplir avec l'analyse réelle du trace**

- [ ] **Step 3: Commit**

```bash
git add docs/perf/rotation-profile-2026-04-15.md docs/perf/traces/
git commit -m "docs(perf): profile rotation Pixel 9 — top-5 hotspots

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 2.3: Ajouter flag `isCameraRotating` au store

**Files:**
- Modify: `src/store/index.ts`

- [ ] **Step 1: Ajouter à l'interface**

```ts
isCameraRotating: boolean
setCameraRotating: (v: boolean) => void
```

- [ ] **Step 2: Valeur initiale + setter**

```ts
isCameraRotating: false,
setCameraRotating: (v) => set({ isCameraRotating: v }),
```

- [ ] **Step 3: Vérif TypeScript**

Run: `npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 4: Commit**

```bash
git add src/store/index.ts
git commit -m "feat(rotation): flag isCameraRotating dans le store

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 2.4: Détecter rotation active dans Controls.tsx (set/reset flag)

**Files:**
- Modify: `src/components/interior/Controls.tsx`

- [ ] **Step 1: Localiser le handler touch mobile**

Run:
```bash
grep -n "onTouchMove\|onPointerMove\|mobileInput\|yaw\|pitch" src/components/interior/Controls.tsx | head -20
```

- [ ] **Step 2: Ajouter un watchdog timer**

Près des autres refs en tête du composant :

```ts
const rotationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
const lastRotateTsRef = useRef(0)
```

- [ ] **Step 3: Dans le useFrame (ou handler) qui applique la rotation caméra, détecter le delta**

Après le calcul du delta yaw/pitch (Δ > 0.0015 rad typiquement = seuil swipe actif) :

```ts
const rotationDeltaMagnitude = Math.abs(dYaw) + Math.abs(dPitch)
if (rotationDeltaMagnitude > 0.0015) {
  if (!useStore.getState().isCameraRotating) {
    useStore.getState().setCameraRotating(true)
  }
  lastRotateTsRef.current = performance.now()
  if (rotationTimeoutRef.current) clearTimeout(rotationTimeoutRef.current)
  rotationTimeoutRef.current = setTimeout(() => {
    if (performance.now() - lastRotateTsRef.current >= 150) {
      useStore.getState().setCameraRotating(false)
    }
  }, 160)
}
```

Adapter les noms `dYaw`/`dPitch` au code existant.

- [ ] **Step 4: Tester sur desktop (simulateur touch DevTools)**

Run: `npm run dev`, DevTools → Toggle device toolbar → Pixel 9, swiper. Overlay perf affiche FPS — flag `isCameraRotating` vérifiable via React DevTools store.

- [ ] **Step 5: Commit**

```bash
git add src/components/interior/Controls.tsx
git commit -m "feat(rotation): détection rotation active + watchdog 150ms

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 2.5: Appliquer les fixes issus du profil (guidé par Task 2.2)

**Files:**
- Modify: selon hotspots (Controls.tsx, PostProcessingEffects.tsx, ou CassetteTextureArray.ts)

> **Cette tâche est conditionnelle**. Les sous-étapes dépendent du profil réel.

- [ ] **Step 1: Pour chaque hotspot identifié, appliquer le fix correspondant**

Mapping indicatif :

| Hotspot | Fix concret |
|---|---|
| Raycast > 5% | Dans `Controls.tsx`, raycast skip si `isCameraRotating` (ou throttle double : pass de 2f à 4f pendant rotation). |
| Poster decode bloquant | Dans `CassetteTextureArray.ts`, pause identique tutorial (réutiliser la garde, étendre à `isCameraRotating`). |
| Zustand selectors re-render | Remplacer `useStore(s => s.xxx)` par `useStore.getState().xxx` dans les handlers / ou `subscribe()` pour high-freq. |
| React reconciliation | `React.memo(Component)` sur les composants Canvas sans deps dynamiques. |
| DoF actif | Ajouter condition : `dof` actif **uniquement si `isVHSCaseOpen`**. Vérifier le gate dans PostProcessingEffects. |
| GPU frame > 16ms | Réduire taille Bloom mip chain (si réglable) OU skip FXAA pendant rotation. |
| Touch handler lourd | Déplacer parsing delta dans rAF (Controls utilise déjà useFrame donc OK) ou ajouter throttle 8ms. |

- [ ] **Step 2: Commit individuel par fix**

```bash
git commit -m "perf(rotation): <hotspot name> — <fix description>

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 3: Mesurer après chaque fix**

Sur Pixel 9, 15s rotation continue. Noter fpsMin. Si gain < 2 fps, envisager un fix alternatif.

### Task 2.6: Créer `src/utils/qualityTier.ts` (logique + hysteresis)

**Files:**
- Create: `src/utils/qualityTier.ts`

- [ ] **Step 1: Créer le fichier**

```ts
export type QualityTier = 'HIGH' | 'MEDIUM' | 'LOW'

export interface TierConfig {
  dpr: number
  bloomStrength: number
  shadowMapSize: number
  shadowsEnabled: boolean
  fxaaEnabled: boolean
}

export const TIER_CONFIGS: Record<QualityTier, TierConfig> = {
  HIGH:   { dpr: 1.7, bloomStrength: 0.12, shadowMapSize: 256, shadowsEnabled: true,  fxaaEnabled: true  },
  MEDIUM: { dpr: 1.4, bloomStrength: 0.08, shadowMapSize: 128, shadowsEnabled: true,  fxaaEnabled: true  },
  LOW:    { dpr: 1.2, bloomStrength: 0.06, shadowMapSize: 128, shadowsEnabled: false, fxaaEnabled: false },
}

export interface TierAdapter {
  sample(fps: number): QualityTier | null // retourne un tier cible si changement recommandé, sinon null
}

export function createTierAdapter(initial: QualityTier = 'HIGH'): TierAdapter {
  let currentTier: QualityTier = initial
  let recentSamples: number[] = []
  let lastChangeTs = 0
  const DOWNGRADE_WINDOW = 60 // frames
  const UPGRADE_WINDOW = 300 // frames
  const DEBOUNCE_MS = 5000

  return {
    sample(fps) {
      recentSamples.push(fps)
      if (recentSamples.length > UPGRADE_WINDOW) recentSamples.shift()
      const now = performance.now()
      if (now - lastChangeTs < DEBOUNCE_MS) return null

      // Downgrade check (60 samples)
      if (recentSamples.length >= DOWNGRADE_WINDOW) {
        const last60 = recentSamples.slice(-DOWNGRADE_WINDOW)
        const avg60 = last60.reduce((a, b) => a + b, 0) / DOWNGRADE_WINDOW
        if (avg60 < 40 && currentTier !== 'LOW') {
          const nextTier: QualityTier = currentTier === 'HIGH' ? 'MEDIUM' : 'LOW'
          currentTier = nextTier
          lastChangeTs = now
          recentSamples = [] // reset après changement
          return nextTier
        }
      }

      // Upgrade check (300 samples)
      if (recentSamples.length >= UPGRADE_WINDOW) {
        const avg300 = recentSamples.reduce((a, b) => a + b, 0) / UPGRADE_WINDOW
        if (avg300 > 55 && currentTier !== 'HIGH') {
          const nextTier: QualityTier = currentTier === 'LOW' ? 'MEDIUM' : 'HIGH'
          currentTier = nextTier
          lastChangeTs = now
          recentSamples = []
          return nextTier
        }
      }
      return null
    },
  }
}
```

- [ ] **Step 2: Ajouter un test simple**

Créer `tests/qualityTier.test.mjs` :

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTierAdapter } from '../src/utils/qualityTier.ts'

test('downgrade after 60 frames < 40fps', () => {
  const adapter = createTierAdapter('HIGH')
  let result = null
  for (let i = 0; i < 60; i++) {
    result = adapter.sample(35)
  }
  assert.equal(result, 'MEDIUM')
})

test('no change before debounce', () => {
  const adapter = createTierAdapter('HIGH')
  // Burst downgrade
  for (let i = 0; i < 60; i++) adapter.sample(35)
  // Immédiatement re-burst downgrade (devrait être bloqué par DEBOUNCE_MS)
  let result = null
  for (let i = 0; i < 60; i++) result = adapter.sample(35)
  assert.equal(result, null)
})
```

Note : ce test nécessite `--experimental-strip-types` ou équivalent. Alternative : mocker en JS pur dans le test si strip-types pas dispo.

- [ ] **Step 3: Run test**

Run: `node --test tests/qualityTier.test.mjs`
Expected: PASS. Si échec d'import TS, convertir l'import en `require(...).default` ou build d'abord.

- [ ] **Step 4: Commit**

```bash
git add src/utils/qualityTier.ts tests/qualityTier.test.mjs
git commit -m "feat(quality): MobileQualityTier 3 niveaux + hysteresis 5s

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 2.7: Créer `src/hooks/useQualityTier.ts` (binding R3F → store)

**Files:**
- Create: `src/hooks/useQualityTier.ts`

- [ ] **Step 1: Créer le hook**

```ts
import { useEffect, useRef } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { useStore } from '../store'
import { createTierAdapter, TIER_CONFIGS, type QualityTier } from '../utils/qualityTier'

export function useQualityTier() {
  const tier = useStore(state => state.qualityTier)
  const setTier = useStore(state => state.setQualityTier)
  const gl = useThree(state => state.gl)
  const adapterRef = useRef(createTierAdapter('HIGH'))
  const lastFrameRef = useRef(performance.now())

  // Sampler de FPS → suggestion de tier
  useFrame(() => {
    const now = performance.now()
    const fps = 1000 / (now - lastFrameRef.current)
    lastFrameRef.current = now
    const suggested = adapterRef.current.sample(fps)
    if (suggested && suggested !== tier) {
      setTier(suggested)
    }
  })

  // Applique DPR selon tier (seulement si scène stable, pas pendant rotation)
  useEffect(() => {
    const cfg = TIER_CONFIGS[tier]
    const isRotating = useStore.getState().isCameraRotating
    if (!isRotating) {
      gl.setPixelRatio(Math.min(cfg.dpr, window.devicePixelRatio))
    }
  }, [tier, gl])

  return tier
}
```

- [ ] **Step 2: Activer le hook dans `InteriorScene.tsx`**

Lire la section du composant Canvas. Dans le sous-composant qui s'exécute à l'intérieur de Canvas, ajouter :

```tsx
import { useQualityTier } from '../../hooks/useQualityTier'

function PerfAdapter() {
  useQualityTier()
  return null
}

// ... dans le Canvas :
<PerfAdapter />
```

- [ ] **Step 3: Vérif TypeScript**

Run: `npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useQualityTier.ts src/components/interior/InteriorScene.tsx
git commit -m "feat(quality): hook useQualityTier — bind adapter → DPR live

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 2.8: PostProcessingEffects lit le tier pour bloom + FXAA

**Files:**
- Modify: `src/components/interior/PostProcessingEffects.tsx`

- [ ] **Step 1: Lire le tier**

En tête du composant :

```tsx
const tier = useStore(state => state.qualityTier)
import { TIER_CONFIGS } from '../../utils/qualityTier'
```

- [ ] **Step 2: Appliquer bloomStrength selon tier**

Remplacer la constante hardcodée `BLOOM_STRENGTH` par `TIER_CONFIGS[tier].bloomStrength` dans le calcul de `bloomTarget`.

- [ ] **Step 3: Conditionner FXAA**

Dans la pipeline mobile et desktop, wrap le FXAA dans `TIER_CONFIGS[tier].fxaaEnabled ? fxaa(...) : ...`.

Note : changer FXAA on/off à chaud peut nécessiter de recréer la pipeline (`postProcessing.outputNode = ...`). Accepter un recompile occasionnel lors des rares switches de tier.

- [ ] **Step 4: Test desktop**

Run: `npm run dev`, vérifier visuellement qu'en tier HIGH le rendu est identique à avant.

- [ ] **Step 5: Commit**

```bash
git add src/components/interior/PostProcessingEffects.tsx
git commit -m "feat(quality): bloomStrength + FXAA selon qualityTier

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 2.9: Shadow toggle selon tier dans Lighting.tsx

**Files:**
- Modify: `src/components/interior/Lighting.tsx`

- [ ] **Step 1: Lire le tier**

```tsx
import { useStore } from '../../store'
import { TIER_CONFIGS } from '../../utils/qualityTier'

// Dans le composant :
const tier = useStore(state => state.qualityTier)
const cfg = TIER_CONFIGS[tier]
```

- [ ] **Step 2: Appliquer aux lights pertinentes**

Pour les `<directionalLight>` ou `<pointLight>` qui projettent des ombres, ajouter :

```tsx
<directionalLight
  // ... props existantes
  castShadow={cfg.shadowsEnabled}
  shadow-mapSize-width={cfg.shadowMapSize}
  shadow-mapSize-height={cfg.shadowMapSize}
/>
```

- [ ] **Step 3: Test**

Run: `npm run dev`, vérifier visuellement tier HIGH. Temporairement forcer tier=LOW via `useStore.getState().setQualityTier('LOW')` en console → shadows désactivées.

- [ ] **Step 4: Commit**

```bash
git add src/components/interior/Lighting.tsx
git commit -m "feat(quality): shadow toggle/size selon qualityTier

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 2.10: Affichage du tier dans PerfOverlay (déjà inclus, vérifier)

**Files:**
- Modify: `src/components/ui/PerfOverlay.tsx` (si besoin)

- [ ] **Step 1: Vérifier que `tier` est bien lu**

Le code de Task 0.2 inclut déjà `const qualityTier = useStore(s => s.qualityTier ?? '-')` et l'affichage. Vérifier en dev que le tier bascule sur un device faible.

- [ ] **Step 2: Pas de commit si pas de changement**

### Task 2.11: Mesure Phase 2 sur Pixel 9

**Files:**
- Modify: `docs/perf/phase-results-2026-04-15.md`

- [ ] **Step 1: Ajouter la section Phase 2 dans le doc**

```markdown
## Phase 2 — Rotation + Tier dynamique (2026-04-__)

### Scénario B — Rotation
- Baseline : fpsMin / p5 / median / max — janks > 33ms
- Après : fpsMin / p5 / median / max — janks > 33ms
- Gain fpsMin : +__ fps.

### Tier comportement
- Pixel 9 démarre à HIGH (attendu).
- Temporairement MEDIUM pendant rotation de 15s ? oui/non.
- Reset à HIGH après 5s idle ? oui/non.

### Non-régression desktop
- FPS rotation desktop : baseline __ → après __ (écart doit être < 2 fps).
```

- [ ] **Step 2: Remplir après 3 runs**

- [ ] **Step 3: Validation**
- [ ] fpsMin ≥ 40 rotation Pixel 9.
- [ ] Aucun drop < 30.
- [ ] Tier n'oscille pas en < 5s.

- [ ] **Step 4: Commit**

```bash
git add docs/perf/phase-results-2026-04-15.md
git commit -m "docs(perf): résultats Phase 2 mesurés sur Pixel 9

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## ✅ CHECKPOINT PHASE 2

**Validation avant de passer à Phase 3** :
- [ ] Phase 2 mesurée et documentée.
- [ ] Critères Phase 2 atteints OU arbitrage utilisateur.
- [ ] Tier dynamique fonctionne sans flicker.
- [ ] Aucune régression visuelle détectable en HIGH.

**Critère d'arrêt anticipé** : si tous les critères mobiles (Phase 1 + Phase 2) sont atteints ET bundle initial gzipped est déjà ≤ 3MB, Phase 3 peut être réduite à **3A + 3E uniquement** (décision utilisateur).

---

# PHASE 3 — Bundle & temps de chargement

**Objectif** : bundle initial gzipped ≤ 2.5MB, LCP −1s min.
**Durée estimée** : 1.25-2 j.

### Task 3.1: Activer bundle analyzer conditionnel

**Files:**
- Modify: `next.config.ts`, `package.json` (devDep)

- [ ] **Step 1: Installer `@next/bundle-analyzer`**

Run:
```bash
npm install --save-dev @next/bundle-analyzer
```
Expected: ajouté en `devDependencies`.

- [ ] **Step 2: Wrap `nextConfig` dans `next.config.ts`**

En début de fichier :

```ts
import withBundleAnalyzerFn from '@next/bundle-analyzer'

const withBundleAnalyzer = withBundleAnalyzerFn({
  enabled: process.env.ANALYZE === 'true',
})
```

En fin :

```ts
export default withBundleAnalyzer(nextConfig)
```

- [ ] **Step 3: Test**

Run:
```bash
ANALYZE=true npm run build
```
Expected: build complet + ouverture automatique 3 tabs (client / edge / nodejs) avec treemaps HTML.

- [ ] **Step 4: Capturer screenshots baseline**

Sauver en `docs/perf/bundle-baseline-2026-04-15.png` (ou `.html` exporté).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json next.config.ts docs/perf/
git commit -m "chore(perf): activation bundle analyzer via ANALYZE=true

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 3.2: Codemod Three.js imports — script

**Files:**
- Create: `scripts/codemod-three-imports.mjs`

- [ ] **Step 1: Créer le script**

```js
#!/usr/bin/env node
/**
 * Codemod : import * as THREE from 'three' → imports nommés.
 * Usage : node scripts/codemod-three-imports.mjs [--dry-run]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { globSync } from 'glob'

const DRY = process.argv.includes('--dry-run')
const files = globSync('src/**/*.{ts,tsx}', { absolute: true })

let modified = 0
let skipped = 0

for (const file of files) {
  const src = readFileSync(file, 'utf8')
  const starImport = src.match(/import \* as THREE from ['"]three(\/webgpu)?['"]/)
  if (!starImport) continue

  // Collecter tous les accès THREE.X
  const usedRe = /\bTHREE\.(\w+)/g
  const used = new Set()
  let m
  while ((m = usedRe.exec(src)) !== null) used.add(m[1])

  // Skip si des formes dynamiques sont utilisées
  if (src.includes('THREE[') || src.includes('Object.keys(THREE)') || src.includes('Object.values(THREE)')) {
    console.log(`[SKIP] ${file} — usage dynamique de THREE détecté`)
    skipped++
    continue
  }

  if (used.size === 0) {
    console.log(`[SKIP] ${file} — aucun accès THREE.X`)
    skipped++
    continue
  }

  const importPath = starImport[0].includes('/webgpu') ? 'three/webgpu' : 'three'
  const namedImports = [...used].sort().join(', ')
  const newImport = `import { ${namedImports} } from '${importPath}'`

  let output = src.replace(starImport[0], newImport)
  // Remplacer chaque accès THREE.X par X
  for (const name of used) {
    const re = new RegExp(`\\bTHREE\\.${name}\\b`, 'g')
    output = output.replace(re, name)
  }

  if (DRY) {
    console.log(`[DRY] ${file} — ${used.size} symboles (${namedImports})`)
  } else {
    writeFileSync(file, output, 'utf8')
    console.log(`[OK]  ${file} — ${used.size} symboles`)
  }
  modified++
}

console.log(`\nTotal: ${modified} modifiés, ${skipped} skipped.`)
```

- [ ] **Step 2: Tester en dry-run**

Run:
```bash
node scripts/codemod-three-imports.mjs --dry-run
```
Expected: liste des 32 fichiers avec nombre de symboles, aucun SKIP sauf si usage dynamique.

- [ ] **Step 3: Si des SKIPs apparaissent, noter les fichiers pour revue manuelle**

- [ ] **Step 4: Commit le script**

```bash
git add scripts/codemod-three-imports.mjs
git commit -m "chore(perf): codemod Three.js imports (dry-run validé)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 3.3: Exécuter le codemod + vérif manuelle

**Files:** 32 fichiers.

- [ ] **Step 1: Exécuter en mode écriture**

Run:
```bash
node scripts/codemod-three-imports.mjs
```
Expected: ~32 fichiers modifiés.

- [ ] **Step 2: Vérif TypeScript**

Run: `npx tsc --noEmit`
Expected: 0 erreur. Si erreur sur un symbole manquant, investiguer : soit le codemod a manqué un usage (ex: `THREE.MathUtils.lerp`), soit l'export n'existe pas dans `three/webgpu` (fallback `three`).

- [ ] **Step 3: Vérif visuelle ciblée**

Run: `git diff --stat`
Expected: ~32 fichiers modifiés, balance ajouts ≈ suppressions. Spot-check 3-4 fichiers aléatoires : chaque import nommé est cohérent avec les usages.

- [ ] **Step 4: Build complet**

Run: `npm run build`
Expected: success.

- [ ] **Step 5: Analyzer post-codemod**

Run:
```bash
ANALYZE=true npm run build
```
Comparer la taille du chunk `three` vs baseline. Attendu : −30 à −50%.

- [ ] **Step 6: Test runtime — desktop smoke**

Run: `npm run dev`, naviguer dans la scène, ouvrir une K7, jouer une vidéo, ouvrir le terminal. Aucune erreur console.

- [ ] **Step 7: Commit**

```bash
git add src/
git commit -m "perf(bundle): tree-shaking Three.js (import * as → imports nommés) sur 32 fichiers

Gain bundle chunk three : -__% (cf. docs/perf/phase-results-2026-04-15.md).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 3.4: Prefetch Aisle + VHSCaseOverlay module-level

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Lire la tête du fichier**

Run:
```bash
sed -n '1,60p' src/App.tsx
```
Identifier le prefetch existant (HDR/KTX2/fetch API films).

- [ ] **Step 2: Ajouter les prefetch module-level**

En haut du fichier, au niveau module (pas dans le composant) :

```ts
// Prefetch non-bloquant des chunks lourds
if (typeof window !== 'undefined') {
  import('./components/interior/Aisle').catch(() => {/* non-critique */})
  import('./components/videoclub/VHSCaseOverlay').catch(() => {/* non-critique */})
}
```

- [ ] **Step 3: Build + mesure**

Run: `npm run build && npm run start`
Mesure Lighthouse mobile simulé. TTI attendu en baisse.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "perf(bundle): prefetch Aisle + VHSCaseOverlay module-level

Avance le téléchargement des chunks lourds dès le chargement du module App,
avant même que React monte. Non-bloquant (promise ignorée si échec).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 3.5: Convertir HDR en KTX2 (UASTC HDR)

**Files:**
- Create: `public/textures/env/indoor_night.ktx2`
- Modify: `src/components/interior/InteriorScene.tsx`

- [ ] **Step 1: Installer ktxtools (si absent)**

```bash
which toktx || brew install ktxtools
```
Expected: chemin vers `toktx` (Khronos KTX Tools).

- [ ] **Step 2: Convertir l'HDR**

```bash
toktx --target_type R11G11B10_UFLOAT --genmipmap --uastc \
  public/textures/env/indoor_night.ktx2 \
  public/textures/env/indoor_night.hdr
```

Note : si `--target_type` n'est pas supporté, tester `toktx --help`. Alternative avec basisu :

```bash
basisu -ktx2 -uastc -hdr public/textures/env/indoor_night.hdr -output_file public/textures/env/indoor_night.ktx2
```

Vérifier la taille : attendu ~200-400KB (vs 1.4MB original).

- [ ] **Step 3: Modifier `InteriorScene.tsx:115-117`**

Remplacer :

```tsx
files="/textures/env/indoor_night.hdr"
```

par :

```tsx
files="/textures/env/indoor_night.ktx2"
```

Note : drei `<Environment>` peut utiliser automatiquement KTX2Loader si l'extension est `.ktx2`. Si échec (404 ou render blanc), charger manuellement avec `KTX2Loader` + `useLoader` + `scene.environment = texture`.

- [ ] **Step 4: Test visuel**

Run: `npm run dev`, comparer le rendu scène vs avant. Banding dans les zones sombres ? Si oui, tester avec `--uastc_level 4` (meilleure qualité).

- [ ] **Step 5: Conserver l'HDR original pour fallback**

Garder `public/textures/env/indoor_night.hdr` dans le repo — le fallback est manuel pour l'instant.

- [ ] **Step 6: Commit**

```bash
git add public/textures/env/indoor_night.ktx2 src/components/interior/InteriorScene.tsx
git commit -m "perf(bundle): HDR indoor_night converti en KTX2 UASTC HDR

Gain : 1.4MB → ~__KB (−__%). Rendu visuellement identique (validé).
HDR original conservé en fallback.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 3.6: Audit deps + choix 1-2 fixes ciblés

**Files:** conditionnel, selon audit.

- [ ] **Step 1: Relire le bundle analyzer post-Task 3.5**

Run: `ANALYZE=true npm run build`
Identifier dans le treemap client les 5 plus grosses deps.

- [ ] **Step 2: Vérifier que les deps serveur ne remontent pas côté client**

Spécifiquement chercher `@ai-sdk/*`, `@langfuse/otel`, `better-sqlite3`, `bcrypt` dans le treemap **client** (treemap server est OK). Si présents côté client, c'est un leak.

- [ ] **Step 3: Vérifier `@react-three/drei` imports**

Run:
```bash
grep -rn "from '@react-three/drei'" src/ | awk -F'import' '{print $2}' | sort -u | head -20
```
Expected: liste des sub-imports. Si import `from '@react-three/drei'` (racine) sans sub-path, le tree-shake peut être dégradé.

- [ ] **Step 4: Applique 0-2 fixes ciblés selon ce qui ressort**

Exemples de fixes possibles :
- Si `@react-three/drei` unused Environment : importer un module plus léger.
- Si doublon `dayjs` + `date-fns` : unifier sur une seule lib.
- Si leak d'une dep serveur : revoir `"use client"` vs `"use server"`.

- [ ] **Step 5: Commit par fix**

```bash
git commit -m "perf(bundle): <dep/fix> — <description>

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 3.7: Split monolithes — conditionnel

**Files:** conditionnel, `src/components/interior/InteractiveTVDisplay.tsx` et/ou `src/components/videoclub/VHSCaseOverlay.tsx`.

- [ ] **Step 1: Vérifier si le split est justifié**

Regarder le treemap analyzer : le fichier `InteractiveTVDisplay` et/ou `VHSCaseOverlay` apparaissent-ils dans le chunk **initial** (pas un lazy-chunk) et représentent-ils > 10% de celui-ci ?

**Si NON** : skip cette tâche, marquer comme complétée sans changement.
**Si OUI** : continuer.

- [ ] **Step 2: Pour InteractiveTVDisplay, extraire AdminPanel en fichier séparé**

Créer `src/components/interior/tv/AdminPanel.tsx` avec le code du panel admin (chercher la section `admin` dans InteractiveTVDisplay.tsx).

Remplacer l'inline dans `InteractiveTVDisplay.tsx` par :

```tsx
const AdminPanel = lazy(() => import('./tv/AdminPanel'))
// Dans le JSX :
{showAdmin && (
  <Suspense fallback={null}>
    <AdminPanel />
  </Suspense>
)}
```

- [ ] **Step 3: Répéter pour VHSCaseOverlay si triggered**

- [ ] **Step 4: Build + analyzer vérif**

Run: `ANALYZE=true npm run build`
Confirmer que les chunks initiaux ont diminué de >0.5MB.

- [ ] **Step 5: Test runtime**

Run: `npm run dev`, ouvrir terminal admin + ouvrir K7 : les lazy chunks doivent se télécharger à la demande (Network tab).

- [ ] **Step 6: Commit**

```bash
git add src/
git commit -m "perf(bundle): split monolithe <filename> en composants lazy

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 3.8: Mesure Phase 3 (bundle + LCP + TTI)

**Files:**
- Modify: `docs/perf/phase-results-2026-04-15.md`

- [ ] **Step 1: Ajouter section Phase 3**

```markdown
## Phase 3 — Bundle (2026-04-__)

### Bundle
- Baseline `.next/static/chunks` : 59 MB
- Après : __ MB
- JS transferé initial gzipped : baseline __ KB → après __ KB
- Chunk `three` isolé : baseline __ KB → après __ KB (−__%)

### LCP (Lighthouse mobile simulé Slow 4G, Pixel 9 simulé)
- Baseline : __ ms
- Après : __ ms
- Gain : __ ms (cible ≥ -1000ms)

### TTI Pixel 9 réel (visite à froid, cache vidé)
- Baseline : __ ms
- Après : __ ms
- Gain : __ ms (cible -1000 à -1500ms)

### Non-régression visuelle
- HDR → KTX2 : validé sur screenshots avant/après (pas de banding).
- Build passe sans nouveaux warnings tree-shaking.
```

- [ ] **Step 2: Remplir après mesure**

- [ ] **Step 3: Commit**

```bash
git add docs/perf/phase-results-2026-04-15.md
git commit -m "docs(perf): résultats Phase 3 — bundle, LCP, TTI

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## ✅ CHECKPOINT PHASE 3

**Validation** :
- [ ] Bundle JS initial gzipped ≤ 2.5MB.
- [ ] LCP Lighthouse mobile simulé −1s minimum vs baseline.
- [ ] Pas de régression visuelle.
- [ ] `npm run build` passe.
- [ ] `npm run test:phase` passe.

---

# Acceptance finale

### Task F.1: Validation globale des critères de succès

- [ ] **Step 1: Relire `docs/superpowers/specs/2026-04-15-optimizations-avril-design.md` section 9**

Valider chaque critère :

**Mobile Pixel 9** (priorité absolue) :
- [ ] Rotation caméra 15s : FPS min ≥ 40, median ≥ 50, aucun drop < 30.
- [ ] Premier passage dans une allée non visitée : aucun stutter > 100ms.
- [ ] Transitions waypoint tutorial : aucune frame > 33ms.

**Chargement** :
- [ ] Bundle JS initial gzipped ≤ 2.5MB.
- [ ] LCP Lighthouse mobile simulé : −1s minimum vs baseline.

**Non-régression** :
- [ ] `npm run test:phase` passe.
- [ ] `npm run build` passe.
- [ ] Screenshot-compare desktop : aucun diff significatif.
- [ ] Aucune feature cassée : auth, location, reviews, terminal admin, cast, tutorial complet.

### Task F.2: Smoke test full-user-journey

- [ ] **Step 1: Parcours utilisateur complet sur Pixel 9**

1. Landing externe → click entrée.
2. Tutorial (7 étapes) → fin.
3. Navigation : rotation, déplacement, toutes allées.
4. Ouverture K7 → lecture vidéo → Google Cast (si testable).
5. Terminal → admin (si user admin).
6. Retour scène, fermer terminal, retour idle.

Aucune crash, aucun stutter > 100ms, aucune feature cassée.

### Task F.3: Préparer PR vers main

- [ ] **Step 1: Rebaser sur main si divergence**

Run:
```bash
git fetch origin
git rebase origin/main
```

- [ ] **Step 2: Push branche + ouverture PR**

```bash
git push -u origin optimizations-avril
gh pr create --title "perf: optimizations-avril — sprint mesure-first 4 phases" --body "$(cat <<'EOF'
## Summary
- Phase 0 : baseline mesurée Pixel 9 + overlay perf dev
- Phase 1 : shader warmup étendu (compileAsync) + tutorial lerp raccourci + gel coûts
- Phase 2 : profil rotation Pixel 9 + fixes guidés + MobileQualityTier dynamique 3 niveaux
- Phase 3 : codemod Three tree-shaking (32 fichiers), HDR→KTX2, prefetch avancé

## Résultats mesurés
Voir `docs/perf/phase-results-2026-04-15.md`.
Pixel 9 : rotation fpsMin __ → __, 1er passage stutters __ → __, tutorial janks __ → __.
Bundle JS gzipped initial : __MB → __MB. LCP : __ms → __ms.

## Test plan
- [x] `npm run test:phase` passe
- [x] `npm run build` passe
- [x] Smoke test full user journey Pixel 9
- [x] Non-régression desktop (screenshots avant/après)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Attendre revue utilisateur avant merge**

---

## Self-Review du plan

Checks inline :

1. **Spec coverage** :
   - Section 5 (Phase 0) → Task 0.1-0.5 ✓
   - Section 6 (Phase 1 1A/1B/1C) → Task 1.1-1.9 ✓
   - Section 7 (Phase 2 2A/2B/2C) → Task 2.1-2.11 ✓
   - Section 8 (Phase 3 3A/3B/3C/3D/3E) → Task 3.1-3.8 ✓
   - Section 9 (critères globaux) → Task F.1-F.3 ✓
   - Section 10 (hors scope) → respecté (pas de refonte Zustand, etc.).
   - Section 11 (rollback) → commits atomiques par sous-phase ✓.

2. **Placeholders scannés** :
   - `__` dans docs de mesure : OK, c'est à remplir à l'exécution.
   - Aucun "TBD"/"TODO" dans le code à écrire.
   - Les tâches conditionnelles (2.5, 3.6, 3.7) mentionnent explicitement leur branchement.

3. **Type consistency** :
   - `isTutorialCameraMoving` utilisé Task 1.3 (store) puis 1.5/1.6/1.7/1.8 (consumers) ✓
   - `isCameraRotating` utilisé Task 2.3 (store) puis 2.4 (setter) ✓
   - `QualityTier`/`TierConfig` définis Task 2.6, utilisés Task 2.7/2.8/2.9 ✓
   - `setQualityTier`/`setCameraRotating`/`setTutorialCameraMoving` : signatures cohérentes partout.

4. **Ordre des dépendances** :
   - Phase 0 avant toute modif code perf → OK.
   - Flag `isTutorialCameraMoving` créé (1.3) avant d'être consommé (1.5-1.8) → OK.
   - Tier créé (2.6-2.7) avant d'être consommé (2.8-2.9) → OK.
   - Codemod Three (3.3) avant build de mesure (3.8) → OK.

Plan complet et exécutable.
