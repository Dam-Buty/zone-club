import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { uniform } from 'three/tsl'

// Live tuning store for the baked-lighting composition knobs (dev panel — BakeDebugPanel).
// Initialised from the URL (?env=/?si=/…) so a shared link still works, then driven live by the
// sliders. Two buckets:
//   • LIVE   (env/si/lmi/pi) — apply instantly, no re-bake (prop / material prop / TSL uniform).
//   • REBAKE (neon/fluo/clamp/bounces) — change the baked lightmap+probes → need a re-bake pass,
//     triggered by bumping `rebakeNonce` (the "Re-bake" button).
// 100% baked: every knob feeds emissive/ambient/lightmap inputs — none is a realtime analytic light.

const q = (k: string, d: number): number => {
  if (typeof window === 'undefined') return d
  const v = parseFloat(new URLSearchParams(window.location.search).get(k) || '')
  return Number.isFinite(v) ? v : d
}

// Knobs that can be set via the URL recipe (?env=&si=…). Used by the persist `merge` so an explicit
// URL param WINS over the persisted localStorage value — without this, persistence silently clobbered
// any recipe URL on reload (the panel's recipe link became inert after the first save).
const URL_KEYS = ['env', 'si', 'lmi', 'pi', 'k7', 'sign', 'ospec', 'mspec', 'mdesk', 'ogi', 'neon', 'fluo', 'clamp', 'bounces', 'samples'] as const
const urlOverrides = (): Partial<Record<(typeof URL_KEYS)[number], number>> => {
  if (typeof window === 'undefined') return {}
  const sp = new URLSearchParams(window.location.search)
  const o: Partial<Record<string, number>> = {}
  for (const k of URL_KEYS) {
    const raw = sp.get(k)
    if (raw === null) continue
    const v = parseFloat(raw)
    if (Number.isFinite(v)) o[k] = v
  }
  return o
}

export interface BakeDebugState {
  // LIVE
  env: number // environmentIntensity (ambient IBL fill)
  si: number // poster self-illumination
  lmi: number // lightMapIntensity on the shell
  pi: number // probe intensity on the K7
  k7: number // K7 emissive tone white-point — rolls off poster highlights (anti-glow)
  sign: number // REALTIME neon SIGN emissive multiplier (GenreSectionPanel) — tames the blown-white
               // signs while keeping their hue. LIVE (set per-frame by GenrePanelAnimator, no recompile).
               // Separate from `neon` (which is the BAKE rig → re-bake), so dialing signs is instant.
  ospec: number // object env-reflection ("catch the neon" on couch/shelves/props) → OBJ_SPEC
  mspec: number // floor specular (vitrine reflection pool on the floor) → MOON_SPEC
  mdesk: number // desk specular (vitrine reflection on the counter top) → MOON_DESK
  ogi: number // furniture/props DIFFUSE baked-light intensity (independent of K7) → OBJ_GI
  // REBAKE
  neon: number // coloured genre signs + floor pools boost
  fluo: number // white ceiling fluo boost
  clamp: number // firefly clamp (luminance/sample) — caps EXTREME direct fireflies; lower = stronger
  bounces: number // GI bounces
  samples: number // indirect hemisphere rays/texel — the real anti-noise (cloudiness) lever
  // control
  rebakeNonce: number
  baking: boolean
  set: (p: Partial<BakeDebugState>) => void
  requestRebake: () => void
  setBaking: (b: boolean) => void
}

