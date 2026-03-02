import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'

interface BenchmarkSample {
  ts: number
  fps: number
  fpsAvg: number
  fps1Low: number
  frameMsAvg: number
  frameMsP95: number
  drawCalls: number
  triangles: number
  lines: number
  points: number
  cassetteChunks: number
  cassetteInstances: number
  isMobile: boolean
}

interface BenchmarkStore {
  startedAt: number
  latest: BenchmarkSample | null
  history: BenchmarkSample[]
}

declare global {
  interface Window {
    __videoclubBenchmark?: BenchmarkStore
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)))
  return sorted[idx]
}

function ensureStore(): BenchmarkStore | null {
  if (typeof window === 'undefined') return null
  if (!window.__videoclubBenchmark) {
    window.__videoclubBenchmark = {
      startedAt: Date.now(),
      latest: null,
      history: [],
    }
  }
  return window.__videoclubBenchmark
}

export function BenchmarkSampler({
  enabled,
  isMobile,
}: {
  enabled: boolean
  isMobile: boolean
}) {
  const gl = useThree(state => state.gl)
  const scene = useThree(state => state.scene)

  const frameMsSamplesRef = useRef<number[]>([])
  const fpsSamplesRef = useRef<number[]>([])
  const stateRef = useRef({
    lastEmit: 0,
    lastChunkScan: 0,
    cassetteChunks: 0,
    cassetteInstances: 0,
  })

  useFrame((_frameState, delta) => {
    if (!enabled) return

    const frameMsSamples = frameMsSamplesRef.current
    const fpsSamples = fpsSamplesRef.current
    const state = stateRef.current

    const now = performance.now()
    const frameMs = delta * 1000
    const fps = delta > 0 ? 1 / delta : 0

    frameMsSamples.push(frameMs)
    fpsSamples.push(fps)
    if (frameMsSamples.length > 600) frameMsSamples.shift()
    if (fpsSamples.length > 600) fpsSamples.shift()

    if (now - state.lastChunkScan > 1000) {
      let chunks = 0
      let instances = 0
      scene.traverse((obj) => {
        if (obj.userData?.cassetteChunkIndex !== undefined && (obj as { isInstancedMesh?: boolean }).isInstancedMesh) {
          chunks += 1
          instances += (obj as { count?: number }).count ?? 0
        }
      })
      state.cassetteChunks = chunks
      state.cassetteInstances = instances
      state.lastChunkScan = now
    }

    if (now - state.lastEmit < 250) return
    state.lastEmit = now

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const renderInfo = (gl as any)?.info?.render ?? {}
    const fpsAvg = fpsSamples.length > 0 ? fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length : 0
    const fps1Low = percentile(fpsSamples, 1)
    const frameMsAvg = frameMsSamples.length > 0 ? frameMsSamples.reduce((a, b) => a + b, 0) / frameMsSamples.length : 0
    const frameMsP95 = percentile(frameMsSamples, 95)

    const sample: BenchmarkSample = {
      ts: Date.now(),
      fps,
      fpsAvg,
      fps1Low,
      frameMsAvg,
      frameMsP95,
      drawCalls: renderInfo.calls ?? 0,
      triangles: renderInfo.triangles ?? 0,
      lines: renderInfo.lines ?? 0,
      points: renderInfo.points ?? 0,
      cassetteChunks: state.cassetteChunks,
      cassetteInstances: state.cassetteInstances,
      isMobile,
    }

    const store = ensureStore()
    if (!store) return

    store.latest = sample
    store.history.push(sample)
    if (store.history.length > 1200) store.history.shift()
  })

  return null
}

export function BenchmarkOverlay({ enabled }: { enabled: boolean }) {
  const [latest, setLatest] = useState<BenchmarkSample | null>(null)

  useEffect(() => {
    if (!enabled) return
    ensureStore()

    const interval = window.setInterval(() => {
      const store = ensureStore()
      if (!store) return
      setLatest(store.latest)
    }, 300)

    return () => window.clearInterval(interval)
  }, [enabled])

  if (!enabled) return null

  return (
    <div
      style={{
        position: 'fixed',
        left: '0.5rem',
        top: '0.5rem',
        zIndex: 120,
        padding: '4px 8px',
        borderRadius: '4px',
        background: 'rgba(0, 0, 0, 0.5)',
        color: '#0f0',
        fontFamily: 'monospace',
        fontSize: '11px',
        lineHeight: 1.4,
        pointerEvents: 'none',
      }}
    >
      <div>FPS {latest ? latest.fps.toFixed(0) : '-'}</div>
      <div>AVG {latest ? latest.fpsAvg.toFixed(0) : '-'}</div>
    </div>
  )
}
