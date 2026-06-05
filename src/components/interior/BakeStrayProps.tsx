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
  return null
}
