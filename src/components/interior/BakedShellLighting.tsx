import { useCallback, useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { collectShell } from '../../lib/lightbake/collectShell'
import { bakeAndAttachShell, SHELL_LMI, MOON_RAKE, MOON_DAMP, MOON_SPEC, WALL_SPEC } from '../../lib/lightbake/bakeShellRuntime'
import { probeBakeRaw, packProbeVolumes } from '../../lib/lightbake/probeBake'
import { classifyDeadProbes, floodFillDeadProbes } from '../../lib/lightbake/probeGrid'
import { emissiveRig, MOONLIGHT } from '../../lib/lightbake/emissiveRig'
import type { MoonGobo } from '../../lib/lightbake/radiosityBake'
import { useBakeDebug, OBJ_SPEC, MOON_DESK, OBJ_GI } from './bakeDebugStore'
import type { ProbeVolumes } from './ProbeVolumeContext'

// Storefront glass mask, loaded ONCE as DATA (NoColorSpace, flipY=false, Nearest — textureLoad ignores
// the sampler anyway) for the baked moonlight cookie/gobo. Cached across re-bakes.
let _maskTexPromise: Promise<THREE.Texture | null> | null = null
function loadMoonMask(): Promise<THREE.Texture | null> {
  if (!_maskTexPromise) {
    _maskTexPromise = new THREE.TextureLoader().loadAsync('/storefront-mask.png').then((t) => {
      t.colorSpace = THREE.NoColorSpace
      t.flipY = false
      t.minFilter = THREE.NearestFilter
      t.magFilter = THREE.NearestFilter
      t.generateMipmaps = false
      t.needsUpdate = true
      return t
    }).catch(() => null)
  }
  return _maskTexPromise
}

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
  const rebakeNonce = useBakeDebug((s) => s.rebakeNonce)
  const lmi = useBakeDebug((s) => s.lmi)
  const ospec = useBakeDebug((s) => s.ospec)
  const mspec = useBakeDebug((s) => s.mspec)
  const mdesk = useBakeDebug((s) => s.mdesk)
  const ogi = useBakeDebug((s) => s.ogi)

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
      poolsBoost: d.pools,
      signFocus: d.sfocus,
    }
    // Build the exterior moonlight gobo (baked directional cookie through the storefront glass mask).
    // Intensity ?moon=, debug dump ?moonDebug=1, mask sub-rect ?msub=offX,offY,scaleX,scaleY (calibration).
    const urlNum = (k: string, dflt: number) => { const v = parseFloat(new URLSearchParams(window.location.search).get(k) || ''); return Number.isFinite(v) ? v : dflt }
    const maskTex = await loadMoonMask()
    const moonInt = urlNum('moon', MOONLIGHT.intensity)
    MOON_RAKE.value = urlNum('mrake', 0.45) // floor DIFFUSE cold intensity (live). ×albedo+falloff → lit hex pool. 1.1 noyait l'avant de la salle en blanc laiteux sur le sol re-tuné (plus sombre) — 0.45 garde le rai en accent (A/B 10/06)
    MOON_DAMP.value = urlNum('mdamp', 0.45) // warm-GI keep under the rake (higher = gentler/integrated) (live)
    MOON_SPEC.value = useBakeDebug.getState().mspec // floor SPECULAR (vitrine reflection); panel slider 'mspec' (store) — read here so a re-bake preserves the slider value, live-synced below
    WALL_SPEC.value = urlNum('wspec', 0.45) // sheen satiné des murs (live) — voir bakeShellRuntime
    ;(window as unknown as { __MR?: unknown; __MD?: unknown; __MSPEC?: unknown }).__MR = MOON_RAKE // live tuning (no re-bake)
    ;(window as unknown as { __MD?: unknown }).__MD = MOON_DAMP
    ;(window as unknown as { __MSPEC?: unknown }).__MSPEC = MOON_SPEC
    ;(window as unknown as { __WSPEC?: unknown }).__WSPEC = WALL_SPEC
    const msubRaw = (new URLSearchParams(window.location.search).get('msub') || '').split(',').map(Number)
    const mc = new THREE.Color(MOONLIGHT.color) // THREE.Color stores LINEAR rgb (ColorManagement on)
    const moon: MoonGobo | null = maskTex ? {
      maskTex,
      dir: MOONLIGHT.dir,
      rad: [mc.r * moonInt, mc.g * moonInt, mc.b * moonInt],
      zWall: MOONLIGHT.zWall,
      winRect: MOONLIGHT.winRect,
      maskSub: (msubRaw.length === 4 && msubRaw.every(Number.isFinite)) ? (msubRaw as [number, number, number, number]) : MOONLIGHT.maskSub,
      doorRect: MOONLIGHT.doorRect,
      doorMaskSub: MOONLIGHT.doorMaskSub,
      neonDamp: urlNum('mdamp', MOONLIGHT.neonDamp),
      probeScale: urlNum('mprobe', MOONLIGHT.probeScale),
      maskFloor: urlNum('mfloor', MOONLIGHT.maskFloor),
      shadow: urlNum('moonShadow', 1) !== 0,
      debug: urlNum('moonDebug', 0),
    } : null
    try {
      const t0 = performance.now()
      const { lightmap, bvhGeo, bvh, lightmapRes } = await bakeAndAttachShell(renderer, scene, opts, moon)
      console.log(`[baked] shell GI lightmap attached in ${Math.round(performance.now() - t0)}ms${moon ? ` (moon gobo${moon.debug ? ' DEBUG' : ''} int=${moonInt})` : ''}`)

      // ── Phase 2 — SH-L1 probe volume ──
      const t1 = performance.now()
      // moon (with its interior-occluder BVH, attached during bakeAndAttachShell) → injected into the SH
      // probes so the counter top / Rick / furniture catch the cold exterior rim ("ce qui est sur son passage").
      const { r, g, b } = await probeBakeRaw(renderer, bvhGeo, bvh, lightmap, lightmapRes, emissiveRig({ neon: d.neon, fluo: d.fluo, pools: d.pools, sfocus: d.sfocus }), undefined, d.clamp, moon)
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
      // No lightmap disposal: it lives in a persistent module-level render target (radiosityBake
      // bakeTargets) reused across re-bakes. Disposing it here freed the very target the shell
      // materials still sample → the "Re-bake" button rendered the walls/floor/ceiling black.
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

  // Live reflection intensities — the panel sliders (ospec/mspec/mdesk) drive the specular uniforms
  // directly, instantly, no re-bake (the reflections are runtime per-fragment, not baked-in).
  useEffect(() => { OBJ_SPEC.value = ospec }, [ospec])
  useEffect(() => { MOON_SPEC.value = mspec }, [mspec])
  useEffect(() => { MOON_DESK.value = mdesk }, [mdesk])
  useEffect(() => { OBJ_GI.value = ogi }, [ogi])

  return null
}
