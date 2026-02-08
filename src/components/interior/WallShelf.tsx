import { useMemo, useEffect } from 'react'
import * as THREE from 'three'
import { useTexture } from '@react-three/drei'
import { Cassette, CASSETTE_DIMENSIONS } from './Cassette'
import type { Film } from '../../types'

interface WallShelfProps {
  position: [number, number, number]
  rotation?: [number, number, number]
  length: number  // Longueur de l'étagère
  films: Film[]
}

const ROWS = 5
const CASSETTE_SPACING = CASSETTE_DIMENSIONS.width + 0.02  // Espacement entre cassettes
const ROW_HEIGHT = CASSETTE_DIMENSIONS.height + 0.12  // Hauteur entre rangées
const SHELF_HEIGHT = 2.4
const SHELF_DEPTH = 0.38

// OPTIMISATION: Géométrie partagée pour les séparateurs (identiques dans toutes les étagères)
const SHARED_DIVIDER_GEOM = new THREE.BoxGeometry(0.02, SHELF_HEIGHT - 0.1, 0.02)

export function WallShelf({
  position,
  rotation = [0, 0, 0],
  length,
  films,
}: WallShelfProps) {
  const cassettesPerRow = Math.floor((length - 0.1) / CASSETTE_SPACING)
  const totalCapacity = cassettesPerRow * ROWS

  // Textures bois PBR
  const woodTextures = useTexture({
    map: '/textures/wood/color.jpg',
    normalMap: '/textures/wood/normal.jpg',
    roughnessMap: '/textures/wood/roughness.jpg',
  })

  useMemo(() => {
    Object.entries(woodTextures).forEach(([key, tex]) => {
      const t = tex as THREE.Texture
      t.wrapS = THREE.RepeatWrapping
      t.wrapT = THREE.RepeatWrapping
      t.repeat.set(2, 1.5)
      t.colorSpace = key === 'map' ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace
    })
  }, [woodTextures])

  // OPTIMISATION: 3 matériaux partagés (au lieu de ~12 inline par étagère)
  const backMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    map: woodTextures.map as THREE.Texture,
    normalMap: woodTextures.normalMap as THREE.Texture,
    roughnessMap: woodTextures.roughnessMap as THREE.Texture,
    color: '#5a4a3a',
    normalScale: new THREE.Vector2(0.7, 0.7),
  }), [woodTextures])

  const plankMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    map: woodTextures.map as THREE.Texture,
    normalMap: woodTextures.normalMap as THREE.Texture,
    roughnessMap: woodTextures.roughnessMap as THREE.Texture,
    color: '#4a3a2a',
    normalScale: new THREE.Vector2(0.7, 0.7),
  }), [woodTextures])

  const dividerMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    map: woodTextures.map as THREE.Texture,
    normalMap: woodTextures.normalMap as THREE.Texture,
    roughnessMap: woodTextures.roughnessMap as THREE.Texture,
    color: '#3a2a1a',
    normalScale: new THREE.Vector2(0.7, 0.7),
  }), [woodTextures])

  // Géométries dépendant de length (partagées entre planches d'une même étagère)
  const plankGeometry = useMemo(() =>
    new THREE.BoxGeometry(length - 0.05, 0.025, SHELF_DEPTH - 0.05),
  [length])

  useEffect(() => {
    return () => {
      backMaterial.dispose()
      plankMaterial.dispose()
      dividerMaterial.dispose()
      plankGeometry.dispose()
    }
  }, [backMaterial, plankMaterial, dividerMaterial, plankGeometry])

  return (
    <group position={position} rotation={rotation}>
      {/* Structure principale de l'étagère (panneau arrière) */}
      <mesh position={[0, SHELF_HEIGHT / 2 + 0.1, 0]} castShadow receiveShadow material={backMaterial}>
        <boxGeometry args={[length, SHELF_HEIGHT, SHELF_DEPTH]} />
      </mesh>

      {/* Planches horizontales (géométrie + matériau partagés) */}
      {Array.from({ length: ROWS + 1 }).map((_, i) => (
        <mesh
          key={`plank-${i}`}
          position={[0, 0.12 + i * ROW_HEIGHT, SHELF_DEPTH / 2 - 0.02]}
          receiveShadow
          geometry={plankGeometry}
          material={plankMaterial}
        />
      ))}

      {/* Séparateurs verticaux tous les ~1m (géométrie globale + matériau partagé) */}
      {Array.from({ length: Math.floor(length / 1) + 1 }).map((_, i) => {
        const x = -length / 2 + i * 1
        if (Math.abs(x) > length / 2) return null
        return (
          <mesh
            key={`divider-${i}`}
            position={[x, SHELF_HEIGHT / 2 + 0.1, SHELF_DEPTH / 2 - 0.02]}
            receiveShadow
            geometry={SHARED_DIVIDER_GEOM}
            material={dividerMaterial}
          />
        )
      })}

      {/* Cassettes - remplir toutes les rangées */}
      {Array.from({ length: totalCapacity }).map((_, index) => {
        const row = Math.floor(index / cassettesPerRow)
        const col = index % cassettesPerRow

        if (row >= ROWS) return null

        // Utiliser le film correspondant ou boucler sur les films disponibles
        const filmIndex = index % Math.max(films.length, 1)
        const film = films[filmIndex]

        if (!film) return null

        // Position de la cassette avec espacement
        const x = (col - cassettesPerRow / 2 + 0.5) * CASSETTE_SPACING
        const y = 0.25 + row * ROW_HEIGHT
        const z = SHELF_DEPTH / 2 + 0.02

        const cassetteKey = `wall-${position[0].toFixed(1)}-${position[2].toFixed(1)}-${row}-${col}`
        return (
          <Cassette
            key={cassetteKey}
            position={[x, y, z]}
            film={film}
            cassetteKey={cassetteKey}
          />
        )
      })}
    </group>
  )
}
