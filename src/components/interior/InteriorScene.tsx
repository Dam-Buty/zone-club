import * as THREE from 'three/webgpu'
import { RectAreaLightNode } from 'three/webgpu'
import { Canvas, extend, type ThreeToJSXElements } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useCallback, memo, Component, type ReactNode, lazy } from 'react'
import { useStore } from '../../store'
import { Lighting } from './Lighting'
import { Controls } from './Controls'
import { PostProcessingEffects } from './PostProcessingEffects'
import { Environment } from '@react-three/drei'

// Lazy loading du composant Aisle (contient tous les modèles 3D)
const Aisle = lazy(() => import('./Aisle').then(module => ({ default: module.Aisle })))
import { VHSCaseViewer } from './VHSCaseViewer'
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js'
import { TVTerminal } from '../terminal/TVTerminal'

// Initialiser les textures LTC AVANT tout rendu
// C'est synchrone et doit être fait une seule fois
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

extend(THREE as unknown as Record<string, unknown>)

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

// Memoized 3D scene content — only re-renders when films or onCassetteClick change
// Prevents cascading re-renders from UI state changes (pointer lock, terminal, modal)
const SceneContent = memo(function SceneContent({
  films,
  onCassetteClick,
  selectedFilm
}: {
  films: import('../../types').Film[]
  onCassetteClick?: (filmId: number) => void
  selectedFilm: import('../../types').Film | null
}) {
  useEffect(() => {
    console.log('[SceneContent] Mounted with', films.length, 'films')
  }, [films.length])

  return (
    <>
      {/* Environment map HDRI pour réflexions sur surfaces brillantes (sol, métal, vitres) */}
      <Environment
        files="/textures/env/indoor_night.hdr"
        background={false}
        environmentIntensity={0.35}
      />
      <Lighting />
      <Aisle films={films} />
      <Controls onCassetteClick={onCassetteClick} />
      <PostProcessingEffects />
      {/* VHS Case 3D viewer */}
      {selectedFilm && <VHSCaseViewer film={selectedFilm} />}
    </>
  )
})

// UI Overlays — separate component to isolate UI state re-renders from the 3D Canvas
function UIOverlays() {
  const isPointerLocked = useStore(state => state.isPointerLocked)
  const managerVisible = useStore(state => state.managerVisible)
  const isTerminalOpen = useStore(state => state.isTerminalOpen)
  const selectedFilmId = useStore(state => state.selectedFilmId)
  const closeTerminal = useStore(state => state.closeTerminal)
  const requestPointerLock = useStore(state => state.requestPointerLock)

  const handleCloseTerminal = useCallback(() => {
    closeTerminal()
    requestPointerLock()
  }, [closeTerminal, requestPointerLock])

  return (
    <>
      {/* Message "Cliquez pour prendre le contrôle" quand non locké et aucun overlay ouvert */}
      {!isPointerLocked && !isTerminalOpen && !selectedFilmId && (
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

      {/* Crosshair / Viseur - seulement quand locké */}
      {isPointerLocked && (
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
          {/* Ligne horizontale */}
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
          {/* Ligne verticale */}
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

      {/* Controls help - seulement quand locké */}
      {isPointerLocked && (
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
          }}
        >
          <div><strong>WASD</strong> - Se déplacer | <strong>Souris</strong> - Regarder</div>
          <div style={{ marginTop: '0.3rem', opacity: 0.7 }}>
            <strong>Clic</strong> ou <strong>E</strong> - Sélectionner cassette | <strong>ESC</strong> - Libérer souris
          </div>
        </div>
      )}

      {/* Terminal TV - rendu en dehors du Canvas R3F */}
      <TVTerminal isOpen={isTerminalOpen} onClose={handleCloseTerminal} />
    </>
  )
}

export function InteriorScene({ onCassetteClick }: InteriorSceneProps) {
  // Only subscribe to films — UI state is handled by UIOverlays separately
  const films = useStore(state => state.films)
  const selectedFilmId = useStore(state => state.selectedFilmId)

  // Combiner TOUS les films de tous les rayons (sans doublons)
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

  // Find selected film for VHS viewer
  const selectedFilm = useMemo(() => {
    if (!selectedFilmId) return null
    return allFilms.find(f => f.id === selectedFilmId) || null
  }, [selectedFilmId, allFilms])

  useEffect(() => {
    console.log('[InteriorScene] Total unique films loaded:', allFilms.length)
  }, [allFilms.length])

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Canvas
        gl={async (props) => {
          console.log('[Canvas] Initializing WebGPU renderer...')
          // Request elevated maxTextureArrayLayers for DataArrayTexture (520 cassette poster layers)
          // WebGPU default is 256, M1 Metal supports up to 2048
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
          renderer.shadowMap.type = THREE.PCFSoftShadowMap
          renderer.toneMapping = THREE.ACESFilmicToneMapping
          renderer.toneMappingExposure = 1.0
          console.log('[Canvas] WebGPU renderer initialized with shadows + ACES tone mapping')
          return renderer
        }}
        onCreated={(state) => {
          console.log('[Canvas] onCreated - scene ready')
          console.log('[Canvas] Renderer type:', state.gl.constructor.name)
        }}
      >
        <SceneErrorBoundary>
          <Suspense fallback={<LoadingFallback />}>
            <SceneContent films={allFilms} onCassetteClick={onCassetteClick} selectedFilm={selectedFilm} />
          </Suspense>
        </SceneErrorBoundary>
      </Canvas>

      <UIOverlays />
    </div>
  )
}
