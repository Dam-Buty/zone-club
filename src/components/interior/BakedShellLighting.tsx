import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { collectShell } from '../../lib/lightbake/collectShell'
import { bakeAndAttachShell } from '../../lib/lightbake/bakeShellRuntime'
import { probeBakeRaw, packProbeVolumes } from '../../lib/lightbake/probeBake'
import { classifyDeadProbes, floodFillDeadProbes } from '../../lib/lightbake/probeGrid'
import { emissiveRig } from '../../lib/lightbake/emissiveRig'
import type { ProbeVolumes } from './ProbeVolumeContext'

// Runtime A/B (`?baked=1`): on the MAIN renderer, bake (1) the shell GI lightmap → attach to the 6
// static surfaces, then (2) the Phase-2 SH-L1 probe volume (reusing the shell BVH + the lightmap as
// emitter) → publish via `onProbeVolumes` for the dynamic receivers. The analytical rig is dropped
// in Lighting. Renders nothing. Both bakes run ONCE with the frameloop paused (else R3F renders the
// scene into the bake's offscreen targets and corrupts it).
export function BakedShellLighting({ enabled, onProbeVolumes }: { enabled: boolean; onProbeVolumes?: (v: ProbeVolumes) => void }) {
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
      setFrameloop('never') // freeze R3F so it can't render into the bakes' ping-pong/compute targets
      const renderer = gl as unknown as THREE.WebGPURenderer
      try {
        const t0 = performance.now()
        const { lightmap, bvhGeo, bvh, lightmapRes } = await bakeAndAttachShell(renderer, scene, opts)
        console.log(`[baked] shell GI lightmap attached in ${Math.round(performance.now() - t0)}ms`)

        // ── Phase 2 — SH-L1 probe volume ──
        const t1 = performance.now()
        const { r, g, b } = await probeBakeRaw(renderer, bvhGeo, bvh, lightmap, lightmapRes, emissiveRig())
        // Dead-probe AABBs from the LIVE solid occluders (islands + comptoir). Skip InstancedMesh
        // (cassettes/planks — their setFromObject bbox spans every instance ≈ the whole room) and
        // tiny/room-spanning boxes; keep the mid-size solids that actually trap interior probes.
        const { occluders } = collectShell(scene)
        const box = new THREE.Box3(), size = new THREE.Vector3()
        const occluderBoxes = occluders
          .filter((m) => !(m as THREE.InstancedMesh).isInstancedMesh)
          .map((m) => { box.setFromObject(m); box.getSize(size); return { min: box.min.toArray(), max: box.max.toArray(), vol: size.x * size.y * size.z } })
          .filter((o) => o.vol > 0.2 && o.vol < 6)
          .map((o) => ({ min: o.min, max: o.max }))
        const valid = classifyDeadProbes(occluderBoxes)
        const deadCount = valid.length - valid.reduce((s, v) => s + v, 0)
        floodFillDeadProbes([r, g, b], valid)
        const vols = packProbeVolumes(r, g, b)
        if (!cancelled) onProbeVolumes?.(vols)
        console.log(`[baked] probe volume ready in ${Math.round(performance.now() - t1)}ms (${occluderBoxes.length} occluder boxes, ${deadCount} dead probes flood-filled)`)
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
  }, [enabled, gl, scene, setFrameloop, onProbeVolumes])

  return null
}
