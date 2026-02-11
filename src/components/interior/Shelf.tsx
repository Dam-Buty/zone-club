import { Cassette } from './Cassette'
import type { Film } from '../../types'

interface ShelfProps {
  position: [number, number, number]
  rotation?: [number, number, number]
  films: Film[]
}

const ROWS = 5
const CASSETTES_PER_ROW = 15
const CASSETTE_WIDTH = 0.15
const ROW_HEIGHT = 0.38
const SHELF_WIDTH = 2.5
const SHELF_HEIGHT = 2.2
const SHELF_DEPTH = 0.35

export function Shelf({
  position,
  rotation = [0, 0, 0],
  films,
}: ShelfProps) {
  return (
    <group position={position} rotation={rotation}>
      {/* Structure principale de l'étagère (bois) */}
      <mesh position={[0, SHELF_HEIGHT / 2 + 0.1, 0]} castShadow receiveShadow>
        <boxGeometry args={[SHELF_WIDTH, SHELF_HEIGHT, SHELF_DEPTH]} />
        <meshStandardMaterial color="#5a4a3a" roughness={0.7} />
      </mesh>

      {/* Planches horizontales */}
      {Array.from({ length: ROWS + 1 }).map((_, i) => (
        <mesh
          key={`plank-${i}`}
          position={[0, 0.15 + i * ROW_HEIGHT, SHELF_DEPTH / 2 - 0.02]}
          castShadow
        >
          <boxGeometry args={[SHELF_WIDTH - 0.05, 0.02, SHELF_DEPTH - 0.05]} />
          <meshStandardMaterial color="#4a3a2a" roughness={0.6} />
        </mesh>
      ))}

      {/* Cassettes */}
      {films.map((film, index) => {
        const row = Math.floor(index / CASSETTES_PER_ROW)
        const col = index % CASSETTES_PER_ROW

        if (row >= ROWS) return null

        // Position de la cassette
        const x = (col - CASSETTES_PER_ROW / 2) * CASSETTE_WIDTH + CASSETTE_WIDTH / 2
        const y = 0.25 + row * ROW_HEIGHT
        const z = SHELF_DEPTH / 2 + 0.02

        const cassetteKey = `shelf-${position[0].toFixed(1)}-${position[2].toFixed(1)}-${row}-${col}`
        return (
          <Cassette
            key={cassetteKey}
            position={[x, y, z]}
            film={film}
            cassetteKey={cassetteKey}
          />
        )
      })}
    </group>
  )
}
