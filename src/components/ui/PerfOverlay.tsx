'use client'

import { useEffect, useRef, useState } from 'react'

type Display = {
  fps: number
  fpsMin: number
  fpsP5: number
  heap: number
  janks: number
}

const SAMPLE_WINDOW = 60

export function PerfOverlay() {
  const [visible, setVisible] = useState(() => {
    if (typeof window === 'undefined') return false
    const qs = new URLSearchParams(window.location.search)
    return qs.get('perf') === '1'
  })
  const [display, setDisplay] = useState<Display>({
    fps: 0, fpsMin: 0, fpsP5: 0, heap: 0, janks: 0,
  })
  const samplesRef = useRef<number[]>([])
  const janksRef = useRef(0)
  const lastFrameRef = useRef(performance.now())
  const rafRef = useRef(0)

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'p' || e.key === 'P') setVisible(v => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!visible) return
    const tick = () => {
      const now = performance.now()
      const dt = now - lastFrameRef.current
      lastFrameRef.current = now
      if (dt > 33) janksRef.current += 1
      const fps = 1000 / dt
      const arr = samplesRef.current
      arr.push(fps)
      if (arr.length > SAMPLE_WINDOW) arr.shift()
      const sorted = [...arr].sort((a, b) => a - b)
      const fpsMin = sorted[0] ?? 0
      const fpsP5 = sorted[Math.floor(sorted.length * 0.05)] ?? 0
      const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0
      setDisplay({
        fps: Math.round(fps),
        fpsMin: Math.round(fpsMin),
        fpsP5: Math.round(fpsP5),
        heap: Math.round(heap / 1e6),
        janks: janksRef.current,
      })
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [visible])

  if (process.env.NODE_ENV !== 'development' || !visible) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 8,
        left: 8,
        zIndex: 99999,
        background: 'rgba(0,0,0,0.78)',
        color: '#0f0',
        padding: '6px 8px',
        fontFamily: 'ui-monospace, monospace',
        fontSize: 11,
        lineHeight: 1.35,
        borderRadius: 4,
        pointerEvents: 'none',
        textShadow: '0 0 4px rgba(0,255,0,0.35)',
      }}
    >
      <div>FPS {display.fps} (min {display.fpsMin} / p5 {display.fpsP5})</div>
      <div>Heap {display.heap} MB</div>
      <div>Janks &gt;33ms {display.janks}</div>
    </div>
  )
}
