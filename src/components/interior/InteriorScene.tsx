import * as THREE from 'three/webgpu'
import { RectAreaLightNode } from 'three/webgpu'
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
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js'
import { TVTerminal } from '../terminal/TVTerminal'
import { MobileControls } from '../mobile/MobileControls'
import { MobileOnboarding } from '../mobile/MobileOnboarding'

// Initialiser les textures LTC AVANT tout rendu
RectAreaLightTexturesLib.init()
RectAreaLightNode.setLTC(RectAreaLightTexturesLib)
console.log('[InteriorScene] LTC textures initialized')

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
}: {
  films: import('../../types').Film[]
  onCassetteClick?: (filmId: number) => void
  selectedFilm: import('../../types').Film | null
  isMobile: boolean
  mobileInputRef: React.MutableRefObject<MobileInput>
}) {
  useEffect(() => {
    console.log('[SceneContent] Mounted with', films.length, 'films')
  }, [films.length])

  return (
    <>
      <Environment
        files="/textures/env/indoor_night.hdr"
        background={false}
        environmentIntensity={0.35}
      />
      <Lighting isMobile={isMobile} />
      <Aisle films={films} />
      <Controls
        onCassetteClick={onCassetteClick}
        isMobile={isMobile}
        mobileInputRef={mobileInputRef}
      />
      <PostProcessingEffects isMobile={isMobile} />
      {selectedFilm && <VHSCaseViewer film={selectedFilm} />}
    </>
  )
})

// Desktop help text auto-fade delay (ms)
const HELP_FADE_DELAY = 15000

// Mobile aim hint delay (ms) — show after this long without targeting
const AIM_HINT_DELAY = 5000

// UI Overlays — separate component to isolate UI state re-renders from the 3D Canvas
function UIOverlays({ isMobile }: { isMobile: boolean }) {
  const isPointerLocked = useStore(state => state.isPointerLocked)
  const managerVisible = useStore(state => state.managerVisible)
  const isTerminalOpen = useStore(state => state.isTerminalOpen)
  const selectedFilmId = useStore(state => state.selectedFilmId)
  const closeTerminal = useStore(state => state.closeTerminal)
  const requestPointerLock = useStore(state => state.requestPointerLock)

  // (#7) Desktop: auto-fade help text after 15s of pointer lock
  const [showHelp, setShowHelp] = useState(true)
  useEffect(() => {
    if (isMobile || !isPointerLocked) {
      setShowHelp(true) // reset when unlocked so it re-shows next lock
      return
    }
    const timer = setTimeout(() => setShowHelp(false), HELP_FADE_DELAY)
    return () => clearTimeout(timer)
  }, [isMobile, isPointerLocked])

  // (#6) Mobile: "aim at a cassette" hint — visible after 5s of no targeting, hidden once user targets
  const [showAimHint, setShowAimHint] = useState(false)
  const hasEverTargeted = useRef(false)

  useEffect(() => {
    if (!isMobile) return

    // Subscribe to targeting changes
    const unsub = useStore.subscribe((state) => {
      if (state.targetedCassetteKey !== null) {
        hasEverTargeted.current = true
        setShowAimHint(false)
      }
    })
    return unsub
  }, [isMobile])

  useEffect(() => {
    if (!isMobile || !isPointerLocked || hasEverTargeted.current) return
    const timer = setTimeout(() => {
      if (!hasEverTargeted.current) setShowAimHint(true)
    }, AIM_HINT_DELAY)
    return () => clearTimeout(timer)
  }, [isMobile, isPointerLocked])

  const handleCloseTerminal = useCallback(() => {
    closeTerminal()
    requestPointerLock()
  }, [closeTerminal, requestPointerLock])

  return (
    <>
      {/* Message "Cliquez pour prendre le contrôle" — desktop only, when not locked */}
      {!isMobile && !isPointerLocked && !isTerminalOpen && !selectedFilmId && (
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

      {/* Crosshair — desktop: cross shape, mobile: small dot */}
      {isPointerLocked && (
        isMobile ? (
          <div
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: 'rgba(255, 255, 255, 0.6)',
              pointerEvents: 'none',
              zIndex: 20,
            }}
          />
        ) : (
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
        )
      )}

      {/* (#6) Mobile aim hint — "Visez une cassette" below crosshair */}
      {isMobile && showAimHint && isPointerLocked && (
        <div
          style={{
            position: 'fixed',
            top: 'calc(50% + 24px)',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '0.4rem 0.8rem',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            borderRadius: '6px',
            color: 'rgba(255, 255, 255, 0.85)',
            fontFamily: 'Orbitron, sans-serif',
            fontSize: '0.65rem',
            textAlign: 'center',
            pointerEvents: 'none',
            zIndex: 20,
            animation: 'fadeInHint 0.5s ease-out',
          }}
        >
          Visez une cassette avec le point
        </div>
      )}

      {/* Scene indicator */}
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

      {/* (#7) Controls help — desktop only, when locked, fades out after 15s */}
      {!isMobile && isPointerLocked && showHelp && (
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
            transition: 'opacity 1s ease',
          }}
        >
          <div><strong>WASD</strong> - Se déplacer | <strong>Souris</strong> - Regarder</div>
          <div style={{ marginTop: '0.3rem', opacity: 0.7 }}>
            <strong>Clic</strong> ou <strong>E</strong> - Sélectionner cassette | <strong>ESC</strong> - Libérer souris
          </div>
        </div>
      )}

      {/* Terminal TV */}
      <TVTerminal isOpen={isTerminalOpen} onClose={handleCloseTerminal} />
    </>
  )
}

export function InteriorScene({ onCassetteClick }: InteriorSceneProps) {
  const isMobile = useIsMobile()
  const mobileInputRef = useRef<MobileInput>(createMobileInput())

  const films = useStore(state => state.films)
  const selectedFilmId = useStore(state => state.selectedFilmId)
  const hasSeenOnboarding = useStore(state => state.hasSeenOnboarding)

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
        dpr={isMobile ? Math.min(window.devicePixelRatio, 1.5) : Math.min(window.devicePixelRatio, 2)}
        gl={(async (props: any) => {
          console.log('[Canvas] Initializing WebGPU renderer...')
          const adapter = await navigator.gpu.requestAdapter()
          const maxLayers = adapter ? adapter.limits.maxTextureArrayLayers : 2048
          const renderer = new THREE.WebGPURenderer({
            ...props as THREE.WebGPURendererParameters,
            requiredLimits: {
              maxTextureArrayLayers: maxLayers,
            },
          })
          await renderer.init()
          renderer.shadowMap.enabled = true
          renderer.shadowMap.type = isMobile ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap
          renderer.toneMapping = THREE.ACESFilmicToneMapping
          renderer.toneMappingExposure = 1.0
          console.log(`[Canvas] WebGPU renderer initialized — shadows: ${isMobile ? 'PCF' : 'PCFSoft'}, dpr: ${isMobile ? '≤1.5' : '≤2'}`)
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
            />
          </Suspense>
        </SceneErrorBoundary>
      </Canvas>

      <UIOverlays isMobile={isMobile} />

      {/* Mobile controls (joystick + touch look + interact button) */}
      {isMobile && <MobileControls mobileInputRef={mobileInputRef} />}

      {/* Onboarding — first launch only */}
      {!hasSeenOnboarding && <MobileOnboarding isMobile={isMobile} />}
    </div>
  )
}
