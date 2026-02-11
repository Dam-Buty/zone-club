import { useRef, useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '../../store'
import { fetchVHSCoverData, generateVHSCoverTexture } from '../../utils/VHSCoverGenerator'
import type { Film } from '../../types'

// Preload the VHS case model
useGLTF.preload('/models/vhs_cassette_tape.glb', true)

// Reusable math objects (module-level, avoid per-frame allocation)
const _cameraWorldPos = new THREE.Vector3()
const _cameraDir = new THREE.Vector3()
const _targetPos = new THREE.Vector3()
const _right = new THREE.Vector3()
const _euler = new THREE.Euler()
const _qPortrait = new THREE.Quaternion()
const _qFace = new THREE.Quaternion()
const _qTilt = new THREE.Quaternion()
const _qTarget = new THREE.Quaternion()
const _yAxis = new THREE.Vector3(0, 1, 0)
const _worldUp = new THREE.Vector3(0, 1, 0)

// Precomputed: rotate model to portrait mode (model X=height → world Y=up)
// 90° around Z axis puts the case upright
const PORTRAIT_QUAT = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(0, 0, 1), Math.PI / 2
)

// Animation constants
const DISTANCE_FROM_CAMERA = 0.45 // meters in front of camera
const CASE_SCALE = 0.255          // model is ~2m tall → ~51cm
const TILT_ANGLE = (15 * Math.PI) / 180 // 15° backward tilt (mostly facing viewer)
const MANUAL_ROTATE_SPEED = 2.5   // rad/s
const ENTRY_DURATION = 0.3        // seconds
const FLIP_DURATION = 0.4         // seconds for 180° flip animation

interface VHSCaseViewerProps {
  film: Film
}

