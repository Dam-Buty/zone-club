import { useRef, useMemo, useCallback, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { RAYCAST_LAYER_INTERACTIVE } from './Controls'
import { useStore } from '../../store'

useGLTF.preload('/models/crt_tv.glb', true)

interface LaZoneVideo {
  title: string
  duration: number
  url: string
}

interface LaZoneChannel {
  id: string
  title: string
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
  }
  return _sharedVideo
}

export function LaZoneCRT({ position, rotation = [0, 0, 0], tilt = -10 }: LaZoneCRTProps) {
  const { scene: glbScene } = useGLTF('/models/crt_tv.glb', true)
  const screenMeshRef = useRef<THREE.Mesh | null>(null)
  const playlistRef = useRef<LaZoneVideo[]>([])
  const indexRef = useRef(0)
  const soundEnabledRef = useRef(false)
  const fadeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const wasWatchingRef = useRef(false)

  // Stable video element (module-level singleton)
  const video = getSharedVideo()

  // Store selectors
  const soundOn = useStore((s) => s.laZoneSoundOn)
  const isWatching = useStore((s) => s.isWatchingLaZone)
  const channelAction = useStore((s) => s.laZoneChannelAction)

  // VideoTexture wrapping the stable video element
  const videoTexture = useMemo(() => {
    if (!video) return null
    const texture = new THREE.VideoTexture(video)
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }, [video])

  // Video phosphor layer — the actual video content behind the glass
  const screenMat = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#000000',
      roughness: 1.0,
      metalness: 0.0,
      emissive: '#ffffff',
      emissiveIntensity: 1.0,
      emissiveMap: videoTexture,
      toneMapped: false,
    })
  }, [videoTexture])

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

  // Play video at a specific playlist index (wraps around)
  const playAtIndex = useCallback((idx: number) => {
    const playlist = playlistRef.current
    if (!playlist.length || !video) return
    const wrapped = ((idx % playlist.length) + playlist.length) % playlist.length
    indexRef.current = wrapped
    video.src = playlist[wrapped].url
    video.muted = !soundEnabledRef.current
    video.load()
    video.play().catch(() => {})
  }, [video])

  const playNext = useCallback(() => {
    playAtIndex(indexRef.current + 1)
  }, [playAtIndex])

  const playPrev = useCallback(() => {
    playAtIndex(indexRef.current - 1)
  }, [playAtIndex])

  // --- Channel zapping (up/down while watching) ---
  useEffect(() => {
    if (!channelAction) return
    if (channelAction.type === 'next') playNext()
    else if (channelAction.type === 'prev') playPrev()
    useStore.getState().clearLaZoneChannelAction()
  }, [channelAction, playNext, playPrev])

  // Fetch La Zone TV data + start ambient playback
  useEffect(() => {
    if (!video) return
    let cancelled = false

    const onEnded = () => playNext()
    const onError = () => playNext()

    fetch('https://tv.lazone.at/data.json')
      .then((r) => r.json())
      .then((data: { channels?: LaZoneChannel[] }) => {
        if (cancelled || !data.channels?.length) return
        const badEncoding = /%[89A-Fa-f][0-9A-Fa-f]/
        const allVideos = data.channels.flatMap((ch) =>
          ch.videos.filter((v) =>
            v.url.includes('lazone.bourlypokertour.fr') && !badEncoding.test(v.url)
          )
        )
        if (!allVideos.length) return
        const shuffled = allVideos.sort(() => Math.random() - 0.5)
        playlistRef.current = shuffled
        indexRef.current = 0

        video.muted = true
        video.loop = false
        video.addEventListener('ended', onEnded)
        video.addEventListener('error', onError)
        playNext()
      })
      .catch(() => {})

    return () => {
      cancelled = true
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('error', onError)
      video.pause()
    }
  }, [video, playNext])

  // --- Screen flicker effect (video always visible) ---
  useFrame(() => {
    if (!screenMeshRef.current) return
    const mat = screenMeshRef.current.material as THREE.MeshStandardMaterial
    if (video && !video.paused && video.readyState >= 2) {
      mat.emissiveIntensity = 1.0 + Math.random() * 0.1
    } else {
      mat.emissiveIntensity = 0.0
    }
  })

  const tiltRad = (tilt * Math.PI) / 180

  return (
    <group position={position} rotation={rotation}>
      <primitive object={clonedScene} position={[0, 0, 0]} scale={1} rotation={[tiltRad, 0, 0]} />
    </group>
  )
}
