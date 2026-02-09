import { useRef, useEffect, useMemo } from 'react'
import * as THREE from 'three'

// Dimensions d'une boîte de jeu vidéo années 90 (légèrement plus grande que cassette VHS)
const BOX_WIDTH = 0.14
const BOX_HEIGHT = 0.20
const BOX_DEPTH = 0.03

// OPTIMISATION: Géométries partagées
const SHARED_BOX_GEOM = new THREE.BoxGeometry(BOX_WIDTH, BOX_HEIGHT, BOX_DEPTH)
const SHARED_RACK_STRUCTURE_GEOM = new THREE.BoxGeometry(0.7, 1, 0.15)
const SHARED_RACK_SHELF_GEOM = new THREE.BoxGeometry(0.65, 0.015, 0.12)

// OPTIMISATION: 6 matériaux couleur partagés
const GAME_COLORS = [
  '#000066', // Bleu NES
  '#cc0000', // Rouge Nintendo
  '#006600', // Vert Game Boy
  '#333333', // Gris Sega
  '#990099', // Violet SNES
  '#ff6600', // Orange
]
const SHARED_BOX_MATERIALS = GAME_COLORS.map(c =>
  new THREE.MeshStandardMaterial({ color: c, roughness: 0.3, metalness: 0.1 })
)
const SHARED_RACK_STRUCTURE_MAT = new THREE.MeshStandardMaterial({ color: '#2a2a35', roughness: 0.6 })
const SHARED_RACK_SHELF_MAT = new THREE.MeshStandardMaterial({ color: '#3a3a45', roughness: 0.5 })

const _tempMatrix = new THREE.Matrix4()

// Rack de jeux avec InstancedMesh par couleur + planches instancées
interface GameRackProps {
  position: [number, number, number]
  rotation?: [number, number, number]
}

export function GameRack({ position, rotation = [0, 0, 0] }: GameRackProps) {
  const shelfRef = useRef<THREE.InstancedMesh>(null!)

  // Pré-calculer les positions des boîtes groupées par couleur
  const boxesByColor = useMemo(() => {
    const cols = 8
    const rows = 4
    const spacing = 0.15
    const byColor: Map<number, THREE.Vector3[]> = new Map()

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = (col - cols / 2) * spacing * 0.5 + spacing * 0.25
        const y = 0.15 + row * 0.22
        const z = (col % 2) * 0.01 + 0.08 // +0.08 offset du group
        const colorIndex = (row * cols + col) % GAME_COLORS.length

        if (!byColor.has(colorIndex)) byColor.set(colorIndex, [])
        byColor.get(colorIndex)!.push(new THREE.Vector3(x, y, z))
      }
    }

    return byColor
  }, [])

  // Refs pour chaque InstancedMesh par couleur
  const colorRefs = useRef<(THREE.InstancedMesh | null)[]>(new Array(GAME_COLORS.length).fill(null))

  useEffect(() => {
    // Configurer les InstancedMesh par couleur
    for (const [colorIndex, positions] of boxesByColor) {
      const mesh = colorRefs.current[colorIndex]
      if (!mesh) continue

      for (let i = 0; i < positions.length; i++) {
        const p = positions[i]
        _tempMatrix.makeTranslation(p.x, p.y, p.z)
        mesh.setMatrixAt(i, _tempMatrix)
      }
      mesh.instanceMatrix.needsUpdate = true
    }

    // Configurer les planches
    const shelf = shelfRef.current
    if (shelf) {
      for (let i = 0; i < 5; i++) {
        _tempMatrix.makeTranslation(0, 0.08 + i * 0.22, 0.08)
        shelf.setMatrixAt(i, _tempMatrix)
      }
      shelf.instanceMatrix.needsUpdate = true
    }
  }, [boxesByColor])

  return (
    <group position={position} rotation={rotation}>
      {/* Structure de l'étagère */}
      <mesh position={[0, 0.5, 0]} geometry={SHARED_RACK_STRUCTURE_GEOM} material={SHARED_RACK_STRUCTURE_MAT} />

      {/* 5 planches → 1 InstancedMesh */}
      <instancedMesh ref={shelfRef} args={[SHARED_RACK_SHELF_GEOM, SHARED_RACK_SHELF_MAT, 5]} />

      {/* Boîtiers par couleur → 1 InstancedMesh par couleur (6 max) */}
      {GAME_COLORS.map((_, colorIndex) => {
        const count = boxesByColor.get(colorIndex)?.length || 0
        if (count === 0) return null
        return (
          <instancedMesh
            key={`color-${colorIndex}`}
            ref={(el) => { colorRefs.current[colorIndex] = el }}
            args={[SHARED_BOX_GEOM, SHARED_BOX_MATERIALS[colorIndex], count]}
          />
        )
      })}
    </group>
  )
}
