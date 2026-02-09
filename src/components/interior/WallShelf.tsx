import { useCallback, useMemo, useEffect } from 'react'
import * as THREE from 'three'
import { useTexture } from '@react-three/drei'
import { CASSETTE_DIMENSIONS } from './Cassette'

interface WallShelfProps {
  position: [number, number, number]
  rotation?: [number, number, number]
  length: number  // Longueur de l'étagère
}

const ROWS = 5
const ROW_HEIGHT = CASSETTE_DIMENSIONS.height + 0.12  // Hauteur entre rangées
export const SHELF_HEIGHT = 2.4
export const SHELF_DEPTH = 0.19  // was 0.38 — halved
export const SHELF_TILT = 0.087  // ~5° backward lean (thicker at bottom, thinner at top)
export const SHELF_PIVOT_Y = SHELF_HEIGHT / 2 + 0.1  // tilt pivot = shelf vertical center (1.3m)

// OPTIMISATION: Géométrie partagée pour les séparateurs (identiques dans toutes les étagères)
const SHARED_DIVIDER_GEOM = new THREE.BoxGeometry(0.02, SHELF_HEIGHT - 0.1, 0.02)

const _tempMatrix = new THREE.Matrix4()

export function WallShelf({
  position,
  rotation = [0, 0, 0],
  length,
}: WallShelfProps) {
  const dividerCount = Math.floor(length / 1) + 1

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
      t.anisotropy = 16
      t.colorSpace = key === 'map' ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace
    })
  }, [woodTextures])

  // OPTIMISATION: 3 matériaux partagés
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

  const plankGeometry = useMemo(() =>
    new THREE.BoxGeometry(length - 0.05, 0.025, SHELF_DEPTH - 0.05),
  [length])

  // Callback ref: sets matrices immediately when the InstancedMesh is created/attached
  // Positions are relative to the tilt group center (SHELF_PIVOT_Y)
  const plankRefCallback = useCallback((mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return
    for (let i = 0; i < ROWS + 1; i++) {
      const y = 0.12 + i * ROW_HEIGHT - SHELF_PIVOT_Y
      const z = SHELF_DEPTH / 2 - 0.02
      _tempMatrix.makeTranslation(0, y, z)
      mesh.setMatrixAt(i, _tempMatrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  }, [])

  const dividerRefCallback = useCallback((mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return
    let validCount = 0
    for (let i = 0; i < dividerCount; i++) {
      const x = -length / 2 + i * 1
      if (Math.abs(x) > length / 2) continue
      _tempMatrix.makeTranslation(x, 0, SHELF_DEPTH / 2 - 0.02)
      mesh.setMatrixAt(validCount, _tempMatrix)
      validCount++
    }
    mesh.count = validCount
    mesh.instanceMatrix.needsUpdate = true
  }, [length, dividerCount])

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
      {/* Tilt group: pivot at shelf center height, ~5° backward lean */}
      <group position={[0, SHELF_PIVOT_Y, 0]} rotation={[-SHELF_TILT, 0, 0]}>
        {/* Structure principale — centered at tilt pivot */}
        <mesh castShadow receiveShadow material={backMaterial}>
          <boxGeometry args={[length, SHELF_HEIGHT, SHELF_DEPTH]} />
        </mesh>

        {/* Planches horizontales → 1 InstancedMesh */}
        <instancedMesh
          ref={plankRefCallback}
          args={[plankGeometry, plankMaterial, ROWS + 1]}
          receiveShadow
        />

        {/* Séparateurs verticaux → 1 InstancedMesh */}
        <instancedMesh
          ref={dividerRefCallback}
          args={[SHARED_DIVIDER_GEOM, dividerMaterial, dividerCount]}
          receiveShadow
        />
      </group>
    </group>
  )
}
