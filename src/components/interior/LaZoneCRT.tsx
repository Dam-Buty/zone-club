import { useRef, useMemo, useState, useCallback, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { RAYCAST_LAYER_INTERACTIVE } from './Controls'
import { useStore } from '../../store'

useGLTF.preload('/models/crt_tv.glb', true)

// CRT screen aspect ratio (4:3) — used for "cover on height" texture mapping
const CRT_SCREEN_AR = 4 / 3

const CATEGORIES = ['films', 'series', 'shows', 'anime'] as const
type Category = (typeof CATEGORIES)[number]
const BLOCKED_CHANNELS = new Set(['malcolm', 'etchebesme'])

function pickRandom<T>(arr: readonly T[], exclude?: T): T | null {
  if (!arr.length) return null
  if (arr.length === 1 || exclude === undefined) return arr[Math.floor(Math.random() * arr.length)]
  let pick: T
  do { pick = arr[Math.floor(Math.random() * arr.length)] } while (pick === exclude)
  return pick
}

interface LaZoneVideo {
  title: string
  duration: number
  url: string
}

interface LaZoneChannel {
  id: string
  title: string
  tags?: string[]
  videos: LaZoneVideo[]
}

interface LaZoneCRTProps {
  position: [number, number, number]
  rotation?: [number, number, number]
  /** Tilt angle of the CRT (applied to the inner model) */
  tilt?: number
}

// Stable video element — created once at module level, survives HMR & Strict Mode
let _sharedVideo: HTMLVideoElement | null = null
function getSharedVideo(): HTMLVideoElement | null {
  if (typeof document === 'undefined') return null
  if (!_sharedVideo) {
    _sharedVideo = document.createElement('video')
    _sharedVideo.crossOrigin = 'anonymous'
    _sharedVideo.muted = true
    _sharedVideo.playsInline = true
    // Debug: expose for Playwright testing
    ;(window as unknown as Record<string, unknown>).__laZoneVideo = _sharedVideo
  }
  return _sharedVideo
}

/** Apply "cover on height" aspect ratio correction to a VideoTexture */
function applyAspectRatio(texture: THREE.VideoTexture, video: HTMLVideoElement) {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) return
  const videoAR = vw / vh
  if (videoAR > CRT_SCREEN_AR) {
    const repeatX = CRT_SCREEN_AR / videoAR
    texture.repeat.set(repeatX, 1)
    texture.offset.set((1 - repeatX) / 2, 0)
  } else {
    const repeatY = videoAR / CRT_SCREEN_AR
    texture.repeat.set(1, repeatY)
    texture.offset.set(0, (1 - repeatY) / 2)
  }
}

