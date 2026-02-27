import { useRef, useState, useMemo, useCallback, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useTexture } from '@react-three/drei'
import { useStore } from '../../store'
import { useIsMobile } from '../../hooks/useIsMobile'
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
// Screen cutout (CW for hole) — 0.517×0.386, center (0, 0.005) — bezel thinned 10%
const _scw = 0.517 / 2, _sch = 0.386 / 2, _sccy = 0.005
const tvScreenHole = new THREE.Path()
tvScreenHole.moveTo(-_scw, _sccy - _sch)
tvScreenHole.lineTo(-_scw, _sccy + _sch)
tvScreenHole.lineTo(_scw, _sccy + _sch)
tvScreenHole.lineTo(_scw, _sccy - _sch)
tvScreenHole.lineTo(-_scw, _sccy - _sch)
tvBezelShape.holes.push(tvScreenHole)
const tvBezelGeo = new THREE.ExtrudeGeometry(tvBezelShape, { depth: 0.08, bevelEnabled: false })

// Inner bezel recess frame — continuous ring around screen opening (no corner gaps)
// Outer rect = cutout dimensions, inner rect = cutout shrunk by recess thickness (0.008)
const _ibt = 0.008 // inner bezel thickness
const _ibtTop = 0.0036 // top edge thinner (45% of normal) — less visible shadow
const tvInnerBezelShape = new THREE.Shape()
tvInnerBezelShape.moveTo(-_scw, _sccy - _sch)
tvInnerBezelShape.lineTo(-_scw, _sccy + _sch)
tvInnerBezelShape.lineTo(_scw, _sccy + _sch)
tvInnerBezelShape.lineTo(_scw, _sccy - _sch)
tvInnerBezelShape.lineTo(-_scw, _sccy - _sch)
const tvInnerBezelHole = new THREE.Path()
tvInnerBezelHole.moveTo(-_scw + _ibt, _sccy - _sch + _ibt)
tvInnerBezelHole.lineTo(-_scw + _ibt, _sccy + _sch - _ibtTop)
tvInnerBezelHole.lineTo(_scw - _ibt, _sccy + _sch - _ibtTop)
tvInnerBezelHole.lineTo(_scw - _ibt, _sccy - _sch + _ibt)
tvInnerBezelHole.lineTo(-_scw + _ibt, _sccy - _sch + _ibt)
tvInnerBezelShape.holes.push(tvInnerBezelHole)
const tvInnerBezelGeo = new THREE.ExtrudeGeometry(tvInnerBezelShape, { depth: 0.005, bevelEnabled: false })

// CRT screen — curved plane geometry (replaces SphereGeometry radius 1.6 which extended ~2m beyond TV body)
// Gentle parabolic dome: 15mm bulge at center, zero at edges — matches real CRT curvature
const CRT_SCREEN_SEGS = 16
const CRT_BULGE = 0.015
const crtScreenGeo = new THREE.PlaneGeometry(_scw * 2, _sch * 2, CRT_SCREEN_SEGS, CRT_SCREEN_SEGS)
{
  const pos = crtScreenGeo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const nx = pos.getX(i) / _scw  // -1..1
    const ny = pos.getY(i) / _sch
    pos.setZ(i, CRT_BULGE * (1 - nx * nx) * (1 - ny * ny))
  }
  pos.needsUpdate = true
  crtScreenGeo.computeVertexNormals()
}

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

