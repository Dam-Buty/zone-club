import * as THREE from 'three/webgpu'
import { Canvas, extend, type ThreeToJSXElements } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useCallback, useRef, useState, memo, Component, type ReactNode, lazy } from 'react'
import { useStore } from '../../store'
import { Lighting } from './Lighting'
import { Controls } from './Controls'
import { PostProcessingEffects } from './PostProcessingEffects'
import { Environment } from '@react-three/drei'
import { useIsMobile } from '../../hooks/useIsMobile'
import { createMobileInput } from '../../types/mobile'
import type { MobileInput } from '../../types/mobile'

// Lazy loading du composant Aisle (contient tous les modèles 3D)
const Aisle = lazy(() => import('./Aisle').then(module => ({ default: module.Aisle })))
import { VHSCaseViewer } from './VHSCaseViewer'
import { TVTerminal } from '../terminal/TVTerminal'
import { MobileControls } from '../mobile/MobileControls'
import { MobileOnboarding } from '../mobile/MobileOnboarding'
import { BenchmarkSampler, BenchmarkOverlay } from './BenchmarkMode'

// LTC textures removed — no RectAreaLights in optimized lighting mode
// If RectAreaLights are re-added, restore: RectAreaLightTexturesLib.init() + RectAreaLightNode.setLTC()

// Error Boundary pour capturer les erreurs dans le canvas 3D
interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class SceneErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[SceneErrorBoundary] Error caught:', error)
    console.error('[SceneErrorBoundary] Error info:', errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <mesh>
          <boxGeometry args={[2, 2, 2]} />
          <meshBasicMaterial color="#ff0000" wireframe />
        </mesh>
      )
    }
    return this.props.children
  }
}

// Extend Three.js WebGPU elements for R3F
declare module '@react-three/fiber' {
  interface ThreeElements extends ThreeToJSXElements<typeof THREE> {}
}

extend(THREE as any)

interface InteriorSceneProps {
  onCassetteClick?: (filmId: number) => void
}

function LoadingFallback() {
  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color="#ff2d95" wireframe />
    </mesh>
  )
}

// Memoized 3D scene content
const SceneContent = memo(function SceneContent({
  films,
  onCassetteClick,
  selectedFilm,
  isMobile,
  mobileInputRef,
  maxTextureArrayLayers,
  benchmarkMode,
}: {
  films: import('../../types').Film[]
  onCassetteClick?: (filmId: number) => void
  selectedFilm: import('../../types').Film | null
  isMobile: boolean
  mobileInputRef: React.MutableRefObject<MobileInput>
  maxTextureArrayLayers: number
  benchmarkMode: boolean
}) {
  useEffect(() => {
    console.log('[SceneContent] Mounted with', films.length, 'films')
  }, [films.length])

  return (
    <>
      <Environment
        files="/textures/env/indoor_night.hdr"
        background={false}
        environmentIntensity={0.7}
      />
      <Lighting isMobile={isMobile} />
      <Aisle films={films} maxTextureArrayLayers={maxTextureArrayLayers} />
      <Controls
        onCassetteClick={onCassetteClick}
        isMobile={isMobile}
        mobileInputRef={mobileInputRef}
      />
      <PostProcessingEffects isMobile={isMobile} />
      <BenchmarkSampler
        enabled={benchmarkMode}
        isMobile={isMobile}
        maxTextureArrayLayers={maxTextureArrayLayers}
      />
      {selectedFilm && <VHSCaseViewer key={selectedFilm.id} film={selectedFilm} />}
    </>
  )
})

