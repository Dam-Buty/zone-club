import { useMemo, useEffect } from 'react'
import * as THREE from 'three/webgpu'
import { CASSETTE_DIMENSIONS } from './Cassette'

interface IslandShelfProps {
  position: [number, number, number]
  rotation?: [number, number, number]
  woodTextures: Record<string, THREE.Texture>
}

// Dimensions de l'îlot
const ROWS = 5
const ROW_HEIGHT = CASSETTE_DIMENSIONS.height + 0.04  // serré, juste au-dessus des K7
const ISLAND_HEIGHT = 1.40
const ISLAND_LENGTH = 4.1
const BASE_WIDTH = 0.54
const TOP_WIDTH = 0.12  // convergence doublée (~6.5° par côté vs ~3.3° avant)
const CASSETTE_TILT = Math.atan2((BASE_WIDTH - TOP_WIDTH) / 2, ISLAND_HEIGHT)
const PLANK_THICKNESS = 0.018
const PLANK_OFFSET = 0.005
const FIRST_PLANK_BASE_Y = 0.06

export const ISLAND_SHELF_CASSETTE_ROWS = ROWS - 1
export const ISLAND_SHELF_ROW_HEIGHT = ROW_HEIGHT
export const ISLAND_SHELF_HEIGHT = ISLAND_HEIGHT
export const ISLAND_SHELF_BASE_WIDTH = BASE_WIDTH
export const ISLAND_SHELF_TOP_WIDTH = TOP_WIDTH
export const ISLAND_SHELF_CASSETTE_TILT = CASSETTE_TILT
export const ISLAND_SHELF_PLANK_THICKNESS = PLANK_THICKNESS
export const ISLAND_SHELF_PLANK_OFFSET = PLANK_OFFSET
export const ISLAND_SHELF_FIRST_PLANK_BASE_Y = FIRST_PLANK_BASE_Y

// Socle sous l'îlot — surélève la structure sans toucher aux K7/planches
const PEDESTAL_HEIGHT = 0.10
export const ISLAND_SHELF_PEDESTAL_HEIGHT = PEDESTAL_HEIGHT
const SHARED_PEDESTAL_GEOM = new THREE.BoxGeometry(BASE_WIDTH, PEDESTAL_HEIGHT, ISLAND_LENGTH)

// Medium oak for the shelving family: warmer and browner than beige/sand.
const SHELF_COLOR = '#a07850'
const METALNESS = 0      // pur diélectrique
// Géométrie partagée pour les planches et le panneau supérieur — arêtes franches
const SHARED_ISLAND_PLANK_GEOM = new THREE.BoxGeometry(0.16, 0.018, ISLAND_LENGTH - 0.1)
const SHARED_TOP_PANEL_GEOM = new THREE.BoxGeometry(TOP_WIDTH + 0.04, 0.03, ISLAND_LENGTH)

// Pre-compute plank positions and rotations (static — no need for useEffect)
const PLANK_DATA: { x: number; y: number; rz: number }[] = []
for (let i = 1; i < ROWS; i++) {
  const y = FIRST_PLANK_BASE_Y + i * ROW_HEIGHT
  const widthAtHeight = BASE_WIDTH - (BASE_WIDTH - TOP_WIDTH) * (y / ISLAND_HEIGHT)
  // Left plank
  PLANK_DATA.push({ x: -widthAtHeight / 2 - PLANK_OFFSET, y, rz: -CASSETTE_TILT })
  // Right plank
  PLANK_DATA.push({ x: widthAtHeight / 2 + PLANK_OFFSET, y, rz: CASSETTE_TILT })
}

export function IslandShelf({
  position,
  rotation = [0, 0, 0],
  woodTextures,
}: IslandShelfProps) {
  const shelfMap = useMemo(() => {
    const map = (woodTextures.map as THREE.Texture).clone()
    map.wrapS = THREE.RepeatWrapping
    map.wrapT = THREE.RepeatWrapping
    map.repeat.set(6.5, 9.5)
    map.anisotropy = 16
    map.colorSpace = THREE.SRGBColorSpace
    map.needsUpdate = true
    return map
  }, [woodTextures])

  const shelfMaterial = useMemo(() => new THREE.MeshPhysicalMaterial({
    map: shelfMap,
    color: SHELF_COLOR,
    roughness: 0.22,
    metalness: METALNESS,
    envMapIntensity: 0.50,
    clearcoat: 0.42,
    clearcoatRoughness: 0.12,
  }), [shelfMap])

  const trapezoidGeometry = useMemo(() => {
    // BoxGeometry subdivisé + déformation vertex → grille fine sur TOUTES les faces
    // Élimine les artefacts diagonaux (chevrons) des bouchons ExtrudeGeometry
    const box = new THREE.BoxGeometry(
      BASE_WIDTH, ISLAND_HEIGHT, ISLAND_LENGTH,
      16, 16, 64
    )
    const pos = box.attributes.position as THREE.BufferAttribute
    const halfH = ISLAND_HEIGHT / 2
    const taper = 1 - TOP_WIDTH / BASE_WIDTH
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i)
      const yNorm = (y + halfH) / ISLAND_HEIGHT  // 0 bas, 1 haut
      pos.setX(i, pos.getX(i) * (1 - taper * yNorm))
      pos.setY(i, y + halfH)  // décaler pour que le bas soit à Y=0
    }
    pos.needsUpdate = true
    // Non-indexed → normales par face (arêtes nettes entre faces)
    const geometry = box.toNonIndexed()
    geometry.computeVertexNormals()
    box.dispose()
    return geometry
  }, [])

  // Cassette position computation is now handled by Aisle.tsx useMemo (pre-computed)

  useEffect(() => {
    return () => {
      trapezoidGeometry.dispose()
      shelfMaterial.dispose()
      shelfMap.dispose()
    }
  }, [trapezoidGeometry, shelfMaterial, shelfMap])

  return (
    <group position={position} rotation={rotation}>
      {/* Socle — surélève l'ensemble de PEDESTAL_HEIGHT */}
      <mesh
        position={[0, PEDESTAL_HEIGHT / 2, 0]}
        geometry={SHARED_PEDESTAL_GEOM}
        material={shelfMaterial}
        castShadow
        receiveShadow
      />

      {/* Contenu surélevé au-dessus du socle */}
      <group position={[0, PEDESTAL_HEIGHT, 0]}>
        {/* Structure trapézoïdale centrale — bois, arêtes franches */}
        <mesh geometry={trapezoidGeometry} castShadow receiveShadow material={shelfMaterial} />

        {/* Planches — meshes individuels (8 planches, fiable en WebGPU) */}
        {PLANK_DATA.map((p, i) => (
          <mesh
            key={`plank-${i}`}
            position={[p.x, p.y, 0]}
            rotation={[0, 0, p.rz]}
            geometry={SHARED_ISLAND_PLANK_GEOM}
            material={shelfMaterial}
            receiveShadow
          />
        ))}

        {/* Panneau supérieur — flush avec la structure, arêtes franches */}
        <mesh position={[0, ISLAND_HEIGHT + 0.005, 0]} castShadow receiveShadow material={shelfMaterial} geometry={SHARED_TOP_PANEL_GEOM} />
      </group>
    </group>
  )
}
