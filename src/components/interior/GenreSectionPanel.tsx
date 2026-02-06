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
function createGlowTexture(
  color: string,
  width: number = 256,
  height: number = 64
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  const gradient = ctx.createRadialGradient(
    width / 2, height / 2, 0,
    width / 2, height / 2, Math.max(width, height) / 2
  )
  gradient.addColorStop(0, color + '88')
  gradient.addColorStop(0.3, color + '44')
  gradient.addColorStop(0.7, color + '10')
  gradient.addColorStop(1, '#00000000')

  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true

  return texture
}

// Géométrie cylindre partagée pour les tubes du cadre néon
const BORDER_TUBE_GEOM = new THREE.CylinderGeometry(0.006, 0.006, 1, 5)

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
        {/* Chaînes de suspension */}
        {hanging && (
          <>
            <mesh position={[-width * 0.35, height * 0.7, 0]}>
              <cylinderGeometry args={[0.008, 0.008, height * 0.5, 4]} />
              <meshStandardMaterial color="#666666" metalness={0.8} roughness={0.3} />
            </mesh>
            <mesh position={[width * 0.35, height * 0.7, 0]}>
              <cylinderGeometry args={[0.008, 0.008, height * 0.5, 4]} />
              <meshStandardMaterial color="#666666" metalness={0.8} roughness={0.3} />
            </mesh>
            <mesh position={[0, height * 0.95, 0]}>
              <boxGeometry args={[width * 0.8, 0.02, 0.02]} />
              <meshStandardMaterial color="#333333" metalness={0.7} roughness={0.4} />
            </mesh>
          </>
        )}

        {/* Halo diffus derrière le panneau */}
        <mesh position={[0, 0, -0.03]}>
          <planeGeometry args={[width * 1.3, height * 1.8]} />
          <meshBasicMaterial
            map={glowTexture}
            transparent
            opacity={0.4}
            toneMapped={false}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>

        {/* Cadre du panneau - plastique noir mat */}
        <mesh position={[0, 0, -depth / 2]}>
          <boxGeometry args={[width + 0.04, height + 0.04, depth]} />
          <meshStandardMaterial color="#0a0a0a" roughness={0.9} metalness={0.0} />
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

        {/* Fixations métalliques aux coins */}
        {[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([x, y], i) => (
          <mesh
            key={`corner-${i}`}
            position={[x * width * 0.48, y * height * 0.45, depth / 2 + 0.005]}
          >
            <cylinderGeometry args={[0.02, 0.02, 0.01, 5]} rotation={[Math.PI / 2, 0, 0]} />
            <meshStandardMaterial color="#888888" metalness={0.9} roughness={0.2} />
          </mesh>
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
  const validIds = [config.id, ...config.altIds]

  return films.filter(film =>
    film.genres.some(g => validIds.includes(g.id as number))
  )
}
