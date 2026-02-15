import { useMemo, useEffect, useRef, Suspense } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Text3D, Center } from '@react-three/drei'

const NEON_FONT_URL = '/fonts/caveat-bold.typeface.json'

interface GenreSectionPanelProps {
  genre: string
  position: [number, number, number]
  rotation?: [number, number, number]
  color: string
  width?: number
  hanging?: boolean
}

// Texture de halo diffus (glow derrière le panneau)
// Large canvas with very gradual falloff to avoid hard rectangular edges
function createGlowTexture(
  color: string,
  width: number = 512,
  height: number = 256
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  const gradient = ctx.createRadialGradient(
    width / 2, height / 2, 0,
    width / 2, height / 2, Math.max(width, height) / 2
  )
  // Very soft falloff — bright core quickly fades to near-zero
  gradient.addColorStop(0, color + '66')
  gradient.addColorStop(0.15, color + '33')
  gradient.addColorStop(0.35, color + '18')
  gradient.addColorStop(0.6, color + '08')
  gradient.addColorStop(0.85, color + '02')
  gradient.addColorStop(1, '#00000000')

  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true

  return texture
}

// OPTIMISATION: Géométries et matériaux partagés (identiques pour les 5 panneaux)
const BORDER_TUBE_GEOM = new THREE.CylinderGeometry(0.006, 0.006, 1, 5)
const CHAIN_GEOM = new THREE.CylinderGeometry(0.008, 0.008, 1, 4) // scale Y par panneau
const CORNER_GEOM = new THREE.CylinderGeometry(0.02, 0.02, 0.01, 5)
CORNER_GEOM.rotateX(Math.PI / 2)
const SHARED_CHAIN_MAT = new THREE.MeshStandardMaterial({ color: '#666666', metalness: 0.8, roughness: 0.3 })
const SHARED_BAR_MAT = new THREE.MeshStandardMaterial({ color: '#333333', metalness: 0.7, roughness: 0.4 })
const SHARED_CORNER_MAT = new THREE.MeshStandardMaterial({ color: '#888888', metalness: 0.9, roughness: 0.2 })
const SHARED_FRAME_MAT = new THREE.MeshStandardMaterial({ color: '#0a0a0a', roughness: 0.9, metalness: 0.0 })

// Composant interne : texte 3D néon (nécessite Suspense pour le chargement de la police)
function NeonText3D({
  text,
  color,
  meshRef,
  intensity,
}: {
  text: string
  color: string
  meshRef: React.RefObject<THREE.Mesh | null>
  intensity: number
}) {
  // Extrusion simple sans bevel — le bevel créait des artefacts (trous/découpes)
  // sur la police manuscrite Caveat dont les chemins sont trop complexes.
  // L'effet néon vient de emissive + bloom, pas de la rondeur du mesh.
  return (
    <Center>
      <Text3D
        ref={meshRef}
        font={NEON_FONT_URL}
        size={0.119}
        height={0.025}
        bevelEnabled={false}
        curveSegments={10}
        letterSpacing={0.02}
      >
        {text}
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={intensity}
          roughness={0.15}
          metalness={0.05}
          toneMapped={false}
        />
      </Text3D>
    </Center>
  )
}

