import { create } from 'zustand'

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

export interface BakeDebugState {
  // LIVE
  env: number // environmentIntensity (ambient IBL fill)
  si: number // poster self-illumination
  lmi: number // lightMapIntensity on the shell
  pi: number // probe intensity on the K7
  k7: number // K7 emissive tone white-point — rolls off poster highlights (anti-glow)
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

export const useBakeDebug = create<BakeDebugState>((set) => ({
  env: q('env', 0.12),
  si: q('si', 0.2),
  lmi: q('lmi', 3.0),
  pi: q('pi', 1.2),
  k7: q('k7', 0.9),
  neon: q('neon', 1.5),
  fluo: q('fluo', 5.0),
  clamp: q('clamp', 100),
  bounces: q('bounces', 2),
  samples: q('samples', 96),
  rebakeNonce: 0,
  baking: false,
  set: (p) => set(p),
  requestRebake: () => set((s) => ({ rebakeNonce: s.rebakeNonce + 1 })),
  setBaking: (b) => set({ baking: b }),
}))
