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
SHARED_NEON_TUBE_MAT.emissiveNode = tslColor('#fff5e6').mul(float(3.5))
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
      {/* Hemisphere ambient fill — mobile lower than before (0.65→0.45)
          because we now have directional RectAreaLights providing contrast */}
      <hemisphereLight
        color="#fff8f0"
        groundColor="#a09890"
        intensity={isMobile ? 0.55 : 0.35}
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
            intensity={3.0}
            color="#fff5e6"
          />

          {/* Island overhead lights — ceiling-level RectAreaLights above each island */}
          {/* Island 1 (Nouveautés) at X≈-2.2 */}
          <rectAreaLight
            position={[-2.2, 2.68, -0.2]}
            rotation={[-Math.PI / 2, 0, 0]}
            width={0.6}
            height={4.0}
            intensity={1.8}
            color="#f0f5ff"
          />
          {/* Island 2 (SF/Classiques) at X≈0.05 */}
          <rectAreaLight
            position={[0.05, 2.68, -0.2]}
            rotation={[-Math.PI / 2, 0, 0]}
            width={0.6}
            height={4.0}
            intensity={1.8}
            color="#f0f5ff"
          />

          {/* Left aisle island wash — faces +X toward left face of island 1 */}
          <rectAreaLight
            position={[-3.2, 1.2, 0]}
            rotation={[0, -Math.PI / 2, 0]}
            width={5.0}
            height={1.8}
            intensity={0.8}
            color="#fff5e6"
          />

          {/* Front center fill — merged from 2 close PointLights */}
          <pointLight
            position={[-0.7, 1.5, 1.5]}
            intensity={1.2}
            color="#fff5e6"
            distance={5}
            decay={2}
            castShadow={false}
          />

          {/* Right aisle fill — illuminates right face of island 2 */}
          <pointLight
            position={[2.3, 1.5, 0]}
            intensity={1.0}
            color="#fff5e6"
            distance={4}
            decay={2}
            castShadow={false}
          />

          {/* Back center fill — merged from 2 close PointLights */}
          <pointLight
            position={[-0.7, 1.5, -2.8]}
            intensity={1.0}
            color="#fff5e6"
            distance={5}
            decay={2}
            castShadow={false}
          />

          {/* Wall wash lights — positioned in aisles, facing walls to illuminate K7 front faces */}
          {/* Left wall wash — faces -X toward left wall shelves */}
          <rectAreaLight
            position={[-3.0, 1.4, 0]}
            rotation={[0, Math.PI / 2, 0]}
            width={7.0}
            height={2.0}
            intensity={0.6}
            color="#fff5e6"
          />
          {/* Back wall wash — faces +Z toward back wall shelves */}
          <rectAreaLight
            position={[0, 1.4, -3.0]}
            rotation={[0, 0, 0]}
            width={7.0}
            height={2.0}
            intensity={0.6}
            color="#fff5e6"
          />
          {/* Right wall wash — faces -X toward right wall shelves */}
          <rectAreaLight
            position={[3.0, 1.4, 0]}
            rotation={[0, -Math.PI / 2, 0]}
            width={7.0}
            height={2.0}
            intensity={0.6}
            color="#fff5e6"
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
          <rectAreaLight position={[0, 0.1, 0]} rotation={[Math.PI / 2, 0, 0]} width={3.0} height={2.5} intensity={1.40} color="#e8ddd0" />

          {/* Comptoir overhead — single warm work light above counter area */}
          <rectAreaLight position={[2.8, 2.1, 2.5]} rotation={[-Math.PI / 2, 0, 0]} width={3.0} height={2.0} intensity={1.0} color="#ffd8b0" />


          {/* Private door lift removed — budget traded for left aisle island wash */}
        </>
      )}

      {/* Mobile lighting rig — 6 RectAreaLights + 2 PointLights (Pixel 9 budget)
          ACES Filmic @ exposure 0.82 needs HDR ≥2.0 for "bright" → intensities scaled +40% vs naive values */}
      {isMobile && (
        <>
          {/* Ceiling tubes — left wall + right wall, intensity 5.0 (was 3.5)
              Cosine falloff at 2.68m height → walls receive ~30% → need high base intensity */}
          <rectAreaLight
            position={[-3.3, 2.68, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            width={0.4}
            height={7.0}
            intensity={5.0}
            color="#f0f5ff"
          />
          <rectAreaLight
            position={[3.8, 2.68, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            width={0.4}
            height={7.0}
            intensity={5.0}
            color="#f0f5ff"
          />

          {/* Ceiling bounce — intensity 1.8 (was 1.2)
              At 1.2 → sRGB ~0.25 after ACES = pitch black ceiling. 1.8 → sRGB ~0.45 = visible */}
          <rectAreaLight
            position={[0, 0.15, 0]}
            rotation={[Math.PI / 2, 0, 0]}
            width={3.0}
            height={2.5}
            intensity={1.8}
            color="#e8ddd0"
          />

          {/* Island overhead — NEW: prevents dark shelf valleys between aisles
              Desktop has 2 island lights (1.8 each); mobile uses 1 centered at 2.2 */}
          <rectAreaLight
            position={[-1.0, 2.2, -0.2]}
            rotation={[-Math.PI / 2, 0, 0]}
            width={0.8}
            height={4.0}
            intensity={2.2}
            color="#f0f5ff"
          />

          {/* Back wall wash — intensity 0.7 (was 0.5)
              Single wall wash must illuminate back wall + provide fill */}
          <rectAreaLight
            position={[0, 1.4, -3.0]}
            rotation={[0, 0, 0]}
            width={7.0}
            height={2.0}
            intensity={0.7}
            color="#fff5e6"
          />

          {/* Vitrine cold — warm/cold contrast from storefront */}
          <rectAreaLight
            position={[0.5, 1.4, 4.15]}
            rotation={[0, Math.PI, 0]}
            width={5.0}
            height={2.2}
            intensity={0.8}
            color="#5577aa"
          />

          {/* Left aisle fill — illuminates left wall K7s + left face of island 1
              Y=2.0 for broader spread across shelves top to bottom */}
          <pointLight
            position={[-2.5, 2.0, 0]}
            intensity={1.5}
            color="#fff5e6"
            distance={8}
            decay={2}
            castShadow={false}
          />
          {/* Right aisle fill — illuminates right wall K7s + right face of island 2
              Y=2.0 (higher) for broader spread, avoids wall hot spot */}
          <pointLight
            position={[1.5, 2.0, 0]}
            intensity={1.5}
            color="#fff5e6"
            distance={8}
            decay={2}
            castShadow={false}
          />
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

// Baked mode (`?baked=1`): the shell GI is in the lightmap (BakedShellLighting), so the whole
// analytical rig is dropped. We keep the emissive neon tubes (bloom) and a LOW hemisphere so the
// non-lightmapped furniture (shelves, cassettes, manager, TV — Phase-2 probe targets) isn't pitch
// black. The shell takes a touch of this fill on top of its lightMap — kept low to stay néon-noir.
function BakedRig() {
  return (
    <>
      <hemisphereLight color="#cfd6e6" groundColor="#26222b" intensity={0.1} />
      <NeonTubesInstanced />
    </>
  )
}

export function Lighting({ isMobile = false, baked = false }: { isMobile?: boolean; baked?: boolean }) {
  if (baked) return <BakedRig />
  return <OptimizedLighting isMobile={isMobile} />
}
