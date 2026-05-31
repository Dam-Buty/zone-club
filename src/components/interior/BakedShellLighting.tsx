import { useCallback, useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { collectShell } from '../../lib/lightbake/collectShell'
import { bakeAndAttachShell, SHELL_LMI } from '../../lib/lightbake/bakeShellRuntime'
import { probeBakeRaw, packProbeVolumes } from '../../lib/lightbake/probeBake'
import { classifyDeadProbes, floodFillDeadProbes } from '../../lib/lightbake/probeGrid'
import { emissiveRig } from '../../lib/lightbake/emissiveRig'
import { useBakeDebug } from './bakeDebugStore'
import type { ProbeVolumes } from './ProbeVolumeContext'

// Runtime (`?baked=1`): on the MAIN renderer, bake (1) the shell GI lightmap → attach to the 6 static
// surfaces, then (2) the Phase-2 SH-L1 probe volume (reusing the shell BVH + the lightmap as emitter)
// → publish via `onProbeVolumes` for the dynamic receivers. The analytical rig is dropped in Lighting.
// Renders nothing. The bake runs with the frameloop paused (else R3F renders the scene into the bake's
// offscreen targets and corrupts it). Composition params come from bakeDebugStore (dev panel): neon/
// fluo/clamp/bounces drive a RE-BAKE (the "Re-bake" button bumps rebakeNonce); lmi is applied live.
export function BakedShellLighting({ enabled, onProbeVolumes }: { enabled: boolean; onProbeVolumes?: (v: ProbeVolumes) => void }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const setFrameloop = useThree((s) => s.setFrameloop)
  const ranRef = useRef(false)
  const bakingRef = useRef(false)
  const prevLightmapRef = useRef<THREE.Texture | null>(null)
  const rebakeNonce = useBakeDebug((s) => s.rebakeNonce)
  const lmi = useBakeDebug((s) => s.lmi)

  const bakeNow = useCallback(async () => {
    if (bakingRef.current) return // never overlap two bakes (spammed Re-bake button)
    bakingRef.current = true
    useBakeDebug.getState().setBaking(true)
    setFrameloop('never') // freeze R3F so it can't render into the bakes' ping-pong/compute targets
    const renderer = gl as unknown as THREE.WebGPURenderer
    const d = useBakeDebug.getState() // read CURRENT knob values (re-bake uses live panel values)
    const albParam = parseFloat(new URLSearchParams(window.location.search).get('alb') || '0.7')
    const opts = {
      bounces: Math.round(d.bounces),
      samples: Math.round(d.samples),
      intensity: d.lmi,
      albedo: Number.isFinite(albParam) ? albParam : 0.7,
      clampDirect: d.clamp,
      neonBoost: d.neon,
      fluoBoost: d.fluo,
    }
    try {
      const t0 = performance.now()
      const { lightmap, bvhGeo, bvh, lightmapRes } = await bakeAndAttachShell(renderer, scene, opts)
      console.log(`[baked] shell GI lightmap attached in ${Math.round(performance.now() - t0)}ms`)

      // ── Phase 2 — SH-L1 probe volume ──
      const t1 = performance.now()
      const { r, g, b } = await probeBakeRaw(renderer, bvhGeo, bvh, lightmap, lightmapRes, emissiveRig({ neon: d.neon, fluo: d.fluo }), undefined, d.clamp)
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
      // Publish unconditionally: the bake completed and the volumes are valid even if React
      // StrictMode flipped the mount (the second mount returns early on ranRef).
      onProbeVolumes?.(vols)
      // Free the previous bake's lightmap (re-bake path) now that the new one is attached.
      if (prevLightmapRef.current && prevLightmapRef.current !== lightmap) prevLightmapRef.current.dispose()
      prevLightmapRef.current = lightmap
      console.log(`[baked] probe volume ready in ${Math.round(performance.now() - t1)}ms (${occluderBoxes.length} occluder boxes, ${deadCount} dead probes flood-filled)`)
    } catch (e) {
      console.error('[baked] bake failed', e)
    } finally {
      setFrameloop('always')
      bakingRef.current = false
      useBakeDebug.getState().setBaking(false)
    }
  }, [gl, scene, setFrameloop, onProbeVolumes])

  // Initial bake — wait until all 6 `bake-*` meshes are mounted (Aisle + Storefront), then bake once.
  useEffect(() => {
    if (!enabled || ranRef.current) return
    let cancelled = false
    let raf = 0
    const poll = () => {
      let ready = true
      try { collectShell(scene) } catch { ready = false }
      if (ready) { ranRef.current = true; void bakeNow() }
      else if (!cancelled) { raf = requestAnimationFrame(poll) }
    }
    poll()
    return () => { cancelled = true; if (raf) cancelAnimationFrame(raf) }
  }, [enabled, scene, bakeNow])

  // Re-bake on demand — the dev panel's "Re-bake" button bumps rebakeNonce. Skip the initial value (0).
  useEffect(() => {
    if (!enabled || !ranRef.current || rebakeNonce === 0) return
    void bakeNow()
  }, [rebakeNonce, enabled, bakeNow])

  // Live lmi — drive the shell emissiveNode intensity uniform directly (no re-bake, instant).
  useEffect(() => {
    SHELL_LMI.value = lmi
  }, [lmi])

  return null
}
