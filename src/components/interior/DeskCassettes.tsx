import { useRef, useEffect, useMemo } from 'react'
import * as THREE from 'three/webgpu'
import { RAYCAST_LAYER_CASSETTE } from './Controls'
import type { Film } from '../../types'

interface DeskCassettesProps {
  films: Film[]
  position: [number, number, number]
}

// VHS tape dimensions (lying flat on desk)
const TAPE_W = 0.168
const TAPE_H = 0.03
const TAPE_D = 0.228
const SHARED_GEO = new THREE.BoxGeometry(TAPE_W, TAPE_H, TAPE_D)
const BLACK_MAT = new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.7 })

// Slight Y rotation per tape for natural stacked look
const TAPE_ROTATIONS = [-0.08, 0.05, -0.12]

export function DeskCassettes({ films, position }: DeskCassettesProps) {
  const meshRefs = useRef<(THREE.Mesh | null)[]>([null, null, null])
  const texturesRef = useRef<THREE.Texture[]>([])

  // Create per-tape materials with poster on top face (+Y)
  const materials = useMemo(() => {
    return [0, 1, 2].map(() => {
      // 6 faces: +X, -X, +Y, -Y, +Z, -Z
      return [
        BLACK_MAT, BLACK_MAT,
        BLACK_MAT, // +Y — will be replaced when poster loads
        BLACK_MAT,
        BLACK_MAT, BLACK_MAT,
      ] as THREE.Material[]
    })
  }, [])

  // Load poster textures when films change
  useEffect(() => {
    const loader = new THREE.TextureLoader()
    const textures: THREE.Texture[] = []

    films.forEach((film, i) => {
      if (!film.poster_path || i >= 3) return
      const url = `/api/poster/w185${film.poster_path}`
      loader.load(url, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        tex.needsUpdate = true
        textures.push(tex)

        const posterMat = new THREE.MeshStandardMaterial({
          map: tex,
          roughness: 0.65,
        })
        // Replace +Y face (index 2) with poster material
        materials[i][2] = posterMat

        // Force mesh material update
        const mesh = meshRefs.current[i]
        if (mesh) {
          mesh.material = materials[i]
        }
      })
    })

    texturesRef.current = textures
    return () => {
      textures.forEach(t => t.dispose())
    }
  }, [films, materials])

  // Set raycast layer + userData on mount
  useEffect(() => {
    meshRefs.current.forEach((mesh, i) => {
      if (!mesh) return
      mesh.layers.enable(RAYCAST_LAYER_CASSETTE)
      if (films[i]) {
        mesh.userData.filmId = films[i].id
        mesh.userData.cassetteKey = `desk-${i}`
        mesh.userData.isDeskCassette = true
      }
    })
  }, [films])

  return (
    <group position={position}>
      {[0, 1, 2].map((i) => (
        <mesh
          key={`desk-k7-${i}`}
          ref={(el) => { meshRefs.current[i] = el }}
          position={[0, i * 0.032, 0]}
          rotation={[0, TAPE_ROTATIONS[i], 0]}
          geometry={SHARED_GEO}
          material={materials[i]}
          castShadow
        />
      ))}
    </group>
  )
}
