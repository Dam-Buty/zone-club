import { useMemo, useEffect, useRef, Suspense } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useTexture, Text3D, Center } from '@react-three/drei'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { TextureCache } from '../../utils/TextureCache'

interface StorefrontProps {
  position: [number, number, number]
  roomWidth: number
  roomHeight: number
  posterPaths: (string | null)[]
}

// ===== DIMENSIONS (from outside.jpeg analysis) =====
// Vitrine: large window left-center with posters
const VITRINE_WIDTH = 5.2
const VITRINE_HEIGHT = 1.8
const VITRINE_BOTTOM = 0.5   // bottom edge above floor
const VITRINE_CENTER_X = -0.8 // shifted toward manager side (local -X = world +X after PI rotation)

// Door: right side
const DOOR_WIDTH = 1.0
const DOOR_HEIGHT = 2.3
const DOOR_CENTER_X = 3.7    // near right wall in local space (appears left from inside after PI rotation)

// Neon signs
const NEON_SIGN_Y = 2.55     // above vitrine

// Kickboard
const KICKBOARD_HEIGHT = 0.25

// Z-layering (wall at z=0, items in FRONT toward interior = positive local Z)
// With group rotation [0, PI, 0], local +Z maps to world -Z (toward the viewer inside)
const Z_WALL = 0
const Z_BACKDROP = -1.5     // real 3D depth behind wall — geometric parallax
const Z_POSTERS = 0.01
const Z_GLASS = 0.015
const Z_FRAME = 0.02
const Z_NEON = 0.025
const Z_KICKBOARD = 0.003

// ===== SHARED MATERIALS =====
// Cadre vitrine → aluminium
const FRAME_MAT = new THREE.MeshStandardMaterial({
  color: '#b0b0b0',
  roughness: 0.2,
  metalness: 0.8,
})

// Vitrine glass — dark tinted, Fresnel reflections.
// Neon signs are on the exterior side — their emissive glow bleeds through the dark glass.
const GLASS_MAT = new THREE.MeshPhysicalMaterial({
  color: '#1a2030',        // dark blue-grey tint (storefront.jpeg: glass is dark at night)
  transparent: true,
  opacity: 0.15,           // darker tint than before — neon glow visible through
  roughness: 0.03,
  metalness: 0.0,
  reflectivity: 1.0,
  envMapIntensity: 2.5,
  clearcoat: 1.0,
  clearcoatRoughness: 0.05,
  depthWrite: false,
  side: THREE.FrontSide,
})

// Door glass — same dark tint
const DOOR_GLASS_MAT = new THREE.MeshPhysicalMaterial({
  color: '#182028',
  transparent: true,
  opacity: 0.18,
  roughness: 0.03,
  metalness: 0.0,
  reflectivity: 1.0,
  envMapIntensity: 2.5,
  clearcoat: 1.0,
  clearcoatRoughness: 0.05,
  depthWrite: false,
  side: THREE.FrontSide,
})


const KICKBOARD_MAT = new THREE.MeshStandardMaterial({
  color: '#1a1a1a',
  roughness: 0.8,
})

// Cadre porte → acier inox brossé
const DOOR_FRAME_MAT = new THREE.MeshStandardMaterial({
  color: '#b8b8c0',
  roughness: 0.15,
  metalness: 0.85,
})

const PUSH_BAR_MAT = new THREE.MeshStandardMaterial({
  color: '#d0d0d0',
  roughness: 0.2,
  metalness: 0.8,
})

