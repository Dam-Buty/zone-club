# Video Club WebGPU - Refonte Rendu "Pixar Quality"

## RÈGLES OBLIGATOIRES - PROJET 3D

**AVANT de coder:**
1. Étudier l'image de référence pixel par pixel
2. Rechercher l'état de l'art (pas d'improvisation!)
3. Utiliser les outils existants (NeonTube.ts, TextureLoader, etc.)
4. Vérifier visuellement CHAQUE modification

**INTERDIT:** Boîtes par paresse, suppositions, marquer "complété" sans vérification visuelle.

---

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transformer le rendu simpliste actuel en un pipeline moderne PBR avec ombres, géométrie détaillée et post-processing cinématique, tout en préservant les proportions et éléments existants.

**Architecture:** Deferred rendering avec G-Buffer, shadow mapping, PBR Cook-Torrance, SSAO, et chaîne de post-processing complète (bloom, tone mapping ACES, color grading 80s).

**Tech Stack:** WebGPU, WGSL shaders, TypeScript, géométrie procédurale avancée, GPU instancing

---

## 1. Architecture du Pipeline de Rendu

### Vue d'ensemble

```
┌─────────────────────────────────────────────────────────┐
│                    RENDER PIPELINE                       │
├─────────────────────────────────────────────────────────┤
│  1. SHADOW PASS (Depth-only)                            │
│     └─ Rend la scène depuis chaque lumière             │
│     └─ Génère shadow maps (2048x2048 par défaut)       │
│                                                          │
│  2. G-BUFFER PASS (Deferred Rendering)                  │
│     └─ Albedo + Alpha                                   │
│     └─ Normal (world space)                             │
│     └─ Metallic + Roughness + AO                        │
│     └─ Emissive                                         │
│     └─ Depth                                            │
│                                                          │
│  3. LIGHTING PASS (Screen-space)                        │
│     └─ PBR (Cook-Torrance BRDF)                        │
│     └─ Shadow sampling (PCF soft shadows)              │
│     └─ SSAO (Screen-Space Ambient Occlusion)           │
│                                                          │
│  4. POST-PROCESS PASS                                   │
│     └─ Bloom (threshold + blur + composite)            │
│     └─ Tone mapping (ACES filmic)                      │
│     └─ Color grading (80s synthwave look)              │
│     └─ FXAA anti-aliasing                              │
└─────────────────────────────────────────────────────────┘
```

### Avantage du Deferred Rendering

Au lieu de calculer l'éclairage pour chaque objet (forward), on stocke d'abord les propriétés des surfaces dans des textures (G-Buffer), puis on calcule l'éclairage en une seule passe sur l'écran entier. Cela permet d'avoir beaucoup de lumières sans coût exponentiel.

---

## 2. Système de Géométrie Procédurale Avancée

### Nouvelles primitives

```typescript
// Nouveau fichier: src/webgpu/core/ProceduralGeometry.ts

createRoundedBox(w, h, d, radius, segments)
// Coins arrondis avec rayon configurable
// ~200-500 vertices vs 8 pour un cube

createBeveledBox(w, h, d, bevel)
// Arêtes chanfreinées (moins coûteux qu'arrondi)
// ~48-96 vertices

createCylinder(radius, height, segments)
// Pour tubes néon, poteaux, etc.

createCapsule(radius, height, segments)
// Cylindre avec extrémités sphériques

createDetailedCassette()
// Boîtier VHS avec relief, étiquette en creux
// ~150 vertices avec détails

createHumanoid(config)
// Manager avec proportions anatomiques
// Membres arrondis, vêtements avec plis
```

### GPU Instancing (critique pour performance)

```typescript
// Actuellement: 3000 cassettes = 3000 draw calls ❌
// Nouveau: 3000 cassettes = 1 draw call ✅

cassettes: {
  mesh: DetailedCassetteMesh (partagé),
  instances: [
    { transform: mat4, textureIndex: u32, filmId },
    ... x3000
  ]
}
// → Un seul drawIndexedInstanced(indices, 3000)
```

### Texture Atlas

Au lieu de 20+ textures individuelles, un atlas 4096x4096 contenant tous les posters en grille. Chaque cassette stocke juste ses coordonnées UV dans l'atlas.

---

## 3. Géométrie 3D des Néons

### Tubes avec volume réel

```
Forme: Cylindre avec caps hémisphériques

     ╭──────────────────────────────╮
    (                                )
     ╰──────────────────────────────╯

Paramètres:
- Rayon tube: 2-3 cm
- Segments radiaux: 12-16
- Segments longueur: selon courbe
```

### Structure complète du néon

```
1. TUBE DE VERRE (émissif)
   ├─ Matériau: transparent + émissif
   ├─ Couleur: rose, cyan, violet selon zone
   └─ Intensité émissive: 3.0 - 5.0

2. SUPPORT/FIXATION (métal)
   ├─ Petites pattes métalliques
   ├─ Matériau: chrome ou métal peint noir
   └─ Vissées au mur/plafond

3. CÂBLES (optionnel, détail)
   └─ Fins cylindres noirs vers le mur
```

### Primitives néon

```typescript
createNeonTube(path: vec3[], radius: number, segments: number): Mesh
// path = points de la courbe
// Génère un tube qui suit le chemin
// Caps hémisphériques aux extrémités

createNeonSign(text: string, font: NeonFont, scale: number): Mesh
// Génère les tubes pour former les lettres

createNeonFrame(width: number, height: number, radius: number): Mesh
// Cadre rectangulaire avec coins arrondis
```

---

## 4. Système de Matériaux PBR

### Structure

```typescript
interface PBRMaterial {
  albedo: vec3 | GPUTexture;
  metallic: number | GPUTexture;    // 0 = diélectrique, 1 = métal
  roughness: number | GPUTexture;   // 0 = miroir, 1 = mat
  normalMap?: GPUTexture;
  aoMap?: GPUTexture;
  emissive: vec3;
  emissiveIntensity: number;
}
```

### Matériaux prédéfinis

| Matériau       | Metallic | Roughness | Particularités      |
|----------------|----------|-----------|---------------------|
| Bois verni     | 0.0      | 0.3-0.5   | Normal map grain    |
| Bois brut      | 0.0      | 0.7-0.9   | Normal map fibres   |
| Plastique VHS  | 0.0      | 0.4       | Légèrement brillant |
| Métal brossé   | 0.9      | 0.4       | Normal anisotrope   |
| Chrome         | 1.0      | 0.1       | Très réflectif      |
| Carrelage      | 0.0      | 0.2       | Normal joints       |
| Béton peint    | 0.0      | 0.8       | Normal granuleux    |
| Néon (émissif) | 0.0      | 1.0       | Emissive intense    |
| Peau           | 0.0      | 0.5       | Subsurface hint     |
| Tissu          | 0.0      | 0.9       | Normal tissage      |
| Jean           | 0.0      | 0.85      | Normal denim        |

### BRDF Cook-Torrance

- **D** (Distribution): GGX pour les micro-facettes
- **F** (Fresnel): Schlick approximation
- **G** (Geometry): Smith GGX pour l'auto-ombrage

---

## 5. Système d'Ombres et Éclairage

### Shadow Mapping

```
Lumières principales (avec ombres):
├─ 8 plafonniers      → 1 shadow map partagée
├─ Lumière principale → 2048x2048 shadow map
└─ 2 spots d'accent   → 1024x1024 chacun

Lumières secondaires (sans ombres):
├─ Néons roses/cyans  → Point lights simples
└─ Ambiance           → Hemisphere light

Technique: PCF (Percentage Closer Filtering)
└─ 16 samples pour ombres douces
└─ Biais adaptatif pour éviter l'acné
```

### SSAO

```
Input:  G-Buffer depth + normals
Output: Texture AO (demi-résolution pour perf)

Algorithme: HBAO+ simplifié
└─ 16 samples par pixel en hémisphère
└─ Rayon d'occlusion: 0.5m
└─ Blur bilatéral pour lisser
```

### Configuration lumières

```typescript
interface Light {
  type: 'directional' | 'point' | 'spot';
  position: vec3;
  direction?: vec3;
  color: vec3;
  intensity: number;
  range?: number;
  innerConeAngle?: number;
  outerConeAngle?: number;
  castShadows: boolean;
  shadowMapSize?: number;
}
```

---

## 6. Post-Processing

### Chaîne complète

```
1. BLOOM
   ├─ Threshold: extraire pixels > 1.0 luminance
   ├─ Downsample: 5 niveaux
   ├─ Blur gaussien: horizontal + vertical
   └─ Upsample + blend

2. TONE MAPPING (ACES Filmic)

3. COLOR GRADING
   ├─ Ombres bleutées, hautes lumières roses
   ├─ Saturation boost sur néons
   └─ Contraste augmenté

4. VIGNETTE

5. CHROMATIC ABERRATION (subtile)

6. FILM GRAIN (optionnel)

7. FXAA
```

### Color Grading 80s

```typescript
const colorGrade = {
  shadowTint: [0.1, 0.05, 0.2],      // Bleu/violet
  midtoneTint: [1.0, 0.98, 0.95],    // Neutre chaud
  highlightTint: [1.0, 0.9, 0.95],   // Rose/magenta
  saturation: 1.15,
  contrast: 1.1,
  gamma: 0.95,
};
```

---

## 7. Organisation des Fichiers

```
src/webgpu/
├── core/
│   ├── Geometry.ts              # Existant
│   ├── ProceduralGeometry.ts    # NOUVEAU
│   ├── Camera.ts                # Existant
│   ├── TextureLoader.ts         # Existant (étendre)
│   ├── TextureAtlas.ts          # NOUVEAU
│   ├── Material.ts              # NOUVEAU
│   ├── Light.ts                 # NOUVEAU
│   └── GPUResourcePool.ts       # NOUVEAU
│
├── rendering/
│   ├── GBuffer.ts               # NOUVEAU
│   ├── ShadowPass.ts            # NOUVEAU
│   ├── LightingPass.ts          # NOUVEAU
│   ├── SSAOPass.ts              # NOUVEAU
│   ├── PostProcessing.ts        # NOUVEAU
│   └── RenderPipeline.ts        # NOUVEAU
│
├── shaders/
│   ├── gbuffer.wgsl             # NOUVEAU
│   ├── shadow.wgsl              # NOUVEAU
│   ├── pbr-lighting.wgsl        # NOUVEAU
│   ├── ssao.wgsl                # NOUVEAU
│   ├── bloom.wgsl               # NOUVEAU
│   ├── tonemap.wgsl             # NOUVEAU
│   ├── fxaa.wgsl                # NOUVEAU
│   └── common.wgsl              # NOUVEAU
│
├── objects/
│   ├── NeonTube.ts              # NOUVEAU
│   ├── Cassette.ts              # NOUVEAU
│   ├── Shelf.ts                 # NOUVEAU
│   ├── Manager.ts               # NOUVEAU
│   └── InstancedMeshGroup.ts    # NOUVEAU
│
├── scenes/
│   ├── AisleScene.ts            # REFACTOR
│   └── SceneGraph.ts            # NOUVEAU
│
└── VideoClubScene.tsx           # Existant
```

---

## 8. Phases d'Implémentation

### Phase 1: Infrastructure
- Créer les nouveaux fichiers dans rendering/
- Implémenter G-Buffer, passes vides
- Flag pour switcher ancien/nouveau pipeline

### Phase 2: Géométrie procédurale
- ProceduralGeometry.ts avec nouvelles primitives
- NeonTube.ts avec vrais cylindres 3D
- Cassette.ts détaillée
- Tester en isolation

### Phase 3: Pipeline PBR
- Shaders WGSL pour G-Buffer et lighting
- Système de matériaux
- Shadow mapping basique

### Phase 4: Optimisation et instancing
- InstancedMeshGroup pour cassettes
- Texture atlas pour posters
- GPU resource pooling

### Phase 5: Post-processing et polish
- Bloom, SSAO, tone mapping
- Color grading 80s
- FXAA
- Ajustements finaux

---

## Contraintes

- **Préserver** toutes les dimensions et proportions actuelles
- **Préserver** la disposition: étagères, comptoir, manager, mur du fond
- **Préserver** les positions des cassettes
- **Améliorer** uniquement le rendu visuel et la performance
