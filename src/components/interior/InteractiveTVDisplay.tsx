import { useRef, useState, useMemo, useCallback, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useTexture } from '@react-three/drei'
import { useStore } from '../../store'
import { Couch } from './Couch'
import { RAYCAST_LAYER_INTERACTIVE } from './Controls'

// Preload Sony logo PNG
useTexture.preload('/logo-sony.png')

// --- VCR Toshiba W602: Shared materials (module-level, per memory rules) ---
// Reference: charcoal gray body, buttons slightly darker, door very dark
const vcrBodyMat = new THREE.MeshStandardMaterial({
  color: '#5a5862',
  roughness: 0.55,
  metalness: 0.08,
})
const vcrFootMat = new THREE.MeshStandardMaterial({
  color: '#4a4852',
  roughness: 0.65,
  metalness: 0.05,
})
const vcrButtonMat = new THREE.MeshStandardMaterial({
  color: '#45434d',
  roughness: 0.35,
  metalness: 0.08,
})
const vcrSlotMat = new THREE.MeshStandardMaterial({
  color: '#080808',
  roughness: 0.95,
  metalness: 0.0,
})
const vcrDisplayPanelMat = new THREE.MeshStandardMaterial({
  color: '#38363e',
  roughness: 0.65,
  metalness: 0.05,
})
const vcrSeparationMat = new THREE.MeshStandardMaterial({
  color: '#28262e',
  roughness: 0.8,
  metalness: 0.0,
})
const vcrDoorMat = new THREE.MeshStandardMaterial({
  color: '#1a1a1e',
  roughness: 0.85,
  metalness: 0.0,
})
// Fente K7: tons proches du body (#5a5862) mais légèrement plus sombres
const vcrFenteFrameMat = new THREE.MeshStandardMaterial({
  color: '#4a4852',
  roughness: 0.6,
  metalness: 0.05,
})
const vcrFenteDoorMat = new THREE.MeshStandardMaterial({
  color: '#3a3840',
  roughness: 0.7,
  metalness: 0.03,
})

// --- VCR LCD: 7-segment digit renderer (90s VCR style) ---
const SEG_MAP = [
  [1,1,1,1,1,1,0], // 0
  [0,1,1,0,0,0,0], // 1
  [1,1,0,1,1,0,1], // 2
  [1,1,1,1,0,0,1], // 3
  [0,1,1,0,0,1,1], // 4
  [1,0,1,1,0,1,1], // 5
  [1,0,1,1,1,1,1], // 6
  [1,1,1,0,0,0,0], // 7
  [1,1,1,1,1,1,1], // 8
  [1,1,1,1,0,1,1], // 9
]

function draw7Seg(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  digit: number, on: string, off: string
) {
  const s = SEG_MAP[digit]
  const t = Math.max(3, w * 0.14) // segment thickness
  const p = 2
  const mh = h / 2
  // a: top
  ctx.fillStyle = s[0] ? on : off
  ctx.fillRect(x + p + t, y, w - 2 * p - 2 * t, t)
  // b: top-right
  ctx.fillStyle = s[1] ? on : off
  ctx.fillRect(x + w - p - t, y + p, t, mh - p)
  // c: bottom-right
  ctx.fillStyle = s[2] ? on : off
  ctx.fillRect(x + w - p - t, y + mh + p, t, mh - p - t)
  // d: bottom
  ctx.fillStyle = s[3] ? on : off
  ctx.fillRect(x + p + t, y + h - t, w - 2 * p - 2 * t, t)
  // e: bottom-left
  ctx.fillStyle = s[4] ? on : off
  ctx.fillRect(x + p, y + mh + p, t, mh - p - t)
  // f: top-left
  ctx.fillStyle = s[5] ? on : off
  ctx.fillRect(x + p, y + p, t, mh - p)
  // g: middle
  ctx.fillStyle = s[6] ? on : off
  ctx.fillRect(x + p + t, y + mh - t / 2, w - 2 * p - 2 * t, t)
}

function renderLCDTime(canvas: HTMLCanvasElement, showColon: boolean) {
  const ctx = canvas.getContext('2d')!
  const w = canvas.width, h = canvas.height
  ctx.fillStyle = '#0a0a0a'
  ctx.fillRect(0, 0, w, h)

  const now = new Date()
  const hrs = String(now.getHours()).padStart(2, '0')
  const mins = String(now.getMinutes()).padStart(2, '0')

  const on = '#33ff44'
  const off = '#0a1a0a'
  const dw = 28, dh = 48
  const gap = 5
  const colonW = 14
  const totalW = 4 * dw + 3 * gap + colonW
  let x = (w - totalW) / 2
  const y = (h - dh) / 2

  // HH
  draw7Seg(ctx, x, y, dw, dh, parseInt(hrs[0]), on, off); x += dw + gap
  draw7Seg(ctx, x, y, dw, dh, parseInt(hrs[1]), on, off); x += dw + gap
  // colon
  const cx = x + colonW / 2 - 3
  ctx.fillStyle = showColon ? on : off
  ctx.fillRect(cx, y + dh * 0.28, 6, 6)
  ctx.fillRect(cx, y + dh * 0.62, 6, 6)
  x += colonW + gap
  // MM
  draw7Seg(ctx, x, y, dw, dh, parseInt(mins[0]), on, off); x += dw + gap
  draw7Seg(ctx, x, y, dw, dh, parseInt(mins[1]), on, off)
}

