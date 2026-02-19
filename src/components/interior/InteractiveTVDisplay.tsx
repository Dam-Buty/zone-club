import { useRef, useState, useMemo, useCallback, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useTexture } from '@react-three/drei'
import { useStore } from '../../store'
import { Couch } from './Couch'
import { RAYCAST_LAYER_INTERACTIVE } from './Controls'

// --- VCR Toshiba W602: Shared materials (module-level, per memory rules) ---
const vcrBodyMat = new THREE.MeshStandardMaterial({
  color: '#2a2a30',
  roughness: 0.6,
  metalness: 0.1,
})
const vcrFootMat = new THREE.MeshStandardMaterial({
  color: '#222226',
  roughness: 0.7,
  metalness: 0.05,
})
const vcrButtonMat = new THREE.MeshStandardMaterial({
  color: '#383840',
  roughness: 0.4,
  metalness: 0.05,
})
const vcrSlotMat = new THREE.MeshStandardMaterial({
  color: '#0a0a0a',
  roughness: 0.9,
  metalness: 0.0,
})

// --- VCR Toshiba W602: Shared geometries (module-level) ---
const vcrButtonGeo = new THREE.BoxGeometry(0.03, 0.015, 0.008)
const vcrSmallButtonGeo = new THREE.BoxGeometry(0.028, 0.012, 0.006)
const vcrChannelButtonGeo = new THREE.BoxGeometry(0.022, 0.010, 0.006)

// --- Sony Trinitron: Shared materials (module-level, per memory rules) ---
const tvBodyMat = new THREE.MeshStandardMaterial({
  color: '#3d3a3e',
  roughness: 0.5,
  metalness: 0.05,
})
const tvPanelMat = new THREE.MeshStandardMaterial({
  color: '#1c1a22',
  roughness: 0.65,
  metalness: 0.05,
})
const tvButtonMat = new THREE.MeshStandardMaterial({
  color: '#585460',
  roughness: 0.3,
  metalness: 0.1,
})

const tvInnerBezelMat = new THREE.MeshStandardMaterial({
  color: '#0a0a0e',
  roughness: 0.9,
})
const tvTopEdgeMat = new THREE.MeshStandardMaterial({
  color: '#4a4850',
  roughness: 0.4,
  metalness: 0.1,
})
const tvCreaseMat = new THREE.MeshStandardMaterial({
  color: '#111115',
  roughness: 0.9,
})
const tvConcaveMat = new THREE.MeshStandardMaterial({
  color: '#18161c',
  roughness: 0.75,
})

// --- Sony Trinitron: Shared geometry ---
const tvButtonGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.010, 12)

interface InteractiveTVDisplayProps {
  position: [number, number, number]
  rotation?: [number, number, number]
}

type TVMode = 'idle' | 'seated-menu' | 'menu' | 'playing'

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

