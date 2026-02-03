import { useRef, useMemo, memo, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Film } from '../../types'
import { useStore } from '../../store'

interface CassetteProps {
  position: [number, number, number]
  film: Film
  cassetteKey: string  // Identifiant unique pour cette cassette (position-based)
  hoverOffsetZ?: number  // Direction du hover: +0.08 pour mur (défaut), -0.08 pour îlot
}

// Dimensions d'une cassette VHS (en mètres) - augmentées de 20%
const CASSETTE_WIDTH = 0.168   // 0.14 * 1.2
const CASSETTE_HEIGHT = 0.228  // 0.19 * 1.2
const CASSETTE_DEPTH = 0.03    // 0.025 * 1.2

// Export des dimensions pour les autres composants
export const CASSETTE_DIMENSIONS = {
  width: CASSETTE_WIDTH,
  height: CASSETTE_HEIGHT,
  depth: CASSETTE_DEPTH,
}

// OPTIMISATION: Géométrie partagée par toutes les cassettes (créée une seule fois)
const SHARED_CASSETTE_GEOMETRY = new THREE.BoxGeometry(CASSETTE_WIDTH, CASSETTE_HEIGHT, CASSETTE_DEPTH)

// OPTIMISATION: Frustum et matrice réutilisables pour le culling (évite les allocations)
const frustum = new THREE.Frustum()
const projScreenMatrix = new THREE.Matrix4()
const tempWorldPos = new THREE.Vector3()

// OPTIMISATION: Compteur de frames global pour throttle des animations
let globalFrameCount = 0
let lastFrustumFrame = -1
const ANIMATION_THROTTLE = 2 // Animer tous les 2 frames

// Couleurs aléatoires pour les cassettes sans poster
const CASSETTE_COLORS = [
  '#1a1a2e', '#16213e', '#0f3460', '#533483',
  '#2c3e50', '#34495e', '#1e3d59', '#3d5a80'
]

// Couleurs émissives en format THREE.Color pour interpolation
const EMISSIVE_NONE = new THREE.Color('#000000')
const EMISSIVE_TARGETED = new THREE.Color('#ff2d95')
const EMISSIVE_RENTED = new THREE.Color('#00ff00')