// --- VCR Toshiba W602: Shared geometries (module-level) ---
// Rounded rectangle for afficheur digital (largeur -5%: 0.221*0.95=0.210, radius ~0.003)
const displayShape = new THREE.Shape()
const _dw = 0.210 / 2, _dh = 0.033 / 2, _dr = 0.003
displayShape.moveTo(-_dw + _dr, -_dh)
displayShape.lineTo(_dw - _dr, -_dh)
displayShape.quadraticCurveTo(_dw, -_dh, _dw, -_dh + _dr)
displayShape.lineTo(_dw, _dh - _dr)
displayShape.quadraticCurveTo(_dw, _dh, _dw - _dr, _dh)
displayShape.lineTo(-_dw + _dr, _dh)
displayShape.quadraticCurveTo(-_dw, _dh, -_dw, _dh - _dr)
displayShape.lineTo(-_dw, -_dh + _dr)
displayShape.quadraticCurveTo(-_dw, -_dh, -_dw + _dr, -_dh)
const vcrDisplayGeo = new THREE.ShapeGeometry(displayShape)

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

// Rounded corner geometries for TV body (r=0.008, ~2px visual)
const _tvR = 0.008

// Front bezel frame: outer rounded rect 0.58×0.44, rectangular screen cutout
const tvBezelShape = new THREE.Shape()
const _bfw = 0.58 / 2, _bfh = 0.44 / 2
tvBezelShape.moveTo(-_bfw + _tvR, -_bfh)
tvBezelShape.lineTo(_bfw - _tvR, -_bfh)
tvBezelShape.quadraticCurveTo(_bfw, -_bfh, _bfw, -_bfh + _tvR)
tvBezelShape.lineTo(_bfw, _bfh - _tvR)
tvBezelShape.quadraticCurveTo(_bfw, _bfh, _bfw - _tvR, _bfh)
tvBezelShape.lineTo(-_bfw + _tvR, _bfh)
tvBezelShape.quadraticCurveTo(-_bfw, _bfh, -_bfw, _bfh - _tvR)
tvBezelShape.lineTo(-_bfw, -_bfh + _tvR)
tvBezelShape.quadraticCurveTo(-_bfw, -_bfh, -_bfw + _tvR, -_bfh)
// Screen cutout (CW for hole) — 0.51×0.38, center (0, 0.005)
const _scw = 0.51 / 2, _sch = 0.38 / 2, _sccy = 0.005
const tvScreenHole = new THREE.Path()
tvScreenHole.moveTo(-_scw, _sccy - _sch)
tvScreenHole.lineTo(-_scw, _sccy + _sch)
tvScreenHole.lineTo(_scw, _sccy + _sch)
tvScreenHole.lineTo(_scw, _sccy - _sch)
tvScreenHole.lineTo(-_scw, _sccy - _sch)
tvBezelShape.holes.push(tvScreenHole)
const tvBezelGeo = new THREE.ExtrudeGeometry(tvBezelShape, { depth: 0.08, bevelEnabled: false })

// Rear CRT housing: rounded rect 0.54×0.40, depth 0.30
const tvRearShape = new THREE.Shape()
const _rrw = 0.54 / 2, _rrh = 0.40 / 2
tvRearShape.moveTo(-_rrw + _tvR, -_rrh)
tvRearShape.lineTo(_rrw - _tvR, -_rrh)
tvRearShape.quadraticCurveTo(_rrw, -_rrh, _rrw, -_rrh + _tvR)
tvRearShape.lineTo(_rrw, _rrh - _tvR)
tvRearShape.quadraticCurveTo(_rrw, _rrh, _rrw - _tvR, _rrh)
tvRearShape.lineTo(-_rrw + _tvR, _rrh)
tvRearShape.quadraticCurveTo(-_rrw, _rrh, -_rrw, _rrh - _tvR)
tvRearShape.lineTo(-_rrw, -_rrh + _tvR)
tvRearShape.quadraticCurveTo(-_rrw, -_rrh, -_rrw + _tvR, -_rrh)
const tvRearGeo = new THREE.ExtrudeGeometry(tvRearShape, { depth: 0.30, bevelEnabled: false })
// Taper: CRT tube narrows from front (screen, z=depth) to back (z=0) — frustum shape
{
  const posAttr = tvRearGeo.attributes.position
  const taperX = 0.68 // back width = 68% of front
  const taperY = 0.72 // back height = 72% of front
  const d = 0.30
  for (let i = 0; i < posAttr.count; i++) {
    const z = posAttr.getZ(i)
    const t = 1.0 - z / d // 0 at front (z=depth), 1 at back (z=0)
    posAttr.setX(i, posAttr.getX(i) * (1.0 - t * (1.0 - taperX)))
    posAttr.setY(i, posAttr.getY(i) * (1.0 - t * (1.0 - taperY)))
  }
  posAttr.needsUpdate = true
  tvRearGeo.computeVertexNormals()
  tvRearGeo.computeBoundingSphere()
}

