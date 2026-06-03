import { useCallback, useMemo, useEffect } from 'react'
import * as THREE from 'three/webgpu'
import { positionWorld, normalWorld, clamp, vec3, varying, float, texture } from 'three/tsl'
import { CASSETTE_DIMENSIONS } from './cassette-constants'
import { useProbeVolumes } from './ProbeVolumeContext'
import { shIrradiance, shSpecular } from '../../lib/lightbake/shReconstruct'
import { OBJ_SPEC, OBJ_GI } from './bakeDebugStore'
import { GRID_MIN, gridExt, G } from '../../lib/lightbake/probeGrid'

interface WallShelfProps {
  position: [number, number, number]
  rotation?: [number, number, number]
  length: number  // Longueur de l'étagère
  woodTextures: Record<string, THREE.Texture>
}

const ROWS = 6
const ROW_HEIGHT = CASSETTE_DIMENSIONS.height + 0.04  // Hauteur entre rangées (serré, juste au-dessus des K7)
export const SHELF_DEPTH = 0.02  // thin backing board (2cm, like real furniture)
export const WALL_SHELF_ROWS = ROWS
const PLANK_DEPTH = 0.07           // shelf planks protrude forward from back panel (-30%)
const PLANK_THICKNESS = 0.025
const TOP_PLANK_TOP_Y = 0.12 + ROWS * ROW_HEIGHT + PLANK_THICKNESS / 2
// Back panel extends 1cm above the top of the highest cassette
const CASSETTE_CLEARANCE = 0.0125 + CASSETTE_DIMENSIONS.height + 0.01  // plank gap + K7 + 1cm
export const SHELF_HEIGHT = TOP_PLANK_TOP_Y + CASSETTE_CLEARANCE
// ~10° backward lean — +10cm bottom offset vs original 5° (top goes slightly more into wall, invisible)
export const SHELF_TILT = 0.179
export const SHELF_PIVOT_Y = SHELF_HEIGHT / 2 + 0.1  // tilt pivot = shelf vertical center

// Planches chevauchent le panneau arrière de 5mm pour éliminer le vide visible
const PLANK_OVERLAP = 0.005

// Géométrie partagée pour les séparateurs — arêtes franches
const SHARED_DIVIDER_GEOM = new THREE.BoxGeometry(0.02, SHELF_HEIGHT - 0.1, 0.02)

const _tempMatrix = new THREE.Matrix4()

// Phase-2 probe irradiance multiplier (same ?pi knob as the K7, calibrated at M2). Module-level
// so the ?pi URL param is read once. Mirrors CassetteInstances.tsx PROBE_INTENSITY.
const PROBE_INTENSITY = (() => {
  if (typeof window === 'undefined') return 1.2
  const p = parseFloat(new URLSearchParams(window.location.search).get('pi') || '1.2')
  return Number.isFinite(p) ? p : 1.2
})()
// Constant wood albedo (linear) for the baked-GI emissive term — the SH-L1 irradiance is
// low-frequency, so a constant albedo on this indirect term is visually indistinguishable from
// the detailed wood texture (which stays in colorNode for the residual ambient).
const SHELF_ALBEDO_LINEAR = new THREE.Color('#a07850').convertSRGBToLinear()

// wallShelfMaterial imported from IslandShelf.tsx

export function WallShelf({
  position,
  rotation = [0, 0, 0],
  length,
  woodTextures,
}: WallShelfProps) {
  const dividerCount = Math.floor(length / 1) + 1
  const probes = useProbeVolumes() // Phase-2 SH-L1 volumes (present only in ?baked=1 after the bake)

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

  const shelfNormalMap = useMemo(() => {
    if (!woodTextures.normalMap) return null
    const nmap = (woodTextures.normalMap as THREE.Texture).clone()
    nmap.wrapS = THREE.RepeatWrapping
    nmap.wrapT = THREE.RepeatWrapping
    nmap.repeat.set(Math.max(length / 0.55, 1), Math.max(SHELF_HEIGHT / 0.28, 1))
    nmap.needsUpdate = true
    return nmap
  }, [woodTextures, length])

  const shelfRoughnessMap = useMemo(() => {
    if (!woodTextures.roughnessMap) return null
    const rmap = (woodTextures.roughnessMap as THREE.Texture).clone()
    rmap.wrapS = THREE.RepeatWrapping
    rmap.wrapT = THREE.RepeatWrapping
    rmap.repeat.set(Math.max(length / 0.55, 1), Math.max(SHELF_HEIGHT / 0.28, 1))
    rmap.needsUpdate = true
    return rmap
  }, [woodTextures, length])

  const shelfMaterial = useMemo(() => {
    const mat = new THREE.MeshStandardNodeMaterial({
      map: shelfMap,
      normalMap: shelfNormalMap,
      roughnessMap: shelfRoughnessMap,
      color: '#a07850',
      roughness: 0.55,
      metalness: 0.0,
      envMapIntensity: 0.25,
      normalScale: new THREE.Vector2(0.9, 0.9),
    })
    // Phase-2 baked GI: sample the SH-L1 probe volume at each surface's WORLD position
    // (positionWorld applies the instance matrix for the instanced planks/dividers too) and
    // reconstruct irradiance for the world normal. emissive-ADD — baked mode drops the analytical
    // rig, so the wood would otherwise read near-black (same rationale as the K7, T8). varying()
    // forces the SH eval into the vertex stage (per-vertex sampling, then interpolated).
    if (probes) {
      const e = gridExt()
      const gMin = vec3(GRID_MIN[0], GRID_MIN[1], GRID_MIN[2])
      const gInv = vec3(1 / e[0], 1 / e[1], 1 / e[2])
      const half = vec3(0.5 / G[0], 0.5 / G[1], 0.5 / G[2])
      const uvw = clamp(positionWorld.sub(gMin).mul(gInv), half, vec3(1).sub(half))
      const E = varying(shIrradiance(probes.shR, probes.shG, probes.shB, uvw, normalWorld))
      // Sample the wood MAP × the linear tint = the true base albedo, so the baked-GI emissive carries
      // the wood GRAIN. Baked mode has no analytical light → the emissive is the ONLY thing on screen,
      // so a flat colour here = a grainless plank ("les meubles K7 ont perdu leurs textures").
      const albedo = texture(shelfMap).mul(vec3(SHELF_ALBEDO_LINEAR.r, SHELF_ALBEDO_LINEAR.g, SHELF_ALBEDO_LINEAR.b))
      // + baked "catch the neon" specular (semi-varnished wood → broad lobe) so the planks read as lit
      mat.emissiveNode = albedo.mul(E).mul(float(PROBE_INTENSITY)).mul(OBJ_GI).add(shSpecular(probes.shR, probes.shG, probes.shB, uvw, normalWorld, 7).mul(OBJ_SPEC))
    }
    return mat
  }, [shelfMap, shelfNormalMap, shelfRoughnessMap, probes])

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
      shelfNormalMap?.dispose()
      shelfRoughnessMap?.dispose()
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
