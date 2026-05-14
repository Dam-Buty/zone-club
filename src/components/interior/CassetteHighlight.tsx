import { useRef, useMemo, useEffect, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore } from '../../store'
import { getCassetteWorldPosition } from '../../utils/cassetteRegistry'

/**
 * Soft blue halo billboard behind the highlighted K7. The cassette itself is
 * pushed forward + emissive-blue by `CassetteInstances` (reusing the existing
 * hover popout), and this plane sits a few cm behind it to add a wide glow
 * around the outline — replaces the earlier floating sphere marker.
 */
export function CassetteHighlight() {
  const highlightedCassetteKey = useStore((s) => s.highlightedCassetteKey)
  const meshRef = useRef<THREE.Mesh>(null)
  const [worldPos, setWorldPos] = useState<THREE.Vector3 | null>(null)
  const camera = useThree((s) => s.camera)

  // Resolve world position when the key changes. Re-attempt once after a tick
  // in case CassetteInstances finished registering after this component mounted.
  useEffect(() => {
    if (!highlightedCassetteKey) {
      setWorldPos(null)
      return
    }
    const p = getCassetteWorldPosition(highlightedCassetteKey)
    if (p) {
      setWorldPos(p)
      return
    }
    const t = setTimeout(() => {
      const p2 = getCassetteWorldPosition(highlightedCassetteKey)
      if (p2) setWorldPos(p2)
    }, 200)
    return () => clearTimeout(t)
  }, [highlightedCassetteKey])

  // Radial gradient texture: white center fading to transparent edge so the
  // material.color tint shows cleanly (otherwise a hard-coded blue gradient
  // would clash with the per-frame hue shift below).
  const haloMap = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 256
    c.height = 256
    const ctx = c.getContext('2d')
    if (!ctx) return null
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
    g.addColorStop(0.0, 'rgba(255, 255, 255, 1)')
    g.addColorStop(0.25, 'rgba(255, 255, 255, 0.85)')
    g.addColorStop(0.55, 'rgba(255, 255, 255, 0.40)')
    g.addColorStop(1.0, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 256, 256)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }, [])

  const material = useMemo(() => {
    if (!haloMap) return null
    return new THREE.MeshBasicMaterial({
      map: haloMap,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false, // bleed through shelves so the player can spot it
      toneMapped: false,
      side: THREE.DoubleSide,
    })
  }, [haloMap])

  useFrame((state) => {
    if (!meshRef.current || !worldPos || !material) return
    // Billboard: always face the camera.
    meshRef.current.lookAt(camera.position)
    const t = state.clock.elapsedTime
    // Pulse on scale — wider amplitude than the previous hover halo so the
    // K7 reads as a "deliberate" beacon from across the room.
    const s = 0.30 + 0.08 * Math.sin(t * 3)
    meshRef.current.scale.setScalar(s)
    // Hue cycle: green (H≈0.33) → blue (H≈0.66) → violet (H≈0.78) → back.
    // sin maps [-1,1] → hue in [0.33, 0.78]. ~2π / (1.4) ≈ 4.5s round-trip.
    const h = 0.555 + 0.225 * Math.sin(t * 1.4)
    material.color.setHSL(h, 1, 0.58)
  })

  if (!worldPos || !material) return null

  return (
    <mesh ref={meshRef} position={worldPos} material={material} renderOrder={5}>
      <planeGeometry args={[1, 1]} />
    </mesh>
  )
}
