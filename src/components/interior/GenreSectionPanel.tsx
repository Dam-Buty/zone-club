import { useMemo, useEffect, useRef, memo } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import * as THREE from 'three'
import { Text3D, Center } from '@react-three/drei'
import { TTFLoader } from 'three/examples/jsm/loaders/TTFLoader.js'
import type { FontData } from '@react-three/drei'

// OPTIMISATION: Consolidated animation registry — 7 useFrame → 1 useFrame
// Each GenreSectionPanel registers its refs here; GenrePanelAnimator iterates once per frame.
interface PanelAnimEntry {
  groupRef: React.RefObject<THREE.Group | null>
  neonRef: React.RefObject<THREE.Mesh | null>
  borderMatRef: React.MutableRefObject<THREE.MeshStandardMaterial | null>
  neonIntensity: number
  timeRef: React.MutableRefObject<number>
}
const panelRegistry = new Map<string, PanelAnimEntry>()

export function GenrePanelAnimator() {
  useFrame((_, delta) => {
    panelRegistry.forEach((entry) => {
      entry.timeRef.current += delta

      // No flicker — static emissive avoids SSGI temporal noise
      if (entry.neonRef.current) {
        const mat = entry.neonRef.current.material as THREE.MeshStandardMaterial
        mat.emissiveIntensity = entry.neonIntensity
      }

      if (entry.borderMatRef.current) {
        entry.borderMatRef.current.emissiveIntensity = entry.neonIntensity * BORDER_EMISSIVE_SCALE
      }
    })
  })

  return null
}

interface GenreSectionPanelProps {
  genre: string
  position: [number, number, number]
  rotation?: [number, number, number]
  color: string
  width?: number
  hanging?: boolean
  /** Multiplier for neon intensity (default 1.0). Use <1 to dim background panels. */
  intensityScale?: number
}

// OPTIMISATION: Géométries et matériaux partagés (identiques pour les 5 panneaux)
const BORDER_TUBE_GEOM = new THREE.CylinderGeometry(0.006, 0.006, 1, 14)
const CHAIN_GEOM = new THREE.CylinderGeometry(0.008, 0.008, 1, 6) // scale Y par panneau
const CORNER_GEOM = new THREE.CylinderGeometry(0.02, 0.02, 0.01, 12)
CORNER_GEOM.rotateX(Math.PI / 2)
const SHARED_CHAIN_MAT = new THREE.MeshStandardMaterial({ color: '#666666', metalness: 0.8, roughness: 0.3 })
const SHARED_BAR_MAT = new THREE.MeshStandardMaterial({ color: '#333333', metalness: 0.7, roughness: 0.4 })
const SHARED_CORNER_MAT = new THREE.MeshStandardMaterial({ color: '#888888', metalness: 0.9, roughness: 0.2 })
const SHARED_FRAME_MAT = new THREE.MeshStandardMaterial({ color: '#060606', roughness: 0.94, metalness: 0.0, envMapIntensity: 0 })
const BORDER_EMISSIVE_SCALE = 0.56

function NeonTextMesh({
  text,
  color,
  meshRef,
  intensity,
  width,
}: {
  text: string
  color: string
  meshRef: React.RefObject<THREE.Mesh | null>
  intensity: number
  width: number
}) {
  const font = useLoader(TTFLoader, '/fonts/Caveat-Bold.ttf') as unknown as FontData

  return (
    <Center>
      <Text3D
        ref={meshRef}
        font={font}
        size={width * 0.119}
        height={0.022}
        curveSegments={12}
        bevelEnabled={false}
        letterSpacing={0.02}
      >
        {text}
        <meshStandardMaterial
          color="#ffffff"
          emissive={color}
          emissiveIntensity={intensity}
          roughness={0.28}
          metalness={0.04}
          toneMapped={false}
        />
      </Text3D>
    </Center>
  )
}

