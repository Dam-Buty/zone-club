# Skill: Three.js / React Three Fiber Performance Optimization

## Summary

Techniques d'optimisation pour scènes 3D React Three Fiber avec de nombreux objets (100+ meshes). Applicable aux vidéoclubs, galeries, inventaires 3D.

---

## Principe Fondamental

**ERREUR COURANTE :** Créer des centaines de composants avec leurs propres géométries, matériaux, et useFrame à 60fps.

**APPROCHE CORRECTE :** Partager les ressources, throttler les callbacks, et skip les calculs inutiles.

---

## 1. Géométrie Partagée

### Problème

Chaque composant crée sa propre géométrie = mémoire gaspillée.

```typescript
// MAUVAIS: 500 BoxGeometry créées
function Cassette() {
  return (
    <mesh>
      <boxGeometry args={[0.168, 0.228, 0.03]} />
    </mesh>
  )
}
```

### Solution

Créer une géométrie unique partagée par tous les meshes.

```typescript
// BON: 1 seule BoxGeometry pour tous
const SHARED_GEOMETRY = new THREE.BoxGeometry(0.168, 0.228, 0.03)

function Cassette() {
  return (
    <mesh geometry={SHARED_GEOMETRY}>
      <meshStandardMaterial ... />
    </mesh>
  )
}
```

**Gain :** -99% mémoire géométrie

---

## 2. Animation Throttling

### Problème

useFrame exécuté 60 fois/sec pour chaque mesh = CPU saturé.

```typescript
// MAUVAIS: 500 * 60 = 30000 callbacks/sec
useFrame((_, delta) => {
  meshRef.current.position.z = THREE.MathUtils.lerp(...)
})
```

### Solution

Throttler les animations avec un compteur global.

```typescript
// BON: Compteur global hors composant
let globalFrameCount = 0
const ANIMATION_THROTTLE = 2 // Toutes les 2 frames

function Cassette() {
  useFrame((_, delta) => {
    const currentFrame = Math.floor(performance.now() / 16.67)
    if (currentFrame !== globalFrameCount) globalFrameCount = currentFrame

    if (globalFrameCount % ANIMATION_THROTTLE !== 0) return

    // Animation ici (30fps au lieu de 60)
    meshRef.current.position.z = THREE.MathUtils.lerp(...)
  })
}
```

**Gain :** -50% CPU animations

---

## 3. Frustum Culling pour Animations

### Problème

Animations exécutées même pour objets hors champ.

### Solution

Skip useFrame si l'objet n'est pas visible par la caméra.

```typescript
// Variables réutilisables (HORS du composant)
const frustum = new THREE.Frustum()
const projScreenMatrix = new THREE.Matrix4()
const tempWorldPos = new THREE.Vector3()
let lastFrustumFrame = -1

function Cassette() {
  const meshRef = useRef<THREE.Mesh>(null)

  useFrame(({ camera }) => {
    if (!meshRef.current) return

    // Mettre à jour le frustum une seule fois par frame
    if (lastFrustumFrame !== globalFrameCount) {
      projScreenMatrix.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse
      )
      frustum.setFromProjectionMatrix(projScreenMatrix)
      lastFrustumFrame = globalFrameCount
    }

    // Skip si hors champ
    meshRef.current.getWorldPosition(tempWorldPos)
    if (!frustum.containsPoint(tempWorldPos)) return

    // Animation ici
  })
}
```

**Gain :** -80% animations (seuls objets visibles animent)

**IMPORTANT :** Les variables `frustum`, `projScreenMatrix`, `tempWorldPos` DOIVENT être hors du composant pour éviter des allocations à chaque frame.

---

## 4. React.memo avec Comparaison Custom

### Problème

Re-renders inutiles quand les props ne changent pas vraiment.

### Solution

