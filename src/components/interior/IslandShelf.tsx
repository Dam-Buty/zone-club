import { useMemo, useEffect } from 'react'
import * as THREE from 'three'
import { useTexture } from '@react-three/drei'
import { Cassette, CASSETTE_DIMENSIONS } from './Cassette'
import type { Film } from '../../types'

interface IslandShelfProps {
  position: [number, number, number]
  rotation?: [number, number, number]
  filmsLeft: Film[]
  filmsRight: Film[]
}

// Dimensions de l'îlot (30% plus bas que les étagères murales)
const ROWS = 4
const CASSETTE_SPACING = CASSETTE_DIMENSIONS.width + 0.02
const CASSETTES_PER_ROW = 12
const ROW_HEIGHT = CASSETTE_DIMENSIONS.height + 0.08
const ISLAND_HEIGHT = 1.6
const ISLAND_LENGTH = 2.4
const BASE_WIDTH = 0.55
const TOP_WIDTH = 0.35
const CASSETTE_TILT = 0.15

// OPTIMISATION: Géométrie partagée pour les 8 planches (4 gauche + 4 droite), identiques
const SHARED_ISLAND_PLANK_GEOM = new THREE.BoxGeometry(0.14, 0.018, ISLAND_LENGTH - 0.1)

export function IslandShelf({
  position,
  rotation = [0, 0, 0],
  filmsLeft,
  filmsRight,
}: IslandShelfProps) {
  // Créer la géométrie trapézoïdale pour la structure centrale
  const trapezoidGeometry = useMemo(() => {
    const shape = new THREE.Shape()

    const halfBaseWidth = BASE_WIDTH / 2
    const halfTopWidth = TOP_WIDTH / 2

    shape.moveTo(-halfBaseWidth, 0)
    shape.lineTo(halfBaseWidth, 0)
    shape.lineTo(halfTopWidth, ISLAND_HEIGHT)
    shape.lineTo(-halfTopWidth, ISLAND_HEIGHT)
    shape.closePath()

    const extrudeSettings = {
      depth: ISLAND_LENGTH,
      bevelEnabled: false,
    }

    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings)
    geometry.translate(0, 0, -ISLAND_LENGTH / 2)

    return geometry
  }, [])

  const totalCapacityPerSide = CASSETTES_PER_ROW * ROWS

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
      t.repeat.set(1.5, 1)
      t.colorSpace = key === 'map' ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace
    })
  }, [woodTextures])

  // OPTIMISATION: 2 matériaux partagés (au lieu de ~10 inline)
  const structureMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    map: woodTextures.map as THREE.Texture,
    normalMap: woodTextures.normalMap as THREE.Texture,
    roughnessMap: woodTextures.roughnessMap as THREE.Texture,
    color: '#4a3a2a',
    normalScale: new THREE.Vector2(0.7, 0.7),
  }), [woodTextures])

  const plankMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    map: woodTextures.map as THREE.Texture,
    normalMap: woodTextures.normalMap as THREE.Texture,
    roughnessMap: woodTextures.roughnessMap as THREE.Texture,
    color: '#3a2a1a',
    normalScale: new THREE.Vector2(0.7, 0.7),
  }), [woodTextures])

  useEffect(() => {
    return () => {
      structureMaterial.dispose()
      plankMaterial.dispose()
    }
  }, [structureMaterial, plankMaterial])

  return (
    <group position={position} rotation={rotation}>
      {/* Structure trapézoïdale centrale (matériau partagé) */}
      <mesh geometry={trapezoidGeometry} castShadow receiveShadow material={structureMaterial} />

      {/* Planches horizontales côté gauche (-x) — géométrie + matériau partagés */}
      {Array.from({ length: ROWS }).map((_, i) => {
        const y = 0.2 + i * ROW_HEIGHT
        const widthAtHeight = BASE_WIDTH - (BASE_WIDTH - TOP_WIDTH) * (y / ISLAND_HEIGHT)
        return (
          <mesh
            key={`plank-left-${i}`}
            position={[-widthAtHeight / 2 - 0.02, y, 0]}
            rotation={[0, 0, -CASSETTE_TILT]}
            receiveShadow
            geometry={SHARED_ISLAND_PLANK_GEOM}
            material={plankMaterial}
          />
        )
      })}

      {/* Planches horizontales côté droit (+x) — géométrie + matériau partagés */}
      {Array.from({ length: ROWS }).map((_, i) => {
        const y = 0.2 + i * ROW_HEIGHT
        const widthAtHeight = BASE_WIDTH - (BASE_WIDTH - TOP_WIDTH) * (y / ISLAND_HEIGHT)
        return (
          <mesh
            key={`plank-right-${i}`}
            position={[widthAtHeight / 2 + 0.02, y, 0]}
            rotation={[0, 0, CASSETTE_TILT]}
            receiveShadow
            geometry={SHARED_ISLAND_PLANK_GEOM}
            material={plankMaterial}
          />
        )
      })}

      {/* Cassettes côté gauche (inclinées vers -x) - remplir toutes les rangées */}
      {Array.from({ length: totalCapacityPerSide }).map((_, index) => {
        const row = Math.floor(index / CASSETTES_PER_ROW)
        const col = index % CASSETTES_PER_ROW

        if (row >= ROWS) return null

        const filmIndex = index % Math.max(filmsLeft.length, 1)
        const film = filmsLeft[filmIndex]

        if (!film) return null

        const y = 0.34 + row * ROW_HEIGHT  // +9% hauteur total
        const widthAtHeight = BASE_WIDTH - (BASE_WIDTH - TOP_WIDTH) * (y / ISLAND_HEIGHT)
        const x = -widthAtHeight / 2 - 0.06  // rapproché vers l'intérieur du meuble
        const z = (col - CASSETTES_PER_ROW / 2 + 0.5) * CASSETTE_SPACING

        const cassetteKey = `island-left-${row}-${col}`
        return (
          <group key={cassetteKey} position={[x, y, z]} rotation={[0, Math.PI / 2, -CASSETTE_TILT]}>
            <Cassette
              position={[0, 0, 0]}
              film={film}
              cassetteKey={cassetteKey}
              hoverOffsetZ={-0.08}
            />
          </group>
        )
      })}

      {/* Cassettes côté droit (inclinées vers +x) - remplir toutes les rangées */}
      {Array.from({ length: totalCapacityPerSide }).map((_, index) => {
        const row = Math.floor(index / CASSETTES_PER_ROW)
        const col = index % CASSETTES_PER_ROW

        if (row >= ROWS) return null

        const filmIndex = index % Math.max(filmsRight.length, 1)
        const film = filmsRight[filmIndex]

        if (!film) return null

        const y = 0.34 + row * ROW_HEIGHT  // +9% hauteur total
        const widthAtHeight = BASE_WIDTH - (BASE_WIDTH - TOP_WIDTH) * (y / ISLAND_HEIGHT)
        const x = widthAtHeight / 2 + 0.06  // rapproché vers l'intérieur du meuble
        const z = (col - CASSETTES_PER_ROW / 2 + 0.5) * CASSETTE_SPACING

        const cassetteKey = `island-right-${row}-${col}`
        return (
          <group key={cassetteKey} position={[x, y, z]} rotation={[0, -Math.PI / 2, CASSETTE_TILT]}>
            <Cassette
              position={[0, 0, 0]}
              film={film}
              cassetteKey={cassetteKey}
              hoverOffsetZ={-0.08}
            />
          </group>
        )
      })}

      {/* Panneau supérieur (matériau partagé avec planches) */}
      <mesh position={[0, ISLAND_HEIGHT + 0.02, 0]} castShadow receiveShadow material={plankMaterial}>
        <boxGeometry args={[TOP_WIDTH + 0.04, 0.03, ISLAND_LENGTH]} />
      </mesh>
    </group>
  )
}