// ===== PUSH BAR GEOMETRY (flat rectangular crash bar — full door width, matches storefront.jpeg) =====
const PUSH_BAR_GEOM = (() => {
  const barWidth = 0.94  // nearly full door width (DOOR_WIDTH=1.0 minus frame margins)
  const barHeight = 0.05 // 5cm tall — visible flat bar
  const barDepth = 0.03  // 3cm deep — protrudes from door
  // Main flat bar
  const bar = new THREE.BoxGeometry(barWidth, barHeight, barDepth)
  // Mounting brackets at each end (behind the bar, against the door)
  const bracketL = new THREE.BoxGeometry(0.05, 0.06, 0.02)
  bracketL.translate(-barWidth / 2 + 0.04, 0, -barDepth / 2 - 0.005)
  const bracketR = new THREE.BoxGeometry(0.05, 0.06, 0.02)
  bracketR.translate(barWidth / 2 - 0.04, 0, -barDepth / 2 - 0.005)
  return mergeGeometries([bar, bracketL, bracketR])!
})()

// ===== NEON TEXTURE CREATION (for VIDEOCLUB sign — kept as Canvas2D for the large title) =====
function createNeonTexture(text: string, width: number, height: number, fontSize: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  ctx.clearRect(0, 0, width, height)

  // Neon glow effect
  ctx.shadowColor = '#bb66ff'
  ctx.shadowBlur = 20
  ctx.font = `bold ${fontSize}px "Arial Black", Arial, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Draw text with glow (multiple passes for stronger glow)
  ctx.fillStyle = '#cc88ff'
  ctx.fillText(text, width / 2, height / 2)
  ctx.fillText(text, width / 2, height / 2)

  // Bright core
  ctx.shadowBlur = 5
  ctx.fillStyle = '#eeddff'
  ctx.fillText(text, width / 2, height / 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

// ===== NEON PANEL (same style as GenreSectionPanel — dark backing + neon border tubes + Caveat text) =====
const NEON_FONT_URL = '/fonts/caveat-bold.typeface.json'

// Shared geometries/materials for the neon panel
const NEON_BORDER_TUBE_GEOM = new THREE.CylinderGeometry(0.005, 0.005, 1, 5)
const NEON_PANEL_BG_MAT = new THREE.MeshStandardMaterial({ color: '#0a0a0a', roughness: 0.9, metalness: 0.0 })

// Dark glass for transom (above door) — the neon glow diffuses through this tinted panel.
// 30% transparency (opacity 0.70): mostly dark but neon emissive bleeds through.
const NEON_DARK_GLASS_MAT = new THREE.MeshPhysicalMaterial({
  color: '#0a1018',
  transparent: true,
  opacity: 0.70,           // 30% transparency — neon glow visible as diffuse light
  roughness: 0.08,
  metalness: 0.0,
  reflectivity: 0.6,
  envMapIntensity: 0.8,    // reduced reflections so transparency isn't blocked
  clearcoat: 1.0,
  clearcoatRoughness: 0.1,
  depthWrite: false,
  side: THREE.FrontSide,
})

// Canvas glow texture for diffuse halo behind the neon panel
function createNeonGlowTexture(color: string, width = 256, height = 128): THREE.CanvasTexture {
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
  return texture
}

// Z offset for neon panel: behind the glass (exterior side, visible only through glass)
const Z_NEON_EXT = 0.005

function NeonPanel({
  text,
  color,
  position,
  width = 0.85,
  textSize = 0.108,
}: {
  text: string
  color: string
  position: [number, number, number]
  width?: number
  textSize?: number
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const timeRef = useRef(0)

  const neonIntensity = useMemo(() => {
    const c = new THREE.Color(color)
    const luminance = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
    return THREE.MathUtils.clamp(1.3 / luminance, 1.3, 4.5)
  }, [color])

  const borderMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    emissive: new THREE.Color(color),
    emissiveIntensity: neonIntensity * 0.6,
    toneMapped: false,
    roughness: 0.3,
  }), [color, neonIntensity])

  const glowTexture = useMemo(() => createNeonGlowTexture(color), [color])

  useEffect(() => {
    return () => {
      borderMaterial.dispose()
      glowTexture.dispose()
    }
  }, [borderMaterial, glowTexture])

  // Neon flicker animation (text + border synchronized)
  useFrame((_, delta) => {
    timeRef.current += delta
    const flicker = 1.0 + Math.sin(timeRef.current * 8) * 0.03 + Math.sin(timeRef.current * 23) * 0.02
    if (meshRef.current) {
      const mat = meshRef.current.material as THREE.MeshStandardMaterial
      mat.emissiveIntensity = neonIntensity * flicker
    }
    borderMaterial.emissiveIntensity = neonIntensity * 0.6 * flicker
  })

  const height = width * 0.3
  const depth = 0.02
  const borderW = width * 0.92
  const borderH = height * 0.85

  return (
    <group position={position} rotation={[0, Math.PI, 0]}>
      {/* Glow halo behind the panel */}
      <mesh position={[0, 0, -0.02]}>
        <planeGeometry args={[width * 1.5, height * 2.0]} />
        <meshBasicMaterial
          map={glowTexture}
          transparent
          opacity={0.5}
          toneMapped={false}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* Dark background panel */}
      <mesh position={[0, 0, -depth / 2]} material={NEON_PANEL_BG_MAT}>
        <boxGeometry args={[width + 0.04, height + 0.04, depth]} />
      </mesh>

      {/* Neon text (Caveat Bold — same style as genre panels) */}
      <group position={[0, 0, depth / 2 + 0.004]}>
        <Center>
          <Suspense fallback={null}>
            <Text3D
              ref={meshRef}
              font={NEON_FONT_URL}
              size={textSize}
              height={0.02}
              bevelEnabled={false}
              curveSegments={10}
              letterSpacing={0.02}
            >
              {text}
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={neonIntensity}
                roughness={0.15}
                metalness={0.05}
                toneMapped={false}
              />
            </Text3D>
          </Suspense>
        </Center>
      </group>

      {/* Neon border tubes (rectangle frame around the sign) */}
      {/* Top */}
      <mesh geometry={NEON_BORDER_TUBE_GEOM} material={borderMaterial}
        position={[0, borderH / 2, depth / 2 + 0.005]} rotation={[0, 0, Math.PI / 2]} scale={[1, borderW, 1]} />
      {/* Bottom */}
      <mesh geometry={NEON_BORDER_TUBE_GEOM} material={borderMaterial}
        position={[0, -borderH / 2, depth / 2 + 0.005]} rotation={[0, 0, Math.PI / 2]} scale={[1, borderW, 1]} />
      {/* Left */}
      <mesh geometry={NEON_BORDER_TUBE_GEOM} material={borderMaterial}
        position={[-borderW / 2, 0, depth / 2 + 0.005]} scale={[1, borderH, 1]} />
      {/* Right */}
      <mesh geometry={NEON_BORDER_TUBE_GEOM} material={borderMaterial}
        position={[borderW / 2, 0, depth / 2 + 0.005]} scale={[1, borderH, 1]} />
    </group>
  )
}

// ===== PUSH PLATE TEXTURE (vertical — matches push.png reference) =====
function createPushPlateTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 384 // 1:3 ratio (vertical plate)
  const ctx = canvas.getContext('2d')!

  // Dark navy background (matches push.png)
  ctx.fillStyle = '#1a1a2e'
  ctx.fillRect(0, 0, 128, 384)

  // Metallic copper/bronze frame border
  ctx.strokeStyle = '#8a7a60'
  ctx.lineWidth = 6
  ctx.strokeRect(4, 4, 120, 376)

  // Inner subtle frame line
  ctx.strokeStyle = '#6a5a48'
  ctx.lineWidth = 2
  ctx.strokeRect(10, 10, 108, 364)

  // Light silver text "P-U-S-H" stacked vertically
  ctx.fillStyle = '#b0b0b8'
  ctx.font = 'bold 60px Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const letters = 'PUSH'
  const spacing = 384 / (letters.length + 1)
  for (let i = 0; i < letters.length; i++) {
    ctx.fillText(letters[i], 64, spacing * (i + 1))
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// ===== VITRINE POSTERS (individual component for texture lifecycle) =====
function VitrinePoster({ posterPath, position, width, height }: {
  posterPath: string | null
  position: [number, number, number]
  width: number
  height: number
}) {
  const posterUrl = posterPath
    ? `https://image.tmdb.org/t/p/w500${posterPath}`
    : null

  const texture = useMemo(() => {
    if (!posterUrl) return null
    return TextureCache.acquire(posterUrl)
  }, [posterUrl])

  useEffect(() => {
    return () => {
      if (posterUrl) TextureCache.release(posterUrl)
    }
  }, [posterUrl])

  const fallbackColors = ['#2a1a3a', '#1a2a3a', '#3a2a1a', '#1a3a2a', '#3a1a2a']
  const fallbackColor = fallbackColors[Math.abs(position[0] * 10) % fallbackColors.length | 0]

  return (
    <mesh position={position}>
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial
        map={texture}
        color={texture ? '#ffffff' : fallbackColor}
        roughness={0.6}
      />
    </mesh>
  )
}

