import { useCallback, useMemo, useEffect } from 'react'
import * as THREE from 'three/webgpu'
import { CASSETTE_DIMENSIONS } from './Cassette'

interface WallShelfProps {
  position: [number, number, number]
  rotation?: [number, number, number]
  length: number  // Longueur de l'étagère
  woodTextures: Record<string, THREE.Texture>
}

const ROWS = 6
const ROW_HEIGHT = CASSETTE_DIMENSIONS.height + 0.04  // Hauteur entre rangées (serré, juste au-dessus des K7)
export const SHELF_DEPTH = 0.095  // back panel depth (halved from 0.19)
export const WALL_SHELF_ROWS = ROWS
const PLANK_DEPTH = 0.07           // shelf planks protrude forward from back panel (-30%)
const PLANK_THICKNESS = 0.025
const TOP_PLANK_TOP_Y = 0.12 + ROWS * ROW_HEIGHT + PLANK_THICKNESS / 2
// Back panel extends 1cm above the top of the highest cassette
const CASSETTE_CLEARANCE = 0.0125 + CASSETTE_DIMENSIONS.height + 0.01  // plank gap + K7 + 1cm
export const SHELF_HEIGHT = TOP_PLANK_TOP_Y + CASSETTE_CLEARANCE
export const SHELF_TILT = 0.087  // ~5° backward lean (thicker at bottom, thinner at top)
export const SHELF_PIVOT_Y = SHELF_HEIGHT / 2 + 0.1  // tilt pivot = shelf vertical center

// Planches chevauchent le panneau arrière de 5mm pour éliminer le vide visible
const PLANK_OVERLAP = 0.005

// Géométrie partagée pour les séparateurs — arêtes franches
const SHARED_DIVIDER_GEOM = new THREE.BoxGeometry(0.02, SHELF_HEIGHT - 0.1, 0.02)

const _tempMatrix = new THREE.Matrix4()

// wallShelfMaterial imported from IslandShelf.tsx

export function WallShelf({
  position,
  rotation = [0, 0, 0],
  length,
  woodTextures,
}: WallShelfProps) {
  const dividerCount = Math.floor(length / 1) + 1

  const shelfMap = useMemo(() => {
    const map = (woodTextures.map as THREE.Texture).clone()
    map.wrapS = THREE.RepeatWrapping
    map.wrapT = THREE.RepeatWrapping
    map.repeat.set(Math.max(length / 0.55, 1), Math.max(SHELF_HEIGHT / 0.28, 1))
    map.anisotropy = 16
    map.colorSpace = THREE.SRGBColorSpace
    map.needsUpdate = true
    return map
  }, [woodTextures, length])

  const shelfMaterial = useMemo(() => new THREE.MeshPhysicalMaterial({
    map: shelfMap,
    color: '#a07850',
    roughness: 0.22,
    metalness: 0.0,
    envMapIntensity: 0.50,
    clearcoat: 0.42,
    clearcoatRoughness: 0.12,
  }), [shelfMap])

  // Back panel — hard edges, no rounded profile
  const backPanelGeometry = useMemo(() =>
    new THREE.BoxGeometry(length, SHELF_HEIGHT, SHELF_DEPTH),
  [length])

  // Planches — pleine largeur, arêtes franches
  const plankGeometry = useMemo(() =>
    new THREE.BoxGeometry(length, PLANK_THICKNESS, PLANK_DEPTH),
  [length])

  // Callback ref: sets matrices immediately when the InstancedMesh is created/attached
  // Positions are relative to the tilt group center (SHELF_PIVOT_Y)
  // Skip bottom plank (i=0) — cassettes moved up one row, bottom shelf empty and removed
  const plankRefCallback = useCallback((mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return
    for (let i = 1; i < ROWS + 1; i++) {
      const y = 0.12 + i * ROW_HEIGHT - SHELF_PIVOT_Y
      // Plank overlaps back panel by PLANK_OVERLAP to eliminate visible gap
      const z = SHELF_DEPTH / 2 + PLANK_DEPTH / 2 - PLANK_OVERLAP
      _tempMatrix.makeTranslation(0, y, z)
      mesh.setMatrixAt(i - 1, _tempMatrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  }, [])

  const dividerRefCallback = useCallback((mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return
    let validCount = 0
    for (let i = 0; i < dividerCount; i++) {
      const x = -length / 2 + i * 1
      if (Math.abs(x) > length / 2) continue
      _tempMatrix.makeTranslation(x, 0, 0)
      mesh.setMatrixAt(validCount, _tempMatrix)
      validCount++
    }
    mesh.count = validCount
    mesh.instanceMatrix.needsUpdate = true
  }, [length, dividerCount])

  useEffect(() => {
    return () => {
      backPanelGeometry.dispose()
      plankGeometry.dispose()
    }
  }, [backPanelGeometry, plankGeometry])

  useEffect(() => {
    return () => {
      shelfMaterial.dispose()
      shelfMap.dispose()
    }
  }, [shelfMaterial, shelfMap])

  return (
    <group position={position} rotation={rotation}>
      {/* Tilt group: pivot at shelf center height, ~5° backward lean */}
      <group position={[0, SHELF_PIVOT_Y, 0]} rotation={[-SHELF_TILT, 0, 0]}>
        <mesh castShadow receiveShadow material={shelfMaterial} geometry={backPanelGeometry} />

        {/* Planches horizontales → 1 InstancedMesh, arêtes franches */}
        <instancedMesh
          ref={plankRefCallback}
          args={[plankGeometry, shelfMaterial, ROWS]}
          receiveShadow
        />

        {/* Séparateurs verticaux → 1 InstancedMesh, arêtes franches */}
        <instancedMesh
          ref={dividerRefCallback}
          args={[SHARED_DIVIDER_GEOM, shelfMaterial, dividerCount]}
          receiveShadow
        />
      </group>
    </group>
  )
}