```typescript
export const Cassette = memo(function Cassette({ position, film, hoverOffsetZ }: Props) {
  // ...
}, (prevProps, nextProps) => {
  // Retourner TRUE si les props sont égales (pas de re-render)
  return (
    prevProps.film.id === nextProps.film.id &&
    prevProps.film.poster_path === nextProps.film.poster_path &&
    prevProps.position[0] === nextProps.position[0] &&
    prevProps.position[1] === nextProps.position[1] &&
    prevProps.position[2] === nextProps.position[2] &&
    prevProps.hoverOffsetZ === nextProps.hoverOffsetZ
  )
})
```

**Note :** Comparer les éléments de tableaux individuellement, pas les tableaux eux-mêmes.

---

## 5. Disposal des Ressources

### Problème

Textures et matériaux non libérés = memory leaks.

### Solution

```typescript
function Cassette({ posterUrl }) {
  const texture = useMemo(() => {
    if (!posterUrl) return null
    return new THREE.TextureLoader().load(posterUrl)
  }, [posterUrl])

  const materialRef = useRef<THREE.MeshStandardMaterial>(null)

  useEffect(() => {
    return () => {
      if (texture) texture.dispose()
      if (materialRef.current) materialRef.current.dispose()
    }
  }, [texture])

  return (
    <mesh>
      <meshStandardMaterial ref={materialRef} map={texture} />
    </mesh>
  )
}
```

---

## 6. Réduction des Lumières

### Problème

Chaque lumière = calculs supplémentaires par pixel.

| Type | Coût | Notes |
|------|------|-------|
| AmbientLight | Très faible | |
| HemisphereLight | Faible | |
| DirectionalLight | Moyen | |
| PointLight | Élevé (avec decay) | |
| RectAreaLight (grande, ceiling) | Élevé | Couvre toute la scène |
| RectAreaLight (petite, neon sign) | **Très faible** | Analytique, rayon limité |
| SpotLight | Très élevé | |

### Solution

Mode optimisé avec lumières combinées.

```typescript
function OptimizedLighting() {
  return (
    <>
      <ambientLight intensity={0.25} />
      <hemisphereLight intensity={0.2} />
      {/* UNE grande RectAreaLight au lieu de plusieurs petites */}
      <rectAreaLight width={10} height={8} intensity={1.2} position={[0, 2.65, 0]} />
      {/* 2-3 PointLights pour accents */}
    </>
  )
}
```

**Note :** Les petites RectAreaLights (neon signs, ~1.5m × 0.1m) sont quasi gratuites car elles n'éclairent qu'une petite zone. 6 panneaux néon = coût négligeable. Voir PHOTOREALISM_PIPELINE.md § Neon Sign Lighting.

**Gain :** -50% à -70% calculs éclairage

---

## 7. Shadows Désactivés

### Problème

`castShadow={true}` sur des centaines d'objets = shadow map saturée.

### Solution

Désactiver shadows sur les petits objets.

```typescript
<mesh castShadow={false} receiveShadow={false}>
```

**Note :** Garder shadows uniquement sur les gros éléments (sol, murs, personnages).

---

## 8. Raycast Throttling

### Problème

Raycast à chaque frame pour interaction = CPU gaspillé.

### Solution

```typescript
const frameCountRef = useRef(0)
const RAYCAST_INTERVAL = 2 // Toutes les 2 frames

useFrame(() => {
  frameCountRef.current++
  if (frameCountRef.current % RAYCAST_INTERVAL !== 0) return

  // Raycast ici (30 fois/sec au lieu de 60)
  raycaster.setFromCamera({ x: 0, y: 0 }, camera)
  const hits = raycaster.intersectObjects(scene.children, true)
})
```

**Gain :** -50% CPU raycast

### DANGER: Raycast Target Caching + userData JSX Prop

**Anti-pattern** (causes broken selection):
```typescript
// Controls.tsx — cache built from scene.traverse() checking userData flags
const refreshRaycastTargets = () => {
  scene.traverse((obj) => {
    if (obj.userData?.isCassetteInstances) targets.push(obj)
  })
}
// Uses cached list (non-recursive):
raycaster.intersectObjects(raycastTargetsRef.current, false)
```