export function VHSCaseViewer({ film }: VHSCaseViewerProps) {
  const { camera } = useThree()
  const groupRef = useRef<THREE.Group>(null)
  const coverTextureRef = useRef<THREE.CanvasTexture | null>(null)
  const textureReadyRef = useRef(false)

  // Animation state refs (no re-renders)
  const manualRotationRef = useRef(0)
  const entryProgressRef = useRef(0) // 0→1 entry animation
  const timeRef = useRef(0)
  const isFlippedRef = useRef(false)
  const flipProgressRef = useRef(0)  // 0=front, 1=back
  const savedPitchRef = useRef(0)    // camera pitch when VHS opened
  const pitchCorrectedRef = useRef(false)

  // Store actions (stable refs)
  const setVHSCaseOpen = useStore(state => state.setVHSCaseOpen)

  // Load the GLB
  const { scene: glbScene } = useGLTF('/models/vhs_cassette_tape.glb', true)

  // Clone model and collect meshes that have a baseColor map (cover surfaces only)
  const { clonedScene, meshesWithMap } = useMemo(() => {
    const cloned = glbScene.clone(true)
    const meshes: THREE.Mesh[] = []

    cloned.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = false
        child.receiveShadow = false
        const mat = child.material as THREE.MeshStandardMaterial
        if (mat) {
          // Reduce specular reflections — matte VHS plastic look
          mat.roughness = Math.max(mat.roughness, 0.92)
          mat.metalness = Math.min(mat.metalness, 0.02)
          if (mat.map) {
            // Only include cover surfaces (1024×1024 atlas), not tape/reel meshes
            const mapImg = mat.map.image
            if (!mapImg || (mapImg.width >= 512 && mapImg.height >= 512)) {
              meshes.push(child)
            }
          }
        }
      }
    })

    return { clonedScene: cloned, meshesWithMap: meshes }
  }, [glbScene])

  // Signal VHS case is open + save camera pitch
  useEffect(() => {
    setVHSCaseOpen(true)
    // Save current camera pitch to restore on close
    const euler = new THREE.Euler()
    euler.setFromQuaternion(camera.quaternion, 'YXZ')
    savedPitchRef.current = euler.x
    pitchCorrectedRef.current = false
    return () => {
      setVHSCaseOpen(false)
      // Restore original camera pitch
      const e = new THREE.Euler()
      e.setFromQuaternion(camera.quaternion, 'YXZ')
      e.x = savedPitchRef.current
      camera.quaternion.setFromEuler(e)
    }
  }, [setVHSCaseOpen, camera])

  // Fetch cover data and generate texture
  useEffect(() => {
    let cancelled = false

    // Hide immediately + reset animation — visible restored in useFrame when texture ready
    textureReadyRef.current = false
    entryProgressRef.current = 0
    manualRotationRef.current = 0
    isFlippedRef.current = false
    flipProgressRef.current = 0
    if (groupRef.current) {
      groupRef.current.visible = false
    }

    fetchVHSCoverData(film).then(data => {
      if (cancelled) return
      const tex = generateVHSCoverTexture(data)

      // Dispose previous cover texture
      if (coverTextureRef.current) {
        coverTextureRef.current.dispose()
      }
      coverTextureRef.current = tex

      // Apply new texture to cover surfaces
      for (const mesh of meshesWithMap) {
        const mat = mesh.material as THREE.MeshStandardMaterial
        if (mat.map) {
          mat.map.dispose()
          mat.map = tex
          mat.needsUpdate = true
        }
      }

      textureReadyRef.current = true
    })

    return () => { cancelled = true }
  }, [film, meshesWithMap])

  // Cleanup cloned scene + textures on unmount
  useEffect(() => {
    return () => {
      if (coverTextureRef.current) {
        coverTextureRef.current.dispose()
        coverTextureRef.current = null
      }
      clonedScene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose()
          const mat = child.material
          if (Array.isArray(mat)) {
            mat.forEach(m => { m.map?.dispose(); m.dispose() })
          } else if (mat) {
            (mat as THREE.MeshStandardMaterial).map?.dispose()
            mat.dispose()
          }
        }
      })
    }
  }, [clonedScene])

  // Drag rotation state
  const isDraggingRef = useRef(false)
  const dragStartXRef = useRef(0)
  const dragAccumulatedRef = useRef(0)

  // Touch drag state
  const activeTouchIdRef = useRef<number | null>(null)
  const touchStartXRef = useRef(0)
  const touchStartTimeRef = useRef(0)

  // Q/E manual rotation + click/tap to flip + drag/touch to rotate
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyQ') {
        manualRotationRef.current -= MANUAL_ROTATE_SPEED * (e.repeat ? 0.03 : 0.05)
      } else if (e.code === 'KeyE') {
        manualRotationRef.current += MANUAL_ROTATE_SPEED * (e.repeat ? 0.03 : 0.05)
      }
    }

    // --- Mouse handlers (desktop) ---
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('button') || target.closest('[data-vhs-overlay]')) return
      isDraggingRef.current = false
      dragStartXRef.current = e.clientX
      dragAccumulatedRef.current = 0
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (e.buttons !== 1) return
      const dx = e.clientX - dragStartXRef.current
      if (!isDraggingRef.current && Math.abs(dx) > 5) {
        isDraggingRef.current = true
      }
      if (isDraggingRef.current) {
        const delta = (e.clientX - dragStartXRef.current - dragAccumulatedRef.current) * 0.008
        dragAccumulatedRef.current = e.clientX - dragStartXRef.current
        manualRotationRef.current += delta
      }
    }

    const handleMouseUp = (e: MouseEvent) => {
      if (!isDraggingRef.current) {
        const target = e.target as HTMLElement
        if (!target.closest('button') && !target.closest('[data-vhs-overlay]')) {
          const isOriginal = Math.abs(manualRotationRef.current) < 0.01 && !isFlippedRef.current
          if (isOriginal) {
            isFlippedRef.current = true
          } else {
            manualRotationRef.current = 0
            isFlippedRef.current = false
          }
        }
      }
      isDraggingRef.current = false
    }

    // --- Touch handlers (mobile) ---
    const handleTouchStart = (e: TouchEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('button') || target.closest('[data-vhs-overlay]')) return
      if (activeTouchIdRef.current !== null) return

      const touch = e.changedTouches[0]
      activeTouchIdRef.current = touch.identifier
      isDraggingRef.current = false
      dragStartXRef.current = touch.clientX
      dragAccumulatedRef.current = 0
      touchStartXRef.current = touch.clientX
      touchStartTimeRef.current = performance.now()
    }

    const handleTouchMove = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i]
        if (touch.identifier !== activeTouchIdRef.current) continue

        const dx = touch.clientX - dragStartXRef.current
        if (!isDraggingRef.current && Math.abs(dx) > 8) {
          isDraggingRef.current = true
        }
        if (isDraggingRef.current) {
          const delta = (touch.clientX - dragStartXRef.current - dragAccumulatedRef.current) * 0.008
          dragAccumulatedRef.current = touch.clientX - dragStartXRef.current
          manualRotationRef.current += delta
        }
        break
      }
    }

    const handleTouchEnd = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i]
        if (touch.identifier !== activeTouchIdRef.current) continue
        activeTouchIdRef.current = null

        // Tap detection: short + small displacement = flip/reset
        const dt = performance.now() - touchStartTimeRef.current
        const dist = Math.abs(touch.clientX - touchStartXRef.current)
        if (!isDraggingRef.current && dt < 300 && dist < 15) {
          const target = e.target as HTMLElement
          if (!target.closest('button') && !target.closest('[data-vhs-overlay]')) {
            const isOriginal = Math.abs(manualRotationRef.current) < 0.01 && !isFlippedRef.current
            if (isOriginal) {
              isFlippedRef.current = true
            } else {
              manualRotationRef.current = 0
              isFlippedRef.current = false
            }
          }
        }
        isDraggingRef.current = false
        break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('touchstart', handleTouchStart, { passive: true })
    document.addEventListener('touchmove', handleTouchMove, { passive: true })
    document.addEventListener('touchend', handleTouchEnd, { passive: true })
    document.addEventListener('touchcancel', handleTouchEnd, { passive: true })
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('touchstart', handleTouchStart)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
      document.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [])

  // Animation loop
  useFrame((_, delta) => {
    if (!groupRef.current) return
    timeRef.current += delta

    // Stay hidden until texture is ready
    if (!textureReadyRef.current) {
      groupRef.current.visible = false
      return
    }
    if (!groupRef.current.visible) {
      groupRef.current.visible = true
      entryProgressRef.current = 0 // start entry animation fresh
    }

    // Entry animation (scale 0 → 1)
    if (entryProgressRef.current < 1) {
      entryProgressRef.current = Math.min(1, entryProgressRef.current + delta / ENTRY_DURATION)
    }
    groupRef.current.scale.setScalar(CASE_SCALE * easeOutCubic(entryProgressRef.current))

    // Smoothly correct camera pitch to look at VHS case (center view)
    if (!pitchCorrectedRef.current) {
      _euler.setFromQuaternion(camera.quaternion, 'YXZ')
      _euler.x = THREE.MathUtils.lerp(_euler.x, 0, Math.min(1, delta * 2))
      camera.quaternion.setFromEuler(_euler)
      if (Math.abs(_euler.x) < 0.01) {
        _euler.x = 0
        camera.quaternion.setFromEuler(_euler)
        pitchCorrectedRef.current = true
      }
    }

    // Get camera state
    camera.getWorldPosition(_cameraWorldPos)
    camera.getWorldDirection(_cameraDir)

    // Extract yaw only (ignore pitch) for stable orientation
    _euler.setFromQuaternion(camera.quaternion, 'YXZ')
    const cameraYaw = _euler.y

    // Flat forward direction (yaw only, no pitch) for positioning
    _cameraDir.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw)).normalize()

    // Right axis from flat direction
    _right.crossVectors(_cameraDir, _worldUp).normalize()

    // Animate flip progress (0→1 or 1→0)
    const flipTarget = isFlippedRef.current ? 1 : 0
    const flipSpeed = 1 / FLIP_DURATION
    if (flipProgressRef.current < flipTarget) {
      flipProgressRef.current = Math.min(flipTarget, flipProgressRef.current + delta * flipSpeed)
    } else if (flipProgressRef.current > flipTarget) {
      flipProgressRef.current = Math.max(flipTarget, flipProgressRef.current - delta * flipSpeed)
    }
    const flipAngle = easeInOutCubic(flipProgressRef.current) * Math.PI

    // --- Quaternion rotation composition ---
    // 1. Portrait: model X (height) → world Y (up) via 90° around Z
    // 2. Face camera + flip + manual: rotate around Y axis
    // 3. Tilt: slight backward tilt for comfortable reading angle
    const faceAngle = cameraYaw - Math.PI / 2 + flipAngle + manualRotationRef.current

    _qPortrait.copy(PORTRAIT_QUAT)
    _qFace.setFromAxisAngle(_yAxis, faceAngle)
    _qTilt.setFromAxisAngle(_right, -TILT_ANGLE)

    // Compose: tilt * face * portrait (applied right-to-left in model space)
    _qTarget.copy(_qTilt).multiply(_qFace).multiply(_qPortrait)
    groupRef.current.quaternion.copy(_qTarget)

    // Position in front of camera at eye level (flat direction, fixed height)
    _targetPos.copy(_cameraWorldPos).addScaledVector(_cameraDir, DISTANCE_FROM_CAMERA)
    _targetPos.y = _cameraWorldPos.y // keep at eye level, ignore pitch
    groupRef.current.position.copy(_targetPos)

    // Loading pulse effect (before texture is ready)
    if (!textureReadyRef.current) {
      const pulse = 0.3 + Math.sin(timeRef.current * 4) * 0.15
      for (const mesh of meshesWithMap) {
        const mat = mesh.material as THREE.MeshStandardMaterial
        if (mat) {
          mat.emissive = mat.emissive || new THREE.Color()
          mat.emissive.setRGB(pulse * 0.3, 0, pulse * 0.5)
          mat.emissiveIntensity = 1
        }
      }
    } else {
      // Remove emissive once loaded
      for (const mesh of meshesWithMap) {
        const mat = mesh.material as THREE.MeshStandardMaterial
        if (mat && mat.emissiveIntensity > 0) {
          mat.emissiveIntensity = 0
        }
      }
    }
  })

  return (
    <group ref={groupRef}>
      <primitive object={clonedScene} />
      {/* Soft neon-tinted lighting matching video club ambiance */}
      <pointLight
        intensity={0.12}
        distance={1.5}
        color="#ff88c0"
        position={[0.3, 0.2, 0.4]}
      />
      <pointLight
        intensity={0.08}
        distance={1.5}
        color="#80ffee"
        position={[-0.3, 0.1, 0.3]}
      />
    </group>
  )
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
