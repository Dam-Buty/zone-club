# Migration Intérieur VideoClub vers React Three Fiber + WebGPU

**Date**: 2026-02-02
**Status**: En attente d'approbation

---

## Contexte

Le code WebGPU natif actuel (`AisleScenePBR`) plante le GPU à cause de shaders WGSL complexes avec des erreurs de "uniform control flow". La solution est de migrer vers React Three Fiber v9 avec le WebGPU renderer, qui gère les shaders automatiquement.

**L'extérieur (`src/components/exterior/`) reste INTACT.**

---

## Architecture

### Nouveaux fichiers

```
src/components/interior/
├── InteriorScene.tsx      # Canvas R3F + WebGPU renderer
├── Aisle.tsx              # Allée avec sol, plafond, étagères
├── Shelf.tsx              # Étagère individuelle avec rangées
├── Cassette.tsx           # Cassette VHS 3D cliquable
├── Lighting.tsx           # Configuration des lumières
├── Controls.tsx           # Navigation caméra
└── index.ts               # Exports
```

### Fichiers à supprimer (après migration)

```
src/webgpu/scenes/AisleScene.ts
src/webgpu/scenes/AisleScenePBR.ts
src/webgpu/scenes/AisleScenePBRLite.ts
src/webgpu/rendering/*
src/webgpu/shaders/*
src/webgpu/VideoClubScene.tsx
```

### Fichiers à GARDER

```
src/webgpu/ExteriorScene.ts          # Utilisé par l'extérieur !
src/webgpu/core/*                     # Évaluer si réutilisable
src/webgpu/objects/*                  # Évaluer si réutilisable
```

---

## Dépendances

```bash
npm install @react-three/fiber@9 @react-three/drei @react-three/postprocessing three
```

---

## Configuration

### vite.config.ts

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    esbuildOptions: { target: 'esnext' }
  },
  build: {
    target: 'esnext'
  }
})
```

---

## Spécifications techniques

### InteriorScene.tsx

```tsx
import * as THREE from 'three/webgpu'
import { Canvas, extend, type ThreeToJSXElements } from '@react-three/fiber'
import { useStore } from '../../store'
import { Aisle } from './Aisle'
import { Lighting } from './Lighting'
import { Controls } from './Controls'

declare module '@react-three/fiber' {
  interface ThreeElements extends ThreeToJSXElements<typeof THREE> {}
}

extend(THREE as any)

interface InteriorSceneProps {
  onCassetteClick?: (filmId: number) => void
}

export function InteriorScene({ onCassetteClick }: InteriorSceneProps) {
  const { currentAisle, films } = useStore()
  const currentFilms = films[currentAisle]

  return (
    <Canvas
      style={{ position: 'fixed', inset: 0 }}
      gl={async (props) => {
        const renderer = new THREE.WebGPURenderer(props as any)
        await renderer.init()
        return renderer
      }}
    >
      <Lighting />
      <Aisle films={currentFilms} onCassetteClick={onCassetteClick} />
      <Controls />
    </Canvas>
  )
}
```

### Lighting.tsx

```tsx
import { RectAreaLight } from '@react-three/drei'

export function Lighting() {
  return (
    <>
      {/* Lumière ambiante */}
      <ambientLight intensity={0.3} color="#f0f0ff" />

      {/* Plafonniers fluorescents (6-8 panneaux) */}
      {[-4, -2, 0, 2, 4].map((z, i) => (
        <rectAreaLight
          key={i}
          width={1.5}
          height={0.3}
          intensity={3}
          color="#fff5e6"
          position={[0, 2.8, z]}
          rotation={[-Math.PI / 2, 0, 0]}
        />
      ))}
    </>
  )
}
```

### Aisle.tsx

```tsx
import { Shelf } from './Shelf'
import type { Film } from '../../types'

interface AisleProps {
  films: Film[]
  onCassetteClick?: (filmId: number) => void
}

export function Aisle({ films, onCassetteClick }: AisleProps) {
  // Diviser les films entre étagère gauche et droite
  const leftFilms = films.slice(0, Math.ceil(films.length / 2))
  const rightFilms = films.slice(Math.ceil(films.length / 2))

  return (
    <group>
      {/* Sol réflectif */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[10, 20]} />
        <meshStandardNodeMaterial color="#2a2a2a" roughness={0.2} metalness={0.1} />
      </mesh>

      {/* Plafond */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 3, 0]}>
        <planeGeometry args={[10, 20]} />
        <meshStandardNodeMaterial color="#1a1a1a" roughness={0.9} />
      </mesh>

      {/* Étagère gauche */}
      <Shelf
        position={[-2, 0, 0]}
        films={leftFilms}
        onCassetteClick={onCassetteClick}
      />

      {/* Étagère droite */}
      <Shelf
        position={[2, 0, 0]}
        rotation={[0, Math.PI, 0]}
        films={rightFilms}
        onCassetteClick={onCassetteClick}
      />
    </group>
  )
}
```

### Shelf.tsx

```tsx
import { Cassette } from './Cassette'
import type { Film } from '../../types'

interface ShelfProps {
  position: [number, number, number]
  rotation?: [number, number, number]
  films: Film[]
  onCassetteClick?: (filmId: number) => void
}

const ROWS = 5
const CASSETTES_PER_ROW = 20
const CASSETTE_WIDTH = 0.14
const CASSETTE_HEIGHT = 0.025
const CASSETTE_DEPTH = 0.10
const ROW_HEIGHT = 0.35
const SHELF_WIDTH = 3

