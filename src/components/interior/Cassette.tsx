import { useRef, useMemo, memo, useEffect, useCallback } from 'react'
import * as THREE from 'three'
import type { Film } from '../../types'
import { TextureCache } from '../../utils/TextureCache'
import { registerCassette, unregisterCassette } from '../../utils/CassetteAnimationSystem'
import { RAYCAST_LAYER_CASSETTE } from './Controls'

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

// Couleurs aléatoires pour les cassettes sans poster
export const CASSETTE_COLORS = [
  '#1a1a2e', '#16213e', '#0f3460', '#533483',
  '#2c3e50', '#34495e', '#1e3d59', '#3d5a80'
]

export const Cassette = memo(function Cassette({ position, film, cassetteKey, hoverOffsetZ = 0.08 }: CassetteProps) {
  // Plus de useStore ici — le CassetteAnimationSystem lit le store une seule fois par frame
  const meshRef = useRef<THREE.Mesh>(null)
  const materialRef = useRef<THREE.MeshStandardMaterial>(null)

  // Callback ref : active le layer raycast + stocke le mesh ref
  const meshRefCallback = useCallback((node: THREE.Mesh | null) => {
    if (node) {
      node.layers.enable(RAYCAST_LAYER_CASSETTE)
      ;(meshRef as React.MutableRefObject<THREE.Mesh | null>).current = node
    }
  }, [])

  // Couleur de fallback basée sur l'ID du film
  const fallbackColor = useMemo(() => {
    return CASSETTE_COLORS[film.id % CASSETTE_COLORS.length]
  }, [film.id])

  // URL du poster TMDB — w200 suffisant pour cassettes ~10cm
  const posterUrl = film.poster_path
    ? `https://image.tmdb.org/t/p/w200${film.poster_path}`
    : null

  // Charger la texture via cache global (déduplique les posters identiques entre cassettes)
  const texture = useMemo(() => {
    if (!posterUrl) return null
    return TextureCache.acquire(posterUrl)
  }, [posterUrl])

  // OPTIMISATION: Enregistrer/désenregistrer auprès du système d'animation centralisé.
  // Un seul useFrame pour ~521 cassettes au lieu de 521 callbacks individuels.
  useEffect(() => {
    // Attendre que mesh et material soient montés (via refs)
    // On utilise un petit délai pour s'assurer que les refs R3F sont assignés
    const timer = requestAnimationFrame(() => {
      if (meshRef.current && materialRef.current) {
        registerCassette(cassetteKey, {
          mesh: meshRef.current,
          material: materialRef.current,
          baseZ: position[2],
          hoverOffsetZ,
          cassetteKey,
          filmId: film.id,
          stableTargeted: false,
          targetedTimer: 0,
          smoothTargeted: 0,
          currentEmissive: new THREE.Color('#000000'),
        })
      }
    })

    return () => {
      cancelAnimationFrame(timer)
      unregisterCassette(cassetteKey)
      if (posterUrl) {
        TextureCache.release(posterUrl)
      }
      if (materialRef.current) {
        materialRef.current.dispose()
      }
    }
  }, [cassetteKey, film.id, position[2], hoverOffsetZ, posterUrl])

  return (
    <mesh
      ref={meshRefCallback}
      position={position}
      userData={{ filmId: film.id, cassetteKey }}
      castShadow={false}
      receiveShadow
      geometry={SHARED_CASSETTE_GEOMETRY}
    >
      <meshStandardMaterial
        ref={materialRef}
        map={texture}
        color={texture ? '#ffffff' : fallbackColor}
        roughness={0.5}
        metalness={0.08}
        envMapIntensity={0.3}
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