// LaZone CRT interaction overlay — left/right choice, tappable on mobile
function LaZoneOverlay() {
  const isInteracting = useStore(s => s.isInteractingWithLaZone)
  const isWatching = useStore(s => s.isWatchingLaZone)
  const laZoneMenuAction = useStore(s => s.laZoneMenuAction)
  const soundOn = useStore(s => s.laZoneSoundOn)
  const [menuIndex, setMenuIndex] = useState(0)
  const isMobile = useIsMobile()

  // Direct action handler (used by both keyboard dispatch and touch tap)
  const selectOption = useCallback((index: number) => {
    if (index === 0) {
      useStore.getState().setLaZoneSoundOn(!useStore.getState().laZoneSoundOn)
    } else if (index === 1) {
      useStore.getState().setWatchingLaZone(true)
    }
  }, [])

  const closeMenu = useCallback(() => {
    useStore.getState().setInteractingWithLaZone(false)
  }, [])

  // React to keyboard dispatches from Controls (desktop)
  useEffect(() => {
    if (!laZoneMenuAction) return
    const clear = useStore.getState().clearLaZoneMenuAction

    if (laZoneMenuAction === 'left') {
      setMenuIndex(0)
    } else if (laZoneMenuAction === 'right') {
      setMenuIndex(1)
    } else if (laZoneMenuAction === 'select') {
      selectOption(menuIndex)
    } else if (laZoneMenuAction === 'back') {
      closeMenu()
    }

    clear()
  }, [laZoneMenuAction, menuIndex, selectOption, closeMenu])

  // Reset menu index when opening
  useEffect(() => {
    if (isInteracting) setMenuIndex(0)
  }, [isInteracting])

  if (!isInteracting || isWatching) return null

  const options = [
    { label: soundOn ? 'Couper le son' : 'Monter le son', icon: soundOn ? '🔇' : '🔊' },
    { label: 'Regarder la TV', icon: '📺' },
  ]

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: isMobile ? '1rem' : '4rem',
        pointerEvents: 'none',
        zIndex: 25,
      }}
    >
      {options.map((opt, i) => {
        const selected = !isMobile && i === menuIndex
        return (
          <div
            key={i}
            onClick={(e) => {
              e.stopPropagation()
              if (isMobile) {
                selectOption(i)
              }
            }}
            style={{
              padding: isMobile ? '1.2rem 1.5rem' : '2rem 3rem',
              backgroundColor: selected ? 'rgba(0, 255, 247, 0.15)' : 'rgba(0, 0, 0, 0.75)',
              border: selected ? '2px solid #00fff7' : '2px solid rgba(255,255,255,0.3)',
              borderRadius: '12px',
              color: selected ? '#00fff7' : '#ffffff',
              fontFamily: "'Courier New', monospace",
              fontSize: isMobile ? '1.1rem' : '1.8rem',
              fontWeight: 'bold',
              textAlign: 'center',
              textShadow: selected ? '0 0 20px #00fff7' : 'none',
              boxShadow: selected ? '0 0 30px rgba(0, 255, 247, 0.3)' : 'none',
              transition: 'all 0.15s ease',
              minWidth: isMobile ? '140px' : '280px',
              pointerEvents: isMobile ? 'auto' : 'none',
              cursor: isMobile ? 'pointer' : 'default',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <div style={{ fontSize: isMobile ? '1.8rem' : '2.5rem', marginBottom: '0.5rem' }}>{opt.icon}</div>
            <div>{opt.label}</div>
          </div>
        )
      })}

      {/* Close button — mobile only */}
      {isMobile && (
        <div
          onClick={(e) => { e.stopPropagation(); closeMenu() }}
          style={{
            position: 'absolute',
            top: 'calc(env(safe-area-inset-top, 0px) + 1rem)',
            right: '1rem',
            width: '44px',
            height: '44px',
            borderRadius: '50%',
            backgroundColor: 'rgba(0,0,0,0.7)',
            border: '1px solid rgba(255,255,255,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: '1.4rem',
            pointerEvents: 'auto',
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          ✕
        </div>
      )}

      {/* Navigation hint — desktop only */}
      {!isMobile && (
        <div
          style={{
            position: 'absolute',
            bottom: '15%',
            left: '50%',
            transform: 'translateX(-50%)',
            color: 'rgba(255,255,255,0.5)',
            fontFamily: 'sans-serif',
            fontSize: '0.9rem',
          }}
        >
          ← → Choisir · <strong>E</strong> Valider · <strong>Échap</strong> Fermer
        </div>
      )}
    </div>
  )
}

// LaZone watching overlay — channel zapping + exit, touch-interactive on mobile
function LaZoneWatchingOverlay() {
  const isWatching = useStore(s => s.isWatchingLaZone)
  const channelAction = useStore(s => s.laZoneChannelAction)
  const [flash, setFlash] = useState<'up' | 'down' | null>(null)
  const isMobile = useIsMobile()

  // Brief flash on channel change
  useEffect(() => {
    if (!channelAction) return
    setFlash(channelAction === 'prev' ? 'up' : 'down')
    const timer = setTimeout(() => setFlash(null), 600)
    return () => clearTimeout(timer)
  }, [channelAction])

  if (!isWatching) return null

  const handleChannelUp = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation()
    useStore.getState().dispatchLaZoneChannel('prev')
  }
  const handleChannelDown = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation()
    useStore.getState().dispatchLaZoneChannel('next')
  }
  const handleExit = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation()
    useStore.getState().setWatchingLaZone(false)
    useStore.getState().setInteractingWithLaZone(false)
  }

  const btnBase: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    backgroundColor: 'rgba(0,0,0,0.6)',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: isMobile ? '12px' : '8px',
    pointerEvents: 'auto',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
    transition: 'all 0.15s ease',
  }

  const chBtnSize = isMobile
    ? { width: '56px', height: '56px' }
    : { width: '54px', height: '54px' }

  const arrowColor = (active: boolean) => active ? '#00fff7' : 'rgba(255,255,255,0.5)'
  const arrowShadow = (active: boolean) => active ? '0 0 15px #00fff7' : 'none'

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 25,
      }}
    >
      {/* Channel buttons — desktop: right side vertical, mobile: below TV horizontal */}
      <div
        style={isMobile ? {
          position: 'absolute',
          bottom: '14%',
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: '2rem',
        } : {
          position: 'absolute',
          right: '3rem',
          top: '50%',
          transform: 'translateY(-50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1.5rem',
        }}
      >
        <div
          onClick={handleChannelUp}
          style={{
            ...btnBase,
            ...chBtnSize,
            borderColor: flash === 'up' ? '#00fff7' : 'rgba(255,255,255,0.2)',
            backgroundColor: flash === 'up' ? 'rgba(0, 255, 247, 0.15)' : 'rgba(0,0,0,0.6)',
          }}
        >
          <span style={{ color: arrowColor(flash === 'up'), fontSize: isMobile ? '1.5rem' : '1.6rem', textShadow: arrowShadow(flash === 'up') }}>▲</span>
          <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: isMobile ? '0.55rem' : '0.65rem', marginTop: '2px' }}>CH+</span>
        </div>
        <div
          onClick={handleChannelDown}
          style={{
            ...btnBase,
            ...chBtnSize,
            borderColor: flash === 'down' ? '#00fff7' : 'rgba(255,255,255,0.2)',
            backgroundColor: flash === 'down' ? 'rgba(0, 255, 247, 0.15)' : 'rgba(0,0,0,0.6)',
          }}
        >
          <span style={{ color: arrowColor(flash === 'down'), fontSize: isMobile ? '1.5rem' : '1.6rem', textShadow: arrowShadow(flash === 'down') }}>▼</span>
          <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: isMobile ? '0.55rem' : '0.65rem', marginTop: '2px' }}>CH-</span>
        </div>
      </div>

      {/* Exit button */}
      <div
        onClick={handleExit}
        style={{
          ...btnBase,
          position: 'absolute',
          top: isMobile ? 'calc(env(safe-area-inset-top, 0px) + 1rem)' : '1.5rem',
          right: isMobile ? '1rem' : '2rem',
          width: isMobile ? '44px' : '36px',
          height: isMobile ? '44px' : '36px',
          borderRadius: '50%',
          color: '#fff',
          fontSize: isMobile ? '1.2rem' : '1rem',
        }}
      >
        ✕
      </div>

      {/* Bottom hint */}
      <div
        style={{
          position: 'absolute',
          bottom: isMobile ? 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' : '1.5rem',
          left: '50%',
          transform: 'translateX(-50%)',
          color: 'rgba(255,255,255,0.3)',
          fontFamily: 'sans-serif',
          fontSize: isMobile ? '0.75rem' : '0.8rem',
        }}
      >
        {isMobile ? 'Toucher ▲▼ pour zapper' : '↑↓ Zapper · Clic pour quitter'}
      </div>
    </div>
  )
}

