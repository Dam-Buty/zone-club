import { useRef, useMemo, useEffect } from 'react'
import * as THREE from 'three'
import { useTexture } from '@react-three/drei'
import { CASSETTE_DIMENSIONS } from './Cassette'

interface IslandShelfProps {
  position: [number, number, number]
  rotation?: [number, number, number]
}

// Dimensions de l'îlot (30% plus bas que les étagères murales)
const ROWS = 4
const ROW_HEIGHT = CASSETTE_DIMENSIONS.height + 0.08
const ISLAND_HEIGHT = 1.4
const ISLAND_LENGTH = 2.4
const BASE_WIDTH = 0.55
const TOP_WIDTH = 0.35
const CASSETTE_TILT = 0.15

// OPTIMISATION: Géométrie partagée pour les 8 planches (4 gauche + 4 droite)
const SHARED_ISLAND_PLANK_GEOM = new THREE.BoxGeometry(0.14, 0.018, ISLAND_LENGTH - 0.1)

const _tempMatrix = new THREE.Matrix4()
const _tempQuat = new THREE.Quaternion()
const _tempScale = new THREE.Vector3(1, 1, 1)

export function IslandShelf({
  position,
  rotation = [0, 0, 0],
}: IslandShelfProps) {
  const plankRef = useRef<THREE.InstancedMesh>(null!)

  const trapezoidGeometry = useMemo(() => {
    const shape = new THREE.Shape()
    const halfBaseWidth = BASE_WIDTH / 2
    const halfTopWidth = TOP_WIDTH / 2
    shape.moveTo(-halfBaseWidth, 0)
    shape.lineTo(halfBaseWidth, 0)
    shape.lineTo(halfTopWidth, ISLAND_HEIGHT)
    shape.lineTo(-halfTopWidth, ISLAND_HEIGHT)
    shape.closePath()
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: ISLAND_LENGTH, bevelEnabled: false })
    geometry.translate(0, 0, -ISLAND_LENGTH / 2)
    return geometry
  }, [])

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
      t.anisotropy = 16
      t.colorSpace = key === 'map' ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace
    })
  }, [woodTextures])

  const structureMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    map: woodTextures.map as THREE.Texture,
    normalMap: woodTextures.normalMap as THREE.Texture,
    roughnessMap: woodTextures.roughnessMap as THREE.Texture,
    color: '#7a6550',
    normalScale: new THREE.Vector2(0.9, 0.9),
  }), [woodTextures])

  const plankMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    map: woodTextures.map as THREE.Texture,
    normalMap: woodTextures.normalMap as THREE.Texture,
    roughnessMap: woodTextures.roughnessMap as THREE.Texture,
    color: '#6a5540',
    normalScale: new THREE.Vector2(0.9, 0.9),
  }), [woodTextures])

  // Setup 8 planches in one InstancedMesh
  useEffect(() => {
    const mesh = plankRef.current
    if (!mesh) return

    let idx = 0
    for (let i = 0; i < ROWS; i++) {
      const y = 0.2 + i * ROW_HEIGHT
      const widthAtHeight = BASE_WIDTH - (BASE_WIDTH - TOP_WIDTH) * (y / ISLAND_HEIGHT)

      // Left plank
      _tempQuat.setFromEuler(new THREE.Euler(0, 0, -CASSETTE_TILT))
      _tempMatrix.compose(
        new THREE.Vector3(-widthAtHeight / 2 - 0.02, y, 0),
        _tempQuat,
        _tempScale
      )
      mesh.setMatrixAt(idx++, _tempMatrix)

      // Right plank
      _tempQuat.setFromEuler(new THREE.Euler(0, 0, CASSETTE_TILT))
      _tempMatrix.compose(
        new THREE.Vector3(widthAtHeight / 2 + 0.02, y, 0),
        _tempQuat,
        _tempScale
      )
      mesh.setMatrixAt(idx++, _tempMatrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  }, [])

  // Cassette position computation is now handled by Aisle.tsx useMemo (pre-computed)

  useEffect(() => {
    return () => {
      structureMaterial.dispose()
      plankMaterial.dispose()
    }
  }, [structureMaterial, plankMaterial])

  return (
    <group position={position} rotation={rotation}>
      {/* Structure trapézoïdale centrale */}
      <mesh geometry={trapezoidGeometry} castShadow receiveShadow material={structureMaterial} />

      {/* 8 planches → 1 InstancedMesh */}
      <instancedMesh
        ref={plankRef}
        args={[SHARED_ISLAND_PLANK_GEOM, plankMaterial, ROWS * 2]}
        receiveShadow
      />

      {/* Cassettes are now rendered via CassetteInstances in Aisle */}

      {/* Panneau supérieur */}
      <mesh position={[0, ISLAND_HEIGHT + 0.02, 0]} castShadow receiveShadow material={plankMaterial}>
        <boxGeometry args={[TOP_WIDTH + 0.04, 0.03, ISLAND_LENGTH]} />
      </mesh>
    </group>
  )
}
