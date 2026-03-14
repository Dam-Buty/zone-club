import { useMemo, useEffect, useRef, memo } from 'react'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import { RAYCAST_LAYER_INTERACTIVE } from './Controls'
import { useStore } from '../../store'
import type { ApiBoardNote } from '../../api'

// Grid layout in board local space (before parent scale)
const GRID_COLS = 8
const GRID_ROWS = 6
const GRID_WIDTH = 1.6   // usable width in local X
const GRID_HEIGHT = 1.0  // usable height in local Y
const NOTE_W = 0.17
const NOTE_H = 0.14
const NOTE_Z = 0.03      // offset in front of board surface
const GRID_Y_OFFSET = 0.64  // shift grid up (~45cm world @ scale 0.7)

const NOTE_COLORS: Record<string, string> = {
  yellow: '#d4c878',
  pink: '#c4829a',
  blue: '#7ab0c8',
  green: '#8ab88d',
}

function createNoteTexture(note: ApiBoardNote): THREE.CanvasTexture {
  const W = 512
  const H = 440
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!

  // Background
  ctx.fillStyle = NOTE_COLORS[note.color] || NOTE_COLORS.yellow
  ctx.fillRect(0, 0, W, H)

  // Subtle shadow on bottom/right edge
  ctx.fillStyle = 'rgba(0,0,0,0.06)'
  ctx.fillRect(W - 4, 8, 4, H)
  ctx.fillRect(8, H - 4, W, 4)

  // Folded corner
  const fold = 40
  ctx.fillStyle = 'rgba(0,0,0,0.08)'
  ctx.beginPath()
  ctx.moveTo(W, 0)
  ctx.lineTo(W - fold, 0)
  ctx.lineTo(W, fold)
  ctx.closePath()
  ctx.fill()

  // Pin at top center
  ctx.fillStyle = '#cc2222'
  ctx.beginPath()
  ctx.arc(W / 2, 22, 12, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#ff5555'
  ctx.beginPath()
  ctx.arc(W / 2 - 3, 19, 4, 0, Math.PI * 2)
  ctx.fill()

  // Text content — word wrap
  ctx.fillStyle = '#1a1a1a'
  ctx.font = 'bold 39px monospace'
  ctx.textBaseline = 'top'
  const maxW = W - 50
  const lineH = 46
  let y = 48
  const maxLines = 9
  let lineCount = 0
  const words = note.content.split(' ')
  let line = ''

  for (const word of words) {
    const test = line + (line ? ' ' : '') + word
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, 25, y)
      line = word
      y += lineH
      lineCount++
      if (lineCount >= maxLines) {
        ctx.fillText(line + '…', 25, y)
        line = ''
        break
      }
    } else {
      line = test
    }
  }
  if (line) ctx.fillText(line, 25, y)

  // Author — bottom right
  ctx.fillStyle = 'rgba(0,0,0,0.45)'
  ctx.font = 'italic 22px monospace'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  ctx.fillText(`— ${note.username}`, W - 20, H - 12)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

function getNotePosition(row: number, col: number): [number, number, number] {
  const x = (col / (GRID_COLS - 1) - 0.5) * GRID_WIDTH
  const y = (0.5 - row / (GRID_ROWS - 1)) * GRID_HEIGHT + GRID_Y_OFFSET
  return [x, y, NOTE_Z]
}

function getNoteRotation(row: number, col: number): number {
  return ((row * 7 + col * 13) % 7 - 3) * 1.2 * (Math.PI / 180)
}

// Single 3D sticky note
const BoardNote3D = memo(function BoardNote3D({ note }: { note: ApiBoardNote }) {
  const meshRef = useRef<THREE.Mesh>(null!)
  const texture = useMemo(
    () => createNoteTexture(note),
    [note.id, note.content, note.color, note.username]
  )

  useEffect(() => {
    meshRef.current.layers.enable(RAYCAST_LAYER_INTERACTIVE)
    return () => { texture.dispose() }
  }, [texture])

  const pos = getNotePosition(note.grid_row, note.grid_col)
  const rot = getNoteRotation(note.grid_row, note.grid_col)

  return (
    <mesh
      ref={meshRef}
      position={pos}
      rotation={[0, 0, rot]}
      userData={{ isBoardNote: true, noteId: note.id }}
    >
      <planeGeometry args={[NOTE_W, NOTE_H]} />
      <meshStandardMaterial map={texture} roughness={0.85} metalness={0} />
    </mesh>
  )
})

// Label texture "Ecrivez/Lisez un Post-it" — matches couch label style (cyan glow)
const LABEL_TEX = (() => {
  const W = 768, H = 128
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!

  const FONT = '"Courier New", Courier, monospace'

  // Text
  ctx.font = `bold 38px ${FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = '#00ffff'
  ctx.shadowBlur = 8
  ctx.fillStyle = '#00ffff'
  ctx.fillText('Ecrivez / Lisez un Post-it', W / 2, 40)

  // Arrow ▼
  ctx.font = `bold 54px ${FONT}`
  ctx.shadowBlur = 10
  ctx.fillText('\u25BC', W / 2, 95)

  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
})()

interface BoardMeshProps {
  position: [number, number, number]
  scale: number
  rotation: [number, number, number]
}

export const BoardMesh = memo(function BoardMesh({ position, scale, rotation }: BoardMeshProps) {
  const { scene } = useGLTF('/models/board.glb', true)
  const groupRef = useRef<THREE.Group>(null!)
  const boardNotes = useStore(s => s.boardNotes)

  const clonedScene = useMemo(() => {
    const cloned = scene.clone(true)
    cloned.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = false
        child.receiveShadow = true
        child.layers.enable(RAYCAST_LAYER_INTERACTIVE)
        child.userData.isBoard = true
      }
    })
    return cloned
  }, [scene])

  // Mark group so Controls can find it for worldToLocal conversion
  useEffect(() => {
    if (groupRef.current) groupRef.current.userData.isBoardGroup = true
  }, [])

  return (
    <group ref={groupRef} position={position} scale={scale} rotation={rotation}>
      <primitive object={clonedScene} />
      {boardNotes.map(note => (
        <BoardNote3D key={note.id} note={note} />
      ))}
      {/* Label above board */}
      <mesh position={[0, 1.55, 0.03]}>
        <planeGeometry args={[2.0, 0.35]} />
        <meshBasicMaterial map={LABEL_TEX} transparent toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  )
})
