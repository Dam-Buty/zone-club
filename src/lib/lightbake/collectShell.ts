import type { Mesh, Object3D } from 'three'
import { SHELL_SLOTS, bakeName } from './shellUv1.ts'

export interface ShellSets {
  /** Lightmapped surfaces, ordered to match SHELL_SLOTS (slot index = array index). */
  lightmapped: Mesh[]
  /** Every other mesh in the group — occluders: cast shadows into the bake, not lightmapped. */
  occluders: Mesh[]
}

const isMesh = (o: Object3D): o is Mesh => (o as Mesh).isMesh === true && !!(o as Mesh).geometry

/**
 * Walk a shell group and split it into the lightmapped surfaces (matched by
 * name === `bake-<slot>`, returned in SHELL_SLOTS order) and the occluders (all other
 * meshes). Throws if any SHELL_SLOTS surface is missing — the bake/runtime uv1 mapping
 * relies on every slot being present.
 */
export function collectShell(root: Object3D): ShellSets {
  const byName = new Map<string, Mesh>()
  const occluders: Mesh[] = []
  const slotNames = new Set(SHELL_SLOTS.map(bakeName))

  root.traverse((obj) => {
    if (!isMesh(obj)) return
    if (slotNames.has(obj.name)) byName.set(obj.name, obj)
    else occluders.push(obj)
  })

  const lightmapped = SHELL_SLOTS.map((slot) => {
    const m = byName.get(bakeName(slot))
    if (!m) throw new Error(`collectShell: missing lightmapped mesh "${bakeName(slot)}"`)
    return m
  })

  return { lightmapped, occluders }
}
