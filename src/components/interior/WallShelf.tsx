import { useRef, useMemo, useEffect } from 'react'
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
const SHELF_HEIGHT = 2.4
const SHELF_DEPTH = 0.38

// OPTIMISATION: Géométrie partagée pour les séparateurs (identiques dans toutes les étagères)
const SHARED_DIVIDER_GEOM = new THREE.BoxGeometry(0.02, SHELF_HEIGHT - 0.1, 0.02)

const _tempMatrix = new THREE.Matrix4()

export function WallShelf({
  position,
  rotation = [0, 0, 0],
  length,
}: WallShelfProps) {
  const plankRef = useRef<THREE.InstancedMesh>(null!)
  const dividerRef = useRef<THREE.InstancedMesh>(null!)

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

  // Setup InstancedMesh matrices
  useEffect(() => {
    const plank = plankRef.current
    if (plank) {
      for (let i = 0; i < ROWS + 1; i++) {
        _tempMatrix.makeTranslation(0, 0.12 + i * ROW_HEIGHT, SHELF_DEPTH / 2 - 0.02)
        plank.setMatrixAt(i, _tempMatrix)
      }
      plank.instanceMatrix.needsUpdate = true
    }

    const divider = dividerRef.current
    if (divider) {
      let validCount = 0
      for (let i = 0; i < dividerCount; i++) {
        const x = -length / 2 + i * 1
        if (Math.abs(x) > length / 2) continue
        _tempMatrix.makeTranslation(x, SHELF_HEIGHT / 2 + 0.1, SHELF_DEPTH / 2 - 0.02)
        divider.setMatrixAt(validCount, _tempMatrix)
        validCount++
      }
      divider.count = validCount
      divider.instanceMatrix.needsUpdate = true
    }
  }, [length, dividerCount])

  // Cassette position computation is now handled by Aisle.tsx useMemo (pre-computed)

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
      {/* Structure principale */}
      <mesh position={[0, SHELF_HEIGHT / 2 + 0.1, 0]} castShadow receiveShadow material={backMaterial}>
        <boxGeometry args={[length, SHELF_HEIGHT, SHELF_DEPTH]} />
      </mesh>

      {/* Planches horizontales → 1 InstancedMesh */}
      <instancedMesh
        ref={plankRef}
        args={[plankGeometry, plankMaterial, ROWS + 1]}
        receiveShadow
      />

      {/* Séparateurs verticaux → 1 InstancedMesh */}
      <instancedMesh
        ref={dividerRef}
        args={[SHARED_DIVIDER_GEOM, dividerMaterial, dividerCount]}
        receiveShadow
      />

      {/* Cassettes are now rendered via CassetteInstances in Aisle */}
    </group>
  )
}