/** Create a fresh VideoTexture from the shared video element */
function createVideoTexture(video: HTMLVideoElement): THREE.VideoTexture {
  const texture = new THREE.VideoTexture(video)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export function LaZoneCRT({ position, rotation = [0, 0, 0], tilt = -10 }: LaZoneCRTProps) {
  const { scene: glbScene } = useGLTF('/models/crt_tv.glb', true)
  const screenMeshRef = useRef<THREE.Mesh | null>(null)
  const poolsRef = useRef<Map<Category, LaZoneVideo[]>>(new Map())
  const currentCategoryRef = useRef<Category | null>(null)
  const currentVideoRef = useRef<LaZoneVideo | null>(null)
  const skipToNextRef = useRef<() => void>(() => {})
  const soundEnabledRef = useRef(false)
  const fadeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const wasWatchingRef = useRef(false)
  // Incremented on every source switch so useFrame can detect stale frames
  const srcGenRef = useRef(0)
  const playGenRef = useRef(0)
  const switchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Stuck detection: track video.currentTime to detect frozen playback
  const lastTimeRef = useRef(0)
  const stuckFramesRef = useRef(0)
  // VideoTexture ref — recreated on each source switch to force fresh WebGPU GPU texture
  const videoTextureRef = useRef<THREE.VideoTexture | null>(null)

  // Stable video element (module-level singleton)
  const video = getSharedVideo()

  // Lazy-start gate: avoid preloading ~30 MB of TV channel video at boot.
  // Triggers when user is close (<6m), sitting, or after a 60s safety fallback.
  const [shouldStartTV, setShouldStartTV] = useState(false)

  // Store selectors
  const soundOn = useStore((s) => s.laZoneSoundOn)
  const isWatching = useStore((s) => s.isWatchingLaZone)
  const channelAction = useStore((s) => s.laZoneChannelAction)

  // Video phosphor layer — material WITHOUT emissiveMap initially (set via ref)
  const screenMat = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#000000',
      roughness: 1.0,
      metalness: 0.0,
      emissive: '#ffffff',
      emissiveIntensity: 1.0,
      toneMapped: false,
    })
  }, [])

  // Create initial VideoTexture and assign to material
  useEffect(() => {
    if (!video) return
    const texture = createVideoTexture(video)
    videoTextureRef.current = texture
    screenMat.emissiveMap = texture
    screenMat.needsUpdate = true
    return () => {
      texture.dispose()
      videoTextureRef.current = null
      screenMat.emissiveMap = null
      screenMat.needsUpdate = true
    }
  }, [video, screenMat])

  // Glass overlay — transparent layer on top for light reflections
  const glassMat = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#aabbcc',
      roughness: 0.08,
      metalness: 0.05,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      side: THREE.FrontSide,
    })
  }, [])

  // Clone GLB scene + find TVScreen mesh, replace material, add glass
  const clonedScene = useMemo(() => {
    const cloned = glbScene.clone(true)
    cloned.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = false
        child.receiveShadow = true
        child.layers.enable(RAYCAST_LAYER_INTERACTIVE)
        child.userData.isLaZoneCRT = true
        const mat = child.material as THREE.MeshStandardMaterial
        if (mat.name === 'TVScreen') {
          child.material = screenMat
          screenMeshRef.current = child

          // Glass overlay
          const glassMesh = new THREE.Mesh(child.geometry, glassMat)
          glassMesh.position.copy(child.position)
          glassMesh.rotation.copy(child.rotation)
          glassMesh.scale.copy(child.scale)
          glassMesh.translateZ(0.001)
          glassMesh.renderOrder = 1
          glassMesh.castShadow = false
          glassMesh.receiveShadow = false
          child.parent?.add(glassMesh)
        }
      }
    })
    return cloned
  }, [glbScene, screenMat, glassMat])

  // --- Volume fade (0→1 or 1→0 over ~2s) ---
  const fadeVolume = useCallback((target: number) => {
    if (!video) return
    if (fadeIntervalRef.current) clearInterval(fadeIntervalRef.current)
    soundEnabledRef.current = target > 0
    video.muted = false
    const step = target > video.volume ? 0.05 : -0.05
    fadeIntervalRef.current = setInterval(() => {
      video.volume = Math.max(0, Math.min(1, video.volume + step))
      if (Math.abs(video.volume - target) < 0.05) {
        video.volume = target
        if (target === 0) video.muted = true
        if (fadeIntervalRef.current) clearInterval(fadeIntervalRef.current)
        fadeIntervalRef.current = null
      }
    }, 100)
  }, [video])

  // Cleanup fade interval on unmount
  useEffect(() => {
    return () => {
      if (fadeIntervalRef.current) clearInterval(fadeIntervalRef.current)
    }
  }, [])

  // --- React to sound toggle from overlay ---
  useEffect(() => {
    fadeVolume(soundOn ? 1 : 0)
  }, [soundOn, fadeVolume])

  // --- Watch/unwatch: auto-unmute on zoom, remute on exit ---
  useEffect(() => {
    if (isWatching && !wasWatchingRef.current) {
      if (!soundOn) {
        useStore.getState().setLaZoneSoundOn(true)
      }
    }
    if (!isWatching && wasWatchingRef.current) {
      useStore.getState().setLaZoneSoundOn(false)
    }
    wasWatchingRef.current = isWatching
  }, [isWatching, soundOn])

  // Play a specific video. Uses generation counter to ignore stale callbacks
  // from previous source switches. Creates a fresh VideoTexture after play()
  // succeeds to fix WebGPU stale GPU texture.
  const playVideo = useCallback((next: LaZoneVideo) => {
    if (!video) return
    currentVideoRef.current = next

    // Bump generation — any in-flight callback from previous switch is now stale
    const gen = ++srcGenRef.current
    lastTimeRef.current = 0
    stuckFramesRef.current = 0

    if (switchTimeoutRef.current) {
      clearTimeout(switchTimeoutRef.current)
      switchTimeoutRef.current = null
    }

    video.pause()
    video.src = next.url
    video.muted = true
    video.load()

    // Safety timeout: if play() never resolves/rejects within 6s, skip
    switchTimeoutRef.current = setTimeout(() => {
      switchTimeoutRef.current = null
      if (srcGenRef.current !== gen) return
      skipToNextRef.current()
    }, 6000)

    video.play()
      .then(() => {
        if (switchTimeoutRef.current) { clearTimeout(switchTimeoutRef.current); switchTimeoutRef.current = null }
        if (srcGenRef.current !== gen) return // stale
        playGenRef.current = gen

        // Create a FRESH VideoTexture — forces WebGPU to:
        // 1. Register new requestVideoFrameCallback
        // 2. Create a new GPU texture with correct dimensions
        // This fixes the stale GPU texture bug after rapid source changes
        if (videoTextureRef.current) {
          videoTextureRef.current.dispose()
        }
        const newTexture = createVideoTexture(video)
        applyAspectRatio(newTexture, video)
        videoTextureRef.current = newTexture
        screenMat.emissiveMap = newTexture
        screenMat.needsUpdate = true

        if (soundEnabledRef.current) {
          video.muted = false
        }
      })
      .catch(() => {
        if (switchTimeoutRef.current) { clearTimeout(switchTimeoutRef.current); switchTimeoutRef.current = null }
        if (srcGenRef.current !== gen) return // stale
        skipToNextRef.current()
      })
  }, [video, screenMat])

  // Auto-advance (video ended / play failed): stay in same category, pick another random video
  const playNextInCategory = useCallback(() => {
    const cat = currentCategoryRef.current
    const pool = cat ? poolsRef.current.get(cat) : null
    if (!pool?.length) return
    const next = pickRandom(pool, currentVideoRef.current ?? undefined)
    if (next) playVideo(next)
  }, [playVideo])

  // Zap (channel up/down): pick a random category, then a random video in that pool
  const playRandom = useCallback(() => {
    const available = CATEGORIES.filter((c) => poolsRef.current.get(c)?.length)
    if (!available.length) return
    const cat = available[Math.floor(Math.random() * available.length)]
    currentCategoryRef.current = cat
    const pool = poolsRef.current.get(cat)!
    const next = pickRandom(pool, currentVideoRef.current ?? undefined)
    if (next) playVideo(next)
  }, [playVideo])

  // Mirror playNextInCategory into a ref so playVideo can retry without
  // creating a circular useCallback dependency.
  useEffect(() => {
    skipToNextRef.current = playNextInCategory
  }, [playNextInCategory])

  // --- Channel zapping (up/down while watching) → random pick ---
  useEffect(() => {
    if (!channelAction) return
    playRandom()
    useStore.getState().clearLaZoneChannelAction()
  }, [channelAction, playRandom])

  // --- Adjust VideoTexture for "cover on height" aspect ratio ---
  // Re-apply when video metadata loads (covers initial load and HMR)
  useEffect(() => {
    if (!video) return
    const onMetadata = () => {
      if (videoTextureRef.current) {
        applyAspectRatio(videoTextureRef.current, video)
      }
    }
    video.addEventListener('loadedmetadata', onMetadata)
    if (video.videoWidth && video.videoHeight) onMetadata()
    return () => video.removeEventListener('loadedmetadata', onMetadata)
  }, [video])

  // 60s fallback: trigger TV start regardless of proximity/sit
  useEffect(() => {
    if (shouldStartTV) return
    const t = setTimeout(() => setShouldStartTV(true), 60_000)
    return () => clearTimeout(t)
  }, [shouldStartTV])

  // Fetch La Zone TV data, build per-category pools, start ambient playback
  useEffect(() => {
    if (!shouldStartTV) return
    if (!video) return
    let cancelled = false

    const onEnded = () => playNextInCategory()
    const onError = () => playNextInCategory()

    fetch('https://tv.lazone.at/data.json')
      .then((r) => r.json())
      .then((data: { channels?: LaZoneChannel[] }) => {
        if (cancelled || !data.channels?.length) return

        const pools = new Map<Category, LaZoneVideo[]>()
        for (const cat of CATEGORIES) pools.set(cat, [])

        for (const ch of data.channels) {
          if (BLOCKED_CHANNELS.has(ch.id)) continue
          if (!ch.tags?.includes('fr')) continue
          const chanCats = CATEGORIES.filter((c) => ch.tags?.includes(c))
          if (!chanCats.length) continue

          for (const v of ch.videos) {
            // Reject URLs with invalid percent encoding (Latin-1 instead of UTF-8)
            // — these cause CORS failures from cross-origin contexts.
            try { decodeURIComponent(v.url) } catch { continue }
            // A channel can carry multiple category tags (e.g. disney = films + anime);
            // each of its videos is pushed into every matching pool.
            for (const cat of chanCats) pools.get(cat)!.push(v)
          }
        }

        if (![...pools.values()].some((p) => p.length)) return
        poolsRef.current = pools

        video.muted = true
        video.loop = false
        video.addEventListener('ended', onEnded)
        video.addEventListener('error', onError)
        playRandom()
      })
      .catch(() => {})

    return () => {
      cancelled = true
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('error', onError)
      // Invalidate any in-flight play callbacks
      srcGenRef.current++
      if (switchTimeoutRef.current) { clearTimeout(switchTimeoutRef.current); switchTimeoutRef.current = null }
      video.pause()
    }
  }, [shouldStartTV, video, playRandom, playNextInCategory])

  // --- Screen flicker effect + stuck detection ---
  // Only show video when play() has succeeded for the current source (playGenRef matches srcGenRef)
  // Also monitors video.currentTime to detect permanently frozen playback
  useFrame((state) => {
    // Lazy trigger: start TV when user is near (<6m) or sitting on couch.
    // 60s fallback handled in a separate setTimeout above.
    if (!shouldStartTV) {
      const cam = state.camera.position
      const dx = cam.x - position[0]
      const dz = cam.z - position[2]
      if (dx * dx + dz * dz < 36 || useStore.getState().isSitting) {
        setShouldStartTV(true)
      }
    }

    if (!screenMeshRef.current || !video) return
    const mat = screenMeshRef.current.material as THREE.MeshStandardMaterial
    const isActive = !video.paused && video.readyState >= 2 && playGenRef.current === srcGenRef.current
    if (isActive) {
      // Check if video is actually advancing (detect frozen playback)
      if (video.currentTime === lastTimeRef.current) {
        stuckFramesRef.current++
        if (stuckFramesRef.current > 150) { // ~2.5s at 60fps — video frozen, skip
          stuckFramesRef.current = 0
          skipToNextRef.current()
          return
        }
      } else {
        stuckFramesRef.current = 0
        lastTimeRef.current = video.currentTime
      }
      mat.emissiveIntensity = 1.0 + Math.random() * 0.1
    } else {
      mat.emissiveIntensity = 0.0
      stuckFramesRef.current = 0
    }
  })

  const tiltRad = (tilt * Math.PI) / 180

  return (
    <group position={position} rotation={rotation}>
      <primitive object={clonedScene} position={[0, 0, 0]} scale={1} rotation={[tiltRad, 0, 0]} />
    </group>
  )
}
