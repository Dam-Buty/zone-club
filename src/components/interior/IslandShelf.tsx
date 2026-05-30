import { useMemo, useEffect } from 'react'
import * as THREE from 'three/webgpu'
import { positionWorld, normalWorld, clamp, vec3, varying, float } from 'three/tsl'
import { CASSETTE_DIMENSIONS } from './cassette-constants'
import { useProbeVolumes } from './ProbeVolumeContext'
import { shIrradiance } from '../../lib/lightbake/shReconstruct'
import { GRID_MIN, gridExt, G } from '../../lib/lightbake/probeGrid'

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
// Phase-2 probe irradiance multiplier (same ?pi knob as the K7, calibrated at M2). Mirrors
// CassetteInstances.tsx / WallShelf.tsx PROBE_INTENSITY.
const PROBE_INTENSITY = (() => {
  if (typeof window === 'undefined') return 1.2
  const p = parseFloat(new URLSearchParams(window.location.search).get('pi') || '1.2')
  return Number.isFinite(p) ? p : 1.2
})()
// Constant wood albedo (linear) for the baked-GI emissive term (SH-L1 is low-frequency).
const SHELF_ALBEDO_LINEAR = new THREE.Color(SHELF_COLOR).convertSRGBToLinear()
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
  const probes = useProbeVolumes() // Phase-2 SH-L1 volumes (present only in ?baked=1 after the bake)

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

  const shelfMaterial = useMemo(() => {
    const mat = new THREE.MeshStandardNodeMaterial({
      map: shelfMap,
      color: SHELF_COLOR,
      roughness: 0.15,
      metalness: METALNESS,
      envMapIntensity: 0.50,
    })
    // Phase-2 baked GI: emissive-ADD SH-L1 irradiance at the surface world position/normal
    // (same rationale as the K7, T8 — baked mode drops the rig). positionWorld covers the
    // individual plank meshes; varying() keeps the SH eval in the vertex stage.
    if (probes) {
      const e = gridExt()
      const gMin = vec3(GRID_MIN[0], GRID_MIN[1], GRID_MIN[2])
      const gInv = vec3(1 / e[0], 1 / e[1], 1 / e[2])
      const half = vec3(0.5 / G[0], 0.5 / G[1], 0.5 / G[2])
      const uvw = clamp(positionWorld.sub(gMin).mul(gInv), half, vec3(1).sub(half))
      const E = varying(shIrradiance(probes.shR, probes.shG, probes.shB, uvw, normalWorld))
      const albedo = vec3(SHELF_ALBEDO_LINEAR.r, SHELF_ALBEDO_LINEAR.g, SHELF_ALBEDO_LINEAR.b)
      mat.emissiveNode = albedo.mul(E).mul(float(PROBE_INTENSITY))
    }
    return mat
  }, [shelfMap, probes])

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
