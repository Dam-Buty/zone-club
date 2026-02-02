import { useMemo, useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

interface GenreSectionPanelProps {
  genre: string
  position: [number, number, number]
  rotation?: [number, number, number]
  color: string
  width?: number
  hanging?: boolean // Si true, panneau suspendu avec chaînes
}

// Créer une texture de texte via Canvas 2D (WebGPU compatible)
function createGenreTexture(
  text: string,
  color: string,
  width: number = 512,
  height: number = 128
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  // Fond noir avec bordure colorée
  ctx.fillStyle = '#0a0a0f'
  ctx.fillRect(0, 0, width, height)

  // Bordure lumineuse
  ctx.strokeStyle = color
  ctx.lineWidth = 4
  ctx.shadowColor = color
  ctx.shadowBlur = 15
  ctx.strokeRect(4, 4, width - 8, height - 8)

  // Deuxième bordure intérieure
  ctx.shadowBlur = 8
  ctx.lineWidth = 2
  ctx.strokeRect(12, 12, width - 24, height - 24)

  // Texte principal
  const fontSize = Math.floor(height * 0.5)
  ctx.font = `bold ${fontSize}px "Impact", "Arial Black", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Glow du texte
  ctx.shadowColor = color
  ctx.shadowBlur = 20
  ctx.fillStyle = color
  ctx.fillText(text, width / 2, height / 2)

  // Texte blanc par-dessus pour le core
  ctx.shadowBlur = 10
  ctx.fillStyle = '#ffffff'
  ctx.fillText(text, width / 2, height / 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true

  return texture
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
  const timeRef = useRef(0)

  const texture = useMemo(() => {
    return createGenreTexture(genre.toUpperCase(), color)
  }, [genre, color])

  useEffect(() => {
    return () => texture.dispose()
  }, [texture])

  // Légère animation de balancement pour les panneaux suspendus
  useFrame((_, delta) => {
    if (hanging && groupRef.current) {
      timeRef.current += delta
      groupRef.current.rotation.z = Math.sin(timeRef.current * 0.5) * 0.02
    }
  })

  const height = width * 0.25
  const depth = 0.02

  return (
    <group position={position} rotation={rotation}>
      {/* Point d'ancrage pour le balancement */}
      <group ref={groupRef}>
        {/* Chaînes de suspension */}
        {hanging && (
          <>
            {/* Chaîne gauche */}
            <mesh position={[-width * 0.35, height * 0.7, 0]}>
              <cylinderGeometry args={[0.008, 0.008, height * 0.5, 6]} />
              <meshStandardMaterial color="#666666" metalness={0.8} roughness={0.3} />
            </mesh>
            {/* Chaîne droite */}
            <mesh position={[width * 0.35, height * 0.7, 0]}>
              <cylinderGeometry args={[0.008, 0.008, height * 0.5, 6]} />
              <meshStandardMaterial color="#666666" metalness={0.8} roughness={0.3} />
            </mesh>
            {/* Barre de support au plafond */}
            <mesh position={[0, height * 0.95, 0]}>
              <boxGeometry args={[width * 0.8, 0.02, 0.02]} />
              <meshStandardMaterial color="#333333" metalness={0.7} roughness={0.4} />
            </mesh>
          </>
        )}

        {/* Cadre du panneau */}
        <mesh position={[0, 0, -depth / 2]}>
          <boxGeometry args={[width + 0.04, height + 0.04, depth]} />
          <meshStandardMaterial color="#1a1a1a" roughness={0.8} />
        </mesh>

        {/* Panneau principal avec texture */}
        <mesh position={[0, 0, 0.001]}>
          <planeGeometry args={[width, height]} />
          <meshStandardMaterial
            map={texture}
            emissive={color}
            emissiveIntensity={0.3}
            toneMapped={false}
          />
        </mesh>

        {/* Lumière du panneau */}
        <pointLight
          position={[0, 0, 0.3]}
          color={color}
          intensity={0.3}
          distance={2}
          decay={2}
        />

        {/* Reflets métalliques sur les coins */}
        {[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([x, y], i) => (
          <mesh
            key={`corner-${i}`}
            position={[x * width * 0.48, y * height * 0.45, depth / 2 + 0.005]}
          >
            <cylinderGeometry args={[0.02, 0.02, 0.01, 8]} rotation={[Math.PI / 2, 0, 0]} />
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
    altIds: [53], // Thriller aussi
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