// Bottom control panel: rounded rect 0.60×0.10, depth 0.07
const tvPanelShape = new THREE.Shape()
const _tpw = 0.60 / 2, _tph = 0.10 / 2
tvPanelShape.moveTo(-_tpw + _tvR, -_tph)
tvPanelShape.lineTo(_tpw - _tvR, -_tph)
tvPanelShape.quadraticCurveTo(_tpw, -_tph, _tpw, -_tph + _tvR)
tvPanelShape.lineTo(_tpw, _tph - _tvR)
tvPanelShape.quadraticCurveTo(_tpw, _tph, _tpw - _tvR, _tph)
tvPanelShape.lineTo(-_tpw + _tvR, _tph)
tvPanelShape.quadraticCurveTo(-_tpw, _tph, -_tpw, _tph - _tvR)
tvPanelShape.lineTo(-_tpw, -_tph + _tvR)
tvPanelShape.quadraticCurveTo(-_tpw, -_tph, -_tpw + _tvR, -_tph)
const tvPanelGeo = new THREE.ExtrudeGeometry(tvPanelShape, { depth: 0.07, bevelEnabled: false })

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
  // Upper zone: canvas y=0..48 maps to 3D y=+0.0425..+0.010 (above separation)
  // Lower zone: canvas y=48..128 maps to 3D y=+0.010..-0.0425

  // --- Top-left: "TOSHIBA" (reference: far left, white, bold) ---
  ctx.font = 'bold 14px Arial, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#d0d0d0'
  ctx.fillText('TOSHIBA', 12, 8)

  // --- Center: "ONE MINUTE REWIND" (reference: LARGEST text, serif-style, white, bold)
  //     Centered at w*0.50 to align with cassette door (x=0 in 3D) ---
  ctx.font = 'bold 14px Georgia, "Times New Roman", serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#ffffff'
  ctx.fillText('ONE MINUTE REWIND', w * 0.50, 15)

  // --- Below: "NEW INTERACTIVE OSP" (reference: gold/amber, smaller italic) ---
  ctx.font = 'italic bold 9px Arial, sans-serif'
  ctx.fillStyle = '#c8a040'
  ctx.fillText('NEW INTERACTIVE OSP', w * 0.50, 33)

  // --- Right of display panel: "VHS" logo + "W602" ---
  //     Reference: VHS is a recognizable logo mark, W602 below it
  //     Position: right side of the display panel, clearly in upper zone
  ctx.textAlign = 'center'
  ctx.font = 'bold 13px Arial, sans-serif'
  ctx.fillStyle = '#ffffff'
  ctx.fillText('VHS', w * 0.80, 8)
  ctx.font = 'bold 10px Arial, sans-serif'
  ctx.fillStyle = '#cccccc'
  ctx.fillText('W602', w * 0.80, 24)

  // --- Bottom-left: "Hi-Fi STEREO PRO DRUM" (reference: gold, bottom edge) ---
  ctx.textAlign = 'left'
  ctx.font = 'bold 9px Arial, sans-serif'
  ctx.fillStyle = '#c8a040'
  ctx.fillText('Hi-Fi STEREO PRO DRUM', 12, h - 16)

  // --- Bottom-center: Energy Star logo placeholder ---
  ctx.font = '7px Arial, sans-serif'
  ctx.fillStyle = '#555555'
  ctx.textAlign = 'center'
  ctx.fillText('Energy ⭐', w * 0.42, h - 8)

  // --- Right side: transport labels (2×2 grid matching reference) ---
  // Canvas mapping: x = (3d_x + 0.215) / 0.43 * 512
  //                 y = (0.0425 - 3d_y) / 0.085 * 128
  // Buttons: x=0.155→441, x=0.192→485
  // Top row y=-0.005 → canvas≈72, Bottom row y=-0.023 → canvas≈99
  ctx.textAlign = 'center'
  ctx.font = 'bold 9px Arial, sans-serif'
  ctx.fillStyle = '#cccccc'
  // Top row labels (above buttons): REW left, FF right
  ctx.fillText('FF', 485, 56)
  ctx.fillText('▶▶', 485, 66)
  ctx.fillText('REW', 441, 56)
  ctx.fillText('◀◀', 441, 66)
  // Bottom row labels: PLAY left, STOP right
  ctx.fillText('▶ PLAY', 441, 90)
  ctx.fillText('■ STOP', 485, 90)

  // Left side: POWER / EJECT labels below buttons
  // POWER at 3D x=-0.190 → canvas x=30, EJECT at 3D x=-0.158 → canvas x=68
  ctx.textAlign = 'center'
  ctx.font = 'bold 7px Arial, sans-serif'
  ctx.fillStyle = '#cccccc'
  ctx.fillText('POWER', 30, 88)
  ctx.fillText('▲ EJECT', 68, 88)

  // CHANNEL label above buttons (3D x=-0.128 → canvas x=104)
  ctx.fillText('CHANNEL', 104, 53)

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

