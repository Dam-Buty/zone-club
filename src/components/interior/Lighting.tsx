import { useRef, useEffect } from 'react'
import * as THREE from 'three/webgpu'
import { color as tslColor, float } from 'three/tsl'

// 3 ceiling tube RectAreaLights — 1 per aisle, centered above walkways
// Small area (0.12×1.4m) = focused light = no cosine-falloff two-tone
// Ceiling tubes: wall-aisle tubes at full intensity, center tubes reduced
// to prevent poster burn on island shelves (islands at X=-2.1 and X=0.15
// receive light from all directions — center tubes are the main culprit).
const CEILING_LIGHTS: { pos: [number, number, number]; intensity: number }[] = [
  { pos: [-3.3, 2.7, 0], intensity: 4.0 },  // left wall aisle — full
  { pos: [-1.0, 2.7, 0], intensity: 2.5 },  // center-left (near island 1) — reduced
  { pos: [ 2.3, 2.7, 0], intensity: 2.5 },  // center-right (near island 2) — reduced
  { pos: [ 3.8, 2.7, 0], intensity: 4.0 },  // right wall / counter — full
]

function CeilingTubeLights() {
  return (
    <>
      {CEILING_LIGHTS.map(({ pos: [x, y, z], intensity }, i) => (
        <rectAreaLight
          key={`ceiling-tube-${i}`}
          position={[x, y - 0.02, z]}
          rotation={[-Math.PI / 2, 0, 0]}
          width={0.4}
          height={7.0}
          intensity={intensity}
          color="#f0f5ff"
        />
      ))}
    </>
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
// Static emissive via TSL (WebGPU)
SHARED_NEON_TUBE_MAT.emissiveNode = tslColor('#fff5e6').mul(float(3.0))
const SHARED_NEON_FIXTURE_MAT = new THREE.MeshStandardMaterial({
  color: '#666666',
  roughness: 0.5,
  metalness: 0.3,
})

// 16 neon tubes — 4 columns × 4 Z rows
// Columns: left wall=-3.3, center-left=-1.0, center-right=2.3, right wall=3.8
const NEON_POSITIONS: [number, number, number][] = [
  [-3.3, 2.7, -3.0], [-1.0, 2.7, -3.0], [2.3, 2.7, -3.0], [3.8, 2.7, -3.0],
  [-3.3, 2.7, -1.0], [-1.0, 2.7, -1.0], [2.3, 2.7, -1.0], [3.8, 2.7, -1.0],
  [-3.3, 2.7,  1.5], [-1.0, 2.7,  1.5], [2.3, 2.7,  1.5], [3.8, 2.7,  1.5],
  [-3.3, 2.7,  3.0], [-1.0, 2.7,  3.0], [2.3, 2.7,  3.0], [3.8, 2.7,  3.0],
]

const _tempMatrix = new THREE.Matrix4()
const _tubeRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0))

// 9 NeonTubes → 2 InstancedMesh (tube + fixture) = 2 draw calls
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

