import { useMemo, useEffect } from 'react'
import * as THREE from 'three'
import { useTexture } from '@react-three/drei'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { TextureCache } from '../../utils/TextureCache'
import { useKTX2Textures } from '../../hooks/useKTX2Textures'

interface StorefrontProps {
  position: [number, number, number]
  roomWidth: number
  roomHeight: number
  posterPaths: (string | null)[]
}

// ===== DIMENSIONS (from outside.jpeg analysis) =====
// Vitrine: large window left-center with posters
const VITRINE_WIDTH = 5.2
const VITRINE_HEIGHT = 2.28   // top aligns with door frame top bar (roomHeight - 0.02 - VITRINE_BOTTOM)
const VITRINE_BOTTOM = 0.5   // bottom edge above floor
const VITRINE_CENTER_X = -0.8 // shifted toward manager side (local -X = world +X after PI rotation)

// Door: right side
const DOOR_WIDTH = 1.0
const DOOR_HEIGHT = 2.3
const DOOR_CENTER_X = 3.0    // near right wall in local space (appears left from inside after PI rotation)

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

// Vitrine glass — dark tinted with IBL reflections via metalness.
// MeshStandardMaterial instead of Physical (no clearcoat = -50% fragment cost on glass).
const GLASS_MAT = new THREE.MeshStandardMaterial({
  color: '#1a2030',
  transparent: true,
  opacity: 0.15,
  roughness: 0.05,
  metalness: 0.3,
  envMapIntensity: 1.5,
  depthWrite: false,
  side: THREE.FrontSide,
})

// Door glass — same dark tint
const DOOR_GLASS_MAT = new THREE.MeshStandardMaterial({
  color: '#182028',
  transparent: true,
  opacity: 0.18,
  roughness: 0.05,
  metalness: 0.3,
  envMapIntensity: 1.5,
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

// Set to true once KTX2 textures have been generated via scripts/convert-textures-ktx2.sh
const USE_KTX2 = true

// Hook selector for storefront wall textures
function useStorefrontTexturesJPEG(): Record<string, THREE.Texture> {
  return useTexture({
    map: '/textures/storefront/color.jpg',
    normalMap: '/textures/storefront/normal.jpg',
    roughnessMap: '/textures/storefront/roughness.jpg',
    aoMap: '/textures/storefront/ao.jpg',
  }) as Record<string, THREE.Texture>
}
function useStorefrontTexturesKTX2(): Record<string, THREE.Texture> {
  return useKTX2Textures('/textures/storefront', 4, 1.5, true)
}
const useStorefrontTextures = USE_KTX2 ? useStorefrontTexturesKTX2 : useStorefrontTexturesJPEG

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
    const tex = TextureCache.acquire(posterUrl)
    if (tex) {
      // Mirror on X axis — posters are viewed from interior through a PI-rotated group
      tex.repeat.x = -1
      tex.offset.x = 1
      tex.wrapS = THREE.RepeatWrapping
    }
    return tex
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
  // PBR wall textures (KTX2 or JPEG depending on USE_KTX2 flag)
  const wallTextures = useStorefrontTextures()

  useMemo(() => {
    if (USE_KTX2) return // KTX2 hook handles configuration
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

  // Exterior backdrop (exterior.jpeg — placed at real 3D depth behind wall for geometric parallax)
  const exteriorTex = useTexture('/exterior.webp')

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

  // Poster layout: 6 top + 3 bottom — TMDB aspect ratio 2:3 (w:h)
  const topPosterW = 0.63
  const topPosterH = topPosterW * 1.5  // 0.945 — true 2:3 ratio
  const topGapX = 0.10
  const topCols = 6
  const topTotalW = topCols * topPosterW + (topCols - 1) * topGapX
  const topStartX = VITRINE_CENTER_X - topTotalW / 2 + topPosterW / 2
  const topY = VITRINE_BOTTOM + VITRINE_HEIGHT - 0.08 - topPosterH / 2

  const botPosterW = 0.578
  const botPosterH = botPosterW * 1.5  // 0.867 — true 2:3 ratio
  const botGapX = 0.10
  const vitrineLeft = VITRINE_CENTER_X - VITRINE_WIDTH / 2
  const vitrineRight = VITRINE_CENTER_X + VITRINE_WIDTH / 2
  const botY = VITRINE_BOTTOM + 0.08 + botPosterH / 2
  // Bottom row: 2 posters left, 1 poster right
  const botPositions = [
    vitrineLeft + 0.12 + botPosterW / 2,
    vitrineLeft + 0.12 + botPosterW + botGapX + botPosterW / 2,
    vitrineRight - 0.12 - botPosterW / 2,
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
      pushPlateTex.dispose()
      backdropMat.dispose()
      wallWithHolesGeom.dispose()
    }
  }, [wallMaterial, pushPlateTex, backdropMat, wallWithHolesGeom])

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
      <mesh position={[-1.0, KICKBOARD_HEIGHT / 2, Z_KICKBOARD]} material={KICKBOARD_MAT}>
        <boxGeometry args={[7.0, KICKBOARD_HEIGHT, 0.06]} />
      </mesh>
      {/* Right segment: DOOR_CENTER_X + DOOR_WIDTH/2 to +roomWidth/2 */}
      <mesh position={[4.0, KICKBOARD_HEIGHT / 2, Z_KICKBOARD]} material={KICKBOARD_MAT}>
        <boxGeometry args={[1.0, KICKBOARD_HEIGHT, 0.06]} />
      </mesh>
    </group>
  )
}
