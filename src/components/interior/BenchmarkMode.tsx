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
  const [historySize, setHistorySize] = useState(0)

  useEffect(() => {
    if (!enabled) return
    ensureStore()

    const interval = window.setInterval(() => {
      const store = ensureStore()
      if (!store) return
      setLatest(store.latest)
      setHistorySize(store.history.length)
    }, 300)

    return () => window.clearInterval(interval)
  }, [enabled])

  if (!enabled) return null

  const exportBenchmarkJson = () => {
    const store = ensureStore()
    if (!store) return
    const payload = {
      exportedAt: new Date().toISOString(),
      url: typeof window !== 'undefined' ? window.location.href : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      hardwareConcurrency: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : null,
      deviceMemory: typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null : null,
      history: store.history,
      latest: store.latest,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `videoclub-benchmark-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const resetBenchmark = () => {
    const store = ensureStore()
    if (!store) return
    store.startedAt = Date.now()
    store.history = []
    store.latest = null
    setLatest(null)
    setHistorySize(0)
  }

  return (
    <div
      style={{
        position: 'fixed',
        right: '1rem',
        bottom: '1rem',
        zIndex: 120,
        minWidth: '270px',
        padding: '0.75rem',
        borderRadius: '10px',
        border: '1px solid rgba(0,255,247,0.6)',
        background: 'rgba(5, 8, 12, 0.86)',
        color: '#dff',
        fontFamily: 'monospace',
        fontSize: '12px',
        lineHeight: 1.35,
      }}
    >
      <div style={{ color: '#00fff7', marginBottom: '0.35rem' }}>BENCHMARK MODE</div>
      <div>Samples: {historySize}</div>
      <div>FPS: {latest ? latest.fps.toFixed(1) : '-'}</div>
      <div>FPS avg: {latest ? latest.fpsAvg.toFixed(1) : '-'}</div>
      <div>FPS 1% low: {latest ? latest.fps1Low.toFixed(1) : '-'}</div>
      <div>Frame avg: {latest ? `${latest.frameMsAvg.toFixed(2)} ms` : '-'}</div>
      <div>Frame p95: {latest ? `${latest.frameMsP95.toFixed(2)} ms` : '-'}</div>
      <div>Draw calls: {latest ? latest.drawCalls : '-'}</div>
      <div>Triangles: {latest ? latest.triangles : '-'}</div>
      <div>Cassette chunks: {latest ? latest.cassetteChunks : '-'}</div>
      <div>Cassette instances: {latest ? latest.cassetteInstances : '-'}</div>

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
        <button
          onClick={exportBenchmarkJson}
          style={{
            flex: 1,
            background: 'rgba(0,255,247,0.15)',
            border: '1px solid rgba(0,255,247,0.45)',
            color: '#dff',
            padding: '0.35rem 0.5rem',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          Export JSON
        </button>
        <button
          onClick={resetBenchmark}
          style={{
            flex: 1,
            background: 'rgba(255,45,149,0.15)',
            border: '1px solid rgba(255,45,149,0.45)',
            color: '#ffd6ea',
            padding: '0.35rem 0.5rem',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          Reset
        </button>
      </div>
    </div>
  )
}
