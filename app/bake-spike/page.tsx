'use client'

// ── DE-RISK SPIKE — three-gpu-pathtracer feasibility ──────────────────────────
// Isolated WebGL2 page (NOT the app's WebGPU renderer). Validates:
//  1. three-gpu-pathtracer 0.0.24 runs in our stack (three 0.184).
//  2. Native ingestion of three's RectAreaLight (PathTracingSceneGenerator gathers
//     isRectAreaLight) → the scene should show soft area-light shadows + GI bounce.
// Throwaway: route /bake-spike, no app wiring. Drive via Playwright + screenshot.

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { WebGLPathTracer } from 'three-gpu-pathtracer'

export default function BakeSpike() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState('init')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let raf = 0
    let disposed = false

    const setS = (s: string) => {
      setStatus(s)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__bakeSpike = { status: s }
    }

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false })
    } catch (e) {
      setS('error: WebGLRenderer ' + String(e))
      return
    }
    renderer.setSize(900, 650, false)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.0

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0a0a0f)

    const camera = new THREE.PerspectiveCamera(50, 900 / 650, 0.1, 100)
    camera.position.set(0, 2.2, 5.5)
    camera.lookAt(0, 0.6, 0)

    // Floor + back wall (catch GI bounce / contact shadows)
    const matFloor = new THREE.MeshStandardMaterial({ color: 0xcfcabf, roughness: 0.85, metalness: 0 })
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), matFloor)
    floor.rotation.x = -Math.PI / 2
    scene.add(floor)
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), new THREE.MeshStandardMaterial({ color: 0xb8472f, roughness: 0.9 }))
    wall.position.set(0, 3, -3)
    scene.add(wall)

    // A box + a sphere → visible soft shadows + colour bleed from the red wall
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.5 }))
    box.position.set(-1.3, 0.6, -0.5)
    scene.add(box)
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.7, 48, 24), new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.15, metalness: 0.0 }))
    sphere.position.set(1.2, 0.7, 0.2)
    scene.add(sphere)

    // ── THE KEY TEST: a three.js RectAreaLight (like the 14 in the video-club) ──
    const rect = new THREE.RectAreaLight(0xfff0e0, 6, 3.5, 1.0)
    rect.position.set(0, 4.2, 0.5)
    rect.lookAt(0, 0, 0)
    scene.add(rect)

    const ptRenderer = new WebGLPathTracer(renderer)
    ptRenderer.bounces = 5
    ptRenderer.renderScale = 1

    ;(async () => {
      try {
        setS('building BVH + compiling…')
        // Sync setScene → builds the BVH on the main thread (no worker needed).
        ptRenderer.setScene(scene, camera)
        setS('rendering…')
        const loop = () => {
          if (disposed) return
          ptRenderer.renderSample()
          const s = ptRenderer.samples
          const txt = `samples: ${Math.round(s)}`
          setStatus(txt)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(window as any).__bakeSpike = { status: 'rendering', samples: s }
          if (s < 200) raf = requestAnimationFrame(loop)
          else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;(window as any).__bakeSpike = { status: 'done', samples: s }
            setStatus(`DONE — ${Math.round(s)} samples`)
          }
        }
        loop()
      } catch (e) {
        setS('error: ' + String(e))
        console.error('[bake-spike]', e)
      }
    })()

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      renderer.dispose()
    }
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', top: 10, left: 12, color: '#0f0', fontFamily: 'monospace', fontSize: 14, zIndex: 10 }}>
        bake-spike · {status}
      </div>
      <canvas ref={canvasRef} style={{ maxWidth: '100%', maxHeight: '100%' }} />
    </div>
  )
}