// Navigation hints auto-hide policy
const NAV_HELP_DURATION = 30000
const NAV_HELP_FADE_MS = 800
const MOBILE_AIM_HINT_DELAY = 1200
const URL_BENCHMARK_MODE = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('benchmark') === '1'

// UI Overlays — separate component to isolate UI state re-renders from the 3D Canvas
function UIOverlays({ isMobile }: { isMobile: boolean }) {
  const isPointerLocked = useStore(state => state.isPointerLocked)
  const managerVisible = useStore(state => state.managerVisible)
  const isTerminalOpen = useStore(state => state.isTerminalOpen)
  const selectedFilmId = useStore(state => state.selectedFilmId)
  const hasSeenOnboarding = useStore(state => state.hasSeenOnboarding)
  const closeTerminal = useStore(state => state.closeTerminal)
  const requestPointerLock = useStore(state => state.requestPointerLock)
  const targetedInteractive = useStore(state => state.targetedInteractive)
  const isSitting = useStore(state => state.isSitting)
  const isWatchingLaZone = useStore(state => state.isWatchingLaZone)
  const overlaysEnabled = hasSeenOnboarding

  // Desktop controls hint (locked): show then fade out after 30s
  const [showHelp, setShowHelp] = useState(false)
  const [helpFading, setHelpFading] = useState(false)
  useEffect(() => {
    if (!overlaysEnabled || isMobile || !isPointerLocked) {
      setShowHelp(false)
      setHelpFading(false)
      return
    }
    setShowHelp(true)
    setHelpFading(false)
    const fadeTimer = setTimeout(() => setHelpFading(true), NAV_HELP_DURATION - NAV_HELP_FADE_MS)
    const hideTimer = setTimeout(() => setShowHelp(false), NAV_HELP_DURATION)
    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(hideTimer)
    }
  }, [overlaysEnabled, isMobile, isPointerLocked])

  // Desktop lock hint (unlocked): show then fade out after 30s
  const [showTakeControlHint, setShowTakeControlHint] = useState(false)
  const [takeControlFading, setTakeControlFading] = useState(false)
  useEffect(() => {
    if (!overlaysEnabled || isMobile || isPointerLocked || isTerminalOpen || selectedFilmId) {
      setShowTakeControlHint(false)
      setTakeControlFading(false)
      return
    }
    setShowTakeControlHint(true)
    setTakeControlFading(false)
    const fadeTimer = setTimeout(() => setTakeControlFading(true), NAV_HELP_DURATION - NAV_HELP_FADE_MS)
    const hideTimer = setTimeout(() => setShowTakeControlHint(false), NAV_HELP_DURATION)
    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(hideTimer)
    }
  }, [overlaysEnabled, isMobile, isPointerLocked, isTerminalOpen, selectedFilmId])

  // Mobile aim hint: guaranteed display, then fade out after 30s
  const [showAimHint, setShowAimHint] = useState(false)
  const [aimHintFading, setAimHintFading] = useState(false)

  useEffect(() => {
    if (!overlaysEnabled || !isMobile || !isPointerLocked) {
      setShowAimHint(false)
      setAimHintFading(false)
      return
    }
    setShowAimHint(false)
    setAimHintFading(false)
    const showTimer = setTimeout(() => setShowAimHint(true), MOBILE_AIM_HINT_DELAY)
    const fadeTimer = setTimeout(
      () => setAimHintFading(true),
      MOBILE_AIM_HINT_DELAY + NAV_HELP_DURATION - NAV_HELP_FADE_MS
    )
    const hideTimer = setTimeout(() => setShowAimHint(false), MOBILE_AIM_HINT_DELAY + NAV_HELP_DURATION)
    return () => {
      clearTimeout(showTimer)
      clearTimeout(fadeTimer)
      clearTimeout(hideTimer)
    }
  }, [overlaysEnabled, isMobile, isPointerLocked])

  const handleCloseTerminal = useCallback(() => {
    closeTerminal()
    requestPointerLock()
  }, [closeTerminal, requestPointerLock])

  return (
    <>
      {/* Message "Cliquez pour prendre le contrôle" — desktop only, when not locked */}
      {overlaysEnabled && !isMobile && !isPointerLocked && !isTerminalOpen && !selectedFilmId && showTakeControlHint && (
        <div
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            padding: '2rem 3rem',
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            borderRadius: '12px',
            border: '2px solid #ff2d95',
            boxShadow: '0 0 30px rgba(255, 45, 149, 0.5)',
            color: '#ffffff',
            fontFamily: 'Orbitron, sans-serif',
            fontSize: '1.5rem',
            textAlign: 'center',
            pointerEvents: 'none',
            zIndex: 30,
            opacity: takeControlFading ? 0 : 1,
            transition: `opacity ${NAV_HELP_FADE_MS}ms ease`,
          }}
        >
          <div style={{ color: '#ff2d95', textShadow: '0 0 15px #ff2d95' }}>
            {managerVisible ? 'CLIQUER DEUX FOIS' : 'CLIQUEZ N\'IMPORTE OÙ'}
          </div>
          <div style={{ marginTop: '0.5rem', fontSize: '1rem', opacity: 0.8 }}>
            {managerVisible ? 'pour sortir du chat' : 'pour prendre le contrôle'}
          </div>
        </div>
      )}

      {/* Crosshair — desktop only, hidden while watching LaZone */}
      {overlaysEnabled && !isMobile && isPointerLocked && !isWatchingLaZone && (
        <div
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '20px',
            height: '20px',
            pointerEvents: 'none',
            zIndex: 20,
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '0',
              width: '100%',
              height: '2px',
              backgroundColor: 'rgba(255, 255, 255, 0.7)',
              transform: 'translateY(-50%)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: '0',
              left: '50%',
              width: '2px',
              height: '100%',
              backgroundColor: 'rgba(255, 255, 255, 0.7)',
              transform: 'translateX(-50%)',
            }}
          />
        </div>
      )}

      {/* Interaction hint — below crosshair, hidden while watching LaZone */}
      {overlaysEnabled && !isMobile && isPointerLocked && !isWatchingLaZone && (() => {
        let hint = ''
        if (isSitting) {
          hint = '↑↓ Naviguer  ·  [E] Sélectionner  ·  [Échap] Se lever'
        } else if (targetedInteractive === 'couch') {
          hint = "S'asseoir [E]"
        } else if (targetedInteractive === 'tv') {
          hint = 'Terminal [E]'
        } else if (targetedInteractive === 'manager' || targetedInteractive === 'bell') {
          hint = 'Parler [E]'
        } else if (targetedInteractive === 'lazone') {
          hint = 'La Zone [E]'
        }
        if (!hint) return null
        return (
          <div
            style={{
              position: 'fixed',
              top: isSitting ? 'calc(50% + 24px)' : 'calc(50% + 22px)',
              left: '50%',
              transform: 'translateX(-50%)',
              padding: '4px 10px',
              backgroundColor: 'rgba(0, 0, 0, 0.65)',
              borderRadius: '4px',
              color: '#ffffff',
              fontFamily: 'sans-serif',
              fontSize: '13px',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              zIndex: 20,
            }}
          >
            {hint}
          </div>
        )
      })()}


      {/* Scene indicator */}
      {overlaysEnabled && (
        <div
          style={{
            position: 'fixed',
            top: '1rem',
            left: '1rem',
            padding: '0.5rem 1rem',
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            borderRadius: '4px',
            color: '#00fff7',
            fontFamily: 'Orbitron, sans-serif',
            fontSize: '0.75rem',
            textShadow: '0 0 8px #00fff7',
            zIndex: 10,
          }}
        >
          VIDEO CLUB
        </div>
      )}

      {/* (#7) Controls help — desktop only, when locked, fades out after 30s */}
      {overlaysEnabled && !isMobile && isPointerLocked && showHelp && (
        <div
          style={{
            position: 'fixed',
            bottom: '2rem',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '0.75rem 1.5rem',
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            borderRadius: '8px',
            color: '#ffffff',
            fontFamily: 'sans-serif',
            fontSize: '0.8rem',
            textAlign: 'center',
            pointerEvents: 'none',
            zIndex: 10,
            opacity: helpFading ? 0 : 1,
            transition: `opacity ${NAV_HELP_FADE_MS}ms ease`,
          }}
        >
          <div><strong>↑ ↓ ← →</strong> - Se déplacer | <strong>Souris</strong> - Regarder</div>
          <div style={{ marginTop: '0.3rem', opacity: 0.7 }}>
            <strong>Clic</strong> ou <strong>E</strong> - Sélectionner cassette | <strong>ESC</strong> - Libérer souris
          </div>
        </div>
      )}

      {/* LaZone CRT interaction overlay */}
      <LaZoneOverlay />
      <LaZoneWatchingOverlay />

      {/* Terminal TV */}
      <TVTerminal isOpen={isTerminalOpen} onClose={handleCloseTerminal} />
    </>
  )
}

