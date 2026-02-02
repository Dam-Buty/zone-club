import { useMemo } from 'react'

interface GameBoxProps {
  position: [number, number, number]
  color?: string
  index?: number
}

// Dimensions d'une boîte de jeu vidéo années 90 (légèrement plus grande que cassette VHS)
const BOX_WIDTH = 0.14
const BOX_HEIGHT = 0.20
const BOX_DEPTH = 0.03

// Couleurs de boîtiers de jeux typiques des années 80-90
const GAME_COLORS = [
  '#000066', // Bleu NES
  '#cc0000', // Rouge Nintendo
  '#006600', // Vert Game Boy
  '#333333', // Gris Sega
  '#990099', // Violet SNES
  '#ff6600', // Orange
]

export function GameBox({ position, color, index = 0 }: GameBoxProps) {
  const boxColor = useMemo(() => {
    if (color) return color
    return GAME_COLORS[index % GAME_COLORS.length]
  }, [color, index])

  return (
    <mesh position={position}>
      <boxGeometry args={[BOX_WIDTH, BOX_HEIGHT, BOX_DEPTH]} />
      <meshStandardMaterial
        color={boxColor}
        roughness={0.3}
        metalness={0.1}
      />
    </mesh>
  )
}

// Rack de jeux avec plusieurs boîtiers
interface GameRackProps {
  position: [number, number, number]
  rotation?: [number, number, number]
}

export function GameRack({ position, rotation = [0, 0, 0] }: GameRackProps) {
  const boxes = useMemo(() => {
    const result: { key: string; position: [number, number, number]; index: number }[] = []
    const cols = 8
    const rows = 4
    const spacing = 0.15

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = (col - cols / 2) * spacing * 0.5 + spacing * 0.25
        const y = 0.15 + row * 0.22
        const z = (col % 2) * 0.01 // Léger décalage pour effet naturel

        result.push({
          key: `game-${row}-${col}`,
          position: [x, y, z],
          index: row * cols + col,
        })
      }
    }
    return result
  }, [])

  return (
    <group position={position} rotation={rotation}>
      {/* Structure de l'étagère */}
      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[0.7, 1, 0.15]} />
        <meshStandardMaterial color="#2a2a35" roughness={0.6} />
      </mesh>

      {/* Planches horizontales */}
      {Array.from({ length: 5 }).map((_, i) => (
        <mesh key={`shelf-${i}`} position={[0, 0.08 + i * 0.22, 0.08]}>
          <boxGeometry args={[0.65, 0.015, 0.12]} />
          <meshStandardMaterial color="#3a3a45" roughness={0.5} />
        </mesh>
      ))}

      {/* Boîtiers de jeux */}
      <group position={[0, 0, 0.08]}>
        {boxes.map((box) => (
          <GameBox key={box.key} position={box.position} index={box.index} />
        ))}
      </group>
    </group>
  )
}