export function GenreSectionPanel({
  genre,
  position,
  rotation = [0, 0, 0],
  color,
  width = 1.5,
  hanging = true,
}: GenreSectionPanelProps) {
  const groupRef = useRef<THREE.Group>(null)
  const neonRef = useRef<THREE.Mesh>(null)
  const borderMatRef = useRef<THREE.MeshStandardMaterial>(null)
  const timeRef = useRef(0)

  const glowTexture = useMemo(() => {
    return createGlowTexture(color)
  }, [color])

  // Compenser l'intensité émissive selon la luminance perceptuelle de la couleur.
  // Le bloom (threshold=0.9) utilise la luminance : les couleurs sombres (violet, rouge, magenta)
  // ne déclenchaient pas le bloom contrairement au jaune/vert.
  // On normalise pour que luminance × intensity ≈ 1.5 (au-dessus du threshold 0.9).
  const neonIntensity = useMemo(() => {
    const c = new THREE.Color(color)
    const luminance = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
    return THREE.MathUtils.clamp(1.3 / luminance, 1.3, 4.5)
  }, [color])

  // RectAreaLight intensity — compensate for perceptual luminance like emissive
  // Brighter colors (yellow) need less light intensity, darker ones (purple) need more
  const rectLightIntensity = useMemo(() => {
    const c = new THREE.Color(color)
    const luminance = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
    return THREE.MathUtils.clamp(0.6 / luminance, 0.4, 1.5)
  }, [color])

  // Matériau partagé pour les tubes du cadre
  const borderMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      emissive: new THREE.Color(color),
      emissiveIntensity: neonIntensity * 0.6,
      toneMapped: false,
      roughness: 0.3,
    })
  }, [color, neonIntensity])

  useEffect(() => {
    borderMatRef.current = borderMaterial
    return () => {
      glowTexture.dispose()
      borderMaterial.dispose()
    }
  }, [glowTexture, borderMaterial])

  // Animation : balancement + scintillement néon subtil
  useFrame((_, delta) => {
    timeRef.current += delta

    if (hanging && groupRef.current) {
      groupRef.current.rotation.z = Math.sin(timeRef.current * 0.5) * 0.02
    }

    // Scintillement néon sur le texte 3D (intensité compensée par luminance)
    if (neonRef.current) {
      const mat = neonRef.current.material as THREE.MeshStandardMaterial
      const flicker = 1.0 + Math.sin(timeRef.current * 8) * 0.03 + Math.sin(timeRef.current * 23) * 0.02
      mat.emissiveIntensity = neonIntensity * flicker
    }

    // Scintillement synchronisé sur le cadre
    if (borderMatRef.current) {
      const flicker = 1.0 + Math.sin(timeRef.current * 8) * 0.03 + Math.sin(timeRef.current * 23) * 0.02
      borderMatRef.current.emissiveIntensity = neonIntensity * 0.6 * flicker
    }
  })

  const height = width * 0.25
  const depth = 0.02

  // Dimensions du cadre néon
  const borderW = width * 0.92
  const borderH = height * 0.85

  return (
    <group position={position} rotation={rotation}>
      <group ref={groupRef}>
        {/* Chaînes de suspension — géométrie/matériau partagés */}
        {hanging && (
          <>
            <mesh position={[-width * 0.35, height * 0.7, 0]} geometry={CHAIN_GEOM} material={SHARED_CHAIN_MAT} scale={[1, height * 0.5, 1]} />
            <mesh position={[width * 0.35, height * 0.7, 0]} geometry={CHAIN_GEOM} material={SHARED_CHAIN_MAT} scale={[1, height * 0.5, 1]} />
            <mesh position={[0, height * 0.95, 0]} material={SHARED_BAR_MAT}>
              <boxGeometry args={[width * 0.8, 0.02, 0.02]} />
            </mesh>
          </>
        )}

        {/* Halo diffus derrière le panneau — oversized so the soft gradient fades fully before mesh edge */}
        <mesh position={[0, 0, -0.03]}>
          <planeGeometry args={[width * 3, height * 4]} />
          <meshBasicMaterial
            map={glowTexture}
            transparent
            opacity={0.15}
            toneMapped={false}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>

        {/* RectAreaLight — real PBR illumination on the wall behind the sign */}
        {/* Faces backward (-z in local space) toward the wall, sized to match the panel */}
        <rectAreaLight
          width={width * 0.9}
          height={height * 0.7}
          intensity={rectLightIntensity}
          color={color}
          position={[0, 0, -0.04]}
          rotation={[0, Math.PI, 0]}
        />

        {/* Cadre du panneau - plastique noir mat (matériau partagé) */}
        <mesh position={[0, 0, -depth / 2]} material={SHARED_FRAME_MAT}>
          <boxGeometry args={[width + 0.04, height + 0.04, depth]} />
        </mesh>

        {/* Texte néon 3D — tubes avec bevel arrondi */}
        <group position={[0, 0, depth / 2 + 0.005]}>
          <Suspense fallback={null}>
            <NeonText3D
              text={genre.toUpperCase()}
              color={color}
              meshRef={neonRef}
              intensity={neonIntensity}
            />
          </Suspense>
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
}

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
    altIds: [9648], // Mystery
  },
  action: {
    id: 28,
    color: '#ff4444', // Rouge explosif
    altIds: [12, 10752], // Adventure, War
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