export const GenreSectionPanel = memo(function GenreSectionPanel({
  genre,
  position,
  rotation = [0, 0, 0],
  color,
  width = 1.5,
  hanging = true,
  intensityScale = 1.0,
}: GenreSectionPanelProps) {
  const groupRef = useRef<THREE.Group>(null)
  const neonRef = useRef<THREE.Mesh | null>(null)
  const borderMatRef = useRef<THREE.MeshStandardMaterial>(null)
  const timeRef = useRef(0)

  // Compenser l'intensité émissive selon la luminance perceptuelle de la couleur.
  // intensityScale allows dimming background panels for depth hierarchy.
  const neonIntensity = useMemo(() => {
    const c = new THREE.Color(color)
    const luminance = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
    return THREE.MathUtils.clamp(0.70 / luminance, 0.70, 2.4) * intensityScale
  }, [color, intensityScale])

  // Matériau partagé pour les tubes du cadre
  const borderMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      emissive: new THREE.Color(color),
      emissiveIntensity: neonIntensity * BORDER_EMISSIVE_SCALE,
      toneMapped: false,
      roughness: 0.3,
    })
  }, [color, neonIntensity])

  useEffect(() => {
    borderMatRef.current = borderMaterial
    return () => {
      borderMaterial.dispose()
    }
  }, [borderMaterial])

  // Register in consolidated animation registry (7 useFrame → 1)
  const registryKey = `${genre}-${position[0]}-${position[1]}-${position[2]}`
  useEffect(() => {
    panelRegistry.set(registryKey, {
      groupRef,
      neonRef,
      borderMatRef,
      neonIntensity,
      timeRef,
    })
    return () => { panelRegistry.delete(registryKey) }
  }, [registryKey, neonIntensity, hanging])

  const height = width * 0.25
  const depth = 0.02
  const ceilingBarY = 0.438
  const chainBottomY = height * 0.50
  const chainLength = ceilingBarY - chainBottomY
  const chainCenterY = chainBottomY + chainLength * 0.5

  // Dimensions du cadre néon
  const borderW = width * 0.92
  const borderH = height * 0.85

  return (
    <group position={position} rotation={rotation}>
      <group ref={groupRef}>
        {/* Chaînes de suspension — géométrie/matériau partagés */}
        {hanging && (
          <>
            <mesh position={[-width * 0.35, chainCenterY, 0]} geometry={CHAIN_GEOM} material={SHARED_CHAIN_MAT} scale={[1, chainLength, 1]} />
            <mesh position={[width * 0.35, chainCenterY, 0]} geometry={CHAIN_GEOM} material={SHARED_CHAIN_MAT} scale={[1, chainLength, 1]} />
            <mesh position={[0, ceilingBarY, 0]} material={SHARED_BAR_MAT}>
              <boxGeometry args={[width * 0.8, 0.02, 0.02]} />
            </mesh>
          </>
        )}

        {/* PointLight retiré — 7 panel lights = 54% du coût per-fragment.
            L'émissive + bloom suffit pour l'effet néon. Gain: ~5-10 FPS sur M1 Air */}

        {/* Cadre du panneau - plastique noir mat (matériau partagé) */}
        <mesh position={[0, 0, -depth / 2]} material={SHARED_FRAME_MAT} castShadow>
          <boxGeometry args={[width + 0.04, height + 0.04, depth]} />
        </mesh>

        {/* Texte néon */}
        <group position={[0, 0, depth / 2 + 0.005]}>
          <NeonTextMesh
            text={genre}
            color={color}
            meshRef={neonRef}
            intensity={neonIntensity}
            width={width}
          />
        </group>

        {/* Cadre néon — tubes cylindriques formant un rectangle */}
        {/* Tube haut */}
        <mesh
          geometry={BORDER_TUBE_GEOM}
          material={borderMaterial}
          position={[0, borderH / 2, depth / 2 + 0.006]}
          rotation={[0, 0, Math.PI / 2]}
          scale={[1, borderW, 1]}
        />
        {/* Tube bas */}
        <mesh
          geometry={BORDER_TUBE_GEOM}
          material={borderMaterial}
          position={[0, -borderH / 2, depth / 2 + 0.006]}
          rotation={[0, 0, Math.PI / 2]}
          scale={[1, borderW, 1]}
        />
        {/* Tube gauche */}
        <mesh
          geometry={BORDER_TUBE_GEOM}
          material={borderMaterial}
          position={[-borderW / 2, 0, depth / 2 + 0.006]}
          scale={[1, borderH, 1]}
        />
        {/* Tube droit */}
        <mesh
          geometry={BORDER_TUBE_GEOM}
          material={borderMaterial}
          position={[borderW / 2, 0, depth / 2 + 0.006]}
          scale={[1, borderH, 1]}
        />

        {/* Fixations métalliques aux coins (géométrie + matériau partagés) */}
        {[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([x, y], i) => (
          <mesh
            key={`corner-${i}`}
            position={[x * width * 0.48, y * height * 0.45, depth / 2 + 0.005]}
            geometry={CORNER_GEOM}
            material={SHARED_CORNER_MAT}
          />
        ))}
      </group>
    </group>
  )
})

// Configuration des genres avec leurs couleurs
export const GENRE_CONFIG = {
  horreur: {
    id: 27,
    color: '#00ff00', // Vert slime/zombie
    altIds: [],
  },
  thriller: {
    id: 53,
    color: '#ff6600', // Orange suspense
    altIds: [9648, 80], // Mystery, Crime (includes policier)
  },
  policier: {
    id: 80,
    color: '#4fc3f7', // Bleu acier enquête
    altIds: [9648],
  },
  action: {
    id: 28,
    color: '#ff4444', // Rouge explosif
    altIds: [12, 10752], // Adventure, War
  },
  aventure: {
    id: 12,
    color: '#ff9f1c', // Orange aventurier
    altIds: [],
  },
  comedie: {
    id: 35,
    color: '#ffff00', // Jaune joyeux
    altIds: [],
  },
  drame: {
    id: 18,
    color: '#8844ff', // Violet dramatique
    altIds: [10749], // Romance
  },
  sf: {
    id: 878,
    color: '#00ccff', // Bleu néon sci-fi
    altIds: [14], // Fantasy
  },
  classiques: {
    id: 18,
    color: '#d4af37', // Or classique
    altIds: [36, 10752], // History, War
  },
  bizarre: {
    id: 27,
    color: '#ff00ff', // Magenta cult
    altIds: [53, 9648, 878], // Thriller, Mystery, SF — films multi-genre niche
  },
  animation: {
    id: 16,
    color: '#ff8800', // Orange cartoon
    altIds: [10751], // Family
  },
  romance: {
    id: 10749,
    color: '#ff5c8a', // Rose sentimental
    altIds: [],
  },
} as const

export type GenreKey = keyof typeof GENRE_CONFIG

// Fonction utilitaire pour filtrer les films par genre
export function filterFilmsByGenre<T extends { genres: { id: number }[] }>(
  films: T[],
  genreKey: GenreKey
): T[] {
  const config = GENRE_CONFIG[genreKey]
  const validIds: number[] = [config.id, ...config.altIds]

  return films.filter(film =>
    film.genres.some(g => validIds.includes(g.id))
  )
}
