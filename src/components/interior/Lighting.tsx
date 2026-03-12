import { useRef, useEffect } from 'react'
import * as THREE from 'three/webgpu'
import { color as tslColor, float } from 'three/tsl'

interface CeilingLightConfig {
  position: [number, number, number]
  width: number
  height: number
  intensity: number
}

// Three long ceiling runs align with the visible neon tubes so floor reflections
// read in the same direction as the practical fixtures.
const CEILING_LIGHT_CONFIGS: CeilingLightConfig[] = [
  { position: [-2.57, 2.68, 0.0], width: 0.18, height: 6.95, intensity: 2.8 },
  { position: [0.08, 2.68, 0.0], width: 0.18, height: 7.1, intensity: 3.2 },
  { position: [2.63, 2.68, 0.0], width: 0.18, height: 6.95, intensity: 2.8 },
]

function CeilingTubeLights() {
  return (
    <>
      {CEILING_LIGHT_CONFIGS.map((config, i) => (
        <rectAreaLight
          key={`ceiling-tube-${i}`}
          position={config.position}
          rotation={[-Math.PI / 2, 0, 0]}
          width={config.width}
          height={config.height}
          intensity={config.intensity}
          color="#ffe4c4"
        />
      ))}
    </>
  )
}

function VitrineColdLight() {
  return (
    <rectAreaLight
      position={[0.5, 1.4, 4.15]}
      rotation={[0, Math.PI, 0]}
      width={5.0}
      height={2.2}
      intensity={1.8}
      color="#5577aa"
    />
  )
}

