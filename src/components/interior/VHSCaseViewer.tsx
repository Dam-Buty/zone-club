import { useRef, useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { bumpMap, texture, positionLocal, mix, float, clamp as tslClamp, uniform, vec3 } from 'three/tsl'
import { useStore } from '../../store'
import { fetchVHSCoverData, fetchVHSCoverDataFast, generateVHSCoverTexture, regenerateVHSCoverTexture, hasVHSCoverData } from '../../utils/VHSCoverGenerator'
import { useIsMobile } from '../../hooks/useIsMobile'
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

// Albedo dampening — base attenuation for scene lighting (IBL 0.7 + PointLights)
// Per-fragment Y-gradient correction is applied via TSL colorNode (see texture apply useEffect)
const ALBEDO_COLOR = new THREE.Color(0.89, 0.89, 0.89)

// Animation constants
const DISTANCE_FROM_CAMERA = 0.496  // meters in front of camera (+10%)
const CASE_SCALE = 0.255          // model is ~2m tall → ~51cm
const TILT_ANGLE = (3 * Math.PI) / 180 // 3° backward tilt — reduced from 10° to minimize ceiling light on top
const MANUAL_ROTATE_SPEED = 2.5   // rad/s
const ENTRY_DURATION = 0.3        // seconds
const FLIP_DURATION = 0.4         // seconds for 180° flip animation
const TEXTURE_FADE_DURATION = 0.3 // seconds for cover artwork fade-in

interface VHSCaseViewerProps {
  film: Film
}

export function VHSCaseViewer({ film }: VHSCaseViewerProps) {
  const { camera, scene } = useThree()
  const isMobile = useIsMobile()
  const groupRef = useRef<THREE.Group>(null)
  const coverTextureRef = useRef<THREE.CanvasTexture | null>(null)
  const textureReadyRef = useRef(false)

  // Animation state refs (no re-renders)
  const manualRotationRef = useRef(0)
  const entryProgressRef = useRef(0) // 0→1 entry animation
  const timeRef = useRef(0)
  const isFlippedRef = useRef(false)
  const flipProgressRef = useRef(0)  // 0=front, 1=back
  const fadeUniformRef = useRef<{ value: number } | null>(null) // TSL uniform for texture fade-in
  const fadeProgressRef = useRef(0)  // 0=blank, 1=fully textured
  const savedPitchRef = useRef(0)    // camera pitch when VHS opened
  const pitchCorrectedRef = useRef(false)
  const prevAnimatingRef = useRef(true) // track animation state changes for store
  const prevManualRotRef = useRef(0) // track Q/E rotation changes for idle detection

  // Store actions (stable refs)
  const setVHSCaseOpen = useStore(state => state.setVHSCaseOpen)

  // Load the GLB
  const { scene: glbScene } = useGLTF('/models/vhs_cassette_tape.glb', true)

  // Clone model and collect meshes that have a baseColor map (cover surfaces only)
  // CRITICAL: clone materials explicitly — glbScene.clone(true) shares materials by reference.
  // Without this, setting mat.map=null or colorNode on a shared material corrupts future instances.
  const { clonedScene, meshesWithMap } = useMemo(() => {
    const cloned = glbScene.clone(true)
    const meshes: THREE.Mesh[] = []

    cloned.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = false
        child.receiveShadow = false
        const origMat = child.material as THREE.MeshStandardMaterial
        if (origMat) {
          // Deep-clone material so original GLB materials stay pristine
          const mat = origMat.clone()
          child.material = mat
          // Matte VHS cardboard — no IBL sampling (perf: PMREM cubemap per-fragment is expensive)
          mat.roughness = 1.0
          mat.metalness = 0
          mat.envMap = null
          mat.envMapIntensity = 0
          // Kill clearcoat/sheen if GLB model has them
          if ('clearcoat' in mat) (mat as any).clearcoat = 0
          if ('sheen' in mat) (mat as any).sheen = 0
          mat.color.copy(ALBEDO_COLOR)
          if (mat.map) {
            // Only include cover surfaces (1024×1024 atlas), not tape/reel meshes
            const mapImg = mat.map.image as { width?: number; height?: number } | null
            if (!mapImg || ((mapImg.width ?? 0) >= 512 && (mapImg.height ?? 0) >= 512)) {
              meshes.push(child)
              // Hide GLB original texture immediately to prevent upside-down flash
              // (GLB atlas has different flipY than our generated cover texture)
              mat.map = null
            }
          }
        }
      }
    })

    return { clonedScene: cloned, meshesWithMap: meshes }
  }, [glbScene])

  // Signal VHS case is open + save camera pitch + dim scene overhead lights
  useEffect(() => {
    setVHSCaseOpen(true)
    useStore.getState().setVHSCaseAnimating(true) // entry animation starts
    // Save current camera pitch to restore on close
    const euler = new THREE.Euler()
    euler.setFromQuaternion(camera.quaternion, 'YXZ')
    savedPitchRef.current = euler.x
    pitchCorrectedRef.current = false

    // Dim scene lights + IBL to reduce glare on VHS case
    // Save original intensities to restore on close
    const savedLights: { light: THREE.Light; intensity: number }[] = []
    const savedEnvIntensity = scene.environmentIntensity

    scene.traverse((child) => {
      if (child instanceof THREE.PointLight) {
        savedLights.push({ light: child, intensity: child.intensity })
        child.intensity *= 0.7
      } else if (child instanceof THREE.DirectionalLight) {
        savedLights.push({ light: child, intensity: child.intensity })
        child.intensity *= 0.6
      } else if (child instanceof THREE.HemisphereLight) {
        savedLights.push({ light: child, intensity: child.intensity })
        child.intensity *= 0.75
      }
    })
    // Mild IBL dim for background focus — case receives full scene lighting
    scene.environmentIntensity = savedEnvIntensity * 0.85

    return () => {
      setVHSCaseOpen(false)
      // Restore original camera pitch
      const e = new THREE.Euler()
      e.setFromQuaternion(camera.quaternion, 'YXZ')
      e.x = savedPitchRef.current
      camera.quaternion.setFromEuler(e)
      // Restore original light intensities
      for (const { light, intensity } of savedLights) {
        light.intensity = intensity
      }
      scene.environmentIntensity = savedEnvIntensity
    }
  }, [setVHSCaseOpen, camera, scene])

  // 2-pass texture loading:
  // Pass 1 (~100-200ms): poster + Film metadata already in memory → visible immediately
  // Pass 2 (~1-3s): backdrops, logos, reviews, credits → canvas redrawn silently
  useEffect(() => {
    let cancelled = false

    // Reset animation state (case shown immediately as blank VHS)
    textureReadyRef.current = false
    entryProgressRef.current = 0
    manualRotationRef.current = 0
    isFlippedRef.current = false
    flipProgressRef.current = 0
    fadeProgressRef.current = 0
    fadeUniformRef.current = null

    // Helper: apply texture to GLB meshes via TSL colorNode (called once for pass 1)
    const applyTexture = (tex: THREE.CanvasTexture) => {
      const bumpTex = tex.userData.bumpMap as THREE.CanvasTexture | undefined
      const texNode = texture(tex)
      const albedoBase = float(1.0)
      const normalizedHeight = tslClamp(positionLocal.x.add(1.0).div(2.0), 0.0, 1.0)
      const correction = mix(float(1.03), float(0.97), normalizedHeight)
      const correctedColor = texNode.mul(albedoBase).mul(correction)

      const fadeU = uniform(0.0)
      fadeUniformRef.current = fadeU
      const blankColor = vec3(0.5, 0.5, 0.5)
      const fadedColor = mix(blankColor, correctedColor, fadeU)

      for (const mesh of meshesWithMap) {
        const mat = mesh.material as THREE.MeshStandardMaterial
        mat.map = null
        ;(mat as any).colorNode = fadedColor
        if (bumpTex) {
          ;(mat as any).normalNode = bumpMap(texture(bumpTex), 1.2)
        }
        mat.needsUpdate = true
      }

      coverTextureRef.current = tex
      textureReadyRef.current = true
    }

    // Pass 1: fast (poster + Film metadata)
    fetchVHSCoverDataFast(film).then(fastData => {
      if (cancelled) return
      const tex = generateVHSCoverTexture(fastData)
      applyTexture(tex)

      // Skip pass 2 if fast returned full cached data (already enriched)
      if (hasVHSCoverData(film.id)) return

      // Pass 2: enriched (backdrops, logos, reviews, credits)
      fetchVHSCoverData(film).then(enrichedData => {
        if (cancelled) return
        // Redraw same canvas with enriched data — needsUpdate triggers GPU re-upload
        regenerateVHSCoverTexture(tex, enrichedData)
      })
    })

    return () => { cancelled = true }
  }, [film, meshesWithMap])

  // Cleanup cloned scene on unmount (textures managed by LRU cache)
  useEffect(() => {
    return () => {
      coverTextureRef.current = null
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
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT') return
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

    // Show case immediately (blank VHS visible during texture load)
    if (!groupRef.current.visible) {
      groupRef.current.visible = true
      entryProgressRef.current = 0 // start entry animation fresh
    }

    // Entry animation (scale 0 → 1)
    if (entryProgressRef.current < 1) {
      entryProgressRef.current = Math.min(1, entryProgressRef.current + delta / ENTRY_DURATION)
    }
    groupRef.current.scale.setScalar(CASE_SCALE * easeOutCubic(entryProgressRef.current))

    // Fade cover artwork in once texture is ready (blank → textured)
    if (textureReadyRef.current && fadeUniformRef.current && fadeProgressRef.current < 1) {
      fadeProgressRef.current = Math.min(1, fadeProgressRef.current + delta / TEXTURE_FADE_DURATION)
      fadeUniformRef.current.value = easeOutCubic(fadeProgressRef.current)
    }

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
    // On mobile, raise the case slightly so it's above the retractable bottom sheet
    _targetPos.copy(_cameraWorldPos).addScaledVector(_cameraDir, DISTANCE_FROM_CAMERA)
    _targetPos.y = _cameraWorldPos.y + (isMobile ? 0.07 : 0)
    groupRef.current.position.copy(_targetPos)

    // Loading pulse effect (before texture is ready) — fades out during texture fade-in
    if (!textureReadyRef.current || fadeProgressRef.current < 1) {
      const pulse = 0.3 + Math.sin(timeRef.current * 4) * 0.15
      // Fade emissive out as texture fades in
      const emissiveScale = 1 - fadeProgressRef.current
      for (const mesh of meshesWithMap) {
        const mat = mesh.material as THREE.MeshStandardMaterial
        if (mat) {
          mat.emissive = mat.emissive || new THREE.Color()
          mat.emissive.setRGB(pulse * 0.3 * emissiveScale, 0, pulse * 0.5 * emissiveScale)
          mat.emissiveIntensity = 1
        }
      }
    } else {
      // Remove emissive once fully loaded
      for (const mesh of meshesWithMap) {
        const mat = mesh.material as THREE.MeshStandardMaterial
        if (mat && mat.emissiveIntensity > 0) {
          mat.emissiveIntensity = 0
        }
      }
    }

    // Signal idle state to PostProcessing for frame throttling
    // Idle = all animations done, no user interaction
    const flipTarget2 = isFlippedRef.current ? 1 : 0
    const manualRotChanged = Math.abs(manualRotationRef.current - prevManualRotRef.current) > 0.0001
    prevManualRotRef.current = manualRotationRef.current
    const isAnimating = entryProgressRef.current < 1 ||
      fadeProgressRef.current < 1 ||
      Math.abs(flipProgressRef.current - flipTarget2) > 0.001 ||
      isDraggingRef.current ||
      !pitchCorrectedRef.current ||
      manualRotChanged
    if (isAnimating !== prevAnimatingRef.current) {
      prevAnimatingRef.current = isAnimating
      useStore.getState().setVHSCaseAnimating(isAnimating)
    }
  })

  return (
    <group ref={groupRef}>
      <primitive object={clonedScene} />
      {/* No fill lights — case is lit by actual scene lights (IBL + PointLights + neons) */}
    </group>
  )
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
