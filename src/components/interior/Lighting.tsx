import { useRef, useEffect } from 'react'
import * as THREE from 'three'

// Mode d'éclairage: 'full' = 21 lumières, 'optimized' = 7 lumières
const LIGHTING_MODE: 'full' | 'optimized' = 'optimized'

// --- Genre RectAreaLights (real PBR area lighting from neon panels) ---
// Desaturate neon color 40% + mix 30% warm white for realistic light spill
function computePanelLightColor(neonHex: string): string {
  const neon = new THREE.Color(neonHex)
  const hsl = { h: 0, s: 0, l: 0 }
  neon.getHSL(hsl)
  hsl.s *= 0.6
  hsl.l = Math.max(hsl.l, 0.5)
  neon.setHSL(hsl.h, hsl.s, hsl.l)
  neon.lerp(new THREE.Color('#fff5e6'), 0.3)
  return '#' + neon.getHexString()
}

interface GenreRectLightConfig {
  name: string
  position: [number, number, number]
  rotationY: number
  tiltDeg: number // downward tilt in degrees (local X)
  neonColor: string
  intensity: number
}

// Each RectAreaLight at genre neon panel position, facing INTO the room.
// Width=2.52, height=0.72. Tilt via parent group (rotationY) + child (rotationX).
// Back wall (Action/Drame) needs steeper tilt (65°) because shelves face same direction as light.
// Left/right walls get 40° — cassettes present their face to the light naturally.

const GENRE_RECT_LIGHT_CONFIGS: GenreRectLightConfig[] = [
  // Left wall (face +X into room)
  { name: 'horreur',  position: [-4.34, 1.967, -0.93], rotationY: Math.PI / 2,  tiltDeg: 40, neonColor: '#00ff00', intensity: 0.7 },
  { name: 'thriller', position: [-4.34, 1.967,  1.58], rotationY: Math.PI / 2,  tiltDeg: 40, neonColor: '#ff6600', intensity: 0.63 },
  // Back wall (face +Z into room) — steeper tilt to hit shelf tops
  { name: 'action',   position: [-2.25, 1.967, -4.17], rotationY: Math.PI,      tiltDeg: 65, neonColor: '#ff4444', intensity: 0.7 },
  { name: 'drame',    position: [ 1.25, 1.967, -4.17], rotationY: Math.PI,      tiltDeg: 65, neonColor: '#8844ff', intensity: 0.875 },
  // Right wall (face -X into room)
  { name: 'comedie',  position: [ 4.34, 1.967, -1.50], rotationY: -Math.PI / 2, tiltDeg: 40, neonColor: '#ffff00', intensity: 0.525 },
]

// Pre-compute desaturated colors
const GENRE_RECT_LIGHT_COLORS = GENRE_RECT_LIGHT_CONFIGS.map(c => computePanelLightColor(c.neonColor))

// 3 wall RectAreaLights (horreur, thriller, comedie) + 2 back wall (action, drame)
// No island lights — Nouveautés/SF/Classiques have no wall to project onto.
function GenreRectLights() {
  return (
    <>
      {GENRE_RECT_LIGHT_CONFIGS.map((config, i) => (
        <group key={config.name} position={config.position} rotation={[0, config.rotationY, 0]}>
          <rectAreaLight
            rotation={[-(config.tiltDeg * Math.PI / 180), 0, 0]}
            width={2.52}
            height={0.72}
            intensity={config.intensity}
            color={GENRE_RECT_LIGHT_COLORS[i]}
          />
        </group>
      ))}
    </>
  )
}

// OPTIMISATION: Géométries et matériaux partagés pour les 9 NeonTubes
const NEON_TUBE_LENGTH = 1.4
const SHARED_NEON_TUBE_GEOM = new THREE.CylinderGeometry(0.025, 0.025, NEON_TUBE_LENGTH, 6)
const SHARED_NEON_FIXTURE_GEOM = new THREE.BoxGeometry(NEON_TUBE_LENGTH + 0.1, 0.03, 0.08)
const SHARED_NEON_TUBE_MAT = new THREE.MeshStandardMaterial({
  color: '#fff5e6',
  emissive: new THREE.Color('#fff5e6'),
  emissiveIntensity: 2,
  roughness: 0.15,
  metalness: 0.05,
  toneMapped: false,
})
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
const _tubeRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2))

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

      // Tube: position + rotation 90° sur Z
      _tempMatrix.compose(
        new THREE.Vector3(x, y, z),
        _tubeRotation,
        new THREE.Vector3(1, 1, 1)
      )
      tube.setMatrixAt(i, _tempMatrix)

      // Fixture: position + offset Y (pas de rotation)
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