function IslandTopKiss() {
  return (
    <>
      <rectAreaLight
        position={[-1.38, 1.92, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        width={3.25}
        height={0.18}
        intensity={0.77}
        color="#fff3e5"
      />
      <rectAreaLight
        position={[1.02, 1.92, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        width={3.05}
        height={0.18}
        intensity={0.70}
        color="#edf6ff"
      />
    </>
  )
}

// Shelf grazers — thin RectAreaLights near shelf tops, angled slightly downward
// to "caress" VHS cassette faces for readability (retail merchandising technique)
function ShelfGrazers() {
  return (
    <>
      {/* Back wall grazer (Action + Drame shelves) — facing +Z, tilted ~20° down */}
      <rectAreaLight
        position={[0, 1.95, -3.95]}
        rotation={[-(20 * Math.PI / 180), 0, 0]}
        width={4.0}
        height={0.16}
        intensity={0.85}
        color="#ffefdd"
      />
      {/* Left wall grazer (Horreur + Thriller shelves) — facing +X, tilted ~20° down */}
      <rectAreaLight
        position={[-4.2, 1.95, -0.2]}
        rotation={[-(20 * Math.PI / 180), Math.PI / 2, 0]}
        width={4.5}
        height={0.16}
        intensity={0.85}
        color="#ffefdd"
      />
      {/* Right wall grazer (Comédie shelves) — facing -X, tilted ~20° down */}
      <rectAreaLight
        position={[4.2, 1.95, -1.5]}
        rotation={[-(20 * Math.PI / 180), -Math.PI / 2, 0]}
        width={3.8}
        height={0.16}
        intensity={0.75}
        color="#ffefdd"
      />
    </>
  )
}

// Island side fills — low-intensity RectAreaLights at mid-height facing the K7 faces
function IslandSideFills() {
  return (
    <>
      {/* Island 1 (Nouveautés X=-2.1): left face fill */}
      <rectAreaLight
        position={[-2.70, 0.9, 0]}
        rotation={[0, Math.PI / 2, 0]}
        width={3.2}
        height={0.8}
        intensity={0.42}
        color="#fff5ea"
      />
      {/* Island 1: right face fill (inner aisle — reduced to avoid wash-out) */}
      <rectAreaLight
        position={[-1.50, 0.9, 0]}
        rotation={[0, -Math.PI / 2, 0]}
        width={3.2}
        height={0.8}
        intensity={0.22}
        color="#fff5ea"
      />
      {/* Island 2 (SF/Classiques X=0.15): left face fill (inner aisle — reduced) */}
      <rectAreaLight
        position={[-0.45, 0.9, 0]}
        rotation={[0, Math.PI / 2, 0]}
        width={3.2}
        height={0.8}
        intensity={0.22}
        color="#fff5ea"
      />
      {/* Island 2: right face fill */}
      <rectAreaLight
        position={[0.75, 0.9, 0]}
        rotation={[0, -Math.PI / 2, 0]}
        width={3.2}
        height={0.8}
        intensity={0.35}
        color="#fff5ea"
      />
    </>
  )
}

// Comptoir overhead — warm work light above the manager's counter
function ComptoirLight() {
  return (
    <>
      {/* Comptoir + manager area */}
      <rectAreaLight
        position={[2.2, 2.1, 3.0]}
        rotation={[-Math.PI / 2, 0, 0]}
        width={3.0}
        height={1.2}
        intensity={1.2}
        color="#ffd8b0"
      />
      {/* TV + couch area fill */}
      <rectAreaLight
        position={[3.5, 2.1, 1.5]}
        rotation={[-Math.PI / 2, 0, 0]}
        width={2.0}
        height={1.5}
        intensity={0.7}
        color="#ffe8d0"
      />
    </>
  )
}

function PrivateDoorLift() {
  return (
    <group position={[2.9, 2.18, -4.02]} rotation={[0, Math.PI, 0]}>
      <rectAreaLight
        width={2.2}
        height={0.82}
        intensity={0.42}
        color="#f4efe6"
      />
    </group>
  )
}

// OPTIMISATION: Géométries et matériaux partagés pour les 9 NeonTubes
const NEON_TUBE_LENGTH = 1.4
const SHARED_NEON_TUBE_GEOM = new THREE.CylinderGeometry(0.025, 0.025, NEON_TUBE_LENGTH, 6)
const SHARED_NEON_FIXTURE_GEOM = new THREE.BoxGeometry(0.08, 0.03, NEON_TUBE_LENGTH + 0.1)
const SHARED_NEON_TUBE_MAT = new THREE.MeshStandardNodeMaterial({
  color: '#fff5e6',
  roughness: 0.15,
  metalness: 0.05,
  toneMapped: false,
})
// Static emissive — no flicker to avoid SSGI temporal noise amplification
SHARED_NEON_TUBE_MAT.emissiveNode = tslColor('#fff5e6').mul(float(3.0))
const SHARED_NEON_FIXTURE_MAT = new THREE.MeshStandardMaterial({
  color: '#666666',
  roughness: 0.5,
  metalness: 0.3,
})

// Positions des 9 néons (grille 3×3 au plafond)
const NEON_POSITIONS: [number, number, number][] = [
  [-3, 2.7, -3], [0, 2.7, -3], [3, 2.7, -3],
  [-3, 2.7, 0],  [0, 2.7, 0],  [3, 2.7, 0],
  [-3, 2.7, 3],  [0, 2.7, 3],  [3, 2.7, 3],
]

// Matrices pré-calculées pour les tubes (rotation 90° sur Z) et fixtures (offset Y +0.04)
const _tempMatrix = new THREE.Matrix4()
const _tubeRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0))

// OPTIMISATION: 9 NeonTubes → 2 InstancedMesh (tube + fixture) = 18→2 draw calls
function NeonTubesInstanced() {
  const tubeRef = useRef<THREE.InstancedMesh>(null!)
  const fixtureRef = useRef<THREE.InstancedMesh>(null!)

  useEffect(() => {
    const tube = tubeRef.current
    const fixture = fixtureRef.current
    if (!tube || !fixture) return

    for (let i = 0; i < NEON_POSITIONS.length; i++) {
      const [x, y, z] = NEON_POSITIONS[i]

      _tempMatrix.compose(
        new THREE.Vector3(x, y, z),
        _tubeRotation,
        new THREE.Vector3(1, 1, 1)
      )
      tube.setMatrixAt(i, _tempMatrix)

      _tempMatrix.compose(
        new THREE.Vector3(x, y + 0.04, z),
        new THREE.Quaternion(),
        new THREE.Vector3(1, 1, 1)
      )
      fixture.setMatrixAt(i, _tempMatrix)
    }

    tube.instanceMatrix.needsUpdate = true
    fixture.instanceMatrix.needsUpdate = true
  }, [])

  return (
    <>
      <instancedMesh ref={tubeRef} args={[SHARED_NEON_TUBE_GEOM, SHARED_NEON_TUBE_MAT, NEON_POSITIONS.length]} />
      <instancedMesh ref={fixtureRef} args={[SHARED_NEON_FIXTURE_GEOM, SHARED_NEON_FIXTURE_MAT, NEON_POSITIONS.length]} />
    </>
  )
}

// Architecture éclairage :
// 1. IBL + hemisphere: low-cost base readability
// 2. Desktop-only practicals: full-width ceiling rows + wall bounce + aisle shaping
// 3. One cached shadow caster: contact and grounding
// 4. Emissive tube meshes + bloom: perceived neon energy
function OptimizedLighting({ isMobile = false }: { isMobile?: boolean }) {
  const shadowMapSize = isMobile ? 256 : 512
  const dirLightRef = useRef<THREE.DirectionalLight>(null!)

  // SHADOW CACHING: scène statique → on rend le shadow map UNE FOIS puis on le gèle
  useEffect(() => {
    const light = dirLightRef.current
    if (!light) return

    let frameCount = 0
    const id = requestAnimationFrame(function wait() {
      frameCount++
      if (frameCount < 3) {
        requestAnimationFrame(wait)
        return
      }
      light.shadow.needsUpdate = true
      light.shadow.autoUpdate = false
    })

    return () => cancelAnimationFrame(id)
  }, [])

  return (
    <>
      {/* COUCHE 1 : Ambiance */}
      <hemisphereLight
        color={isMobile ? '#fcf4ea' : '#f5e8d4'}
        groundColor={isMobile ? '#ae8d75' : '#5a4030'}
        intensity={isMobile ? 1.05 : 0.30}
      />

      {/* Desktop-only direct lights */}
      {!isMobile && (
        <>
          <VitrineColdLight />
          <CeilingTubeLights />
          <IslandTopKiss />
          <PrivateDoorLift />
          <ShelfGrazers />
          <IslandSideFills />
          <ComptoirLight />
          {/* Back wall wash (Étape 3: fill light de lecture) */}
          <rectAreaLight
            position={[0, 1.92, -2.72]}
            rotation={[0, 0, 0]}
            width={4.6}
            height={0.92}
            intensity={1.1}
            color="#ffe0c0"
          />
          {/* Left wall warm wash */}
          <rectAreaLight
            position={[-3.1, 1.84, 0.05]}
            rotation={[0, -Math.PI / 2, 0]}
            width={4.2}
            height={0.86}
            intensity={0.8}
            color="#ffe0c0"
          />
          {/* Right shelf wash (Étape 3: fill light de lecture) */}
          <rectAreaLight
            position={[3.0, 1.82, -0.05]}
            rotation={[0, Math.PI / 2, 0]}
            width={3.8}
            height={0.82}
            intensity={0.75}
            color="#ffe0c0"
          />

        </>
      )}

      {/* Single cached shadow caster */}
      <directionalLight
        ref={dirLightRef}
        position={[0.35, 5.8, 0.15]}
        intensity={0.70}
        color="#e0e4ee"
        castShadow
        shadow-mapSize-width={shadowMapSize * 2}
        shadow-mapSize-height={shadowMapSize * 2}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
        shadow-camera-near={0.1}
        shadow-camera-far={12}
        shadow-bias={-0.0003}
        shadow-normalBias={0.02}
      />

      {/* Emissive fixtures */}
      <NeonTubesInstanced />
    </>
  )
}

export function Lighting({ isMobile = false }: { isMobile?: boolean }) {
  return <OptimizedLighting isMobile={isMobile} />
}