export const Cassette = memo(function Cassette({ position, film, cassetteKey, hoverOffsetZ = 0.08 }: CassetteProps) {
  const targetedCassetteKey = useStore((state) => state.targetedCassetteKey)
  const getRental = useStore((state) => state.getRental)
  const isTargetedRaw = targetedCassetteKey === cassetteKey
  const isRented = !!getRental(film.id)
  const meshRef = useRef<THREE.Mesh>(null)
  const materialRef = useRef<THREE.MeshStandardMaterial>(null)
  const baseZ = position[2]

  // Hystérésis interne pour éviter le flickering aux bords
  const stableTargetedRef = useRef(false) // État stable après hystérésis
  const targetedTimerRef = useRef(0) // Timer pour confirmer le changement d'état
  const HYSTERESIS_SELECT = 0.05 // 50ms pour sélectionner (réactif)
  const HYSTERESIS_DESELECT = 0.25 // 250ms pour désélectionner (sticky)

  // État visuel lissé
  const smoothTargetedRef = useRef(0) // 0 = non ciblé, 1 = ciblé
  const currentEmissiveRef = useRef(new THREE.Color('#000000'))

  // Couleur de fallback basée sur l'ID du film
  const fallbackColor = useMemo(() => {
    return CASSETTE_COLORS[film.id % CASSETTE_COLORS.length]
  }, [film.id])

  // URL du poster TMDB
  const posterUrl = film.poster_path
    ? `https://image.tmdb.org/t/p/w200${film.poster_path}`
    : null

  // Charger la texture si disponible
  const texture = useMemo(() => {
    if (!posterUrl) return null
    const loader = new THREE.TextureLoader()
    const tex = loader.load(posterUrl)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }, [posterUrl])

  // OPTIMISATION: Libérer la texture et le matériau quand le composant est démonté
  useEffect(() => {
    return () => {
      if (texture) {
        texture.dispose()
      }
      if (materialRef.current) {
        materialRef.current.dispose()
      }
    }
  }, [texture])

  // Animation hover avec hystérésis et lissage
  useFrame(({ camera }, delta) => {
    if (!meshRef.current || !materialRef.current) return

    // OPTIMISATION: Incrémenter le compteur global (une seule cassette le fait par frame)
    const currentFrame = Math.floor(performance.now() / 16.67) // ~60fps
    if (currentFrame !== globalFrameCount) {
      globalFrameCount = currentFrame
    }

    // OPTIMISATION: Skip l'animation tous les N frames
    if (globalFrameCount % ANIMATION_THROTTLE !== 0) {
      return
    }

    // OPTIMISATION: Mettre à jour le frustum une seule fois par frame
    if (lastFrustumFrame !== globalFrameCount) {
      projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      frustum.setFromProjectionMatrix(projScreenMatrix)
      lastFrustumFrame = globalFrameCount
    }

    // Vérifier si la position de la cassette est dans le frustum
    meshRef.current.getWorldPosition(tempWorldPos)
    if (!frustum.containsPoint(tempWorldPos)) {
      return // Cassette hors champ - skip l'animation
    }

    // Hystérésis asymétrique : rapide pour sélectionner, lent pour désélectionner
    if (isTargetedRaw !== stableTargetedRef.current) {
      targetedTimerRef.current += delta
      // Délai différent selon qu'on sélectionne ou désélectionne
      const delay = isTargetedRaw ? HYSTERESIS_SELECT : HYSTERESIS_DESELECT
      if (targetedTimerRef.current >= delay) {
        stableTargetedRef.current = isTargetedRaw
        targetedTimerRef.current = 0
      }
    } else {
      // État brut = état stable, reset le timer
      targetedTimerRef.current = 0
    }

    const isTargeted = stableTargetedRef.current

    // Lissage de la position
    const targetZ = isTargeted ? baseZ + hoverOffsetZ : baseZ
    meshRef.current.position.z = THREE.MathUtils.lerp(
      meshRef.current.position.z,
      targetZ,
      delta * 12
    )

    // Lissage de l'état ciblé (transition douce)
    const targetValue = isTargeted ? 1 : 0
    smoothTargetedRef.current = THREE.MathUtils.lerp(
      smoothTargetedRef.current,
      targetValue,
      delta * 8 // Vitesse de transition
    )

    // Interpoler la couleur émissive
    const targetColor = isRented ? EMISSIVE_RENTED : (smoothTargetedRef.current > 0.1 ? EMISSIVE_TARGETED : EMISSIVE_NONE)
    currentEmissiveRef.current.lerp(targetColor, delta * 10)
    materialRef.current.emissive.copy(currentEmissiveRef.current)

    // Interpoler l'intensité émissive
    const targetIntensity = isRented ? 0.3 : smoothTargetedRef.current * 0.4
    materialRef.current.emissiveIntensity = THREE.MathUtils.lerp(
      materialRef.current.emissiveIntensity,
      targetIntensity,
      delta * 10
    )
  })

  return (
    <mesh
      ref={meshRef}
      position={position}
      userData={{ filmId: film.id, cassetteKey }}
      castShadow={false}
      geometry={SHARED_CASSETTE_GEOMETRY}
    >
      <meshStandardMaterial
        ref={materialRef}
        map={texture}
        color={texture ? '#ffffff' : fallbackColor}
        roughness={0.4}
        emissive="#000000"
        emissiveIntensity={0}
      />
    </mesh>
  )
}, (prevProps, nextProps) => {
  // Ne re-render que si ces props changent vraiment
  return (
    prevProps.cassetteKey === nextProps.cassetteKey &&
    prevProps.film.id === nextProps.film.id &&
    prevProps.film.poster_path === nextProps.film.poster_path &&
    prevProps.position[0] === nextProps.position[0] &&
    prevProps.position[1] === nextProps.position[1] &&
    prevProps.position[2] === nextProps.position[2] &&
    prevProps.hoverOffsetZ === nextProps.hoverOffsetZ
  )
})