type TVMode = 'idle' | 'standing-menu' | 'seated-menu' | 'menu' | 'playing'
  | 'settings' | 'settings-rentals' | 'settings-history' | 'settings-reviews' | 'settings-credits' | 'settings-account'

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
  ctx.font = 'italic 13px Arial, sans-serif'
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

  const isMobile = useIsMobile()
  const [seatedMenuIndex, setSeatedMenuIndex] = useState(0)
  const [standingMenuIndex, setStandingMenuIndex] = useState(0)
  const [settingsMenuIndex, setSettingsMenuIndex] = useState(0)
  const [settingsSubIndex, setSettingsSubIndex] = useState(0)
  const [isHovered, setIsHovered] = useState(false)

  // Refs pour les textures dynamiques
  const idleTextureRef = useRef<THREE.CanvasTexture | null>(null)
  const menuTextureRef = useRef<THREE.CanvasTexture | null>(null)
  const indicatorTextureRef = useRef<THREE.CanvasTexture | null>(null)

  // Individual selectors to avoid re-rendering on unrelated store changes
  const rentals = useStore(state => state.rentals)
  const films = useStore(state => state.films)
  const openTerminal = useStore(state => state.openTerminal)
  const openTerminalAdmin = useStore(state => state.openTerminalAdmin)
  const openPlayer = useStore(state => state.openPlayer)
  const requestPointerUnlock = useStore(state => state.requestPointerUnlock)
  const setSitting = useStore(state => state.setSitting)
  const isSitting = useStore(state => state.isSitting)
  const isInteractingWithTV = useStore(state => state.isInteractingWithTV)
  const setInteractingWithTV = useStore(state => state.setInteractingWithTV)
  const tvMenuAction = useStore(state => state.tvMenuAction)
  const clearTVMenuAction = useStore(state => state.clearTVMenuAction)
  const isAuthenticated = useStore(state => state.isAuthenticated)
  const authUser = useStore(state => state.authUser)
  const localUser = useStore(state => state.localUser)
  const rentalHistory = useStore(state => state.rentalHistory)
  const userReviews = useStore(state => state.userReviews)

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
  const LX = 20 // left margin for all menus

  // Post-process: scanlines + Trinitron aperture grille (pixel-level, no blur)
  // Period 3: 1px per RGB stripe, every 3rd row darkened
  function applyCRT(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const imageData = ctx.getImageData(0, 0, w, h)
    const d = imageData.data
    for (let y = 0; y < h; y++) {
      const scanWeight = (y % 3 === 2) ? 0.6 : 1.0
      const row = y * w * 4
      for (let x = 0; x < w; x++) {
        const i = row + x * 4
        if (d[i + 3] === 0) continue
        const col = x % 3
        let r = d[i] * scanWeight
        let g = d[i + 1] * scanWeight
        let b = d[i + 2] * scanWeight
        if (col === 0) { g *= 0.45; b *= 0.45 }
        else if (col === 1) { r *= 0.45; b *= 0.45 }
        else { r *= 0.45; g *= 0.45 }
        d[i] = r | 0
        d[i + 1] = g | 0
        d[i + 2] = b | 0
      }
    }
    ctx.putImageData(imageData, 0, 0)
  }

  // Créer/mettre à jour la texture idle (3x canvas for CRT dot density)
  const idleTexture = useMemo(() => {
    const w = 1536
    const h = 768
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!

    ctx.font = `bold 102px ${CRT_FONT}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = '#00ffff'
    ctx.shadowBlur = 3
    ctx.fillStyle = '#00ffff'
    ctx.fillText('CLICK POUR', LX * 3, h / 2 - 90)
    ctx.fillText('OUVRIR LE MENU', LX * 3, h / 2 + 90)
    ctx.shadowBlur = 0
    applyCRT(ctx, w, h)

    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
  }, [])

  // Créer/mettre à jour la texture menu (film list + back option)
  const menuTexture = useMemo(() => {
    const w = 1536
    const h = 1020
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!

    // Title
    ctx.font = `bold 52px ${CRT_FONT}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = '#00ffff'
    ctx.shadowBlur = 3
    ctx.fillStyle = '#00ffff'
    ctx.fillText('MES LOCATIONS', LX * 3, 90)

    // Film list
    ctx.font = `bold 40px ${CRT_FONT}`
    rentedFilms.slice(0, 4).forEach((item, i) => {
      const isSelected = i === selectedIndex
      const prefix = isSelected ? '▶ ' : '  '
      const title = item.film?.title.substring(0, 16) || 'Film inconnu'
      ctx.shadowColor = isSelected ? '#00ffff' : '#009999'
      ctx.shadowBlur = isSelected ? 3 : 2
      ctx.fillStyle = isSelected ? '#00ffff' : '#009999'
      ctx.fillText(`${prefix}${title}`, LX * 3, 240 + i * 120)
    })

    // Back option (always last)
    const backIdx = rentedFilms.slice(0, 4).length
    const backSelected = selectedIndex === backIdx
    ctx.shadowColor = backSelected ? '#00ffff' : '#667777'
    ctx.shadowBlur = backSelected ? 6 : 4
    ctx.fillStyle = backSelected ? '#00ffff' : '#667777'
    ctx.fillText(backSelected ? '▶ ← Retour' : '  ← Retour', LX * 3, 240 + backIdx * 120 + 60)
    ctx.shadowBlur = 0
    applyCRT(ctx, w, h)

    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
  }, [rentedFilms, selectedIndex])

  // Texture for seated main menu (Regarder un film / Paramètres / Se lever)
  const seatedMenuTexture = useMemo(() => {
    const w = 1536
    const h = 768
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!

    const options = ['Regarder un film', 'Paramètres', '← Se lever']
    const seatedFontSize = isMobile ? 46 : 58
    ctx.font = `bold ${seatedFontSize}px ${CRT_FONT}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'

    const seatedOX = LX * 3 + w * 0.10  // +10% right
    const seatedOY = h * 0.05           // +5% down
    options.forEach((opt, i) => {
      const isSelected = i === seatedMenuIndex
      const prefix = isSelected ? '▶ ' : '  '
      ctx.shadowColor = isSelected ? '#00ffff' : '#009999'
      ctx.shadowBlur = isSelected ? 3 : 2
      ctx.fillStyle = isSelected ? '#00ffff' : '#009999'
      ctx.fillText(`${prefix}${opt}`, seatedOX, 180 + seatedOY + i * 165)
    })
    // Hint eject en bas du menu
    ctx.font = `24px ${CRT_FONT}`
    ctx.fillStyle = '#666666'
    ctx.shadowColor = '#444444'
    ctx.shadowBlur = 1
    ctx.fillText('\u23CF Appuyez sur Q pour se lever', seatedOX, h - 80)
    ctx.shadowBlur = 0
    applyCRT(ctx, w, h)

    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
  }, [seatedMenuIndex, isMobile])

  // Texture for standing TV menu (S'asseoir / Paramètres)
  const standingMenuTexture = useMemo(() => {
    const w = 1536
    const h = 768
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!

    const options = ['S\'asseoir pour regarder', 'Paramètres']
    ctx.font = `bold 58px ${CRT_FONT}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'

    options.forEach((opt, i) => {
      const isSelected = i === standingMenuIndex
      const prefix = isSelected ? '▶ ' : '  '
      ctx.shadowColor = isSelected ? '#00ffff' : '#009999'
      ctx.shadowBlur = isSelected ? 3 : 2
      ctx.fillStyle = isSelected ? '#00ffff' : '#009999'
      ctx.fillText(`${prefix}${opt}`, LX * 3, 260 + i * 165)
    })
    ctx.shadowBlur = 0
    applyCRT(ctx, w, h)

    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
  }, [standingMenuIndex])

  // Floating label above couch (text + downward arrow indicator)
  const couchLabelTexture = useMemo(() => {
    const w = 512
    const h = 128
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!

    // Text
    ctx.font = `bold 19px ${CRT_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = '#00ffff'
    ctx.shadowBlur = 8
    ctx.fillStyle = '#00ffff'
    ctx.fillText('Installez-vous dans le canapé', w / 2, 30)

    // Downward arrow (▼) below text
    ctx.font = `bold 27px ${CRT_FONT}`
    ctx.shadowBlur = 10
    ctx.fillText('▼', w / 2, 80)

    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
  }, [])

  // Texture pour le mode playing (with back indicator)
  const playingTexture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 600
    canvas.height = 120
    const ctx = canvas.getContext('2d')!
    ctx.font = `bold 32px ${CRT_FONT}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = '#ff4444'
    ctx.shadowBlur = 4
    ctx.fillStyle = '#ff4444'
    ctx.fillText('← Retour', 30, 60)
    ctx.shadowBlur = 0
    applyCRT(ctx, 600, 120)
    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
  }, [])

  // --- Settings CRT Textures (replacing old TVTerminal HTML overlay for Parametres) ---
  const SETTINGS_COLORS = {
    green: '#00ff00',
    greenDim: '#009900',
    cyan: '#00fff7',
    gold: '#ffd700',
    red: '#ff4444',
    pink: '#ff2d95',
    dimText: '#666666',
    label: '#888888',
  }

  const getFilmTitle = useCallback((filmId: number) => {
    const allFilms = Object.values(films).flat()
    return allFilms.find(f => f.id === filmId)?.title || 'Film inconnu'
  }, [films])

  const formatTimeRemaining = useCallback((expiresAt: number) => {
    const remaining = expiresAt - Date.now()
    if (remaining <= 0) return 'Expiré'
    const hours = Math.floor(remaining / (1000 * 60 * 60))
    const days = Math.floor(hours / 24)
    if (days > 0) return `${days}j ${hours % 24}h`
    if (hours > 0) return `${hours}h`
    return '<1h'
  }, [])

  const formatDate = useCallback((ts: number) => {
    return new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }, [])

  const settingsMenuItems = useMemo(() => {
    const items: { label: string; color: string; action: string }[] = []
    if (!isAuthenticated) {
      items.push({ label: "S'IDENTIFIER", color: SETTINGS_COLORS.cyan, action: 'auth' })
    }
    items.push({ label: `MES LOCATIONS (${rentals.length})`, color: SETTINGS_COLORS.green, action: 'rentals' })
    items.push({ label: 'HISTORIQUE', color: SETTINGS_COLORS.green, action: 'history' })
    items.push({ label: `MES CRITIQUES (${userReviews.length})`, color: SETTINGS_COLORS.gold, action: 'reviews' })
    items.push({ label: 'MES CREDITS', color: SETTINGS_COLORS.green, action: 'credits' })
    items.push({ label: 'MON COMPTE', color: SETTINGS_COLORS.green, action: 'account' })
    items.push({ label: 'RECHERCHER UN FILM', color: SETTINGS_COLORS.pink, action: 'search' })
    if (isAuthenticated) {
      items.push({ label: 'SE DECONNECTER', color: SETTINGS_COLORS.red, action: 'logout' })
    }
    items.push({ label: '← Retour', color: SETTINGS_COLORS.dimText, action: 'back' })
    return items
  }, [isAuthenticated, rentals.length, userReviews.length])

  // Settings main menu texture
  const settingsTexture = useMemo(() => {
    const w = 1536, h = 1020
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')!

    const settOX = LX * 3 + w * 0.13  // +13% right
    const settOY = h * 0.07           // +7% down
    ctx.font = `bold 48px ${CRT_FONT}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    if (isAuthenticated && authUser) {
      ctx.shadowColor = SETTINGS_COLORS.gold
      ctx.shadowBlur = 3
      ctx.fillStyle = SETTINGS_COLORS.gold
      ctx.fillText(`@ ${authUser.username.toUpperCase()}`, settOX, 65 + settOY)
    } else {
      ctx.shadowColor = SETTINGS_COLORS.green
      ctx.shadowBlur = 3
      ctx.fillStyle = SETTINGS_COLORS.green
      ctx.fillText('PARAMETRES', settOX, 65 + settOY)
    }

    ctx.font = `bold 38px ${CRT_FONT}`
    const startY = 160 + settOY
    const lineH = 85
    settingsMenuItems.forEach((item, i) => {
      const isSelected = i === settingsMenuIndex
      const prefix = isSelected ? '▶ ' : '  '
      ctx.shadowColor = item.color
      ctx.shadowBlur = isSelected ? 4 : 1
      ctx.fillStyle = isSelected ? item.color : (item.color + '99')
      ctx.fillText(`${prefix}${item.label}`, settOX, startY + i * lineH)
    })

    ctx.shadowBlur = 0
    applyCRT(ctx, w, h)
    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
  }, [settingsMenuIndex, settingsMenuItems, isAuthenticated, authUser])

  // Settings: MES LOCATIONS sub-screen
  const settingsRentalsTexture = useMemo(() => {
    const w = 1536, h = 1020
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')!
    const subOX = LX * 3 + w * 0.13
    const subOY = h * 0.07

    ctx.font = `bold 48px ${CRT_FONT}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = SETTINGS_COLORS.green
    ctx.shadowBlur = 3
    ctx.fillStyle = SETTINGS_COLORS.green
    ctx.fillText('MES LOCATIONS ACTIVES', subOX, 65 + subOY)

    if (rentals.length === 0) {
      ctx.font = `italic 32px ${CRT_FONT}`
      ctx.fillStyle = SETTINGS_COLORS.dimText
      ctx.shadowBlur = 0
      ctx.fillText('Aucune location en cours', subOX, 300 + subOY)
    } else {
      ctx.font = `bold 34px ${CRT_FONT}`
      const startY = 170 + subOY
      const lineH = 100
      const visibleRentals = rentals.slice(0, 7)
      const backIdx = visibleRentals.length

      visibleRentals.forEach((rental, i) => {
        const isSelected = i === settingsSubIndex
        const prefix = isSelected ? '▶ ' : '  '
        const title = getFilmTitle(rental.filmId).substring(0, 20)
        const remaining = formatTimeRemaining(rental.expiresAt)

        ctx.shadowColor = isSelected ? SETTINGS_COLORS.green : SETTINGS_COLORS.greenDim
        ctx.shadowBlur = isSelected ? 3 : 1
        ctx.fillStyle = isSelected ? SETTINGS_COLORS.green : SETTINGS_COLORS.greenDim
        ctx.fillText(`${prefix}${title}`, subOX, startY + i * lineH)

        ctx.font = `26px ${CRT_FONT}`
        ctx.fillStyle = SETTINGS_COLORS.dimText
        ctx.shadowBlur = 0
        ctx.fillText(`   ${remaining} - ▶ LIRE`, subOX + 60, startY + i * lineH + 38)
        ctx.font = `bold 34px ${CRT_FONT}`
      })

      const isBackSelected = settingsSubIndex === backIdx
      ctx.shadowColor = isBackSelected ? SETTINGS_COLORS.green : SETTINGS_COLORS.dimText
      ctx.shadowBlur = isBackSelected ? 3 : 1
      ctx.fillStyle = isBackSelected ? SETTINGS_COLORS.green : SETTINGS_COLORS.dimText
      ctx.fillText(isBackSelected ? '▶ ← Retour' : '  ← Retour', subOX, startY + backIdx * lineH + 30)
    }

    ctx.shadowBlur = 0
    applyCRT(ctx, w, h)
    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
  }, [rentals, settingsSubIndex, getFilmTitle, formatTimeRemaining])

  // Settings: HISTORIQUE sub-screen
  const settingsHistoryTexture = useMemo(() => {
    const w = 1536, h = 1020
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')!
    const subOX = LX * 3 + w * 0.13
    const subOY = h * 0.07

    ctx.font = `bold 48px ${CRT_FONT}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = SETTINGS_COLORS.green
    ctx.shadowBlur = 3
    ctx.fillStyle = SETTINGS_COLORS.green
    ctx.fillText('HISTORIQUE DES LOCATIONS', subOX, 65 + subOY)

    if (rentalHistory.length === 0) {
      ctx.font = `italic 32px ${CRT_FONT}`
      ctx.fillStyle = SETTINGS_COLORS.dimText
      ctx.shadowBlur = 0
      ctx.fillText('Aucun historique disponible', subOX, 300 + subOY)
    } else {
      ctx.font = `bold 34px ${CRT_FONT}`
      const startY = 170 + subOY
      const lineH = 90
      const reversed = [...rentalHistory].reverse().slice(0, 8)

      reversed.forEach((entry, i) => {
        const title = getFilmTitle(entry.filmId).substring(0, 22)
        ctx.shadowColor = SETTINGS_COLORS.green
        ctx.shadowBlur = 1
        ctx.fillStyle = SETTINGS_COLORS.green
        ctx.fillText(`  ${title}`, subOX, startY + i * lineH)

        ctx.font = `26px ${CRT_FONT}`
        ctx.fillStyle = SETTINGS_COLORS.dimText
        ctx.shadowBlur = 0
        ctx.fillText(`   Loué ${formatDate(entry.rentedAt)} - Rendu ${formatDate(entry.returnedAt)}`, subOX + 60, startY + i * lineH + 35)
        ctx.font = `bold 34px ${CRT_FONT}`
      })
    }

    ctx.font = `bold 34px ${CRT_FONT}`
    ctx.shadowColor = SETTINGS_COLORS.dimText
    ctx.shadowBlur = 1
    ctx.fillStyle = SETTINGS_COLORS.dimText
    ctx.fillText('▶ ← Retour', subOX, h - 60)

    ctx.shadowBlur = 0
    applyCRT(ctx, w, h)
    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
  }, [rentalHistory, getFilmTitle, formatDate])

  // Settings: MES CREDITS sub-screen
  const settingsCreditsTexture = useMemo(() => {
    const w = 1536, h = 768
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')!
    const subOX = LX * 3 + w * 0.13
    const subOY = h * 0.07

    ctx.font = `bold 48px ${CRT_FONT}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = SETTINGS_COLORS.green
    ctx.shadowBlur = 3
    ctx.fillStyle = SETTINGS_COLORS.green
    ctx.fillText('MES CREDITS', subOX, 65 + subOY)

    const credits = isAuthenticated && authUser ? authUser.credits : localUser.credits
    ctx.font = `bold 120px ${CRT_FONT}`
    ctx.textAlign = 'center'
    ctx.shadowColor = SETTINGS_COLORS.green
    ctx.shadowBlur = 8
    ctx.fillStyle = SETTINGS_COLORS.green
    ctx.fillText(`${credits}`, w / 2 + w * 0.065, 250 + subOY)

    ctx.font = `32px ${CRT_FONT}`
    ctx.shadowBlur = 2
    ctx.fillStyle = SETTINGS_COLORS.greenDim
    ctx.fillText(`crédit${credits > 1 ? 's' : ''} disponible${credits > 1 ? 's' : ''}`, w / 2 + w * 0.065, 330 + subOY)

    const level = localUser.level.toUpperCase()
    ctx.font = `bold 36px ${CRT_FONT}`
    ctx.textAlign = 'left'
    ctx.fillStyle = SETTINGS_COLORS.label
    ctx.shadowBlur = 0
    ctx.fillText('Niveau membre:', subOX, 440 + subOY)
    ctx.fillStyle = SETTINGS_COLORS.gold
    ctx.shadowColor = SETTINGS_COLORS.gold
    ctx.shadowBlur = 3
    ctx.fillText(level, subOX + 500, 440 + subOY)

    ctx.font = `bold 34px ${CRT_FONT}`
    ctx.shadowColor = SETTINGS_COLORS.dimText
    ctx.shadowBlur = 1
    ctx.fillStyle = SETTINGS_COLORS.dimText
    ctx.fillText('▶ ← Retour', subOX, h - 60)

    ctx.shadowBlur = 0
    applyCRT(ctx, w, h)
    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
  }, [isAuthenticated, authUser, localUser])

  // Settings: MON COMPTE sub-screen
  const settingsAccountTexture = useMemo(() => {
    const w = 1536, h = 1020
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')!

    const subOX = LX * 3 + w * 0.13  // aligned with settings menu
    const subOY = h * 0.07           // aligned with settings menu
    ctx.font = `bold 48px ${CRT_FONT}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = SETTINGS_COLORS.green
    ctx.shadowBlur = 3
    ctx.fillStyle = SETTINGS_COLORS.green
    ctx.fillText('MON COMPTE', subOX, 65 + subOY)

    const lineH = 75
    const startY = 180 + subOY
    const labelX = subOX
    const valueX = subOX + 620

    const rows: [string, string, string][] = []
    if (isAuthenticated && authUser) {
      rows.push(['Utilisateur', authUser.username, SETTINGS_COLORS.gold])
    }
    rows.push(['Niveau', localUser.level.toUpperCase(), SETTINGS_COLORS.gold])
    rows.push(['Total locations', `${rentals.length + rentalHistory.length}`, SETTINGS_COLORS.green])
    rows.push(['Crédits', `${isAuthenticated && authUser ? authUser.credits : localUser.credits}`, SETTINGS_COLORS.green])
    rows.push(['Locations actives', `${rentals.length}`, SETTINGS_COLORS.green])
    rows.push(['Critiques publiées', `${userReviews.length}`, SETTINGS_COLORS.green])

    ctx.font = `bold 34px ${CRT_FONT}`
    rows.forEach(([label, value, color], i) => {
      ctx.fillStyle = SETTINGS_COLORS.label
      ctx.shadowBlur = 0
      ctx.fillText(label, labelX, startY + i * lineH)
      ctx.fillStyle = color
      ctx.shadowColor = color
      ctx.shadowBlur = 2
      ctx.fillText(value, valueX, startY + i * lineH)
    })

    if (!isAuthenticated) {
      ctx.font = `italic 28px ${CRT_FONT}`
      ctx.fillStyle = SETTINGS_COLORS.dimText
      ctx.shadowBlur = 0
      ctx.fillText('Connectez-vous pour synchroniser', labelX, startY + rows.length * lineH + 30)
    }

    ctx.font = `bold 34px ${CRT_FONT}`
    ctx.shadowColor = SETTINGS_COLORS.dimText
    ctx.shadowBlur = 1
    ctx.fillStyle = SETTINGS_COLORS.dimText
    ctx.fillText('▶ ← Retour', labelX, h - 60)

    ctx.shadowBlur = 0
    applyCRT(ctx, w, h)
    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
  }, [isAuthenticated, authUser, localUser, rentals.length, rentalHistory.length, userReviews.length])

  // Texture indicateur films disponibles
  const indicatorTexture = useMemo(() => {
    if (rentedFilms.length === 0) return null
    const text = `${rentedFilms.length} FILM${rentedFilms.length > 1 ? 'S' : ''} DISPONIBLE${rentedFilms.length > 1 ? 'S' : ''}`
    return createTextTexture(text, {
      fontSize: 20,
      color: '#00ff00',
      glowColor: '#00ff00',
      width: 300,
      height: 50,
    })
  }, [rentedFilms.length])


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
      standingMenuTexture?.dispose()
      couchLabelTexture?.dispose()
      playingTexture?.dispose()
      indicatorTexture?.dispose()
      vcrFrontTexture?.dispose()
      tvFrontTexture?.dispose()
      sonyColorTex?.dispose()
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
    } else if (tvMode === 'standing-menu' || tvMode === 'seated-menu' || tvMode === 'menu') {
      material.emissiveIntensity = 0.8
    } else if (tvMode.startsWith('settings')) {
      material.emissiveIntensity = 0.85
    } else if (tvMode === 'playing') {
      material.emissiveIntensity = 1.0
    }
  })

  // Ouvre le player global (même flux que "Mes locations > Lire")
  const playVideo = useCallback((filmId: number) => {
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.currentTime = 0
    }
    requestPointerUnlock()
    openPlayer(filmId)
  }, [openPlayer, requestPointerUnlock])

  // Arrêter la vidéo (user-initiated film)
  const stopVideo = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.currentTime = 0
    }
    if (isSitting) {
      setTvMode('seated-menu')
    } else {
      setTvMode('idle')
    }
  }, [isSitting])

  // Show/hide standing menu when isInteractingWithTV changes
  useEffect(() => {
    if (isInteractingWithTV && !isSitting) {
      // Don't override settings mode — only show standing menu if idle
      if (!tvMode.startsWith('settings')) {
        setStandingMenuIndex(0)
        setTvMode('standing-menu')
      }
    } else if (!isInteractingWithTV && tvMode === 'standing-menu') {
      setTvMode('idle')
    }
  }, [isInteractingWithTV, isSitting]) // eslint-disable-line react-hooks/exhaustive-deps

  // React to TV menu actions dispatched by Controls via store
  useEffect(() => {
    if (!tvMenuAction) return

    // Standing menu actions (not sitting)
    if (tvMode === 'standing-menu' && isInteractingWithTV) {
      if (tvMenuAction === 'up' || tvMenuAction === 'down') {
        setStandingMenuIndex(prev =>
          tvMenuAction === 'up' ? Math.max(0, prev - 1) : Math.min(1, prev + 1)
        )
      } else if (tvMenuAction === 'select') {
        if (standingMenuIndex === 0) {
          // "S'asseoir pour regarder" → sit + go directly to film list
          setInteractingWithTV(false)
          setSitting(true)
          setTvMode('menu')
          setSelectedIndex(0)
        } else if (standingMenuIndex === 1) {
          // "Paramètres" → show settings menu on CRT
          setTvMode('settings')
          setSettingsMenuIndex(0)
        }
      } else if (tvMenuAction === 'back') {
        setInteractingWithTV(false)
      }
      clearTVMenuAction()
      return
    }

    // --- Settings modes (work regardless of sitting/standing) ---
    if (tvMode === 'settings') {
      if (tvMenuAction === 'up' || tvMenuAction === 'down') {
        const maxIdx = settingsMenuItems.length - 1
        setSettingsMenuIndex(prev =>
          tvMenuAction === 'up' ? Math.max(0, prev - 1) : Math.min(maxIdx, prev + 1)
        )
      } else if (tvMenuAction === 'select') {
        const item = settingsMenuItems[settingsMenuIndex]
        if (item) {
          switch (item.action) {
            case 'auth':
              useStore.getState().setPendingSettingsAction('auth')
              requestPointerUnlock()
              break
            case 'rentals':
              setTvMode('settings-rentals')
              setSettingsSubIndex(0)
              break
            case 'history':
              setTvMode('settings-history')
              break
            case 'reviews':
              setTvMode('settings-account') // reviews shown in account for now
              break
            case 'credits':
              setTvMode('settings-credits')
              break
            case 'account':
              setTvMode('settings-account')
              break
            case 'search':
              useStore.getState().setPendingSettingsAction('search')
              requestPointerUnlock()
              break
            case 'logout':
              useStore.getState().logout()
              setSettingsMenuIndex(0)
              break
            case 'back':
              if (isSitting) {
                setTvMode('seated-menu')
                setSeatedMenuIndex(0)
              } else {
                setTvMode('idle')
                setInteractingWithTV(false)
              }
              break
          }
        }
      } else if (tvMenuAction === 'back') {
        if (isSitting) {
          setTvMode('seated-menu')
          setSeatedMenuIndex(0)
        } else {
          setTvMode('idle')
          setInteractingWithTV(false)
        }
      }
      clearTVMenuAction()
      return
    }

    if (tvMode === 'settings-rentals') {
      const backIdx = Math.min(rentals.length, 7)
      if (tvMenuAction === 'up' || tvMenuAction === 'down') {
        setSettingsSubIndex(prev =>
          tvMenuAction === 'up' ? Math.max(0, prev - 1) : Math.min(backIdx, prev + 1)
        )
      } else if (tvMenuAction === 'select') {
        if (settingsSubIndex === backIdx || rentals.length === 0) {
          setTvMode('settings')
          setSettingsMenuIndex(0)
        } else {
          const rental = rentals[settingsSubIndex]
          if (rental) {
            playVideo(rental.filmId)
          }
        }
      } else if (tvMenuAction === 'back') {
        setTvMode('settings')
        setSettingsMenuIndex(0)
      }
      clearTVMenuAction()
      return
    }

    if (tvMode === 'settings-history' || tvMode === 'settings-credits' || tvMode === 'settings-account') {
      if (tvMenuAction === 'select' || tvMenuAction === 'back') {
        setTvMode('settings')
        setSettingsMenuIndex(0)
      }
      clearTVMenuAction()
      return
    }

    if (!isSitting) { clearTVMenuAction(); return }

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
          // "Paramètres" → show settings menu on CRT
          setTvMode('settings')
          setSettingsMenuIndex(0)
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
            playVideo(selected.rental.filmId)
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
  }, [tvMenuAction, isSitting, isInteractingWithTV, tvMode, seatedMenuIndex, selectedIndex, standingMenuIndex, settingsMenuIndex, settingsMenuItems, settingsSubIndex, rentedFilms, rentals, playVideo, stopVideo, openTerminal, requestPointerUnlock, clearTVMenuAction, setSitting, setInteractingWithTV])

  // Admin secret code detection in settings menu
  const adminBufferRef = useRef('')
  const adminTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!tvMode.startsWith('settings')) return
    if (!isAuthenticated || !authUser?.is_admin) return

    const handleAdminKey = (e: KeyboardEvent) => {
      if (e.key.length === 1 && /[a-z]/i.test(e.key)) {
        adminBufferRef.current = (adminBufferRef.current + e.key.toLowerCase()).slice(-5)
        // Reset buffer after 2s of inactivity
        if (adminTimerRef.current) clearTimeout(adminTimerRef.current)
        adminTimerRef.current = setTimeout(() => { adminBufferRef.current = '' }, 2000)

        if (adminBufferRef.current === 'admin') {
          adminBufferRef.current = ''
          openTerminalAdmin()
          requestPointerUnlock()
        }
      }
    }

    document.addEventListener('keydown', handleAdminKey)
    return () => {
      document.removeEventListener('keydown', handleAdminKey)
      if (adminTimerRef.current) clearTimeout(adminTimerRef.current)
    }
  }, [tvMode, isAuthenticated, authUser, openTerminalAdmin, requestPointerUnlock])

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
      // Standing up → stop user video, go idle
      if (tvMode === 'playing' && videoRef.current) {
        videoRef.current.pause()
        videoRef.current.currentTime = 0
      }
      setTvMode('idle')
    }
    prevSittingRef.current = isSitting
  }, [isSitting, tvMode, rentedFilms.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Couleur de l'écran selon le mode — greenish-teal like real Trinitron phosphor
  const screenColor = tvMode === 'playing' ? '#000000' : '#1a2e2b'

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
      <group position={[0, 0.758, 0.155]} scale={1.348}>
        {/* Rear CRT housing (deep tube, rounded corners) — castShadow for shelf shadow */}
        <mesh position={[0, 0, -0.30]} material={tvBodyMat} geometry={tvRearGeo} castShadow />

        {/* Front bezel frame — rounded outer corners, sharp screen cutout */}
        <mesh position={[0, 0, -0.02]} material={tvBodyMat} geometry={tvBezelGeo} castShadow />

        {/* Inner bezel shadow recess — continuous dark frame around screen opening */}
        <mesh position={[0, 0, 0.055]} material={tvInnerBezelMat} geometry={tvInnerBezelGeo} />

        {/* CRT screen — convex phosphor surface, curved plane matching bezel cutout */}
        <mesh
          ref={useCallback((node: THREE.Mesh | null) => {
            if (node) node.layers.enable(RAYCAST_LAYER_INTERACTIVE)
            ;(screenRef as React.MutableRefObject<THREE.Mesh | null>).current = node
          }, [])}
          position={[0, 0.005, 0.055]}
          userData={{ isTVScreen: true }}
          geometry={crtScreenGeo}
        >
          <meshStandardMaterial
            color={screenColor}
            emissive={screenColor}
            emissiveIntensity={1.0}
            map={tvMode === 'playing' ? videoTexture : null}
            toneMapped={false}
            transparent
            opacity={0.4}
          />
        </mesh>

        {/* Screen content overlays — Z=0.085 to clear curved screen (0.070) and glass (0.078) */}
        {tvMode === 'idle' && (
          <mesh position={[0, 0.005, 0.085]} userData={{ isTVScreen: true }} ref={enableRaycastLayer}>
            <planeGeometry args={[0.447, 0.239]} />
            <meshBasicMaterial map={idleTexture} transparent toneMapped={false} />
          </mesh>
        )}
        {tvMode === 'standing-menu' && (
          <mesh position={[0, -0.003, 0.085]} userData={{ isTVScreen: true }} ref={enableRaycastLayer}>
            <planeGeometry args={[0.461, 0.337]} />
            <meshBasicMaterial map={standingMenuTexture} transparent toneMapped={false} />
          </mesh>
        )}
        {tvMode === 'seated-menu' && (
          <mesh position={[0, -0.003, 0.085]} userData={{ isTVScreen: true }} ref={enableRaycastLayer}>
            <planeGeometry args={[0.461, 0.337]} />
            <meshBasicMaterial map={seatedMenuTexture} transparent toneMapped={false} />
          </mesh>
        )}
        {tvMode === 'menu' && (
          <mesh position={[0, -0.003, 0.085]} userData={{ isTVScreen: true }} ref={enableRaycastLayer}>
            <planeGeometry args={[0.461, 0.337]} />
            <meshBasicMaterial map={menuTexture} transparent toneMapped={false} />
          </mesh>
        )}
        {tvMode === 'playing' && (
          <mesh position={[0, -0.1, 0.085]} userData={{ isTVScreen: true }} ref={enableRaycastLayer}>
            <planeGeometry args={[0.282, 0.050]} />
            <meshBasicMaterial map={playingTexture} transparent toneMapped={false} />
          </mesh>
        )}
        {tvMode === 'settings' && (
          <mesh position={[0, -0.003, 0.085]} userData={{ isTVScreen: true }} ref={enableRaycastLayer}>
            <planeGeometry args={[0.461, 0.337]} />
            <meshBasicMaterial map={settingsTexture} transparent toneMapped={false} />
          </mesh>
        )}
        {tvMode === 'settings-rentals' && (
          <mesh position={[0, -0.003, 0.085]} userData={{ isTVScreen: true }} ref={enableRaycastLayer}>
            <planeGeometry args={[0.461, 0.337]} />
            <meshBasicMaterial map={settingsRentalsTexture} transparent toneMapped={false} />
          </mesh>
        )}
        {tvMode === 'settings-history' && (
          <mesh position={[0, -0.003, 0.085]} userData={{ isTVScreen: true }} ref={enableRaycastLayer}>
            <planeGeometry args={[0.461, 0.337]} />
            <meshBasicMaterial map={settingsHistoryTexture} transparent toneMapped={false} />
          </mesh>
        )}
        {tvMode === 'settings-credits' && (
          <mesh position={[0, -0.003, 0.085]} userData={{ isTVScreen: true }} ref={enableRaycastLayer}>
            <planeGeometry args={[0.461, 0.337]} />
            <meshBasicMaterial map={settingsCreditsTexture} transparent toneMapped={false} />
          </mesh>
        )}
        {tvMode === 'settings-account' && (
          <mesh position={[0, -0.003, 0.085]} userData={{ isTVScreen: true }} ref={enableRaycastLayer}>
            <planeGeometry args={[0.461, 0.337]} />
            <meshBasicMaterial map={settingsAccountTexture} transparent toneMapped={false} />
          </mesh>
        )}

        {/* CRT glass overlay removed — was causing Z-fighting with curved screen geometry */}

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
            <planeGeometry args={[0.081, 0.0315]} />
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
        position={[0, 0, 1.34]}
        rotation={[0, Math.PI, 0]}
        onSit={() => useStore.getState().setSitting(true)}
      />

      {/* Floating label above couch — always visible, with arrow pointing down */}
      {!isSitting && couchLabelTexture && (
        <mesh position={[0, 1.2, 1.34]}>
          <planeGeometry args={[0.8, 0.2]} />
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