// --- Sony Trinitron: Front-face CanvasTexture with "Trinitron" label only ---
// Canvas maps to full front face (0.58 × 0.44), UV origin bottom-left
// "Trinitron" on top-left bezel. SONY logo is a separate mesh (PNG texture).
function createTVFrontTexture(): THREE.CanvasTexture {
  const w = 512
  const h = 512
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!

  // Transparent background

  // --- Top-left: "Trinitron" (silver, italic) — aligned with screen left edge ---
  ctx.font = 'italic 14px Arial, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#c0c0c8'
  ctx.fillText('Trinitron', 36, 19)

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
  const setSitting = useStore(state => state.setSitting)
  const isSitting = useStore(state => state.isSitting)
  const tvMenuAction = useStore(state => state.tvMenuAction)
  const clearTVMenuAction = useStore(state => state.clearTVMenuAction)

  const timeRef = useRef(0)

  // --- LCD clock display for VCR ---
  const lcdCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const lcdTextureRef = useRef<THREE.CanvasTexture | null>(null)
  const lcdColonRef = useRef(true)
  const lcdLastSecRef = useRef(-1)

  if (!lcdCanvasRef.current) {
    const c = document.createElement('canvas')
    c.width = 256
    c.height = 64
    lcdCanvasRef.current = c
    renderLCDTime(c, true)
    lcdTextureRef.current = new THREE.CanvasTexture(c)
  }

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

  // Uniform CRT font for all menus
  const CRT_FONT = '"Courier New", Courier, monospace'

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
    ctx.font = `bold 44px ${CRT_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#00ffff'
    ctx.fillText('CLICK POUR', w / 2, h / 2 - 30)
    ctx.fillText('OUVRIR LE MENU', w / 2, h / 2 + 30)

    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
  }, [])

  // Créer/mettre à jour la texture menu (film list + back option)
  const menuTexture = useMemo(() => {
    const w = 512
    const h = 340
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!

    // CRT scanline pattern
    for (let y = 0; y < h; y += 3) {
      ctx.fillStyle = 'rgba(0, 60, 55, 0.15)'
      ctx.fillRect(0, y, w, 1)
    }

    // Title
    ctx.font = `bold 28px ${CRT_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#00ffff'
    ctx.fillText('MES LOCATIONS', w / 2, 30)

    // Film list
    const totalItems = rentedFilms.length + 1 // +1 for back
    ctx.font = `bold 22px ${CRT_FONT}`
    rentedFilms.slice(0, 4).forEach((item, i) => {
      const isSelected = i === selectedIndex
      const prefix = isSelected ? '▶ ' : '  '
      const title = item.film?.title.substring(0, 16) || 'Film inconnu'
      ctx.fillStyle = isSelected ? '#00ffff' : '#008888'
      ctx.fillText(`${prefix}${title}`, w / 2, 80 + i * 40)
    })

    // Back option (always last)
    const backIdx = rentedFilms.slice(0, 4).length
    const backSelected = selectedIndex === backIdx
    ctx.fillStyle = backSelected ? '#00ffff' : '#666666'
    ctx.fillText(backSelected ? '▶ ← Retour' : '  ← Retour', w / 2, 80 + backIdx * 40 + 20)

    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
  }, [rentedFilms, selectedIndex])

  // Texture for seated main menu (Regarder un film / Paramètres / Se lever)
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

    const options = ['Regarder un film', 'Paramètres', '← Se lever']
    ctx.font = `bold 32px ${CRT_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    options.forEach((opt, i) => {
      const isSelected = i === seatedMenuIndex
      const prefix = isSelected ? '▶ ' : '  '
      ctx.fillStyle = isSelected ? '#00ffff' : (i === 2 ? '#666666' : '#008888')
      ctx.fillText(`${prefix}${opt}`, w / 2, 60 + i * 55)
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

    ctx.font = `bold 22px ${CRT_FONT}`
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

  // Texture pour le mode playing (with back indicator)
  const playingTexture = useMemo(() => {
    return createTextTexture('← Retour', {
      fontSize: 14,
      fontFamily: CRT_FONT,
      color: '#ff4444',
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

  // CRT reflection texture — baked fake reflections of shop neons + "NOUVEAUTÉS" reversed
  const crtReflectionTex = useMemo(() => {
    const w = 256
    const h = 192
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    // Canvas starts fully transparent

    // Draw each glow as a small circle, NOT filling full canvas
    // Cyan neon glow — top-left area
    const g1 = ctx.createRadialGradient(55, 40, 0, 55, 40, 60)
    g1.addColorStop(0, 'rgba(0, 220, 220, 0.18)')
    g1.addColorStop(0.5, 'rgba(0, 220, 220, 0.04)')
    g1.addColorStop(1, 'rgba(0, 220, 220, 0)')
    ctx.fillStyle = g1
    ctx.beginPath()
    ctx.arc(55, 40, 60, 0, Math.PI * 2)
    ctx.fill()

    // Pink neon glow — top-right
    const g2 = ctx.createRadialGradient(200, 35, 0, 200, 35, 50)
    g2.addColorStop(0, 'rgba(255, 80, 180, 0.12)')
    g2.addColorStop(0.5, 'rgba(255, 80, 180, 0.03)')
    g2.addColorStop(1, 'rgba(255, 80, 180, 0)')
    ctx.fillStyle = g2
    ctx.beginPath()
    ctx.arc(200, 35, 50, 0, Math.PI * 2)
    ctx.fill()

    // Warm yellow — center-left
    const g3 = ctx.createRadialGradient(40, 110, 0, 40, 110, 40)
    g3.addColorStop(0, 'rgba(255, 200, 80, 0.10)')
    g3.addColorStop(0.5, 'rgba(255, 200, 80, 0.02)')
    g3.addColorStop(1, 'rgba(255, 200, 80, 0)')
    ctx.fillStyle = g3
    ctx.beginPath()
    ctx.arc(40, 110, 40, 0, Math.PI * 2)
    ctx.fill()

    // "NOUVEAUTÉS" reversed (mirrored text) — soft red
    ctx.save()
    ctx.translate(w / 2 + 20, h * 0.45)
    ctx.scale(-1, 1)
    ctx.font = `bold 14px ${CRT_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = 'rgba(255, 40, 40, 0.12)'
    ctx.fillText('NOUVEAUTÉS', 0, 0)
    ctx.restore()

    // Thin fluorescent tube streaks
    ctx.fillStyle = 'rgba(180, 200, 255, 0.06)'
    ctx.fillRect(20, 75, 210, 1)
    ctx.fillStyle = 'rgba(180, 200, 255, 0.04)'
    ctx.fillRect(30, 130, 190, 1)

    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
  }, [])

  // VCR Toshiba W602 front-face texture (all text labels)
  const vcrFrontTexture = useMemo(() => createVCRFrontTexture(), [])

  // Sony Trinitron front-face texture ("Trinitron" only — SONY is a separate PNG mesh)
  const tvFrontTexture = useMemo(() => createTVFrontTexture(), [])

  // Sony logo: load PNG, invert black→silver, create bump texture for relief
  const sonyLogoRawTex = useTexture('/logo-sony.png')
  const sonyColorTex = useMemo(() => {
    const img = sonyLogoRawTex.image as HTMLImageElement
    if (!img?.width) return null
    const iw = img.width, ih = img.height

    // Color texture: black logo → silver, transparent bg stays transparent
    const cc = document.createElement('canvas')
    cc.width = iw; cc.height = ih
    const cctx = cc.getContext('2d')!
    cctx.drawImage(img, 0, 0)
    const cid = cctx.getImageData(0, 0, iw, ih)
    const cd = cid.data

    for (let i = 0; i < cd.length; i += 4) {
      if (cd[i + 3] > 20) {
        // Visible pixel (logo text) → silver, preserve alpha for anti-aliasing
        cd[i] = 200; cd[i + 1] = 200; cd[i + 2] = 210
      } else {
        cd[i + 3] = 0
      }
    }

    cctx.putImageData(cid, 0, 0)
    const ct = new THREE.CanvasTexture(cc)
    ct.needsUpdate = true
    return ct
  }, [sonyLogoRawTex])

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
      sonyColorTex?.dispose()
      crtReflectionTex?.dispose()
      videoTexture?.dispose()
      tvStandWoodMat?.dispose()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Animation et mise à jour de l'écran
  useFrame((_, delta) => {
    timeRef.current += delta

    // LCD clock update — every second, toggle colon
    const sec = new Date().getSeconds()
    if (sec !== lcdLastSecRef.current && lcdCanvasRef.current && lcdTextureRef.current) {
      lcdLastSecRef.current = sec
      lcdColonRef.current = !lcdColonRef.current
      renderLCDTime(lcdCanvasRef.current, lcdColonRef.current)
      lcdTextureRef.current.needsUpdate = true
    }

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
        // 3 options: Regarder(0), Paramètres(1), Se lever(2)
        setSeatedMenuIndex(prev =>
          tvMenuAction === 'up' ? Math.max(0, prev - 1) : Math.min(2, prev + 1)
        )
      } else if (tvMode === 'menu') {
        // Films + back option at the end
        const backIdx = Math.min(rentedFilms.length, 4)
        setSelectedIndex(prev =>
          tvMenuAction === 'up' ? Math.max(0, prev - 1) : Math.min(backIdx, prev + 1)
        )
      }
    } else if (tvMenuAction === 'select') {
      if (tvMode === 'seated-menu') {
        if (seatedMenuIndex === 0) {
          // "Regarder un film" → show film list
          setTvMode('menu')
          setSelectedIndex(0)
        } else if (seatedMenuIndex === 1) {
          // "Paramètres" → open terminal
          openTerminal()
          requestPointerUnlock()
        } else if (seatedMenuIndex === 2) {
          // "← Se lever" → stand up
          setSitting(false)
        }
      } else if (tvMode === 'menu') {
        const backIdx = Math.min(rentedFilms.length, 4)
        if (selectedIndex === backIdx) {
          // "← Retour" → back to seated menu
          setTvMode('seated-menu')
          setSeatedMenuIndex(0)
        } else if (rentedFilms.length > 0) {
          const selected = rentedFilms[selectedIndex]
          if (selected) {
            playVideo(selected.rental.videoUrl)
          }
        }
      } else if (tvMode === 'playing') {
        stopVideo()
      }
    } else if (tvMenuAction === 'back') {
      // Hierarchical back: playing → seated-menu, menu → seated-menu, seated-menu → stand up
      if (tvMode === 'playing') {
        stopVideo()
      } else if (tvMode === 'menu') {
        setTvMode('seated-menu')
      } else if (tvMode === 'seated-menu') {
        setSitting(false)
      }
    }

    clearTVMenuAction()
  }, [tvMenuAction, isSitting, tvMode, seatedMenuIndex, selectedIndex, rentedFilms, playVideo, stopVideo, openTerminal, requestPointerUnlock, clearTVMenuAction, setSitting])

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
      {/* Top shelf (TV sits here) — castShadow onto VCR below */}
      <mesh position={[0, 0.431, 0]} receiveShadow castShadow material={tvStandWoodMat}>
        <boxGeometry args={[0.65, 0.035, 0.45]} />
      </mesh>
      {/* Middle shelf (VCR sits here) — lowered 10% */}
      <mesh position={[0, 0.269, 0]} receiveShadow castShadow material={tvStandWoodMat}>
        <boxGeometry args={[0.63, 0.03, 0.43]} />
      </mesh>
      {/* Bottom shelf (base) */}
      <mesh position={[0, 0.035, 0]} receiveShadow material={tvStandWoodMat}>
        <boxGeometry args={[0.65, 0.035, 0.45]} />
      </mesh>
      {/* Left side panel — castShadow into cabinet */}
      <mesh position={[-0.31, 0.233, 0]} receiveShadow castShadow material={tvStandWoodMat}>
        <boxGeometry args={[0.035, 0.413, 0.45]} />
      </mesh>
      {/* Right side panel */}
      <mesh position={[0.31, 0.233, 0]} receiveShadow castShadow material={tvStandWoodMat}>
        <boxGeometry args={[0.035, 0.413, 0.45]} />
      </mesh>
      {/* Back panel (thin, stabilizing) */}
      <mesh position={[0, 0.233, -0.215]} receiveShadow material={tvStandWoodMat}>
        <boxGeometry args={[0.62, 0.413, 0.02]} />
      </mesh>

      {/* Fake AO — dark gradient inside VCR compartment (cheap, no GPU cost) */}
      {/* Shadow under top shelf — darkens the top of the VCR area */}
      <mesh position={[0, 0.41, 0.05]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.60, 0.40]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.35} depthWrite={false} />
      </mesh>
      {/* Shadow from back panel — fade from back to front */}
      <mesh position={[0, 0.35, -0.18]}>
        <planeGeometry args={[0.60, 0.14]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.25} depthWrite={false} />
      </mesh>

      {/* ====== Sony Trinitron CRT TV (4:3 aspect) ====== */}
      <group position={[0, 0.713, 0.155]} scale={1.15}>
        {/* Rear CRT housing (deep tube, rounded corners) — castShadow for shelf shadow */}
        <mesh position={[0, 0, -0.30]} material={tvBodyMat} geometry={tvRearGeo} castShadow />

        {/* Front bezel frame — rounded outer corners, sharp screen cutout */}
        <mesh position={[0, 0, -0.02]} material={tvBodyMat} geometry={tvBezelGeo} castShadow />

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

        {/* CRT glass overlay — tinted glass layer */}
        <mesh
          position={[0, 0.005, 0.063]}
          userData={{ isTVScreen: true }}
          ref={enableRaycastLayer}
        >
          <sphereGeometry args={[0.8, 20, 16, Math.PI - 0.325, 0.65, Math.PI / 2 - 0.24, 0.48]} />
          <meshStandardMaterial
            color="#a0b8b0"
            transparent
            opacity={isHovered ? 0.18 : 0.12}
            roughness={0.12}
            metalness={0.35}
          />
        </mesh>

        {/* Baked reflections — neon lights + "NOUVEAUTÉS" reversed, screen only */}
        <mesh position={[0, 0.005, 0.067]} renderOrder={3}>
          <planeGeometry args={[0.34, 0.22]} />
          <meshBasicMaterial
            map={crtReflectionTex}
            transparent
            opacity={1.0}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
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

        {/* TV feet — 4 rubber feet (dark), 1cm high under bezel corners */}
        <mesh position={[-0.18, -0.225, 0.02]} material={vcrFootMat}>
          <cylinderGeometry args={[0.015, 0.015, 0.01, 12]} />
        </mesh>
        <mesh position={[0.18, -0.225, 0.02]} material={vcrFootMat}>
          <cylinderGeometry args={[0.015, 0.015, 0.01, 12]} />
        </mesh>
        <mesh position={[-0.18, -0.225, -0.25]} material={vcrFootMat}>
          <cylinderGeometry args={[0.015, 0.015, 0.01, 12]} />
        </mesh>
        <mesh position={[0.18, -0.225, -0.25]} material={vcrFootMat}>
          <cylinderGeometry args={[0.015, 0.015, 0.01, 12]} />
        </mesh>

        {/* Sony logo — embossed silver PNG on bottom bezel, centered vertically */}
        {sonyColorTex && (
          <mesh position={[0, -0.20, 0.062]} renderOrder={2}>
            <planeGeometry args={[0.09, 0.035]} />
            <meshStandardMaterial
              map={sonyColorTex}
              transparent
              metalness={0.5}
              roughness={0.15}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        )}

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
      {/*
        Reference layout (vhs-player.webp):
        - Body: 0.43w × 0.085h × 0.30d
        - Upper zone (35%): y=0.010 to 0.0425 — TOSHIBA left, ONE MINUTE REWIND center, VHS W602 right
        - Display panel: 0.26w (60%), centered
        - Separation groove: y=0.010, full width
        - Lower zone (65%): y=-0.0425 to 0.010
          Left:  POWER(-0.190) EJECT(-0.158) side by side
          Left-center: CHANNEL ▲▼ (-0.128) stacked
          Center: Cassette door ~51% width (0.22w frame, 0.20w door), centered
          Right: Transport 2×2 (x=0.155/0.192, y=-0.005/-0.023)
      */}
      <group position={[0, 0.337, 0.05]}>
        {/* Main body — castShadow + receiveShadow for shelf shadows */}
        <mesh material={vcrBodyMat} castShadow receiveShadow>
          <boxGeometry args={[0.43, 0.085, 0.30]} />
        </mesh>

        {/* VCR feet — 4 rubber feet (dark), 1cm high at corners */}
        <mesh position={[-0.18, -0.0475, 0.12]} material={vcrFootMat}>
          <cylinderGeometry args={[0.012, 0.012, 0.01, 12]} />
        </mesh>
        <mesh position={[0.18, -0.0475, 0.12]} material={vcrFootMat}>
          <cylinderGeometry args={[0.012, 0.012, 0.01, 12]} />
        </mesh>
        <mesh position={[-0.18, -0.0475, -0.12]} material={vcrFootMat}>
          <cylinderGeometry args={[0.012, 0.012, 0.01, 12]} />
        </mesh>
        <mesh position={[0.18, -0.0475, -0.12]} material={vcrFootMat}>
          <cylinderGeometry args={[0.012, 0.012, 0.01, 12]} />
        </mesh>

        {/* === Fente K7 (cassette door) — UPPER zone, largeur +15% === */}
        {/* Door frame border */}
        <mesh position={[0, 0.026, 0.1505]} material={vcrFenteFrameMat}>
          <boxGeometry args={[0.222, 0.0316, 0.001]} />
        </mesh>
        {/* Door surface — slightly darker than frame */}
        <mesh position={[0, 0.024, 0.1507]} material={vcrFenteDoorMat}>
          <boxGeometry args={[0.202, 0.025, 0.001]} />
        </mesh>
        {/* Slot opening — thin black slit at top of door */}
        <mesh position={[0, 0.037, 0.1509]} material={vcrSlotMat}>
          <boxGeometry args={[0.202, 0.003, 0.001]} />
        </mesh>

        {/* Horizontal separation line */}
        <mesh position={[0, 0.010, 0.1505]} material={vcrSeparationMat}>
          <boxGeometry args={[0.43, 0.003, 0.001]} />
        </mesh>

        {/* === Afficheur digital — LOWER zone, rounded corners r=0.003 === */}
        <mesh position={[0, -0.0147, 0.1505]} material={vcrDisplayPanelMat} geometry={vcrDisplayGeo} />
        {/* LCD clock overlay — 7-segment time display, in front of text overlay */}
        <mesh position={[0, -0.0147, 0.154]} renderOrder={2}>
          <planeGeometry args={[0.14, 0.022]} />
          <meshBasicMaterial map={lcdTextureRef.current} toneMapped={false} transparent depthWrite={false} />
        </mesh>

        {/* Front text overlay (CanvasTexture) — z=0.152: in front of all decor, behind buttons */}
        <mesh position={[0, 0, 0.152]} renderOrder={1}>
          <planeGeometry args={[0.43, 0.085]} />
          <meshBasicMaterial
            map={vcrFrontTexture}
            transparent
            toneMapped={false}
            depthWrite={false}
          />
        </mesh>

        {/* --- Transport buttons (right side): 2×2 grid matching reference --- */}
        {/* Top row: FF (right) + REW (left) — shifted right to avoid overlap */}
        <mesh position={[0.155, -0.005, 0.153]} geometry={vcrButtonGeo} material={vcrButtonMat} />
        <mesh position={[0.192, -0.005, 0.153]} geometry={vcrButtonGeo} material={vcrButtonMat} />
        {/* Bottom row: PLAY (left) + STOP (right) */}
        <mesh position={[0.155, -0.023, 0.153]} geometry={vcrButtonGeo} material={vcrButtonMat} />
        <mesh position={[0.192, -0.023, 0.153]} geometry={vcrButtonGeo} material={vcrButtonMat} />

        {/* --- POWER button (far left of lower zone) --- */}
        <mesh position={[-0.190, -0.005, 0.153]} geometry={vcrSmallButtonGeo} material={vcrButtonMat} />
        {/* --- EJECT button --- */}
        <mesh position={[-0.158, -0.005, 0.153]} geometry={vcrSmallButtonGeo} material={vcrButtonMat} />

        {/* --- CHANNEL up/down (vertical stack, left of cassette door) --- */}
        <mesh position={[-0.128, 0.000, 0.153]} geometry={vcrChannelButtonGeo} material={vcrButtonMat} />
        <mesh position={[-0.128, -0.014, 0.153]} geometry={vcrChannelButtonGeo} material={vcrButtonMat} />

        {/* LED indicator — lowered by 0.010 */}
        <mesh position={[-0.195, 0.022, 0.153]}>
          <boxGeometry args={[0.008, 0.004, 0.003]} />
          <meshStandardMaterial
            color={tvMode === 'playing' ? '#ff0000' : '#00ff00'}
            emissive={tvMode === 'playing' ? '#ff0000' : '#00ff00'}
            emissiveIntensity={0.6}
            toneMapped={false}
          />
        </mesh>

        {/* Top edge bevel */}
        <mesh position={[0, 0.0435, 0.148]}>
          <boxGeometry args={[0.43, 0.003, 0.006]} />
          <meshStandardMaterial color="#58565e" roughness={0.4} metalness={0.12} />
        </mesh>
      </group>

      {/* Cassettes VHS empilées (bottom shelf) */}
      <group position={[-0.18, 0.058, 0.05]}>
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

      {/* Mini canapé devant la TV (face à l'écran) — reculé de 30cm */}
      <Couch
        position={[0, 0, 1.5]}
        rotation={[0, Math.PI, 0]}
        onSit={() => useStore.getState().setSitting(true)}
      />

      {/* Floating label above couch — always visible */}
      {!isSitting && couchLabelTexture && (
        <mesh position={[0, 1.0, 1.5]}>
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
