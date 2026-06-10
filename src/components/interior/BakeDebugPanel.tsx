import { useState } from 'react'
import { useBakeDebug, type BakeDebugState } from './bakeDebugStore'

// Dev-only live tuning panel for the baked-lighting composition. Mounted in the DOM (sibling of the
// Canvas), it drives bakeDebugStore. LIVE knobs apply instantly; REBAKE knobs need the "Re-bake"
// button (they change the baked lightmap+probes). Shows the URL recipe so a look can be locked.

const LIVE: { k: keyof BakeDebugState; label: string; min: number; max: number; step: number }[] = [
  { k: 'env', label: 'env · ambiant IBL', min: 0, max: 0.3, step: 0.005 },
  { k: 'si', label: 'si · self-illum K7', min: 0, max: 0.4, step: 0.01 },
  { k: 'lmi', label: 'lmi · lightmap', min: 0, max: 5, step: 0.1 },
  { k: 'pi', label: 'pi · GI sur K7', min: 0, max: 3, step: 0.05 },
  { k: 'k7', label: 'k7 · tone posters (bas=mat)', min: 0.2, max: 2, step: 0.05 },
  { k: 'sign', label: 'sign · brillance VISIBLE enseignes (live)', min: 0, max: 1.5, step: 0.05 },
  { k: 'ospec', label: 'reflets · objets (néon)', min: 0, max: 4, step: 0.1 },
  { k: 'mspec', label: 'reflets · sol (vitrine)', min: 0, max: 4, step: 0.1 },
  { k: 'mdesk', label: 'reflets · bureau (vitrine)', min: 0, max: 6, step: 0.1 },
  { k: 'ogi', label: 'lumière · meubles (diffus)', min: 0, max: 4, step: 0.1 },
]
const REBAKE: { k: keyof BakeDebugState; label: string; min: number; max: number; step: number }[] = [
  { k: 'neon', label: 'neon · puissance GI enseignes', min: 0, max: 6, step: 0.1 },
  { k: 'pools', label: 'pools · flaques colorées sol', min: 0, max: 4, step: 0.1 },
  { k: 'sfocus', label: 'sfocus · focalisation enseignes (1=diffus)', min: 1, max: 6, step: 0.5 },
  { k: 'fluo', label: 'fluo · néon blanc', min: 0, max: 6, step: 0.1 },
  { k: 'samples', label: 'samples · qualité (anti-nébulosité)', min: 32, max: 512, step: 32 },
  { k: 'bounces', label: 'bounces · rebonds GI', min: 1, max: 4, step: 1 },
  { k: 'clamp', label: 'clamp · firefly extrême (bas=fort)', min: 20, max: 160, step: 10 },
]

function Slider({ k, label, min, max, step }: { k: keyof BakeDebugState; label: string; min: number; max: number; step: number }) {
  const value = useBakeDebug((s) => s[k] as number)
  const set = useBakeDebug((s) => s.set)
  return (
    <label style={{ display: 'block', marginBottom: 6 }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', opacity: 0.85 }}>
        <span>{label}</span>
        <b style={{ color: '#7fd3ff' }}>{value.toFixed(step < 1 ? (step < 0.05 ? 3 : 2) : 0)}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => set({ [k]: parseFloat(e.target.value) } as Partial<BakeDebugState>)}
        style={{ width: '100%', accentColor: '#ff2d95', cursor: 'pointer' }}
      />
    </label>
  )
}

export function BakeDebugPanel() {
  const [open, setOpen] = useState(true)
  const baking = useBakeDebug((s) => s.baking)
  const requestRebake = useBakeDebug((s) => s.requestRebake)
  const s = useBakeDebug()
  const recipe = `?baked=1&env=${s.env}&si=${s.si}&neon=${s.neon}&fluo=${s.fluo}&pools=${s.pools}&sfocus=${s.sfocus}&lmi=${s.lmi}&pi=${s.pi}&k7=${s.k7}&sign=${s.sign}&ospec=${s.ospec}&mspec=${s.mspec}&mdesk=${s.mdesk}&ogi=${s.ogi}&clamp=${s.clamp}&bounces=${s.bounces}&samples=${s.samples}`

  return (
    <div
      style={{
        position: 'fixed', top: 12, right: 12, width: 248, zIndex: 10000,
        font: '11px ui-monospace, monospace', color: '#e8eef6',
        background: 'rgba(12,14,20,0.88)', border: '1px solid #2a3550', borderRadius: 10,
        padding: open ? '10px 12px' : '6px 12px', backdropFilter: 'blur(6px)',
        boxShadow: '0 8px 30px rgba(0,0,0,0.5)', userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setOpen((o) => !o)}>
        <b style={{ letterSpacing: 0.5 }}>🎛 Bake live</b>
        <span style={{ opacity: 0.6 }}>{open ? '▾' : '▸'}</span>
      </div>

      {open && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 10, opacity: 0.5, marginBottom: 4 }}>LIVE — instantané</div>
          {LIVE.map((c) => <Slider key={c.k} {...c} />)}

          <div style={{ fontSize: 10, opacity: 0.5, margin: '10px 0 4px' }}>RE-BAKE — bouton ci-dessous</div>
          {REBAKE.map((c) => <Slider key={c.k} {...c} />)}

          <button
            onClick={() => !baking && requestRebake()}
            disabled={baking}
            style={{
              width: '100%', marginTop: 8, padding: '7px 0', borderRadius: 7, border: 'none',
              font: '600 12px ui-monospace, monospace', cursor: baking ? 'wait' : 'pointer',
              background: baking ? '#39406a' : '#ff2d95', color: '#fff', opacity: baking ? 0.7 : 1,
            }}
          >
            {baking ? '⏳ bake en cours…' : '🔁 Re-bake'}
          </button>

          <div
            style={{ marginTop: 8, fontSize: 9.5, lineHeight: 1.35, wordBreak: 'break-all', opacity: 0.6, cursor: 'pointer' }}
            title="copier la recette"
            onClick={() => navigator.clipboard?.writeText(window.location.origin + '/' + recipe)}
          >
            {recipe} <span style={{ color: '#7fd3ff' }}>⧉</span>
          </div>
        </div>
      )}
    </div>
  )
}