// --- VCR Toshiba W602: Front-face CanvasTexture with all text labels ---
function createVCRFrontTexture(): THREE.CanvasTexture {
  const w = 512
  const h = 128
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!

  // Transparent background (overlaid on front face)

  // --- Top-left: "TOSHIBA" ---
  ctx.font = 'bold 16px Arial, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#ffffff'
  ctx.fillText('TOSHIBA', 14, 10)

  // --- Top-center: "ONE MINUTE REWIND" ---
  ctx.font = 'bold 13px Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = '#ffffff'
  ctx.fillText('ONE MINUTE REWIND', w * 0.48, 10)

  // --- Below that: "NEW INTERACTIVE OSP" (gold) ---
  ctx.font = '9px Arial, sans-serif'
  ctx.fillStyle = '#c8a040'
  ctx.fillText('NEW INTERACTIVE OSP', w * 0.48, 28)

  // --- Top-right: "VHS" + "W602" ---
  ctx.textAlign = 'right'
  ctx.font = 'bold 14px Arial, sans-serif'
  ctx.fillStyle = '#ffffff'
  ctx.fillText('VHS', w - 80, 10)
  ctx.font = '10px Arial, sans-serif'
  ctx.fillText('W602', w - 80, 27)

  // --- Bottom-left: "Hi-Fi STEREO PRO DRUM" (gold) ---
  ctx.textAlign = 'left'
  ctx.font = 'bold 8px Arial, sans-serif'
  ctx.fillStyle = '#c8a040'
  ctx.fillText('Hi-Fi STEREO PRO DRUM', 14, h - 18)

  // --- Bottom-center: Energy Star logo placeholder ---
  ctx.font = '7px Arial, sans-serif'
  ctx.fillStyle = '#666666'
  ctx.textAlign = 'center'
  ctx.fillText('⭐ ENERGY', w * 0.42, h - 10)

  // --- Right side: transport labels ---
  ctx.textAlign = 'center'
  ctx.font = '7px Arial, sans-serif'
  ctx.fillStyle = '#aaaaaa'
  // FF label
  ctx.fillText('FF', w - 44, 46)
  ctx.fillText('▶▶', w - 44, 55)
  // REW label
  ctx.fillText('REW', w - 82, 46)
  ctx.fillText('◀◀', w - 82, 55)
  // PLAY label
  ctx.fillText('▶ PLAY', w - 32, 72)
  // STOP label
  ctx.fillText('■ STOP', w - 80, 72)

  // Left side: POWER / EJECT labels
  ctx.textAlign = 'center'
  ctx.font = '7px Arial, sans-serif'
  ctx.fillStyle = '#aaaaaa'
  ctx.fillText('POWER', 30, 52)
  ctx.fillText('▲ EJECT', 82, 52)

  // CHANNEL label
  ctx.fillText('CHANNEL', 160, 52)

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

// --- Sony Trinitron: Front-face CanvasTexture with "Trinitron" + "SONY" labels ---
// Canvas maps to full front face (0.50 × 0.44), UV origin bottom-left
// Bezel layout: top bezel ~top 11%, bottom bezel ~bottom 16%, sides ~14% each
// "Trinitron" on top-left bezel, "SONY" on bottom bezel center
function createTVFrontTexture(): THREE.CanvasTexture {
  const w = 512
  const h = 512
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!

  // Transparent background

  // --- Top-left: "Trinitron" (silver, italic) ---
  // Top bezel strip center: y=0.2075 in 3D → canvas y ≈ 14px (centered in bezel)
  ctx.font = 'italic 18px Arial, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#c0c0c8'
  ctx.fillText('Trinitron', 40, 14)

  // --- Bottom bezel: "SONY" (metallic silver, bold, letter-spaced) ---
  ctx.font = 'bold 25px Arial, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#b8b8c0'
  const letters = ['S', 'O', 'N', 'Y']
  const spacing = 8
  const charWidths = letters.map(ch => ctx.measureText(ch).width)
  const totalWidth = charWidths.reduce((a, b) => a + b, 0) + spacing * (letters.length - 1)
  let x = (w - totalWidth) / 2
  const sonyY = h * 0.96
  for (let i = 0; i < letters.length; i++) {
    ctx.fillText(letters[i], x, sonyY)
    x += charWidths[i] + spacing
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

export function InteractiveTVDisplay({ position, rotation = [0, 0, 0] }: InteractiveTVDisplayProps) {
  const screenRef = useRef<THREE.Mesh>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [tvMode, setTvMode] = useState<TVMode>('idle')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [seatedMenuIndex, setSeatedMenuIndex] = useState(0)
  const [isHovered, setIsHovered] = useState(false)

  // Refs pour les textures dynamiques
  const idleTextureRef = useRef<THREE.CanvasTexture | null>(null)
  const menuTextureRef = useRef<THREE.CanvasTexture | null>(null)
  const indicatorTextureRef = useRef<THREE.CanvasTexture | null>(null)

  // Individual selectors to avoid re-rendering on unrelated store changes
  const rentals = useStore(state => state.rentals)
  const films = useStore(state => state.films)
  const openTerminal = useStore(state => state.openTerminal)
  const requestPointerUnlock = useStore(state => state.requestPointerUnlock)
  const isSitting = useStore(state => state.isSitting)
  const tvMenuAction = useStore(state => state.tvMenuAction)
  const clearTVMenuAction = useStore(state => state.clearTVMenuAction)

  const timeRef = useRef(0)

  // OPTIMISATION: Callback pour activer le layer de raycast sur les meshes TV
  const enableRaycastLayer = useCallback((node: THREE.Mesh | null) => {
    if (node) node.layers.enable(RAYCAST_LAYER_INTERACTIVE)
  }, [])

  // Textures bois PBR pour le meuble TV
  const woodTextures = useTexture({
    map: '/textures/wood/color.jpg',
    normalMap: '/textures/wood/normal.jpg',
    roughnessMap: '/textures/wood/roughness.jpg',
  })

  // Shared wood material for all 6 TV stand pieces (avoids 6 inline duplicates)
  const tvStandWoodMat = useMemo(() => {
    Object.entries(woodTextures).forEach(([key, tex]) => {
      const t = tex as THREE.Texture
      t.wrapS = THREE.RepeatWrapping
      t.wrapT = THREE.RepeatWrapping
      t.repeat.set(1, 1)
      t.anisotropy = 16
      t.colorSpace = key === 'map' ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace
    })
    return new THREE.MeshStandardMaterial({
      map: woodTextures.map as THREE.Texture,
      normalMap: woodTextures.normalMap as THREE.Texture,
      roughnessMap: woodTextures.roughnessMap as THREE.Texture,
      color: '#2a2018',
      normalScale: new THREE.Vector2(0.7, 0.7),
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

  // Créer/mettre à jour la texture idle (with CRT scanlines)
  const idleTexture = useMemo(() => {
    const w = 512
    const h = 256
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!

    // CRT scanline pattern
    for (let y = 0; y < h; y += 3) {
      ctx.fillStyle = 'rgba(0, 60, 55, 0.15)'
      ctx.fillRect(0, y, w, 1)
    }

    // Text
    ctx.font = 'bold 48px Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#00ffff'
    ctx.fillText('CLICK POUR', w / 2, h / 2 - 30)
    ctx.fillText('OUVRIR LE MENU', w / 2, h / 2 + 30)

    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
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

  // Texture for seated main menu (Regarder un film / Paramètres)
  const seatedMenuTexture = useMemo(() => {
    const w = 512
    const h = 256
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!

    // CRT scanline pattern (same as idle)
    for (let y = 0; y < h; y += 3) {
      ctx.fillStyle = 'rgba(0, 60, 55, 0.15)'
      ctx.fillRect(0, y, w, 1)
    }

    const options = ['Regarder un film', 'Paramètres']
    ctx.font = 'bold 36px Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    options.forEach((opt, i) => {
      const prefix = i === seatedMenuIndex ? '> ' : '  '
      ctx.fillStyle = i === seatedMenuIndex ? '#00ffff' : '#008888'
      ctx.fillText(`${prefix}${opt}`, w / 2, h / 2 - 30 + i * 60)
    })

    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
  }, [seatedMenuIndex])

  // Floating label above couch
  const couchLabelTexture = useMemo(() => {
    const w = 512
    const h = 64
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!

    ctx.font = 'bold 24px Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = '#00ffff'
    ctx.shadowBlur = 8
    ctx.fillStyle = '#00ffff'
    ctx.fillText('Installez-vous dans le canapé', w / 2, h / 2)

    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
  }, [])

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

  // VCR Toshiba W602 front-face texture (all text labels)
  const vcrFrontTexture = useMemo(() => createVCRFrontTexture(), [])

  // Sony Trinitron front-face texture ("Trinitron" + "SONY")
  const tvFrontTexture = useMemo(() => createTVFrontTexture(), [])

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

  // Cleanup CanvasTextures + wood material on unmount
  useEffect(() => {
    return () => {
      idleTexture?.dispose()
      menuTexture?.dispose()
      seatedMenuTexture?.dispose()
      couchLabelTexture?.dispose()
      playingTexture?.dispose()
      indicatorTexture?.dispose()
      vcrFrontTexture?.dispose()
      tvFrontTexture?.dispose()
      videoTexture?.dispose()
      tvStandWoodMat?.dispose()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Animation et mise à jour de l'écran
  useFrame((_, delta) => {
    timeRef.current += delta

    if (!screenRef.current) return

    const material = screenRef.current.material as THREE.MeshStandardMaterial

    if (tvMode === 'idle') {
      material.emissiveIntensity = 0.6 + Math.sin(timeRef.current * 10) * 0.1
    } else if (tvMode === 'seated-menu' || tvMode === 'menu') {
      material.emissiveIntensity = 0.8
    } else if (tvMode === 'playing') {
      material.emissiveIntensity = 1.0
      // VideoTexture auto-updates from HTMLVideoElement — no manual needsUpdate needed
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
    setTvMode(isSitting ? 'seated-menu' : 'menu')
  }, [isSitting])

  // React to TV menu actions dispatched by Controls via store
  useEffect(() => {
    if (!tvMenuAction || !isSitting) return

    if (tvMenuAction === 'up' || tvMenuAction === 'down') {
      if (tvMode === 'seated-menu') {
        setSeatedMenuIndex(prev =>
          tvMenuAction === 'up' ? Math.max(0, prev - 1) : Math.min(1, prev + 1)
        )
      } else if (tvMode === 'menu') {
        setSelectedIndex(prev => {
          const max = Math.max(0, rentedFilms.length - 1)
          return tvMenuAction === 'up' ? Math.max(0, prev - 1) : Math.min(max, prev + 1)
        })
      }
    } else if (tvMenuAction === 'select') {
      if (tvMode === 'seated-menu') {
        if (seatedMenuIndex === 0) {
          // "Regarder un film" → show film list
          setTvMode('menu')
        } else {
          // "Paramètres" → open terminal
          openTerminal()
          requestPointerUnlock()
        }
      } else if (tvMode === 'menu' && rentedFilms.length > 0) {
        const selected = rentedFilms[selectedIndex]
        if (selected) {
          playVideo(selected.rental.videoUrl)
        }
      } else if (tvMode === 'playing') {
        stopVideo()
      }
    }

    clearTVMenuAction()
  }, [tvMenuAction, isSitting, tvMode, seatedMenuIndex, selectedIndex, rentedFilms, playVideo, stopVideo, openTerminal, requestPointerUnlock, clearTVMenuAction])

  // Auto-show menu when sitting down with rented films
  const prevSittingRef = useRef(false)
  useEffect(() => {
    if (isSitting && !prevSittingRef.current) {
      // Sitting down → show seated menu
      if (tvMode === 'idle') {
        setSeatedMenuIndex(0)
        setTvMode('seated-menu')
      }
    } else if (!isSitting && prevSittingRef.current) {
      // Standing up → back to idle (stop video if playing)
      if (videoRef.current) {
        videoRef.current.pause()
        videoRef.current.currentTime = 0
      }
      setTvMode('idle')
    }
    prevSittingRef.current = isSitting
  }, [isSitting, tvMode, rentedFilms.length])

  // Couleur de l'écran selon le mode — greenish-teal like real Trinitron phosphor
  const screenColor = tvMode === 'playing' ? '#000000' : '#0e3a35'

  return (
    <group position={position} rotation={rotation}>
      {/* ====== 90s Open-Shelf TV Stand ====== */}
      {/* Top shelf (TV sits here) */}
      <mesh position={[0, 0.82, 0]} receiveShadow material={tvStandWoodMat}>
        <boxGeometry args={[0.65, 0.035, 0.45]} />
      </mesh>
      {/* Middle shelf (VCR sits here) */}
      <mesh position={[0, 0.55, 0]} receiveShadow material={tvStandWoodMat}>
        <boxGeometry args={[0.63, 0.03, 0.43]} />
      </mesh>
      {/* Bottom shelf (base) */}
      <mesh position={[0, 0.035, 0]} receiveShadow material={tvStandWoodMat}>
        <boxGeometry args={[0.65, 0.035, 0.45]} />
      </mesh>
      {/* Left side panel */}
      <mesh position={[-0.31, 0.4275, 0]} receiveShadow material={tvStandWoodMat}>
        <boxGeometry args={[0.035, 0.82, 0.45]} />
      </mesh>
      {/* Right side panel */}
      <mesh position={[0.31, 0.4275, 0]} receiveShadow material={tvStandWoodMat}>
        <boxGeometry args={[0.035, 0.82, 0.45]} />
      </mesh>
      {/* Back panel (thin, stabilizing) */}
      <mesh position={[0, 0.4275, -0.215]} receiveShadow material={tvStandWoodMat}>
        <boxGeometry args={[0.62, 0.82, 0.02]} />
      </mesh>

      {/* ====== Sony Trinitron CRT TV (4:3 aspect) ====== */}
      <group position={[0, 1.10, 0.13]} scale={1.15}>
        {/* Rear CRT housing (deep tube, narrower than front) */}
        <mesh position={[0, 0, -0.15]} material={tvBodyMat}>
          <boxGeometry args={[0.54, 0.40, 0.30]} />
        </mesh>

        {/* Front bezel — 4 strips framing 4:3 screen opening */}
        {/* Body: 0.58w × 0.44h. Opening: 0.51w × 0.38h → 1.34:1 ≈ 4:3 */}
        {/* Top bezel strip */}
        <mesh position={[0, 0.2075, 0.02]} material={tvBodyMat}>
          <boxGeometry args={[0.58, 0.025, 0.08]} />
        </mesh>
        {/* Bottom bezel strip (houses "SONY" label) */}
        <mesh position={[0, -0.2025, 0.02]} material={tvBodyMat}>
          <boxGeometry args={[0.58, 0.035, 0.08]} />
        </mesh>
        {/* Left bezel strip */}
        <mesh position={[-0.2725, 0.005, 0.02]} material={tvBodyMat}>
          <boxGeometry args={[0.035, 0.38, 0.08]} />
        </mesh>
        {/* Right bezel strip */}
        <mesh position={[0.2725, 0.005, 0.02]} material={tvBodyMat}>
          <boxGeometry args={[0.035, 0.38, 0.08]} />
        </mesh>

        {/* Top edge highlight — subtle light catch on top surface */}
        <mesh position={[0, 0.22, -0.05]} material={tvTopEdgeMat}>
          <boxGeometry args={[0.58, 0.004, 0.18]} />
        </mesh>

        {/* Inner bezel shadow recess — dark ring around screen opening */}
        {/* Top inner edge */}
        <mesh position={[0, 0.19, 0.055]} material={tvInnerBezelMat}>
          <boxGeometry args={[0.51, 0.01, 0.005]} />
        </mesh>
        {/* Bottom inner edge */}
        <mesh position={[0, -0.18, 0.055]} material={tvInnerBezelMat}>
          <boxGeometry args={[0.51, 0.01, 0.005]} />
        </mesh>
        {/* Left inner edge */}
        <mesh position={[-0.25, 0.005, 0.055]} material={tvInnerBezelMat}>
          <boxGeometry args={[0.01, 0.36, 0.005]} />
        </mesh>
        {/* Right inner edge */}
        <mesh position={[0.25, 0.005, 0.055]} material={tvInnerBezelMat}>
          <boxGeometry args={[0.01, 0.36, 0.005]} />
        </mesh>

        {/* CRT screen — slightly convex phosphor surface (4:3, radius 0.8 for flatter curve) */}
        <mesh
          ref={useCallback((node: THREE.Mesh | null) => {
            if (node) node.layers.enable(RAYCAST_LAYER_INTERACTIVE)
            ;(screenRef as React.MutableRefObject<THREE.Mesh | null>).current = node
          }, [])}
          position={[0, 0.005, 0.055]}
          userData={{ isTVScreen: true }}
        >
          <sphereGeometry args={[0.8, 20, 16, Math.PI - 0.325, 0.65, Math.PI / 2 - 0.24, 0.48]} />
          <meshStandardMaterial
            color={screenColor}
            emissive={screenColor}
            emissiveIntensity={1.0}
            map={tvMode === 'playing' ? videoTexture : null}
            toneMapped={false}
          />
        </mesh>

        {/* Screen content overlays (wider for 4:3) */}
        {tvMode === 'idle' && (
          <mesh position={[0, 0.005, 0.07]} userData={{ isTVScreen: true }} ref={enableRaycastLayer}>
            <planeGeometry args={[0.38, 0.19]} />
            <meshBasicMaterial map={idleTexture} transparent toneMapped={false} />
          </mesh>
        )}
        {tvMode === 'seated-menu' && (
          <mesh position={[0, 0.005, 0.07]} userData={{ isTVScreen: true }} ref={enableRaycastLayer}>
            <planeGeometry args={[0.38, 0.25]} />
            <meshBasicMaterial map={seatedMenuTexture} transparent toneMapped={false} />
          </mesh>
        )}
        {tvMode === 'menu' && (
          <mesh position={[0, 0.005, 0.07]} userData={{ isTVScreen: true }} ref={enableRaycastLayer}>
            <planeGeometry args={[0.38, 0.25]} />
            <meshBasicMaterial map={menuTexture} transparent toneMapped={false} />
          </mesh>
        )}
        {tvMode === 'playing' && (
          <mesh position={[0, -0.1, 0.07]} userData={{ isTVScreen: true }} ref={enableRaycastLayer}>
            <planeGeometry args={[0.24, 0.04]} />
            <meshBasicMaterial map={playingTexture} transparent toneMapped={false} />
          </mesh>
        )}

        {/* CRT glass overlay — greenish Trinitron tint */}
        <mesh
          position={[0, 0.005, 0.063]}
          userData={{ isTVScreen: true }}
          ref={enableRaycastLayer}
        >
          <sphereGeometry args={[0.8, 20, 16, Math.PI - 0.325, 0.65, Math.PI / 2 - 0.24, 0.48]} />
          <meshStandardMaterial
            color="#80aaa0"
            transparent
            opacity={isHovered ? 0.12 : 0.07}
            roughness={0.1}
            metalness={0.2}
            envMapIntensity={0.5}
          />
        </mesh>

        {/* Front text overlay — "Trinitron" top-left + "SONY" below screen */}
        <mesh position={[0, 0, 0.0605]} renderOrder={1}>
          <planeGeometry args={[0.58, 0.44]} />
          <meshBasicMaterial
            map={tvFrontTexture}
            transparent
            toneMapped={false}
            depthWrite={false}
          />
        </mesh>

        {/* Bottom control panel — prominent dark band (ref: concave, full-width, ~15% height) */}
        <mesh position={[0, -0.25, 0.018]} material={tvPanelMat}>
          <boxGeometry args={[0.60, 0.10, 0.07]} />
        </mesh>
        {/* Panel top separation crease — dark line between bezel and panel */}
        <mesh position={[0, -0.202, 0.05]} material={tvCreaseMat}>
          <boxGeometry args={[0.60, 0.005, 0.006]} />
        </mesh>
        {/* Panel front darker strip — concave depth suggestion */}
        <mesh position={[0, -0.258, 0.054]} material={tvConcaveMat}>
          <boxGeometry args={[0.56, 0.065, 0.004]} />
        </mesh>

        {/* Sony-style round buttons (4, center-left of panel, bigger + spaced) */}
        {[-0.07, -0.03, 0.01, 0.05].map((x, i) => (
          <mesh
            key={`tv-btn-${i}`}
            position={[x, -0.255, 0.058]}
            geometry={tvButtonGeo}
            material={tvButtonMat}
            rotation={[Math.PI / 2, 0, 0]}
          />
        ))}

        {/* Power/IR sensor + LED dot (right side of panel, bigger) */}
        <mesh position={[0.18, -0.255, 0.058]}>
          <sphereGeometry args={[0.013, 12, 12]} />
          <meshStandardMaterial
            color={tvMode === 'playing' ? '#ff2200' : '#aa0000'}
            emissive={tvMode === 'playing' ? '#ff2200' : '#440000'}
            emissiveIntensity={tvMode === 'playing' ? 0.8 : 0.3}
            toneMapped={false}
          />
        </mesh>


        {/* Screen glow light */}
        <pointLight
          position={[0, 0, 0.3]}
          color={tvMode === 'playing' ? '#ffffff' : screenColor}
          intensity={tvMode === 'playing' ? 0.5 : 0.3}
          distance={2}
          decay={2}
        />
      </group>

      {/* ====== Magnétoscope Toshiba W602 ====== */}
      <group position={[0, 0.62, 0.05]}>
        {/* Main body */}
        <mesh material={vcrBodyMat}>
          <boxGeometry args={[0.43, 0.085, 0.30]} />
        </mesh>

        {/* Left foot */}
        <mesh
          position={[-0.145, -0.048, 0]}
          material={vcrFootMat}
        >
          <boxGeometry args={[0.10, 0.012, 0.30]} />
        </mesh>
        {/* Right foot */}
        <mesh
          position={[0.145, -0.048, 0]}
          material={vcrFootMat}
        >
          <boxGeometry args={[0.10, 0.012, 0.30]} />
        </mesh>

        {/* Cassette loading slot (dark recess) */}
        <mesh
          position={[0, -0.008, 0.148]}
          material={vcrSlotMat}
        >
          <boxGeometry args={[0.28, 0.025, 0.005]} />
        </mesh>

        {/* Front text overlay (CanvasTexture) — slight z-offset to avoid z-fighting */}
        <mesh position={[0, 0, 0.1505]}>
          <planeGeometry args={[0.43, 0.085]} />
          <meshBasicMaterial
            map={vcrFrontTexture}
            transparent
            toneMapped={false}
            depthWrite={false}
          />
        </mesh>

        {/* --- Transport buttons (right side): FF, REW, PLAY, STOP --- */}
        <mesh position={[0.168, 0.018, 0.151]} geometry={vcrButtonGeo} material={vcrButtonMat} />
        <mesh position={[0.130, 0.018, 0.151]} geometry={vcrButtonGeo} material={vcrButtonMat} />
        <mesh position={[0.168, -0.005, 0.151]} geometry={vcrButtonGeo} material={vcrButtonMat} />
        <mesh position={[0.130, -0.005, 0.151]} geometry={vcrButtonGeo} material={vcrButtonMat} />

        {/* --- POWER button (bottom-left) --- */}
        <mesh position={[-0.180, 0.008, 0.151]} geometry={vcrSmallButtonGeo} material={vcrButtonMat} />
        {/* --- EJECT button --- */}
        <mesh position={[-0.140, 0.008, 0.151]} geometry={vcrSmallButtonGeo} material={vcrButtonMat} />

        {/* --- CHANNEL up/down buttons --- */}
        <mesh position={[-0.085, 0.012, 0.151]} geometry={vcrChannelButtonGeo} material={vcrButtonMat} />
        <mesh position={[-0.085, -0.004, 0.151]} geometry={vcrChannelButtonGeo} material={vcrButtonMat} />

        {/* LED indicator — green idle, red playing */}
        <mesh position={[-0.195, 0.028, 0.151]}>
          <boxGeometry args={[0.008, 0.004, 0.003]} />
          <meshStandardMaterial
            color={tvMode === 'playing' ? '#ff0000' : '#00ff00'}
            emissive={tvMode === 'playing' ? '#ff0000' : '#00ff00'}
            emissiveIntensity={0.6}
            toneMapped={false}
          />
        </mesh>

        {/* Subtle top edge bevel — lighter strip to break silhouette */}
        <mesh position={[0, 0.0435, 0.148]}>
          <boxGeometry args={[0.43, 0.002, 0.005]} />
          <meshStandardMaterial color="#363640" roughness={0.5} metalness={0.1} />
        </mesh>
      </group>

      {/* Cassettes VHS empilées (bottom shelf) */}
      <group position={[-0.18, 0.08, 0.05]}>
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
        onSit={() => useStore.getState().setSitting(true)}
      />

      {/* Floating label above couch — always visible */}
      {!isSitting && couchLabelTexture && (
        <mesh position={[0, 1.0, 1.2]}>
          <planeGeometry args={[0.8, 0.1]} />
          <meshBasicMaterial map={couchLabelTexture} transparent toneMapped={false} depthWrite={false} />
        </mesh>
      )}

      {/* Indicateur si films disponibles */}
      {rentedFilms.length > 0 && tvMode === 'idle' && indicatorTexture && (
        <mesh position={[0, 1.58, 0.2]}>
          <planeGeometry args={[0.35, 0.06]} />
          <meshBasicMaterial map={indicatorTexture} transparent toneMapped={false} />
        </mesh>
      )}

    </group>
  )
}
