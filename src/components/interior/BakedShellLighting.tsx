import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { collectShell } from '../../lib/lightbake/collectShell'
import { bakeAndAttachShell } from '../../lib/lightbake/bakeShellRuntime'

// Runtime A/B (`?baked=1`): bake the shell GI lightmap on the main renderer and attach it to the
// 6 static surfaces, replacing the analytical rig (dropped in Lighting). Renders nothing.
//
// The bake (~30 ping-pong passes) runs ONCE, with the frameloop paused so R3F doesn't render the
// scene into the bake's offscreen targets. The scene freezes for the bake duration — acceptable
// for this offline diagnostic; the real pipeline ships a pre-baked PNG (Task 6).
export function BakedShellLighting({ enabled }: { enabled: boolean }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const setFrameloop = useThree((s) => s.setFrameloop)
  const ranRef = useRef(false)

  useEffect(() => {
    if (!enabled || ranRef.current) return
    let cancelled = false
    let raf = 0
    const params = new URLSearchParams(window.location.search)
    const opts = {
      bounces: parseInt(params.get('bounces') || '2', 10),
      intensity: parseFloat(params.get('lmi') || '3.0'),
      albedo: parseFloat(params.get('alb') || '0.7'),
    }

    const bakeNow = async () => {
      ranRef.current = true
      setFrameloop('never') // freeze R3F so it can't render into the bake's ping-pong targets
      const t0 = performance.now()
      try {
        await bakeAndAttachShell(gl as unknown as THREE.WebGPURenderer, scene, opts)
        console.log(`[baked] shell GI lightmap attached in ${Math.round(performance.now() - t0)}ms`)
      } catch (e) {
        console.error('[baked] bake failed', e)
      } finally {
        setFrameloop('always')
      }
    }

    // Wait until all 6 `bake-*` meshes are mounted (Aisle + Storefront, post-suspense), then bake once.
    const poll = () => {
      let ready = true
      try { collectShell(scene) } catch { ready = false }
      if (ready) { void bakeNow() }
      else if (!cancelled) { raf = requestAnimationFrame(poll) }
    }
    poll()

    return () => { cancelled = true; if (raf) cancelAnimationFrame(raf) }
  }, [enabled, gl, scene, setFrameloop])

  return null
}