If the InstancedMesh has `userData` set via JSX prop (`<instancedMesh userData={{ ... }} />`),
R3F reconciler **replaces entire userData** on every re-render → `isCassetteInstances` is wiped
→ cache refresh finds nothing → no cassette selection.

**Safe approach**: Use `scene.children` with recursive traversal. Layers already filter targets efficiently:
```typescript
raycaster.layers.set(RAYCAST_LAYER_CASSETTE)
raycaster.layers.enable(RAYCAST_LAYER_INTERACTIVE)
const hits = raycaster.intersectObjects(scene.children, true)
```

---

## Quand utiliser / ne PAS utiliser l'Instancing

**InstancedMesh** est puissant mais a des limitations :

| Cas d'usage | Instancing ? | Technique |
|-------------|--------------|-----------|
| Mêmes objets, couleurs différentes | Oui | `instanceColor` attribute |
| Mêmes objets, transformations différentes | Oui | `setMatrixAt()` |
| Objets avec textures uniques par instance | **Oui** | **DataArrayTexture + layer index** |
| Objets nécessitant matériaux différents | Non | Groupes séparés |

**Exemple :** 520 cassettes VHS avec posters TMDB uniques → 1 InstancedMesh + DataArrayTexture (1 draw call). Voir `PERFORMANCE_STRATEGY.md` § InstancedMesh + DataArrayTexture.

---

## Checklist d'Optimisation

- [ ] Géométrie partagée pour objets similaires
- [ ] Animation throttling (toutes les 2-3 frames)
- [ ] Frustum culling pour animations
- [ ] Variables réutilisables HORS des composants (Vector3, Matrix4...)
- [ ] React.memo avec comparaison custom
- [ ] Disposal textures/matériaux au unmount
- [ ] Mode éclairage optimisé
- [ ] Shadows désactivés sur petits objets
- [ ] Raycast throttling

---

## Métriques de Référence

Pour une scène avec ~500 objets animés :

| Sans optimisation | Avec optimisation | Gain |
|-------------------|-------------------|------|
| 500 géométries | 1 géométrie | -99% mémoire |
| 30000 callbacks/sec | 7500 callbacks/sec | -75% |
| 500 animations | ~100 (visibles) | -80% |
| 20+ lumières | 8 lumières | -60% |
| 500 shadow renders | 0 | -100% |

---

## 9. meshPhysicalMaterial vs meshStandardMaterial

### Problème

`meshPhysicalMaterial` calcule clearcoat, IOR, reflectivity, sheen, etc. même quand ces propriétés ne sont pas utilisées. Coût GPU ~2x supérieur à `meshStandardMaterial`.

### Règle

| Objet | Material |
|-------|----------|
| Surface vitrée principale, eau, bijoux | Physical |
| Tout le reste (plastique, bois, métal, néon, tissu) | **Standard** |

```typescript
// MAUVAIS: Physical sur un bouton en plastique
<meshPhysicalMaterial color="#444" roughness={0.3} />

// BON: Standard suffit largement
<meshStandardMaterial color="#444" roughness={0.3} />
```

---

## 10. Compression des Assets

### Images

```bash
# Resize + compression JPEG (macOS)
sips -Z 2048 image.jpeg && sips -s formatOptions 70 image.jpeg

# Normal maps (quality 75 suffit, pas de perte visible)
sips -s formatOptions 75 normal.jpg
```

### GLB (Draco)

```bash
# Installation
npm install -g @gltf-transform/cli

# Compression Draco (gains typiques: 80-97%)
gltf-transform optimize input.glb output.glb --compress draco
```

**IMPORTANT** dans le code R3F :
```typescript
// Le 2e paramètre `true` active le décodeur Draco via CDN drei
const { scene } = useGLTF('/models/model.glb', true)
useGLTF.preload('/models/model.glb', true)
```