export function InteriorScene({ onCassetteClick }: InteriorSceneProps) {
  const isMobile = useIsMobile()
  const mobileInputRef = useRef<MobileInput>(createMobileInput())
  const isMountedRef = useRef(true)
  const [maxTextureArrayLayers, setMaxTextureArrayLayers] = useState(256)
  const [gpuError, setGpuError] = useState<string | null>(null)

  const films = useStore(state => state.films)
  const selectedFilmId = useStore(state => state.selectedFilmId)
  const hasSeenOnboarding = useStore(state => state.hasSeenOnboarding)
  const benchmarkEnabled = useStore(state => state.benchmarkEnabled)
  const laZoneActive = useStore(state => state.isInteractingWithLaZone || state.isWatchingLaZone)
  const benchmarkMode = benchmarkEnabled || URL_BENCHMARK_MODE

  useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const allFilms = useMemo(() => {
    const seen = new Set<number>()
    const combined: import('../../types').Film[] = []

    Object.values(films).forEach(aisleFilms => {
      aisleFilms.forEach(film => {
        if (!seen.has(film.id)) {
          seen.add(film.id)
          combined.push(film)
        }
      })
    })

    return combined
  }, [films])

  const selectedFilm = useMemo(() => {
    if (!selectedFilmId) return null
    return allFilms.find(f => f.id === selectedFilmId) || null
  }, [selectedFilmId, allFilms])

  useEffect(() => {
    console.log('[InteriorScene] Total unique films loaded:', allFilms.length)
  }, [allFilms.length])

  return (
    <div style={{ position: 'fixed', inset: 0, touchAction: 'none' }}>
      <Canvas
        dpr={isMobile ? 1.0 : Math.min(window.devicePixelRatio, 1.5)}
        gl={(async (props: any) => {
          console.log('[Canvas] Initializing WebGPU renderer...')

          // Let Three.js handle adapter creation internally — avoid redundant
          // requestAdapter() calls that can interfere on some systems.
          const renderer = new THREE.WebGPURenderer({
            ...props as THREE.WebGPURendererParameters,
          })

          await renderer.init()

          // Device-level guards for runtime resilience (device lost / uncaptured errors).
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const backend = (renderer as any).backend
          const device = backend?.device as GPUDevice | undefined
          const detectedMaxLayers = device?.limits.maxTextureArrayLayers ?? 256
          const debugForcedLayers = Number(new URLSearchParams(window.location.search).get('debugMaxTextureArrayLayers'))
          const effectiveMaxLayers = Number.isFinite(debugForcedLayers) && debugForcedLayers > 0
            ? Math.floor(debugForcedLayers)
            : detectedMaxLayers
          if (isMountedRef.current) {
            setMaxTextureArrayLayers(Math.max(1, effectiveMaxLayers))
            setGpuError(null)
          }

          if (device) {
            device.onuncapturederror = (event) => {
              console.error('[Canvas] Uncaptured WebGPU error:', event.error)
              if (isMountedRef.current) {
                setGpuError('Erreur GPU détectée. Le rendu peut devenir instable.')
              }
            }

            device.lost.then((info) => {
              console.error('[Canvas] GPU device lost:', info.reason, info.message)
              if (isMountedRef.current) {
                setGpuError(`Le périphérique GPU a été perdu (${info.reason}). Recharge la page pour réinitialiser WebGPU.`)
              }
            })
          }

          renderer.shadowMap.enabled = true
          renderer.shadowMap.type = isMobile ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap
          renderer.toneMapping = THREE.ACESFilmicToneMapping
          renderer.toneMappingExposure = 1.0
          console.log(
            `[Canvas] WebGPU renderer initialized — layers: ${effectiveMaxLayers}${effectiveMaxLayers !== detectedMaxLayers ? ` (forced, device=${detectedMaxLayers})` : ''}, shadows: ${isMobile ? 'PCF' : 'PCFSoft'}, dpr: ${isMobile ? '≤1.5' : '≤2'}`
          )
          return renderer
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any}
        onCreated={(state) => {
          console.log('[Canvas] onCreated - scene ready')
          console.log('[Canvas] Renderer type:', state.gl.constructor.name)
        }}
      >
        <SceneErrorBoundary>
          <Suspense fallback={<LoadingFallback />}>
            <SceneContent
              films={allFilms}
              onCassetteClick={onCassetteClick}
              selectedFilm={selectedFilm}
              isMobile={isMobile}
              mobileInputRef={mobileInputRef}
              maxTextureArrayLayers={maxTextureArrayLayers}
              benchmarkMode={benchmarkMode}
            />
          </Suspense>
        </SceneErrorBoundary>
      </Canvas>

      {gpuError && (
        <div
          style={{
            position: 'fixed',
            top: '1rem',
            right: '1rem',
            maxWidth: '420px',
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            border: '1px solid rgba(255, 45, 149, 0.8)',
            background: 'rgba(0, 0, 0, 0.8)',
            color: '#fff',
            zIndex: 100,
            fontFamily: 'sans-serif',
            fontSize: '0.8rem',
            lineHeight: 1.4,
          }}
        >
          {gpuError}
        </div>
      )}

      <BenchmarkOverlay enabled={benchmarkMode} />

      <UIOverlays isMobile={isMobile} />

      {/* Mobile controls (joystick + touch look + interact button) — hidden during LaZone interaction */}
      {isMobile && !laZoneActive && <MobileControls mobileInputRef={mobileInputRef} />}

      {/* Onboarding — first launch only */}
      {!hasSeenOnboarding && <MobileOnboarding isMobile={isMobile} />}
    </div>
  )
}
