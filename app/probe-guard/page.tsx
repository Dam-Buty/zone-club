'use client'

// ── PROBE TRAP-1 BUILD GUARD ──────────────────────────────────────────────────
// Compiles the REAL probe-sampling node graph (makeProbeVolume + shIrradiance) and asserts the
// generated WGSL samples the 3D volumes with `textureSample(Level)` — NEVER `textureLoad`.
//
// Trap 1 (verified vs three 0.184): a Data3DTexture left on its default NearestFilter makes
// `isUnfilterable()` true → `texture3D().sample()` silently compiles to `textureLoad` (point fetch)
// → banded probes, with NO error. makeProbeVolume's LinearFilter+HalfFloat is what flips it back.
// If someone regresses that factory, this page flips to FAIL. Result on `window.__probeGuard`.
//
// Run: /probe-guard  → reads `window.__probeGuard = { hasSample, hasLoad, pass }`.

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three/webgpu'
import { positionWorld, normalWorld, vec3, clamp } from 'three/tsl'
import { makeProbeVolume, shIrradiance } from '../../src/lib/lightbake/shReconstruct'
import { GRID_MIN, gridExt, G, PROBE_COUNT } from '../../src/lib/lightbake/probeGrid'

export default function ProbeGuard() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState('init')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let disposed = false
    ;(async () => {
      try {
        const renderer = new THREE.WebGPURenderer({ canvas, forceWebGL: false })
        await renderer.init()
        if (disposed) return

        // 3 volumes through the REAL factory (the Trap-1 fix lives in makeProbeVolume). Zeros are
        // fine — we test the generated SAMPLER, not the data.
        const zeros = () => new Uint16Array(PROBE_COUNT * 4)
        const shR = makeProbeVolume(zeros()), shG = makeProbeVolume(zeros()), shB = makeProbeVolume(zeros())

        // Minimal material that samples the volumes exactly like the K7 do.
        const e = gridExt()
        const gMin = vec3(GRID_MIN[0], GRID_MIN[1], GRID_MIN[2])
        const gInv = vec3(1 / e[0], 1 / e[1], 1 / e[2])
        const half = vec3(0.5 / G[0], 0.5 / G[1], 0.5 / G[2])
        const uvw = clamp(positionWorld.sub(gMin).mul(gInv), half, vec3(1).sub(half))
        const mat = new THREE.MeshBasicNodeMaterial()
        mat.colorNode = shIrradiance(shR, shG, shB, uvw, normalWorld)

        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat)
        const scene = new THREE.Scene()
        scene.add(mesh)
        const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10)
        camera.position.z = 3
        camera.updateMatrixWorld()

        const { vertexShader, fragmentShader } = await renderer.debug.getShaderAsync(scene, camera, mesh)
        const wgsl = `${vertexShader}\n${fragmentShader}`
        const hasSample = /textureSample(Level)?\s*\(/.test(wgsl)
        const hasLoad = /textureLoad\s*\(/.test(wgsl)
        const pass = hasSample && !hasLoad

        ;(window as unknown as { __probeGuard?: unknown }).__probeGuard = { hasSample, hasLoad, pass }
        setStatus(`probe-guard: textureSample=${hasSample} textureLoad=${hasLoad} → ${pass ? 'PASS ✅' : 'FAIL ❌ (Trap-1 regression)'}`)
        console.log('[probe-guard]', { hasSample, hasLoad, pass })
      } catch (err) {
        setStatus('error: ' + String(err))
        console.error('[probe-guard]', err)
      }
    })()
    return () => { disposed = true }
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', color: '#0f0', fontFamily: 'monospace', fontSize: 16, padding: 24 }}>
      <div>{status}</div>
      <canvas ref={canvasRef} width={4} height={4} style={{ display: 'none' }} />
    </div>
  )
}
