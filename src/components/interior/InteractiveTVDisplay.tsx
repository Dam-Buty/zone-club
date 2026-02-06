import { useRef, useState, useMemo, useCallback } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useTexture } from '@react-three/drei'
import { useStore } from '../../store'
import { Couch } from './Couch'

interface InteractiveTVDisplayProps {
  position: [number, number, number]
  rotation?: [number, number, number]
}

type TVMode = 'idle' | 'menu' | 'playing'

// Créer une texture de texte via Canvas 2D (compatible WebGPU)
function createTextTexture(
  text: string,
  options: {
    fontSize?: number
    fontFamily?: string
    color?: string
    backgroundColor?: string
    width?: number
    height?: number
    glowColor?: string
    align?: CanvasTextAlign
  } = {}
): THREE.CanvasTexture {
  const {
    fontSize = 24,
    fontFamily = 'Arial, sans-serif',
    color = '#ffffff',
    backgroundColor = 'transparent',
    width = 256,
    height = 64,
    glowColor,
    align = 'center',
  } = options

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  // Fond
  if (backgroundColor !== 'transparent') {
    ctx.fillStyle = backgroundColor
    ctx.fillRect(0, 0, width, height)
  }

  // Configuration du texte
  ctx.font = `bold ${fontSize}px ${fontFamily}`
  ctx.textAlign = align
  ctx.textBaseline = 'middle'

  // Effet de glow si spécifié
  if (glowColor) {
    ctx.shadowColor = glowColor
    ctx.shadowBlur = 10
  }

  // Dessiner le texte (gère les retours à la ligne)
  const lines = text.split('\n')
  const lineHeight = fontSize * 1.2
  const startY = height / 2 - ((lines.length - 1) * lineHeight) / 2

  ctx.fillStyle = color
  lines.forEach((line, i) => {
    const x = align === 'center' ? width / 2 : align === 'left' ? 10 : width - 10
    ctx.fillText(line, x, startY + i * lineHeight)
  })

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

export function InteractiveTVDisplay({ position, rotation = [0, 0, 0] }: InteractiveTVDisplayProps) {
  const screenRef = useRef<THREE.Mesh>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [tvMode, setTvMode] = useState<TVMode>('idle')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [isHovered, setIsHovered] = useState(false)
  const [isSitting, setIsSitting] = useState(false)

  // Refs pour les textures dynamiques
  const idleTextureRef = useRef<THREE.CanvasTexture | null>(null)
  const menuTextureRef = useRef<THREE.CanvasTexture | null>(null)
  const indicatorTextureRef = useRef<THREE.CanvasTexture | null>(null)

  const { rentals, films, openTerminal, requestPointerUnlock } = useStore()

  const timeRef = useRef(0)

  // Textures bois PBR pour le meuble TV
  const woodTextures = useTexture({
    map: '/textures/wood/color.jpg',
    normalMap: '/textures/wood/normal.jpg',
    roughnessMap: '/textures/wood/roughness.jpg',
  })

  useMemo(() => {
    Object.entries(woodTextures).forEach(([key, tex]) => {
      const t = tex as THREE.Texture
      t.wrapS = THREE.RepeatWrapping
      t.wrapT = THREE.RepeatWrapping
      t.repeat.set(1, 1)
      t.colorSpace = key === 'map' ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace
    })
  }, [woodTextures])

  // Obtenir les films loués avec leurs infos
  const rentedFilms = useMemo(() => {
    const allFilms = Object.values(films).flat()
    return rentals
      .filter(r => r.expiresAt > Date.now())
      .map(r => ({
        rental: r,
        film: allFilms.find(f => f.id === r.filmId)
      }))
      .filter(r => r.film)
  }, [rentals, films])

  // Créer/mettre à jour la texture idle
  const idleTexture = useMemo(() => {
    const text = 'CLICK POUR\nOUVRIR LE MENU'
    return createTextTexture(text, {
      fontSize: 48,
      color: '#00ffff',
      width: 512,
      height: 256,
    })
  }, [])

  // Créer/mettre à jour la texture menu
  const menuTexture = useMemo(() => {
    let text = 'MES LOCATIONS\n\n'
    rentedFilms.slice(0, 4).forEach((item, i) => {
      const prefix = i === selectedIndex ? '> ' : '  '
      const title = item.film?.title.substring(0, 18) || 'Film inconnu'
      text += `${prefix}${title}\n`
    })
    text += '\nCLIQUER POUR LIRE'

    return createTextTexture(text, {
      fontSize: 14,
      color: '#00ff00',
      glowColor: '#00ff00',
      width: 256,
      height: 180,
    })
  }, [rentedFilms, selectedIndex])

  // Texture pour le mode playing
  const playingTexture = useMemo(() => {
    return createTextTexture('[CLIC POUR ARRETER]', {
      fontSize: 12,
      color: '#ff0000',
      glowColor: '#ff0000',
      width: 200,
      height: 40,
    })
  }, [])

  // Texture indicateur films disponibles
  const indicatorTexture = useMemo(() => {
    if (rentedFilms.length === 0) return null
    const text = `${rentedFilms.length} FILM${rentedFilms.length > 1 ? 'S' : ''} DISPONIBLE${rentedFilms.length > 1 ? 'S' : ''}`
    return createTextTexture(text, {
      fontSize: 24,
      color: '#00ff00',
      glowColor: '#00ff00',
      width: 300,
      height: 50,
    })
  }, [rentedFilms.length])

  // Créer la texture vidéo
  const videoTexture = useMemo(() => {
    if (typeof document === 'undefined') return null

    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.loop = true
    video.muted = false
    video.playsInline = true
    videoRef.current = video

    const texture = new THREE.VideoTexture(video)
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.colorSpace = THREE.SRGBColorSpace

    return texture
  }, [])

  // Animation et mise à jour de l'écran
  useFrame((_, delta) => {
    timeRef.current += delta

    if (!screenRef.current) return

    const material = screenRef.current.material as THREE.MeshStandardMaterial

    if (tvMode === 'idle') {
      material.emissiveIntensity = 0.6 + Math.sin(timeRef.current * 10) * 0.1
    } else if (tvMode === 'menu') {
      material.emissiveIntensity = 0.8
    } else if (tvMode === 'playing') {
      material.emissiveIntensity = 1.0
      if (videoTexture) {
        videoTexture.needsUpdate = true
      }
    }
  })

  // Jouer une vidéo
  const playVideo = useCallback((videoUrl: string) => {
    if (videoRef.current) {
      videoRef.current.src = videoUrl
      videoRef.current.play().catch(console.error)
      setTvMode('playing')
    }
  }, [])

  // Arrêter la vidéo
  const stopVideo = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.currentTime = 0
    }
    setTvMode('menu')
  }, [])

  // Handler pour clic sur TV
  const handleTVClick = useCallback(() => {
    if (tvMode === 'idle') {
      // Ouvrir le terminal au lieu du menu in-screen
      openTerminal()
      requestPointerUnlock()
    } else if (tvMode === 'menu' && rentedFilms.length > 0) {
      const selected = rentedFilms[selectedIndex]
      if (selected) {
        playVideo(selected.rental.videoUrl)
      }
    } else if (tvMode === 'playing') {
      stopVideo()
    }
  }, [tvMode, rentedFilms, selectedIndex, playVideo, stopVideo, openTerminal, requestPointerUnlock])


  // Gérer le fait de s'asseoir sur le canapé
  const handleSit = useCallback(() => {
    setIsSitting(true)
    if (tvMode === 'idle' && rentedFilms.length > 0) {
      setTvMode('menu')
    }
  }, [tvMode, rentedFilms.length])

  // Couleur de l'écran selon le mode
  const screenColor = tvMode === 'playing' ? '#000000' : '#001166'

  return (
    <group position={position} rotation={rotation}>
      {/* Meuble/support - bois PBR */}
      <mesh position={[0, 0.4, 0]} receiveShadow>
        <boxGeometry args={[0.6, 0.8, 0.4]} />
        <meshStandardMaterial
          map={woodTextures.map as THREE.Texture}
          normalMap={woodTextures.normalMap as THREE.Texture}
          roughnessMap={woodTextures.roughnessMap as THREE.Texture}
          color="#2a2018"
          normalScale={[0.7, 0.7] as unknown as THREE.Vector2}
        />
      </mesh>

      {/* Plateau supérieur - bois vernis */}
      <mesh position={[0, 0.82, 0]} receiveShadow>
        <boxGeometry args={[0.65, 0.04, 0.45]} />
        <meshStandardMaterial
          map={woodTextures.map as THREE.Texture}
          normalMap={woodTextures.normalMap as THREE.Texture}
          roughnessMap={woodTextures.roughnessMap as THREE.Texture}
          color="#1a1a12"
          roughness={0.35}
          normalScale={[0.7, 0.7] as unknown as THREE.Vector2}
        />
      </mesh>

      {/* TV CRT */}
      <group position={[0, 1.1, 0]}>
        {/* Corps du moniteur - plastique beige années 90 */}
        <mesh position={[0, 0, -0.15]}>
          <boxGeometry args={[0.5, 0.45, 0.35]} />
          <meshStandardMaterial
            color="#c4b8a8"
            roughness={0.4}
            metalness={0.0}
          />
        </mesh>

        {/* Partie avant - cadre plastique noir brillant */}
        <mesh position={[0, 0, 0.02]}>
          <boxGeometry args={[0.48, 0.43, 0.05]} />
          <meshStandardMaterial
            color="#1a1a1a"
            roughness={0.2}
            metalness={0.0}
          />
        </mesh>

        {/* Écran CRT - surface légèrement convexe (phosphore) */}
        <mesh
          ref={screenRef}
          position={[0, 0.02, 0.045]}
          userData={{ isTVScreen: true }}
        >
          <sphereGeometry args={[0.6, 16, 16, Math.PI - 0.31, 0.62, Math.PI / 2 - 0.24, 0.48]} />
          <meshStandardMaterial
            color={screenColor}
            emissive={screenColor}
            emissiveIntensity={0.8}
            map={tvMode === 'playing' ? videoTexture : null}
            toneMapped={false}
          />
        </mesh>

        {/* Contenu de l'écran selon le mode */}
        {tvMode === 'idle' && (
          <mesh position={[0, 0.02, 0.06]} userData={{ isTVScreen: true }}>
            <planeGeometry args={[0.32, 0.16]} />
            <meshBasicMaterial map={idleTexture} transparent toneMapped={false} />
          </mesh>
        )}

        {tvMode === 'menu' && (
          <mesh position={[0, 0.02, 0.06]} userData={{ isTVScreen: true }}>
            <planeGeometry args={[0.32, 0.22]} />
            <meshBasicMaterial map={menuTexture} transparent toneMapped={false} />
          </mesh>
        )}

        {tvMode === 'playing' && (
          <mesh position={[0, -0.1, 0.06]} userData={{ isTVScreen: true }}>
            <planeGeometry args={[0.2, 0.04]} />
            <meshBasicMaterial map={playingTexture} transparent toneMapped={false} />
          </mesh>
        )}

        {/* Vitre CRT — isTVScreen pour le raycast FPS (pas de onClick R3F
            qui interfèrerait avec le listener DOM de Controls.tsx) */}
        <mesh
          position={[0, 0.02, 0.052]}
          userData={{ isTVScreen: true }}
        >
          <sphereGeometry args={[0.6, 16, 16, Math.PI - 0.31, 0.62, Math.PI / 2 - 0.24, 0.48]} />
          <meshStandardMaterial
            color="#aabbbb"
            transparent
            opacity={isHovered ? 0.15 : 0.1}
            roughness={0.2}
            metalness={0.1}
            envMapIntensity={0.3}
          />
        </mesh>

        {/* Panneau de contrôle */}
        <mesh position={[0, -0.17, 0.03]}>
          <boxGeometry args={[0.44, 0.06, 0.02]} />
          <meshStandardMaterial
            color="#2a2a2a"
            roughness={0.45}
            metalness={0.0}
          />
        </mesh>

        {/* Boutons */}
        {[-0.12, -0.04, 0.04, 0.12].map((x, i) => (
          <mesh key={`btn-${i}`} position={[x, -0.17, 0.045]}>
            <cylinderGeometry args={[0.015, 0.015, 0.02, 6]} />
            <meshStandardMaterial
              color={i === 0 ? '#00aa00' : '#444444'}
              emissive={i === 0 ? '#00aa00' : '#000000'}
              emissiveIntensity={i === 0 && tvMode === 'playing' ? 0.8 : 0.3}
              roughness={0.3}
            />
          </mesh>
        ))}

        {/* Lumière de l'écran */}
        <pointLight
          position={[0, 0, 0.3]}
          color={tvMode === 'playing' ? '#ffffff' : screenColor}
          intensity={tvMode === 'playing' ? 0.5 : 0.3}
          distance={2}
          decay={2}
        />
      </group>

      {/* Magnétoscope */}
      <mesh position={[0, 0.92, 0.1]}>
        <boxGeometry args={[0.4, 0.08, 0.3]} />
        <meshStandardMaterial
          color="#111111"
          roughness={0.2}
          metalness={0.0}
        />
      </mesh>

      {/* LED du magnétoscope */}
      <mesh position={[0.12, 0.92, 0.26]}>
        <boxGeometry args={[0.06, 0.02, 0.01]} />
        <meshStandardMaterial
          color={tvMode === 'playing' ? '#ff0000' : '#00ff00'}
          emissive={tvMode === 'playing' ? '#ff0000' : '#00ff00'}
          emissiveIntensity={0.5}
          toneMapped={false}
        />
      </mesh>

      {/* Cassettes VHS */}
      <group position={[-0.22, 0.86, 0.1]}>
        {[0, 1, 2].map((i) => (
          <mesh key={`vhs-${i}`} position={[0, i * 0.025, 0]}>
            <boxGeometry args={[0.1, 0.02, 0.18]} />
            <meshStandardMaterial
              color={['#1a1a2e', '#2e1a1a', '#1a2e1a'][i]}
              roughness={0.5}
            />
          </mesh>
        ))}
      </group>

      {/* Mini canapé devant la TV (face à l'écran) */}
      <Couch
        position={[0, 0, 1.2]}
        rotation={[0, Math.PI, 0]}
        onSit={handleSit}
      />

      {/* Indicateur si films disponibles */}
      {rentedFilms.length > 0 && tvMode === 'idle' && indicatorTexture && (
        <mesh position={[0, 1.55, 0.2]}>
          <planeGeometry args={[0.35, 0.06]} />
          <meshBasicMaterial map={indicatorTexture} transparent toneMapped={false} />
        </mesh>
      )}

    </group>
  )
}
