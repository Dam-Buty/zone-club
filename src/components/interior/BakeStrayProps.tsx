import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useProbeVolumes } from './ProbeVolumeContext'
import { attachProbeEmissive } from './probeLit'

// Catch-all baked-GI pass (`?baked=1`). The dedicated receivers (counter/couch/shelves/props/Rick…) each
// light themselves via their own emissiveNode. But many SMALL scattered props have none → in baked mode
// (no analytical rig) they read pure black: desk objects, the old-computer GLB, the back-wall posters/
// door, the corner TV body, etc. (everything the user flagged as "pas baké / aucune texture").
//
// This runs ONCE per bake, 2 frames after the probes publish (so the dedicated receivers apply first),
// then gives the baked-GI emissive to anything STILL unlit. Conservative filters so it can't touch what
// it shouldn't:
//   • plain MeshStandardMaterial only — skips MeshStandardNodeMaterial (shell/K7/receivers), MeshBasic
//     (unlit decals/screens), MeshPhysical (counter/glass, already handled);
//   • no existing emissiveNode (= not a dedicated receiver);
//   • BLACK emissive (≠ an intentional sign/display: green cash readout, pink minitel, exit signs, neon);
//   • not the shell (`bake-*`), not instanced (K7).
export function BakeStrayProps() {
  const scene = useThree((s) => s.scene)
  const probes = useProbeVolumes()
  useEffect(() => {
    if (!probes) return
    // double-rAF: let the dedicated receivers' [probes] effects run first, then sweep the leftovers.
    const id = requestAnimationFrame(() => requestAnimationFrame(() => {
      let lit = 0
      // ── Normalisation des émissifs GLB ── certains assets embarquent des emissiveIntensity
      // délirantes (la lampe du comptoir pCube6_Luz1_0 : #f6ecec × 10 ≈ lum 8.6, ~7× tout le reste —
      // audit 11/06) qu'aucun knob ne contrôle → « objets surexposés non liés aux réglages ».
      // Cap la luminance émissive (lum(emissive)×intensity) à ?ecap= (défaut 1.3) en réduisant
      // l'intensity. N'affecte ni les enseignes (lum ≤ 0.7) ni les Basic unlit (tubes, labels).
      const ecapRaw = parseFloat(new URLSearchParams(window.location.search).get('ecap') || '')
      const ECAP = Number.isFinite(ecapRaw) ? ecapRaw : 1.3
      const capPass = (label: string) => {
        if (ECAP <= 0) return
        let capped = 0
        scene.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (!mesh.isMesh) return
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          for (const m of mats) {
            const sm = m as THREE.MeshStandardMaterial
            if (!sm.emissive || (sm as unknown as { emissiveNode?: unknown }).emissiveNode) continue
            if (m.type !== 'MeshStandardMaterial' && m.type !== 'MeshPhysicalMaterial') continue
            const intensity = sm.emissiveIntensity ?? 1
            const lum = (0.2126 * sm.emissive.r + 0.7152 * sm.emissive.g + 0.0722 * sm.emissive.b) * intensity
            if (lum > ECAP) {
              sm.emissiveIntensity = intensity * (ECAP / lum)
              capped++
            }
          }
        })
        if (capped) console.log(`[baked] emissive-cap (${label}): ${capped} matériau(x) plafonné(s) à lum ${ECAP}`)
      }
      capPass('boot')
      // Rattrapage : certains GLB (lampe comptoir pCube6_Luz1_0…) montent en LAZY après ce sweep —
      // sans cette 2e passe ils gardaient leur emissiveIntensity délirante (audit 11/06 : ×10).
      setTimeout(() => capPass('late'), 5000)
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh) return
        const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
        if (!m || m.type !== 'MeshStandardMaterial') return
        const sm = m as THREE.MeshStandardMaterial
        if ((sm as unknown as { emissiveNode?: unknown }).emissiveNode) return // already a receiver
        if (sm.emissive && sm.emissive.getHex() !== 0x000000) return            // intentional emissive
        if ((mesh.name || '').startsWith('bake-')) return                       // shell (lightmapped)
        if (sm.userData?.neonEnclosure) return                                  // neon sign housing — keep it DARK metal
                                                                                // (ceiling-zone GI washed these grey bodies to a pale "white panel")
        // −40% diffuse + Reinhard roll-off (tone): props in a hot neon zone (wall posters above the
        // extincteur…) used to clip past the bloom into a self-lit "lightbox" — the cap makes them read as LIT.
        attachProbeEmissive(mesh, probes, { scale: 0.6, tone: 1.0 })
        lit++
      })
      if (lit) console.log(`[baked] stray-props pass lit ${lit} unbaked meshes`)
    }))
    return () => cancelAnimationFrame(id)
  }, [probes, scene])

  // Audit émissif (dev) — liste OBJECTIVE des matériaux à émissif propre (les candidats « objets
  // surexposés non liés aux réglages », feedback 11/06). Appel : window.__emissiveAudit() en console.
  // Luminance estimée = lum(emissive) × emissiveIntensity (les emissiveNode TSL sont seulement flaggés —
  // leur valeur dépend du fragment). Trié décroissant.
  useEffect(() => {
    ;(window as unknown as { __emissiveAudit?: unknown }).__emissiveAudit = () => {
      const out: { name: string; mat: string; lum: number; intensity: number; hex: string; node: boolean; toneMapped: boolean }[] = []
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const m of mats) {
          const sm = m as THREE.MeshStandardMaterial
          const hasNode = !!(sm as unknown as { emissiveNode?: unknown }).emissiveNode
          const e = sm.emissive
          const intensity = (sm as unknown as { emissiveIntensity?: number }).emissiveIntensity ?? 1
          const lum = e ? (0.2126 * e.r + 0.7152 * e.g + 0.0722 * e.b) * intensity : 0
          const basic = m as THREE.MeshBasicMaterial
          const isBasic = m.type === 'MeshBasicMaterial'
          const basicLum = isBasic && basic.color ? (0.2126 * basic.color.r + 0.7152 * basic.color.g + 0.0722 * basic.color.b) : 0
          if (lum > 0.01 || hasNode || (isBasic && !basic.toneMapped && basicLum > 0.5)) {
            out.push({
              name: mesh.name || mesh.parent?.name || '(anon)', mat: m.type,
              lum: +(isBasic ? basicLum : lum).toFixed(2), intensity: +intensity.toFixed(2),
              hex: e ? '#' + e.getHexString() : (basic.color ? '#' + basic.color.getHexString() : '-'),
              node: hasNode, toneMapped: m.toneMapped !== false,
            })
          }
        }
      })
      return out.sort((a, b) => b.lum - a.lum)
    }
  }, [scene])
  return null
}
