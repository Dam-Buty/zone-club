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

| Type | Coût |
|------|------|
| AmbientLight | Très faible |
| HemisphereLight | Faible |
| DirectionalLight | Moyen |
| PointLight | Élevé (avec decay) |
| RectAreaLight | Très élevé |
| SpotLight | Très élevé |

### Solution

Mode optimisé avec lumières combinées.

```typescript
const LIGHTING_MODE: 'full' | 'optimized' = 'optimized'

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

---

## Quand NE PAS utiliser l'Instancing

**InstancedMesh** est puissant mais a des limitations :

| Cas d'usage | Instancing ? |
|-------------|--------------|
| Mêmes objets, couleurs différentes | Oui |
| Mêmes objets, transformations différentes | Oui |
| Objets avec textures uniques par instance | Non |
| Objets nécessitant matériaux différents | Non |

**Exemple :** Des cassettes VHS avec chacune leur propre poster TMDB ne peuvent PAS être instancées car chaque instance a besoin de sa propre texture.

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

## Références

- [React Three Fiber Performance Tips](https://docs.pmnd.rs/react-three-fiber/advanced/scaling-performance)
- [Three.js Optimization Guide](https://threejs.org/manual/#en/optimize-lots-of-objects)
- Three.js Frustum class documentation