export function Shelf({ position, rotation = [0, 0, 0], films, onCassetteClick }: ShelfProps) {
  return (
    <group position={position} rotation={rotation}>
      {/* Structure de l'étagère (bois) */}
      <mesh position={[0, 1, 0]}>
        <boxGeometry args={[SHELF_WIDTH, 2, 0.4]} />
        <meshStandardNodeMaterial color="#4a3728" roughness={0.7} />
      </mesh>

      {/* Cassettes */}
      {films.map((film, index) => {
        const row = Math.floor(index / CASSETTES_PER_ROW)
        const col = index % CASSETTES_PER_ROW

        if (row >= ROWS) return null

        const x = (col - CASSETTES_PER_ROW / 2) * CASSETTE_WIDTH + CASSETTE_WIDTH / 2
        const y = 0.3 + row * ROW_HEIGHT
        const z = 0.15

        return (
          <Cassette
            key={film.id}
            position={[x, y, z]}
            film={film}
            onClick={() => onCassetteClick?.(film.id)}
          />
        )
      })}
    </group>
  )
}
```

### Cassette.tsx

```tsx
import { useState, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import * as THREE from 'three/webgpu'
import type { Film } from '../../types'

interface CassetteProps {
  position: [number, number, number]
  film: Film
  onClick?: () => void
}

const CASSETTE_SIZE: [number, number, number] = [0.14, 0.19, 0.025]

export function Cassette({ position, film, onClick }: CassetteProps) {
  const [hovered, setHovered] = useState(false)
  const meshRef = useRef<THREE.Mesh>(null)

  // Charger la texture du poster TMDB
  const posterUrl = film.poster_path
    ? `https://image.tmdb.org/t/p/w200${film.poster_path}`
    : '/placeholder-vhs.png'

  const texture = useTexture(posterUrl)

  // Animation hover
  useFrame((_, delta) => {
    if (!meshRef.current) return
    const targetZ = hovered ? 0.05 : 0
    meshRef.current.position.z = THREE.MathUtils.lerp(
      meshRef.current.position.z,
      position[2] + targetZ,
      delta * 10
    )
  })

  return (
    <mesh
      ref={meshRef}
      position={position}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
      onClick={onClick}
    >
      <boxGeometry args={CASSETTE_SIZE} />
      <meshStandardNodeMaterial
        map={texture}
        roughness={0.4}
        emissive={hovered ? '#ff2d95' : '#000000'}
        emissiveIntensity={hovered ? 0.3 : 0}
      />
    </mesh>
  )
}
```

### Controls.tsx

```tsx
import { PerspectiveCamera } from '@react-three/drei'

export function Controls() {
  return (
    <>
      <PerspectiveCamera
        makeDefault
        position={[0, 1.6, 4]}
        fov={60}
        near={0.1}
        far={100}
      />
      {/* Navigation basique - à étendre selon besoins */}
    </>
  )
}
```

---

## Intégration App.tsx

```tsx
// Remplacer l'import
// AVANT:
import { VideoClubScene } from './webgpu/VideoClubScene';

// APRÈS:
import { InteriorScene } from './components/interior';

// Le reste du code reste identique
<InteriorScene onCassetteClick={handleFilmClick} />
```

---

## Plan d'implémentation

### Phase 1 : Setup (fondations)
- [ ] 1.1 Installer dépendances R3F
- [ ] 1.2 Configurer Vite pour esnext
- [ ] 1.3 Créer InteriorScene.tsx avec Canvas WebGPU
- [ ] 1.4 Tester avec un cube basique

### Phase 2 : Structure de base
- [ ] 2.1 Créer Lighting.tsx avec RectAreaLights
- [ ] 2.2 Créer Aisle.tsx avec sol et plafond
- [ ] 2.3 Créer Controls.tsx avec caméra
- [ ] 2.4 Tester : pièce vide éclairée visible

### Phase 3 : Étagères et cassettes
- [ ] 3.1 Créer Shelf.tsx (structure étagère)
- [ ] 3.2 Créer Cassette.tsx (boîtier VHS)
- [ ] 3.3 Charger textures TMDB
- [ ] 3.4 Tester : étagères avec cassettes visibles

### Phase 4 : Interactions
- [ ] 4.1 Implémenter hover effect (glow + pull-out)
- [ ] 4.2 Connecter onClick → onCassetteClick
- [ ] 4.3 Connecter au Store Zustand
- [ ] 4.4 Tester : clic cassette → modal s'ouvre

### Phase 5 : Polish et nettoyage
- [ ] 5.1 Ajouter post-processing (bloom léger)
- [ ] 5.2 Ajuster éclairage selon référence
- [ ] 5.3 Implémenter navigation entre rayons
- [ ] 5.4 Supprimer anciens fichiers WebGPU natif
- [ ] 5.5 Test final complet

---

## Contraintes

- **NE PAS TOUCHER** à `src/components/exterior/`
- **NE PAS TOUCHER** à `src/webgpu/ExteriorScene.ts`
- Vérifier visuellement après chaque étape
- Garder la même interface (`onCassetteClick`) pour compatibilité

---

## Critères de succès

1. L'application démarre sans planter le GPU
2. L'extérieur fonctionne toujours
3. L'intérieur affiche des étagères avec cassettes
4. Clic sur cassette ouvre le modal avec les bonnes infos
5. Performance 60fps sur GPU intégré

---

## Sources

- [R3F v9 Migration Guide](https://r3f.docs.pmnd.rs/tutorials/v9-migration-guide)
- [What's New in Three.js 2026](https://www.utsubo.com/blog/threejs-2026-what-changed)
- [100 Three.js Best Practices 2026](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