export const useBakeDebug = create<BakeDebugState>()(persist((set) => ({
  // Defaults aligned on the validated night recipe (the look projected in the verification captures):
  // env=0.07 si=0.1 lmi=1.8 pi=0.7 neon=2.8 fluo=2.2 — a fresh load (no URL) now reproduces it.
  env: q('env', 0.07),
  si: q('si', 0.1),
  lmi: q('lmi', 1.8),
  pi: q('pi', 0.7),
  k7: q('k7', 0.9),
  sign: q('sign', 0.4), // 0.4 puts the dominant neon hues just UNDER the bloom threshold (lum 0.27 < 0.32)
                        // → coloured readable signs, no white-blob halo. 1.0 = the blown-out look. Live.
  ospec: q('ospec', 1.0),
  mspec: q('mspec', 1.1),
  mdesk: q('mdesk', 3),
  ogi: q('ogi', 1.0),
  neon: q('neon', 2.8),
  fluo: q('fluo', 2.2),
  clamp: q('clamp', 100),
  bounces: q('bounces', 2),
  samples: q('samples', 96),
  rebakeNonce: 0,
  baking: false,
  set: (p) => set(p),
  requestRebake: () => set((s) => ({ rebakeNonce: s.rebakeNonce + 1 })),
  setBaking: (b) => set({ baking: b }),
}), {
  name: 'zone-bake-tuning',
  version: 1,
  // Persist ONLY the tuning knobs → the panel's réglages survive reloads AND dev hot-reloads (they no
  // longer reset to defaults on every code edit, which was wiping the manual settings). Transient state
  // (rebakeNonce/baking/functions) is excluded.
  partialize: (s) => ({
    env: s.env, si: s.si, lmi: s.lmi, pi: s.pi, k7: s.k7, sign: s.sign,
    ospec: s.ospec, mspec: s.mspec, mdesk: s.mdesk, ogi: s.ogi,
    neon: s.neon, fluo: s.fluo, clamp: s.clamp, bounces: s.bounces, samples: s.samples,
  }),
  // Precedence: defaults ← persisted localStorage ← explicit URL params (URL wins). Lets a recipe link
  // override saved tuning on load, while a plain reload (no params) keeps the user's persisted look.
  merge: (persisted, current) => ({ ...current, ...(persisted as object), ...urlOverrides() }),
}))

// Shared live "probe intensity" uniform. EVERY SH-L1 receiver — K7/shelves (CassetteInstances),
// comptoir (Aisle), couch, manager, board + sticky notes, TV/VCR shell — reads THIS one uniform, so
// the dev panel's `pi` slider drives the WHOLE baked scene coherently (previously only the K7 tracked
// it; the furniture read ?pi once at module load and stayed frozen). Synced from the store's `pi` in
// CassetteInstances. Module-level singleton: survives material rebuilds and a `.value =` write is a
// cheap GPU uniform update (no shader recompile).
export const PROBE_PI = uniform(q('pi', 0.7))

// Manager (Rick) GI scale — DECOUPLED from PROBE_PI. Rick is a white/light GLB (lab coat), so the SH
// irradiance (incl. the cold moon injected through the vitrine he stands behind) blows him to pure
// white. This dims HIM alone, so the counter's moon rim can stay visible while Rick calms down.
// Live-tunable via window.__RICK (or ?rick=…). Default 0.5 = half.
export const MANAGER_GI = uniform(q('rick', 0.35))

// Desk (counter) cold SPECULAR — the varnished top CATCHES the cold vitrine light as a baked, view-
// dependent highlight, so the desk reads as "lit by the moonlight" instead of a flat self-glow (the
// "objets éclairés par la lumière, pas auto-illuminés" feedback). Live via window.__MDESK / ?mdesk=.
export const MOON_DESK = uniform(q('mdesk', 3))

// Object SPECULAR scale — the baked "catch the neon" highlight (shSpecular) on GLOSSY probe receivers
// (couch leather, …) so they read as lit BY the neon, not self-glowing. Shared, live via window.__OSPEC.
export const OBJ_SPEC = uniform(q('ospec', 1.0))

// Furniture/props DIFFUSE GI multiplier — scales how lit the MEUBLES & props are by the baked light,
// INDEPENDENTLY of the K7 (which keep PROBE_PI). Applied on top of each receiver's diffuse term; default
// 1 = no change. Lets the user dial the objects' illumination "à sa guise". Live via the panel / ?ogi=.
export const OBJ_GI = uniform(q('ogi', 1.0))