// ===== MAIN COMPONENT =====
export function Storefront({ position, roomWidth, roomHeight, posterPaths }: StorefrontProps) {
  // PBR wall textures
  const wallTextures = useTexture({
    map: '/textures/storefront/color.jpg',
    normalMap: '/textures/storefront/normal.jpg',
    roughnessMap: '/textures/storefront/roughness.jpg',
    aoMap: '/textures/storefront/ao.jpg',
  })

  useMemo(() => {
    Object.entries(wallTextures).forEach(([key, tex]) => {
      const t = tex as THREE.Texture
      t.wrapS = THREE.RepeatWrapping
      t.wrapT = THREE.RepeatWrapping
      t.repeat.set(4, 1.5)
      t.anisotropy = 16
      t.colorSpace = key === 'map' ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace
    })
  }, [wallTextures])

  const wallMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    map: wallTextures.map as THREE.Texture,
    normalMap: wallTextures.normalMap as THREE.Texture,
    roughnessMap: wallTextures.roughnessMap as THREE.Texture,
    aoMap: wallTextures.aoMap as THREE.Texture,
    color: '#2a2a35',
    normalScale: new THREE.Vector2(0.6, 0.6),
  }), [wallTextures])

  // Neon texture (VIDEOCLUB title — Canvas2D for large banner)
  const videoClubNeonTex = useMemo(() => createNeonTexture('VIDEOCLUB', 1024, 192, 120), [])

  // Exterior backdrop (exterior.jpeg — placed at real 3D depth behind wall for geometric parallax)
  const exteriorTex = useTexture('/exterior.jpeg')

  const backdropMat = useMemo(() => {
    exteriorTex.colorSpace = THREE.SRGBColorSpace
    return new THREE.MeshStandardMaterial({
      map: exteriorTex,
      roughness: 0.95,
      emissive: '#111118',
      emissiveIntensity: 0.3,
      toneMapped: false,
    })
  }, [exteriorTex])

  // ===== WALL WITH HOLES (ShapeGeometry) =====
  // Real geometric depth: wall has actual cutouts for vitrine and door openings.
  // The exterior backdrop sits 1.5m behind the wall — the depth buffer provides
  // true perspective-correct parallax when the player moves.
  const wallWithHolesGeom = useMemo(() => {
    const halfW = roomWidth / 2

    // Wall shape (full rectangle)
    const wallShape = new THREE.Shape()
    wallShape.moveTo(-halfW, 0)
    wallShape.lineTo(halfW, 0)
    wallShape.lineTo(halfW, roomHeight)
    wallShape.lineTo(-halfW, roomHeight)
    wallShape.closePath()

    // Vitrine hole
    const vitLeft = VITRINE_CENTER_X - VITRINE_WIDTH / 2
    const vitRight = VITRINE_CENTER_X + VITRINE_WIDTH / 2
    const vitBottom = VITRINE_BOTTOM
    const vitTop = VITRINE_BOTTOM + VITRINE_HEIGHT
    const vitrineHole = new THREE.Path()
    vitrineHole.moveTo(vitLeft, vitBottom)
    vitrineHole.lineTo(vitRight, vitBottom)
    vitrineHole.lineTo(vitRight, vitTop)
    vitrineHole.lineTo(vitLeft, vitTop)
    vitrineHole.closePath()
    wallShape.holes.push(vitrineHole)

    // Door + transom hole (full height opening)
    const doorLeft = DOOR_CENTER_X - DOOR_WIDTH / 2
    const doorRight = DOOR_CENTER_X + DOOR_WIDTH / 2
    const doorHole = new THREE.Path()
    doorHole.moveTo(doorLeft, 0)
    doorHole.lineTo(doorRight, 0)
    doorHole.lineTo(doorRight, roomHeight)
    doorHole.lineTo(doorLeft, roomHeight)
    doorHole.closePath()
    wallShape.holes.push(doorHole)

    const geom = new THREE.ShapeGeometry(wallShape)

    // Fix UVs: ShapeGeometry generates UVs from shape coordinates (meters).
    // We need to normalize them to [0,1] range matching the PBR texture tiling.
    const uvAttr = geom.getAttribute('uv')
    for (let i = 0; i < uvAttr.count; i++) {
      const x = uvAttr.getX(i)
      const y = uvAttr.getY(i)
      // Map from [-halfW, halfW] to [0, 1] for X, [0, roomHeight] to [0, 1] for Y
      // Then the material's repeat (4, 1.5) handles the tiling
      uvAttr.setXY(i, (x + halfW) / roomWidth, y / roomHeight)
    }
    uvAttr.needsUpdate = true

    return geom
  }, [roomWidth, roomHeight])

  // PUSH plate texture (vertical — matches push.png reference)
  const pushPlateTex = useMemo(() => createPushPlateTexture(), [])

  // Poster layout: 6 top + 3 bottom (2 left + 1 right) — matches storefront.jpeg
  const topPosterW = 0.72
  const topPosterH = 0.95
  const topGapX = 0.08
  const topCols = 6
  const topTotalW = topCols * topPosterW + (topCols - 1) * topGapX // 4.72
  const topStartX = VITRINE_CENTER_X - topTotalW / 2 + topPosterW / 2
  const topY = VITRINE_BOTTOM + VITRINE_HEIGHT - 0.05 - topPosterH / 2 // ~1.775

  const botPosterW = 0.80
  const botPosterH = 0.65
  const botGapX = 0.08
  const vitrineLeft = VITRINE_CENTER_X - VITRINE_WIDTH / 2 // -3.4
  const vitrineRight = VITRINE_CENTER_X + VITRINE_WIDTH / 2 // 1.8
  const botY = VITRINE_BOTTOM + 0.05 + botPosterH / 2 // ~0.875
  // Bottom row: 2 posters left, 1 poster right
  const botPositions = [
    vitrineLeft + 0.1 + botPosterW / 2,                      // poster[6]
    vitrineLeft + 0.1 + botPosterW + botGapX + botPosterW / 2, // poster[7]
    vitrineRight - 0.1 - botPosterW / 2,                     // poster[8]
  ]

  // Vitrine frame bars (aluminum) — thinner than door frame
  const frameThickness = 0.04
  const frameDepth = 0.03
  // Door frame bars (stainless steel) — thicker/deeper
  const doorFrameThickness = 0.06
  const doorFrameDepth = 0.06

  // Cleanup
  useEffect(() => {
    return () => {
      wallMaterial.dispose()
      videoClubNeonTex.dispose()
      pushPlateTex.dispose()
      backdropMat.dispose()
      wallWithHolesGeom.dispose()
    }
  }, [wallMaterial, videoClubNeonTex, pushPlateTex, backdropMat, wallWithHolesGeom])

  return (
    <group position={position} rotation={[0, Math.PI, 0]}>
      {/* ===== WALL WITH HOLES (ShapeGeometry — real cutouts for vitrine + door) ===== */}
      {/* Geometric depth: the holes let you see through to the recessed backdrop behind */}
      <mesh position={[0, 0, Z_WALL]} geometry={wallWithHolesGeom} receiveShadow>
        <primitive object={wallMaterial} attach="material" />
      </mesh>

      {/* ===== EXTERIOR BACKDROP (real 3D depth — 1.5m behind wall) ===== */}
      {/* Single full-wall plane at Z_BACKDROP. Visible only through the wall holes. */}
      {/* True geometric parallax: moving left reveals the right side of the exterior, etc. */}
      <mesh position={[0, roomHeight / 2, Z_BACKDROP]} material={backdropMat}>
        <planeGeometry args={[roomWidth, roomHeight]} />
      </mesh>

      {/* ===== VITRINE POSTERS — 6 top + 3 bottom (2 left + 1 right) ===== */}
      {/* Top row: 6 posters */}
      {Array.from({ length: topCols }, (_, i) => (
        <VitrinePoster
          key={`vitrine-top-${i}`}
          posterPath={posterPaths[i] || null}
          position={[topStartX + i * (topPosterW + topGapX), topY, Z_POSTERS]}
          width={topPosterW}
          height={topPosterH}
        />
      ))}
      {/* Bottom row: 2 left + 1 right */}
      {botPositions.map((bx, i) => (
        <VitrinePoster
          key={`vitrine-bot-${i}`}
          posterPath={posterPaths[6 + i] || null}
          position={[bx, botY, Z_POSTERS]}
          width={botPosterW}
          height={botPosterH}
        />
      ))}

      {/* ===== VITRINE GLASS ===== */}
      <mesh position={[VITRINE_CENTER_X, VITRINE_BOTTOM + VITRINE_HEIGHT / 2, Z_GLASS]} material={GLASS_MAT}>
        <planeGeometry args={[VITRINE_WIDTH, VITRINE_HEIGHT]} />
      </mesh>

      {/* ===== VITRINE FRAME (aluminum) ===== */}
      {/* Top bar */}
      <mesh position={[VITRINE_CENTER_X, VITRINE_BOTTOM + VITRINE_HEIGHT + frameThickness / 2, Z_FRAME]} material={FRAME_MAT}>
        <boxGeometry args={[VITRINE_WIDTH + frameThickness * 2, frameThickness, frameDepth]} />
      </mesh>
      {/* Bottom bar */}
      <mesh position={[VITRINE_CENTER_X, VITRINE_BOTTOM - frameThickness / 2, Z_FRAME]} material={FRAME_MAT}>
        <boxGeometry args={[VITRINE_WIDTH + frameThickness * 2, frameThickness, frameDepth]} />
      </mesh>
      {/* Left bar */}
      <mesh position={[VITRINE_CENTER_X - VITRINE_WIDTH / 2 - frameThickness / 2, VITRINE_BOTTOM + VITRINE_HEIGHT / 2, Z_FRAME]} material={FRAME_MAT}>
        <boxGeometry args={[frameThickness, VITRINE_HEIGHT, frameDepth]} />
      </mesh>
      {/* Right bar */}
      <mesh position={[VITRINE_CENTER_X + VITRINE_WIDTH / 2 + frameThickness / 2, VITRINE_BOTTOM + VITRINE_HEIGHT / 2, Z_FRAME]} material={FRAME_MAT}>
        <boxGeometry args={[frameThickness, VITRINE_HEIGHT, frameDepth]} />
      </mesh>

      {/* ===== NEON "VIDEOCLUB" SIGN ===== */}
      <mesh position={[VITRINE_CENTER_X, NEON_SIGN_Y, Z_NEON]}>
        <planeGeometry args={[4.5, 0.5]} />
        <meshStandardMaterial
          map={videoClubNeonTex}
          transparent
          emissive="#9944cc"
          emissiveIntensity={2.5}
          toneMapped={false}
        />
      </mesh>

      {/* ===== DOOR ===== */}
      {/* Door glass (full height) */}
      <mesh position={[DOOR_CENTER_X, DOOR_HEIGHT / 2, Z_GLASS]} material={DOOR_GLASS_MAT}>
        <planeGeometry args={[DOOR_WIDTH - 0.08, DOOR_HEIGHT - 0.08]} />
      </mesh>
      {/* Door frame - left (full height: door + transom) */}
      <mesh position={[DOOR_CENTER_X - DOOR_WIDTH / 2 - doorFrameThickness / 2, roomHeight / 2, Z_FRAME]} material={DOOR_FRAME_MAT}>
        <boxGeometry args={[doorFrameThickness, roomHeight, doorFrameDepth]} />
      </mesh>
      {/* Door frame - right (full height: door + transom) */}
      <mesh position={[DOOR_CENTER_X + DOOR_WIDTH / 2 + doorFrameThickness / 2, roomHeight / 2, Z_FRAME]} material={DOOR_FRAME_MAT}>
        <boxGeometry args={[doorFrameThickness, roomHeight, doorFrameDepth]} />
      </mesh>
      {/* Door frame - top bar at ceiling */}
      <mesh position={[DOOR_CENTER_X, roomHeight - 0.02, Z_FRAME]} material={DOOR_FRAME_MAT}>
        <boxGeometry args={[DOOR_WIDTH + doorFrameThickness * 2, doorFrameThickness, doorFrameDepth]} />
      </mesh>
      {/* Push bar (replaces box handle) */}
      <mesh position={[DOOR_CENTER_X, 1.05, Z_NEON + 0.015]} geometry={PUSH_BAR_GEOM} material={PUSH_BAR_MAT} />

      {/* PUSH plate (vertical, on door glass interior — matches push.png reference) */}
      {/* 5% from the edge, opposite side */}
      <mesh position={[DOOR_CENTER_X - DOOR_WIDTH / 2 + DOOR_WIDTH * 0.05 + 0.03, 1.2, Z_GLASS + 0.002]}>
        <planeGeometry args={[0.06, 0.18]} />
        <meshStandardMaterial map={pushPlateTex} roughness={0.4} metalness={0.3} />
      </mesh>

      {/* ===== TRANSOM (imposte) above door ===== */}
      {/* Transom glass */}
      <mesh position={[DOOR_CENTER_X, (DOOR_HEIGHT + roomHeight) / 2, Z_GLASS]} material={DOOR_GLASS_MAT}>
        <planeGeometry args={[DOOR_WIDTH - 0.08, roomHeight - DOOR_HEIGHT - 0.08]} />
      </mesh>
      {/* Transom horizontal bar (separates door from transom) */}
      <mesh position={[DOOR_CENTER_X, DOOR_HEIGHT + doorFrameThickness / 2, Z_FRAME]} material={DOOR_FRAME_MAT}>
        <boxGeometry args={[DOOR_WIDTH + doorFrameThickness * 2, doorFrameThickness, doorFrameDepth]} />
      </mesh>

      {/* ===== KICKBOARD (split around door opening) ===== */}
      {/* Left segment: -roomWidth/2 to DOOR_CENTER_X - DOOR_WIDTH/2 */}
      <mesh position={[-1.15, KICKBOARD_HEIGHT / 2, Z_KICKBOARD]} material={KICKBOARD_MAT}>
        <boxGeometry args={[8.7, KICKBOARD_HEIGHT, 0.06]} />
      </mesh>
      {/* Right segment: DOOR_CENTER_X + DOOR_WIDTH/2 to +roomWidth/2 */}
      <mesh position={[4.85, KICKBOARD_HEIGHT / 2, Z_KICKBOARD]} material={KICKBOARD_MAT}>
        <boxGeometry args={[1.3, KICKBOARD_HEIGHT, 0.06]} />
      </mesh>
    </group>
  )
}