### Fonts (typeface.json)

Stripper aux seuls caractères nécessaires. Script pattern :

```javascript
const font = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
const neededChars = new Set('ABCDEFG'.split(''))
const stripped = { ...font, glyphs: {} }
for (const [char, glyph] of Object.entries(font.glyphs)) {
  if (neededChars.has(char)) stripped.glyphs[char] = glyph
}
// 753 glyphs → 17 = 1367KB → 29KB (-97.9%)
```

### Textures TMDB (ou CDN distant)

| Taille objet 3D | Résolution suffisante | Anisotropy |
|-----------------|----------------------|------------|
| > 1m (affiche plein écran) | w500 | 8-16 |
| 10-50cm (cassette, livre) | **w200** | 4 |
| < 10cm (miniature) | w92 | 2 |

---

## 11. Bloom et Luminance Perceptuelle

### Problème

Le bloom post-processing utilise un seuil de **luminance perceptuelle** pour décider quels pixels glowent :

```
L = 0.2126 × R + 0.7152 × G + 0.0722 × B
```

Les couleurs à basse luminance (violet, rouge, magenta) ne déclenchent jamais le bloom même avec `emissiveIntensity` élevé, tandis que le jaune/vert bloome fortement.

### Solution : Compensation d'intensité par luminance inverse

```typescript
const neonIntensity = useMemo(() => {
  const c = new THREE.Color(color)
  const luminance = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
  // Target: luminance × intensity ≈ 1.3 (au-dessus du threshold 0.9)
  return THREE.MathUtils.clamp(1.3 / luminance, 1.3, 4.5)
}, [color])
```

| Couleur | Luminance | Intensity compensée | L × I |
|---------|-----------|-------------------|-------|
| Jaune `#ffff00` | 0.93 | 1.40 | 1.30 |
| Vert `#00ff00` | 0.72 | 1.81 | 1.30 |
| Orange `#ff6600` | 0.50 | 2.60 | 1.30 |
| Rouge `#ff4444` | 0.42 | 3.07 | 1.30 |
| Violet `#8844ff` | 0.38 | 3.45 | 1.30 |
| Magenta `#ff00ff` | 0.28 | 4.50 | 1.28 |

### Bloom Strength (WebGPU TSL)

Le bloom TSL de Three.js WebGPU est plus agressif que le UnrealBloomPass classique. Valeurs recommandées :

| Effet | Strength | Radius | Threshold |
|-------|----------|--------|-----------|
| Très subtil | 0.10-0.15 | 0.3 | 0.9 |
| **Néon réaliste** | **0.15-0.25** | **0.4** | **0.9** |
| Stylisé (cyberpunk) | 0.3-0.5 | 0.5 | 0.7 |
| Exagéré | > 0.5 | > 0.6 | < 0.7 |

---

## 12. Text3D et Polices Complexes

### Problème

Les polices manuscrites (Caveat, Dancing Script, etc.) ont des chemins de glyphes très complexes avec de nombreuses courbes. Le bevel de Three.js Text3D tesselle ces courbes et crée des triangles dégénérés → trous et artefacts visuels.

### Règle

| Type de police | Bevel | Effet néon |
|---------------|-------|------------|
| Géométrique (Helvetiker, Roboto) | OK (`bevelEnabled={true}`) | Bevel arrondi |
| **Manuscrite (Caveat, etc.)** | **INTERDIT** (`bevelEnabled={false}`) | **Emissive + bloom** |

```typescript
// Police manuscrite — JAMAIS de bevel
<Text3D font={CAVEAT_URL} height={0.025} bevelEnabled={false} curveSegments={10}>
  {text}
  <meshStandardMaterial emissive={color} emissiveIntensity={3} toneMapped={false} />
</Text3D>
```

### Segments recommandés