// Version OPTIMISÉE: 7 lumières au lieu de 21
function OptimizedLighting({ isMobile = false }: { isMobile?: boolean }) {
  const shadowMapSize = isMobile ? 256 : 1024

  return (
    <>
      {/* 1. Lumière ambiante - relevée pour compenser suppression storefront DirLight */}
      <ambientLight intensity={isMobile ? 0.3 : 0.22} color="#fff8f0" />

      {/* 2. Hemisphere light - éclairage naturel */}
      <hemisphereLight
        color="#fff8f0"
        groundColor="#4a4a5a"
        intensity={isMobile ? 0.5 : 0.4}
      />

      {/* Desktop-only lights */}
      {!isMobile && (
        <>
          {/* 5 RectAreaLights at genre neon positions — real PBR area lighting */}
          <GenreRectLights />

          {/* PointLight îlot central */}
          <pointLight
            position={[-0.8, 2.4, 0]}
            intensity={0.8}
            color="#fff5e6"
            distance={3}
            decay={2}
          />
        </>
      )}

      {/* DirectionalLight pour les ombres intérieures */}
      <directionalLight
        position={[2, 2.7, 1]}
        intensity={0.3}
        color="#fff5e6"
        castShadow
        shadow-mapSize-width={shadowMapSize}
        shadow-mapSize-height={shadowMapSize}
        shadow-camera-left={-5}
        shadow-camera-right={5}
        shadow-camera-top={4.5}
        shadow-camera-bottom={-4.5}
        shadow-camera-near={0.1}
        shadow-camera-far={6}
        shadow-bias={-0.0002}
      />

      {/* Tubes néon décoratifs - 9 tubes via 2 InstancedMesh (18→2 draw calls) */}
      <NeonTubesInstanced />
    </>
  )
}

// Version COMPLÈTE: 21 lumières (original)
function FullLighting() {
  return (
    <>
      {/* Lumière ambiante - augmentée pour plus de luminosité */}
      <ambientLight intensity={0.5} color="#fff8f0" />

      {/* ===== TUBES NÉON AU PLAFOND (InstancedMesh) ===== */}
      <NeonTubesInstanced />

      {/* ===== RECTAREA LIGHTS pour l'éclairage réel ===== */}

      {/* Grille 3x3 de RectAreaLights pour un éclairage uniforme */}
      {[-3, 0, 3].map((x) =>
        [-3, 0, 3].map((z) => (
          <rectAreaLight
            key={`rect-${x}-${z}`}
            width={1.2}
            height={0.15}
            intensity={8}
            color="#fff5e6"
            position={[x, 2.65, z]}
            rotation={[-Math.PI / 2, 0, 0]}
          />
        ))
      )}

      {/* ===== LUMIÈRES D'ACCENTUATION ===== */}

      {/* Lumière au-dessus du comptoir manager */}
      <pointLight
        position={[3.5, 2.4, 2.8]}
        intensity={1.5}
        color="#fff5e6"
        distance={5}
        decay={2}
      />

      {/* Lumière pour l'îlot central */}
      <pointLight
        position={[-0.8, 2.4, 0]}
        intensity={1.2}
        color="#fff5e6"
        distance={4}
        decay={2}
      />

      {/* Lumières pour les murs d'étagères */}
      <pointLight position={[-4.5, 2, 0]} intensity={0.8} color="#fff5e6" distance={4} decay={2} />
      <pointLight position={[4.5, 2, -1]} intensity={0.8} color="#fff5e6" distance={4} decay={2} />

      {/* Lumière directionnelle pour ombres douces */}
      <directionalLight
        position={[2, 8, 4]}
        intensity={0.4}
        color="#ffffff"
      />

      {/* Hemisphere light pour un éclairage naturel */}
      <hemisphereLight
        color="#fff8f0"
        groundColor="#4a4a5a"
        intensity={0.4}
      />

      {/* ===== LUMIÈRE URBAINE NOCTURNE (vitrine) ===== */}

      {/* === GRANDE VITRINE (côté GAUCHE vu de l'intérieur) === */}
      <rectAreaLight
        width={4.5}
        height={1.2}
        intensity={2}
        color="#5c6bc0"
        position={[1.0, 0.8, 4.3]}
        rotation={[0, 0, 0]}
      />

      {/* === PORTE VITRÉE (côté DROIT vu de l'intérieur) === */}
      <rectAreaLight
        width={1.2}
        height={0.4}
        intensity={5}
        color="#ff2d95"
        position={[-3.7, 2.55, 4.3]}
        rotation={[0, 0, 0]}
      />

      <rectAreaLight
        width={1.0}
        height={2.0}
        intensity={2.5}
        color="#6a4c93"
        position={[-3.7, 1.15, 4.3]}
        rotation={[0, 0, 0]}
      />

      <rectAreaLight
        width={1.0}
        height={0.4}
        intensity={1.5}
        color="#4a6fa5"
        position={[-3.7, 0.25, 4.3]}
        rotation={[0, 0, 0]}
      />

      {/* === ENSEIGNE VIDEOCLUB (au-dessus) === */}
      <rectAreaLight
        width={5}
        height={0.4}
        intensity={1.5}
        color="#9d4edd"
        position={[0.8, 2.7, 4.3]}
        rotation={[0, 0, 0]}
      />
    </>
  )
}

export function Lighting({ isMobile = false }: { isMobile?: boolean }) {
  // Toggle entre les deux modes ici
  return LIGHTING_MODE === 'optimized' ? <OptimizedLighting isMobile={isMobile} /> : <FullLighting />
}