// Architecture: main branch base lighting (no two-tone) + vitrine cold light
function OptimizedLighting({ isMobile = false }: { isMobile?: boolean }) {
  const shadowMapSize = isMobile ? 256 : 1024
  const dirLightRef = useRef<THREE.DirectionalLight>(null!)

  // SHADOW CACHING: scène statique → render shadow map ONCE then freeze
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
      {/* Hemisphere ambient fill */}
      <hemisphereLight
        color="#fff8f0"
        groundColor="#8a8078"
        intensity={isMobile ? 0.5 : 0.28}
      />

      {/* Desktop-only per-fragment lights */}
      {!isMobile && (
        <>
          {/* 3 ceiling tube RectAreaLights (small 0.12×1.4m) */}
          <CeilingTubeLights />

          {/* Comptoir tube — aligned on neon [3, 2.7, 3] */}
          <rectAreaLight
            position={[3, 2.68, 3]}
            rotation={[-Math.PI / 2, 0, 0]}
            width={0.12}
            height={1.4}
            intensity={8.0}
            color="#fff5e6"
          />

          {/* Left aisle fill — illuminates left island faces + left wall K7s */}
          <pointLight
            position={[-3.0, 1.5, 0]}
            intensity={0.8}
            color="#fff5e6"
            distance={4}
            decay={2}
            castShadow={false}
          />

          {/* Center aisle fill — illuminates right face of island 1 + left face of island 2 */}
          <pointLight
            position={[-1.0, 1.5, 0]}
            intensity={0.7}
            color="#fff5e6"
            distance={4}
            decay={2}
            castShadow={false}
          />

          {/* Right aisle fill — illuminates right face of island 2 */}
          <pointLight
            position={[2.3, 1.5, 0]}
            intensity={0.7}
            color="#fff5e6"
            distance={4}
            decay={2}
            castShadow={false}
          />

          {/* Vitrine cold light — faces backward toward street (rotation PI = -Z) */}
          <rectAreaLight
            position={[0.5, 1.4, 4.15]}
            rotation={[0, Math.PI, 0]}
            width={5.0}
            height={2.2}
            intensity={1.0}
            color="#5577aa"
          />

          {/* Ceiling bounce — single upward fill for ceiling illumination */}
          <rectAreaLight position={[0, 0.1, 0]} rotation={[Math.PI / 2, 0, 0]} width={3.0} height={2.5} intensity={0.80} color="#e8ddd0" />

          {/* Comptoir overhead — single warm work light above counter area */}
          <rectAreaLight position={[2.8, 2.1, 2.5]} rotation={[-Math.PI / 2, 0, 0]} width={3.0} height={2.0} intensity={1.0} color="#ffd8b0" />

          {/* Genre panel lights — colored wash from neon panels onto nearby shelves */}
          {/* PointLights at Y=1.55 (upper-mid shelf), large radius, even color wash */}
          {[
            // Left wall
            { p: [-3.8, 1.86, -2.67], c: '#66cc88' },  // Horreur
            { p: [-3.8, 1.86, -1.02], c: '#cc66aa' },  // Bizarre
            { p: [-3.8, 1.86,  0.51], c: '#7abbd4' },  // Policier
            { p: [-3.8, 1.86,  2.07], c: '#cc8844' },  // Thriller
            // Back wall
            { p: [-3.16, 1.86, -3.55], c: '#cc7766' },  // Action
            { p: [-1.35, 1.86, -3.55], c: '#ccaa66' },  // Aventure
            { p: [ 0.60, 1.86, -3.55], c: '#ccaa66' },  // Anim & Cie
            { p: [ 1.91, 1.86, -3.55], c: '#9977cc' },  // Drame
            // Right wall
            { p: [ 3.8, 1.86, -2.53], c: '#cccc77' },  // Comédie
            { p: [ 3.8, 1.86, -0.47], c: '#cc8899' },  // Romance
          ].map((h, i) => (
            <pointLight
              key={`genre-${i}`}
              position={h.p as [number, number, number]}
              color={h.c}
              intensity={0.35}
              distance={2.5}
              decay={1.0}
              castShadow={false}
            />
          ))}

          {/* CRT ambient — cold blue glow from TV screen */}
          <pointLight
            position={[4.225, 0.85, 1.35]}
            color="#445566"
            intensity={0.3}
            distance={2.0}
            decay={2.0}
            castShadow={false}
          />

          {/* Private door lift — faces backward into back wall */}
          <group position={[2.9, 2.18, -4.02]} rotation={[0, Math.PI, 0]}>
            <rectAreaLight
              width={2.2}
              height={0.82}
              intensity={0.42}
              color="#f4efe6"
            />
          </group>
        </>
      )}

      {/* Angled DirectionalLight — 42° from vertical, illuminates tops AND sides */}
      <directionalLight
        ref={dirLightRef}
        position={[2, 4, 5]}
        intensity={1.4}
        color="#f0f5ff"
        castShadow
        shadow-mapSize-width={shadowMapSize}
        shadow-mapSize-height={shadowMapSize}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
        shadow-camera-near={0.1}
        shadow-camera-far={12}
        shadow-bias={-0.0003}
      />

      {/* 9 emissive neon tubes (glow via bloom) */}
      <NeonTubesInstanced />
    </>
  )
}

export function Lighting({ isMobile = false }: { isMobile?: boolean }) {
  return <OptimizedLighting isMobile={isMobile} />
}