| Type de police | curveSegments | bevelSegments |
|---------------|---------------|---------------|
| Géométrique | 6-8 | 3-5 |
| Manuscrite | 8-12 | N/A (bevel off) |

---

## 13. Réduction de Segments par Type d'Objet

### Règle : adapter les segments à la taille visible

| Taille objet | cylinderGeometry | circleGeometry | sphereGeometry |
|-------------|-----------------|----------------|----------------|
| > 50cm | 12-16 | 16-24 | 16-32 |
| 10-50cm | 6-8 | 8-12 | 8-16 |
| < 10cm (boutons, yeux, tubes) | **4-6** | **6-8** | **6-8** |

**Exemple concret :** Les yeux du manager (1cm de diamètre) n'ont pas besoin de 32 segments — 8 suffit, invisible à l'œil nu.

---

## 14. Raycast et Meshes Overlay (Bug Pattern)

### Problème

En mode FPS avec raycast depuis le centre écran, les meshes plats (texte, UI) placés DEVANT une surface interactive bloquent le raycast. Le hit retourne le mesh overlay, pas la surface derrière.

### Solution

Tous les meshes devant une surface interactive doivent porter le même `userData` flag :

```typescript
// Surface interactive
<mesh userData={{ isTVScreen: true }}>
  <sphereGeometry ... />
</mesh>

// TOUS les overlays devant DOIVENT aussi avoir le flag
<mesh position={[0, 0, 0.06]} userData={{ isTVScreen: true }}>
  <planeGeometry ... />
  <meshBasicMaterial map={textTexture} transparent />
</mesh>
```

### Règle

Le raycast touche le mesh le **plus proche** de la caméra. Si un overlay sans `userData` est devant, la surface interactive n'est jamais détectée. Vérifier TOUTE la stack Z de meshes devant chaque surface interactive.

---

## Checklist d'Optimisation (mise à jour)

- [ ] Géométrie partagée pour objets similaires
- [ ] Animation throttling (toutes les 2-3 frames)
- [ ] Frustum culling pour animations
- [ ] Variables réutilisables HORS des composants (Vector3, Matrix4...)
- [ ] React.memo avec comparaison custom
- [ ] Disposal textures/matériaux au unmount
- [ ] Mode éclairage optimisé
- [ ] Shadows désactivés sur petits objets et GLB haute-poly
- [ ] Raycast throttling
- [ ] **meshStandardMaterial partout sauf surfaces vitrées**
- [ ] **Segments adaptés à la taille visible de l'objet**
- [ ] **Assets compressés (Draco GLB, images 2048px, fonts strippées)**
- [ ] **Textures CDN à résolution adaptée (w200 pour petits objets)**
- [ ] **Bloom : compensation luminance pour couleurs variées**
- [ ] **Pas de bevel sur polices manuscrites**

---

## Métriques de Référence

Pour une scène avec ~500 objets animés + 10 lumières :

| Sans optimisation | Avec optimisation | Gain |
|-------------------|-------------------|------|
| 500 géométries | 1 géométrie | -99% mémoire |
| 30000 callbacks/sec | 7500 callbacks/sec | -75% |
| 500 animations | ~100 (visibles) | -80% |
| 20+ lumières | 8 lumières | -60% |
| 500 shadow renders | 0 | -100% |
| meshPhysicalMaterial | meshStandardMaterial | -50% GPU shader |
| Assets 85MB | Assets 5MB | -94% disque |
| 350MB VRAM textures | 150MB VRAM | -57% GPU mém |
| Bloom strength 0.4 | 0.19 | netteté +++ |

---

## Références

- [React Three Fiber Performance Tips](https://docs.pmnd.rs/react-three-fiber/advanced/scaling-performance)
- [Three.js Optimization Guide](https://threejs.org/manual/#en/optimize-lots-of-objects)
- Three.js Frustum class documentation
- [gltf-transform CLI](https://gltf-transform.dev/cli) (Draco, quantization)
- Three.js TSL BloomNode (WebGPU post-processing)
